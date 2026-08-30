/**
 * Stripe billing for the website's Premium upgrade flow.
 *
 * The web checkout is **embedded** (`ui_mode: "embedded"`): Stripe returns a
 * client secret, the browser mounts the payment form inside
 * `planeraai.app/upgrade`, and the user never leaves our domain. That is why
 * there is no Stripe Checkout custom domain configured — an embedded form on
 * our own origin already gives the brand continuity a custom domain would sell,
 * without the monthly fee or the DNS setup.
 *
 * Mobile keeps buying through Apple IAP / Google Play; this path is web only.
 * All three converge on `userPlans`, arbitrated by `subscriptionSource` (see
 * `stripeBillingDb.ts`).
 *
 * Required Convex environment variables:
 *   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET    whsec_… (from the /stripe/webhook endpoint)
 *   STRIPE_PRICE_MONTHLY     price_… (recurring, monthly)
 *   STRIPE_PRICE_YEARLY      price_… (recurring, yearly)
 *   PLANERA_WEB_URL          optional; defaults to https://planeraai.app
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { reportError } from "./helpers/reportError";
import {
    stripeRequest,
    subscriptionGrantsAccess,
    subscriptionInterval,
    subscriptionPeriodEndMs,
    type StripeSubscription,
} from "./lib/stripe";

const WEB_URL = () => process.env.PLANERA_WEB_URL || "https://planeraai.app";

/**
 * Shape of the plan row the internal queries hand back. Written out rather than
 * inferred because these functions call into the generated `api`, which
 * includes this module — inference would be circular and TypeScript bails.
 */
type PlanRow = {
    userId: string;
    plan: string;
    subscriptionExpiresAt?: number;
    subscriptionType?: string;
    subscriptionSource?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeCancelAtPeriodEnd?: boolean;
} | null;

function priceIdFor(plan: "monthly" | "yearly"): string {
    const id =
        plan === "yearly"
            ? process.env.STRIPE_PRICE_YEARLY
            : process.env.STRIPE_PRICE_MONTHLY;
    if (!id) {
        throw new Error(
            `Stripe price for the ${plan} plan is not configured (STRIPE_PRICE_${plan.toUpperCase()})`
        );
    }
    return id;
}

/**
 * Find or create the Stripe customer for a user, and remember the id on the
 * plan row.
 *
 * The stored id is the source of truth: reusing it keeps one customer per
 * account, which is what makes the customer portal, invoice history and
 * "resubscribe" all land on the same record instead of scattering across
 * duplicates.
 */
async function ensureStripeCustomer(ctx: any, userId: string): Promise<string> {
    const plan: PlanRow = await ctx.runQuery(
        internal.stripeBillingDb.getPlanByUser,
        { userId }
    );
    if (plan?.stripeCustomerId) return plan.stripeCustomerId;

    const contact: { email?: string; name?: string } | null = await ctx.runQuery(
        internal.stripeBillingDb.getUserContact,
        { userId }
    );

    const customer = await stripeRequest<{ id: string }>("/customers", {
        method: "POST",
        params: {
            ...(contact?.email ? { email: contact.email } : {}),
            ...(contact?.name ? { name: contact.name } : {}),
            metadata: { userId },
        },
        // Two clicks on "Upgrade" before the first response lands must not
        // create two customers.
        idempotencyKey: `customer:${userId}`,
    });

    await ctx.runMutation(internal.stripeBillingDb.linkStripeCustomer, {
        userId,
        stripeCustomerId: customer.id,
    });
    return customer.id;
}

/**
 * Resolve a session token to a userId, or null.
 *
 * These used to be `authAction`s. That wrapper reads the token from
 * convex-helpers' `extra` object rather than the caller's args (see
 * `customCtx` — its callback signature is `(ctx, extra)`, not `(ctx, args)`),
 * so `args.token` never reached it and every call threw "Authentication
 * required". This mirrors `iapVerify.refreshMySubscription`, which is the
 * pattern that actually works for token-authenticated actions here.
 */
async function requireUserId(ctx: any, token: string): Promise<string | null> {
    const session: any = await ctx.runQuery(
        internal.authNativeDb.getSessionByToken,
        { token }
    );
    if (!session) return null;
    if (session.expiresAt && session.expiresAt < Date.now()) return null;
    return session.userId ?? null;
}

