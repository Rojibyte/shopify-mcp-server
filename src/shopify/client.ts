import type { Config } from "../config.js";
import { TokenProvider } from "./auth.js";

type GraphQLError = { message: string; extensions?: { code?: string } };
type GraphQLResponse<T> = { data?: T; errors?: GraphQLError[] };

/** Minimal Admin GraphQL client: auth, one retry on 401/throttle, readable errors. */
export class ShopifyClient {
  private readonly tokens: TokenProvider;
  private readonly endpoint: string;

  constructor(config: Config) {
    this.tokens = new TokenProvider(config);
    this.endpoint = `https://${config.SHOPIFY_SHOP}.myshopify.com/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}, attempt = 1): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await this.tokens.getToken(),
      },
      body: JSON.stringify({ query, variables }),
    });

    // Token revoked or expired early: get a new one and retry once.
    if (res.status === 401 && attempt === 1) {
      this.tokens.invalidate();
      return this.graphql<T>(query, variables, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as GraphQLResponse<T>;

    // Shopify's GraphQL rate limit returns 200 with a THROTTLED error, not a 429.
    if (json.errors?.some((e) => e.extensions?.code === "THROTTLED") && attempt <= 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return this.graphql<T>(query, variables, attempt + 1);
    }
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (!json.data) throw new Error("Shopify returned no data");
    return json.data;
  }
}
