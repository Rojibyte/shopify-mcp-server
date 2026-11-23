#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { ShopifyClient } from "./shopify/client.js";
import { registerCheckInventory } from "./tools/check-inventory.js";
import { registerGetProduct } from "./tools/get-product.js";
import { registerSearchProducts } from "./tools/search-products.js";
import { registerShopInfo } from "./tools/shop-info.js";
import { registerCountProducts } from "./tools/count-products.js";
import { registerDraftProductDescription } from "./tools/draft-product-description.js";
import { registerSaveProductDescription } from "./tools/save-product-description.js";

async function main() {
  const config = loadConfig();
  const shopify = new ShopifyClient(config);

  const server = new McpServer({
    name: "shopify-mcp-server",
    version: "0.1.0",
  });

  registerCountProducts(server, shopify);
  registerShopInfo(server, shopify);
  registerSearchProducts(server, shopify);
  registerGetProduct(server, shopify);
  registerCheckInventory(server, shopify, config.LOW_STOCK_THRESHOLD);
  registerDraftProductDescription(server, shopify, config);
  registerSaveProductDescription(server, shopify);
  // Task 4: registerDraftProductDescription

  // stdio: Claude Desktop starts this process and talks to it over stdin/stdout.
  await server.connect(new StdioServerTransport());
  log(
    `Connected — store: ${config.SHOPIFY_SHOP}.myshopify.com, API ${config.SHOPIFY_API_VERSION}`,
  );
}

main().catch((err) => {
  log("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
