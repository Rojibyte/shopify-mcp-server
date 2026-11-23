import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyClient } from "../shopify/client.js";
import { toolError, toolResult } from "./result.js";

export function registerCountProducts(
  server: McpServer,
  shopify: ShopifyClient,
) {
  server.registerTool(
    "count_products",
    {
      title: "Count products",
      description:
        "Returns the total number of products in the store. Use when the user asks how many products there are.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const data = await shopify.graphql<{
          productsCount: {
            count: number;
          };
        }>(`{ productsCount { count } }`);
        return toolResult(data.productsCount);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
