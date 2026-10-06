import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRefreshed, buildQuote, priceLines, type BuildQuoteInput, type PricingRuleRow } from "../quote";
import {
  buildManualLine,
  copyTier,
  findCandidate,
  mergePool,
  moveLine,
  pickPool,
  putLine,
  removeLine,
  setLinePrice,
  updateTier,
  withCustomerPrice,
  lineQuality,
} from "../quoteEdit";
import { revalidateSelected } from "../orchestrator";
import { mockAirConnector, mockHotelConnector } from "../connectors/mock";
import type { NormalizedFlightOffer, NormalizedHotelOffer, PackageLine, TravelPackage } from "../model/types";
import type { SearchQuery, SupplierCredentials } from "../connectors/types";

const creds: SupplierCredentials = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "x" } };
const q: SearchQuery = { kind: "flight", originIata: "ATH", destinationIata: "FCO", departDate: "2026-11-01", adults: 2, childrenAges: [], sellCurrency: "EUR" };
const NOW = 1_800_000_000_000;
const RULES: PricingRuleRow[] = [{ scope: "agency", rule: { markupPct: 0.1 }, active: true }];

async function setup() {
  const flights = (await mockAirConnector.search(creds, q)) as NormalizedFlightOffer[];
  const hotels = (await mockHotelConnector.search(creds, { ...q, kind: "hotel" })) as NormalizedHotelOffer[];
  const input: BuildQuoteInput = {
    quoteId: "qte_t", agencyId: "a", createdByUserId: "u", currency: "EUR", searchParams: {},
    days: 4, travelers: 2, destinationIata: "FCO", flights, hotels, rules: RULES, now: NOW, ttlMs: 60_000,
  };
  const quote = buildQuote(input);
  const pool = priceLines([...flights, ...hotels], RULES, { travelers: 2, currency: "EUR", destinationIata: "FCO" });
  return { packages: quote.packages, pool };
}

/** Every line and every total keep cost + markup + fee === price. */
function assertIdentity(packages: TravelPackage[]) {
  for (const p of packages) {
    for (const l of p.lines) {
      const f = l.financials;
      assert.equal(
        f.supplierCost.amountMinor + f.markup.amountMinor + f.serviceFee.amountMinor,
        f.customerPrice.amountMinor,
      );
    }
    const sum = p.lines.reduce((n, l) => n + l.financials.customerPrice.amountMinor, 0);
    assert.equal(p.totals.internal.customerPrice.amountMinor, sum);
  }
}

test("swapping a hotel replaces the line and recomputes the total", async () => {
  const { packages, pool } = await setup();
  const basic = packages.find((p) => p.tier === "basic")!;
  const hotelIdx = basic.lines.findIndex((l) => l.kind === "hotel");
  const other = pool.find((l) => l.kind === "hotel" && l.offer.offerId !== basic.lines[hotelIdx].offer.offerId)!;

  const next = putLine(packages, "basic", other, "EUR", hotelIdx);
  const nb = next.find((p) => p.tier === "basic")!;
  assert.equal(nb.lines[hotelIdx].offer.offerId, other.offer.offerId);
  assert.equal(nb.edited, true);
  assertIdentity(next);
  // Other tiers are untouched.
  assert.equal(next.find((p) => p.tier === "premium"), packages.find((p) => p.tier === "premium"));
});

test("adding the same item twice to one option is refused", async () => {
  const { packages } = await setup();
  const line = packages[0].lines[0];
  assert.throws(() => putLine(packages, "basic", line, "EUR"), /already contains/);
});

test("a line priced in another currency cannot be added", async () => {
  const { packages, pool } = await setup();
  const usd: PackageLine = {
    ...pool[0],
    offer: { ...pool[0].offer, offerId: "x:usd" },
    financials: { ...pool[0].financials, customerPrice: { amountMinor: 100, currency: "USD" } },
  };
  assert.throws(() => putLine(packages, "basic", usd, "EUR"), /priced in USD/);
});

test("remove and move keep totals honest", async () => {
  const { packages } = await setup();
  const moved = moveLine(packages, "comfort", 0, 1, "EUR");
  const c0 = packages.find((p) => p.tier === "comfort")!;
  const c1 = moved.find((p) => p.tier === "comfort")!;
  assert.equal(c1.lines[1].offer.offerId, c0.lines[0].offer.offerId);
  const removed = removeLine(moved, "comfort", 0, "EUR");
  assert.equal(removed.find((p) => p.tier === "comfort")!.lines.length, c0.lines.length - 1);
  assertIdentity(removed);
  assert.throws(() => removeLine(packages, "comfort", 99, "EUR"), /no longer exists/);
});

