import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

/**
 * Partner API — authentication, rate limiting and small shared helpers.
 *
 * This surface is fully isolated from the app's user-session auth. Partners
 * present a Bearer key; we persist only its SHA-256 hash. Rate limiting and
 * generation caps are enforced with rolling per-window counters.
 *
 * All functions here run in the V8 runtime (no "use node") so they can be
 * called from HTTP actions cheaply.
 */

// ---------------------------------------------------------------------------
// Shared pure helpers (also imported by partnerApi.ts / http handlers)
// ---------------------------------------------------------------------------

/** SHA-256 hex digest using the Web Crypto API (available in Convex V8). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256 hex digest, used to sign outbound webhooks. */
export async function hmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize a destination string into a stable cache key fragment. */
export function normalizeDestinationKey(destination: string): string {
  return destination
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the canonical cache key for an itinerary request:
 *   normalizedDestination + "|" + days + "|" + sortedPreferences
 */
export function buildCacheKey(
  destination: string,
  days: number,
  preferences: string[]
): string {
  const normPrefs = normalizePreferences(preferences);
  return `${normalizeDestinationKey(destination)}|${days}|${normPrefs.join(",")}`;
}

/** Lowercase, trim, dedupe and sort preferences for a stable key. */
export function normalizePreferences(preferences: string[]): string[] {
  const set = new Set(
    (preferences || [])
      .map((p) => String(p).trim().toLowerCase())
      .filter((p) => p.length > 0)
  );
  return [...set].sort();
}

/** Parse a Bearer token out of an Authorization header. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export type PartnerErrorCode =
  | "invalid_key"
  | "revoked"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "validation_error"
  | "rate_limited"
  | "daily_cap_exceeded"
  | "monthly_cap_exceeded"
  | "degraded"
  | "internal_error";

const STATUS_BY_CODE: Record<PartnerErrorCode, number> = {
  invalid_key: 401,
  revoked: 403,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  validation_error: 422,
  rate_limited: 429,
  daily_cap_exceeded: 429,
  monthly_cap_exceeded: 429,
  degraded: 503,
  internal_error: 500,
};

/** Build a structured JSON error Response for the partner API. */
export function partnerError(
  code: PartnerErrorCode,
  message: string,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status: STATUS_BY_CODE[code],
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
        ...(extraHeaders || {}),
      },
    }
  );
}

/** Build a structured JSON success Response. */
export function partnerJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * CORS headers so the public Partner API can be called directly from a browser
 * (e.g. the playground on planeraai.app). The API is keyed per request via a
 * Bearer token, so allowing any origin is safe — there are no cookies/sessions.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Max-Age": "86400",
};

/** Preflight response for browser CORS OPTIONS requests. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Window bucket helpers
// ---------------------------------------------------------------------------

function minuteBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16); // "2026-06-02T14:31"
}
function dayBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // "2026-06-02"
}
function monthBucket(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7); // "2026-06"
}

// ---------------------------------------------------------------------------
// Convex functions
// ---------------------------------------------------------------------------

/** Look up an API key by its SHA-256 hash. Returns the doc or null. */
export const getKeyByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("partnerApiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    return key ?? null;
  },
});

/** Look up an API key by its document id. Returns the doc or null. */
export const getKeyById = internalQuery({
  args: { keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.keyId);
  },
});

/**
 * Increment the per-minute request counter and report whether the request is
 * within the key's rate limit. Returns { allowed, limit, remaining, retryAfter }.
 */
export const checkRequestRate = internalMutation({
  args: { keyId: v.id("partnerApiKeys"), rateLimitPerMin: v.float64() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const bucket = minuteBucket(now);
    const existing = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "min").eq("bucket", bucket)
      )
      .first();

    const next = (existing?.count ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, { count: next });
    } else {
      await ctx.db.insert("partnerUsageCounters", {
        keyId: args.keyId,
        window: "min",
        bucket,
        count: next,
        expiresAt: now + 2 * 60 * 1000,
      });
    }

    const allowed = next <= args.rateLimitPerMin;
    return {
      allowed,
      limit: args.rateLimitPerMin,
      remaining: Math.max(0, args.rateLimitPerMin - next),
      retryAfter: 60,
    };
  },
});

/**
 * Atomically consume one generation against the daily and monthly caps.
 * Checks BEFORE incrementing so a capped key never goes over. Returns
 * { allowed, code? } where code is "daily_cap_exceeded" | "monthly_cap_exceeded".
 */
export const consumeGeneration = internalMutation({
  args: {
    keyId: v.id("partnerApiKeys"),
    dailyCap: v.float64(),
    monthlyCap: v.float64(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dBucket = dayBucket(now);
    const mBucket = monthBucket(now);

    const dayCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "day").eq("bucket", dBucket)
      )
      .first();
    const monthCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "month").eq("bucket", mBucket)
      )
      .first();

    if ((dayCounter?.count ?? 0) >= args.dailyCap) {
      return { allowed: false, code: "daily_cap_exceeded" as const };
    }
    if ((monthCounter?.count ?? 0) >= args.monthlyCap) {
      return { allowed: false, code: "monthly_cap_exceeded" as const };
    }

    if (dayCounter) {
      await ctx.db.patch(dayCounter._id, { count: dayCounter.count + 1 });
    } else {
      await ctx.db.insert("partnerUsageCounters", {
        keyId: args.keyId,
        window: "day",
        bucket: dBucket,
        count: 1,
        expiresAt: now + 2 * 24 * 60 * 60 * 1000,
      });
    }
    if (monthCounter) {
      await ctx.db.patch(monthCounter._id, { count: monthCounter.count + 1 });
    } else {
      await ctx.db.insert("partnerUsageCounters", {
        keyId: args.keyId,
        window: "month",
        bucket: mBucket,
        count: 1,
        expiresAt: now + 40 * 24 * 60 * 60 * 1000,
      });
    }

    return { allowed: true, code: undefined };
  },
});

/** Stamp lastUsedAt on a key (best-effort, fire-and-forget). */
export const touchKey = internalMutation({
  args: { keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
    return null;
  },
});

/**
 * Record a free cache hit against the daily/monthly cache counters. These are
 * tracked for analytics only — cache hits cost no LLM and never count toward
 * the generation caps. Mirrors `consumeGeneration` but in the "cache_*" windows.
 */
export const recordCacheHit = internalMutation({
  args: { keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dBucket = dayBucket(now);
    const mBucket = monthBucket(now);

    const dayCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "cache_day").eq("bucket", dBucket)
      )
      .first();
    if (dayCounter) {
      await ctx.db.patch(dayCounter._id, { count: dayCounter.count + 1 });
    } else {
      await ctx.db.insert("partnerUsageCounters", {
        keyId: args.keyId,
        window: "cache_day",
        bucket: dBucket,
        count: 1,
        expiresAt: now + 2 * 24 * 60 * 60 * 1000,
      });
    }

    const monthCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "cache_month").eq("bucket", mBucket)
      )
      .first();
    if (monthCounter) {
      await ctx.db.patch(monthCounter._id, { count: monthCounter.count + 1 });
    } else {
      await ctx.db.insert("partnerUsageCounters", {
        keyId: args.keyId,
        window: "cache_month",
        bucket: mBucket,
        count: 1,
        expiresAt: now + 40 * 24 * 60 * 60 * 1000,
      });
    }

    return null;
  },
});
