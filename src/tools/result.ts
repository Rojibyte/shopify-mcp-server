import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../log.js";

/** Wrap data as a tool result. Claude reads the text content. */
export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * Report a failure *inside* the result with isError: true, instead of throwing.
 * A thrown error becomes a protocol-level error; an isError result is shown to
 * the model, which can then explain the problem or try a different call.
 */
export function toolError(err: unknown): CallToolResult {
  let message = err instanceof Error ? err.message : String(err);
  // Node's fetch hides the real reason (DNS, TLS, refused) in err.cause.
  if (err instanceof Error && err.cause instanceof Error) message += ` (${err.cause.message})`;
  log("Tool error:", message);
  return { isError: true, content: [{ type: "text", text: message }] };
}
