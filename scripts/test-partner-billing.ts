/**
 * Unit checks for supplier listing billing (€20/month + VAT).
 *
 * What these guard: the VAT a supplier is charged and the line printed on the
 * Τιμολόγιο must agree, a mistyped ΑΦΜ must be caught before it reaches
 * myDATA, and an unpaid (or lapsed) supplier must never be listed while a
 * grandfathered one always is.
 *
 *   npx tsx scripts/test-partner-billing.ts
 */

import {
  isValidGreekAfm,
  normalizeVatNumber,
  vatBreakdown,
  vatExemptionNote,
  vatTreatment,
  viesCountryCode,
} from "../convex/lib/partnerVat";
import { partnerListingActive } from "../convex/lib/partnerListingAccess";

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  PASS", name);
  else {
    failed++;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

console.log("ΑΦΜ checksum");
check("valid ΑΦΜ accepted", isValidGreekAfm("123456783"));
check("wrong check digit rejected", !isValidGreekAfm("123456789"));
check("8 digits rejected", !isValidGreekAfm("12345678"));
check("all zeros rejected", !isValidGreekAfm("000000000"));
check("letters rejected", !isValidGreekAfm("12345678A"));

console.log("VAT number normalisation");
check("strips EL prefix and spaces", normalizeVatNumber("EL 123 456 783", "GR") === "123456783");
check("strips GR prefix", normalizeVatNumber("gr123456783", "GR") === "123456783");
check("strips DE prefix and dashes", normalizeVatNumber("DE-123.456.789", "DE") === "123456789");
check("leaves a bare number alone", normalizeVatNumber("123456783", "GR") === "123456783");
check("VIES uses EL for Greece", viesCountryCode("gr") === "EL" && viesCountryCode("CY") === "CY");

console.log("VAT treatment");
check("Greece is domestic", vatTreatment("GR") === "domestic");
check("Cyprus is reverse charge", vatTreatment("CY") === "reverse_charge");
check("Albania is outside the EU", vatTreatment("AL") === "outside_eu");
const gr = vatBreakdown(2000, "GR");
check("€20 + 24% = €24.80", gr.vatMinor === 480 && gr.totalMinor === 2480 && gr.ratePct === 24, gr);
const cy = vatBreakdown(2000, "CY");
check("reverse charge adds no VAT", cy.vatMinor === 0 && cy.totalMinor === 2000, cy);
check("Greek invoice carries no exemption note", vatExemptionNote("GR") === undefined);
check("EU invoice carries the reverse-charge note", /Αντίστροφη/.test(vatExemptionNote("IT") ?? ""));
check("non-EU invoice carries the out-of-scope note", /Εκτός πεδίου/.test(vatExemptionNote("AL") ?? ""));

console.log("Listing access");
const now = Date.UTC(2026, 9, 13);
const day = 24 * 60 * 60 * 1000;
check("grandfathered supplier always listed", partnerListingActive({}, now));
check("waived supplier listed", partnerListingActive({ billingRequired: false }, now));
check("new supplier without subscription not listed", !partnerListingActive({ billingRequired: true }, now));
check(
  "active subscription listed",
  partnerListingActive({ billingRequired: true, subscriptionStatus: "active", subscriptionPeriodEnd: now + 20 * day }, now)
);
check(
  "past_due still listed while Stripe retries",
  partnerListingActive({ billingRequired: true, subscriptionStatus: "past_due", subscriptionPeriodEnd: now + day }, now)
);
check(
  "canceled not listed",
  !partnerListingActive({ billingRequired: true, subscriptionStatus: "canceled", subscriptionPeriodEnd: now + day }, now)
);
check(
  "incomplete (first payment failed) not listed",
  !partnerListingActive({ billingRequired: true, subscriptionStatus: "incomplete", subscriptionPeriodEnd: now + 30 * day }, now)
);
check(
  "missed cancellation webhook: period long over → not listed",
  !partnerListingActive({ billingRequired: true, subscriptionStatus: "active", subscriptionPeriodEnd: now - 10 * day }, now)
);
check(
  "renewal webhook a day late → still listed",
  partnerListingActive({ billingRequired: true, subscriptionStatus: "active", subscriptionPeriodEnd: now - day }, now)
);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
