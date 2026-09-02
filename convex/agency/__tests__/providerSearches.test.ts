/**
 * Coverage for the searches added on top of the health-check-only catalogue:
 * Amadeus re-pricing, the richer Hotelbeds mapping, and the four connectors
 * built from public documentation (Expedia Rapid, Booking.com, Viator, Tiqets).
 *
 * None of these four has been run against a live account, which is exactly why
 * they are tested this hard here. The tests pin the two things that are ours to
 * get right regardless of what the provider returns:
 *
 *   1. the REQUEST we send — endpoint, required parameters, call sequence;
 *   2. the MONEY — base excluding tax, per-person prices multiplied out, and
 *      commissionable rates flagged so the pricing engine refuses a markup.
 *
 * A wrong response shape surfaces as a loud connector error. A wrong price
 * surfaces as an agency quoting a client too little, which nobody notices until
 * it is invoiced — so that is what carries the assertions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getConnector } from "../connectors/factory";
import type {
  NormalizedActivityOffer,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
} from "../model/types";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";

// ── Harness ────────────────────────────────────────────────────────────────

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

const creds = (fields: Record<string, string>): SupplierCredentials => ({
  scheme: "api_key",
  environment: "sandbox",
  fields,
});

/** A two-adults-one-child stay, which is what makes per-person maths visible. */
const stay = (over: Partial<SearchQuery> = {}): SearchQuery => ({
  kind: "hotel",
  destinationIata: "CDG",
  destinationCity: "Paris",
  departDate: "2027-03-10",
  returnDate: "2027-03-14",
  adults: 2,
  childrenAges: [9],
  sellCurrency: "EUR",
  ...over,
});

const tryJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/**
 * Record every call a connector makes, answering each from a queue.
 *
 * Token exchanges are answered separately and do NOT consume the queue: the
 * OAuth cache in `auth.ts` lives for the whole isolate, so whether a given test
 * performs a token call depends on which tests ran before it. Keying the queue
 * to API calls only makes each test independent of that ordering.
 */
function sequence(replies: unknown[]): { urls: string[]; bodies: unknown[]; stub: FetchStub } {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  let i = 0;
  const stub: FetchStub = async (url, init) => {
    urls.push(url);
    // OAuth token calls post a urlencoded form, not JSON, and a stub that
    // assumes otherwise throws inside fetchJson and reads as "unreachable".
    bodies.push(init.body ? tryJson(String(init.body)) : undefined);

    if (url.includes("/oauth2/token")) {
      return respond({ access_token: `tok-${Math.random()}`, expires_in: 1799 });
    }

    const reply = replies[Math.min(i, replies.length - 1)];
    i++;
    return respond(reply);
  };
  return { urls, bodies, stub };
}

// ── Amadeus re-pricing ─────────────────────────────────────────────────────

const AMADEUS_OFFER = {
  id: "1",
  type: "flight-offer",
  itineraries: [
    {
      duration: "PT3H50M",
      segments: [
        {
          departure: { iataCode: "ATH", at: "2027-03-10T07:15:00" },
          arrival: { iataCode: "CDG", at: "2027-03-10T10:05:00" },
          carrierCode: "A3",
          number: "610",
          duration: "PT3H50M",
        },
      ],
    },
  ],
  price: { currency: "EUR", total: "412.80", base: "350.00", grandTotal: "412.80" },
  travelerPricings: [
    { fareDetailsBySegment: [{ cabin: "ECONOMY", includedCheckedBags: { quantity: 1 } }] },
  ],
};

const amadeusCreds = (): SupplierCredentials => ({
  scheme: "oauth2_client_credentials",
  environment: "sandbox",
  fields: {
    clientId: "id",
    clientSecret: "sec",
    apiHost: "https://api.acme.amadeus.com",
  },
});

