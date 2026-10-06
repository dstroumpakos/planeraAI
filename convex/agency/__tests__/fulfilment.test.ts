import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOn,
  applyManualUpdate,
  fulfilmentStage,
  lockForBooking,
  normalizePhone,
  recordBookingOutcome,
  setPayment,
  startFulfilment,
  syncFulfilment,
  toCustomerBooking,
  validateTravellers,
  type Traveller,
} from "../fulfilment";
import { buildManualLine, putLine } from "../quoteEdit";
import { buildQuote } from "../quote";
import { assignDuffelPassengers } from "../connectors/duffel";
import { mockAirConnector, mockHotelConnector } from "../connectors/mock";
import type { NormalizedFlightOffer, NormalizedHotelOffer } from "../model/types";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "x" } };
const q: SearchQuery = { kind: "flight", originIata: "ATH", destinationIata: "FCO", departDate: "2026-11-01", adults: 2, childrenAges: [], sellCurrency: "EUR" };
const NOW = 1_800_000_000_000;

async function packages() {
  const flights = (await mockAirConnector.search(creds, q)) as NormalizedFlightOffer[];
  const hotels = (await mockHotelConnector.search(creds, { ...q, kind: "hotel" })) as NormalizedHotelOffer[];
  return buildQuote({
    quoteId: "q", agencyId: "a", createdByUserId: "u", currency: "EUR", searchParams: {},
    days: 4, travelers: 2, flights, hotels, rules: [], now: NOW, ttlMs: 60_000,
  }).packages;
}

const adult = (given: string, bornOn = "1985-03-02"): Traveller => ({
  type: "adult", title: "mr", givenName: given, familyName: "Papadopoulos", bornOn, gender: "m",
});
const contact = { email: "Client@Example.com", phone: "691 234 5678" };
const party = { adults: 2, childrenAges: [7], departDate: "2026-11-01" };

// ── Travellers ──────────────────────────────────────────────────────────────

test("travellers are validated against the party the fare was priced for", () => {
  const ok = validateTravellers(
    { travellers: [adult("Nikos"), adult("Maria"), { ...adult("Eleni", "2019-05-01"), title: "miss", gender: "f" }], contact },
    party,
    "2026-10-01",
  );
  assert.equal(ok.travellers[2].type, "child");
  assert.equal(ok.contact.email, "client@example.com");
  assert.equal(ok.contact.phone, "+306912345678");

  assert.throws(() => validateTravellers({ travellers: [adult("Nikos")], contact }, party, "2026-10-01"), /3 travellers/);
  // Three adults on a fare priced for two adults + a child.
  assert.throws(
    () => validateTravellers({ travellers: [adult("A"), adult("B"), adult("C")], contact }, party, "2026-10-01"),
    /priced for 2 adults/,
  );
  assert.throws(
    () => validateTravellers({ travellers: [adult("N1ko$"), adult("M"), adult("E", "2019-01-01")], contact }, party, "2026-10-01"),
    /passport/,
  );
  assert.throws(
    () => validateTravellers({ travellers: [adult("A"), adult("B"), adult("C", "2027-01-01")], contact }, party, "2026-10-01"),
    /date of birth/,
  );
  assert.throws(
    () => validateTravellers({ travellers: [adult("A"), adult("B"), adult("C", "2019-01-01")], contact: { ...contact, email: "x" } }, party, "2026-10-01"),
    /email/,
  );
});

test("Greek names are accepted as written", () => {
  const out = validateTravellers(
    { travellers: [{ ...adult("Νίκος"), familyName: "Παπαδόπουλος" }], contact },
    { adults: 1, childrenAges: [], departDate: "2026-11-01" },
    "2026-10-01",
  );
  assert.equal(out.travellers[0].givenName, "Νίκος");
});

test("phone numbers are normalised to E.164", () => {
  assert.equal(normalizePhone("0030 691 234 5678"), "+306912345678");
  assert.equal(normalizePhone("2106543210"), "+302106543210");
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
  assert.throws(() => normalizePhone("12345"), /country code/);
});

test("age is computed on the departure date, not today", () => {
  assert.equal(ageOn("2014-11-02", "2026-11-01"), 11);
  assert.equal(ageOn("2014-11-01", "2026-11-01"), 12);
});

// ── Booking record ──────────────────────────────────────────────────────────

test("a record opens with one pending line per service and the price due", async () => {
  const pkgs = await packages();
  const f = startFulfilment(pkgs, "comfort", NOW, "u1");
  const pkg = pkgs.find((p) => p.tier === "comfort")!;
  assert.equal(f.lines.length, pkg.lines.length);
  assert.ok(f.lines.every((l) => l.status === "pending"));
  assert.equal(f.payment.due.amountMinor, pkg.totals.internal.customerPrice.amountMinor);
  assert.equal(fulfilmentStage(f), "collecting");
});

test("a manual confirmation needs a reference", async () => {
  const f = startFulfilment(await packages(), "basic", NOW);
  const id = f.lines[0].offerId;
  assert.throws(() => applyManualUpdate(f, id, { status: "confirmed" }, NOW, "u"), /reference/);
  const g = applyManualUpdate(f, id, { status: "confirmed", supplierReference: " ABC123 " }, NOW, "u");
  assert.equal(g.lines[0].supplierReference, "ABC123");
  assert.equal(g.lines[0].mode, "manual");
  assert.equal(fulfilmentStage(g), "in_progress");
});

