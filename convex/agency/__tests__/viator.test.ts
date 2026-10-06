/**
 * Viator, checked against Viator's own OpenAPI spec (Partner API 2.0).
 * Payload shapes below mirror the spec's schemas: DestinationDetails,
 * ProductSummary / ProductSearchPricing, CheckAvailabilityResponse / PriceObject.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONNECTOR_SPECS } from "../connectors/providers";
import { activityDate, readViatorToken, viatorPaxMix } from "../connectors/providers";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";
import type { NormalizedActivityOffer } from "../model/types";

const viator = CONNECTOR_SPECS.find((s) => s.id === "viator")!;
const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "k" } };
const HOST = "https://api.sandbox.viator.com";

const query: SearchQuery = {
  kind: "activity",
  destinationIata: "FCO",
  providerDestinationId: "511",
  departDate: "2026-11-10",
  returnDate: "2026-11-15",
  adults: 2,
  childrenAges: [7, 1],
  sellCurrency: "EUR",
};

test("destinations match on iataCodes — an ARRAY in the spec", () => {
  const out = viator.destinations!.map(
    {
      destinations: [
        { destinationId: 511, name: "Rome", type: "CITY", iataCodes: ["FCO", "cia"] },
        { destinationId: 22, name: "Santorini", type: "ISLAND" },
        { destinationId: 9, name: "Trastevere", type: "NEIGHBORHOOD" },
      ],
    },
    { iata: "FCO", name: "Rome" } as never,
  );
  assert.deepEqual(out[0].iataCodes, ["FCO", "CIA"]);
  assert.equal(out[1].type, "city", "an island is a place people stay");
  assert.equal(out[2].type, "poi");
});

test("search prices per traveller and carries what a price check needs", () => {
  const call = viator.search!.request(creds, query, HOST, undefined)!;
  const body = call.body as { filtering: { destination: string }; currency: string };
  assert.equal(body.filtering.destination, "511");
  assert.equal(body.currency, "EUR");

  const offers = viator.search!.map(
    {
      products: [
        {
          productCode: "5010SYDNEY",
          title: "Colosseum Skip-the-Line",
          pricing: { summary: { fromPrice: 40 }, currency: "EUR" },
          flags: ["FREE_CANCELLATION"],
          reviews: { combinedAverageRating: 4.6, totalReviews: 10 },
        },
      ],
    },
    query,
    undefined,
  ) as NormalizedActivityOffer[];
  const o = offers[0];
  assert.equal(o.cost.base.amountMinor, 4000 * 4, "4 travellers");
  assert.equal(o.cost.rateType, "commissionable");
  assert.equal(o.cost.markupForbidden, true);
  assert.equal(o.conditions.refundable, true);

  const t = readViatorToken(o.revalidationToken!);
  assert.equal(t.productCode, "5010SYDNEY");
  assert.equal(t.travelDate, "2026-11-11", "first full day of the stay");
  assert.deepEqual(t.paxMix, [
    { ageBand: "ADULT", numberOfTravelers: 2 },
    { ageBand: "CHILD", numberOfTravelers: 1 },
    { ageBand: "INFANT", numberOfTravelers: 1 },
  ]);
  assert.equal(t.refundable, true);
});

test("a merchant account's NET price is bought net, so the agency may mark it up", () => {
  const [o] = viator.search!.map(
    {
      products: [
        {
          productCode: "P1",
          title: "Vatican",
          pricing: { summary: { fromPrice: 50 }, currency: "EUR", partnerNetFromPrice: 38 },
          flags: [],
        },
      ],
    },
    { ...query, childrenAges: [] },
    undefined,
  ) as NormalizedActivityOffer[];
  assert.equal(o.cost.rateType, "net");
  assert.equal(o.cost.markupForbidden, undefined);
  assert.equal(o.cost.base.amountMinor, 3800 * 2);
  assert.equal(readViatorToken(o.revalidationToken!).net, true);
});

test("availability/check picks the cheapest AVAILABLE option and keeps it in the token", () => {
  const token = `viator:${JSON.stringify({
    productCode: "P1",
    travelDate: "2026-11-11",
    paxMix: [{ ageBand: "ADULT", numberOfTravelers: 2 }],
    net: false,
    currency: "EUR",
    refundable: true,
  })}`;
  const call = viator.revalidate!.request(creds, token, HOST);
  assert.equal(call.url, `${HOST}/partner/availability/check`);
  assert.deepEqual((call.body as { paxMix: unknown }).paxMix, [{ ageBand: "ADULT", numberOfTravelers: 2 }]);

  const r = viator.revalidate!.map(
    {
      currency: "EUR",
      productCode: "P1",
      travelDate: "2026-11-11",
      bookableItems: [
        { productOptionCode: "SOLD", available: false, unavailableReason: "SOLD_OUT" },
        { productOptionCode: "A", startTime: "10:00", available: true, totalPrice: { price: { recommendedRetailPrice: 90, commission: 9, partnerTotalPrice: 81 } } },
        { productOptionCode: "B", startTime: "14:00", available: true, totalPrice: { price: { recommendedRetailPrice: 80, commission: 8, partnerTotalPrice: 72 } } },
      ],
    },
    token,
  );
  assert.equal(r.stillAvailable, true);
  const offer = r.offer as NormalizedActivityOffer;
  assert.equal(offer.cost.base.amountMinor, 8000, "retail on the commission model");
  assert.equal(offer.cost.commissionRate, 0.1);
  assert.equal(offer.conditions.refundable, true, "not erased by the price check");
  const next = readViatorToken(offer.revalidationToken!);
  assert.equal(next.productOptionCode, "B");
  assert.equal(next.startTime, "14:00");

  const none = viator.revalidate!.map(
    { currency: "EUR", bookableItems: [{ available: false, unavailableReason: "SOLD_OUT" }] },
    token,
  );
  assert.equal(none.stillAvailable, false);
  assert.match(none.message!, /SOLD_OUT/);
});

test("helpers: activity day and age bands", () => {
  assert.equal(activityDate({ departDate: "2026-11-10" }), "2026-11-10");
  assert.equal(activityDate({ departDate: "2026-11-10", returnDate: "2026-11-11" }), "2026-11-10");
  assert.deepEqual(viatorPaxMix({ adults: 1, childrenAges: [] }), [{ ageBand: "ADULT", numberOfTravelers: 1 }]);
});
