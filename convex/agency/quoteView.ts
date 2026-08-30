/**
 * Planera for Travel Agencies — quote projections (pure).
 *
 * A quote holds two audiences in one document. The agent sees cost, markup and
 * expected margin; the traveller must see only the price they pay. Hiding the
 * internal numbers in the UI would be a lie — they would still be sitting in
 * the browser's network tab — so the split happens HERE, on the server, and the
 * customer-facing endpoint returns a document that never contained them.
 *
 * The same pass strips two other things that must never travel outward:
 *  - `offer.raw`, the provider's own payload (bloat, and provider data we have
 *    no licence to redistribute),
 *  - `revalidationToken`, which is a provider-locked handle to a real fare.
 */

import type {
  NormalizedOffer,
  PackageLine,
  TravelPackage,
  Money,
  PackageTier,
} from "./model/types";

/** Drop provider payloads and booking handles from an offer. */
export function scrubOffer<T extends NormalizedOffer>(offer: T, keepToken: boolean): T {
  const { raw: _raw, ...rest } = offer as NormalizedOffer & { raw?: unknown };
  const scrubbed = rest as T;
  if (!keepToken) {
    return { ...scrubbed, revalidationToken: undefined };
  }
  return scrubbed;
}

/**
 * What gets PERSISTED. Provider payloads are dropped (they can be megabytes and
 * we never read them back), but the revalidation token is kept — without it the
 * quote could never be re-priced.
 */
export function scrubForStorage(packages: TravelPackage[]): TravelPackage[] {
  return packages.map((p) => ({
    ...p,
    lines: p.lines.map((l) => ({ ...l, offer: scrubOffer(l.offer, true) })),
  }));
}

// ── Customer projection ─────────────────────────────────────────────────────

export interface CustomerLine {
  kind: PackageLine["kind"];
  offer: NormalizedOffer;
  /** The only money a traveller sees for this line. */
  price: Money;
}

export interface CustomerPackage {
  tier: PackageTier;
  lines: CustomerLine[];
  foodBudget?: TravelPackage["foodBudget"];
  total: Money;
  payAtProperty: Money[];
}

/**
 * Project packages for the traveller. Everything the agency considers internal
 * — supplier cost, markup, service fee, expected commission, gross profit — is
 * absent from the returned objects, not merely flagged.
 */
export function toCustomerPackages(packages: TravelPackage[]): CustomerPackage[] {
  return packages.map((p) => ({
    tier: p.tier,
    lines: p.lines.map((l) => ({
      kind: l.kind,
      offer: scrubOffer(l.offer, false),
      price: l.financials.customerPrice,
    })),
    foodBudget: p.foodBudget,
    total: p.totals.internal.customerPrice,
    payAtProperty: p.totals.payAtProperty,
  }));
}

/** The agent projection: everything, minus provider payloads. */
export function toAgentPackages(packages: TravelPackage[]): TravelPackage[] {
  return packages.map((p) => ({
    ...p,
    lines: p.lines.map((l) => ({ ...l, offer: scrubOffer(l.offer, true) })),
  }));
}

/**
 * Every offer a quote committed to, for revalidation. Deduplicated: the same
 * offer can win more than one tier and must not be re-checked twice.
 */
export function selectedOffers(packages: TravelPackage[]): NormalizedOffer[] {
  const byId = new Map<string, NormalizedOffer>();
  for (const p of packages) {
    for (const l of p.lines) if (!byId.has(l.offer.offerId)) byId.set(l.offer.offerId, l.offer);
  }
  return [...byId.values()];
}