test("Amadeus re-pricing posts the offer back verbatim, not a rebuilt one", async () => {
  const { urls, bodies, stub } = sequence([
    { data: { flightOffers: [AMADEUS_OFFER] } },
  ]);

  await withFetch(stub, () =>
    getConnector("amadeus")!.revalidate(amadeusCreds(), JSON.stringify(AMADEUS_OFFER)),
  );

  const priceUrl = urls.find((u) => u.includes("/pricing"))!;
  assert.ok(priceUrl, "no pricing call was made");
  assert.equal(priceUrl, "https://api.acme.amadeus.com/v1/shopping/flight-offers/pricing");

  const body = bodies[urls.indexOf(priceUrl)] as {
    data?: { type?: string; flightOffers?: unknown[] };
  };
  assert.equal(body.data?.type, "flight-offers-pricing");
  // Amadeus rejects an offer that lost fields on the way out and back.
  assert.deepEqual(body.data?.flightOffers?.[0], AMADEUS_OFFER);
});

test("Amadeus re-pricing reports a price move with both figures", async () => {
  const dearer = {
    ...AMADEUS_OFFER,
    price: { currency: "EUR", total: "455.00", base: "380.00", grandTotal: "455.00" },
  };
  const { stub } = sequence([
    { data: { flightOffers: [dearer] } },
  ]);

  const result = await withFetch(stub, () =>
    getConnector("amadeus")!.revalidate(amadeusCreds(), JSON.stringify(AMADEUS_OFFER)),
  );

  assert.equal(result.stillAvailable, true);
  assert.equal(result.priceChanged, true);
  assert.match(result.message!, /412\.80 EUR/);
  assert.match(result.message!, /455\.00 EUR/);

  const offer = result.offer as NormalizedFlightOffer;
  assert.equal(offer.cost.base.amountMinor, 38000);
  assert.equal(offer.cost.taxes.amountMinor, 7500);
});

test("Amadeus re-pricing does not claim a change when the price held", async () => {
  const { stub } = sequence([
    { data: { flightOffers: [AMADEUS_OFFER] } },
  ]);
  const result = await withFetch(stub, () =>
    getConnector("amadeus")!.revalidate(amadeusCreds(), JSON.stringify(AMADEUS_OFFER)),
  );
  assert.equal(result.priceChanged, false);
  assert.match(result.message!, /confirmed/);
});

test("Amadeus re-pricing treats an empty answer as gone, not as still available", async () => {
  const { stub } = sequence([
    { data: { flightOffers: [] } },
  ]);
  const result = await withFetch(stub, () =>
    getConnector("amadeus")!.revalidate(amadeusCreds(), JSON.stringify(AMADEUS_OFFER)),
  );
  assert.equal(result.stillAvailable, false);
  assert.equal(result.offer, undefined);
});

test("Amadeus re-pricing blames the connector for a corrupt token", async () => {
  await assert.rejects(
    () => withFetch(sequence([{}]).stub, () => getConnector("amadeus")!.revalidate(amadeusCreds(), "not json")),
    /could not read Amadeus/,
  );
});

test("Amadeus reads fare flexibility only where Amadeus declares it", async () => {
  const flexible = {
    ...AMADEUS_OFFER,
    pricingOptions: { fareType: ["PUBLISHED"], refundableFare: true, noPenaltyFare: true },
  };
  const { stub } = sequence([
    { data: [flexible, AMADEUS_OFFER] },
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("amadeus")!.search(amadeusCreds(), {
      kind: "flight",
      originIata: "ATH",
      destinationIata: "CDG",
      departDate: "2027-03-10",
      adults: 1,
      childrenAges: [],
      sellCurrency: "EUR",
    }),
  )) as NormalizedFlightOffer[];

  assert.equal(offers[0].conditions.refundable, true);
  assert.equal(offers[0].conditions.changeable, true);
  // An offer that says nothing must NOT be quoted as flexible.
  assert.equal(offers[1].conditions.refundable, false);
  assert.equal(offers[1].conditions.changeable, false);
});

