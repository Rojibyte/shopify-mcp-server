import type { ShopifyClient } from "./client.js";

/* ---------- GraphQL ---------- */

// Fields for list views. Kept small on purpose: every field we return ends up
// in Claude's context window, so lean results = cheaper, faster, more focused.
const PRODUCT_SUMMARY = /* GraphQL */ `
  fragment ProductSummary on Product {
    id
    title
    handle
    status
    productType
    vendor
    tags
    totalInventory
    tracksInventory
    priceRangeV2 {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }
  }
`;

const VARIANT_FIELDS = /* GraphQL */ `
  fragment VariantFields on ProductVariant {
    id
    title
    sku
    price
    compareAtPrice
    inventoryQuantity
    availableForSale
    selectedOptions { name value }
    inventoryItem { tracked }
  }
`;

export const SEARCH_PRODUCTS = /* GraphQL */ `
  ${PRODUCT_SUMMARY}
  query SearchProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      nodes { ...ProductSummary }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const GET_PRODUCT = /* GraphQL */ `
  ${PRODUCT_SUMMARY}
  ${VARIANT_FIELDS}
  query GetProduct($id: ID!) {
    product(id: $id) {
      ...ProductSummary
      description
      descriptionHtml
      seo { title description }
      onlineStoreUrl
      createdAt
      updatedAt
      featuredMedia { preview { image { url altText } } }
      variants(first: 50) { nodes { ...VariantFields } }
    }
  }
`;

export const GET_PRODUCT_BY_HANDLE = /* GraphQL */ `
  query GetProductIdByHandle($query: String!) {
    products(first: 1, query: $query) { nodes { id } }
  }
`;

// Lowest stock first, so the first page already holds the products we care about.
export const LOW_STOCK_CANDIDATES = /* GraphQL */ `
  ${VARIANT_FIELDS}
  query LowStockCandidates($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: INVENTORY_TOTAL) {
      nodes {
        id
        title
        handle
        status
        totalInventory
        tracksInventory
        variants(first: 50) { nodes { ...VariantFields } }
      }
    }
  }
`;

/* ---------- Types (only the fields we query) ---------- */

type Money = { amount: string; currencyCode: string };

export type ProductSummary = {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
  productType: string;
  vendor: string;
  tags: string[];
  totalInventory: number;
  tracksInventory: boolean;
  priceRangeV2: { minVariantPrice: Money; maxVariantPrice: Money };
};

export type Variant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { tracked: boolean };
};

export type ProductDetail = ProductSummary & {
  description: string;
  descriptionHtml: string;
  seo: { title: string | null; description: string | null };
  onlineStoreUrl: string | null;
  createdAt: string;
  updatedAt: string;
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
  variants: { nodes: Variant[] };
};

/* ---------- Helpers ---------- */

/** Accepts "gid://shopify/Product/123" or plain "123". */
export function toProductGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id.trim()}`;
}

/**
 * Shopify search syntax treats spaces, colons and quotes specially, so wrap
 * user values in quotes and escape inner quotes. Stops "red: shirt" being read
 * as a field filter.
 */
export function quoteSearchValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatPrice(range: ProductSummary["priceRangeV2"]): string {
  const { minVariantPrice: min, maxVariantPrice: max } = range;
  return min.amount === max.amount
    ? `${min.amount} ${min.currencyCode}`
    : `${min.amount}–${max.amount} ${min.currencyCode}`;
}

/** Resolve a product by id or handle to its GID. Returns null if not found. */
export async function resolveProductId(
  shopify: ShopifyClient,
  input: { id?: string; handle?: string },
): Promise<string | null> {
  if (input.id) return toProductGid(input.id);
  if (!input.handle) return null;
  const data = await shopify.graphql<{ products: { nodes: { id: string }[] } }>(GET_PRODUCT_BY_HANDLE, {
    query: `handle:${quoteSearchValue(input.handle)}`,
  });
  return data.products.nodes[0]?.id ?? null;
}
