import { test } from "node:test";
import assert from "node:assert/strict";
import { priceOffer, applyRounding, markupAllowed, type PricingRule, type PricingContext } from "../pricing";
import type { SupplierCost } from "../model/types";
import { money } from "../model/types";

const ctx: PricingContext = { travelers: 2, sellCurrency: "EUR" };

test("net rate: markup on base + service fee; taxes NOT double-counted", () => {
  const cost: SupplierCost = { rateType: "net", base: money(10000, "EUR"), taxes: money(1800, "EUR") };
  const rule: PricingRule = { markupPct: 0.15, serviceFeeMinor: 1000 };
  const f = priceOffer(cost, rule, ctx);
  assert.equal(f.supplierCost.amountMinor, 11800); // base + taxes, once
  assert.equal(f.markup.amountMinor, 1500); // 15% of base only
  assert.equal(f.serviceFee.amountMinor, 1000);
  assert.equal(f.expectedCommission.amountMinor, 0);
  assert.equal(f.customerPrice.amountMinor, 14300); // 11800 + 1500 + 1000
  assert.equal(f.expectedGrossProfit.amountMinor, 2500); // markup + fee
});

test("commissionable rate: markup FORBIDDEN by default; commission is expected-only", () => {
  const cost: SupplierCost = { rateType: "commissionable", base: money(20000, "EUR"), taxes: money(2000, "EUR"), commissionRate: 0.1 };
  const rule: PricingRule = { markupPct: 0.2, serviceFeeMinor: 500 }; // markup should be ignored
  const f = priceOffer(cost, rule, ctx);
  assert.equal(f.markup.amountMinor, 0, "no markup on commissionable without opt-in");
  assert.equal(f.expectedCommission.amountMinor, 2200); // 10% of gross(22000)
  assert.equal(f.customerPrice.amountMinor, 22500); // gross + agency fee only
  assert.equal(f.expectedGrossProfit.amountMinor, 2700); // fee + expected commission
});

test("gross rate: never any markup, even with opt-in", () => {
  const cost: SupplierCost = { rateType: "gross", base: money(30000, "EUR"), taxes: money(0, "EUR") };
  const rule: PricingRule = { markupPct: 0.5, allowMarkupOnCommissionable: true };
  assert.equal(markupAllowed(cost, rule), false);
  const f = priceOffer(cost, rule, ctx);
  assert.equal(f.markup.amountMinor, 0);
  assert.equal(f.customerPrice.amountMinor, 30000);
});

test("offer-level markupForbidden overrides a net rate", () => {
  const cost: SupplierCost = { rateType: "net", base: money(10000, "EUR"), taxes: money(0, "EUR"), markupForbidden: true };
  const rule: PricingRule = { markupPct: 0.3 };
  const f = priceOffer(cost, rule, ctx);
  assert.equal(f.markup.amountMinor, 0);
});

test("per-traveler service fee multiplies by travelers", () => {
  const cost: SupplierCost = { rateType: "net", base: money(10000, "EUR"), taxes: money(0, "EUR") };
  const rule: PricingRule = { serviceFeePerTravelerMinor: 500 };
  const f = priceOffer(cost, rule, { travelers: 3, sellCurrency: "EUR" });
  assert.equal(f.serviceFee.amountMinor, 1500);
});

test("FX buffer applies only when fxConverted", () => {
  const cost: SupplierCost = { rateType: "net", base: money(10000, "EUR"), taxes: money(0, "EUR") };
  const rule: PricingRule = { fxBufferPct: 0.03 };
  const noFx = priceOffer(cost, rule, { travelers: 1, sellCurrency: "EUR", fxConverted: false });
  assert.equal(noFx.supplierCost.amountMinor, 10000);
  const withFx = priceOffer(cost, rule, { travelers: 1, sellCurrency: "EUR", fxConverted: true });
  assert.equal(withFx.supplierCost.amountMinor, 10300); // +3%
});

test("rounding preserves identity cost + markup + fee === customerPrice (net)", () => {
  const cost: SupplierCost = { rateType: "net", base: money(9873, "EUR"), taxes: money(410, "EUR") };
  const rule: PricingRule = { markupPct: 0.155, serviceFeeMinor: 733, rounding: "charm_99" };
  const f = priceOffer(cost, rule, ctx);
  assert.equal(
    f.supplierCost.amountMinor + f.markup.amountMinor + f.serviceFee.amountMinor,
    f.customerPrice.amountMinor,
  );
  assert.equal(f.customerPrice.amountMinor % 100, 99); // ends in .99
});

test("charm_99 never rounds below the raw price", () => {
  assert.equal(applyRounding(14300, "charm_99"), 14399);
  assert.equal(applyRounding(9950, "charm_99"), 9999);
  assert.equal(applyRounding(9999, "charm_99"), 9999);
  assert.ok(applyRounding(10000, "charm_99") >= 10000);
});

test("throws if supplier cost not pre-converted to sell currency", () => {
  const cost: SupplierCost = { rateType: "net", base: money(10000, "USD"), taxes: money(0, "USD") };
  assert.throws(() => priceOffer(cost, {}, ctx), /pre-converted/);
});