// ── Hotelbeds ──────────────────────────────────────────────────────────────

const hotelbedsCreds = () => creds({ apiKey: "k", secret: "s" });

function hotelbedsReply(hotels: unknown[]) {
  return { hotels: { hotels } };
}

test("Hotelbeds quotes the cheapest rate across every room, not the first", async () => {
  const { stub } = sequence([
    hotelbedsReply([
      {
        code: 101,
        name: "Hotel Suite First",
        currency: "EUR",
        categoryCode: "4EST",
        rooms: [
          { name: "Junior Suite", rates: [{ net: "900.00", rateKey: "suite" }] },
          { name: "Double Room", rates: [{ net: "420.00", rateKey: "double" }] },
        ],
      },
    ]),
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("hotelbeds")!.search(hotelbedsCreds(), {
      ...stay(),
      providerDestinationId: "PAR",
    }),
  )) as NormalizedHotelOffer[];

  assert.equal(offers.length, 1);
  assert.equal(offers[0].cost.base.amountMinor, 42000);
  assert.equal(offers[0].roomCategory, "Double Room");
  assert.equal(offers[0].revalidationToken, "double");
  assert.equal(offers[0].starRating, 4);
  assert.equal(offers[0].nights, 4);
});

test("Hotelbeds reads free cancellation from a future policy start", async () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { stub } = sequence([
    hotelbedsReply([
      {
        code: 102,
        name: "Flexible Inn",
        currency: "EUR",
        rooms: [
          {
            name: "Double",
            rates: [
              {
                net: "300.00",
                rateKey: "flex",
                rateClass: "NOR",
                cancellationPolicies: [{ amount: "120.00", from: future }],
              },
            ],
          },
        ],
      },
    ]),
  ]);

  const [offer] = (await withFetch(stub, () =>
    getConnector("hotelbeds")!.search(hotelbedsCreds(), { ...stay(), providerDestinationId: "PAR" }),
  )) as NormalizedHotelOffer[];

  // The old reading — "a policy exists, so it is non-refundable" — understated
  // every flexible rate in the catalogue.
  assert.equal(offer.conditions.refundable, true);
  assert.equal(offer.freeCancellationUntilISO, future);
  assert.equal(offer.conditions.cancellationPenalty?.amountMinor, 12000);
});

test("Hotelbeds trusts an NRF rate class over any policy arithmetic", async () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { stub } = sequence([
    hotelbedsReply([
      {
        code: 103,
        name: "Cheap Stay",
        currency: "EUR",
        rooms: [
          {
            rates: [
              {
                net: "200.00",
                rateClass: "NRF",
                cancellationPolicies: [{ amount: "0.00", from: future }],
              },
            ],
          },
        ],
      },
    ]),
  ]);

  const [offer] = (await withFetch(stub, () =>
    getConnector("hotelbeds")!.search(hotelbedsCreds(), { ...stay(), providerDestinationId: "PAR" }),
  )) as NormalizedHotelOffer[];

  assert.equal(offer.conditions.refundable, false);
  assert.match(offer.conditions.summary!, /Non-refundable/);
});

test("Hotelbeds routes non-included taxes to pay-at-property, never into cost", async () => {
  const { stub } = sequence([
    hotelbedsReply([
      {
        code: 104,
        name: "City Tax Hotel",
        currency: "EUR",
        rooms: [
          {
            rates: [
              {
                net: "400.00",
                taxes: {
                  taxes: [
                    { included: false, amount: "12.00", currency: "EUR", type: "CITY TAX" },
                    { included: true, amount: "40.00", currency: "EUR", type: "VAT" },
                  ],
                },
              },
            ],
          },
        ],
      },
    ]),
  ]);

  const [offer] = (await withFetch(stub, () =>
    getConnector("hotelbeds")!.search(hotelbedsCreds(), { ...stay(), providerDestinationId: "PAR" }),
  )) as NormalizedHotelOffer[];

  // The agency never receives the city tax, so marking it up would invoice a
  // client for money that goes to the hotel.
  assert.equal(offer.cost.base.amountMinor, 40000);
  assert.equal(offer.cost.payAtProperty?.length, 1);
  assert.equal(offer.cost.payAtProperty?.[0].amount.amountMinor, 1200);
  assert.match(offer.cost.payAtProperty![0].label, /CITY TAX/);
});

