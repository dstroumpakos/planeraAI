import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Query to get top sights for a trip
export const getTopSights = query({
    args: { tripId: v.id("trips") },
    returns: v.union(
        v.null(),
        v.object({
            _id: v.id("destinationSights"),
            _creationTime: v.float64(),
            tripId: v.optional(v.id("trips")),
            destinationKey: v.string(),
            sights: v.array(v.object({
                name: v.string(),
                shortDescription: v.string(),
                neighborhoodOrArea: v.optional(v.string()),
                bestTimeToVisit: v.optional(v.string()),
                estDurationHours: v.optional(v.string()),
                latitude: v.optional(v.float64()),
                longitude: v.optional(v.float64()),
            })),
            createdAt: v.float64(),
        })
    ),
    handler: async (ctx, args) => {
        // First try to find sights for this specific trip
        const tripSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
            .first();
        
        if (tripSights) return tripSights;
        
        // If no trip-specific sights, try to find cached sights for the destination
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;
        
        const destinationKey = normalizeDestinationKey(trip.destination);
        // Newest matching row wins — see getDestinationSights for why .first()
        // (oldest) can be shadowed by a stale row sharing this key.
        const cachedSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
            .order("desc")
            .first();

        // Return cached sights if they exist, are recent (30 days), and have a full set (15+)
        if (cachedSights) {
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            if (cachedSights.createdAt > thirtyDaysAgo && cachedSights.sights.length >= 15) {
                return cachedSights;
            }
        }
        
        return null;
    },
});

// Mutation to trigger sight generation (called from frontend)
export const generateTopSights = mutation({
    args: { tripId: v.id("trips") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        
        // Delete existing sights for this trip so we regenerate
        const existingSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
            .first();
        
        if (existingSights) {
            await ctx.db.delete(existingSights._id);
        }
        
        // Also clear destination-level cache so the action generates fresh
        const destinationKey = normalizeDestinationKey(trip.destination);
        const cachedSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
            .first();
        if (cachedSights) {
            await ctx.db.delete(cachedSights._id);
        }
        
        // Schedule the AI generation action
        await ctx.scheduler.runAfter(0, internal.sightsAction.generateSightsAction, {
            tripId: args.tripId,
            destination: trip.destination,
            language: trip.language || "en",
        });
        
        return null;
    },
});

// Internal mutation to check for cached sights
export const getCachedSights = internalMutation({
    args: { destinationKey: v.string() },
    returns: v.union(
        v.null(),
        v.object({
            sights: v.array(v.object({
                name: v.string(),
                shortDescription: v.string(),
                neighborhoodOrArea: v.optional(v.string()),
                bestTimeToVisit: v.optional(v.string()),
                estDurationHours: v.optional(v.string()),
                latitude: v.optional(v.float64()),
                longitude: v.optional(v.float64()),
            })),
        })
    ),
    handler: async (ctx, args) => {
        // Newest matching row wins — see getDestinationSights for why .first()
        // (oldest) can be shadowed by a stale row sharing this key.
        const cached = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", args.destinationKey))
            .order("desc")
            .first();

        if (!cached) return null;
        
        // Only use cache if recent (30 days) AND has a full set of sights (15+)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        if (cached.createdAt < thirtyDaysAgo || cached.sights.length < 15) return null;
        
        return { sights: cached.sights };
    },
});

// Internal mutation to save sights
export const saveSights = internalMutation({
    args: {
        tripId: v.id("trips"),
        destinationKey: v.string(),
        sights: v.array(v.object({
            name: v.string(),
            shortDescription: v.string(),
            neighborhoodOrArea: v.optional(v.string()),
            bestTimeToVisit: v.optional(v.string()),
            estDurationHours: v.optional(v.string()),
            latitude: v.optional(v.float64()),
            longitude: v.optional(v.float64()),
        })),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.insert("destinationSights", {
            tripId: args.tripId,
            destinationKey: args.destinationKey,
            sights: args.sights,
            createdAt: Date.now(),
        });
        return null;
    },
});

// ---- Destination-level sights (no trip needed; used by the preview screen) ----

const sightValidator = v.object({
    name: v.string(),
    shortDescription: v.string(),
    neighborhoodOrArea: v.optional(v.string()),
    bestTimeToVisit: v.optional(v.string()),
    estDurationHours: v.optional(v.string()),
    latitude: v.optional(v.float64()),
    longitude: v.optional(v.float64()),
});

/**
 * Public query: cached AI-generated sights for a destination string, no trip
 * required. Returns null when nothing recent is cached (the client then asks
 * the action to generate them). Mirrors the language-suffixed cache key used by
 * the generation action so each language reads its own set.
 */
export const getDestinationSights = query({
    args: { destination: v.string(), language: v.optional(v.string()) },
    returns: v.union(v.null(), v.object({ sights: v.array(sightValidator) })),
    handler: async (ctx, args) => {
        const destinationKey = destinationKeyWithLang(args.destination, args.language);
        // Read the NEWEST row for this key, not the oldest. Trip-level rows
        // (saveSights) and destination-level rows (saveDestinationSights) share
        // the same key space, and saveDestinationSights only prunes its own
        // (tripId-less) rows. A plain .first() returns the oldest match, so a
        // stale trip-linked row would shadow every freshly generated set and
        // this query would return null forever. .order("desc") picks the fresh
        // insert instead.
        const cached = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
            .order("desc")
            .first();
        if (!cached) return null;

        // Only serve recent, non-empty caches.
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        if (cached.createdAt < thirtyDaysAgo || cached.sights.length < 1) return null;
        return { sights: cached.sights };
    },
});

/** Save destination-level sights (no trip link), replacing any stale entry. */
export const saveDestinationSights = internalMutation({
    args: { destinationKey: v.string(), sights: v.array(sightValidator) },
    returns: v.null(),
    handler: async (ctx, args) => {
        // Drop any prior destination-level entry for this key so we don't pile up.
        const existing = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", args.destinationKey))
            .collect();
        for (const row of existing) {
            if (row.tripId === undefined) await ctx.db.delete(row._id);
        }
        await ctx.db.insert("destinationSights", {
            destinationKey: args.destinationKey,
            sights: args.sights,
            createdAt: Date.now(),
        });
        return null;
    },
});

// Helper to normalize destination to a cache key
function normalizeDestinationKey(destination: string): string {
    return destination
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Language-suffixed cache key, matching sightsAction.generateSightsAction:
 * English uses the bare key, other languages append "-<lang>".
 */
export function destinationKeyWithLang(destination: string, language?: string): string {
    const lang = language || "en";
    const base = normalizeDestinationKey(destination);
    return lang === "en" ? base : `${base}-${lang}`;
}