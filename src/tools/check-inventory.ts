import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { LOW_STOCK_CANDIDATES, resolveProductId, type Variant } from "../shopify/products.js";
import { toolError, toolResult } from "./result.js";

type CandidateProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number;
  tracksInventory: boolean;
  variants: { nodes: Variant[] };
};

export function registerCheckInventory(server: McpServer, shopify: ShopifyClient, defaultThreshold: number) {
  server.registerTool(
    "check_inventory",
    {
      title: "Check inventory",
      description:
        `Check stock levels and flag low-stock items. Without a product, scans the store (lowest stock first) and returns ` +
        `every variant at or below the threshold (default ${defaultThreshold}), with out-of-stock variants marked. ` +
        `With a product id or handle, returns stock for each of that product's variants. Products that don't track ` +
        `inventory are skipped.`,
      inputSchema: {
        id: z.string().optional().describe("Optional product id to check just one product"),
        handle: z.string().optional().describe("Optional product handle to check just one product"),
        threshold: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(`Flag variants with stock at or below this number (default ${defaultThreshold})`),
        includeDrafts: z.boolean().default(false).describe("Also scan draft products (store-wide scan only)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, handle, threshold = defaultThreshold, includeDrafts }) => {
      try {
        let products: CandidateProduct[];

        if (id || handle) {
          const gid = await resolveProductId(shopify, { id, handle });
          if (!gid) throw new Error(`No product found with handle "${handle}".`);
          const data = await shopify.graphql<{ products: { nodes: CandidateProduct[] } }>(LOW_STOCK_CANDIDATES, {
            first: 1,
            query: `id:${gid.split("/").pop()}`,
          });
          products = data.products.nodes;
          if (!products.length) throw new Error(`No product found with id ${gid}.`);
        } else {
          // Sorted by total inventory ascending, so 50 products is plenty to
          // find what's low. (A variant can be low while its product total is
          // high; for a big catalog you'd page further or use a bulk query.)
          const data = await shopify.graphql<{ products: { nodes: CandidateProduct[] } }>(LOW_STOCK_CANDIDATES, {
            first: 50,
            query: includeDrafts ? "status:active OR status:draft" : "status:active",
          });
          products = data.products.nodes;
        }

        const rows = products
          .filter((p) => p.tracksInventory)
          .flatMap((p) =>
            p.variants.nodes
              .filter((v) => v.inventoryItem.tracked && v.inventoryQuantity !== null)
              .map((v) => {
                const qty = v.inventoryQuantity as number;
                return {
                  productId: p.id,
                  product: p.title,
                  variant: v.title === "Default Title" ? null : v.title,
                  sku: v.sku || null,
                  quantity: qty,
                  level: qty <= 0 ? "OUT_OF_STOCK" : qty <= threshold ? "LOW" : "OK",
                };
              }),
          );

        const singleProduct = Boolean(id || handle);
        const flagged = rows.filter((r) => r.level !== "OK").sort((a, b) => a.quantity - b.quantity);

        return toolResult({
          threshold,
          scope: singleProduct ? "single product" : `store-wide (${products.length} lowest-stock products scanned)`,
          summary: {
            outOfStock: flagged.filter((r) => r.level === "OUT_OF_STOCK").length,
            low: flagged.filter((r) => r.level === "LOW").length,
          },
          // For one product show every variant; store-wide, only what needs attention.
          items: singleProduct ? rows : flagged,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
