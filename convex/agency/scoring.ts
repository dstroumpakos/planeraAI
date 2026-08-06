/**
 * Planera for Travel Agencies — Package Scoring Engine (pure).
 *
 * Builds Basic / Comfort / Premium from a pool of already-PRICED candidate
 * offers. It does NOT pick "cheapest / middle / priciest" — each tier is a
 * weighted multi-criteria score over normalised dimensions:
 *
 *   price, stops, travel times, total duration, baggage, fare conditions,
 *   refundability, cancellation penalties, hotel distance from centre, hotel
 *   rating, room/board, flexibility, activity quality — PLUS a small weight on
 *   the agency's real expected margin (never dominant).
 *
 * Determinism: min-max normalisation is computed within the candidate pool;
 * ties break by lower supplier cost then offerId, so the same input always
 * yields the same packages.
 */

import type {
  InternalFinancials,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedOffer,
  PackageTier,
} from "./model/types";

export interface PricedCandidate<T extends NormalizedOffer = NormalizedOffer> {
  offer: T;
  financials: InternalFinancials;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers → all sub-scores are in [0,1], higher = better.
// ─────────────────────────────────────────────────────────────────────────────

/** Lower-is-better min-max: cheapest/shortest → 1, most expensive/longest → 0. */
function invMinMax(value: number, min: number, max: number): number {
  if (max <= min) return 1; // all equal → neutral-good
  return clamp01((max - value) / (max - min));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Departure-time desirability: penalise red-eyes and very early departures.
 * Returns 1 for the 08:00–20:00 sweet spot, tapering to ~0.2 overnight.
 */
export function departTimeScore(departISO: string): number {
  const h = new Date(departISO).getHours();
  if (Number.isNaN(h)) return 0.5;
  if (h >= 8 && h <= 20) return 1;
  if (h >= 6 && h < 8) return 0.7;
  if (h > 20 && h <= 22) return 0.7;
  return 0.25; // 22:00–06:00
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier weight profiles. Each tier weights the dimensions differently.
// Weights need not sum to 1 (we normalise by the sum of weights actually used).
// ─────────────────────────────────────────────────────────────────────────────

export interface FlightWeights {
  price: number;
  stops: number;
  duration: number;
  departTime: number;
  baggage: number;
  refundable: number;
  changeable: number;
  lowPenalty: number;
  margin: number;
}

export interface HotelWeights {
  price: number;
  starRating: number;
  reviewScore: number;
  proximity: number;
  breakfast: number;
  freeCancellation: number;
  margin: number;
}

export const FLIGHT_WEIGHTS: Record<PackageTier, FlightWeights> = {
  // Basic: price dominates; everything else must be merely acceptable.
  basic: { price: 0.55, stops: 0.1, duration: 0.08, departTime: 0.05, baggage: 0.03, refundable: 0.02, changeable: 0.02, lowPenalty: 0.05, margin: 0.1 },
  // Comfort: balanced — value directs & good times & baggage.
  comfort: { price: 0.28, stops: 0.18, duration: 0.12, departTime: 0.12, baggage: 0.1, refundable: 0.06, changeable: 0.04, lowPenalty: 0.04, margin: 0.06 },
  // Premium: flexibility, directness, times; price matters least.
  premium: { price: 0.12, stops: 0.2, duration: 0.14, departTime: 0.16, baggage: 0.12, refundable: 0.12, changeable: 0.08, lowPenalty: 0.02, margin: 0.04 },
};

export const HOTEL_WEIGHTS: Record<PackageTier, HotelWeights> = {
  basic: { price: 0.55, starRating: 0.12, reviewScore: 0.12, proximity: 0.06, breakfast: 0.03, freeCancellation: 0.02, margin: 0.1 },
  comfort: { price: 0.26, starRating: 0.2, reviewScore: 0.18, proximity: 0.12, breakfast: 0.1, freeCancellation: 0.08, margin: 0.06 },
  premium: { price: 0.12, starRating: 0.24, reviewScore: 0.2, proximity: 0.2, breakfast: 0.08, freeCancellation: 0.12, margin: 0.04 },
};

/** Minimum acceptable hotel review score per tier (candidates below are filtered). */
export const MIN_HOTEL_REVIEW: Record<PackageTier, number> = { basic: 6.5, comfort: 7.5, premium: 8.3 };
/** Minimum acceptable star rating per tier. */
export const MIN_HOTEL_STARS: Record<PackageTier, number> = { basic: 2, comfort: 4, premium: 4 };

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

interface Pool {
  priceMin: number;
  priceMax: number;
  durMin: number;
  durMax: number;
  distMin: number;
  distMax: number;
  marginMin: number;
  marginMax: number;
}

function poolStats(cands: PricedCandidate[], durationOf: (o: NormalizedOffer) => number, distOf: (o: NormalizedOffer) => number): Pool {
  const prices = cands.map((c) => c.financials.customerPrice.amountMinor);
  const margins = cands.map((c) => c.financials.expectedGrossProfit.amountMinor);
  const durs = cands.map((c) => durationOf(c.offer));
  const dists = cands.map((c) => distOf(c.offer)).filter((d) => d >= 0);
  return {
    priceMin: Math.min(...prices), priceMax: Math.max(...prices),
    durMin: Math.min(...durs), durMax: Math.max(...durs),
    distMin: dists.length ? Math.min(...dists) : 0, distMax: dists.length ? Math.max(...dists) : 0,
    marginMin: Math.min(...margins), marginMax: Math.max(...margins),
  };
}

function weightedAverage(pairs: Array<[score: number, weight: number]>): number {
  let s = 0, w = 0;
  for (const [score, weight] of pairs) { s += score * weight; w += weight; }
  return w === 0 ? 0 : clamp01(s / w);
}

export function scoreFlight(c: PricedCandidate<NormalizedFlightOffer>, tier: PackageTier, pool: Pool): number {
  const o = c.offer;
  const w = FLIGHT_WEIGHTS[tier];
  const price = invMinMax(c.financials.customerPrice.amountMinor, pool.priceMin, pool.priceMax);
  const stops = clamp01(1 - (o.outboundStops + (o.inboundStops ?? 0)) * 0.34); // 0 stops→1, 1→0.66, 3→0
  const duration = invMinMax(o.totalDurationMinutes, pool.durMin, pool.durMax);
  const depart = departTimeScore(o.outbound[0]?.departISO ?? "");
  const baggage = clamp01((o.baggage.checked > 0 ? 0.7 : 0) + (o.baggage.cabin > 0 ? 0.3 : 0));
  const refundable = o.conditions.refundable ? 1 : 0;
  const changeable = o.conditions.changeable ? 1 : 0;
  const penalty = o.conditions.cancellationPenalty
    ? invMinMax(o.conditions.cancellationPenalty.amountMinor, 0, c.financials.customerPrice.amountMinor || 1)
    : 1;
  const margin = invMinMaxHigh(c.financials.expectedGrossProfit.amountMinor, pool.marginMin, pool.marginMax);
  return weightedAverage([
    [price, w.price], [stops, w.stops], [duration, w.duration], [depart, w.departTime],
    [baggage, w.baggage], [refundable, w.refundable], [changeable, w.changeable],
    [penalty, w.lowPenalty], [margin, w.margin],
  ]);
}

export function scoreHotel(c: PricedCandidate<NormalizedHotelOffer>, tier: PackageTier, pool: Pool): number {
  const o = c.offer;
  const w = HOTEL_WEIGHTS[tier];
  const price = invMinMax(c.financials.customerPrice.amountMinor, pool.priceMin, pool.priceMax);
  const stars = clamp01((o.starRating ?? 0) / 5);
  const review = clamp01((o.reviewScore ?? 0) / 10);
  const proximity = o.distanceFromCentreM != null ? invMinMax(o.distanceFromCentreM, pool.distMin, pool.distMax) : 0.5;
  const breakfast = o.boardType === "room_only" ? 0 : o.boardType === "breakfast" ? 0.7 : 1;
  const freeCancel = o.freeCancellationUntilISO ? 1 : 0;
  const margin = invMinMaxHigh(c.financials.expectedGrossProfit.amountMinor, pool.marginMin, pool.marginMax);
  return weightedAverage([
    [price, w.price], [stars, w.starRating], [review, w.reviewScore], [proximity, w.proximity],
    [breakfast, w.breakfast], [freeCancel, w.freeCancellation], [margin, w.margin],
  ]);
}

/** Higher-is-better min-max (for margin: more agency profit → higher sub-score). */
function invMinMaxHigh(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return clamp01((value - min) / (max - min));
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection — best candidate per kind per tier.
// ─────────────────────────────────────────────────────────────────────────────

interface Scored<T extends NormalizedOffer> { cand: PricedCandidate<T>; score: number; }

function pickBest<T extends NormalizedOffer>(scored: Scored<T>[]): Scored<T> | null {
  if (scored.length === 0) return null;
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: lower supplier cost, then offerId for determinism.
    const dc = a.cand.financials.supplierCost.amountMinor - b.cand.financials.supplierCost.amountMinor;
    if (dc !== 0) return dc;
    return a.cand.offer.offerId < b.cand.offer.offerId ? -1 : 1;
  })[0];
}

export interface SelectedTier {
  tier: PackageTier;
  flight: Scored<NormalizedFlightOffer> | null;
  hotel: Scored<NormalizedHotelOffer> | null;
}

/**
 * Score & select the winning flight + hotel for a given tier. Hotels are first
 * filtered by the tier's minimum star/review floor; if nothing clears the floor
 * we relax to the best available (so a thin pool still yields a package, flagged
 * by the caller via a lower score).
 */
export function selectTier(
  flights: PricedCandidate<NormalizedFlightOffer>[],
  hotels: PricedCandidate<NormalizedHotelOffer>[],
  tier: PackageTier,
): SelectedTier {
  const flightPool = poolStats(flights, (o) => (o as NormalizedFlightOffer).totalDurationMinutes, () => -1);
  const scoredFlights: Scored<NormalizedFlightOffer>[] = flights.map((c) => ({ cand: c, score: scoreFlight(c, tier, flightPool) }));

  const floorHotels = hotels.filter(
    (c) => (c.offer.starRating ?? 0) >= MIN_HOTEL_STARS[tier] && (c.offer.reviewScore ?? 0) >= MIN_HOTEL_REVIEW[tier],
  );
  const hotelSet = floorHotels.length > 0 ? floorHotels : hotels;
  const hotelPool = poolStats(hotelSet, () => 0, (o) => (o as NormalizedHotelOffer).distanceFromCentreM ?? -1);
  const scoredHotels: Scored<NormalizedHotelOffer>[] = hotelSet.map((c) => ({ cand: c, score: scoreHotel(c, tier, hotelPool) }));

  return { tier, flight: pickBest(scoredFlights), hotel: pickBest(scoredHotels) };
}

/** Convenience: run all three tiers. */
export function selectAllTiers(
  flights: PricedCandidate<NormalizedFlightOffer>[],
  hotels: PricedCandidate<NormalizedHotelOffer>[],
): Record<PackageTier, SelectedTier> {
  return {
    basic: selectTier(flights, hotels, "basic"),
    comfort: selectTier(flights, hotels, "comfort"),
    premium: selectTier(flights, hotels, "premium"),
  };
}
