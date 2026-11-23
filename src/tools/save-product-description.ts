import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShopifyClient } from "../shopify/client.js";
import { toolError, toolResult } from "./result.js";
import { z } from "zod";
import {
  GET_PRODUCT,
  ProductDetail,
  resolveProductId,
} from "../shopify/products.js";

export function registerSaveProductDescription(
  server: McpServer,
  shopify: ShopifyClient,
) {
  server.registerTool(
    "save_product_description",
    {
      title: "Save Product Description",
      description:
        "Save the drafted description of the product. Only call after the user has explicitly approved the draft.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe("Product id, e.g. 'gid://shopify/Product/123' or '123'"),
        title: z.string().trim().min(1).optional().describe("Product Title"),
        descriptionHtml: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Product description as simple HTML using only <p>, <ul>, <li>, <strong>, <em>.",
          ),
        seoTitle: z
          .string()
          .optional()
          .describe("SEO page title, at most 60 characters"),
        seoDescription: z
          .string()
          .optional()
          .describe("SEO meta description, 120–155 characters"),
        confirm: z
          .literal(true)
          .describe(
            "Must be true. Only set after the user explicitly approved this exact text.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, title, descriptionHtml, seoTitle, seoDescription }) => {
      try {
        if (!id) throw new Error("Provide a Product `id`.");

        const gid = await resolveProductId(shopify, { id });

        const { product: p } = await shopify.graphql<{
          product: ProductDetail | null;
        }>(GET_PRODUCT, { id: gid });

        if (!p)
          throw new Error(
            `No product found with id ${gid}. Try search_products.`,
          );

        const data = await shopify.graphql<{
          productUpdate: {
            product: {
              id: string;
              title: string;
              descriptionHtml: string;
              seo: {
                title: string;
                description: string;
              } | null;
            };
            userErrors: { field: string[] | null; message: string }[];
          };
        }>(
          `mutation saveProductDescription($product: ProductUpdateInput!) {
              productUpdate(product:$product){
                product{
                  id
                  title
                  descriptionHtml
                  seo {
                    title
                    description
                  }
                }
                userErrors{
                  field
                  message
                }
              }
            }`,
          {
            product: {
              id: gid,
              title,
              descriptionHtml,
              seo: { title: seoTitle, description: seoDescription },
            },
          },
        );

        if (data.productUpdate.userErrors.length > 0)
          throw new Error(
            data.productUpdate.userErrors
              .map(({ message }) => message)
              .join("; "),
          );

        return toolResult(data.productUpdate);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
