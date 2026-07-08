/**
 * Internal cache reads/writes for SerpApi Google Flights responses.
 *
 * Kept in a non-`"use node"` file so the Convex runtime can use the native
 * `db` API. The Node action in `flightsSerpApi.ts` invokes these via
 * `ctx.runQuery` / `ctx.runMutation`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const readCache = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, { cacheKey }) => {
    const row = await ctx.db
      .query("flightSearchCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
      .first();
    if (!row) return null;
    if (row.expiresAt < Date.now()) return null;
    return row.normalizedResults as any;
  },
});

export const writeCache = internalMutation({
  args: {
    cacheKey: v.string(),
    kind: v.union(
      v.literal("search"),
      v.literal("booking_options"),
      v.literal("explore")
    ),
    ttlMs: v.float64(),
    normalizedResults: v.any(),
    departureId: v.optional(v.string()),
    arrivalId: v.optional(v.string()),
    outboundDate: v.optional(v.string()),
    returnDate: v.optional(v.string()),
    type: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("flightSearchCache")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    const doc = {
      cacheKey: args.cacheKey,
      kind: args.kind,
      departureId: args.departureId,
      arrivalId: args.arrivalId,
      outboundDate: args.outboundDate,
      returnDate: args.returnDate,
      type: args.type,
      currency: args.currency,
      normalizedResults: args.normalizedResults,
      createdAt: now,
      expiresAt: now + args.ttlMs,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("flightSearchCache", doc);
    }
    return null;
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("flightSearchCache")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(200);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return expired.length;
  },
});

/**
 * Fixed-window per-user rate limit for user-facing flight searches. Protects
 * the paid SerpApi quota from abuse (notably anonymous public searches). One
 * row per user; the window resets lazily on the first call after it lapses.
 */
export const checkRateLimit = internalMutation({
  args: {
    userId: v.string(),
    limit: v.float64(),
    windowMs: v.float64(),
  },
  handler: async (ctx, { userId, limit, windowMs }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("flightSearchRateLimits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!row || now - row.windowStart >= windowMs) {
      if (row) {
        await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      } else {
        await ctx.db.insert("flightSearchRateLimits", {
          userId,
          windowStart: now,
          count: 1,
        });
      }
      return { allowed: true as const };
    }

    if (row.count >= limit) {
      return { allowed: false as const };
    }

    await ctx.db.patch(row._id, { count: row.count + 1 });
    return { allowed: true as const };
  },
});

// ============================ IATA resolution cache ==========================
// Persists AI-resolved IATA codes keyed by normalized city name so the same
// destination never re-hits OpenAI. Invoked from the Node action in
// tripsActions.ts via ctx.runQuery / ctx.runMutation.

export const readIataCache = internalQuery({
  args: { cityKey: v.string() },
  handler: async (ctx, { cityKey }) => {
    const row = await ctx.db
      .query("iataResolutionCache")
      .withIndex("by_cityKey", (q) => q.eq("cityKey", cityKey))
      .first();
    return row?.iata ?? null;
  },
});

export const writeIataCache = internalMutation({
  args: { cityKey: v.string(), iata: v.string() },
  handler: async (ctx, { cityKey, iata }) => {
    const existing = await ctx.db
      .query("iataResolutionCache")
      .withIndex("by_cityKey", (q) => q.eq("cityKey", cityKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { iata });
    } else {
      await ctx.db.insert("iataResolutionCache", {
        cityKey,
        iata,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