test("Hotelbeds normalises TripAdvisor's out-of-five score to the model's out-of-ten", async () => {
  const { stub } = sequence([
    hotelbedsReply([
      {
        code: 105,
        name: "Reviewed Hotel",
        currency: "EUR",
        reviews: [{ rate: 4.5, reviewCount: 900, type: "TRIPADVISOR" }],
        rooms: [{ rates: [{ net: "100.00" }] }],
      },
      {
        code: 106,
        name: "Own Score Hotel",
        currency: "EUR",
        reviews: [{ rate: 8.4, reviewCount: 120, type: "HOTELBEDS" }],
        rooms: [{ rates: [{ net: "100.00" }] }],
      },
    ]),
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("hotelbeds")!.search(hotelbedsCreds(), { ...stay(), providerDestinationId: "PAR" }),
  )) as NormalizedHotelOffer[];

  assert.equal(offers[0].reviewScore, 9);
  assert.equal(offers[1].reviewScore, 8.4);
});

// ── Viator ─────────────────────────────────────────────────────────────────

const VIATOR_PRODUCT = {
  productCode: "5010SYDNEY",
  title: "Louvre skip-the-line",
  pricing: { summary: { fromPrice: 32.5 }, currency: "EUR" },
  reviews: { combinedAverageRating: 4.5, totalReviews: 1200 },
  duration: { fixedDurationInMinutes: 150 },
  flags: ["FREE_CANCELLATION"],
};

test("Viator prices per person and multiplies by the whole party", async () => {
  const { urls, bodies, stub } = sequence([{ products: [VIATOR_PRODUCT] }]);

  const offers = (await withFetch(stub, () =>
    getConnector("viator")!.search(creds({ apiKey: "k" }), {
      ...stay({ kind: "activity" }),
      providerDestinationId: "479",
    }),
  )) as NormalizedActivityOffer[];

  assert.match(urls[0], /\/partner\/products\/search$/);
  const body = bodies[0] as { filtering?: { destination?: string }; currency?: string };
  assert.equal(body.filtering?.destination, "479");
  assert.equal(body.currency, "EUR");

  // 32.50 per person × (2 adults + 1 child) = 97.50, not 32.50.
  assert.equal(offers[0].cost.base.amountMinor, 9750);
  assert.equal(offers[0].durationMinutes, 150);
  assert.equal(offers[0].qualityScore, 0.9);
  assert.equal(offers[0].conditions.refundable, true);
});

test("Viator rates are commissionable, so the pricing engine may not mark them up", async () => {
  const { stub } = sequence([{ products: [VIATOR_PRODUCT] }]);
  const [offer] = (await withFetch(stub, () =>
    getConnector("viator")!.search(creds({ apiKey: "k" }), {
      ...stay({ kind: "activity" }),
      providerDestinationId: "479",
    }),
  )) as NormalizedActivityOffer[];

  assert.equal(offer.cost.rateType, "commissionable");
  assert.equal(offer.cost.markupForbidden, true);
});

test("Viator pins the Accept version its response schema depends on", async () => {
  let accept: string | undefined;
  await withFetch(
    async (_url, init) => {
      accept = (init.headers as Record<string, string>).Accept;
      return respond({ products: [] });
    },
    () =>
      getConnector("viator")!.search(creds({ apiKey: "k" }), {
        ...stay({ kind: "activity" }),
        providerDestinationId: "479",
      }),
  );
  assert.equal(accept, "application/json;version=2.0");
});

