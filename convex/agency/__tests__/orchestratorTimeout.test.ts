import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSearch,
  revalidateSelected,
  withTimeout,
  ConnectorTimeoutError,
  type ConnectorBinding,
} from "../orchestrator";
import { mockAirConnector } from "../connectors/mock";
import { money } from "../model/types";
import type { NormalizedOffer } from "../model/types";
import type { SearchQuery, SupplierConnector, SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = {
  scheme: "api_key",
  environment: "sandbox",
  fields: { apiKey: "k" },
};

const QUERY: SearchQuery = {
  kind: "flight",
  originIata: "ATH",
  destinationIata: "CDG",
  departDate: "2026-09-10",
  adults: 1,
  childrenAges: [],
  sellCurrency: "EUR",
};

/** A connector that never answers — the failure mode timeouts exist for. */
function hangingConnector(id: string): SupplierConnector {
  return {
    id,
    displayName: id,
    capabilities: {
      kinds: ["flight"],
      supports: {
        search: true,
        retrieveOffer: false,
        revalidate: true,
        createBooking: false,
        retrieveBooking: false,
        cancelBooking: false,
        getCancellationTerms: false,
        healthCheck: true,
      },
    },
    async healthCheck() {
      return { healthy: true, environment: "sandbox" as const };
    },
    search() {
      return new Promise<NormalizedOffer[]>(() => {});
    },
    revalidate() {
      return new Promise<never>(() => {});
    },
  };
}

test("withTimeout rejects with a typed error once the deadline passes", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20, "slowpoke"),
    (e: Error) => e instanceof ConnectorTimeoutError && /slowpoke/.test(e.message),
  );
});

test("withTimeout passes a fast result straight through", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000, "fast"), 7);
});

test("ONE hanging supplier does not stop the others from returning", async () => {
  const bindings: ConnectorBinding[] = [
    { connector: hangingConnector("stuck"), creds },
    { connector: mockAirConnector, creds },
  ];

  const started = Date.now();
  const result = await runSearch(bindings, QUERY, Date.now, 50);
  const elapsed = Date.now() - started;

  assert.ok(result.offers.length > 0, "the healthy connector's offers still arrive");
  assert.ok(elapsed < 2000, "the search must not wait on the hung connector");

  const stuck = result.byConnector.find((r) => r.connectorId === "stuck");
  assert.equal(stuck?.ok, false);
  assert.equal(stuck?.timedOut, true, "the timeout is reported as such, not as an empty result");

  const healthy = result.byConnector.find((r) => r.connectorId === "mock-air");
  assert.equal(healthy?.ok, true);
});

test("a timed-out revalidation is UNVERIFIABLE, never 'unavailable'", async () => {
  const offer: NormalizedOffer = {
    kind: "flight",
    offerId: "stuck:F1",
    connectorId: "stuck",
    supplierOfferId: "F1",
    cost: { rateType: "net", base: money(10000, "EUR"), taxes: money(1000, "EUR") },
    conditions: { refundable: false, changeable: false },
    revalidationToken: "tok",
    quotedAt: Date.now(),
    outbound: [
      {
        fromIata: "ATH",
        toIata: "CDG",
        departISO: "2026-09-10T07:00:00",
        arriveISO: "2026-09-10T10:00:00",
        carrier: "XX",
        durationMinutes: 180,
      },
    ],
    outboundStops: 0,
    totalDurationMinutes: 180,
    cabinClass: "economy",
    baggage: { cabin: 1, checked: 0 },
  };

  const bindings = new Map<string, ConnectorBinding>([
    ["stuck", { connector: hangingConnector("stuck"), creds }],
  ]);

  const outcome = await revalidateSelected(bindings, [offer], Date.now(), 40);
  assert.equal(outcome.lines[0].unverifiable, true);
  // The distinction matters commercially: "we could not check" must never be
  // presented to an agent as "the fare is gone".
  assert.equal(outcome.quoteStillValid, false);
});

test("a connector that cannot serve the requested kind is skipped, not called", async () => {
  const result = await runSearch(
    [{ connector: mockAirConnector, creds }],
    { ...QUERY, kind: "hotel" },
    Date.now,
    500,
  );
  assert.equal(result.offers.length, 0);
  assert.equal(result.byConnector[0].skippedReason, "kind_unsupported");
});

// ── Destination gating ──────────────────────────────────────────────────────

/** A connector that needs its own destination id, like every hotel supplier. */
function taxonomyConnector(id: string, seen: SearchQuery[]): SupplierConnector {
  return {
    id,
    displayName: id,
    capabilities: {
      kinds: ["hotel"],
      requiresDestinationId: true,
      supports: {
        search: true,
        retrieveOffer: false,
        revalidate: false,
        createBooking: false,
        retrieveBooking: false,
        cancelBooking: false,
        getCancellationTerms: false,
        healthCheck: true,
      },
    },
    async healthCheck() {
      return { healthy: true, environment: "sandbox" as const };
    },
    async search(_creds, q) {
      seen.push(q);
      return [];
    },
    async revalidate() {
      throw new Error("not supported");
    },
  };
}

test("a connector needing a destination id is SKIPPED when none was resolved", async () => {
  const seen: SearchQuery[] = [];
  const result = await runSearch(
    [{ connector: taxonomyConnector("needs-map", seen), creds }],
    { ...QUERY, kind: "hotel" },
    Date.now,
    500,
    {}, // nothing resolved
  );
  assert.equal(seen.length, 0, "it must not be called with an id it cannot read");
  assert.equal(result.byConnector[0].skippedReason, "no_destination_mapping");
});

test("each connector receives ITS OWN resolved destination id", async () => {
  const a: SearchQuery[] = [];
  const b: SearchQuery[] = [];
  await runSearch(
    [
      { connector: taxonomyConnector("supplier-a", a), creds },
      { connector: taxonomyConnector("supplier-b", b), creds },
    ],
    { ...QUERY, kind: "hotel" },
    Date.now,
    500,
    { "supplier-a": "PAR", "supplier-b": "479" },
  );
  // The same trip is a different id at every provider — mixing them up would
  // search the wrong city at one of them.
  assert.equal(a[0]?.providerDestinationId, "PAR");
  assert.equal(b[0]?.providerDestinationId, "479");
});

test("a flight connector is never gated on a destination mapping", async () => {
  const result = await runSearch(
    [{ connector: mockAirConnector, creds }],
    QUERY,
    Date.now,
    500,
    {}, // no mappings at all
  );
  assert.ok(result.offers.length > 0, "flights key off IATA and must still run");
});
