import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { SEARCH_PRODUCTS, formatPrice, quoteSearchValue, type ProductSummary } from "../shopify/products.js";
import { toolError, toolResult } from "./result.js";

export function registerSearchProducts(server: McpServer, shopify: ShopifyClient) {
  server.registerTool(
    "search_products",
    {
      title: "Search products",
      // The description is the model's main guide to *when* and *how* to call
      // the tool, so it says what each filter does and what comes back.
      description:
        "Search the store's products by keyword, tag, product type or status. All filters are optional and combined with AND. " +
        "Returns a compact list (id, title, handle, status, type, vendor, tags, price range, total inventory). " +
        "Use get_product with a returned id for full details. If hasNextPage is true, pass nextCursor as `cursor` to get more.",
      inputSchema: {
        keyword: z.string().optional().describe("Free-text search across title, type, vendor and SKU, e.g. 'snowboard'"),
        tag: z.string().optional().describe("Exact product tag, e.g. 'winter'"),
        productType: z.string().optional().describe("Exact product type, e.g. 'Accessories'"),
        status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("Product status filter"),
        limit: z.number().int().min(1).max(50).default(10).describe("Max results (1–50)"),
        cursor: z.string().optional().describe("nextCursor from a previous call, for pagination"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ keyword, tag, productType, status, limit, cursor }) => {
      try {
        // Build Shopify's search syntax: title:*snow* AND tag:"winter" AND ...
        const filters = [
          // Bare terms use Shopify's default full-text search (title, type,
          // vendor, SKU...). Strip characters that have meaning in the syntax.
          keyword && keyword.replace(/[:"*\\()]+/g, " ").trim(),
          tag && `tag:${quoteSearchValue(tag)}`,
          productType && `product_type:${quoteSearchValue(productType)}`,
          status && `status:${status.toLowerCase()}`,
        ].filter(Boolean);

        const data = await shopify.graphql<{
          products: { nodes: ProductSummary[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        }>(SEARCH_PRODUCTS, {
          first: limit,
          after: cursor ?? null,
          query: filters.length ? filters.join(" AND ") : null,
        });

        const { nodes, pageInfo } = data.products;
        return toolResult({
          count: nodes.length,
          hasNextPage: pageInfo.hasNextPage,
          nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
          products: nodes.map((p) => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            productType: p.productType || null,
            vendor: p.vendor,
            tags: p.tags,
            price: formatPrice(p.priceRangeV2),
            totalInventory: p.tracksInventory ? p.totalInventory : "not tracked",
          })),
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
