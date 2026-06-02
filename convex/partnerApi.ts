import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/**
 * Partner API — itinerary resource + async job records.
 *
 * A single `partnerItineraries` row is simultaneously the cache entry, the
 * async job record and the canonical resource returned by GET. These internal
 * functions are called from the HTTP action handlers in http.ts.
 *
 * Runs in the V8 runtime (no "use node").
 */

/** Generate a public itinerary id, e.g. "itn_a1b2c3d4...". */
export function newItineraryId(): string {
  return "itn_" + crypto.randomUUID().replace(/-/g, "");
}

/** Shape the public JSON view of an itinerary record (no internal fields). */
export function serializeItinerary(record: Doc<"partnerItineraries">) {
  return {
    itinerary_id: record.itineraryId,
    status: record.status,
    destination: record.destination,
    days: record.days,
    preferences: record.preferences,
    partner_ref: record.partnerRef,
    source: record.source ?? null,
    created_at: new Date(record.createdAt).toISOString(),
    ready_at: record.readyAt ? new Date(record.readyAt).toISOString() : null,
    error: record.error ?? null,
    itinerary: record.itinerary ?? null,
  };
}

/** Find a non-failed record by idempotency key (per partner key). */
export const findByIdempotency = internalQuery({
  args: { keyId: v.id("partnerApiKeys"), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("partnerItineraries")
      .withIndex("by_idempotency", (q) =>
        q.eq("keyId", args.keyId).eq("idempotencyKey", args.idempotencyKey)
      )
      .first();
    return record ?? null;
  },
});

/** Find the most recent ready cache entry for a cache key. */
export const findCached = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("partnerItineraries")
      .withIndex("by_cacheKey", (q) => q.eq("cacheKey", args.cacheKey))
      .collect();
    const ready = candidates
      .filter((c) => c.status === "ready" && c.itinerary)
      .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0));
    return ready[0] ?? null;
  },
});

/**
 * Look up the learned canonical spelling for a city token. Used on cache miss
 * for cities we don't pre-generate, so repeat requests with a different
 * spelling collapse onto the first-seen canonical and hit the cache.
 */
export const lookupCanonical = internalQuery({
  args: { cityToken: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("partnerCityCanonical")
      .withIndex("by_cityToken", (q) => q.eq("cityToken", args.cityToken))
      .first();
    return row?.canonicalDestination ?? null;
  },
});

/**
 * Lock in the canonical spelling for a city token on first sight. Later
 * requests for the same city (any spelling) resolve to this value. The first
 * spelling wins; subsequent calls only bump `lastSeenAt`.
 */
export const rememberCanonical = internalMutation({
  args: { cityToken: v.string(), destination: v.string() },
  handler: async (ctx, args) => {
    if (!args.cityToken) return null;
    const now = Date.now();
    const existing = await ctx.db
      .query("partnerCityCanonical")
      .withIndex("by_cityToken", (q) => q.eq("cityToken", args.cityToken))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("partnerCityCanonical", {
        cityToken: args.cityToken,
        canonicalDestination: args.destination,
        createdAt: now,
        lastSeenAt: now,
      });
    }
    return null;
  },
});

/** Fetch a record by its public itinerary id. */
export const getByItineraryId = internalQuery({
  args: { itineraryId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("partnerItineraries")
      .withIndex("by_itineraryId", (q) =>
        q.eq("itineraryId", args.itineraryId)
      )
      .first();
    return record ?? null;
  },
});

/**
 * Record demand for a destination + duration that was just generated live
 * (cache miss). Feeds the pre-generation "budget" so the recurring cron can
 * pre-build the other common durations for cities partners actually request.
 */
export const recordDemand = internalMutation({
  args: {
    destinationKey: v.string(),
    destination: v.string(),
    days: v.float64(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("partnerDemand")
      .withIndex("by_dest_days", (q) =>
        q.eq("destinationKey", args.destinationKey).eq("days", args.days)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        destination: args.destination,
        lastRequestedAt: now,
        covered: false, // fresh demand re-opens this city for pre-generation
      });
    } else {
      await ctx.db.insert("partnerDemand", {
        destinationKey: args.destinationKey,
        destination: args.destination,
        days: args.days,
        count: 1,
        firstRequestedAt: now,
        lastRequestedAt: now,
        covered: false,
      });
    }
    return null;
  },
});

/** Top uncovered demand rows (most-requested first) for the pre-gen budget. */
export const topDemand = internalQuery({
  args: { limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("partnerDemand")
      .withIndex("by_covered_count", (q) => q.eq("covered", false))
      .order("desc")
      .take(args.limit ?? 100);
  },
});

/** Mark every demand row for a destination as covered by pre-generation. */
export const markDemandCovered = internalMutation({
  args: { destinationKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("partnerDemand")
      .withIndex("by_dest_days", (q) =>
        q.eq("destinationKey", args.destinationKey)
      )
      .collect();
    const now = Date.now();
    for (const r of rows) {
      if (!r.covered) {
        await ctx.db.patch(r._id, { covered: true, coveredAt: now });
      }
    }
    return null;
  },
});

/**
 * Create a queued generation job and schedule the generator action.
 * Returns the new public itinerary id.
 */
