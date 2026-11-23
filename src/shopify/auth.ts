import type { Config } from "../config.js";
import { log } from "../log.js";

/**
 * Gets Admin API access tokens with the OAuth client credentials grant.
 *
 * Dev Dashboard apps (the only kind you can create since Jan 2026) don't show a
 * permanent token. Instead we trade the Client ID + secret for a token that
 * lasts ~24h, cache it, and fetch a new one shortly before it expires.
 */
export class TokenProvider {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;

  // Refresh 5 minutes early so a request never goes out with a token that
  // expires mid-flight.
  private static readonly REFRESH_MARGIN_MS = 5 * 60 * 1000;

  constructor(private readonly config: Config) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - TokenProvider.REFRESH_MARGIN_MS) {
      return this.token;
    }
    // If Claude fires several tool calls at once, share one token request
    // instead of starting a request per call.
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Call after a 401 so the next request fetches a fresh token. */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async fetchToken(): Promise<string> {
    const { SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = this.config;
    const res = await fetch(`https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    });

    if (!res.ok) {
      throw new Error(`Token request failed (${res.status}): ${describeOAuthError(await res.text())}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number; scope: string };
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    log(`Got access token (scopes: ${data.scope}; expires in ${Math.round(data.expires_in / 3600)}h)`);
    return this.token;
  }
}

// Shopify answers a failed grant with an HTML error page (or sometimes JSON).
// Pull out the error code and turn it into a fix.
const OAUTH_HINTS: Record<string, string> = {
  shop_not_permitted:
    "the store isn't in the same organization as the app. Create the store from Dev Dashboard → Dev stores, not from the Shopify admin.",
  app_not_installed:
    "the app isn't installed on this store. Release a version in the Dev Dashboard, install it on the store, and check SHOPIFY_SHOP is that store's real myshopify subdomain.",
  application_cannot_be_found:
    "Shopify doesn't recognise SHOPIFY_CLIENT_ID. Re-copy the Client ID (not the app name or the secret) from the app's Settings page.",
  invalid_client: "the Client ID or secret is wrong. Re-copy both from the app's Settings page.",
};

function describeOAuthError(body: string): string {
  const code =
    body.match(/"error"\s*:\s*"([a-z_]+)"/)?.[1] ?? body.match(/Oauth error ([a-z_]+)/i)?.[1];
  if (!code) return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${code}: ${OAUTH_HINTS[code] ?? "see shopify.dev client credentials troubleshooting."}`;
}
