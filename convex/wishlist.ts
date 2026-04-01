import { authQuery, authMutation } from "./functions";
import { v } from "convex/values";

const FREE_WISHLIST_LIMIT = 5;

// Get user's wishlist
export const getWishlist = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const items = await ctx.db
      .query("wishlist")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    // Check premium
    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    const isPremium =
      userPlan?.plan === "premium" &&
      userPlan?.subscriptionExpiresAt &&
      userPlan.subscriptionExpiresAt > Date.now();

    return {
      items: items.sort((a: any, b: any) => b.addedAt - a.addedAt),
      count: items.length,
      limit: isPremium ? null : FREE_WISHLIST_LIMIT,
      isPremium,
    };
  },
});

// Check if destination is in wishlist
export const isInWishlist = authQuery({
  args: { destination: v.string() },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const items = await ctx.db
      .query("wishlist")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    return items.some(
      (i: any) => i.destination.toLowerCase() === args.destination.toLowerCase()
    );
  },
});

// Add to wishlist
export const addToWishlist = authMutation({
  args: {
    destination: v.string(),
    country: v.optional(v.string()),
    notes: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("dream"), v.literal("planned"), v.literal("someday"))),
    image: v.optional(v.object({
      url: v.string(),
      photographer: v.optional(v.string()),
    })),
  },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;

    // Check for duplicate
    const existing = await ctx.db
      .query("wishlist")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const isDuplicate = existing.some(
      (i: any) => i.destination.toLowerCase() === args.destination.toLowerCase()
    );
    if (isDuplicate) {
      return { success: false, reason: "already_in_wishlist" };
    }

    // Check free limit
    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    const isPremium =
      userPlan?.plan === "premium" &&
      userPlan?.subscriptionExpiresAt &&
      userPlan.subscriptionExpiresAt > Date.now();

    if (!isPremium && existing.length >= FREE_WISHLIST_LIMIT) {
      return { success: false, reason: "limit_reached" };
    }

    await ctx.db.insert("wishlist", {
      userId,
      destination: args.destination,
      country: args.country,
      notes: args.notes,
      priority: args.priority || "someday",
      image: args.image,
      dealAlertEnabled: false,
      addedAt: Date.now(),
    });

    return { success: true };
  },
});

// Remove from wishlist
export const removeFromWishlist = authMutation({
  args: { id: v.id("wishlist") },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const item = await ctx.db.get(args.id);
    if (!item || item.userId !== userId) return;

    // Clean up watchedDestinations entry if deal alerts were enabled
    if (item.dealAlertEnabled) {
      const existingWatch = await ctx.db
        .query("watchedDestinations")
        .withIndex("by_user_destination", (q: any) =>
          q.eq("userId", userId).eq("destination", item.destination.toLowerCase())
        )
        .unique();
      if (existingWatch) {
        await ctx.db.delete(existingWatch._id);
      }
    }

    await ctx.db.delete(args.id);
  },
});

// Update wishlist item
export const updateWishlistItem = authMutation({
  args: {
    id: v.id("wishlist"),
    notes: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("dream"), v.literal("planned"), v.literal("someday"))),
    dealAlertEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const item = await ctx.db.get(args.id);
    if (!item || item.userId !== userId) return;

    const updates: any = {};
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dealAlertEnabled !== undefined) updates.dealAlertEnabled = args.dealAlertEnabled;

    await ctx.db.patch(args.id, updates);

    // Sync with watchedDestinations if deal alerts toggled
    if (args.dealAlertEnabled !== undefined) {
      const existingWatch = await ctx.db
        .query("watchedDestinations")
        .withIndex("by_user_destination", (q: any) =>
          q.eq("userId", userId).eq("destination", item.destination.toLowerCase())
        )
        .unique();

      if (args.dealAlertEnabled && !existingWatch) {
        await ctx.db.insert("watchedDestinations", {
          userId,
          destination: item.destination.toLowerCase(),
          createdAt: Date.now(),
        });
      } else if (!args.dealAlertEnabled && existingWatch) {
        await ctx.db.delete(existingWatch._id);
      }
    }
  },
});

// Get wishlist destinations for deal matching (lightweight query)
export const getWishlistDestinations = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const items = await ctx.db
      .query("wishlist")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    return items.map((i: any) => i.destination.toLowerCase());
  },
});
