import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuote, resolvePricingRule, isQuoteExpired, revalidatedExpiry, DEFAULT_FOOD_BUDGET_MINOR, type PricingRuleRow, type BuildQuoteInput } from "../quote";
import { mockAirConnector, mockHotelConnector } from "../connectors/mock";
import type { NormalizedFlightOffer, NormalizedHotelOffer } from "../model/types";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "x" } };
const q: SearchQuery = { kind: "flight", originIata: "ATH", destinationIata: "CDG", departDate: "2026-09-01", adults: 2, childrenAges: [], sellCurrency: "EUR" };
const NOW = 1_800_000_000_000;

async function baseInput(rules: PricingRuleRow[] = []): Promise<BuildQuoteInput> {
  const flights = (await mockAirConnector.search(creds, q)) as NormalizedFlightOffer[];
  const hotels = (await mockHotelConnector.search(creds, { ...q, kind: "hotel" })) as NormalizedHotelOffer[];
  return {
    quoteId: "qte_test", agencyId: "agA", createdByUserId: "uA", currency: "EUR",
    searchParams: { origin: "ATH", destination: "CDG" }, days: 4, travelers: 2, destinationIata: "CDG",
    flights, hotels, rules, now: NOW, ttlMs: 30 * 60_000,
  };
}

test("builds three packages, each with a flight + hotel line", async () => {
  const quote = buildQuote(await baseInput());
  assert.equal(quote.packages.length, 3);
  for (const p of quote.packages) {
    assert.deepEqual(p.lines.map((l) => l.kind).sort(), ["flight", "hotel"]);
  }
});

test("package totals reconcile with the sum of its line financials", async () => {
  const quote = buildQuote(await baseInput());
  for (const p of quote.packages) {
    const sum = p.lines.reduce((a, l) => a + l.financials.customerPrice.amountMinor, 0);
    assert.equal(p.totals.internal.customerPrice.amountMinor, sum);
  }
});

test("tiers differ and premium costs more than basic", async () => {
  const quote = buildQuote(await baseInput());
  const [basic, comfort, premium] = quote.packages;
  const price = (p: typeof basic) => p.totals.internal.customerPrice.amountMinor;
  assert.ok(price(premium) > price(basic));
  const flightIds = new Set(quote.packages.map((p) => p.lines.find((l) => l.kind === "flight")!.offer.offerId));
  assert.equal(flightIds.size, 3); // three different flights
  assert.ok(comfort); // referenced
});

test("food budget is an ESTIMATE with the per-tier daily amount", async () => {
  const quote = buildQuote(await baseInput());
  for (const p of quote.packages) {
    assert.equal(p.foodBudget?.isEstimate, true);
    assert.equal(p.foodBudget?.perDayPerPerson.amountMinor, DEFAULT_FOOD_BUDGET_MINOR[p.tier]);
    assert.equal(p.foodBudget?.days, 4);
    assert.equal(p.foodBudget?.travelers, 2);
  }
});

test("quote carries an expiry and reports expiration", async () => {
  const quote = buildQuote(await baseInput());
  assert.equal(quote.expiresAt, NOW + 30 * 60_000);
  assert.equal(quote.status, "draft");
  assert.equal(isQuoteExpired(quote, NOW), false);
  assert.equal(isQuoteExpired(quote, quote.expiresAt), true);
});

test("markup rule flows into customer price (net rate)", async () => {
  const noRule = buildQuote(await baseInput([]));
  const withMarkup = buildQuote(await baseInput([{ scope: "agency", rule: { markupPct: 0.2 }, active: true }]));
  const basicNo = noRule.packages[0].lines.find((l) => l.kind === "flight")!.financials.customerPrice.amountMinor;
  const basicYes = withMarkup.packages[0].lines.find((l) => l.kind === "flight")!.financials.customerPrice.amountMinor;
  assert.ok(basicYes > basicNo, "20% markup raises the customer price");
});

test("resolvePricingRule: destination > supplier > agency default", () => {
  const rules: PricingRuleRow[] = [
    { scope: "agency", rule: { markupPct: 0.1 }, active: true },
    { scope: "supplier", selector: "mock-air", rule: { markupPct: 0.2 }, active: true },
    { scope: "destination", selector: "CDG", rule: { markupPct: 0.3 }, active: true },
  ];
  assert.equal(resolvePricingRule(rules, { connectorId: "mock-air", destinationIata: "CDG" }).markupPct, 0.3);
  assert.equal(resolvePricingRule(rules, { connectorId: "mock-air", destinationIata: "BCN" }).markupPct, 0.2);
  assert.equal(resolvePricingRule(rules, { connectorId: "other", destinationIata: "BCN" }).markupPct, 0.1);
  assert.deepEqual(resolvePricingRule([], { connectorId: "x" }), {});
});

// ── Revalidation restarts the clock ─────────────────────────────────────────

const HOUR = 3600_000;

test("a successful revalidation restarts the validity window", () => {
  const now = 1_700_000_000_000;
  // An expired quote is precisely the case that must recover: `send` refuses an
  // expired quote and tells the agent to revalidate it first.
  const expiredAt = now - 5 * HOUR;

  assert.equal(
    revalidatedExpiry({ stillValid: true, now, ttlMs: 24 * HOUR, currentExpiresAt: expiredAt }),
    now + 24 * HOUR,
  );
});

test("a failed revalidation does not buy the quote more time", () => {
  const now = 1_700_000_000_000;
  const expiredAt = now - 5 * HOUR;

  // An offer that is gone, or that no connector could verify, must leave the
  // quote exactly as expired as it was.
  assert.equal(
    revalidatedExpiry({ stillValid: false, now, ttlMs: 24 * HOUR, currentExpiresAt: expiredAt }),
    expiredAt,
  );
});

test("revalidation honours the tenant's own quote validity, not a default", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    revalidatedExpiry({ stillValid: true, now, ttlMs: 2 * HOUR, currentExpiresAt: now }),
    now + 2 * HOUR,
  );
});
