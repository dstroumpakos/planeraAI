/**
 * The package ladder: what each tier carries beyond a flight and a bed.
 *
 * Before this, `searchForQuote` only ever asked for flights and hotels, so the
 * activity and transfer connectors could return offers that nothing consumed.
 * These tests pin the product decision that replaced it — Basic stays bare,
 * Comfort gains one experience, Premium two — because that ladder is the thing
 * an agency is actually selling, and a silent regression to "flight + hotel"
 * would look like nothing was broken at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuote, type BuildQuoteInput } from "../quote";
import { ACTIVITY_PICKS, TRANSFER_PICKS, selectAllTiers } from "../scoring";
import { money } from "../model/types";
import type {
  NormalizedActivityOffer,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedTransferOffer,
  PackageLine,
  TravelPackage,
} from "../model/types";

const NOW = 1_800_000_000_000;

const flight = (id: string, priceMinor: number): NormalizedFlightOffer => ({
  kind: "flight",
  offerId: `air:${id}`,
  connectorId: "air",
  supplierOfferId: id,
  cost: { rateType: "net", base: money(priceMinor, "EUR"), taxes: money(0, "EUR") },
  conditions: { refundable: false, changeable: false },
  quotedAt: NOW,
  outbound: [
    {
      fromIata: "ATH",
      toIata: "CDG",
      departISO: "2027-03-10T09:00:00",
      arriveISO: "2027-03-10T11:30:00",
      carrier: "A3",
      durationMinutes: 150,
    },
  ],
  outboundStops: 0,
  totalDurationMinutes: 150,
  cabinClass: "economy",
  baggage: { cabin: 1, checked: 1 },
});

const hotel = (id: string, priceMinor: number, stars: number): NormalizedHotelOffer => ({
  kind: "hotel",
  offerId: `bed:${id}`,
  connectorId: "bed",
  supplierOfferId: id,
  cost: { rateType: "net", base: money(priceMinor, "EUR"), taxes: money(0, "EUR") },
  conditions: { refundable: true, changeable: true },
  quotedAt: NOW,
  name: `Hotel ${id}`,
  starRating: stars,
  reviewScore: 9,
  boardType: "breakfast",
  nights: 4,
});

const activity = (
  id: string,
  priceMinor: number,
  quality: number,
  title = `Tour ${id}`,
): NormalizedActivityOffer => ({
  kind: "activity",
  offerId: `act:${id}`,
  connectorId: "act",
  supplierOfferId: id,
  cost: {
    rateType: "commissionable",
    base: money(priceMinor, "EUR"),
    taxes: money(0, "EUR"),
    markupForbidden: true,
  },
  conditions: { refundable: true, changeable: true },
  quotedAt: NOW,
  title,
  qualityScore: quality,
});

const transfer = (id: string, priceMinor: number): NormalizedTransferOffer => ({
  kind: "transfer",
  offerId: `trf:${id}`,
  connectorId: "trf",
  supplierOfferId: id,
  cost: { rateType: "net", base: money(priceMinor, "EUR"), taxes: money(0, "EUR") },
  conditions: { refundable: false, changeable: false },
  quotedAt: NOW,
  mode: "private",
  fromLabel: "CDG",
  toLabel: "Paris centre",
});

function input(over: Partial<BuildQuoteInput> = {}): BuildQuoteInput {
  return {
    quoteId: "qte_exp",
    agencyId: "agA",
    createdByUserId: "uA",
    currency: "EUR",
    searchParams: {},
    days: 4,
    travelers: 2,
    destinationIata: "CDG",
    flights: [flight("f1", 20000), flight("f2", 32000)],
    hotels: [hotel("h1", 40000, 3), hotel("h2", 70000, 5)],
    activities: [
      activity("a1", 4000, 0.95),
      activity("a2", 6000, 0.9),
      activity("a3", 3000, 0.4),
    ],
    transfers: [transfer("t1", 5000)],
    rules: [],
    now: NOW,
    ttlMs: 60_000,
    ...over,
  };
}

const linesOfKind = (pkg: TravelPackage, kind: PackageLine["kind"]): PackageLine[] =>
  pkg.lines.filter((l) => l.kind === kind);

test("Basic stays a bare flight and bed; Comfort and Premium add experiences", () => {
  const quote = buildQuote(input());
  const [basic, comfort, premium] = quote.packages;

  // Padding the price-led tier with extras is exactly how a cheap option stops
  // being cheap, and an agent would have to strip it back by hand.
  assert.equal(linesOfKind(basic, "activity").length, 0);
  assert.equal(linesOfKind(basic, "transfer").length, 0);

  assert.equal(linesOfKind(comfort, "activity").length, ACTIVITY_PICKS.comfort);
  assert.equal(linesOfKind(premium, "activity").length, ACTIVITY_PICKS.premium);
  assert.equal(linesOfKind(premium, "transfer").length, TRANSFER_PICKS.premium);
});

test("a package never sells the same experience twice", () => {
  // Two connectors listing the identical museum ticket is routine; a Premium
  // package that booked the Louvre twice would be a visible bug on a client's
  // document.
  const duplicated = [
    activity("dup", 4000, 0.95, "Louvre skip-the-line"),
    activity("dup", 4200, 0.94, "Louvre skip-the-line"),
    activity("other", 5000, 0.93, "Seine cruise"),
  ];
  const quote = buildQuote(input({ activities: duplicated }));
  const premium = quote.packages[2];
  const titles = linesOfKind(premium, "activity").map(
    (l) => (l.offer as NormalizedActivityOffer).title,
  );

  assert.equal(titles.length, 2);
  assert.equal(new Set(titles).size, 2, `picked the same experience twice: ${titles.join(", ")}`);
});

test("lines read as a journey: travel, bed, transfer, then things to do", () => {
  const quote = buildQuote(input());
  const kinds = quote.packages[2].lines.map((l) => l.kind);
  assert.deepEqual(kinds.slice(0, 3), ["flight", "hotel", "transfer"]);
  assert.ok(kinds.slice(3).every((k) => k === "activity"));
});

test("experience lines are included in the package total", () => {
  const quote = buildQuote(input());
  for (const pkg of quote.packages) {
    const sum = pkg.lines.reduce((a, l) => a + l.financials.customerPrice.amountMinor, 0);
    assert.equal(pkg.totals.internal.customerPrice.amountMinor, sum);
  }
  // Premium carries strictly more lines, so it must cost strictly more.
  assert.ok(
    quote.packages[2].totals.internal.customerPrice.amountMinor >
      quote.packages[0].totals.internal.customerPrice.amountMinor,
  );
});

test("commissionable experiences earn commission, never markup", () => {
  const quote = buildQuote(
    input({
      rules: [{ scope: "agency", rule: { markupPct: 0.2 }, active: true }],
    }),
  );
  const line = linesOfKind(quote.packages[1], "activity")[0];
  // The supplier's terms forbid it and the pricing engine must hold that line
  // even when the agency's own default rule says 20%.
  assert.equal(line.financials.markup.amountMinor, 0);
});

test("no experiences available is a normal quote, not a broken one", () => {
  const quote = buildQuote(input({ activities: [], transfers: [] }));
  assert.equal(quote.packages.length, 3);
  for (const pkg of quote.packages) {
    assert.deepEqual(
      pkg.lines.map((l) => l.kind).sort(),
      ["flight", "hotel"],
      `${pkg.tier} should still be a complete package`,
    );
  }
});

test("selection is deterministic across runs", () => {
  const first = selectAllTiers([], [], [], []);
  assert.equal(first.basic.activities.length, 0);

  const a = buildQuote(input());
  const b = buildQuote(input());
  assert.deepEqual(
    a.packages.map((p) => p.lines.map((l) => l.offer.offerId)),
    b.packages.map((p) => p.lines.map((l) => l.offer.offerId)),
  );
});
