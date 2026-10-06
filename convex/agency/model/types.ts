/**
 * Planera for Travel Agencies — canonical domain model.
 *
 * Framework-agnostic (NO Convex imports) so the pricing/scoring engines that
 * depend on it stay pure and unit-testable. Convex functions import these types
 * and map them to/from `v.*` validators at the boundary.
 *
 * MONEY RULE: every monetary value is an integer in the currency's MINOR unit
 * (cents). Never floats. See `Money`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

export type CurrencyCode = string; // ISO 4217, e.g. "EUR"

/** An amount in integer minor units (cents) + its currency. */
export interface Money {
  /** Integer minor units. 12345 === €123.45 for EUR. */
  amountMinor: number;
  currency: CurrencyCode;
}

export const money = (amountMinor: number, currency: CurrencyCode): Money => ({
  amountMinor: Math.round(amountMinor),
  currency,
});

export const zeroMoney = (currency: CurrencyCode): Money => money(0, currency);

// ─────────────────────────────────────────────────────────────────────────────
// Offer primitives
// ─────────────────────────────────────────────────────────────────────────────

export type OfferKind = "flight" | "hotel" | "activity" | "transfer" | "service";

/** Kinds a supplier can be SEARCHED for. "service" only ever comes from an agent's hand. */
export type SearchableOfferKind = Exclude<OfferKind, "service">;

/** connectorId carried by every line an agent typed in rather than searched. */
export const MANUAL_CONNECTOR_ID = "manual";

/**
 * How the supplier price is expressed. Drives whether markup / commission are
 * even legal to apply (see pricing engine).
 *  - "net"           : agency buys net, marks up freely, keeps the spread.
 *  - "commissionable": gross price to traveller; agency earns a % commission and
 *                      generally may NOT add markup on top (supplier terms).
 *  - "gross"         : fixed retail price; no markup, no commission.
 */
export type RateType = "net" | "commissionable" | "gross";

/** A charge the traveller pays locally at the property/on arrival, not to the agency. */
export interface PayAtPropertyCharge {
  label: string;
  amount: Money;
  mandatory: boolean;
}

/** Supplier-declared fare/booking conditions, normalised across providers. */
export interface FareConditions {
  refundable: boolean;
  changeable: boolean;
  /** Penalty charged to cancel, if known. */
  cancellationPenalty?: Money;
  /** Penalty charged to change, if known. */
  changePenalty?: Money;
  /** Free human-readable summary for the quote. */
  summary?: string;
}

export interface BaggageAllowance {
  /** Cabin bags included (count). */
  cabin: number;
  /** Checked bags included (count). */
  checked: number;
  /** Checked weight per bag in kg, if known. */
  checkedWeightKg?: number;
}

/**
 * The cost side of an offer as returned by a supplier connector. This is what
 * the agency PAYS (or the gross the traveller pays for commissionable rates).
 */
