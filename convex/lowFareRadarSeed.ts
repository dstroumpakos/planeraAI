"use node";

/**
 * Admin batch seeder for Low-Fare Radar.
 *
 * Fills an origin airport that has users but "No deals yet" (surfaced in the
 * admin "User Airports" view) with real, graded curated deals. For one origin
 * it runs a live searchapi.io Google-Flights search to a curated list of
 * popular destinations, keeps only fares Google grades `low`/`typical` (never
 * `high`), ranks them by value, and inserts the top N as CURATED deals.
 *
 * "Curated" here means: `dealTag: "SEEDED"` + no `expiresAt`, so — unlike the
 * opportunistic AUTO seeds — they persist and are re-priced by the refresh
 * cron (which only touches `dealTag !== "AUTO"` rows).
 *
 * Quota: one round-trip search per candidate destination (≈ the list length),
 * plus up to two follow-up calls per inserted winner (return leg + booking
 * options, via `enrichAndSeedDeal`). Bounded and sequential — safe as an
 * on-demand admin action, but it does spend real searchapi.io quota.
 */

import { action } from "./_generated/server";
import { api, internal as _internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  normalizeFlightOption,
  normalizePriceInsights,
} from "./lib/serpApiFlights";
import {
  SEARCHAPI_FLIGHTS_ENDPOINT,
  buildSearchApiSearchParams,
} from "./lib/searchApiFlightSearch";
import { AIRPORTS } from "../lib/airports";
import type {
  FlightSearchInput,
  NormalizedFlightOption,
  PriceInsights,
} from "../types/flights";

// Types won't regenerate until `npx convex dev` runs; cast keeps the new
// internal reference callable in the meantime (matches lowFareRadar.ts).
const internal = _internal as any;

/**
 * Curated pool of high-demand, well-connected destinations. Kept deliberately
 * global + diverse so that, after excluding the origin itself and any route
 * that already has a live deal, there are comfortably more than `count`
 * candidates to search and rank.
 */
const POPULAR_DESTINATIONS: Array<{ code: string; city: string }> = [
  { code: "LON", city: "London" },
  { code: "PAR", city: "Paris" },
  { code: "BCN", city: "Barcelona" },
  { code: "FCO", city: "Rome" },
  { code: "AMS", city: "Amsterdam" },
  { code: "LIS", city: "Lisbon" },
  { code: "MAD", city: "Madrid" },
  { code: "BER", city: "Berlin" },
  { code: "PRG", city: "Prague" },
  { code: "IST", city: "Istanbul" },
  { code: "ATH", city: "Athens" },
  { code: "DXB", city: "Dubai" },
  { code: "NYC", city: "New York" },
  { code: "MIA", city: "Miami" },
  { code: "CUN", city: "Cancún" },
  { code: "BKK", city: "Bangkok" },
  { code: "SIN", city: "Singapore" },
  { code: "HKT", city: "Phuket" },
  { code: "DPS", city: "Bali" },
  { code: "TYO", city: "Tokyo" },
  { code: "MEX", city: "Mexico City" },
  { code: "RIO", city: "Rio de Janeiro" },
  { code: "CPT", city: "Cape Town" },
  { code: "MRU", city: "Mauritius" },
];

function cityForIata(code: string): string {
  const upper = code.toUpperCase();
  const pool = POPULAR_DESTINATIONS.find((d) => d.code === upper);
  if (pool) return pool.city;
  const hit = AIRPORTS.find((a) => a.code === upper);
  return hit?.city ?? upper;
}

