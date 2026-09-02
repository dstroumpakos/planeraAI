/**
 * Planera for Travel Agencies — Quote assembly (pure).
 *
 * Ties the engines together: price every candidate → score & select the three
 * tiers → assemble Basic/Comfort/Premium `TravelPackage`s with agent-internal
 * financials, an ESTIMATE-ONLY food budget, and disclosed pay-at-property
 * charges → wrap in a `Quote` with an expiry.
 *
 * Pure & deterministic: `now` and `quoteId` are injected. No pricing happens
 * per-tier (each offer is priced once against the resolved rule); tier
 * differentiation comes from SELECTION, not per-tier markup — package-scoped
 * pricing rules are a documented post-MVP refinement (schema already supports it).
 */

import type {
  CurrencyCode,
  Money,
  NormalizedActivityOffer,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedOffer,
  NormalizedTransferOffer,
  PackageLine,
  PackageTier,
  Quote,
  TravelPackage,
} from "./model/types";
import { money } from "./model/types";
import { priceOffer, sumFinancials, type PricingRule } from "./pricing";
import { selectAllTiers, type PricedCandidate, type SelectedTier } from "./scoring";

// Default estimate-only daily food budget per person, in minor units.
export const DEFAULT_FOOD_BUDGET_MINOR: Record<PackageTier, number> = {
  basic: 2500, // €25/day
  comfort: 4500, // €45/day
  premium: 8000, // €80/day
};

export interface PricingRuleRow {
  scope: "agency" | "supplier" | "destination" | "product" | "package";
  selector?: string;
  rule: PricingRule;
  active: boolean;
}

/** Most-specific active rule wins: destination > supplier > agency-default. */
export function resolvePricingRule(
  rules: PricingRuleRow[],
  ctx: { connectorId: string; destinationIata?: string },
): PricingRule {
  const active = rules.filter((r) => r.active);
  const byDest = ctx.destinationIata
    ? active.find((r) => r.scope === "destination" && r.selector === ctx.destinationIata)
    : undefined;
  const bySupplier = active.find((r) => r.scope === "supplier" && r.selector === ctx.connectorId);
  const agency = active.find((r) => r.scope === "agency");
  return (byDest ?? bySupplier ?? agency)?.rule ?? {};
}

export interface BuildQuoteInput {
  quoteId: string;
  agencyId: string;
  createdByUserId: string;
  currency: CurrencyCode;
  searchParams: unknown; // snapshot, stored verbatim
  days: number;
  travelers: number;
  destinationIata?: string;
  flights: NormalizedFlightOffer[];
  hotels: NormalizedHotelOffer[];
  /** Optional: absent when no activity supplier is connected or mapped. */
  activities?: NormalizedActivityOffer[];
  transfers?: NormalizedTransferOffer[];
  rules: PricingRuleRow[];
  now: number;
  ttlMs: number;
  foodBudgetMinor?: Record<PackageTier, number>;
}

function priceCandidates<T extends NormalizedOffer>(
  offers: T[],
  rules: PricingRuleRow[],
  input: BuildQuoteInput,
): PricedCandidate<T>[] {
  return offers.map((offer) => {
    const rule = resolvePricingRule(rules, { connectorId: offer.connectorId, destinationIata: input.destinationIata });
    const financials = priceOffer(offer.cost, rule, { travelers: input.travelers, sellCurrency: input.currency });
    return { offer, financials } as PricedCandidate<T>;
  });
}

function buildPackage(tier: PackageTier, sel: SelectedTier, input: BuildQuoteInput): TravelPackage {
  const cur = input.currency;
  const lines: PackageLine[] = [];
  const scores: number[] = [];
  const payAtProperty: Money[] = [];

  if (sel.flight) {
    lines.push({ kind: "flight", offer: sel.flight.cand.offer, financials: sel.flight.cand.financials });
    scores.push(sel.flight.score);
  }
  if (sel.hotel) {
    lines.push({ kind: "hotel", offer: sel.hotel.cand.offer, financials: sel.hotel.cand.financials });
    scores.push(sel.hotel.score);
    for (const c of sel.hotel.cand.offer.cost.payAtProperty ?? []) payAtProperty.push(c.amount);
  }
  // Transfers before activities: the document reads as a journey — get there,
  // sleep, then do things — and the line order is what a client actually scans.
  for (const t of sel.transfers) {
    lines.push({ kind: "transfer", offer: t.cand.offer, financials: t.cand.financials });
    scores.push(t.score);
  }
  for (const a of sel.activities) {
    lines.push({ kind: "activity", offer: a.cand.offer, financials: a.cand.financials });
    scores.push(a.score);
  }

  const internal = sumFinancials(lines.map((l) => l.financials), cur);
  const perDay = (input.foodBudgetMinor ?? DEFAULT_FOOD_BUDGET_MINOR)[tier];

  return {
    tier,
    lines,
    foodBudget: {
      perDayPerPerson: money(perDay, cur),
      days: input.days,
      travelers: input.travelers,
      isEstimate: true,
    },
    totals: { internal, payAtProperty },
    score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
  };
}

/** Assemble the full three-tier quote. */
export function buildQuote(input: BuildQuoteInput): Quote {
  const pricedFlights = priceCandidates(input.flights, input.rules, input);
  const pricedHotels = priceCandidates(input.hotels, input.rules, input);
  const pricedActivities = priceCandidates(input.activities ?? [], input.rules, input);
  const pricedTransfers = priceCandidates(input.transfers ?? [], input.rules, input);
  const tiers = selectAllTiers(pricedFlights, pricedHotels, pricedActivities, pricedTransfers);

  const packages: TravelPackage[] = (["basic", "comfort", "premium"] as PackageTier[]).map((t) =>
    buildPackage(t, tiers[t], input),
  );

  return {
    quoteId: input.quoteId,
    agencyId: input.agencyId,
    createdByUserId: input.createdByUserId,
    currency: input.currency,
    packages,
    searchedAt: input.now,
    expiresAt: input.now + input.ttlMs,
    status: "draft",
  };
}

/** True if the quote's hard expiry has passed → must revalidate before acting. */
export function isQuoteExpired(quote: Quote, now: number = Date.now()): boolean {
  return now >= quote.expiresAt;
}

/**
 * The expiry a quote carries after a revalidation attempt.
 *
 * A SUCCESSFUL revalidation is a fresh confirmation from every supplier behind
 * the quote — that is the whole point of the call — so it restarts the validity
 * window from now. Without this an expired quote could never be recovered: it
 * would revalidate cleanly and still read as expired, and `send` refuses an
 * expired quote with "revalidate it before sending".
 *
 * A FAILED revalidation keeps the old expiry. An offer that is gone, or that no
 * connector could verify, must not buy the quote more time.
 */
export function revalidatedExpiry(input: {
  stillValid: boolean;
  now: number;
  ttlMs: number;
  currentExpiresAt: number;
}): number {
  return input.stillValid ? input.now + input.ttlMs : input.currentExpiresAt;
}
