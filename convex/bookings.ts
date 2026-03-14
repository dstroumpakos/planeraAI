import { v } from "convex/values";
import { authQuery, authMutation } from "./functions";

export const trackClick = authMutation({
  args: {
    tripId: v.id("trips"),
    type: v.string(),
    item: v.string(),
    url: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    await ctx.db.insert("bookings", {
      userId: ctx.user.userId,
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
  handler: async (ctx: any) => {
    return await ctx.db
      .query("bookings")
      .withIndex("by_user", (q:any) => q.eq("userId", ctx.user.userId))
      .order("desc")
      .collect();
  },
});
