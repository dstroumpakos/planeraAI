import { subscriptionGrantsAccess } from "./stripe";

/**
 * Whether a supplier account may have its packages reviewed and shown in the
 * app. One rule, used by product writes, the home listing and the portal.
 *
 * `billingRequired` unset = a supplier from before paid listings existed (or
 * one the operator waived): always allowed. Otherwise the Stripe subscription
 * must be in an entitling status AND its period must not be long over. The
 * period check is what stops a missed cancellation webhook from listing an
 * unpaid supplier forever.
 */
const PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function partnerListingActive(
    account: {
        billingRequired?: boolean;
        subscriptionStatus?: string;
        subscriptionPeriodEnd?: number;
        commission?: unknown;
    },
    now: number = Date.now()
): boolean {
    if (!account.billingRequired) return true;
    // A signed commission agreement replaces the listing fee.
    if (account.commission) return true;
    if (!account.subscriptionStatus) return false;
    if (!subscriptionGrantsAccess(account.subscriptionStatus)) return false;
    return (account.subscriptionPeriodEnd ?? 0) + PERIOD_GRACE_MS > now;
}
