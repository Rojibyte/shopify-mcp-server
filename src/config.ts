import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Claude Desktop launches the server from its own working directory, not the
// project folder, so resolve .env relative to this file instead of process.cwd().
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env");
if (existsSync(envPath)) {
  // Built into Node >= 20.12. Unlike some dotenv versions, it never writes to
  // stdout — which matters, because stdout is the MCP protocol channel.
  process.loadEnvFile(envPath);
}

const ConfigSchema = z.object({
  SHOPIFY_SHOP: z
    .string()
    .min(1, "SHOPIFY_SHOP is required")
    .transform((s) => s.replace(/\.myshopify\.com$/, "")),
  SHOPIFY_CLIENT_ID: z.string().min(1, "SHOPIFY_CLIENT_ID is required"),
  SHOPIFY_CLIENT_SECRET: z.string().min(1, "SHOPIFY_CLIENT_SECRET is required"),
  SHOPIFY_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .default("2026-10"),
  LOW_STOCK_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration (check your .env):\n${issues}`);
  }
  return parsed.data;
}
