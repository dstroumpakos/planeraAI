"use node";

/**
 * Admin batch seeder for Low-Fare Radar.
 *
 * Fills an origin airport that has users but "No deals yet" (surfaced in the
 * admin "User Airports" view) with real, graded curated deals. For one origin
 * it finds the best travel dates per destination, keeps only fares Google
 * grades `low`/`typical` (never `high`), ranks them by value, and inserts the
 * top N as CURATED deals.
 *
 * "Curated" here means: `dealTag: "SEEDED"` + no `expiresAt`, so — unlike the
 * opportunistic AUTO seeds — they persist and are re-priced by the refresh
 * cron (which only touches `dealTag !== "AUTO"` rows).
 *
 * THREE PHASES:
 *
 *   0. CALENDAR SCAN — for each candidate destination, scan a wide date grid
 *      via `google_flights_calendar` (`fetchFlightCalendar`) and pick that
 *      route's cheapest (departure, return) pair. Every destination therefore
 *      gets its OWN best dates instead of one fixed window shared by all.
 *      The scan also yields a route-local price distribution, so we can rank
 *      by "how far below this route's own median is its best date" — a real
 *      deal signal that doesn't need `price_insights`.
 *   1. VERIFY — calendar fares are indicative and NOT bookable, and carry no
 *      `price_level`. So the top `verifyTop` routes get one real
 *      `google_flights` search on their chosen dates, which produces both a
 *      bookable option (with tokens) and Google's low/typical/high grade.
 *   2. ENRICH + INSERT — unchanged: return leg + booking options per winner.
 *
 * Quota (defaults, 24 candidates): `windows` calls per destination in phase 0
 * (3 × 24 = 72), one search per verified route (~16), plus up to two follow-up
 * calls per inserted winner (~20) — roughly 110 searchapi.io calls per press,
 * versus ~44 for the old single-date-pair scan. Phase 0 runs with bounded
 * concurrency and the whole scan is wall-clock budgeted, because Convex kills
 * an action at 10 minutes.
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
import { fetchFlightCalendar } from "./lib/searchApiFlightCalendar";
import { AIRPORTS } from "../lib/airports";
import type {
  FlightCalendar,
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

/**
 * Phase-0 scan geometry. `google_flights_calendar` caps a request at 200
 * (outbound × return) date combinations, which the lib turns into ~14-day
 * windows — so breadth is bought one API call at a time.
 *
 * 3 windows starting 21 days out covers departures ~3 to ~9 weeks ahead, which
 * brackets the old fixed +45/+52 pair on both sides.
 */
const DEFAULT_CALENDAR_WINDOWS = 3;
const DEFAULT_SCAN_START_OFFSET_DAYS = 21;

/** How many top-ranked routes get a real (bookable, graded) verify search. */
const VERIFY_HEADROOM = 6;

/**
 * Phase 0 is read-only and quota-bounded regardless of pacing, so run a few
 * routes at once — 72 sequential calendar calls would eat most of the action's
 * lifetime on network latency alone. Phases 1 and 2 stay sequential (they write
 * and they burn the heavier endpoints).
 */
const DEFAULT_SCAN_CONCURRENCY = 4;

/**
 * Wall-clock budgets. Convex kills an action at 10 minutes, and the admin
 * widget calls this over a plain synchronous fetch — so a run that approaches
 * the limit is lost work AND a hung button. Phases 0+1 stop discovering at
 * SCAN_BUDGET_MS, leaving room for phase 2 to actually seed what qualified;
 * TOTAL_BUDGET_MS then stops seeding with margin to spare. Either cut sets
 * `timedOut` in the result so the admin knows to press again.
 *
 * Expected shape of a full run at the defaults: ~72 calendar calls at
 * concurrency 4 (~1.5 min), ~16 verify searches (~1 min), ~10 winners × 2–3
 * enrich calls (~2 min) ≈ 4.5 min.
 */
const SCAN_BUDGET_MS = 3.5 * 60 * 1000;
const TOTAL_BUDGET_MS = 7 * 60 * 1000;

/** Fallback trip length when a calendar date has no paired return. */
const FALLBACK_TRIP_NIGHTS = 7;

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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

/** YYYY-MM-DD, `nights` after `date`. */
function addNights(date: string, nights: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + nights);
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

/**
 * Phase-0 output: one route's best travel dates, discovered from its own
 * calendar grid. `calendarPrice` is INDICATIVE only (the calendar engine is a
 * discovery signal, not a bookable quote) — phase 1 re-prices it for real.
 */
