import { authQuery, authMutation } from "./functions";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ACHIEVEMENT_DEFINITIONS } from "./helpers/achievements";

// Get user's achievements + all definitions with locked/unlocked state
export const getUserAchievements = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;

    const unlocked = await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    const unlockedMap = new Map(unlocked.map((a: any) => [a.achievementId, a]));
    const unseenCount = unlocked.filter((a: any) => !a.seen).length;

    const achievements = ACHIEVEMENT_DEFINITIONS.map((def) => {
      const record: any = unlockedMap.get(def.id);
      return {
        ...def,
        unlocked: !!record,
        unlockedAt: record?.unlockedAt || null,
        seen: record?.seen ?? true,
      };
    });

    return {
      achievements,
      totalUnlocked: unlocked.length,
      totalAvailable: ACHIEVEMENT_DEFINITIONS.length,
      unseenCount,
    };
  },
});

// Mark achievement as seen (clears "new" indicator)
export const markAchievementSeen = authMutation({
  args: { achievementId: v.string() },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const existing = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_and_achievement", (q: any) =>
        q.eq("userId", userId).eq("achievementId", args.achievementId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { seen: true });
    }
  },
});

// Mark all unseen achievements as seen
export const markAllSeen = authMutation({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const unseen = await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    for (const a of unseen) {
      if (!a.seen) {
        await ctx.db.patch(a._id, { seen: true });
      }
    }
  },
});

// Internal mutation — called by triggers after key events
export const checkAndUnlock = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = args;

    // Gather stats for evaluation
    const allTrips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const completedTrips = allTrips.filter((t) => t.status === "completed");

    // Explorer & Globetrotter achievements require server-side GPS verification
    const verifiedTrips = completedTrips.filter((t: any) => t.locationVerified === true);

    const countriesSet = new Set<string>();
    for (const trip of verifiedTrips) {
      const dest = trip.destination || "";
      const parts = dest.split(",").map((s: string) => s.trim());
      if (parts.length >= 2) countriesSet.add(parts[parts.length - 1]);
      if (trip.destinations && Array.isArray(trip.destinations)) {
        for (const d of trip.destinations) {
          if (d.country) countriesSet.add(d.country);
        }
      }
    }

    const flightBookings = await ctx.db
      .query("flightBookings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const confirmedBookings = flightBookings.filter((b) => b.status === "confirmed");

    const insights = await ctx.db
      .query("insights")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const approvedInsights = insights.filter(
      (i) => i.moderationStatus === "approved" || i.moderationStatus === undefined
    );
    const totalLikesReceived = insights.reduce((sum, i) => sum + (i.likes || 0), 0);

    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerId", userId))
      .collect();
    const completedReferrals = referrals.filter((r) => r.status === "completed" || r.status === "rewarded");

    const streakDoc = await ctx.db
      .query("userStreaks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const isSubscriber =
      userPlan?.plan === "premium" && userPlan?.subscriptionExpiresAt && userPlan.subscriptionExpiresAt > Date.now()
        ? 1
        : 0;

    // Build stat map
    const statMap: Record<string, number> = {
      totalTrips: verifiedTrips.length,
      totalCountries: countriesSet.size,
      totalFlightsBooked: confirmedBookings.length,
      insightsShared: approvedInsights.length,
      totalLikesReceived,
      totalReferrals: completedReferrals.length,
      longestStreak: streakDoc?.longestStreak || 0,
      isSubscriber,
    };

    // Get already unlocked achievements
    const existing = await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const existingIds = new Set(existing.map((a) => a.achievementId));

    // Check each achievement definition
    const newlyUnlocked: string[] = [];
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      if (existingIds.has(def.id)) continue;
      const value = statMap[def.statField] || 0;
      if (value >= def.threshold) {
        await ctx.db.insert("userAchievements", {
          userId,
          achievementId: def.id,
          unlockedAt: Date.now(),
          seen: false,
        });
        newlyUnlocked.push(def.id);
      }
    }

    return newlyUnlocked;
  },
});
