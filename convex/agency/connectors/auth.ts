/**
 * Supplier authentication strategies, shared by every real connector.
 *
 * Travel APIs use a small number of auth patterns and each provider gets one of
 * them slightly wrong in its own way. Keeping them here means a connector file
 * contains only what is genuinely provider-specific — its endpoints and its
 * response mapping.
 *
 * NOTHING in this module logs a credential or a token. Errors deliberately
 * carry no header material.
 */

import { fetchJson, SupplierHttpError } from "./http";
import type { SupplierCredentials } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 client_credentials, with a token cache
// ─────────────────────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  /** Epoch ms. Already includes the safety margin. */
  expiresAt: number;
}

/**
 * Access tokens are cached per credential, in-process. A Convex action runs in
 * a V8 isolate that may be reused across invocations, so this saves a token
 * round-trip on warm calls — but it is only ever an optimisation. A cold
 * isolate simply fetches a new token.
 *
 * Keyed by a hash of the credentials, never by the credentials themselves.
 */
const tokenCache = new Map<string, CachedToken>();

/** Tokens are refreshed this long before they actually expire. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

async function cacheKey(connectorId: string, parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(`${connectorId}:${parts.join(":")}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface OAuth2Config {
  connectorId: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Some providers want the pair in the body, others in a Basic header. */
  style: "body" | "basic";
  /** Extra form fields, e.g. Sabre's grant_type variations. */
  extraForm?: Record<string, string>;
  timeoutMs?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

function base64(input: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(input)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Fetch (or reuse) an OAuth2 client_credentials access token.
 *
 * A 401/403 here means the agency's credentials are wrong — that is a permanent
 * failure and is surfaced as such, not retried into a rate limit.
 */
export async function getOAuth2Token(config: OAuth2Config): Promise<string> {
  const key = await cacheKey(config.connectorId, [
    config.tokenUrl,
    config.clientId,
    config.clientSecret,
  ]);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const form = new URLSearchParams({ grant_type: "client_credentials", ...config.extraForm });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (config.style === "basic") {
    headers.Authorization = `Basic ${base64(`${config.clientId}:${config.clientSecret}`)}`;
  } else {
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
  }

  const res = await fetchJson<TokenResponse>(
    config.tokenUrl,
    { method: "POST", headers, body: form.toString() },
    { connectorId: config.connectorId, timeoutMs: config.timeoutMs ?? 9000, retries: 1 },
  );

  if (!res.access_token) {
    throw new SupplierHttpError(0, config.connectorId, "the supplier returned no access token");
  }

  // Default to a conservative 30 minutes when the provider omits expires_in.
  const lifetimeMs = (res.expires_in ? res.expires_in * 1000 : 30 * 60_000) - TOKEN_SAFETY_MARGIN_MS;
  tokenCache.set(key, {
    token: res.access_token,
    expiresAt: Date.now() + Math.max(lifetimeMs, 30_000),
  });
  return res.access_token;
}

/** Drop a cached token — call after a 401 so the next attempt re-authenticates. */
export async function invalidateOAuth2Token(config: OAuth2Config): Promise<void> {
  tokenCache.delete(
    await cacheKey(config.connectorId, [config.tokenUrl, config.clientId, config.clientSecret]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature schemes
// ─────────────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha512Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * HBX / Hotelbeds APItude: `X-Signature` is the SHA-256 of
 * apiKey + secret + current UNIX time in SECONDS, recomputed per request.
 * Server-side only — the secret must never reach a browser.
 */
export async function hotelbedsSignature(apiKey: string, secret: string): Promise<string> {
  const unixSeconds = Math.floor(Date.now() / 1000);
  return await sha256Hex(`${apiKey}${secret}${unixSeconds}`);
}

/**
 * Expedia Rapid: `Authorization: EAN APIKey=<key>,Signature=<sig>,timestamp=<ts>`
 * where the signature is the SHA-512 of key + secret + UNIX seconds.
 */
export async function expediaEanAuthHeader(apiKey: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha512Hex(`${apiKey}${secret}${timestamp}`);
  return `EAN APIKey=${apiKey},Signature=${signature},timestamp=${timestamp}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a required credential field, failing with a message that names the field
 * the agency has to go and fetch — never with the value of anything.
 */
export function requireField(
  creds: SupplierCredentials,
  field: string,
  connectorId: string,
): string {
  const value = creds.fields?.[field]?.trim();
  if (!value) {
    throw new SupplierHttpError(
      0,
      connectorId,
      `this connection is missing its "${field}" — reconnect the supplier with the full credentials`,
    );
  }
  return value;
}

/** Pick the right host for the connection's environment. */
export const hostFor = (
  creds: SupplierCredentials,
  hosts: { sandbox: string; production: string },
): string => (creds.environment === "production" ? hosts.production : hosts.sandbox);
