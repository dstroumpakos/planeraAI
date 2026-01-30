import { v } from "convex/values";
import { authMutation, authQuery } from "./functions";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";

// Get user's completed trips (trips where endDate has passed)
export const getCompletedTrips = authQuery({
    args: {},
    returns: v.array(v.object({
        _id: v.id("trips"),
        destination: v.string(),
        startDate: v.float64(),
        endDate: v.float64(),
        travelers: v.float64(),
    })),
    handler: async (ctx) => {
        if (!ctx.user) {
            return [];
        }

        const userId = ctx.user._id;
        const now = Date.now();
        
        // Get dismissed trips
        const dismissedTripsData = await ctx.db
            .query("dismissedTrips")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();
        
        const dismissedTripIds = new Set(dismissedTripsData.map(d => d.tripId));
        
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();

        // Filter to only completed trips (endDate has passed) and not dismissed
        const completedTrips: Array<{
            _id: typeof trips[0]["_id"];
            destination: string;
            startDate: number;
            endDate: number;
            travelers: number;
        }> = [];

        for (const trip of trips) {
            if (trip.endDate < now && trip.status === "completed" && !dismissedTripIds.has(trip._id)) {
                completedTrips.push({
                    _id: trip._id,
                    destination: trip.destination,
                    startDate: trip.startDate,
                    endDate: trip.endDate,
                    travelers: trip.travelers,
                });
            }
        }

        return completedTrips;
    },
});

// Check if user has a completed trip to a specific destination
export const hasCompletedTripTo = authQuery({
    args: {
        destination: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        if (!ctx.user) {
            return false;
        }

        const userId = ctx.user._id;
        const now = Date.now();
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();

        // Check if any completed trip matches the destination
        for (const trip of trips) {
            if (
                trip.endDate < now && 
                trip.status === "completed" &&
                trip.destination.toLowerCase().includes(args.destination.toLowerCase())
            ) {
                return true;
            }
        }

        return false;
    },
});

// Traveler insights functions
export const list = authQuery({
    args: {
        destination: v.optional(v.string()),
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        if (args.destination) {
            const destinationId = args.destination.toLowerCase().replace(/\s+/g, '-');
            return await ctx.db
                .query("insights")
                .withIndex("by_destination", (q) => q.eq("destinationId", destinationId))
                .order("desc")
                .paginate(args.paginationOpts);
        } else {
            return await ctx.db
                .query("insights")
                .order("desc")
                .paginate(args.paginationOpts);
        }
    },
});

export const create = authMutation({
    args: {
        destination: v.string(),
        content: v.string(),
        category: v.union(
            v.literal("food"),
            v.literal("transport"),
            v.literal("neighborhoods"),
            v.literal("timing"),
            v.literal("hidden_gem"),
            v.literal("avoid"),
            v.literal("other")
        ),
        verified: v.boolean(),
    },
    handler: async (ctx, args) => {
        if (!ctx.user) {
            throw new Error("Unauthorized");
        }

        const destinationId = args.destination.toLowerCase().replace(/\s+/g, '-');

        const insightId = await ctx.db.insert("insights", {
            userId: ctx.user._id,
            destination: args.destination,
            destinationId,
            content: args.content,
            category: args.category,
            verified: args.verified,
            likes: 0,
            moderationStatus: "pending",
            createdAt: Date.now(),
        });

        return insightId;
    },
});

export const like = authMutation({
    args: {
        insightId: v.id("insights"),
    },
    handler: async (ctx, args) => {
        const insight = await ctx.db.get(args.insightId);
        if (!insight) {
            throw new Error("Insight not found");
        }

        await ctx.db.patch(args.insightId, {
            likes: insight.likes + 1,
        });
    },
});

export const dismissTrip = authMutation({
    args: {
        tripId: v.id("trips"),
    },
    handler: async (ctx, args) => {
        if (!ctx.user) {
            throw new Error("Unauthorized");
        }

        // Check if already dismissed
        const existing = await ctx.db
            .query("dismissedTrips")
            .withIndex("by_user_and_trip", (q) => 
                q.eq("userId", ctx.user._id).eq("tripId", args.tripId)
            )
            .unique();

        if (!existing) {
            await ctx.db.insert("dismissedTrips", {
                userId: ctx.user._id,
                tripId: args.tripId,
                dismissedAt: Date.now(),
            });
        }
    },
});

// Get insights for a specific destination (anonymously)
export const getDestinationInsights = query({
    args: { destination: v.string() },
    returns: v.array(v.object({
        _id: v.id("insights"),
        _creationTime: v.float64(),
        userId: v.string(),
        destination: v.optional(v.string()),
        destinationId: v.optional(v.string()),
        tripId: v.optional(v.id("trips")),
        content: v.string(),
        category: v.union(
            v.literal("food"),
            v.literal("transport"),
            v.literal("neighborhoods"),
            v.literal("timing"),
            v.literal("hidden_gem"),
            v.literal("avoid"),
            v.literal("other")
        ),
        verified: v.boolean(),
        likes: v.float64(),
        moderationStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("flagged")
        )),
        image: v.optional(v.object({
            url: v.string(),
            photographer: v.optional(v.string()),
            attribution: v.optional(v.string()),
        })),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })),
    handler: async (ctx, args) => {
        // Normalize destination to lowercase slug
        const destinationId = args.destination.toLowerCase().replace(/\s+/g, '-');
        
        const insights = await ctx.db
            .query("insights")
            .withIndex("by_destination", (q) =>
                q.eq("destinationId", destinationId)
            )
            .order("desc")
            .take(10);
        
        // Filter approved insights in memory
        return insights.filter(insight => insight.moderationStatus === "approved");
    },
});

export const shareInsight = authMutation({
    args: {
        destination: v.string(),
        tripId: v.optional(v.id("trips")),
        content: v.string(),
        category: v.union(
            v.literal("food"),
            v.literal("transport"),
            v.literal("neighborhoods"),
            v.literal("timing"),
            v.literal("hidden_gem"),
            v.literal("avoid"),
            v.literal("other")
        ),
        image: v.optional(v.object({
            url: v.string(),
            photographer: v.optional(v.string()),
            attribution: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args) => {
        const destinationId = args.destination.toLowerCase().replace(/\\s+/g, '-');
        
        await ctx.db.insert("insights", {
            userId: ctx.user._id,
            destination: args.destination,
            destinationId,
            tripId: args.tripId,
            content: args.content,
            category: args.category,
            verified: false,
            likes: 0,
            moderationStatus: "pending",
            image: args.image,
            createdAt: Date.now(),
        });
    },
});
