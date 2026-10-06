import { test } from "node:test";
import assert from "node:assert/strict";
import { duffelConnector } from "../connectors/duffel";
import type { NormalizedFlightOffer } from "../model/types";
import type { SupplierCredentials } from "../connectors/types";

const sandboxCreds: SupplierCredentials = {
  scheme: "api_key",
  environment: "sandbox",
  fields: { apiKey: "duffel_test_abc123" },
};

const OFFER = {
  id: "off_0000AaBbCc",
  total_amount: "412.80",
  total_currency: "EUR",
  tax_amount: "62.80",
  expires_at: "2099-01-01T00:00:00Z",
  owner: { iata_code: "A3", name: "Aegean Airlines" },
  conditions: {
    refund_before_departure: { allowed: false, penalty_amount: null },
    change_before_departure: { allowed: true, penalty_amount: "40.00", penalty_currency: "EUR" },
  },
  slices: [
    {
      origin: { iata_code: "ATH" },
      destination: { iata_code: "CDG" },
      duration: "PT3H50M",
      segments: [
        {
          origin: { iata_code: "ATH" },
          destination: { iata_code: "CDG" },
          departing_at: "2026-09-10T07:15:00",
          arriving_at: "2026-09-10T10:05:00",
          duration: "PT3H50M",
          marketing_carrier: { iata_code: "A3" },
          marketing_carrier_flight_number: "610",
          passengers: [
            {
              cabin_class: "economy",
              baggages: [
                { type: "carry_on", quantity: 1 },
                { type: "checked", quantity: 1 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

function withFetch<T>(stub: FetchStub, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = stub;
  return run().finally(() => {
    (globalThis as { fetch: unknown }).fetch = original;
  });
}

const respond = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

test("normalises a Duffel offer into the canonical model", async () => {
  let seenUrl = "";
  let seenBody: any = null;
  const offers = await withFetch(
    async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      return respond({ data: { offers: [OFFER] } });
    },
    () =>
      duffelConnector.search(sandboxCreds, {
        kind: "flight",
        originIata: "ATH",
        destinationIata: "CDG",
        departDate: "2026-09-10",
        adults: 2,
        childrenAges: [7],
        sellCurrency: "EUR",
      }),
  );

  assert.match(seenUrl, /\/air\/offer_requests\?return_offers=false/);
  assert.equal(seenBody.data.passengers.length, 3, "2 adults + 1 child");
  assert.deepEqual(seenBody.data.passengers[2], { age: 7 });

  assert.equal(offers.length, 1);
  const offer = offers[0] as NormalizedFlightOffer;
  assert.equal(offer.kind, "flight");
  assert.equal(offer.connectorId, "duffel");
  assert.equal(offer.offerId, "duffel:off_0000AaBbCc");
  // base must EXCLUDE tax — the pricing engine adds taxes back on top.
  assert.equal(offer.cost.base.amountMinor, 35000);
  assert.equal(offer.cost.taxes.amountMinor, 6280);
  assert.equal(offer.cost.base.amountMinor + offer.cost.taxes.amountMinor, 41280);
  assert.equal(offer.cost.rateType, "net");
  assert.equal(offer.outboundStops, 0);
  assert.equal(offer.totalDurationMinutes, 230);
  assert.equal(offer.baggage.checked, 1);
  assert.equal(offer.conditions.refundable, false);
  assert.equal(offer.conditions.changeable, true);
  assert.equal(offer.conditions.changePenalty?.amountMinor, 4000);
  assert.equal(offer.revalidationToken, "off_0000AaBbCc", "needed to re-price later");
});

test("a return search sends two slices and counts both legs", async () => {
  const twoWay = {
    ...OFFER,
    slices: [
      OFFER.slices[0],
      {
        origin: { iata_code: "CDG" },
        destination: { iata_code: "ATH" },
        duration: "PT3H40M",
        segments: [
          {
            origin: { iata_code: "CDG" },
            destination: { iata_code: "ATH" },
            departing_at: "2026-09-14T18:00:00",
            arriving_at: "2026-09-14T21:40:00",
            duration: "PT3H40M",
            marketing_carrier: { iata_code: "A3" },
            passengers: [{ baggages: [{ type: "checked", quantity: 1 }] }],
          },
        ],
      },
    ],
  };
  let body: any = null;
  const offers = await withFetch(
    async (_url, init) => {
      body = JSON.parse(String(init.body));
      return respond({ data: { offers: [twoWay] } });
    },
    () =>
      duffelConnector.search(sandboxCreds, {
        kind: "flight",
        originIata: "ATH",
        destinationIata: "CDG",
        departDate: "2026-09-10",
        returnDate: "2026-09-14",
        adults: 1,
        childrenAges: [],
        sellCurrency: "EUR",
      }),
  );
  assert.equal(body.data.slices.length, 2);
  assert.equal(body.data.slices[1].origin, "CDG");
  const offer = offers[0] as NormalizedFlightOffer;
  assert.equal(offer.inbound?.length, 1);
  assert.equal(offer.totalDurationMinutes, 230 + 220);
});

test("one malformed offer does not lose the whole result set", async () => {
  const offers = await withFetch(
    async () =>
      respond({
        data: {
          offers: [
            { id: "off_broken", total_amount: "not-a-number", total_currency: "EUR", slices: [] },
            OFFER,
          ],
        },
      }),
    () =>
      duffelConnector.search(sandboxCreds, {
        kind: "flight",
        originIata: "ATH",
        destinationIata: "CDG",
        departDate: "2026-09-10",
        adults: 1,
        childrenAges: [],
        sellCurrency: "EUR",
      }),
  );
  assert.equal(offers.length, 1, "the good offer still comes through");
});

test("a LIVE token on a sandbox connection is refused before any request", async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    async () => {
      await assert.rejects(
        () =>
          duffelConnector.search(
            { ...sandboxCreds, fields: { apiKey: "duffel_live_REAL" } },
            {
              kind: "flight",
              originIata: "ATH",
              destinationIata: "CDG",
              departDate: "2026-09-10",
              adults: 1,
              childrenAges: [],
              sellCurrency: "EUR",
            },
          ),
        /LIVE token but the connection is set to sandbox/,
      );
    },
  );
  assert.equal(called, false, "a live-token mistake must never reach the network");
});

test("a non-flight search is a no-op, not an error", async () => {
  const offers = await duffelConnector.search(sandboxCreds, {
    kind: "hotel",
    adults: 1,
    childrenAges: [],
    sellCurrency: "EUR",
  });
  assert.deepEqual(offers, []);
});

test("revalidation reports a vanished fare as unavailable, not as a crash", async () => {
  const result = await withFetch(
    async () => respond({ errors: [{ title: "not found" }] }, 404),
    () => duffelConnector.revalidate(sandboxCreds, "off_gone"),
  );
  assert.equal(result.stillAvailable, false);
  assert.match(result.message ?? "", /no longer available/);
});

test("revalidation RETHROWS a 500 so it is treated as unverifiable, not unavailable", async () => {
  await withFetch(
    async () => respond({ errors: [{ title: "server error" }] }, 500),
    async () => {
      await assert.rejects(() => duffelConnector.revalidate(sandboxCreds, "off_x"));
    },
  );
});

test("a healthy credential reports healthy; a rejected one reports why", async () => {
  const good = await withFetch(
    async () => respond({ data: [] }),
    () => duffelConnector.healthCheck(sandboxCreds),
  );
  assert.equal(good.healthy, true);

  const bad = await withFetch(
    async () => respond({ errors: [{ title: "Access token is invalid" }] }, 401),
    () => duffelConnector.healthCheck(sandboxCreds),
  );
  assert.equal(bad.healthy, false);
  assert.match(bad.message ?? "", /rejected this access token/);
});

test("Duffel books on the agency's own account; cancellation stays with the agency", () => {
  // Orders are created only on an explicit agent action, paid from the
  // AGENCY's Duffel balance — the agency is still the seller.
  assert.equal(duffelConnector.capabilities.supports.createBooking, true);
  assert.equal(typeof duffelConnector.createBooking, "function");
  assert.equal(duffelConnector.capabilities.supports.cancelBooking, false);
});


test("a busy route is paged in sorted, never downloaded whole", async () => {
  const urls: string[] = [];
  const cheap = { ...OFFER, id: "off_cheap" };
  const fast = { ...OFFER, id: "off_fast" };
  const offers = await withFetch(
    async (url) => {
      urls.push(url);
      if (url.includes("/air/offer_requests")) return respond({ data: { id: "orq_1" } });
      if (url.includes("sort=total_amount")) return respond({ data: [cheap, fast] });
      if (url.includes("sort=total_duration")) return respond({ data: [fast] });
      return respond({}, 404);
    },
    () =>
      duffelConnector.search(sandboxCreds, {
        kind: "flight",
        originIata: "ATH",
        destinationIata: "FCO",
        departDate: "2026-10-10",
        adults: 1,
        childrenAges: [],
        sellCurrency: "EUR",
      }),
  );
  assert.ok(urls.some((u) => u.includes("offer_request_id=orq_1") && u.includes("limit=50")));
  assert.deepEqual(
    offers.map((o) => o.supplierOfferId).sort(),
    ["off_cheap", "off_fast"],
    "deduplicated across the two lists",
  );
});