test("a typed price moves the margin, never the supplier cost", async () => {
  const { packages } = await setup();
  const line = packages[0].lines[0];
  const up = withCustomerPrice(line, line.financials.customerPrice.amountMinor + 5000);
  assert.equal(up.financials.supplierCost.amountMinor, line.financials.supplierCost.amountMinor);
  assert.equal(up.financials.markup.amountMinor, line.financials.markup.amountMinor + 5000);
  assert.equal(up.priceOverridden, true);

  // Below cost is allowed and shows as a loss.
  const loss = withCustomerPrice(line, 100);
  assert.ok(loss.financials.expectedGrossProfit.amountMinor < 0);

  const next = setLinePrice(packages, "basic", 0, 12345, "EUR");
  assertIdentity(next);
  assert.throws(() => withCustomerPrice(line, -1), /positive/);
  assert.throws(() => withCustomerPrice(line, 1.5), /positive/);
});

test("on a commissionable line the typed difference lands on the service fee", async () => {
  const { packages } = await setup();
  const base = packages[0].lines[0];
  const comm: PackageLine = {
    ...base,
    offer: { ...base.offer, cost: { ...base.offer.cost, rateType: "commissionable", markupForbidden: true } },
  };
  const out = withCustomerPrice(comm, comm.financials.customerPrice.amountMinor + 1000);
  assert.equal(out.financials.markup.amountMinor, comm.financials.markup.amountMinor);
  assert.equal(out.financials.serviceFee.amountMinor, comm.financials.serviceFee.amountMinor + 1000);
});

test("manual lines carry the agent's cost and price and reconcile", async () => {
  const { packages } = await setup();
  const ferry = buildManualLine(
    {
      category: "ferry", title: "Πειραιάς → Σαντορίνη", supplierName: "Blue Star",
      supplierCostMinor: 8000, customerPriceMinor: 9500, refundable: false, clientNote: "Κατάστρωμα",
    },
    "EUR", NOW, "abc",
  );
  assert.equal(ferry.offer.connectorId, "manual");
  assert.equal(ferry.financials.markup.amountMinor, 1500);
  const next = putLine(packages, "premium", ferry, "EUR");
  assertIdentity(next);
  assert.throws(
    () => buildManualLine({ category: "ferry", title: " ", supplierCostMinor: 1, customerPriceMinor: 1, refundable: false }, "EUR", NOW, "x"),
    /name/,
  );
  assert.throws(
    () => buildManualLine({ category: "ferry", title: "x", supplierCostMinor: -1, customerPriceMinor: 1, refundable: false }, "EUR", NOW, "x"),
    /supplier cost/,
  );
});

test("tiers can be renamed and hidden, but never all hidden", async () => {
  const { packages } = await setup();
  let next = updateTier(packages, "basic", { customTitle: "  Πρόταση Α  " });
  assert.equal(next.find((p) => p.tier === "basic")!.customTitle, "Πρόταση Α");
  next = updateTier(next, "comfort", { hidden: true });
  next = updateTier(next, "premium", { hidden: true });
  assert.throws(() => updateTier(next, "basic", { hidden: true }), /visible/);
  next = updateTier(next, "basic", { customTitle: null });
  assert.equal(next.find((p) => p.tier === "basic")!.customTitle, undefined);
});

test("copying an option duplicates its lines into another", async () => {
  const { packages } = await setup();
  const next = copyTier(packages, "premium", "basic", "EUR");
  const b = next.find((p) => p.tier === "basic")!;
  const pr = packages.find((p) => p.tier === "premium")!;
  assert.deepEqual(b.lines.map((l) => l.offer.offerId), pr.lines.map((l) => l.offer.offerId));
  assert.throws(() => copyTier(packages, "basic", "basic", "EUR"), /different/);
});

test("the pool keeps both the cheapest and the best, and merges without duplicates", async () => {
  const { pool } = await setup();
  const hotels = pool.filter((l) => l.kind === "hotel");
  const picked = pickPool(hotels, 2, lineQuality);
  const ids = picked.map((l) => l.offer.offerId);
  assert.ok(ids.includes("mock-hotel:H1")); // cheapest
  assert.ok(ids.includes("mock-hotel:H3")); // best rated

  const merged = mergePool({ hotel: hotels }, { hotel: [hotels[0]] });
  assert.equal(merged.hotel!.length, hotels.length);
  assert.ok(findCandidate(merged, [], "mock-hotel:H2"));
  assert.equal(findCandidate(merged, [], "nope"), null);
});

