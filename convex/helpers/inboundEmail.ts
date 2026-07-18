/**
 * Pure helpers for the Reservation Inbox inbound pipeline.
 *
 * Kept free of Convex/OpenAI imports so the security-critical bits (which alias
 * a message is credited to, whether a sender passed DKIM/SPF) can be exercised
 * directly. See convex/reservationsInbound.ts for the action that uses them.
 */

/**
 * Aliases are exactly 16 lowercase hex chars — 64 bits of entropy, minted from
 * crypto.randomUUID (see reservations.ensureInboundAddress).
 *
 * The length matters: knowing an alias is enough to post reservations into that
 * account, so it has to survive being guessed at. 64 bits does; the 40 bits of
 * a 10-char alias is thin for a credential with no rate limit in front of it.
 */
export const ALIAS_LENGTH = 16;
const ALIAS_PATTERN = /^[a-f0-9]{16}$/;

/**
 * Extract the inbound alias from a recipient address.
 *
 * SECURITY: the alias is the ONLY identity signal the pipeline accepts, so this
 * function decides which account a message writes into. It is deliberately
 * strict — anything that isn't exactly our alias shape returns null rather than
 * guessing, so role addresses (postmaster@, abuse@) and malformed envelopes are
 * dropped instead of being charged to some user.
 *
 * Accepts the bare form (`a8f3k2p9ab@in.planera.app`) and plus-addressing
 * (`trips+a8f3k2p9ab@…`) so the public-facing shape can change later without
 * breaking forwarding rules people already configured.
 */
export function extractAlias(recipient: string | undefined | null): string | null {
    if (!recipient) return null;
    // Postmark may hand us "Name <addr@host>" — take what's inside the brackets.
    const bracket = recipient.match(/<([^>]+)>/);
    const address = (bracket ? bracket[1] : recipient).trim().toLowerCase();
    if (!address.includes("@")) return null;
    const localPart = address.split("@")[0];
    if (!localPart) return null;
    const alias = localPart.includes("+") ? localPart.split("+").pop()! : localPart;
    return ALIAS_PATTERN.test(alias) ? alias : null;
}

/**
 * Read DKIM/SPF results out of the raw headers Postmark forwards.
 *
 * Absence of a pass is NOT proof of forgery — plenty of legitimate forwards
 * break DKIM — so this only sets a display/ranking flag. Nothing in the
 * pipeline auto-approves on the strength of it.
 */
export function isSenderVerified(
    headers: Array<{ Name?: string; Value?: string }> | undefined | null
): boolean {
    if (!Array.isArray(headers)) return false;
    const relevant = headers
        .filter((h) => /^(authentication-results|received-spf)$/i.test(h?.Name ?? ""))
        .map((h) => (h?.Value ?? "").toLowerCase());
    if (relevant.length === 0) return false;
    const joined = relevant.join(" ");
    // Explicit failures win over a stray "pass" elsewhere in the header soup.
    if (/dkim=fail|spf=fail|dmarc=fail/.test(joined)) return false;
    return /dkim=pass/.test(joined) || /spf=pass/.test(joined) || /^pass\b/.test(joined);
}

/** Strip HTML to something a model can read cheaply. */
export function htmlToText(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Parse a model-supplied ISO string into a timestamp, rejecting values that are
 * obviously wrong. The model occasionally emits a typo'd year (0202, 20255);
 * a bad timestamp would silently mis-file a reservation against the wrong trip.
 */
export function toTimestamp(iso: string | undefined): number | undefined {
    if (!iso || typeof iso !== "string") return undefined;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return undefined;
    const year = new Date(ms).getUTCFullYear();
    if (year < 2000 || year > 2100) return undefined;
    return ms;
}

// ---------------------------------------------------------------------------
// Trip matching — deciding which trip an inbound reservation attaches to.
//
// Kept here (Convex-free) for the same reason as the alias/DKIM logic above:
// attaching a booking to the WRONG trip, or duplicating one on re-forward, is a
// correctness/privacy problem, so the decision is exercised directly in
// scripts/test-inbound-email.ts rather than only through a live deployment.
// convex/reservations.ts imports these; keep the two in step.
// ---------------------------------------------------------------------------

/**
 * A reservation this far outside the trip window still counts as a match
 * (red-eyes, late check-outs, a train the evening before departure).
 */
export const TRIP_MATCH_SLACK_MS = 36 * 60 * 60 * 1000;

/** The trip fields pickMatchingTrip reads. A subset of the Convex `trips` doc. */
export type TripLike = {
    _id?: unknown;
    status?: string;
    startDate: number;
    endDate: number;
    destination?: string;
};

/**
 * Stable key so re-forwarding the same confirmation updates the existing row
 * instead of creating a duplicate. Not a secret, so no hashing needed — a
 * deterministic string keeps this synchronous in the V8 runtime.
 */
export function buildDedupeKey(
    userId: string,
    type: string,
    confirmationCode: string | undefined,
    title: string,
    startAt: number | undefined
): string {
    const identity = (confirmationCode || title || "").trim().toLowerCase();
    // Bucket to the day: the same booking re-sent often differs by seconds.
    const day = startAt ? Math.floor(startAt / 86_400_000) : "";
    return `${userId}|${type}|${identity}|${day}`;
}

/**
 * Normalize a place string for loose comparison ("Barcelona, Spain" → "barcelona spain").
 */
export function normalizePlace(value: string | undefined): string {
    if (!value) return "";
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Pick the best trip for a reservation: the window must overlap, then prefer a
 * destination that actually appears in the reservation's location/title.
 * Returns null when nothing overlaps — an unmatched reservation is a valid
 * (and product-relevant) outcome, not a failure.
 */
export function pickMatchingTrip<T extends TripLike>(
    trips: T[],
    startAt: number | undefined,
    haystack: string
): T | null {
    if (!startAt) return null;

    const overlapping = trips.filter((trip) => {
        if (trip.status === "archived") return false;
        const from = trip.startDate - TRIP_MATCH_SLACK_MS;
        const to = trip.endDate + TRIP_MATCH_SLACK_MS;
        return startAt >= from && startAt <= to;
    });

    if (overlapping.length === 0) return null;
    if (overlapping.length === 1) return overlapping[0];

    const normalizedHaystack = normalizePlace(haystack);
    const byDestination = overlapping.filter((trip) => {
        const tokens = normalizePlace(trip.destination).split(" ").filter((t) => t.length > 3);
        return tokens.some((token) => normalizedHaystack.includes(token));
    });
    if (byDestination.length > 0) return byDestination[0];

    // Ambiguous on dates alone — take the trip whose start is nearest.
    return overlapping.sort(
        (a, b) => Math.abs(a.startDate - startAt) - Math.abs(b.startDate - startAt)
    )[0];
}
