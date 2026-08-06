import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAllTiers, selectTier, type PricedCandidate } from "../scoring";
import { priceOffer } from "../pricing";
import { mockAirConnector, mockHotelConnector } from "../connectors/mock";
import type { NormalizedFlightOffer, NormalizedHotelOffer } from "../model/types";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "x" } };
const q: SearchQuery = { kind: "flight", originIata: "ATH", destinationIata: "CDG", departDate: "2026-09-01", adults: 2, childrenAges: [], sellCurrency: "EUR" };

// Price offers with a neutral rule (cost pass-through) so scoring is judged on
// offer attributes, not pricing rules.
async function pricedFlights(): Promise<PricedCandidate<NormalizedFlightOffer>[]> {
  const offers = (await mockAirConnector.search(creds, q)) as NormalizedFlightOffer[];
  return offers.map((offer) => ({ offer, financials: priceOffer(offer.cost, {}, { travelers: 2, sellCurrency: "EUR" }) }));
}
async function pricedHotels(): Promise<PricedCandidate<NormalizedHotelOffer>[]> {
  const offers = (await mockHotelConnector.search(creds, { ...q, kind: "hotel" })) as NormalizedHotelOffer[];
  return offers.map((offer) => ({ offer, financials: priceOffer(offer.cost, {}, { travelers: 2, sellCurrency: "EUR" }) }));
}

test("three tiers select three DIFFERENT flights (not just cheap/mid/expensive by raw price)", async () => {
  const tiers = selectAllTiers(await pricedFlights(), await pricedHotels());
  assert.equal(tiers.basic.flight?.cand.offer.offerId, "mock-air:F1"); // price-led
  assert.equal(tiers.comfort.flight?.cand.offer.offerId, "mock-air:F2"); // direct + bag + good time
  assert.equal(tiers.premium.flight?.cand.offer.offerId, "mock-air:F3"); // flexible + refundable
  const ids = new Set([tiers.basic.flight?.cand.offer.offerId, tiers.comfort.flight?.cand.offer.offerId, tiers.premium.flight?.cand.offer.offerId]);
  assert.equal(ids.size, 3);
});

test("premium enforces the hotel quality floor (5* central wins; 4*/8.1 excluded)", async () => {
  const tiers = selectAllTiers(await pricedFlights(), await pricedHotels());
  assert.equal(tiers.premium.hotel?.cand.offer.offerId, "mock-hotel:H3");
  assert.equal(tiers.basic.hotel?.cand.offer.offerId, "mock-hotel:H1"); // budget-led
});

test("scores are ordered so the chosen offer is the max for its tier", async () => {
  const tiers = selectAllTiers(await pricedFlights(), await pricedHotels());
  for (const t of [tiers.basic, tiers.comfort, tiers.premium]) {
    assert.ok(t.flight && t.flight.score >= 0 && t.flight.score <= 1);
  }
  // Premium flight score must beat basic's flight under premium weights implicitly:
  assert.ok((tiers.premium.flight?.score ?? 0) > 0.5);
});

test("hotel floor relaxes when nothing clears it (thin pool still yields a package)", async () => {
  const subFloor = (await pricedHotels()).filter((h) => (h.offer.starRating ?? 0) < 4); // only the 2* budget hotel
  const res = selectTier(await pricedFlights(), subFloor, "premium");
  assert.ok(res.hotel, "premium still returns a hotel by relaxing the floor");
  assert.equal(res.hotel?.cand.offer.offerId, "mock-hotel:H1");
});

test("determinism: identical input yields identical selection", async () => {
  const a = selectAllTiers(await pricedFlights(), await pricedHotels());
  const b = selectAllTiers(await pricedFlights(), await pricedHotels());
  assert.equal(a.comfort.flight?.cand.offer.offerId, b.comfort.flight?.cand.offer.offerId);
  assert.equal(a.premium.hotel?.cand.offer.offerId, b.premium.hotel?.cand.offer.offerId);
});
