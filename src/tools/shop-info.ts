import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyClient } from "../shopify/client.js";
import { toolError, toolResult } from "./result.js";

/** Smoke-test tool: proves auth + GraphQL work end to end. */
export function registerShopInfo(server: McpServer, shopify: ShopifyClient) {
  server.registerTool(
    "get_shop_info",
    {
      title: "Get shop info",
      description: "Returns the connected Shopify store's name, domain and currency. Use to confirm which store you're working with.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const data = await shopify.graphql<{
          shop: { name: string; myshopifyDomain: string; currencyCode: string; plan: { publicDisplayName: string } };
        }>(`{ shop { name myshopifyDomain currencyCode plan { publicDisplayName } } }`);
        return toolResult(data.shop);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