test("revalidation refreshes the provider token and re-prices a moved cost", async () => {
  const { packages } = await setup();
  const hotelLine = packages.find((p) => p.tier === "premium")!.lines.find((l) => l.kind === "hotel")!;
  const oldCost = hotelLine.financials.supplierCost.amountMinor;
  const newCost = { ...hotelLine.offer.cost, base: { amountMinor: hotelLine.offer.cost.base.amountMinor + 1000, currency: "EUR" } };

  const next = applyRefreshed(
    packages,
    [{ offerId: hotelLine.offer.offerId, revalidationToken: "NEW-KEY", cost: newCost }],
    { rules: RULES, travelers: 2, currency: "EUR", destinationIata: "FCO" },
  );
  const updated = next.find((p) => p.tier === "premium")!.lines.find((l) => l.kind === "hotel")!;
  assert.equal(updated.offer.revalidationToken, "NEW-KEY");
  assert.equal(updated.financials.supplierCost.amountMinor, oldCost + 1000);
  assertIdentity(next);
});

test("a hand-typed price survives a supplier price move; the margin absorbs it", async () => {
  const { packages } = await setup();
  const priced = setLinePrice(packages, "basic", 0, 50_000, "EUR");
  const line = priced.find((p) => p.tier === "basic")!.lines[0];
  const moved = { ...line.offer.cost, base: { amountMinor: line.offer.cost.base.amountMinor + 700, currency: "EUR" } };
  const next = applyRefreshed(priced, [{ offerId: line.offer.offerId, cost: moved }], {
    rules: RULES, travelers: 2, currency: "EUR",
  });
  const after = next.find((p) => p.tier === "basic")!.lines[0];
  assert.equal(after.financials.customerPrice.amountMinor, 50_000);
  assert.equal(after.financials.markup.amountMinor, line.financials.markup.amountMinor - 700);
  assertIdentity(next);
});

test("revalidation vouches for manual lines instead of calling them unverifiable", async () => {
  const ferry = buildManualLine(
    { category: "ferry", title: "Ferry", supplierCostMinor: 100, customerPriceMinor: 120, refundable: true },
    "EUR", NOW, "f1",
  );
  const out = await revalidateSelected(new Map(), [ferry.offer], NOW);
  assert.equal(out.quoteStillValid, true);
  assert.equal(out.lines[0].unverifiable, undefined);
});

test("revalidation flags a price move the connector did not report", async () => {
  const flights = (await mockAirConnector.search(creds, q)) as NormalizedFlightOffer[];
  const offer = flights[0];
  const moving = {
    ...mockAirConnector,
    revalidate: async () => ({
      stillAvailable: true,
      priceChanged: false,
      offer: { ...offer, revalidationToken: "fresh", cost: { ...offer.cost, base: { amountMinor: offer.cost.base.amountMinor + 1, currency: "EUR" } } },
    }),
  };
  const out = await revalidateSelected(new Map([["mock-air", { connector: moving, creds }]]), [offer], NOW);
  assert.equal(out.anyPriceChanged, true);
  assert.equal(out.refreshed?.[0].revalidationToken, "fresh");
  assert.ok(out.refreshed?.[0].cost);
});

test("the client's copy of a manual line carries the note and title, never the supplier", async () => {
  const { toCustomerPackages } = await import("../quoteView");
  const { packages } = await setup();
  const ferry = buildManualLine(
    { category: "ferry", title: "Ferry", supplierName: "Secret Lines", supplierCostMinor: 100, customerPriceMinor: 150, refundable: true, clientNote: "Deck" },
    "EUR", NOW, "s1",
  );
  const edited = updateTier(putLine(packages, "basic", ferry, "EUR"), "basic", { customTitle: "Πρόταση Α" });
  const customer = toCustomerPackages(edited);
  const json = JSON.stringify(customer);
  assert.ok(!json.includes("Secret Lines"));
  assert.ok(json.includes("Deck"));
  assert.equal(customer.find((p) => p.tier === "basic")!.customTitle, "Πρόταση Α");
});
