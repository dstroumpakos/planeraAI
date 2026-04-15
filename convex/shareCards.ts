import { query } from "./_generated/server";
import { v } from "convex/values";
import { authMutation } from "./functions";

/**
 * Update share card data on a trip record (photo, trip card ID).
 */
export const updateShareCardData = authMutation({
  args: {
    token: v.string(),
    tripId: v.id("trips"),
    shareCardPhoto: v.optional(
      v.object({
        url: v.string(),
        photographer: v.string(),
        photographerUsername: v.optional(v.string()),
      })
    ),
    tripCardId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const trip = await ctx.db.get(args.tripId);
    if (!trip) throw new Error("Trip not found");
    if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

    const updates: any = {};
    if (args.shareCardPhoto) {
      updates.shareCardPhoto = args.shareCardPhoto;
    }
    if (args.tripCardId) {
      updates.tripCardId = args.tripCardId;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.tripId, updates);
    }
  },
});

/**
 * Generate and store a unique trip card ID for the trip.
 * Returns the existing ID if one already exists.
 */
export const ensureTripCardId = authMutation({
  args: {
    token: v.string(),
    tripId: v.id("trips"),
    tripCardId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    const trip = await ctx.db.get(args.tripId);
    if (!trip) throw new Error("Trip not found");
    if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

    // If trip already has a card ID, return it
    if (trip.tripCardId) {
      return trip.tripCardId;
    }

    // Check uniqueness
    const existing = await ctx.db
      .query("trips")
      .withIndex("by_tripCardId", (q: any) => q.eq("tripCardId", args.tripCardId))
      .first();

    if (existing) {
      // Collision — caller should regenerate
      return null;
    }

    await ctx.db.patch(args.tripId, { tripCardId: args.tripCardId });
    return args.tripCardId;
  },
});

/**
 * Look up a trip by its share card ID (public — for deep links).
 */
export const getByTripCardId = query({
  args: { tripCardId: v.string() },
  handler: async (ctx, args) => {
    const trip = await ctx.db
      .query("trips")
      .withIndex("by_tripCardId", (q) => q.eq("tripCardId", args.tripCardId))
      .first();

    if (!trip) return null;

    // Return sanitized read-only view
    return {
      _id: trip._id,
      destination: trip.destination,
      origin: trip.origin,
      startDate: trip.startDate,
      endDate: trip.endDate,
      itinerary: trip.itinerary,
      interests: trip.interests,
      budgetTotal: trip.budgetTotal,
      travelerCount: trip.travelerCount,
      perPersonBudget: trip.perPersonBudget,
      tripType: trip.tripType,
      status: trip.status,
      tripCardId: trip.tripCardId,
      shareCardPhoto: trip.shareCardPhoto,
    };
  },
});
