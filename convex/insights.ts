import { v } from "convex/values";
import { authMutation, authQuery } from "./functions";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Get user's completed trips (trips where endDate has passed)
export const getCompletedTrips = authQuery({
    args: { token: v.string() },
    returns: v.array(v.object({
        _id: v.id("trips"),
        destination: v.string(),
        startDate: v.float64(),
        endDate: v.float64(),
        travelers: v.float64(),
    })),
    handler: async (ctx: any) => {
        if (!ctx.user) {
            return [];
        }

        const userId = ctx.user._id;
        const now = Date.now();
        
        // Get dismissed trips
        const dismissedTripsData = await ctx.db
            .query("dismissedTrips")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();
        
        const dismissedTripIds = new Set(dismissedTripsData.map((d: any) => d.tripId));
        
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();

        // Filter to only completed trips (endDate has passed) and not dismissed
        const completedTrips: Array<{
             _id: Id<"trips">;
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
                    // V1: Use travelerCount as primary, fallback to travelers, default to 1
                    travelers: trip.travelerCount ?? trip.travelers ?? 1,
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
        token: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx: any, args: any) => {
        if (!ctx.user) {
            return false;
        }

        const userId = ctx.user._id;
        const now = Date.now();
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
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

// Get user's own insights
export const getMyInsights = authQuery({
    args: { token: v.string() },
    handler: async (ctx: any) => {
        if (!ctx.user) {
            return [];
        }

        const insights = await ctx.db
            .query("insights")
            .filter((q: any) => q.eq(q.field("userId"), ctx.user._id))
            .order("desc")
            .take(20);

        return insights;
    },
});

// Traveler insights functions
export const list: any = authQuery({
    args: {
        destination: v.optional(v.string()),
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx: any, args: any) => {
        if (args.destination) {
            const destinationId = args.destination.toLowerCase().replace(/\s+/g, '-');
            return await ctx.db
                .query("insights")
                .withIndex("by_destination", (q: any) => q.eq("destinationId", destinationId))
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
    handler: async (ctx: any, args: any) => {
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
    handler: async (ctx: any, args: any) => {
        const insight = await ctx.db.get(args.insightId);
        if (!insight) {
            throw new Error("Insight not found");
        }

        // Check if already liked
        const existingLike = await ctx.db
            .query("insightLikes")
            .withIndex("by_user_and_insight", (q: any) => 
                q.eq("userId", ctx.user.userId).eq("insightId", args.insightId)
            )
            .first();
        
        if (existingLike) {
            // Already liked, just return
            return;
        }

        // Create like record
        await ctx.db.insert("insightLikes", {
            userId: ctx.user.userId,
            insightId: args.insightId,
            likedAt: Date.now(),
        });

        // Increment like count
        await ctx.db.patch(args.insightId, {
            likes: insight.likes + 1,
        });
    },
});

export const unlike = authMutation({
    args: {
        insightId: v.id("insights"),
    },
    handler: async (ctx: any, args: any) => {
        const insight = await ctx.db.get(args.insightId);
        if (!insight) {
            throw new Error("Insight not found");
        }

        // Find existing like
        const existingLike = await ctx.db
            .query("insightLikes")
            .withIndex("by_user_and_insight", (q: any) => 
                q.eq("userId", ctx.user.userId).eq("insightId", args.insightId)
            )
            .first();
        
        if (!existingLike) {
            // Not liked, just return
            return;
        }

        // Delete like record
        await ctx.db.delete(existingLike._id);

        // Decrement like count
        await ctx.db.patch(args.insightId, {
            likes: Math.max(0, insight.likes - 1),
        });
    },
});

// Get IDs of insights the current user has liked
export const getMyLikedInsightIds = authQuery({
    args: {},
    handler: async (ctx: any, args: any) => {
        if (!ctx.user) {
            return [];
        }

        const likes = await ctx.db
            .query("insightLikes")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .collect();

        return likes.map((like: any) => like.insightId);
    },
});

export const dismissTrip = authMutation({
    args: {
        tripId: v.id("trips"),
    },
    handler: async (ctx: any, args: any) => {
        if (!ctx.user) {
            throw new Error("Unauthorized");
        }

        // Check if already dismissed
        const existing = await ctx.db
            .query("dismissedTrips")
            .withIndex("by_user_and_trip", (q: any) => 
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

// Get insights for a specific destination (anonymously - no user info exposed)
export const getDestinationInsights = query({
    args: { destination: v.string() },
    handler: async (ctx: any, args: any) => {
        // Normalize destination to lowercase slug
        const destinationId = args.destination.toLowerCase().replace(/\s+/g, '-');
        
        const insights = await ctx.db
            .query("insights")
            .withIndex("by_destination", (q: any) =>
                q.eq("destinationId", destinationId)
            )
            .order("desc")
            .take(15);
        
        // Filter approved or pending insights (not rejected/flagged)
        const filtered = insights.filter((insight: any) => 
            !insight.moderationStatus || 
            insight.moderationStatus === "approved" || 
            insight.moderationStatus === "pending"
        ).slice(0, 10);
        
        // Return anonymized insights (no userId or personal info)
        return filtered.map((insight: any) => ({
            _id: insight._id,
            content: insight.content,
            category: insight.category,
            verified: insight.verified,
            likes: insight.likes,
            createdAt: insight.createdAt,
        }));
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
    handler: async (ctx: any, args: any) => {
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