test("Viator declines a query with no destination rather than searching the world", async () => {
  let called = false;
  const offers = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () => getConnector("viator")!.search(creds({ apiKey: "k" }), stay({ kind: "activity" })),
  );
  assert.deepEqual(offers, []);
  assert.equal(called, false);
});

// ── Tiqets ─────────────────────────────────────────────────────────────────

test("Tiqets reads a price in every shape the distributor API has used", async () => {
  const { stub } = sequence([
    {
      products: [
        { id: 1, title: "Bare number", price: 20, currency: "EUR", sale_status: "open" },
        { id: 2, title: "Decimal string", price: "18.50", currency: "EUR" },
        { id: 3, title: "Nested object", price: { amount: "15.00", currency: "EUR" } },
        { id: 4, title: "Minimum only", min_price: "10.00", currency: "EUR" },
      ],
    },
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("tiqets")!.search(creds({ apiKey: "k" }), {
      ...stay({ kind: "activity" }),
      providerDestinationId: "266696",
    }),
  )) as NormalizedActivityOffer[];

  assert.equal(offers.length, 4);
  // Each is per ticket, for three people.
  assert.deepEqual(
    offers.map((o) => o.cost.base.amountMinor),
    [6000, 5550, 4500, 3000],
  );
});

test("Tiqets drops a sold-out product instead of quoting a dead checkout", async () => {
  const { stub } = sequence([
    {
      products: [
        { id: 1, title: "Sold out", price: "20.00", currency: "EUR", sale_status: "sold_out" },
        { id: 2, title: "On sale", price: "20.00", currency: "EUR", sale_status: "open" },
      ],
    },
  ]);

  const offers = await withFetch(stub, () =>
    getConnector("tiqets")!.search(creds({ apiKey: "k" }), {
      ...stay({ kind: "activity" }),
      providerDestinationId: "266696",
    }),
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0].supplierOfferId, "2");
});

test("Tiqets asks for the mapped city, not the IATA code", async () => {
  const { urls, stub } = sequence([{ products: [] }]);
  await withFetch(stub, () =>
    getConnector("tiqets")!.search(creds({ apiKey: "k" }), {
      ...stay({ kind: "activity" }),
      providerDestinationId: "266696",
    }),
  );
  assert.match(urls[0], /city_ids=266696/);
  assert.ok(!urls[0].includes("CDG"), "an IATA code means nothing to Tiqets");
});

// ── Expedia Rapid ──────────────────────────────────────────────────────────

const expediaCreds = () =>
  creds({ apiKey: "k", secret: "s", pointOfSaleCountry: "gr", customerIp: "203.0.113.7" });

const EAN_AVAILABILITY = [
  {
    property_id: "12345",
    status: "available",
    rooms: [
      {
        room_name: "Standard Double",
        rates: [
          {
            id: "rate-1",
            status: "available",
            refundable: true,
            cancel_penalties: [{ start: "2027-03-01T00:00:00Z", amount: "80.00", currency: "EUR" }],
            links: { price_check: { href: "/v3/check/abc" } },
            occupancy_pricing: {
              "2-9": {
                totals: {
                  inclusive: { billable_currency: { value: "440.00", currency: "EUR" } },
                  exclusive: { billable_currency: { value: "400.00", currency: "EUR" } },
                  property_fees: { billable_currency: { value: "25.00", currency: "EUR" } },
                },
              },
            },
          },
        ],
      },
    ],
  },
];

