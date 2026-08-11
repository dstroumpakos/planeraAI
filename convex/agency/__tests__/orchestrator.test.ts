import { test } from "node:test";
import assert from "node:assert/strict";
import { runSearch, searchForQuote, revalidateSelected, type ConnectorBinding } from "../orchestrator";
import { mockAirConnector, mockHotelConnector } from "../connectors/mock";
import type { SearchQuery, SupplierConnector, SupplierCredentials } from "../connectors/types";
import type { NormalizedOffer } from "../model/types";

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "x" } };
const base = { originIata: "ATH", destinationIata: "CDG", departDate: "2026-09-01", adults: 2, childrenAges: [], sellCurrency: "EUR" };
const flightQ: SearchQuery = { ...base, kind: "flight" };

const airB: ConnectorBinding = { connector: mockAirConnector, creds };
const hotelB: ConnectorBinding = { connector: mockHotelConnector, creds };

const failingAir: SupplierConnector = {
  id: "fail-air", displayName: "Failing Air",
  capabilities: { kinds: ["flight"], supports: { search: true, retrieveOffer: false, revalidate: false, createBooking: false, retrieveBooking: false, cancelBooking: false, getCancellationTerms: false, healthCheck: true } },
  async healthCheck() { return { healthy: false, environment: "sandbox" as const }; },
  async search() { throw new Error("boom upstream"); },
  async revalidate() { return { stillAvailable: false }; },
};

test("partial failure: one connector throws, the rest still return", async () => {
  const res = await runSearch([airB, { connector: failingAir, creds }], flightQ);
  assert.equal(res.offers.length, 3); // only mock-air contributed
  const air = res.byConnector.find((c) => c.connectorId === "mock-air");
  const fail = res.byConnector.find((c) => c.connectorId === "fail-air");
  assert.ok(air?.ok && air.count === 3);
  assert.equal(fail?.ok, false);
  assert.match(fail?.error ?? "", /boom upstream/);
});

test("capability gating: wrong-kind connector is skipped, not called", async () => {
  const res = await runSearch([hotelB], flightQ); // hotel connector, flight search
  assert.equal(res.offers.length, 0);
  assert.equal(res.byConnector[0].skippedReason, "kind_unsupported");
});

test("searchForQuote runs flight + hotel in parallel and splits results", async () => {
  const res = await searchForQuote([airB, hotelB], base);
  assert.equal(res.flights.length, 3);
  assert.equal(res.hotels.length, 3);
  assert.ok(res.flights.every((f) => f.kind === "flight"));
  assert.ok(res.hotels.every((h) => h.kind === "hotel"));
});

test("revalidation: all available → quote still valid", async () => {
  const offers = (await mockAirConnector.search(creds, flightQ)) as NormalizedOffer[];
  const map = new Map([["mock-air", airB]]);
  const out = await revalidateSelected(map, offers.slice(0, 1));
  assert.equal(out.quoteStillValid, true);
  assert.equal(out.lines[0].stillAvailable, true);
});

test("revalidation: connector without capability → unverifiable → not auto-valid", async () => {
  const offers = (await mockAirConnector.search(creds, flightQ)) as NormalizedOffer[];
  const map = new Map([["mock-air", { connector: failingAir, creds }]]); // no revalidate cap
  const out = await revalidateSelected(map, offers.slice(0, 1));
  assert.equal(out.lines[0].unverifiable, true);
  assert.equal(out.quoteStillValid, false);
});

test("revalidation: a timeout/throw is unverifiable, NOT treated as unavailable data", async () => {
  const throwingRevalidate: SupplierConnector = {
    ...failingAir, id: "throw-air",
    capabilities: { ...failingAir.capabilities, supports: { ...failingAir.capabilities.supports, revalidate: true } },
    async revalidate() { throw new Error("timeout"); },
  };
  const offers = (await mockAirConnector.search(creds, flightQ)) as NormalizedOffer[];
  const map = new Map([["mock-air", { connector: throwingRevalidate, creds }]]);
  const out = await revalidateSelected(map, offers.slice(0, 1));
  assert.equal(out.lines[0].unverifiable, true);
  assert.match(out.lines[0].message ?? "", /timeout/);
});