/** YYYY-MM-DD, `daysAhead` from now (UTC). */
function dateAhead(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function validateAdminKey(key: string) {
  const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
  if (!expected) {
    throw new ConvexError(
      "CONVEX_LOW_FARE_ADMIN_KEY environment variable not set"
    );
  }
  if (key !== expected) {
    throw new ConvexError("Unauthorized: invalid admin key");
  }
}

async function callSearchApi(params: URLSearchParams): Promise<any | null> {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) return null;
  try {
    const res = await fetch(`${SEARCHAPI_FLIGHTS_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${key.trim()}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    return json;
  } catch {
    return null;
  }
}

function pickCheapest(
  best: NormalizedFlightOption[],
  other: NormalizedFlightOption[]
): NormalizedFlightOption | null {
  const all = [...best, ...other].filter((o) => o.price != null);
  if (all.length === 0) return null;
  return all.reduce((m, o) =>
    (o.price ?? Infinity) < (m.price ?? Infinity) ? o : m
  );
}

type Candidate = {
  destination: string;
  city: string;
  option: NormalizedFlightOption;
  priceLevel: string; // "low" | "typical"
  price: number;
  /** Fraction below the route's typical midpoint (0 if unknown). Higher = better. */
  discount: number;
  /** Route's typical-price midpoint (per the search's price_insights), or null. */
  typicalMid: number | null;
};

/** Rich, human-readable view of a seeded deal, read back from the DB so the
 *  action output shows the full itinerary — not just a price. */
type DealSummary = {
  dealId: string;
  destination: string;
  destinationCity: string;
  airline: string;
  price: number;
  currency: string;
  priceLevel: string;
  // Outbound
  outboundDate: string;
  outboundDeparture: string;
  outboundArrival: string;
  outboundStops: number;
  // Return (undefined if the return-leg fetch came back empty)
  returnDate?: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnStops?: number;
  // Booking
  bookingUrl?: string;
  // Curated extras
  originalPrice?: number;
  dealTag?: string;
};

export const seedDealsForOrigin = action({
  args: {
    adminKey: v.string(),
    origin: v.string(),
    count: v.optional(v.float64()),
    currency: v.optional(v.string()),
    maxPrice: v.optional(v.float64()),
    adults: v.optional(v.float64()),
    // Optional override for the public deal-tag badge. When omitted, each deal
    // is tagged by grade ("HOT DEAL" for `low` fares, none for `typical`).
    dealTag: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    origin: string;
    currency: string;
    outboundDate: string;
    returnDate: string;
    candidatesSearched: number;
    skippedExisting: number;
    qualified: number;
    seeded: number;
    deals: DealSummary[];
  }> => {
    validateAdminKey(args.adminKey);

    const origin = args.origin.trim().toUpperCase();
    if (!origin) throw new ConvexError("origin is required");
    const currency = (args.currency ?? "EUR").toUpperCase();
    const count = Math.max(1, Math.min(Math.round(args.count ?? 10), 20));
    const adults = typeof args.adults === "number" && args.adults > 0 ? args.adults : 1;
    // Optional tag override applied to every seeded deal. When omitted, the tag
    // is derived per-deal from its grade (a public "HOT DEAL" badge for genuine
    // `low` fares, none for merely-`typical` ones).
    const dealTagOverride = args.dealTag?.trim() || undefined;

    // Sample a single ~6-week-out, 7-night round trip. Far enough that advance
    // fares are available, near enough to be actionable.
    const outboundDate = dateAhead(45);
    const returnDate = dateAhead(52);
    // Travel-month window (YYYY-MM) derived from the sampled dates.
    const travelMonthFrom = outboundDate.slice(0, 7);
    const travelMonthTo = returnDate.slice(0, 7);

    // Skip any destination this origin already has a live deal for (AUTO or
    // curated) — `listActive` already filters to active/non-expired/non-deleted.
    const existing: Array<{ destination: string }> = await ctx.runQuery(
      api.lowFareRadar.listActive,
      { origin }
    );
    const covered = new Set(existing.map((d) => d.destination.toUpperCase()));

    // Exclude the origin itself, anything already covered, and same-city metro
    // codes (e.g. origin JFK vs destination NYC, both "New York").
    const originCity = cityForIata(origin).toLowerCase();
    const candidatePool = POPULAR_DESTINATIONS.filter(
      (d) =>
        d.code !== origin &&
        !covered.has(d.code) &&
        d.city.toLowerCase() !== originCity
    );

    const candidates: Candidate[] = [];
    let candidatesSearched = 0;

    // Phase 1 — search every candidate route and grade it. Sequential to keep
    // quota bounded and avoid provider rate limits.
    for (const dest of candidatePool) {
      const input: FlightSearchInput = {
        departureId: origin,
        arrivalId: dest.code,
        outboundDate,
        returnDate,
        type: "round_trip",
        currency,
        adults,
        maxPrice: args.maxPrice,
      };
      candidatesSearched++;
      try {
        const raw = await callSearchApi(buildSearchApiSearchParams(input));
        if (!raw) continue;
        const priceInsights: PriceInsights | null = normalizePriceInsights(
          raw?.price_insights
        );
        const best = Array.isArray(raw?.best_flights)
          ? raw.best_flights.map((o: any, i: number) =>
              normalizeFlightOption(o, "best_flights", i, priceInsights)
            )
          : [];
        const other = Array.isArray(raw?.other_flights)
          ? raw.other_flights.map((o: any, i: number) =>
              normalizeFlightOption(o, "other_flights", i, priceInsights)
            )
          : [];
        const cheapest = pickCheapest(best, other);
        if (!cheapest || cheapest.price == null) continue;

        const level = (priceInsights?.priceLevel || "").toLowerCase();
        // Never promote a fare Google flags as high; only surface real deals.
        if (level !== "low" && level !== "typical") continue;

        const range = priceInsights?.typicalPriceRange;
        const mid =
          Array.isArray(range) && range.length === 2
            ? (range[0] + range[1]) / 2
            : null;
        const discount =
          mid && mid > 0 ? Math.max(0, (mid - cheapest.price) / mid) : 0;

        candidates.push({
          destination: dest.code,
          city: dest.city,
          option: cheapest,
          priceLevel: level,
          price: cheapest.price,
          discount,
          typicalMid: mid,
        });
      } catch (err) {
        console.error(`[radar-seed] search failed ${origin}->${dest.code}`);
      }
    }

    // Rank: genuine "low" fares first, then biggest discount vs typical, then
    // cheapest absolute price. Take the top `count`.
    candidates.sort((a, b) => {
      if (a.priceLevel !== b.priceLevel) return a.priceLevel === "low" ? -1 : 1;
      if (b.discount !== a.discount) return b.discount - a.discount;
      return a.price - b.price;
    });
    const winners = candidates.slice(0, count);

    // Phase 2 — enrich (return leg + booking options) and insert each winner as
    // a persistent curated deal. Sequential; failures are swallowed per-deal.
    let seeded = 0;
    const deals: DealSummary[] = [];
    for (const w of winners) {
      try {
        // Per-person figures so the card's strike-through anchors correctly
        // (the stored `price` is per-person; SerpApi/searchapi prices are totals
        // for the searched pax count).
        const perPersonPrice = Math.round(w.price / Math.max(1, adults));
        const perPersonTypical =
          w.typicalMid != null ? Math.round(w.typicalMid / Math.max(1, adults)) : null;
        // Only anchor a "was" price when the typical fare is genuinely above the
        // deal price — never fabricate a saving on an at-typical fare.
        const originalPrice =
          perPersonTypical != null && perPersonTypical > perPersonPrice
            ? perPersonTypical
            : undefined;
        // Public badge: a real "HOT DEAL" only on genuine `low` fares (unless an
        // explicit override was passed). `typical` fares get no badge.
        const tag = dealTagOverride || (w.priceLevel === "low" ? "HOT DEAL" : undefined);

        const dealId: string | null = await ctx.runAction(
          internal.lowFareRadarAutoAction.enrichAndSeedDeal,
          {
            origin,
            destination: w.destination,
            outboundDate,
            returnDate,
            currency,
            priceLevel: w.priceLevel,
            option: w.option,
            adults,
            provider: "searchapi",
            dealTag: tag,
            persistent: true,
            originalPrice,
            travelMonthFrom,
            travelMonthTo,
          }
        );
        if (dealId) {
          seeded++;
          // Read the stored deal back so the summary shows the full itinerary
          // (outbound + return dates/times/stops + booking link), not just a
          // price. The return-leg + booking-options detail was populated by
          // `enrichAndSeedDeal`'s follow-up calls.
          const deal: any = await ctx.runQuery(api.lowFareRadar.get, {
            id: dealId as any,
          });
          deals.push({
            dealId,
            destination: w.destination,
            destinationCity: deal?.destinationCity ?? w.city,
            airline: deal?.airline ?? "",
            price: deal?.price ?? w.price,
            currency: deal?.currency ?? currency,
            priceLevel: w.priceLevel,
            outboundDate: deal?.outboundDate ?? outboundDate,
            outboundDeparture: deal?.outboundDeparture ?? "",
            outboundArrival: deal?.outboundArrival ?? "",
            outboundStops: deal?.outboundStops ?? 0,
            returnDate: deal?.returnDate ?? returnDate,
            returnDeparture: deal?.returnDeparture,
            returnArrival: deal?.returnArrival,
            returnStops: deal?.returnStops,
            bookingUrl: deal?.bookingUrl,
            originalPrice: deal?.originalPrice,
            dealTag: deal?.dealTag,
          });
        }
      } catch (err) {
        console.error(`[radar-seed] insert failed ${origin}->${w.destination}`);
        await reportError(ctx, "lowFareRadarSeed:seedDealsForOrigin", err, {
          origin,
          destination: w.destination,
        });
      }
    }

    return {
      origin,
      currency,
      outboundDate,
      returnDate,
      candidatesSearched,
      skippedExisting: covered.size,
      qualified: candidates.length,
      seeded,
      deals,
    };
  },
});