test("Expedia expands a region, prices it, then names it — in that order", async () => {
  const { urls, stub } = sequence([
    { property_ids: ["12345", "67890"] },
    EAN_AVAILABILITY,
    { "12345": { property_id: "12345", name: "Hôtel du Louvre" } },
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("expedia_rapid")!.search(expediaCreds(), {
      ...stay(),
      providerDestinationId: "6054439",
    }),
  )) as NormalizedHotelOffer[];

  assert.equal(urls.length, 3);
  assert.match(urls[0], /\/v3\/regions\/6054439\?/);
  assert.match(urls[0], /include=property_ids/);
  assert.match(urls[1], /\/v3\/properties\/availability\?/);
  assert.match(urls[2], /\/v3\/properties\/content\?/);

  // Availability must carry both property ids the region returned.
  assert.match(urls[1], /property_id=12345/);
  assert.match(urls[1], /property_id=67890/);
  // And the occupancy Rapid's own format demands.
  assert.match(urls[1], /occupancy=2-9/);
  assert.match(urls[1], /country_code=GR/);

  assert.equal(offers[0].name, "Hôtel du Louvre");
});

test("Expedia splits the inclusive total into base and tax without double counting", async () => {
  const { stub } = sequence([
    { property_ids: ["12345"] },
    EAN_AVAILABILITY,
    { "12345": { property_id: "12345", name: "Hôtel du Louvre" } },
  ]);

  const [offer] = (await withFetch(stub, () =>
    getConnector("expedia_rapid")!.search(expediaCreds(), {
      ...stay(),
      providerDestinationId: "6054439",
    }),
  )) as NormalizedHotelOffer[];

  assert.equal(offer.cost.base.amountMinor, 40000);
  assert.equal(offer.cost.taxes.amountMinor, 4000);
  assert.equal(offer.cost.base.amountMinor + offer.cost.taxes.amountMinor, 44000);
  // Property fees are the traveller's, collected on arrival.
  assert.equal(offer.cost.payAtProperty?.[0].amount.amountMinor, 2500);
  assert.equal(offer.revalidationToken, "/v3/check/abc");
  assert.equal(offer.conditions.refundable, true);
});

test("Expedia keeps its prices when the name lookup fails", async () => {
  let call = 0;
  const offers = (await withFetch(
    async (url) => {
      call++;
      if (url.includes("/regions/")) return respond({ property_ids: ["12345"] });
      if (url.includes("/availability")) return respond(EAN_AVAILABILITY);
      return respond({ message: "boom" }, 500);
    },
    () =>
      getConnector("expedia_rapid")!.search(expediaCreds(), {
        ...stay(),
        providerDestinationId: "6054439",
      }),
  )) as NormalizedHotelOffer[];

  assert.ok(call >= 3);
  // Enrichment is cosmetic; losing real prices over it would be the worse bug.
  assert.equal(offers.length, 1);
  assert.equal(offers[0].cost.base.amountMinor, 40000);
  assert.match(offers[0].name, /12345/);
});

test("Expedia stops after the region call when the region has no properties", async () => {
  const { urls, stub } = sequence([{ property_ids: [] }]);
  const offers = await withFetch(stub, () =>
    getConnector("expedia_rapid")!.search(expediaCreds(), {
      ...stay(),
      providerDestinationId: "6054439",
    }),
  );
  assert.deepEqual(offers, []);
  assert.equal(urls.length, 1, "it must not ask for availability with no properties");
});

test("Expedia sends the originating IP the agency configured, and never a made-up one", async () => {
  let ip: string | undefined;
  await withFetch(
    async (url, init) => {
      ip = (init.headers as Record<string, string>)["Customer-Ip"];
      return respond(url.includes("/regions/") ? { property_ids: [] } : []);
    },
    () =>
      getConnector("expedia_rapid")!.search(expediaCreds(), {
        ...stay(),
        providerDestinationId: "6054439",
      }),
  );
  assert.equal(ip, "203.0.113.7");
});

// ── Booking.com Demand ─────────────────────────────────────────────────────

const bookingCreds = () =>
  creds({ apiKey: "k", affiliateId: "123", pointOfSaleCountry: "gr" });

