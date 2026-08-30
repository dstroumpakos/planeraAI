/**
 * Database side of Stripe (web) billing.
 *
 * Split out from `stripeBilling.ts` for the same reason as `authNativeDb` and
 * `passwordResetDb`: actions can't touch the database directly, so the queries
 * and mutations they drive live in their own module.
 *
 * ENTITLEMENT OWNERSHIP — the rule this file exists to enforce:
 * `userPlans` is written by three payment paths (Apple IAP, Google Play, and
 * now Stripe). `subscriptionSource` records which one owns the *current*
 * entitlement, and a path may only revoke what it granted. Without that,
 * cancelling a long-dead App Store subscription would silently kill a paying
 * web subscriber — and vice versa.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// ================================ Queries ===================================

export const getPlanByUser = internalQuery({
    args: { userId: v.string() },
    returns: v.union(
        v.object({
            userId: v.string(),
            plan: v.string(),
            subscriptionExpiresAt: v.optional(v.float64()),
            subscriptionType: v.optional(v.string()),
            subscriptionSource: v.optional(v.string()),
            stripeCustomerId: v.optional(v.string()),
            stripeSubscriptionId: v.optional(v.string()),
            stripeCancelAtPeriodEnd: v.optional(v.boolean()),
        }),
        v.null()
    ),
    handler: async (ctx, { userId }) => {
        const plan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        if (!plan) return null;
        return {
            userId: plan.userId,
            plan: plan.plan,
            subscriptionExpiresAt: plan.subscriptionExpiresAt,
            subscriptionType: plan.subscriptionType,
            subscriptionSource: plan.subscriptionSource,
            stripeCustomerId: plan.stripeCustomerId,
            stripeSubscriptionId: plan.stripeSubscriptionId,
            stripeCancelAtPeriodEnd: plan.stripeCancelAtPeriodEnd,
        };
    },
});

/** Email + name used to create the Stripe customer record. */
export const getUserContact = internalQuery({
    args: { userId: v.string() },
    returns: v.union(
        v.object({ email: v.optional(v.string()), name: v.optional(v.string()) }),
        v.null()
    ),
    handler: async (ctx, { userId }) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        if (!settings) return null;
        return { email: settings.email, name: settings.name };
    },
});

/** Resolve a Stripe customer id back to the owning user. */
export const getUserIdByStripeCustomer = internalQuery({
    args: { stripeCustomerId: v.string() },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, { stripeCustomerId }) => {
        const plan = await ctx.db
            .query("userPlans")
            .withIndex("by_stripe_customer", (q) =>
                q.eq("stripeCustomerId", stripeCustomerId)
            )
            .first();
        return plan?.userId ?? null;
    },
});

// =============================== Mutations ==================================

/**
 * Make sure the user has a plan row and that it carries `stripeCustomerId`.
 *
 * Called before checkout so the webhook — which knows the customer but not
 * always the user — can always resolve back to an account, and so a returning
 * subscriber reuses their existing Stripe customer instead of accumulating a
 * fresh one on every purchase.
 */
export const linkStripeCustomer = internalMutation({
    args: { userId: v.string(), stripeCustomerId: v.string() },
    returns: v.null(),
    handler: async (ctx, { userId, stripeCustomerId }) => {
        const plan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();

        if (!plan) {
            await ctx.db.insert("userPlans", {
                userId,
                plan: "free",
                tripsGenerated: 0,
                tripCredits: 0,
                stripeCustomerId,
            });
            return null;
        }
        if (plan.stripeCustomerId !== stripeCustomerId) {
            await ctx.db.patch(plan._id, { stripeCustomerId });
        }
        return null;
    },
});

/**
 * Apply the state of a Stripe subscription to the user's plan.
 *
 * `grantsAccess` is decided by the caller from the Stripe status (see
 * `subscriptionGrantsAccess`). Revocation is deliberately narrow: we only ever
 * downgrade a plan whose `subscriptionSource` is already "stripe" AND whose
 * stored subscription id matches the incoming one. That keeps two things safe —
 * an Apple/Play subscriber can never be downgraded by a Stripe event, and a
 * late `customer.subscription.deleted` for a subscription the user has already
 * replaced can't revoke the replacement.
 */
export const applyStripeSubscription = internalMutation({
    args: {
        userId: v.string(),
        stripeCustomerId: v.string(),
        stripeSubscriptionId: v.string(),
        grantsAccess: v.boolean(),
        expiresAt: v.optional(v.float64()),
        interval: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
        cancelAtPeriodEnd: v.optional(v.boolean()),
    },
    returns: v.object({ action: v.string() }),
    handler: async (ctx, args) => {
        let plan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .unique();

        if (!plan) {
            const id = await ctx.db.insert("userPlans", {
                userId: args.userId,
                plan: "free",
                tripsGenerated: 0,
                tripCredits: 0,
                stripeCustomerId: args.stripeCustomerId,
            });
            plan = await ctx.db.get(id);
            if (!plan) throw new Error("Failed to create user plan");
        }

        if (args.grantsAccess) {
            if (!args.expiresAt) {
                // An entitling status with no period end is a shape we don't
                // understand; leave the plan alone rather than granting premium
                // that never expires.
                return { action: "skipped_no_expiry" };
            }
            await ctx.db.patch(plan._id, {
                plan: "premium",
                subscriptionExpiresAt: args.expiresAt,
                subscriptionSource: "stripe",
                stripeCustomerId: args.stripeCustomerId,
                stripeSubscriptionId: args.stripeSubscriptionId,
                stripeCancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
                ...(args.interval ? { subscriptionType: args.interval } : {}),
            });
            return { action: "granted" };
        }

        // --- Revocation, guarded on ownership ---
        if (plan.subscriptionSource !== "stripe") {
            return { action: "skipped_not_stripe" };
        }
        if (
            plan.stripeSubscriptionId &&
            plan.stripeSubscriptionId !== args.stripeSubscriptionId
        ) {
            return { action: "skipped_stale_subscription" };
        }

        await ctx.db.patch(plan._id, {
            plan: "free",
            stripeCancelAtPeriodEnd: false,
            ...(args.expiresAt ? { subscriptionExpiresAt: args.expiresAt } : {}),
        });
        return { action: "revoked" };
    },
});

/**
 * Record a Stripe event id, returning whether this is the first time we have
 * seen it. Stripe retries until it gets a 2xx and may redeliver even after
 * one, so every handler runs behind this check.
 */
export const claimStripeEvent = internalMutation({
    args: { eventId: v.string(), type: v.string() },
    returns: v.object({ isNew: v.boolean() }),
    handler: async (ctx, { eventId, type }) => {
        const existing = await ctx.db
            .query("stripeEvents")
            .withIndex("by_event", (q) => q.eq("eventId", eventId))
            .first();
        if (existing) return { isNew: false };
        await ctx.db.insert("stripeEvents", {
            eventId,
            type,
            processedAt: Date.now(),
        });
        return { isNew: true };
    },
});
