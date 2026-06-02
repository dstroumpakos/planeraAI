import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sha256Hex, buildCacheKey, normalizeDestinationKey } from "./partnerApiAuth";
import { CURATED_CITIES, DEFAULT_DURATIONS } from "./partnerPregenConfig";

/**
 * Partner API — admin surface for the planeraai-web partner dashboard.
 *
 * These functions are gated by a dedicated admin token (env var
 * `PARTNER_ADMIN_TOKEN`), completely separate from the app's user sessions.
 * The dashboard supplies the token with every call. The raw API key and
 * webhook secret are returned exactly ONCE at creation and never stored in
 * plaintext.
 */

function assertAdmin(token: string) {
  const expected = process.env.PARTNER_ADMIN_TOKEN;
  if (!expected) {
    throw new ConvexError("Partner admin is not configured.");
  }
  if (token !== expected) {
    throw new ConvexError("Unauthorized.");
  }
}

/** Generate a random, URL-safe-ish secret of the given prefix. */
function randomSecret(prefix: string): string {
  const a = crypto.randomUUID().replace(/-/g, "");
  const b = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}${a}${b}`;
}

const DEFAULTS = {
  rateLimitPerMin: 60,
  dailyCap: 500,
  monthlyCap: 5000,
};

/**
 * Create a new partner API key. Returns the RAW key + webhook secret once.
 * Store them securely — they cannot be retrieved again.
 */
export const createPartnerKey = mutation({
  args: {
    adminToken: v.string(),
    partnerName: v.string(),
    partnerRef: v.string(),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);

    const rawKey = randomSecret("pk_live_");
    const webhookSecret = randomSecret("whsec_");
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const keyId = await ctx.db.insert("partnerApiKeys", {
      keyHash,
      keyPrefix,
      partnerName: args.partnerName,
      partnerRef: args.partnerRef,
      webhookSecret,
      active: true,
      rateLimitPerMin: args.rateLimitPerMin ?? DEFAULTS.rateLimitPerMin,
      dailyCap: args.dailyCap ?? DEFAULTS.dailyCap,
      monthlyCap: args.monthlyCap ?? DEFAULTS.monthlyCap,
      createdAt: Date.now(),
    });

    return {
      keyId,
      partnerName: args.partnerName,
      partnerRef: args.partnerRef,
      keyPrefix,
      // shown once:
      apiKey: rawKey,
      webhookSecret,
    };
  },
});

/** List all partner keys (no secrets/hashes). */
export const listPartnerKeys = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const keys = await ctx.db.query("partnerApiKeys").collect();
    return keys.map((k) => ({
      keyId: k._id,
      partnerName: k.partnerName,
      partnerRef: k.partnerRef,
      keyPrefix: k.keyPrefix,
      active: k.active,
      rateLimitPerMin: k.rateLimitPerMin,
      dailyCap: k.dailyCap,
      monthlyCap: k.monthlyCap,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt ?? null,
      revokedAt: k.revokedAt ?? null,
    }));
  },
});

/** Revoke (deactivate) a partner key. */
export const revokePartnerKey = mutation({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: false, revokedAt: Date.now() });
    return { ok: true };
  },
});

/** Re-activate a previously revoked key. */
export const reactivatePartnerKey = mutation({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: true, revokedAt: undefined });
    return { ok: true };
  },
});

/** Update the rate limit / generation caps for a key. */
export const updatePartnerKeyLimits = mutation({
  args: {
    adminToken: v.string(),
    keyId: v.id("partnerApiKeys"),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    const patch: Record<string, number> = {};
    if (args.rateLimitPerMin !== undefined)
      patch.rateLimitPerMin = args.rateLimitPerMin;
    if (args.dailyCap !== undefined) patch.dailyCap = args.dailyCap;
    if (args.monthlyCap !== undefined) patch.monthlyCap = args.monthlyCap;
    await ctx.db.patch(args.keyId, patch);
    return { ok: true };
  },
});

/** Current usage for a key (today + this month + recent itineraries). */
export const getPartnerUsage = query({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const now = Date.now();
    const dayBucket = new Date(now).toISOString().slice(0, 10);
    const monthBucket = new Date(now).toISOString().slice(0, 7);

    const dayCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "day").eq("bucket", dayBucket)
      )
      .first();
    const monthCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q
          .eq("keyId", args.keyId)
          .eq("window", "month")
          .eq("bucket", monthBucket)
      )
      .first();

    const recent = await ctx.db
      .query("partnerItineraries")
      .withIndex("by_idempotency", (q) => q.eq("keyId", args.keyId))
      .order("desc")
      .take(20);

    return {
      generationsToday: dayCounter?.count ?? 0,
      generationsThisMonth: monthCounter?.count ?? 0,
      recent: recent.map((r) => ({
        itineraryId: r.itineraryId,
        destination: r.destination,
        days: r.days,
        status: r.status,
        source: r.source ?? null,
        createdAt: r.createdAt,
      })),
    };
  },
});