type ScanResult = {
  destination: string;
  city: string;
  outboundDate: string;
  returnDate: string;
  /** Indicative round-trip fare for the picked pair, or null when unknown. */
  calendarPrice: number | null;
  /**
   * Fraction below this route's OWN median fare across the scanned window
   * (0 when unknown). Higher = the picked dates are a bigger outlier for this
   * route, which is the "is it a deal" signal price_insights would otherwise
   * give us — except computed per-route, so it never favours short-haul just
   * for being cheap in absolute terms.
   */
  calendarDiscount: number;
  /** Departure dates the calendar priced for this route (scan breadth). */
  datesScanned: number;
  /** Calendar came back empty — dates fell back to the fixed window. */
  fellBack: boolean;
};

type Candidate = {
  destination: string;
  city: string;
  outboundDate: string;
  returnDate: string;
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
    // ─ Phase-0 scan controls (all optional; defaults tuned for one press) ─
    /** ~14-day calendar windows scanned per destination. 1–6. More = wider
     *  date search and proportionally more quota. */
    calendarWindows: v.optional(v.float64()),
    /** Days from today where the scan starts (the lib floors this at 8). */
    startOffsetDays: v.optional(v.float64()),
    /** How many top-ranked routes get a real verify search. Defaults to
     *  `count + 6` so rejected (`high`-graded) routes have replacements. */
    verifyTop: v.optional(v.float64()),
    /** Parallel calendar lookups in phase 0. 1–8. */
    concurrency: v.optional(v.float64()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    origin: string;
    currency: string;
    /** Departure-date range the calendar scan covered. */
    scanFrom: string;
    scanTo: string;
    candidatesSearched: number;
    calendarCalls: number;
    /** Routes whose calendar came back empty (fixed-window fallback used). */
    calendarEmpty: number;
    verifySearches: number;
    skippedExisting: number;
    qualified: number;
    seeded: number;
    /** True when the wall-clock budget cut the scan short. */
    timedOut: boolean;
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

    const windows = Math.max(
      1,
      Math.min(Math.round(args.calendarWindows ?? DEFAULT_CALENDAR_WINDOWS), 6)
    );
    const startOffsetDays = Math.max(
      0,
      Math.round(args.startOffsetDays ?? DEFAULT_SCAN_START_OFFSET_DAYS)
    );
    const concurrency = Math.max(
      1,
      Math.min(Math.round(args.concurrency ?? DEFAULT_SCAN_CONCURRENCY), 8)
    );
    const verifyTop = Math.max(
      1,
      Math.round(args.verifyTop ?? count + VERIFY_HEADROOM)
    );
    const startedAt = Date.now();
    let timedOut = false;

    // Dates the scan is expected to cover, for the summary. The lib floors the
    // start at its own minimum lead time, so mirror that here.
    const scanFrom = dateAhead(Math.max(startOffsetDays, 8));
    const scanTo = dateAhead(Math.max(startOffsetDays, 8) + windows * 14 - 1);

    // Fixed pair used only when a route's calendar comes back empty, so a thin
    // route degrades to the old behaviour instead of dropping out entirely.
    const fallbackOutbound = dateAhead(45);
    const fallbackReturn = dateAhead(52);

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

    // ── Phase 0 — calendar scan: find each route's own best dates ──
    //
    // One `fetchFlightCalendar` per destination (internally `windows` API
    // calls). Bounded concurrency: these are read-only lookups, and running
    // them one at a time would spend most of the action's lifetime waiting on
    // the network. Quota is identical either way.
    let calendarCalls = 0;
    let calendarEmpty = 0;

    const scans: ScanResult[] = await mapWithConcurrency(
      candidatePool,
      concurrency,
      async (dest): Promise<ScanResult> => {
        const fallback: ScanResult = {
          destination: dest.code,
          city: dest.city,
          outboundDate: fallbackOutbound,
          returnDate: fallbackReturn,
          calendarPrice: null,
          calendarDiscount: 0,
          datesScanned: 0,
          fellBack: true,
        };

        // Out of time — take the fixed pair rather than start a fresh scan.
        if (Date.now() - startedAt > SCAN_BUDGET_MS) {
          timedOut = true;
          return fallback;
        }

        let calendar: FlightCalendar | null = null;
        try {
          calendarCalls += windows;
          calendar = await fetchFlightCalendar(
            { departureId: origin, arrivalId: dest.code, currency },
            {
              windows,
              startOffsetDays,
              // Keep every priced date — the median below is only meaningful
              // over the full window, not over a thinned "strip" selection.
              maxDates: windows * 14,
              spacingDays: 1,
              // Party size changes which fares are actually bookable, so it
              // must be priced in, not multiplied afterwards.
              adults,
            }
          );
        } catch {
          console.error(`[radar-seed] calendar failed ${origin}->${dest.code}`);
        }

        const dates = calendar?.dates ?? [];
        if (dates.length === 0) {
          calendarEmpty++;
          return fallback;
        }

        const best = dates.reduce((m, d) => (d.price < m.price ? d : m));
        const mid = median(dates.map((d) => d.price));
        const calendarDiscount =
          mid && mid > 0 ? Math.max(0, (mid - best.price) / mid) : 0;

        return {
          destination: dest.code,
          city: dest.city,
          outboundDate: best.date,
          // The calendar pairs each departure with the return that produced
          // its cheapest fare; only synthesise one if that's missing.
          returnDate:
            best.returnDate && best.returnDate > best.date
              ? best.returnDate
              : addNights(best.date, FALLBACK_TRIP_NIGHTS),
          calendarPrice: best.price,
          calendarDiscount,
          datesScanned: dates.length,
          fellBack: false,
        };
      }
    );

    // Rank by the route-local discount, then by indicative price, and verify
    // only the head of that list. Ranking on the calendar's own signal (rather
    // than absolute cheapness) keeps a genuinely-discounted long-haul ahead of
    // a short hop that is merely cheap.
    const ranked = [...scans]
      .filter(
        (s) =>
          args.maxPrice === undefined ||
          s.calendarPrice === null ||
          s.calendarPrice <= args.maxPrice
      )
      .sort((a, b) => {
        if (b.calendarDiscount !== a.calendarDiscount) {
          return b.calendarDiscount - a.calendarDiscount;
        }
        return (a.calendarPrice ?? Infinity) - (b.calendarPrice ?? Infinity);
      })
      .slice(0, verifyTop);

    const candidates: Candidate[] = [];
    const candidatesSearched = candidatePool.length;
    let verifySearches = 0;

    // ── Phase 1 — verify + grade the shortlist on its chosen dates ──
    //
    // Calendar fares are indicative and carry no `price_level`, so each
    // shortlisted route gets one real search: it yields the bookable option
    // (with the tokens phase 2 needs) and Google's low/typical/high grade.
    // Sequential — these are the heavier endpoint.
    for (const scan of ranked) {
      if (Date.now() - startedAt > SCAN_BUDGET_MS) {
        timedOut = true;
        console.warn(
          `[radar-seed] time budget hit after ${verifySearches} verify search(es); seeding what qualified so far`
        );
        break;
      }

      const dest = { code: scan.destination, city: scan.city };
      const input: FlightSearchInput = {
        departureId: origin,
        arrivalId: dest.code,
        outboundDate: scan.outboundDate,
        returnDate: scan.returnDate,
        type: "round_trip",
        currency,
        adults,
        maxPrice: args.maxPrice,
      };
      verifySearches++;
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
        // Prefer Google's own typical range; fall back to the route-local
        // calendar discount when this search returned no price insights, so a
        // verified deal is never ranked as if it had zero discount.
        const discount =
          mid && mid > 0
            ? Math.max(0, (mid - cheapest.price) / mid)
            : scan.calendarDiscount;

        candidates.push({
          destination: dest.code,
          city: dest.city,
          outboundDate: scan.outboundDate,
          returnDate: scan.returnDate,
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
      // Stop with margin rather than risk the 10-minute kill, which would lose
      // the deals already inserted from the caller's point of view.
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
        timedOut = true;
        console.warn(
          `[radar-seed] total budget hit after ${seeded} seeded deal(s); ${
            winners.length - seeded
          } winner(s) left unseeded`
        );
        break;
      }
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
            // Per-route dates from the calendar scan — every deal now carries
            // its own best window, so the travel-month labels are per-deal too.
            outboundDate: w.outboundDate,
            returnDate: w.returnDate,
            currency,
            priceLevel: w.priceLevel,
            option: w.option,
            adults,
            provider: "searchapi",
            dealTag: tag,
            persistent: true,
            originalPrice,
            travelMonthFrom: w.outboundDate.slice(0, 7),
            travelMonthTo: w.returnDate.slice(0, 7),
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
            outboundDate: deal?.outboundDate ?? w.outboundDate,
            outboundDeparture: deal?.outboundDeparture ?? "",
            outboundArrival: deal?.outboundArrival ?? "",
            outboundStops: deal?.outboundStops ?? 0,
            returnDate: deal?.returnDate ?? w.returnDate,
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
      scanFrom,
      scanTo,
      candidatesSearched,
      calendarCalls,
      calendarEmpty,
      verifySearches,
      skippedExisting: covered.size,
      qualified: candidates.length,
      seeded,
      timedOut,
      deals,
    };
  },
});
