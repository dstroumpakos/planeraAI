import { authQuery, authMutation } from "./functions";
import { internal } from "./_generated/api";

// Get current streak info
export const getStreak = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const streak = await ctx.db
      .query("userStreaks")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();

    if (!streak) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        totalCheckIns: 0,
        checkedInToday: false,
        hasStreakShield: false,
      };
    }

    const today = getTodayString();
    const checkedInToday = streak.lastCheckInDate === today;

    // Check premium for streak shield
    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    const isPremium =
      userPlan?.plan === "premium" &&
      userPlan?.subscriptionExpiresAt &&
      userPlan.subscriptionExpiresAt > Date.now();

    // Shield available if premium and not used in last 7 days
    const shieldAvailable =
      isPremium &&
      (!streak.streakShieldUsedAt ||
        Date.now() - streak.streakShieldUsedAt > 7 * 24 * 60 * 60 * 1000);

    return {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      totalCheckIns: streak.totalCheckIns,
      checkedInToday,
      hasStreakShield: shieldAvailable,
      lastCheckInDate: streak.lastCheckInDate,
    };
  },
});

// Auto check-in — called on app open
export const checkIn = authMutation({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const today = getTodayString();

    const streak = await ctx.db
      .query("userStreaks")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();

    if (!streak) {
      // First ever check-in
      await ctx.db.insert("userStreaks", {
        userId,
        currentStreak: 1,
        longestStreak: 1,
        lastCheckInDate: today,
        totalCheckIns: 1,
      });
      // Trigger achievement check
      await ctx.scheduler.runAfter(0, (internal as any).achievements.checkAndUnlock, { userId });
      return { newStreak: 1, isNewRecord: true };
    }

    // Already checked in today
    if (streak.lastCheckInDate === today) {
      return { newStreak: streak.currentStreak, isNewRecord: false };
    }

    const yesterday = getYesterdayString();
    let newCurrentStreak: number;
    let shieldUsed = false;

    if (streak.lastCheckInDate === yesterday) {
      // Consecutive day — increment
      newCurrentStreak = streak.currentStreak + 1;
    } else {
      // Missed at least one day — check streak shield
      const daysBefore = getDaysBetween(streak.lastCheckInDate, today);

      const userPlan = await ctx.db
        .query("userPlans")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .unique();
      const isPremium =
        userPlan?.plan === "premium" &&
        userPlan?.subscriptionExpiresAt &&
        userPlan.subscriptionExpiresAt > Date.now();

      const shieldAvailable =
        isPremium &&
        daysBefore === 2 && // Only missed exactly 1 day
        (!streak.streakShieldUsedAt ||
          Date.now() - streak.streakShieldUsedAt > 7 * 24 * 60 * 60 * 1000);

      if (shieldAvailable) {
        // Use streak shield — preserve streak
        newCurrentStreak = streak.currentStreak + 1;
        shieldUsed = true;
      } else {
        // Reset streak
        newCurrentStreak = 1;
      }
    }

    const newLongest = Math.max(streak.longestStreak, newCurrentStreak);
    const isNewRecord = newCurrentStreak > streak.longestStreak;

    const patch: any = {
      currentStreak: newCurrentStreak,
      longestStreak: newLongest,
      lastCheckInDate: today,
      totalCheckIns: streak.totalCheckIns + 1,
    };
    if (shieldUsed) {
      patch.streakShieldUsedAt = Date.now();
    }

    await ctx.db.patch(streak._id, patch);

    // Trigger achievement check for streak milestones
    await ctx.scheduler.runAfter(0, (internal as any).achievements.checkAndUnlock, { userId });

    return { newStreak: newCurrentStreak, isNewRecord };
  },
});

// --- Date helpers ---
function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getYesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDaysBetween(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1 + "T00:00:00Z");
  const d2 = new Date(dateStr2 + "T00:00:00Z");
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}
