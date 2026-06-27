import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

// ── Public queries (used at build time via ConvexHttpClient) ──

/** List all published itineraries (for SSG build). Drafts are never served. */
export const listAll = query({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        const all = await ctx.db.query("publishedItineraries").collect();
        // Only serve approved rows. `status === undefined` = legacy row → treat as
        // published. Drafts and rejected rows are never served to the website.
        return all.filter((it) => it.status !== "draft" && it.status !== "rejected");
    },
});

/** Get a single published itinerary by slug. Returns null for draft/rejected. */
export const getBySlug = query({
    args: { slug: v.string() },
    returns: v.any(),
    handler: async (ctx, { slug }) => {
        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
        if (row && (row.status === "draft" || row.status === "rejected")) return null;
        return row;
    },
});

/** List itineraries for a specific destination. Draft/rejected never served. */
export const listByDestination = query({
    args: { destination: v.string() },
    returns: v.any(),
    handler: async (ctx, { destination }) => {
        const rows = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_destination", (q) => q.eq("destination", destination))
            .collect();
        return rows.filter((it) => it.status !== "draft" && it.status !== "rejected");
    },
});

/** Review queue: list all draft itineraries awaiting approval. */
export const listDrafts = query({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        return await ctx.db
            .query("publishedItineraries")
            .withIndex("by_status", (q) => q.eq("status", "draft"))
            .collect();
    },
});

/** List all unique destinations with their itinerary counts */
export const listDestinations = query({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        const all = await ctx.db.query("publishedItineraries").collect();
        const map = new Map<string, { name: string; country: string; continent: string; count: number }>();
        for (const it of all) {
            const key = it.destination.toLowerCase();
            if (map.has(key)) {
                map.get(key)!.count++;
            } else {
                map.set(key, {
                    name: it.destination,
                    country: it.country,
                    continent: it.continent,
                    count: 1,
                });
            }
        }
        return Array.from(map.values());
    },
});

// ── Internal mutations (used by aggregation action) ──

/** Upsert a published itinerary */
export const upsert = internalMutation({
    args: {
        slug: v.string(),
        destination: v.string(),
        country: v.string(),
        continent: v.string(),
        durationDays: v.float64(),
        title: v.string(),
        metaDescription: v.string(),
        intro: v.string(),
        budgetLevel: v.string(),
        budgetPerDayEur: v.float64(),
        bestFor: v.array(v.string()),
        bestSeason: v.string(),
        heroImage: v.string(),
        heroImageData: v.optional(v.any()),
        days: v.any(),
        practicalInfo: v.any(),
        faqs: v.array(v.object({ question: v.string(), answer: v.string() })),
        relatedItineraries: v.array(v.string()),
        sourceTripCount: v.float64(),
        // Status to use when inserting a NEW row. Defaults to "draft" (approval gate).
        status: v.optional(v.union(v.literal("draft"), v.literal("published"))),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { status: requestedStatus, ...fields } = args;
        const existing = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", fields.slug))
            .unique();

        if (existing) {
            // Re-aggregation: refresh content but PRESERVE the existing approval
            // status — re-publishing newer trips must never silently un-publish
            // content that was already approved.
            await ctx.db.patch(existing._id, { ...fields, lastAggregated: Date.now() });
        } else {
            await ctx.db.insert("publishedItineraries", {
                ...fields,
                lastAggregated: Date.now(),
                status: requestedStatus ?? "draft",
            });
        }
        return null;
    },
});

/** Replace the stored days array (used by the affiliate-link backfill). */
export const setDays = internalMutation({
    args: { slug: v.string(), days: v.any() },
    returns: v.null(),
    handler: async (ctx, { slug, days }) => {
        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
        if (row) await ctx.db.patch(row._id, { days });
        return null;
    },
});

/** Store the Unsplash hero image (+ attribution) and optionally fix country. */
export const setHeroImage = internalMutation({
    args: {
        slug: v.string(),
        heroImage: v.string(),
        heroImageData: v.optional(v.any()),
        country: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, { slug, heroImage, heroImageData, country }) => {
        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
        if (!row) return null;
        const patch: any = { heroImage, heroImageData };
        if (country !== undefined) patch.country = country;
        await ctx.db.patch(row._id, patch);
        return null;
    },
});

/** Internal: every published itinerary row (incl. drafts) for backfills. */
export const listAllRows = internalQuery({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        return await ctx.db.query("publishedItineraries").collect();
    },
});

/** Store per-locale translations for a published itinerary (overwrites the map). */
export const setTranslations = internalMutation({
    args: { slug: v.string(), translations: v.any() },
    returns: v.null(),
    handler: async (ctx, { slug, translations }) => {
        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
        if (row) await ctx.db.patch(row._id, { translations });
        return null;
    },
});

/** Approve a draft itinerary → make it live on the website. */
export const approveItinerary = internalMutation({
    args: { slug: v.string() },
    returns: v.boolean(),
    handler: async (ctx, { slug }) => {
        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
        if (!row) return false;
        await ctx.db.patch(row._id, { status: "published" });
        return true;
    },
});

// ── Internal queries (used by aggregation action) ──

/** Get aggregation record for a destination+duration key */
export const getAggregation = internalQuery({
    args: { destinationKey: v.string() },
    returns: v.any(),
    handler: async (ctx, { destinationKey }) => {
        return await ctx.db
            .query("tripAggregations")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
            .unique();
    },
});

