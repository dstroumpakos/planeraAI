import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

// ── Public queries (used at build time via ConvexHttpClient) ──

/** List all published itineraries (for SSG build) */
export const listAll = query({
    args: {},
    returns: v.any(),
    handler: async (ctx) => {
        return await ctx.db.query("publishedItineraries").collect();
    },
});

/** Get a single published itinerary by slug */
export const getBySlug = query({
    args: { slug: v.string() },
    returns: v.any(),
    handler: async (ctx, { slug }) => {
        return await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .unique();
    },
});

/** List itineraries for a specific destination */
export const listByDestination = query({
    args: { destination: v.string() },
    returns: v.any(),
    handler: async (ctx, { destination }) => {
        return await ctx.db
            .query("publishedItineraries")
            .withIndex("by_destination", (q) => q.eq("destination", destination))
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
        days: v.any(),
        practicalInfo: v.any(),
        faqs: v.array(v.object({ question: v.string(), answer: v.string() })),
        relatedItineraries: v.array(v.string()),
        sourceTripCount: v.float64(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q) => q.eq("slug", args.slug))
            .unique();

        const data = {
            ...args,
            lastAggregated: Date.now(),
        };

        if (existing) {
            await ctx.db.patch(existing._id, data);
        } else {
            await ctx.db.insert("publishedItineraries", data);
        }
        return null;
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
