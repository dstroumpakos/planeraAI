/**
 * Planera for Travel Agencies — Pricing Engine (pure).
 *
 * Turns a supplier cost + the agency's pricing rules into the internal
 * financial breakdown (cost / markup / fee / expected commission / customer
 * price / expected gross profit).
 *
 * INVARIANTS (enforced, not assumed):
 *  1. Never double-count taxes: `SupplierCost.taxes` is already included; we do
 *     not add tax again.
 *  2. Never add markup when supplier terms forbid it (commissionable/gross with
 *     `markupForbidden`, or any non-"net" rate unless the rule explicitly opts in).
 *  3. Expected commission is EXPECTED, never presented as earned profit here —
 *     the caller/UI labels it as such; it is summed into expectedGrossProfit
 *     but kept as its own line.
 *  4. Pay-at-property charges are surfaced separately and NEVER folded into the
 *     agency-collected customer price.
 *  5. Deterministic rounding at the very end only.
 *
 * All math in integer minor units (cents).
 */

import type {
  CurrencyCode,
  InternalFinancials,
  Money,
  SupplierCost,
} from "./model/types";
import { money } from "./model/types";

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

export type RoundingStrategy =
  | "none" // exact cents
  | "nearest_1" // whole currency unit (…,00)
  | "charm_99" // …,99 psychological pricing
  | "nearest_5"; // nearest 5 units

export interface PricingRule {
  /** Percent markup on net base, 0..1 (0.15 = +15%). Applied ONLY on net rates. */
  markupPct?: number;
  /** Flat markup added on net rates (minor units). */
  markupFlatMinor?: number;
  /** Flat agency service fee added on ANY rate type (minor units). */
  serviceFeeMinor?: number;
  /** Per-traveller service fee (minor units) — multiplied by travelers. */
  serviceFeePerTravelerMinor?: number;
  /**
   * FX safety buffer, 0..1, applied to supplier cost when the supplier currency
   * differs from the agency's sell currency. Protects against rate moves.
   */
  fxBufferPct?: number;
  rounding?: RoundingStrategy;
  /**
   * Explicit opt-in to add markup on commissionable rates. Default false because
   * most commissionable contracts forbid it. Even when true, an offer-level
   * `markupForbidden` still wins (supplier terms are authoritative).
   */
  allowMarkupOnCommissionable?: boolean;
}