/** Upsert aggregation record when a trip completes */
export const upsertAggregation = internalMutation({
    args: {
        destinationKey: v.string(),
        destination: v.string(),
        country: v.optional(v.string()),
        durationDays: v.float64(),
        tripId: v.id("trips"),
    },
    returns: v.object({ count: v.float64(), isNew: v.boolean() }),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("tripAggregations")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", args.destinationKey))
            .unique();

        if (existing) {
            // Don't add duplicate trip IDs
            const tripIds = existing.tripIds.includes(args.tripId)
                ? existing.tripIds
                : [...existing.tripIds, args.tripId];
            const count = tripIds.length;
            await ctx.db.patch(existing._id, {
                tripIds,
                count,
                lastUpdated: Date.now(),
            });
            return { count, isNew: false };
        } else {
            await ctx.db.insert("tripAggregations", {
                destinationKey: args.destinationKey,
                destination: args.destination,
                country: args.country,
                durationDays: args.durationDays,
                tripIds: [args.tripId],
                count: 1,
                lastUpdated: Date.now(),
            });
            return { count: 1, isNew: true };
        }
    },
});

/** Get trip data for aggregation (internal) */
export const getTripsForAggregation = internalQuery({
    args: { tripIds: v.array(v.id("trips")) },
    returns: v.any(),
    handler: async (ctx, { tripIds }) => {
        const trips = [];
        for (const id of tripIds) {
            const trip = await ctx.db.get(id);
            if (trip && trip.status === "completed" && trip.itinerary) {
                trips.push(trip);
            }
        }
        return trips;
    },
});

/** List all published itinerary slugs for a destination (for related links) */
export const listSlugsByDestination = internalQuery({
    args: { destination: v.string() },
    returns: v.array(v.string()),
    handler: async (ctx, { destination }) => {
        const results = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_destination", (q) => q.eq("destination", destination))
            .collect();
        return results.map((r) => r.slug);
    },
});

/**
 * One-off backfill: populate `tripAggregations` from existing completed trips
 * so the publish pipeline has history to work with immediately (recording in
 * writeBaseItinerary only captures trips completed from now on). Idempotent —
 * re-running won't add duplicate tripIds. Safe to call manually via
 * `npx convex run publishedItineraries:backfillAggregations`.
 */
export const backfillAggregations = internalMutation({
    args: {},
    returns: v.object({ scannedTrips: v.float64(), keys: v.float64() }),
    handler: async (ctx) => {
        const completed = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) => q.eq("status", "completed"))
            .collect();

        // Group trips by destinationKey in memory first (same derivation as
        // writeBaseItinerary), then upsert each aggregation once.
        const groups = new Map<
            string,
            { destination: string; country?: string; durationDays: number; tripIds: any[] }
        >();
        for (const trip of completed) {
            const raw = (trip.destination || "").trim();
            const city = raw.split(",")[0].trim();
            const citySlug = city
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            if (!citySlug) continue;
            const country = raw.includes(",")
                ? raw.slice(raw.indexOf(",") + 1).trim()
                : undefined;
            const durationDays = Math.max(
                1,
                Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24)),
            );
            const key = `${citySlug}-${durationDays}`;
            if (!groups.has(key)) {
                groups.set(key, { destination: city, country, durationDays, tripIds: [] });
            }
            groups.get(key)!.tripIds.push(trip._id);
        }

        for (const [destinationKey, g] of groups) {
            const existing = await ctx.db
                .query("tripAggregations")
                .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
                .unique();
            if (existing) {
                const merged = Array.from(new Set([...existing.tripIds, ...g.tripIds]));
                await ctx.db.patch(existing._id, {
                    tripIds: merged,
                    count: merged.length,
                    lastUpdated: Date.now(),
                });
            } else {
                await ctx.db.insert("tripAggregations", {
                    destinationKey,
                    destination: g.destination,
                    country: g.country,
                    durationDays: g.durationDays,
                    tripIds: g.tripIds,
                    count: g.tripIds.length,
                    lastUpdated: Date.now(),
                });
            }
        }

        return { scannedTrips: completed.length, keys: groups.size };
    },
});

/**
 * Cron candidate-finder: destinationKeys that have hit the trip threshold and
 * are either never published or have new trips since the last aggregation.
 */
export const listAggregationsToPublish = internalQuery({
    args: { threshold: v.float64() },
    returns: v.array(v.string()),
    handler: async (ctx, { threshold }) => {
        const aggs = await ctx.db.query("tripAggregations").collect();
        const keys: string[] = [];
        for (const agg of aggs) {
            if (agg.count < threshold) continue;
            const finalSlug = `${agg.destinationKey.replace(/\s+/g, "-").toLowerCase()}-days`;
            const published = await ctx.db
                .query("publishedItineraries")
                .withIndex("by_slug", (q) => q.eq("slug", finalSlug))
                .unique();
            // Never regenerate a rejected itinerary — rejection is sticky.
            if (published && published.status === "rejected") continue;
            // Publish if never aggregated, or new trips arrived since last publish.
            if (!published || agg.lastUpdated > published.lastAggregated) {
                keys.push(agg.destinationKey);
            }
        }
        return keys;
    },
});