test("the booking lock refuses a second attempt, a booked line, and an unknown outcome", async () => {
  const f = startFulfilment(await packages(), "basic", NOW);
  const id = f.lines[0].offerId;
  const locked = lockForBooking(f, id, NOW, "u");
  assert.equal(locked.lines[0].status, "booking");
  assert.throws(() => lockForBooking(locked, id, NOW, "u"), /already running/);
  assert.throws(() => applyManualUpdate(locked, id, { status: "confirmed", supplierReference: "X" }, NOW, "u"), /still running/);

  const unknown = recordBookingOutcome(locked, id, { status: "unknown", message: "timed out" }, NOW);
  assert.equal(fulfilmentStage(unknown), "attention");
  assert.throws(() => lockForBooking(unknown, id, NOW, "u"), /may have gone through/);
  // …but a human can resolve it after checking the supplier.
  const resolved = applyManualUpdate(unknown, id, { status: "confirmed", supplierReference: "PNR1" }, NOW, "u");
  assert.equal(resolved.lines[0].status, "confirmed");
  assert.throws(() => lockForBooking(resolved, id, NOW, "u"), /already booked/);

  const failed = recordBookingOutcome(locked, id, { status: "failed", message: "no seats" }, NOW);
  assert.doesNotThrow(() => lockForBooking(failed, id, NOW, "u"));
});

test("manual services cannot be sent to a supplier API", async () => {
  const pkgs = await packages();
  const ferry = buildManualLine({ category: "ferry", title: "F", supplierCostMinor: 1, customerPriceMinor: 2, refundable: false }, "EUR", NOW, "f");
  const f = startFulfilment(putLine(pkgs, "basic", ferry, "EUR"), "basic", NOW);
  assert.throws(() => lockForBooking(f, ferry.offer.offerId, NOW, "u"), /outside Planera/);
});

test("the stage is confirmed only when every live service is", async () => {
  const f = startFulfilment(await packages(), "basic", NOW);
  let g = f;
  for (const l of f.lines) g = recordBookingOutcome(g, l.offerId, { status: "confirmed", supplierReference: "R" }, NOW);
  assert.equal(fulfilmentStage(g), "confirmed");
});

test("editing the chosen option keeps booked lines that were removed", async () => {
  const pkgs = await packages();
  const f0 = startFulfilment(pkgs, "basic", NOW);
  const booked = recordBookingOutcome(f0, f0.lines[0].offerId, { status: "confirmed", supplierReference: "KEEP" }, NOW);
  const emptied = pkgs.map((p) => (p.tier === "basic" ? { ...p, lines: [] } : p));
  const synced = syncFulfilment(booked, emptied, NOW);
  assert.deepEqual(synced.lines.map((l) => l.supplierReference), ["KEEP"]);
});

test("payment is a note of what the agency received, in the quote's currency", async () => {
  const f = startFulfilment(await packages(), "basic", NOW);
  const g = setPayment(f, { status: "deposit", receivedMinor: 20000 }, NOW);
  assert.deepEqual(g.payment.received, { amountMinor: 20000, currency: "EUR" });
  assert.throws(() => setPayment(f, { status: "paid", receivedMinor: -1 }, NOW), /zero or more/);
});

test("the client sees references only after the agent releases them, and never internals", async () => {
  const f = startFulfilment(await packages(), "basic", NOW);
  const withRef = applyManualUpdate(f, f.lines[0].offerId, { status: "confirmed", supplierReference: "PNR9", note: "internal" }, NOW, "u");
  const before = toCustomerBooking(setPayment(withRef, { status: "paid", receivedMinor: 5 }, NOW), true, 2)!;
  assert.equal(before.confirmation, null);

  const after = toCustomerBooking({ ...withRef, confirmationSharedAt: NOW }, true, 2)!;
  assert.equal(after.confirmation!.lines[0].reference, "PNR9");
  assert.equal(after.confirmation!.lines[1].reference, undefined);
  const json = JSON.stringify(after);
  assert.ok(!json.includes("internal"));
  assert.ok(!json.includes("payment"));
});

// ── Duffel passenger mapping ────────────────────────────────────────────────

test("Duffel passengers are matched by type and infants ride on an adult", () => {
  const out = assignDuffelPassengers(
    [
      { id: "pas_a1", type: "adult" },
      { id: "pas_a2", type: "adult" },
      { id: "pas_c1", type: "child" },
      { id: "pas_i1", type: "infant_without_seat" },
    ],
    {
      passengers: [
        { ...adult("A"), type: "adult" },
        { ...adult("C", "2018-01-01"), type: "child" },
        { ...adult("I", "2026-01-01"), type: "infant" },
        { ...adult("B"), type: "adult" },
      ],
      contact: { email: "a@b.co", phone: "+306912345678" },
    },
  );
  const byName = Object.fromEntries(out.map((p) => [p.given_name, p]));
  assert.equal(byName.A.id, "pas_a1");
  assert.equal(byName.B.id, "pas_a2");
  assert.equal(byName.C.id, "pas_c1");
  assert.equal(byName.A.infant_passenger_id, "pas_i1");
  assert.equal(byName.C.email, "a@b.co");

  assert.throws(
    () => assignDuffelPassengers([{ id: "x", type: "adult" }], { passengers: [], contact: { email: "", phone: "" } }),
    /1 passengers/,
  );
});
