// With the stdio transport, stdout carries JSON-RPC messages between Claude and
// this server. A stray console.log() corrupts that stream and the client
// disconnects. Everything human-readable goes to stderr instead — Claude
// Desktop captures it in its MCP log files.
export const log = (...args: unknown[]) => console.error("[shopify-mcp]", ...args);