/**
 * The live price of each plan, read from Stripe.
 *
 * The upgrade page renders these rather than hardcoded numbers so the amount
 * shown and the amount charged can never drift apart — changing a price in the
 * Stripe dashboard is enough. Public (no token): this is exactly the pricing a
 * signed-out visitor is allowed to see.
 */
export const getPricing = action({
    args: {},
    returns: v.object({
        ok: v.boolean(),
        monthly: v.optional(
            v.object({ amount: v.float64(), currency: v.string() })
        ),
        yearly: v.optional(
            v.object({ amount: v.float64(), currency: v.string() })
        ),
    }),
    handler: async (ctx) => {
        try {
            const ids = {
                monthly: process.env.STRIPE_PRICE_MONTHLY,
                yearly: process.env.STRIPE_PRICE_YEARLY,
            };
            const read = async (id?: string) => {
                if (!id) return undefined;
                const price = await stripeRequest<{
                    unit_amount: number | null;
                    currency: string;
                }>(`/prices/${encodeURIComponent(id)}`);
                if (price.unit_amount == null) return undefined;
                // Stripe quotes minor units (cents); the UI wants major.
                return {
                    amount: price.unit_amount / 100,
                    currency: price.currency.toUpperCase(),
                };
            };
            // allSettled, not all: `all` rejects on the first failure and
            // leaves the sibling fetch in flight, which Convex reports as a
            // dangling promise. A missing price should also not hide a good one.
            const [monthly, yearly] = await Promise.allSettled([
                read(ids.monthly),
                read(ids.yearly),
            ]);
            if (monthly.status === "rejected") {
                await reportError(ctx, "stripeBilling:getPricing", monthly.reason, {
                    plan: "monthly",
                });
            }
            if (yearly.status === "rejected") {
                await reportError(ctx, "stripeBilling:getPricing", yearly.reason, {
                    plan: "yearly",
                });
            }
            return {
                ok: true,
                monthly: monthly.status === "fulfilled" ? monthly.value : undefined,
                yearly: yearly.status === "fulfilled" ? yearly.value : undefined,
            };
        } catch (e) {
            await reportError(ctx, "stripeBilling:getPricing", e, {});
            return { ok: false };
        }
    },
});

/**
 * Create an embedded Checkout Session and hand its client secret to the
 * browser, which mounts the payment form on our own page.
 *
 * `userId` is stamped on the session, the customer AND the subscription so the
 * webhook can resolve an account from any of the three event shapes Stripe
 * sends — subscription events carry no `client_reference_id`.
 */
export const createCheckoutSession = action({
    args: {
        token: v.string(),
        plan: v.union(v.literal("monthly"), v.literal("yearly")),
        /** UI language, so Stripe renders the form in the user's locale. */
        locale: v.optional(v.string()),
    },
    handler: async (
        ctx: any,
        args: any
    ): Promise<
        | { ok: true; clientSecret: string; sessionId: string }
        | { ok: false; error: string; source?: string }
    > => {
        const userId = await requireUserId(ctx, args.token);
        if (!userId) return { ok: false as const, error: "unauthenticated" };
        const plan: "monthly" | "yearly" = args.plan;

        const existing: PlanRow = await ctx.runQuery(
            internal.stripeBillingDb.getPlanByUser,
            { userId }
        );

        // Someone already paying through the App Store or Play would be charged
        // twice with no way to tell from inside either store. Send them to the
        // store that owns the subscription instead of taking a second payment.
        if (
            existing?.plan === "premium" &&
            existing.subscriptionSource &&
            existing.subscriptionSource !== "stripe" &&
            (existing.subscriptionExpiresAt ?? 0) > Date.now()
        ) {
            return {
                ok: false as const,
                error: "already_subscribed_elsewhere",
                source: existing.subscriptionSource,
            };
        }

        const customerId = await ensureStripeCustomer(ctx, userId);

        try {
            const session = await stripeRequest<{
                id: string;
                client_secret: string;
            }>("/checkout/sessions", {
                method: "POST",
                params: {
                    mode: "subscription",
                    ui_mode: "embedded",
                    customer: customerId,
                    client_reference_id: userId,
                    line_items: [{ price: priceIdFor(plan), quantity: 1 }],
                    // {CHECKOUT_SESSION_ID} is substituted by Stripe on return.
                    return_url: `${WEB_URL()}/upgrade/complete?session_id={CHECKOUT_SESSION_ID}`,
                    allow_promotion_codes: true,
                    metadata: { userId, plan },
                    subscription_data: { metadata: { userId, plan } },
                    // Collect the address Stripe needs for EU VAT on invoices.
                    billing_address_collection: "auto",
                    ...(args.locale ? { locale: args.locale } : {}),
                },
            });

            return {
                ok: true as const,
                clientSecret: session.client_secret,
                sessionId: session.id,
            };
        } catch (e) {
            await reportError(ctx, "stripeBilling:createCheckoutSession", e, {
                userId,
                plan,
            });
            return { ok: false as const, error: "stripe_error" };
        }
    },
});

