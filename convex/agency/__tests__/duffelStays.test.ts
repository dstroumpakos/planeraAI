import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cheapestRate,
  mapSearchResult,
  pickSearchPoint,
  quoteCost,
  staysConditions,
  STAYS_RATE_PREFIX,
} from "../connectors/duffelStays";
import { duffelConnector } from "../connectors/duffel";
import type { SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = {
  scheme: "api_key",
  environment: "sandbox",
  fields: { apiKey: "duffel_test_abc" },
};

type Call = { url: string; method: string; body?: unknown };

function withFetch(routes: (c: Call) => { status?: number; body: unknown }, run: (calls: Call[]) => Promise<void>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    const call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status = 200, body } = routes(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
  return run(calls).finally(() => {
    (globalThis as { fetch: unknown }).fetch = original;
  });
}

test("hotels search around the CITY an airport serves, not the runway", () => {
  const places = [
    { type: "airport", iata_code: "FCO", iata_city_code: "ROM", latitude: 41.8, longitude: 12.25 },
    { type: "city", iata_code: "ROM", latitude: 41.9, longitude: 12.49 },
  ];
  assert.deepEqual(pickSearchPoint("FCO", places), { latitude: 41.9, longitude: 12.49, radiusKm: 5 });
  // No city row: the airport, with a wider net.
  assert.deepEqual(pickSearchPoint("FCO", [places[0]]), { latitude: 41.8, longitude: 12.25, radiusKm: 15 });
  assert.equal(pickSearchPoint("XXX", places), null);
});

test("a search result becomes a hotel offer at its cheapest total, terms unknown", () => {
  const o = mapSearchResult(
    {
      id: "srr_1",
      cheapest_rate_total_amount: "412.50",
      cheapest_rate_currency: "EUR",
      accommodation: { id: "acc_1", name: "Hotel Roma", rating: 4, review_score: 8.6 },
    },
    { departDate: "2026-11-10", returnDate: "2026-11-15" },
    1,
  )!;
  assert.equal(o.cost.base.amountMinor, 41250);
  assert.equal(o.cost.taxes.amountMinor, 0);
  assert.equal(o.nights, 5);
  assert.equal(o.starRating, 4);
  assert.equal(o.reviewScore, 8.6);
  assert.equal(o.conditions.refundable, false);
  assert.equal(o.revalidationToken, "stays_sr:srr_1");
  assert.equal(mapSearchResult({ id: "x" }, {}, 1), null);
});

test("the cheapest rate is chosen across every room", () => {
  const best = cheapestRate([
    { name: "Suite", rates: [{ id: "r1", total_amount: "300.00", total_currency: "EUR" }] },
    { name: "Double", rates: [{ id: "r2", total_amount: "250.00", total_currency: "EUR" }, { id: "bad" }] },
  ])!;
  assert.equal(best.rate.id, "r2");
  assert.equal(best.roomName, "Double");
  assert.equal(cheapestRate([]), null);
});

test("free cancellation needs a FULL refund before a future date", () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const free = staysConditions({
    id: "r",
    total_amount: "200.00",
    cancellation_timeline: [{ refund_amount: "200.00", currency: "EUR", before: future }],
  });
  assert.equal(free.refundable, true);
  assert.equal(free.freeUntilISO, future);

  const partial = staysConditions({
    id: "r",
    total_amount: "200.00",
    cancellation_timeline: [{ refund_amount: "50.00", currency: "EUR", before: future }],
  });
  assert.equal(partial.refundable, false);
  assert.match(partial.summary!, /Μερική/);
  assert.equal(staysConditions({ id: "r", total_amount: "200.00" }).refundable, false);
});

test("a quote splits base, taxes+fees and what is paid at the hotel", () => {
  const c = quoteCost({
    id: "quo_1",
    total_amount: "230.00",
    total_currency: "EUR",
    tax_amount: "20.00",
    fee_amount: "10.00",
    due_at_accommodation_amount: "12.00",
    due_at_accommodation_currency: "EUR",
  })!;
  assert.equal(c.base.amountMinor, 20000);
  assert.equal(c.taxes.amountMinor, 3000);
  assert.equal(c.payAtProperty![0].amount.amountMinor, 1200);
});

test("Duffel routes hotel searches to Stays and says so when Stays is not enabled", async () => {
  assert.deepEqual(duffelConnector.capabilities.kinds, ["flight", "hotel"]);
  await withFetch(
    (c) =>
      c.url.includes("/places/suggestions")
        ? { body: { data: [{ type: "city", iata_code: "ROM", latitude: 41.9, longitude: 12.49 }] } }
        : { status: 403, body: { errors: [{ message: "forbidden" }] } },
    async (calls) => {
      await assert.rejects(
        duffelConnector.search(creds, {
          kind: "hotel",
          destinationIata: "ROM",
          departDate: "2026-11-10",
          returnDate: "2026-11-12",
          adults: 2,
          childrenAges: [],
          sellCurrency: "EUR",
        }),
        /not enabled/,
      );
      const search = calls.find((c) => c.url.endsWith("/stays/search"))!;
      const body = search.body as { data: { location: { radius: number }; guests: unknown[] } };
      assert.equal(body.data.location.radius, 5);
      assert.equal(body.data.guests.length, 2);
    },
  );
});

test("a stays booking re-quotes the rate, refuses a price rise, and books with names", async () => {
  const req = {
    revalidationToken: `${STAYS_RATE_PREFIX}rat_1`,
    offer: {} as never,
    passengers: [
      { type: "adult" as const, title: "mr" as const, givenName: "Nikos", familyName: "Papas", bornOn: "1980-01-01", gender: "m" as const },
    ],
    contact: { email: "a@b.co", phone: "+306912345678" },
    clientReference: "REF-1",
  };

  // Price rose: nothing is booked.
  await withFetch(
    (c) =>
      c.url.endsWith("/stays/quotes")
        ? { body: { data: { id: "quo_1", total_amount: "250.00", total_currency: "EUR" } } }
        : { body: {} },
    async (calls) => {
      const out = await duffelConnector.createBooking!(creds, {
        ...req,
        expectedTotal: { amountMinor: 20000, currency: "EUR" },
      });
      assert.equal(out.status, "failed");
      assert.match(out.message!, /rose/);
      assert.ok(!calls.some((c) => c.url.endsWith("/stays/bookings")));
    },
  );

  // Same price: booked.
  await withFetch(
    (c) =>
      c.url.endsWith("/stays/quotes")
        ? { body: { data: { id: "quo_2", total_amount: "200.00", total_currency: "EUR" } } }
        : { body: { data: { id: "bok_1", reference: "AFE33SE2", status: "confirmed" } } },
    async (calls) => {
      const out = await duffelConnector.createBooking!(creds, {
        ...req,
        expectedTotal: { amountMinor: 20000, currency: "EUR" },
      });
      assert.equal(out.status, "confirmed");
      assert.equal(out.supplierReference, "AFE33SE2");
      const book = calls.find((c) => c.url.endsWith("/stays/bookings"))!.body as {
        data: { quote_id: string; guests: Array<{ given_name: string; born_on: string }> };
      };
      assert.equal(book.data.quote_id, "quo_2");
      assert.equal(book.data.guests[0].given_name, "Nikos");
    },
  );
});
