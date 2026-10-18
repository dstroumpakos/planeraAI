/**
 * What a client's quote is built from, checked against real cases that went
 * wrong on the demo agency (ATH → BCN, 14–19 Nov):
 *
 * - a 5.0★ Viator tour with a handful of reviews scored a perfect 1.0 and beat
 *   the Sagrada Família, whose Tiqets rating had been divided by 10;
 * - the sandbox hotel was always 4 nights at a 4-night price on a 5-night trip,
 *   with a free-cancellation date already in the past.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityQuality, CONNECTOR_SPECS } from "../connectors/providers";
import { mockHotelConnector } from "../connectors/mock";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";
import type { NormalizedActivityOffer, NormalizedHotelOffer } from "../model/types";

test("a famous landmark outranks a perfect score from three reviews", () => {
  const niche = activityQuality(5, 5, 3)!;
  const landmark = activityQuality(4.6, 5, 40_000)!;
  assert.ok(landmark > niche, `landmark ${landmark} should beat niche ${niche}`);
  assert.ok(niche < 0.5);
  assert.ok(landmark > 0.75);
});

test("between two equally popular products, the better-rated one wins", () => {
  assert.ok(activityQuality(4.8, 5, 2_000)! > activityQuality(4.2, 5, 2_000)!);
});

test("no rating is unknown, not bad", () => {
  assert.equal(activityQuality(undefined, 5, 100), undefined);
  assert.equal(activityQuality(0, 5, 0), undefined);
  for (const q of [activityQuality(5, 5, 1e7)!, activityQuality(1, 5, 0)!]) {
    assert.ok(q >= 0 && q <= 1);
  }
});

const http = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

test("Tiqets ratings are out of 5 and carry their review count", async () => {
  const tiqets = CONNECTOR_SPECS.find((s) => s.id === "tiqets")!;
  const products = tiqets.search!.map(
    {
      products: [
        { id: 1, title: "Sagrada Familia", price: 27.6, currency: "EUR", sale_status: "available", ratings: { average: 4.6, total: 52_000 } },
      ],
    },
    { kind: "activity", adults: 2, childrenAges: [], sellCurrency: "EUR", providerDestinationId: "66342" },
    undefined,
  ) as NormalizedActivityOffer[];
  assert.equal(products.length, 1);
  assert.equal(products[0].rating, 4.6);
  assert.equal(products[0].reviewCount, 52_000);
  assert.ok(products[0].qualityScore! > 0.75, `got ${products[0].qualityScore}`);
  void http;
});

test("Viator asks for its featured order, not raw rating", () => {
  const viator = CONNECTOR_SPECS.find((s) => s.id === "viator")!;
  const req = viator.search!.request(
    { scheme: "api_key", environment: "sandbox", fields: { apiKey: "k" } },
    { kind: "activity", adults: 2, childrenAges: [], sellCurrency: "EUR", providerDestinationId: "562", departDate: "2026-11-14" },
    "https://api.viator.com",
    undefined,
  ) as unknown as { body: { sorting: { sort: string } } };
  assert.equal(req.body.sorting.sort, "DEFAULT");
});

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: {} };
const stay: SearchQuery = {
  kind: "hotel",
  destinationIata: "BCN",
  departDate: "2026-11-14",
  returnDate: "2026-11-19",
  adults: 2,
  childrenAges: [],
  rooms: 2,
  sellCurrency: "EUR",
};

test("sandbox hotels price the stay that was asked for", async () => {
  const offers = (await mockHotelConnector.search(creds, stay)) as NormalizedHotelOffer[];
  assert.ok(offers.length >= 5);
  for (const o of offers) {
    assert.equal(o.nights, 5);
    assert.ok(!/mock/i.test(o.name), o.name);
    assert.ok(o.name.includes("Barcelona"), o.name);
    if (o.freeCancellationUntilISO) assert.ok(o.freeCancellationUntilISO < "2026-11-14");
  }
  // 5 nights x 2 rooms of the cheapest (60.00/night).
  const h1 = offers.find((o) => o.offerId === "mock-hotel:H1")!;
  assert.equal(h1.cost.base.amountMinor, 6000 * 5 * 2);
});

test("sandbox hotels keep their 4-night default with no end date", async () => {
  const offers = (await mockHotelConnector.search(creds, { ...stay, returnDate: undefined, rooms: undefined })) as NormalizedHotelOffer[];
  assert.equal(offers[0].nights, 4);
  assert.equal(offers.find((o) => o.offerId === "mock-hotel:H2")!.cost.base.amountMinor, 46000);
});
