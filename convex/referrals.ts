import { authQuery, authMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";

// Get user's referral code (generates one on first call)
export const getMyReferralCode = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const settings = ctx.user; // already loaded by authQuery

    if (settings.referralCode) {
      return settings.referralCode;
    }

    // Code doesn't exist yet — can't create in a query.
    // Frontend should call generateReferralCode mutation first.
    return null;
  },
});

// Generate a referral code (mutation, since it writes)
export const generateReferralCode = authMutation({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const settings = ctx.user;

    if (settings.referralCode) {
      return settings.referralCode;
    }

    // Generate unique 8-char alphanumeric code
    const code = generateCode();

    // Verify uniqueness
    const existing = await ctx.db
      .query("referrals")
      .withIndex("by_code", (q: any) => q.eq("referralCode", code))
      .unique();
    // Extremely unlikely collision, but regenerate if needed
    const finalCode = existing ? generateCode() : code;

    await ctx.db.patch(settings._id, { referralCode: finalCode });
    return finalCode;
  },
});

// Get referral stats
export const getReferralStats = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q: any) => q.eq("referrerId", userId))
      .collect();

    const completed = referrals.filter(
      (r: any) => r.status === "completed" || r.status === "rewarded"
    );
    const pending = referrals.filter((r: any) => r.status === "pending");
    const rewarded = referrals.filter((r: any) => r.status === "rewarded");

    return {
      totalInvited: referrals.length,
      totalCompleted: completed.length,
      totalPending: pending.length,
      totalRewardsEarned: rewarded.length,
      referrals: referrals.map((r: any) => ({
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    };
  },
});

// Apply a referral code during signup — called by the new user
export const applyReferralCode = authMutation({
  args: { code: v.string() },
  handler: async (ctx: any, args: any) => {
    const userId = ctx.user.userId;
    const code = args.code.toUpperCase().trim();

    if (!code || code.length < 6) {
      return { success: false, reason: "invalid_code" };
    }

    // Check user hasn't already used a referral code
    const existingRef = await ctx.db
      .query("referrals")
      .withIndex("by_referred_user", (q: any) => q.eq("referredUserId", userId))
      .unique();
    if (existingRef) {
      return { success: false, reason: "already_used" };
    }

    // Find the referrer by looking up userSettings with matching referralCode
    const referrer = await ctx.db
      .query("userSettings")
      .withIndex("by_referralCode", (q: any) => q.eq("referralCode", code))
      .unique();

    if (!referrer) {
      return { success: false, reason: "code_not_found" };
    }

    // Can't refer yourself
    if (referrer.userId === userId) {
      return { success: false, reason: "self_referral" };
    }

    // Create referral record
    await ctx.db.insert("referrals", {
      referrerId: referrer.userId,
      referredUserId: userId,
      referralCode: code,
      status: "completed",
      rewardType: "trip_credit",
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    // Award referrer: +1 trip credit
    const referrerPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", referrer.userId))
      .unique();
    if (referrerPlan) {
      await ctx.db.patch(referrerPlan._id, {
        tripCredits: (referrerPlan.tripCredits || 0) + 1,
      });
    }

    // Award referee (current user): +1 trip credit
    const userPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .unique();
    if (userPlan) {
      await ctx.db.patch(userPlan._id, {
        tripCredits: (userPlan.tripCredits || 0) + 1,
      });
    }

    // Trigger achievement check for the referrer
    await ctx.scheduler.runAfter(0, (internal as any).achievements.checkAndUnlock, {
      userId: referrer.userId,
    });

    return { success: true };
  },
});

// --- Helper ---
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 for readability
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