export interface PricingContext {
  travelers: number;
  /** The currency the agency sells in (customer-facing). */
  sellCurrency: CurrencyCode;
  /**
   * FX conversion minor-units-per-1-unit map is out of scope for the pure
   * engine; callers pass an already-converted `SupplierCost` in `sellCurrency`,
   * plus a flag if a conversion happened (to trigger the FX buffer).
   */
  fxConverted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rounding
// ─────────────────────────────────────────────────────────────────────────────

export function applyRounding(amountMinor: number, strategy: RoundingStrategy): number {
  const n = Math.round(amountMinor);
  switch (strategy) {
    case "none":
      return n;
    case "nearest_1":
      return Math.round(n / 100) * 100;
    case "nearest_5":
      return Math.round(n / 500) * 500;
    case "charm_99": {
      // Smallest value ending in …99 that is >= n, so we never round below the
      // computed price (protects margin). e.g. 14300 → 14399, 9950 → 9999.
      let v = Math.ceil(n / 100) * 100 - 1;
      if (v < n) v += 100;
      return v;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

/** Guard: is markup permitted for this offer under this rule? */
export function markupAllowed(cost: SupplierCost, rule: PricingRule): boolean {
  if (cost.markupForbidden) return false;
  if (cost.rateType === "net") return true;
  if (cost.rateType === "commissionable") return rule.allowMarkupOnCommissionable === true;
  return false; // "gross" never
}

/**
 * Price a single supplier cost. Returns the internal breakdown. The supplier
 * cost MUST already be expressed in `ctx.sellCurrency` (caller handles FX
 * conversion); we only apply the FX BUFFER here when `ctx.fxConverted`.
 */
export function priceOffer(
  cost: SupplierCost,
  rule: PricingRule,
  ctx: PricingContext,
): InternalFinancials {
  const cur = ctx.sellCurrency;
  if (cost.base.currency !== cur || cost.taxes.currency !== cur) {
    throw new Error(
      `pricing: supplier cost must be pre-converted to sell currency ${cur} ` +
        `(got base=${cost.base.currency}, taxes=${cost.taxes.currency})`,
    );
  }

  // (1) Supplier cost = base + taxes (taxes already included — never re-added).
  let supplierCostMinor = cost.base.amountMinor + cost.taxes.amountMinor;

  // FX buffer applies to the cost we protect against, only if a conversion happened.
  if (ctx.fxConverted && rule.fxBufferPct && rule.fxBufferPct > 0) {
    supplierCostMinor += Math.round(supplierCostMinor * rule.fxBufferPct);
  }

  // (2) Markup — net rates only, and only if permitted.
  let markupMinor = 0;
  if (markupAllowed(cost, rule)) {
    if (rule.markupPct && rule.markupPct > 0) {
      markupMinor += Math.round(cost.base.amountMinor * rule.markupPct);
    }
    if (rule.markupFlatMinor && rule.markupFlatMinor > 0) {
      markupMinor += rule.markupFlatMinor;
    }
  }

  // (3) Service fee — allowed on any rate type (it's the agency's own fee).
  let serviceFeeMinor = 0;
  if (rule.serviceFeeMinor && rule.serviceFeeMinor > 0) {
    serviceFeeMinor += rule.serviceFeeMinor;
  }
  if (rule.serviceFeePerTravelerMinor && rule.serviceFeePerTravelerMinor > 0) {
    serviceFeeMinor += rule.serviceFeePerTravelerMinor * Math.max(1, ctx.travelers);
  }

  // (4) Expected commission — commissionable rates only. EXPECTED, not earned.
  let expectedCommissionMinor = 0;
  if (cost.rateType === "commissionable" && cost.commissionRate && cost.commissionRate > 0) {
    // Commission is earned on the gross the traveller pays (base + taxes).
    expectedCommissionMinor = Math.round(
      (cost.base.amountMinor + cost.taxes.amountMinor) * cost.commissionRate,
    );
  }

  // (5) Customer price.
  //   - net:            supplierCost + markup + serviceFee
  //   - commissionable: the gross IS the customer price (commission comes from
  //                     the supplier out of that gross); + agency serviceFee.
  //                     Markup only if explicitly allowed (rare) and permitted.
  //   - gross:          fixed retail; + agency serviceFee only.
  let customerPriceMinor: number;
  if (cost.rateType === "net") {
    customerPriceMinor = supplierCostMinor + markupMinor + serviceFeeMinor;
  } else {
    // commissionable / gross: traveller pays the gross; agency adds its own fee
    // (and, for commissionable with opt-in, any permitted markup).
    customerPriceMinor = supplierCostMinor + markupMinor + serviceFeeMinor;
  }

  // (6) Rounding at the very end, on the customer price only. Markup absorbs the
  //     rounding delta so cost + margin still reconcile.
  const rounding = rule.rounding ?? "none";
  const roundedCustomer = applyRounding(customerPriceMinor, rounding);
  const roundingDelta = roundedCustomer - customerPriceMinor;
  if (cost.rateType === "net") {
    markupMinor += roundingDelta; // keep identity: cost+markup+fee === customerPrice
  } else {
    // For commissionable/gross we don't inflate a forbidden markup; the delta is
    // absorbed into the service fee (the agency's own line).
    serviceFeeMinor += roundingDelta;
  }
  customerPriceMinor = roundedCustomer;

  const expectedGrossProfitMinor = markupMinor + serviceFeeMinor + expectedCommissionMinor;

  const m = (x: number): Money => money(x, cur);
  return {
    supplierCost: m(supplierCostMinor),
    markup: m(markupMinor),
    serviceFee: m(serviceFeeMinor),
    expectedCommission: m(expectedCommissionMinor),
    customerPrice: m(customerPriceMinor),
    expectedGrossProfit: m(expectedGrossProfitMinor),
  };
}

/** Sum many priced lines into one package-level financial total (same currency). */
export function sumFinancials(
  parts: InternalFinancials[],
  currency: CurrencyCode,
): InternalFinancials {
  const m = (x: number): Money => money(x, currency);
  const acc = parts.reduce(
    (a, p) => {
      a.supplierCost += p.supplierCost.amountMinor;
      a.markup += p.markup.amountMinor;
      a.serviceFee += p.serviceFee.amountMinor;
      a.expectedCommission += p.expectedCommission.amountMinor;
      a.customerPrice += p.customerPrice.amountMinor;
      a.expectedGrossProfit += p.expectedGrossProfit.amountMinor;
      return a;
    },
    {
      supplierCost: 0,
      markup: 0,
      serviceFee: 0,
      expectedCommission: 0,
      customerPrice: 0,
      expectedGrossProfit: 0,
    },
  );
  return {
    supplierCost: m(acc.supplierCost),
    markup: m(acc.markup),
    serviceFee: m(acc.serviceFee),
    expectedCommission: m(acc.expectedCommission),
    customerPrice: m(acc.customerPrice),
    expectedGrossProfit: m(acc.expectedGrossProfit),
  };
}