export interface SupplierCost {
  rateType: RateType;
  /** Base price excluding taxes already itemised in `taxes`. */
  base: Money;
  /** Taxes/fees already included by the supplier (do NOT re-add in pricing). */
  taxes: Money;
  /** For commissionable rates: the commission % the agency earns (0..1). */
  commissionRate?: number;
  /** Charges paid locally — surfaced to the traveller, excluded from agency price. */
  payAtProperty?: PayAtPropertyCharge[];
  /**
   * If true, the supplier's contract forbids adding markup on top (typical for
   * commissionable/gross). The pricing engine hard-refuses markup in that case.
   */
  markupForbidden?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalised offers (one per kind), unified by `NormalizedOffer`
// ─────────────────────────────────────────────────────────────────────────────

interface OfferBase {
  /** Stable id within a search: `${connectorId}:${supplierOfferId}`. */
  offerId: string;
  connectorId: string;
  supplierOfferId: string;
  cost: SupplierCost;
  conditions: FareConditions;
  /**
   * Provider-locked token needed to revalidate/book this exact offer. Opaque;
   * must be revalidated on the SAME connector that produced it.
   */
  revalidationToken?: string;
  /** When the supplier price was captured (epoch ms). */
  quotedAt: number;
  /** When the supplier offer expires, if declared (epoch ms). */
  expiresAt?: number;
  raw?: unknown; // provider payload for debugging; never sent to traveller
}

export interface FlightSegment {
  fromIata: string;
  toIata: string;
  departISO: string; // ISO 8601 in origin local time
  arriveISO: string;
  carrier: string;
  flightNumber?: string;
  durationMinutes: number;
}

export interface NormalizedFlightOffer extends OfferBase {
  kind: "flight";
  outbound: FlightSegment[];
  inbound?: FlightSegment[];
  /** Total stops across outbound (0 = direct). */
  outboundStops: number;
  inboundStops?: number;
  totalDurationMinutes: number;
  cabinClass: string; // "economy" | "premium_economy" | "business" | "first"
  baggage: BaggageAllowance;
}

export interface NormalizedHotelOffer extends OfferBase {
  kind: "hotel";
  name: string;
  starRating?: number; // 1..5
  reviewScore?: number; // 0..10 normalised
  /** Distance from the requested/city centre anchor, metres. */
  distanceFromCentreM?: number;
  boardType: "room_only" | "breakfast" | "half_board" | "full_board" | "all_inclusive";
  roomCategory?: string;
  nights: number;
  freeCancellationUntilISO?: string;
}

export interface NormalizedActivityOffer extends OfferBase {
  kind: "activity";
  title: string;
  category?: string;
  durationMinutes?: number;
  /** Editorial/quality signal 0..1 if the provider exposes one. */
  qualityScore?: number;
}

export interface NormalizedTransferOffer extends OfferBase {
  kind: "transfer";
  mode: "shared" | "private";
  fromLabel: string;
  toLabel: string;
}

/**
 * A line the AGENT added by hand: a hotel from the agency's own contract, a
 * ferry, insurance, a car, a guide. Tailor-made agencies sell many things no
 * connected API returns, and a quote that could only hold API results would
 * send them back to Word for the rest.
 *
 * Its price is whatever the agent typed. It is never revalidated against a
 * supplier (there is none to ask) — the agent vouches for it, and the UI says so.
 */
export interface NormalizedServiceOffer extends OfferBase {
  kind: "service";
  title: string;
  description?: string;
  category:
    | "flight"
    | "hotel"
    | "transfer"
    | "activity"
    | "ferry"
    | "car"
    | "insurance"
    | "guide"
    | "other";
  /** Who the agency buys it from, e.g. "Anek Lines", "own contract". Agent-only. */
  supplierName?: string;
}

export type NormalizedOffer =
  | NormalizedFlightOffer
  | NormalizedHotelOffer
  | NormalizedActivityOffer
  | NormalizedTransferOffer
  | NormalizedServiceOffer;

// ─────────────────────────────────────────────────────────────────────────────
// Packages & quotes
// ─────────────────────────────────────────────────────────────────────────────

export type PackageTier = "basic" | "comfort" | "premium";

/** An optional, estimate-only daily food budget line (never a booked service). */
export interface FoodBudgetEstimate {
  perDayPerPerson: Money;
  days: number;
  travelers: number;
  /** Always true — food is an ESTIMATE unless it comes from a supplier product. */
  isEstimate: true;
}

/** Internal (agent-only) financials for one priced line or the whole package. */
export interface InternalFinancials {
  supplierCost: Money; // what the agency pays / gross of commissionable
  markup: Money;
  serviceFee: Money;
  expectedCommission: Money; // NOT yet earned — expected only
  customerPrice: Money; // what the traveller is quoted
  expectedGrossProfit: Money; // markup + serviceFee + expectedCommission
}

/** One selected offer inside a package, with its priced result. */
export interface PackageLine {
  kind: OfferKind;
  offer: NormalizedOffer;
  financials: InternalFinancials;
  /**
   * True once the agent typed this line's customer price by hand. A later
   * re-pricing then keeps the price the client was shown and lets the margin
   * absorb the supplier's move, instead of silently changing a number the
   * agent chose.
   */
  priceOverridden?: boolean;
  /** Shown to the client under the line, e.g. "Sea-view room on request". */
  clientNote?: string;
}

export interface TravelPackage {
  tier: PackageTier;
  lines: PackageLine[];
  foodBudget?: FoodBudgetEstimate;
  /** Package totals (sum of lines + food estimate shown separately). */
  totals: {
    internal: InternalFinancials;
    /** Charges the traveller pays locally, aggregated for disclosure. */
    payAtProperty: Money[];
  };
  /** 0..1 composite score that won this offer set for this tier. */
  score: number;
  /**
   * The agent's own name for this option ("Πρόταση Α", "Με Σαντορίνη"). A
   * tailor-made proposal is often ONE option, or two that differ by island,
   * not a cheap/middle/expensive ladder — so the tier label has to be optional.
   */
  customTitle?: string;
  /** Hidden from the client. The agent keeps it to switch back later. */
  hidden?: boolean;
  /** True once the agent changed any line — the engine's score no longer applies. */
  edited?: boolean;
}

export interface Quote {
  quoteId: string;
  agencyId: string;
  createdByUserId: string;
  currency: CurrencyCode;
  packages: TravelPackage[];
  /** epoch ms — hard stop after which prices must be revalidated. */
  expiresAt: number;
  searchedAt: number;
  lastRevalidatedAt?: number;
  status: "draft" | "sent" | "accepted" | "expired" | "revalidating";
}