/**
 * Read back a finished Checkout Session for the return page.
 *
 * This also *applies* the entitlement rather than only reporting it. The
 * webhook is the authoritative path, but it is asynchronous — without this the
 * user can land on the success page a second before the event arrives and see
 * themselves still on the free plan. Both paths funnel into the same guarded
 * mutation, so whichever runs second is a no-op.
 */
export const getCheckoutStatus = action({
    args: { token: v.string(), sessionId: v.string() },
    handler: async (
        ctx: any,
        args: any
    ): Promise<
        | {
              ok: true;
              status: string;
              premium: boolean;
              interval?: "monthly" | "yearly";
              expiresAt?: number;
          }
        | { ok: false; error: string }
    > => {
        const userId = await requireUserId(ctx, args.token);
        if (!userId) return { ok: false as const, error: "unauthenticated" };

        try {
            const session = await stripeRequest<{
                status: string;
                payment_status: string;
                client_reference_id?: string;
                customer?: string;
                subscription?: string;
            }>(`/checkout/sessions/${encodeURIComponent(args.sessionId)}`);

            // Never let one account read another's checkout session.
            if (session.client_reference_id && session.client_reference_id !== userId) {
                return { ok: false as const, error: "not_found" };
            }

            if (session.status !== "complete" || !session.subscription) {
                return {
                    ok: true as const,
                    status: session.status,
                    premium: false,
                };
            }

            const sub = await stripeRequest<StripeSubscription>(
                `/subscriptions/${encodeURIComponent(session.subscription)}`
            );
            const grants = subscriptionGrantsAccess(sub.status);

            await ctx.runMutation(internal.stripeBillingDb.applyStripeSubscription, {
                userId,
                stripeCustomerId: sub.customer,
                stripeSubscriptionId: sub.id,
                grantsAccess: grants,
                expiresAt: subscriptionPeriodEndMs(sub),
                interval: subscriptionInterval(sub),
                cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
            });

            return {
                ok: true as const,
                status: session.status,
                premium: grants,
                interval: subscriptionInterval(sub),
                expiresAt: subscriptionPeriodEndMs(sub),
            };
        } catch (e) {
            await reportError(ctx, "stripeBilling:getCheckoutStatus", e, { userId });
            return { ok: false as const, error: "stripe_error" };
        }
    },
});

/**
 * Open the Stripe customer portal so subscribers can update their card, read
 * invoices or cancel. Stripe hosts this one; it is a rare, post-purchase
 * destination where its own domain costs nothing in conversion.
 */
export const createPortalSession = action({
    args: { token: v.string(), returnPath: v.optional(v.string()) },
    handler: async (
        ctx: any,
        args: any
    ): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
        const userId = await requireUserId(ctx, args.token);
        if (!userId) return { ok: false as const, error: "unauthenticated" };

        const plan: PlanRow = await ctx.runQuery(
            internal.stripeBillingDb.getPlanByUser,
            { userId }
        );
        if (!plan?.stripeCustomerId) {
            return { ok: false as const, error: "no_stripe_customer" };
        }

        // Only ever return to our own site, whatever the client sends.
        const path =
            typeof args.returnPath === "string" && args.returnPath.startsWith("/")
                ? args.returnPath
                : "/settings";

        try {
            const session = await stripeRequest<{ url: string }>(
                "/billing_portal/sessions",
                {
                    method: "POST",
                    params: {
                        customer: plan.stripeCustomerId,
                        return_url: `${WEB_URL()}${path}`,
                    },
                }
            );
            return { ok: true as const, url: session.url };
        } catch (e) {
            await reportError(ctx, "stripeBilling:createPortalSession", e, { userId });
            return { ok: false as const, error: "stripe_error" };
        }
    },
});

