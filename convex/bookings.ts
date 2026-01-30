import { v } from "convex/values";
import { authQuery, authMutation } from "./functions";

export const trackClick = authMutation({
  args: {
    tripId: v.id("trips"),
    type: v.string(),
    item: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("bookings", {
      userId: ctx.user._id,
      tripId: args.tripId,
      type: args.type,
      item: args.item,
      url: args.url,
      status: "clicked",
      clickedAt: Date.now(),
    });
  },
});

export const getMyBookings = authQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("bookings")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .order("desc")
      .collect();
  },
});
