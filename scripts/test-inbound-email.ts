/**
 * Unit checks for the Reservation Inbox inbound-email helpers.
 *
 * These cover the security-critical decisions: which account a message is
 * credited to (extractAlias) and whether a sender passed DKIM/SPF. No test
 * framework needed — run it directly:
 *
 *   npx tsx scripts/test-inbound-email.ts
 *
 * Exits non-zero on failure, so it drops into CI as-is.
 */
import {
    extractAlias,
    isSenderVerified,
    htmlToText,
    toTimestamp,
    buildDedupeKey,
    pickMatchingTrip,
    TRIP_MATCH_SLACK_MS,
    type TripLike,
} from "../convex/helpers/inboundEmail";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`); }
}

console.log("\nextractAlias β€” decides which account a message writes into");
check("bare alias", extractAlias("a8f3c2b9ad4e17f0@in.planera.app"), "a8f3c2b9ad4e17f0");
check("plus addressing", extractAlias("trips+a8f3c2b9ad4e17f0@in.planera.app"), "a8f3c2b9ad4e17f0");
check("display name form", extractAlias("Planera <a8f3c2b9ad4e17f0@in.planera.app>"), "a8f3c2b9ad4e17f0");
check("uppercase normalized", extractAlias("a8f3c2b9ad4e17f0@IN.PLANERA.APP"), "a8f3c2b9ad4e17f0");
check("whitespace tolerated", extractAlias("  a8f3c2b9ad4e17f0@in.planera.app  "), "a8f3c2b9ad4e17f0");
check("role address rejected", extractAlias("postmaster@in.planera.app"), null);
check("too short rejected", extractAlias("abc123@in.planera.app"), null);
check("too long rejected", extractAlias("a8f3c2b9ad4e17f0cd@in.planera.app"), null);
check("non-hex rejected", extractAlias("zzzzzzzzzzzzzzzz@in.planera.app"), null);
check("no domain rejected", extractAlias("a8f3c2b9ad4e17f0"), null);
check("undefined rejected", extractAlias(undefined), null);
check("empty rejected", extractAlias(""), null);
check("injection attempt rejected", extractAlias("a8f3c2b9ad4e17f0@evil.com<script>"), null);

console.log("\nisSenderVerified β€” trust flag only, never auto-approval");
check("dkim pass", isSenderVerified([{ Name: "Authentication-Results", Value: "mx.google.com; dkim=pass header.i=@aegean.gr" }]), true);
check("spf pass", isSenderVerified([{ Name: "Received-SPF", Value: "Pass (protection.outlook.com)" }]), true);
check("dkim fail", isSenderVerified([{ Name: "Authentication-Results", Value: "mx.google.com; dkim=fail" }]), false);
check("fail wins over pass", isSenderVerified([{ Name: "Authentication-Results", Value: "spf=pass; dkim=fail" }]), false);
check("no headers", isSenderVerified(undefined), false);
check("empty array", isSenderVerified([]), false);
check("irrelevant headers", isSenderVerified([{ Name: "Subject", Value: "dkim=pass" }]), false);

console.log("\ntoTimestamp β€” a bad date mis-files a booking against the wrong trip");
check("iso with offset", toTimestamp("2026-06-12T08:35:00+03:00"), Date.parse("2026-06-12T08:35:00+03:00"));
check("typo'd year 0202 rejected", toTimestamp("0202-06-12T08:35:00Z"), undefined);
check("year 20255 rejected", toTimestamp("20255-06-12T08:35:00Z"), undefined);
check("garbage rejected", toTimestamp("next tuesday"), undefined);
check("undefined rejected", toTimestamp(undefined), undefined);

console.log("\nhtmlToText");
check("strips tags + entities", htmlToText("<p>Flight <b>A3&nbsp;700</b></p><script>evil()</script>"), "Flight A3 700");

console.log("\nbuildDedupeKey β€” re-forwarding a confirmation must update, not duplicate");
const U = "user_1";
const jun12am = Date.parse("2026-06-12T08:00:00Z");
const jun12pm = Date.parse("2026-06-12T20:00:00Z");
const jun13 = Date.parse("2026-06-13T08:00:00Z");
// Same booking re-sent hours later (code re-cased/padded) collapses to one row.
check("same code, same day β†’ identical key",
    buildDedupeKey(U, "flight", "ABC123", "Outbound", jun12am) ===
    buildDedupeKey(U, "flight", "  abc123 ", "different title", jun12pm), true);
// A genuinely different day is a different booking, not a re-forward.
check("same code, next day β†’ different key",
    buildDedupeKey(U, "flight", "ABC123", "Outbound", jun12am) ===
    buildDedupeKey(U, "flight", "ABC123", "Outbound", jun13), false);
// No confirmation code: the title carries identity instead.
check("no code β†’ falls back to title",
    buildDedupeKey(U, "hotel", undefined, "Hotel Ritz", jun12am) ===
    buildDedupeKey(U, "hotel", undefined, "hotel ritz", jun12pm), true);
// A different user's identical booking never shares a key.
check("different user β†’ different key",
    buildDedupeKey(U, "flight", "ABC123", "Outbound", jun12am) ===
    buildDedupeKey("user_2", "flight", "ABC123", "Outbound", jun12am), false);
// Missing startAt is still deterministic (empty day bucket), so a dateless
// re-forward de-dupes rather than piling up.
check("no startAt β†’ deterministic",
    buildDedupeKey(U, "other", "X", "t", undefined) ===
    buildDedupeKey(U, "other", "X", "t", undefined), true);

console.log("\npickMatchingTrip β€” attaching a booking to the WRONG trip is a privacy leak");
const idOf = (t: TripLike | null) => (t ? (t._id as string) : null);
const bcn: TripLike = {
    _id: "trip_bcn", status: "active", destination: "Barcelona, Spain",
    startDate: Date.parse("2026-06-10T00:00:00Z"), endDate: Date.parse("2026-06-15T00:00:00Z"),
};
const paris: TripLike = {
    _id: "trip_paris", status: "active", destination: "Paris, France",
    startDate: Date.parse("2026-06-11T00:00:00Z"), endDate: Date.parse("2026-06-14T00:00:00Z"),
};
const flightMidday = Date.parse("2026-06-12T08:35:00Z"); // inside both windows
check("no startAt β†’ unmatched", idOf(pickMatchingTrip([bcn], undefined, "anything")), null);
check("no trips β†’ unmatched", idOf(pickMatchingTrip([], flightMidday, "Barcelona")), null);
check("single overlapping trip wins", idOf(pickMatchingTrip([bcn], flightMidday, "any haystack")), "trip_bcn");
check("within 36h slack before start matches",
    idOf(pickMatchingTrip([bcn], bcn.startDate - 30 * 60 * 60 * 1000, "")), "trip_bcn");
check("beyond slack β†’ unmatched",
    idOf(pickMatchingTrip([bcn], bcn.startDate - 48 * 60 * 60 * 1000, "")), null);
check("archived trip excluded",
    idOf(pickMatchingTrip([{ ...bcn, status: "archived" }], flightMidday, "Barcelona")), null);
check("ambiguous dates β†’ destination in haystack disambiguates",
    idOf(pickMatchingTrip([bcn, paris], flightMidday, "Athens (ATH) β†’ Barcelona (BCN)")), "trip_bcn");
check("ambiguous dates, no destination hint β†’ nearest start wins",
    idOf(pickMatchingTrip([bcn, paris], Date.parse("2026-06-12T00:00:00Z"), "")), "trip_paris");
check("slack constant is 36h", TRIP_MATCH_SLACK_MS, 36 * 60 * 60 * 1000);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
