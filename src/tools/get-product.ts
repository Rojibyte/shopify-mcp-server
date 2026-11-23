import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { GET_PRODUCT, formatPrice, resolveProductId, type ProductDetail } from "../shopify/products.js";
import { toolError, toolResult } from "./result.js";

export function registerGetProduct(server: McpServer, shopify: ShopifyClient) {
  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description:
        "Get full details for one product: description, SEO title/description, price, inventory and every variant " +
        "(options, SKU, price, stock). Identify it by `id` (from search_products) or by `handle`.",
      inputSchema: {
        id: z.string().optional().describe("Product id, e.g. 'gid://shopify/Product/123' or '123'"),
        handle: z.string().optional().describe("Product handle (URL slug), e.g. 'the-collection-snowboard'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, handle }) => {
      try {
        if (!id && !handle) throw new Error("Provide either `id` or `handle`.");

        const gid = await resolveProductId(shopify, { id, handle });
        if (!gid) throw new Error(`No product found with handle "${handle}". Try search_products.`);

        const { product: p } = await shopify.graphql<{ product: ProductDetail | null }>(GET_PRODUCT, { id: gid });
        if (!p) throw new Error(`No product found with id ${gid}. Try search_products.`);

        return toolResult({
          id: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
          productType: p.productType || null,
          vendor: p.vendor,
          tags: p.tags,
          price: formatPrice(p.priceRangeV2),
          // Plain-text description for reasoning; HTML kept so a rewrite can
          // preserve the original structure.
          description: p.description,
          descriptionHtml: p.descriptionHtml,
          seo: p.seo,
          onlineStoreUrl: p.onlineStoreUrl,
          image: p.featuredMedia?.preview?.image ?? null,
          totalInventory: p.tracksInventory ? p.totalInventory : "not tracked",
          variants: p.variants.nodes.map((v) => ({
            id: v.id,
            title: v.title,
            options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
            sku: v.sku || null,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            inventoryQuantity: v.inventoryItem.tracked ? v.inventoryQuantity : "not tracked",
            availableForSale: v.availableForSale,
          })),
          updatedAt: p.updatedAt,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
