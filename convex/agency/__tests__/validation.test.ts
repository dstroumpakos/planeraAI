import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPasswordPolicy,
  normalizeCredentialFields,
  normalizeCurrency,
  normalizeEmail,
  normalizeIata,
  slugify,
  validateDateRange,
  validateParty,
  MAX_SEARCH_HORIZON_DAYS,
  MAX_TRIP_NIGHTS,
} from "../validation";

const NOW = Date.parse("2026-08-30T11:30:00Z");
const day = (n: number) =>
  new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

test("emails are lowercased and trimmed", () => {
  assert.equal(normalizeEmail("  Agent@Example.COM "), "agent@example.com");
});

test("malformed emails are rejected", () => {
  for (const bad of ["", "no-at-sign", "a@b", "a@@b.com", "spaces in@x.com"]) {
    assert.throws(() => normalizeEmail(bad), /invalid email/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("password policy demands length and variety", () => {
  assert.throws(() => assertPasswordPolicy("Short1!"), /at least 12/);
  assert.throws(() => assertPasswordPolicy("alllowercaseletters"), /mix upper case/);
  assert.throws(() => assertPasswordPolicy("password123"), /at least 12|too common/);
  assert.doesNotThrow(() => assertPasswordPolicy("Correct-Horse-42"));
});

test("a password may not embed the account's own email local part", () => {
  assert.throws(
    () => assertPasswordPolicy("dionysis-Travel-9", "dionysis@planeraai.app"),
    /must not contain your email/,
  );
});

test("slugs are url-safe and strip accents", () => {
  assert.equal(slugify("Aegean  Travel & Co."), "aegean-travel-co");
  assert.equal(slugify("Voyages Été"), "voyages-ete");
});

test("a Greek agency name still produces a usable slug", () => {
  // The first market is Greece; NFD alone leaves Greek letters intact, which
  // used to slug to the empty string and block registration outright.
  assert.equal(slugify("Ταξίδια Ελλάς"), "taxidia-ellas");
  assert.equal(slugify("Αιγαίον Travel"), "aigaion-travel");
});

test("a name with nothing transliterable falls back instead of throwing", () => {
  assert.equal(slugify("!!!"), "agency");
  assert.equal(slugify("日本"), "agency");
});

test("IATA and currency codes are normalised and checked", () => {
  assert.equal(normalizeIata(" ath "), "ATH");
  assert.equal(normalizeCurrency("eur"), "EUR");
  assert.throws(() => normalizeIata("ATHENS"), /3-letter IATA/);
  assert.throws(() => normalizeCurrency("EUROS"), /ISO 4217/);
});

// ── Dates ───────────────────────────────────────────────────────────────────

test("a same-day departure is allowed but yesterday is not", () => {
  assert.doesNotThrow(() => validateDateRange(day(0), undefined, NOW));
  assert.throws(() => validateDateRange(day(-1), undefined, NOW), /in the past/);
});

test("return before departure is rejected, and nights are counted", () => {
  assert.throws(() => validateDateRange(day(10), day(9), NOW), /before the departure/);
  const range = validateDateRange(day(10), day(14), NOW);
  assert.equal(range.nights, 4);
});

test("absurd horizons and trip lengths are refused before a supplier is called", () => {
  assert.throws(
    () => validateDateRange(day(MAX_SEARCH_HORIZON_DAYS + 1), undefined, NOW),
    /days ahead/,
  );
  assert.throws(
    () => validateDateRange(day(1), day(1 + MAX_TRIP_NIGHTS + 1), NOW),
    /cannot exceed/,
  );
});

test("date shape is enforced", () => {
  assert.throws(() => validateDateRange("30-08-2026", undefined, NOW), /YYYY-MM-DD/);
});

// ── Party ───────────────────────────────────────────────────────────────────

test("party size is bounded and travelers are totalled", () => {
  const p = validateParty(2, [4, 9]);
  assert.equal(p.travelers, 4);
  assert.throws(() => validateParty(0, []), /between 1 and/);
  assert.throws(() => validateParty(2, [18]), /between 0 and 17/);
  assert.throws(() => validateParty(2.5, []), /between 1 and/);
});

// ── Credentials ─────────────────────────────────────────────────────────────

test("credential fields are trimmed and bounded", () => {
  assert.deepEqual(normalizeCredentialFields({ apiKey: "  duffel_test_abc  " }), {
    apiKey: "duffel_test_abc",
  });
  assert.throws(() => normalizeCredentialFields({}), /credentials are required/);
  assert.throws(() => normalizeCredentialFields({ apiKey: "   " }), /is empty/);
  assert.throws(() => normalizeCredentialFields({ "bad key": "x" }), /invalid credential field/);
  assert.throws(
    () => normalizeCredentialFields({ apiKey: "x".repeat(4097) }),
    /too long/,
  );
});