test("Booking searches a numeric city id and declines anything else", async () => {
  const { urls, bodies, stub } = sequence([{ data: [] }]);
  await withFetch(stub, () =>
    getConnector("booking_demand")!.search(bookingCreds(), {
      ...stay(),
      providerDestinationId: "-1456928",
    }),
  );

  assert.match(urls[0], /\/3\.1\/accommodations\/search$/);
  const body = bodies[0] as {
    city?: number;
    booker?: { country?: string };
    guests?: { number_of_adults?: number; children?: number[] };
  };
  assert.equal(body.city, -1456928);
  assert.equal(body.booker?.country, "gr");
  assert.equal(body.guests?.number_of_adults, 2);
  assert.deepEqual(body.guests?.children, [9]);

  // A Hotelbeds-style alphabetic code is not a Booking city id.
  let called = false;
  const offers = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () =>
      getConnector("booking_demand")!.search(bookingCreds(), {
        ...stay(),
        providerDestinationId: "PAR",
      }),
  );
  assert.deepEqual(offers, []);
  assert.equal(called, false);
});

test("Booking picks the cheapest product and forbids markup on a gross rate", async () => {
  const { stub } = sequence([
    {
      data: [
        {
          id: 1122,
          name: "Hotel Meurice",
          available: true,
          cheapest_product: { id: "a", name: "Standard", price: { value: "500.00", currency: "EUR" } },
          products: [
            { id: "a", name: "Standard", price: { value: "500.00", currency: "EUR" } },
            {
              id: "b",
              name: "Saver",
              price_breakdown: { gross_amount: { value: "460.00", currency: "EUR" } },
              policies: { cancellation: { free_cancellation_until: "2027-03-05T12:00:00Z" } },
            },
          ],
        },
      ],
    },
  ]);

  const [offer] = (await withFetch(stub, () =>
    getConnector("booking_demand")!.search(bookingCreds(), {
      ...stay(),
      providerDestinationId: "-1456928",
    }),
  )) as NormalizedHotelOffer[];

  assert.equal(offer.cost.base.amountMinor, 46000);
  assert.equal(offer.roomCategory, "Saver");
  // Demand API prices are traveller-facing and commissionable.
  assert.equal(offer.cost.rateType, "commissionable");
  assert.equal(offer.cost.markupForbidden, true);
  assert.equal(offer.conditions.refundable, true);
  assert.equal(offer.freeCancellationUntilISO, "2027-03-05T12:00:00Z");
});

test("Booking only asks for details of the accommodations it could not name", async () => {
  const { urls, bodies, stub } = sequence([
    {
      data: [
        { id: 1, name: "Already Named", products: [{ price: { value: "100.00", currency: "EUR" } }] },
        { id: 2, products: [{ price: { value: "100.00", currency: "EUR" } }] },
      ],
    },
    { data: [{ id: 2, name: "Looked Up Later" }] },
  ]);

  const offers = (await withFetch(stub, () =>
    getConnector("booking_demand")!.search(bookingCreds(), {
      ...stay(),
      providerDestinationId: "-1456928",
    }),
  )) as NormalizedHotelOffer[];

  assert.match(urls[1], /\/accommodations\/details$/);
  assert.deepEqual((bodies[1] as { accommodations?: number[] }).accommodations, [2]);
  assert.equal(offers[0].name, "Already Named");
  assert.equal(offers[1].name, "Looked Up Later");
});

test("Booking skips an accommodation it marked unavailable", async () => {
  const { stub } = sequence([
    {
      data: [
        { id: 1, name: "Gone", available: false, products: [{ price: { value: "100.00", currency: "EUR" } }] },
        { id: 2, name: "Here", available: true, products: [{ price: { value: "100.00", currency: "EUR" } }] },
      ],
    },
  ]);
  const offers = await withFetch(stub, () =>
    getConnector("booking_demand")!.search(bookingCreds(), {
      ...stay(),
      providerDestinationId: "-1456928",
    }),
  );
  assert.equal(offers.length, 1);
  assert.equal(offers[0].supplierOfferId, "2");
});