export const enqueueGeneration = internalMutation({
  args: {
    keyId: v.id("partnerApiKeys"),
    partnerRef: v.string(),
    idempotencyKey: v.optional(v.string()),
    destination: v.string(),
    normalizedDestination: v.string(),
    days: v.float64(),
    preferences: v.array(v.string()),
    cacheKey: v.string(),
    webhookUrl: v.optional(v.string()),
    isPregenerated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const itineraryId = newItineraryId();
    const now = Date.now();

    const docId = await ctx.db.insert("partnerItineraries", {
      itineraryId,
      cacheKey: args.cacheKey,
      keyId: args.keyId,
      partnerRef: args.partnerRef,
      idempotencyKey: args.idempotencyKey,
      destination: args.destination,
      normalizedDestination: args.normalizedDestination,
      days: args.days,
      preferences: args.preferences,
      webhookUrl: args.webhookUrl,
      isPregenerated: args.isPregenerated,
      status: "queued",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.partnerItineraryGen.generatePartnerItinerary,
      { docId }
    );

    return { itineraryId, docId };
  },
});

/** Mark a job as generating (called by the generator action). */
export const markGenerating = internalMutation({
  args: { docId: v.id("partnerItineraries") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.docId, { status: "generating" });
    return null;
  },
});

/** Store a completed itinerary and mark it ready. */
export const markReady = internalMutation({
  args: {
    docId: v.id("partnerItineraries"),
    itinerary: v.any(),
    source: v.union(
      v.literal("llm"),
      v.literal("cache"),
      v.literal("pregenerated"),
      v.literal("template")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.docId, {
      status: "ready",
      itinerary: args.itinerary,
      source: args.source,
      readyAt: Date.now(),
      error: undefined,
    });
    return null;
  },
});

/** Mark a job as failed with an error message. */
export const markFailed = internalMutation({
  args: { docId: v.id("partnerItineraries"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.docId, {
      status: "failed",
      error: args.error,
      readyAt: Date.now(),
    });
    return null;
  },
});

/** Record successful webhook delivery time. */
export const markWebhookDelivered = internalMutation({
  args: { docId: v.id("partnerItineraries") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.docId, { webhookDeliveredAt: Date.now() });
    return null;
  },
});

/** Fetch a record by internal doc id (for the generator action). */
export const getDoc = internalQuery({
  args: { docId: v.id("partnerItineraries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.docId);
  },
});

/**
 * Mint a partner-owned "ready" record that copies an existing cached itinerary.
 * This keeps strict per-partner ownership for GET while still serving cache
 * hits instantly with zero LLM cost. Source is reported as "pregenerated"
 * when the origin was pre-generated, otherwise "cache".
 */
export const recordCacheHit = internalMutation({
  args: {
    keyId: v.id("partnerApiKeys"),
    partnerRef: v.string(),
    idempotencyKey: v.optional(v.string()),
    destination: v.string(),
    normalizedDestination: v.string(),
    days: v.float64(),
    preferences: v.array(v.string()),
    cacheKey: v.string(),
    itinerary: v.any(),
    originSource: v.optional(
      v.union(
        v.literal("llm"),
        v.literal("cache"),
        v.literal("pregenerated"),
        v.literal("template")
      )
    ),
  },
  handler: async (ctx, args) => {
    const itineraryId = newItineraryId();
    const now = Date.now();
    const source =
      args.originSource === "pregenerated" ? "pregenerated" : "cache";

    const docId = await ctx.db.insert("partnerItineraries", {
      itineraryId,
      cacheKey: args.cacheKey,
      keyId: args.keyId,
      partnerRef: args.partnerRef,
      idempotencyKey: args.idempotencyKey,
      destination: args.destination,
      normalizedDestination: args.normalizedDestination,
      days: args.days,
      preferences: args.preferences,
      status: "ready",
      source,
      itinerary: args.itinerary,
      createdAt: now,
      readyAt: now,
    });

    const doc = await ctx.db.get(docId);
    return doc!;
  },
});

/** Get or create the internal "system" partner key used by pre-generation. */
export const getOrCreateSystemKey = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("partnerApiKeys")
      .withIndex("by_partnerRef", (q) => q.eq("partnerRef", "__system__"))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("partnerApiKeys", {
      keyHash: "__system__", // never matches a real SHA-256 digest
      keyPrefix: "system",
      partnerName: "Planera System (pre-generation)",
      partnerRef: "__system__",
      webhookSecret: "__none__",
      active: false, // cannot be used to authenticate the public API
      rateLimitPerMin: 0,
      dailyCap: 0,
      monthlyCap: 0,
      createdAt: Date.now(),
    });
  },
});

/**
 * Save a pre-warmed set of destination sights (no trip association). Reused by
 * the generator as geographic grounding. Replaces any stale destination-level
 * cache for the same key.
 */
export const savePregenSights = internalMutation({
  args: {
    destinationKey: v.string(),
    sights: v.array(
      v.object({
        name: v.string(),
        shortDescription: v.string(),
        neighborhoodOrArea: v.optional(v.string()),
        bestTimeToVisit: v.optional(v.string()),
        estDurationHours: v.optional(v.string()),
        latitude: v.optional(v.float64()),
        longitude: v.optional(v.float64()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query("destinationSights")
      .withIndex("by_destination_key", (q) =>
        q.eq("destinationKey", args.destinationKey)
      )
      .first();
    if (stale) await ctx.db.delete(stale._id);
    await ctx.db.insert("destinationSights", {
      destinationKey: args.destinationKey,
      sights: args.sights,
      createdAt: Date.now(),
    });
    return null;
  },
});
