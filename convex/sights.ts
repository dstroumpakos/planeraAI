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
        const cachedSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", destinationKey))
            .first();
        
        // Return cached sights if they exist and are recent (less than 30 days old)
        if (cachedSights) {
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            if (cachedSights.createdAt > thirtyDaysAgo) {
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
        
        // Check if we already have sights for this trip
        const existingSights = await ctx.db
            .query("destinationSights")
            .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
            .first();
        
        if (existingSights) {
            console.log("Sights already exist for this trip");
            return null;
        }
        
        // Schedule the AI generation action
        await ctx.scheduler.runAfter(0, internal.sightsAction.generateSightsAction, {
            tripId: args.tripId,
            destination: trip.destination,
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
            })),
        })
    ),
    handler: async (ctx, args) => {
        const cached = await ctx.db
            .query("destinationSights")
            .withIndex("by_destination_key", (q) => q.eq("destinationKey", args.destinationKey))
            .first();
        
        if (!cached) return null;
        
        // Check if recent (30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        if (cached.createdAt < thirtyDaysAgo) return null;
        
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

// Helper to normalize destination to a cache key
function normalizeDestinationKey(destination: string): string {
    return destination
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}