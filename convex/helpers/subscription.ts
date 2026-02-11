// ===========================================
// APPLE BILLING GRACE PERIOD HELPER
// ===========================================
// Apple allows a 16-day billing grace period for subscription renewals.
// During this period, subscribers retain access even if their subscription
// technically expired due to a billing issue (e.g. expired card, insufficient funds).
// If Apple recovers payment during this window, revenue is uninterrupted.
//
// Configuration (App Store Connect):
//   Grace Period Duration: 16 days
//   Eligible Subscribers: All Renewals
//   Server Environments: Production and Sandbox
//
// Reference: https://developer.apple.com/documentation/storekit/in-app_purchase/original_api_for_in-app_purchase/subscriptions_and_offers/reducing_involuntary_subscriber_churn

export const BILLING_GRACE_PERIOD_DAYS = 16;
export const BILLING_GRACE_PERIOD_MS = BILLING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export interface SubscriptionStatus {
    /** Whether the user should have premium access */
    active: boolean;
    /** Whether the user is currently in the billing grace period */
    inGracePeriod: boolean;
    /** When the grace period ends (only set if inGracePeriod is true) */
    gracePeriodEndsAt?: number;
}

/**
 * Check if a subscription is active, accounting for Apple's 16-day billing grace period.
 * 
 * A subscription is considered active if:
 * 1. The plan is "premium"
 * 2. subscriptionExpiresAt exists
 * 3. The current time is before (expiresAt + 16 days grace period)
 * 
 * @param plan - The user's plan ("free" or "premium")
 * @param subscriptionExpiresAt - Timestamp when the subscription nominally expires
 * @returns SubscriptionStatus with active flag, grace period info
 */
export function isSubscriptionActiveWithGrace(
    plan: string | undefined,
    subscriptionExpiresAt: number | undefined | null,
): SubscriptionStatus {
    if (plan !== "premium" || !subscriptionExpiresAt) {
        return { active: false, inGracePeriod: false };
    }

    const now = Date.now();
    const gracePeriodEnd = subscriptionExpiresAt + BILLING_GRACE_PERIOD_MS;

    if (now <= subscriptionExpiresAt) {
        // Subscription hasn't expired yet — fully active
        return { active: true, inGracePeriod: false };
    }

    if (now <= gracePeriodEnd) {
        // Past nominal expiry but within 16-day grace window
        return { active: true, inGracePeriod: true, gracePeriodEndsAt: gracePeriodEnd };
    }

    // Past grace period — truly expired
    return { active: false, inGracePeriod: false };
}
