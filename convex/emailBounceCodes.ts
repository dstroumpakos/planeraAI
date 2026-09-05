/**
 * Postmark bounce classification, shared by every list that sends mail.
 *
 * This lives in its own module because two independent funnels have to agree
 * on what a bounce *is*: the newsletter/transactional path in
 * `emailEvents.ts` and the B2B outreach circuit breaker in
 * `agencyOutreach.ts`. When those two drifted apart, the outreach breaker
 * counted an out-of-office auto-reply and a "message expired in the queue"
 * exactly like a dead mailbox — and paused a healthy campaign.
 *
 * Everything here is matched on the numeric TypeCode rather than the
 * description, which is prose and has changed wording before.
 */

/**
 * Codes that mean "this address will never accept mail".
 *
 *    1      HardBounce            mailbox does not exist
 *  100000   BadEmailAddress       malformed / rejected outright
 *  100002   ManuallyDeactivated   deactivated in Postmark
 *  100006   Blocked               ISP blocked the recipient
 *
 * Deliberately NOT here:
 *  - 256 DnsError and 100009 DMARCPolicy look like hard failures but are
 *    usually OUR configuration or a temporary domain problem. Suppressing the
 *    recipient would hide a fault we need to fix and silently shrink the list.
 *  - 512 SpamNotification is routed to the complaint path instead.
 */
export const HARD_BOUNCE_CODES = new Set([1, 100000, 100002, 100006]);

/** Codes that are informational noise, not a delivery failure at all. */
export const IGNORED_BOUNCE_CODES = new Set([
  32, // Subscribe
  64, // AutoResponder ("out of office")
  128, // AddressChange
  1024, // OpenRelayTest
  16384, // ChallengeVerification
]);

/** Postmark's "unsubscribe" bounce type — the recipient opted out at the ISP. */
export const UNSUBSCRIBE_BOUNCE_CODE = 16;

/** Complaint-shaped bounce codes (SpamNotification, SpamComplaint). */
export const COMPLAINT_BOUNCE_CODES = new Set([512, 100001]);

export type BounceClass = "ignored" | "unsubscribe" | "complaint" | "hard" | "soft";

/**
 * What a bounce event actually means.
 *
 * "soft" is the catch-all on purpose: an unrecognised code is a temporary
 * problem until proven otherwise, because the cost of treating a live mailbox
 * as dead (a lost lead, forever) is higher than the cost of one more retry.
 */
export function classifyBounce(o: { typeCode?: number; inactive?: boolean }): BounceClass {
  const code = o.typeCode ?? 0;
  if (IGNORED_BOUNCE_CODES.has(code)) return "ignored";
  if (code === UNSUBSCRIBE_BOUNCE_CODE) return "unsubscribe";
  if (COMPLAINT_BOUNCE_CODES.has(code)) return "complaint";
  // `Inactive` is Postmark's own verdict that it has deactivated the address —
  // authoritative regardless of how we would classify the code.
  if (HARD_BOUNCE_CODES.has(code) || o.inactive === true) return "hard";
  return "soft";
}
