import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scrubForStorage,
  scrubOffer,
  selectedOffers,
  toAgentPackages,
  toCustomerPackages,
} from "../quoteView";
import { money } from "../model/types";
import type {
  InternalFinancials,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  TravelPackage,
} from "../model/types";

const EUR = "EUR";

const financials = (customer: number): InternalFinancials => ({
  supplierCost: money(10000, EUR),
  markup: money(1500, EUR),
  serviceFee: money(500, EUR),
  expectedCommission: money(700, EUR),
  customerPrice: money(customer, EUR),
  expectedGrossProfit: money(2700, EUR),
});

const flight = (id: string): NormalizedFlightOffer => ({
  kind: "flight",
  offerId: id,
  connectorId: "mock-air",
  supplierOfferId: id,
  cost: { rateType: "net", base: money(10000, EUR), taxes: money(1800, EUR) },
  conditions: { refundable: false, changeable: true },
  revalidationToken: "PROVIDER-LOCKED-TOKEN",
  quotedAt: 1,
  outbound: [
    {
      fromIata: "ATH",
      toIata: "CDG",
      departISO: "2026-09-01T09:00:00",
      arriveISO: "2026-09-01T12:00:00",
      carrier: "MK",
      durationMinutes: 180,
    },
  ],
  outboundStops: 0,
  totalDurationMinutes: 180,
  cabinClass: "economy",
  baggage: { cabin: 1, checked: 1 },
  raw: { supplierSecretPayload: "should never leave the server" },
});

const hotel = (id: string): NormalizedHotelOffer => ({
  kind: "hotel",
  offerId: id,
  connectorId: "mock-hotel",
  supplierOfferId: id,
  cost: {
    rateType: "net",
    base: money(40000, EUR),
    taxes: money(4800, EUR),
    payAtProperty: [{ label: "City tax", amount: money(1200, EUR), mandatory: true }],
  },
  conditions: { refundable: true, changeable: true },
  revalidationToken: "HOTEL-TOKEN",
  quotedAt: 1,
  name: "Hotel Test",
  boardType: "breakfast",
  nights: 4,
  raw: { bigPayload: true },
});

const pkg = (tier: TravelPackage["tier"], total: number): TravelPackage => ({
  tier,
  lines: [
    { kind: "flight", offer: flight("mock-air:F1"), financials: financials(12000) },
    { kind: "hotel", offer: hotel("mock-hotel:H1"), financials: financials(48000) },
  ],
  foodBudget: { perDayPerPerson: money(4500, EUR), days: 4, travelers: 2, isEstimate: true },
  totals: { internal: financials(total), payAtProperty: [money(1200, EUR)] },
  score: 0.8,
});

const packages = [pkg("basic", 60000), pkg("comfort", 72000), pkg("premium", 95000)];

test("storage keeps the revalidation token but drops the provider payload", () => {
  const stored = scrubForStorage(packages);
  for (const p of stored) {
    for (const l of p.lines) {
      assert.equal((l.offer as { raw?: unknown }).raw, undefined, "raw payload must not be stored");
      assert.ok(l.offer.revalidationToken, "the quote could never be re-priced without this");
    }
  }
});

test("CUSTOMER VIEW: internal financials are absent, not merely hidden", () => {
  const customer = toCustomerPackages(packages);
  const serialised = JSON.stringify(customer);
  for (const leak of ["supplierCost", "markup", "serviceFee", "expectedCommission", "expectedGrossProfit"]) {
    assert.ok(!serialised.includes(leak), `${leak} must never reach a traveller`);
  }
  // The one number they should see survives.
  assert.equal(customer[0].total.amountMinor, 60000);
  assert.equal(customer[0].lines[0].price.amountMinor, 12000);
});

test("CUSTOMER VIEW: provider-locked booking tokens never travel outward", () => {
  const serialised = JSON.stringify(toCustomerPackages(packages));
  assert.ok(!serialised.includes("PROVIDER-LOCKED-TOKEN"));
  assert.ok(!serialised.includes("HOTEL-TOKEN"));
  assert.ok(!serialised.includes("supplierSecretPayload"));
});

test("customer view keeps the disclosures a traveller is owed", () => {
  const customer = toCustomerPackages(packages);
  assert.equal(customer[0].payAtProperty[0].amountMinor, 1200, "pay-at-property must be disclosed");
  assert.equal(customer[0].foodBudget?.isEstimate, true, "food budget must stay flagged as an estimate");
});

test("AGENT VIEW: keeps the financials, still drops the raw payload", () => {
  const agent = toAgentPackages(packages);
  assert.equal(agent[0].totals.internal.expectedGrossProfit.amountMinor, 2700);
  assert.equal((agent[0].lines[0].offer as { raw?: unknown }).raw, undefined);
});

test("selected offers are deduplicated across tiers", () => {
  const offers = selectedOffers(packages);
  // Three tiers share the same two offers in this fixture.
  assert.equal(offers.length, 2);
  assert.deepEqual(
    offers.map((o) => o.offerId).sort(),
    ["mock-air:F1", "mock-hotel:H1"],
  );
});

test("scrubOffer does not mutate its input", () => {
  const original = flight("mock-air:F9");
  const scrubbed = scrubOffer(original, false);
  assert.equal(scrubbed.revalidationToken, undefined);
  assert.equal(original.revalidationToken, "PROVIDER-LOCKED-TOKEN", "the stored offer is untouched");
  assert.ok((original as { raw?: unknown }).raw);
});