// =============================== Webhook ====================================

/**
 * Apply one verified Stripe webhook event.
 *
 * Called by the HTTP route in `http.ts` *after* the signature has been checked
 * against the raw body — this action trusts its input, so nothing else may
 * call it. Throwing returns a 500 to Stripe, which retries; that is the
 * intended behaviour for a transient failure.
 */
export const processWebhookEvent = internalAction({
    args: { event: v.any() },
    returns: v.object({ action: v.string() }),
    handler: async (ctx, { event }): Promise<{ action: string }> => {
        const type: string = event?.type ?? "";
        const object: any = event?.data?.object ?? {};

        // Idempotency gate — claim the event id before doing any work.
        const claim: { isNew: boolean } = await ctx.runMutation(
            internal.stripeBillingDb.claimStripeEvent,
            { eventId: String(event?.id ?? ""), type }
        );
        if (!claim.isNew) return { action: "duplicate" };

        switch (type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
                if (object.mode !== "subscription" || !object.subscription) {
                    return { action: "ignored_non_subscription" };
                }
                const sub = await stripeRequest<StripeSubscription>(
                    `/subscriptions/${encodeURIComponent(String(object.subscription))}`
                );
                return await applySubscription(ctx, sub, object.client_reference_id);
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                return await applySubscription(ctx, object as StripeSubscription);
            }

            default:
                return { action: "ignored" };
        }
    },
});

/**
 * Map a Stripe subscription onto a Planera account and write the entitlement.
 *
 * The user is resolved from metadata first (stamped at checkout) and from the
 * customer id second. If neither resolves, we return rather than throw: a
 * subscription belonging to no known account is a permanent condition, and
 * throwing would make Stripe retry it for days.
 */
async function applySubscription(
    ctx: any,
    sub: StripeSubscription,
    clientReferenceId?: string
): Promise<{ action: string }> {
    const customerId =
        typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id;
    if (!customerId) return { action: "no_customer" };

    let userId: string | null =
        sub.metadata?.userId || clientReferenceId || null;

    if (!userId) {
        userId = await ctx.runQuery(
            internal.stripeBillingDb.getUserIdByStripeCustomer,
            { stripeCustomerId: customerId }
        );
    }
    if (!userId) {
        console.error(
            `[Stripe] subscription ${sub.id} has no resolvable Planera user (customer ${customerId})`
        );
        return { action: "no_user" };
    }

    const result: { action: string } = await ctx.runMutation(
        internal.stripeBillingDb.applyStripeSubscription,
        {
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            grantsAccess: subscriptionGrantsAccess(sub.status),
            expiresAt: subscriptionPeriodEndMs(sub),
            interval: subscriptionInterval(sub),
            cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        }
    );

    console.log(
        `[Stripe] ${sub.id} status=${sub.status} user=${userId} → ${result.action}`
    );
    return result;
}

/**
 * Public health check for the billing configuration, so a missing price id is
 * discovered from the admin dashboard rather than by a user hitting a broken
 * checkout. Reports presence only — never the values.
 */
export const billingConfigStatus = action({
    args: {},
    returns: v.object({
        secretKey: v.boolean(),
        webhookSecret: v.boolean(),
        monthlyPrice: v.boolean(),
        yearlyPrice: v.boolean(),
    }),
    handler: async () => ({
        secretKey: !!process.env.STRIPE_SECRET_KEY,
        webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
        monthlyPrice: !!process.env.STRIPE_PRICE_MONTHLY,
        yearlyPrice: !!process.env.STRIPE_PRICE_YEARLY,
    }),
});
