#!/usr/bin/env node
/**
 * A command-line agent: Claude + your MCP server, with no Claude Desktop.
 *
 * Claude Desktop normally does three jobs for you. This script does them in code:
 *   1. Starts the MCP server and asks it which tools it has   (MCP client)
 *   2. Runs the loop: ask Claude → run the tools it picks → send results back
 *   3. Keeps the conversation history so follow-ups have context (multi-turn)
 *
 * Plus two things Claude Desktop doesn't give you:
 *   - Structured output: every final answer matches ReplySchema (typed JSON)
 *   - A hard approval gate: destructive tools need a "y" typed in the terminal
 *
 * Run:  npm run build && npm run agent
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const MAX_STEPS = 10; // safety stop: max Claude calls per question

/* ---------- Structured output for the final answer ---------- */

// Every answer Claude gives the user (not its tool calls) must match this.
// A program could consume this JSON directly: show `answer`, render
// `products` as links, turn `nextSteps` into buttons, etc.
const ReplySchema = z.object({
  answer: z.string().describe("The answer for the user, in plain language"),
  products: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .describe("Products the answer refers to (empty if none)"),
  nextSteps: z.array(z.string()).describe("0–3 suggested follow-up actions"),
});

const SYSTEM_PROMPT = `You are a Shopify store assistant with tools to search products, read details, check inventory, draft copy and save copy.
- Use tools to get facts; never guess store data.
- Before calling save_product_description, show the user the exact text and get their explicit approval in the conversation.
- Keep answers short and practical.`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY missing from .env");

  /* ---------- 1. Connect to our MCP server as a client ---------- */

  // Same thing Claude Desktop does with your config: spawn the server process
  // and speak MCP to it over stdin/stdout.
  const mcp = new Client({ name: "shopify-agent-cli", version: "0.1.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath, // the current `node` binary
      args: [resolve(here, "index.js")], // dist/index.js
      stderr: "ignore", // hide the server's logs; set to "inherit" to debug
    }),
  );

  const { tools: mcpTools } = await mcp.listTools();

  // MCP tool definitions → Anthropic tool definitions. Both use JSON Schema
  // for inputs, so this is mostly renaming fields.
  const tools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  // Remember which tools change data, from the server's own annotations.
  const destructive = new Set(
    mcpTools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name),
  );

  console.log(`Connected. Tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log(`Model: ${MODEL}. Type a question, or "exit".\n`);

  const anthropic = new Anthropic();
  const rl = createInterface({ input: stdin, output: stdout });

  // The whole conversation. The API is stateless: Claude only "remembers"
  // earlier turns because we send the full history on every request.
  const messages: Anthropic.MessageParam[] = [];

  /* ---------- 2. Chat loop (one iteration per user message) ---------- */

  while (true) {
    const question = (await rl.question("you › ")).trim();
    if (!question) continue;
    if (question === "exit") break;

    messages.push({ role: "user", content: question });

    /* ---------- 3. Agent loop (one iteration per Claude call) ---------- */

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = await anthropic.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools,
        messages,
        // Applies to Claude's final text only. Tool calls are separate.
        output_config: { format: zodOutputFormat(ReplySchema) },
      });

      // Claude's reply (text and/or tool calls) becomes part of the history.
      messages.push({ role: "assistant", content: response.content });
      log(
        `  [step ${step}] stop_reason=${response.stop_reason} tokens in/out=${response.usage.input_tokens}/${response.usage.output_tokens}`,
      );

      // Claude wants tools: run every tool call in this turn, then loop again.
      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          log(`  → ${block.name}(${JSON.stringify(block.input)})`);
          toolResults.push(await runTool(mcp, rl, destructive, block));
        }

        // Tool results go back as a *user* message, matched to each call by id.
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Claude is done: print the structured answer.
      if (response.parsed_output) {
        printReply(response.parsed_output);
      } else {
        // e.g. "max_tokens" (cut off) or "refusal"
        console.log(
          `\n(No structured answer; stop_reason: ${response.stop_reason})\n`,
        );
      }
      break;
    }
  }

  rl.close();
  await mcp.close();
}

/** Run one tool call through MCP, enforcing approval for destructive tools. */
async function runTool(
  mcp: Client,
  rl: ReturnType<typeof createInterface>,
  destructive: Set<string>,
  call: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam> {
  // The approval gate lives in OUR code, so it can't be skipped by the model,
  // by a prompt injection, or by a client setting.
  if (destructive.has(call.name)) {
    console.log(
      `\n⚠️  Claude wants to run ${call.name} with:\n${JSON.stringify(call.input, null, 2)}`,
    );
    const ok =
      (await rl.question("Allow this change? (y/N) ")).trim().toLowerCase() ===
      "y";
    if (!ok) {
      return {
        type: "tool_result",
        tool_use_id: call.id,
        is_error: true,
        content:
          "The user declined this action. Nothing was changed. Ask what they'd like to do instead.",
      };
    }
  }

  const result = await mcp.callTool({
    name: call.name,
    arguments: call.input as Record<string, unknown>,
  });

  // MCP returns a list of content parts; our tools always return text.
  const text = (result.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return {
    type: "tool_result",
    tool_use_id: call.id,
    content: text,
    is_error: Boolean(result.isError),
  };
}

function printReply(reply: z.infer<typeof ReplySchema>) {
  console.log(`\nclaude › ${reply.answer}`);
  if (reply.products.length)
    console.log(`  products: ${reply.products.map((p) => p.title).join(", ")}`);
  if (reply.nextSteps.length)
    console.log(`  next: ${reply.nextSteps.join(" | ")}`);
  console.log();
}

const log = (msg: string) => console.log(`\x1b[2m${msg}\x1b[0m`); // dim text

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
