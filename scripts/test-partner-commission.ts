/**
 * Unit checks for commission partnerships (convex/lib/partnerCommission.ts).
 *
 * What these guard: the text a supplier signs is deterministic (same inputs,
 * same SHA-256), the money is right (refunds, cancellations, the attribution
 * window), and a Santorini experience shows on Santorini trips under every
 * name travellers use, but not on every Greek trip.
 *
 *   npx tsx scripts/test-partner-commission.ts
 */

import { createHash } from "node:crypto";
import {
  DEFAULT_TERMS,
  agreementPlainText,
  agreementReference,
  athensMonthKey,
  commissionMinor,
  leadReference,
  listingMatchesDestination,
  previousMonthKey,
  statementLines,
  validateParty,
  validateTerms,
  withReferral,
  withinAttribution,
} from "../convex/lib/partnerCommission";
import { partnerListingActive } from "../convex/lib/partnerListingAccess";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const DAY = 86_400_000;
const partner = validateParty({
  legalName: "Santorini Experts",
  vatNumber: "el800555740",
  address: "PB 5146 Kamari, 84700 Santorini, Greece",
  representative: "Kathrin  Vogel",
  representativeTitle: "Managing Director",
  email: "Info@SantoriniExperts.com",
});

console.log("Agreement text");
const text = agreementPlainText({ reference: "PLN-AGR-0001", templateVersion: "2026-10", terms: { ...DEFAULT_TERMS, commissionPct: 12.5 }, partner });
const again = agreementPlainText({ reference: "PLN-AGR-0001", templateVersion: "2026-10", terms: { ...DEFAULT_TERMS, commissionPct: 12.5 }, partner });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
check("same inputs give the same hash", sha(text) === sha(again));
check("different rate gives a different hash", sha(text) !== sha(agreementPlainText({ reference: "PLN-AGR-0001", templateVersion: "2026-10", terms: DEFAULT_TERMS, partner })));
check("rate is printed", text.includes("12.5% of the Booking Value"));
check("partner party cleaned", text.includes("VAT EL800555740") && text.includes("Kathrin Vogel, Managing Director") && text.includes("info@santoriniexperts.com"));
check("Planera party present", text.includes("ΑΦΜ 170540719") && text.includes("ΚΕΦΟΔΕ Αττικής"));
check("Athens courts", text.includes("courts of Athens"));
check("no dash punctuation", !/[–—]| - /.test(text), text.match(/.{20}[–—].{20}/)?.[0]);
check("15 sections", (text.match(/^\d+\. /gm) ?? []).length === 15);
check("reference padded", agreementReference(7) === "PLN-AGR-0007");

console.log("Terms validation");
check("defaults valid", !throws(() => validateTerms(DEFAULT_TERMS)));
check("0% rejected", throws(() => validateTerms({ ...DEFAULT_TERMS, commissionPct: 0 })));
check("60% rejected", throws(() => validateTerms({ ...DEFAULT_TERMS, commissionPct: 60 })));
check("fractional days rejected", throws(() => validateTerms({ ...DEFAULT_TERMS, attributionDays: 30.5 })));
check("rate rounded to 2dp", validateTerms({ ...DEFAULT_TERMS, commissionPct: 12.345 }).commissionPct === 12.35);
check("bad partner email rejected", throws(() => validateParty({ ...partner, email: "nope" })));

console.log("Commission maths");
check("10% of €1,000", commissionMinor(10, 100_000) === 10_000);
check("partial refund", commissionMinor(10, 100_000, 40_000) === 6_000);
check("refund above value is zero", commissionMinor(10, 100_000, 150_000) === 0);
check("rounding to cents", commissionMinor(12.5, 33_333) === 4_167);
const t0 = Date.UTC(2026, 9, 20);
check("inside window", withinAttribution(t0, t0 + 89 * DAY, 90));
check("outside window", !withinAttribution(t0, t0 + 91 * DAY, 90));
check("booked days before request is not attributed", !withinAttribution(t0, t0 - 3 * DAY, 90));

console.log("Months and statements");
check("Athens month at UTC midnight edge", athensMonthKey(Date.UTC(2026, 9, 31, 22, 30)) === "2026-11");
check("previous of January", previousMonthKey("2027-01") === "2026-12");
const base = { productTitle: "Sunset sail", contactName: "A", commissionPct: 10, attributionDays: 90 };
const { lines, totalMinor } = statementLines(
  [
    { ...base, _id: "1", reference: "PLN-AAAA", createdAt: t0, bookedAt: Date.UTC(2026, 10, 5), status: "booked", bookingValueMinor: 120_000 },
    { ...base, _id: "2", reference: "PLN-BBBB", createdAt: t0, bookedAt: Date.UTC(2026, 10, 6), status: "booked", bookingValueMinor: 50_000, refundedMinor: 10_000 },
    { ...base, _id: "3", reference: "PLN-CCCC", createdAt: t0, bookedAt: Date.UTC(2026, 10, 7), status: "cancelled", bookingValueMinor: 80_000 },
    { ...base, _id: "4", reference: "PLN-DDDD", createdAt: t0, bookedAt: Date.UTC(2026, 11, 2), status: "booked", bookingValueMinor: 99_000 },
    { ...base, _id: "5", reference: "PLN-EEEE", createdAt: t0 - 200 * DAY, bookedAt: Date.UTC(2026, 10, 8), status: "booked", bookingValueMinor: 99_000 },
    { ...base, _id: "6", reference: "PLN-FFFF", createdAt: t0, status: "quoted" },
  ],
  "2026-11"
);
check("only November, in-window bookings", lines.map((l) => l.reference).join() === "PLN-AAAA,PLN-BBBB,PLN-CCCC", lines.map((l) => l.reference));
check("cancelled line earns nothing", lines.find((l) => l.reference === "PLN-CCCC")?.commissionMinor === 0);
check("statement total", totalMinor === 12_000 + 4_000, totalMinor);

console.log("Destination matching");
const se = { city: "Santorini", destination: "Santorini, Greece" };
for (const trip of ["Santorini, Greece", "Σαντορίνη", "Σαντορινη, Ελλάδα", "Thira", "Oia, Santorini", "Fira", "Θήρα"]) {
  check(`Santorini listing on "${trip}"`, listingMatchesDestination(trip, se));
}
check("Oia listing on a Santorini trip", listingMatchesDestination("Santorini, Greece", { city: "Oia" }));
check("not on Mykonos", !listingMatchesDestination("Mykonos, Greece", se));
check("not on Athens", !listingMatchesDestination("Athens, Greece", se));
check("country-only listing never matches", !listingMatchesDestination("Santorini, Greece", { destination: "Greece" }));
check("unknown city matches by word", listingMatchesDestination("Tirana, Albania", { city: "Tirana" }));
check("unknown city no partial word", !listingMatchesDestination("Paris, France", { city: "Par" }));
check("Albania tour not on Santorini", !listingMatchesDestination("Santorini, Greece", { destination: "Albania", city: "Tirana" }));

console.log("Misc");
check("lead reference shape", /^PLN-[2-9A-HJ-NP-Z]{4}$/.test(leadReference([0, 31, 200, 255])));
const ref = withReferral("https://www.santoriniexperts.com/tours?x=1");
check("referral tags added, query kept", !!ref && ref.includes("x=1") && ref.includes("utm_source=planera") && ref.includes("ref=planera"));
check("bad url passes through", withReferral("not a url") === "not a url");
check("commission lifts the fee", partnerListingActive({ billingRequired: true, commission: { agreementId: "x" } }));
check("fee still applies without it", !partnerListingActive({ billingRequired: true }));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
