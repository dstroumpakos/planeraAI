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
 * CANDIDATE SOURCE (the `source` arg):
 *
 *   - `"pool"` (default) — the fixed `POPULAR_DESTINATIONS` list below.
 *   - `"explore"` — ask Google Travel Explore (the engine behind the public
 *     "Where can I go?" widget) what is actually cheap FROM this origin, and
 *     keep its cheapest `exploreTop` destinations. One cached call replaces the
 *     whole of phase 0: explore already returns a per-destination fare and a
 *     suggested (outbound, return) pair. Cheapest and fastest — but explore
 *     gives ONE price per route with no distribution behind it, so there is no
 *     route-local discount signal and the shortlist is ranked on absolute
 *     price, leaving all the qualifying to phase 1's `price_insights`.
 *   - `"explore+calendar"` — the hybrid, and the one to reach for. Explore picks
 *     the candidates, then phase 0 scans the calendar for those only. Restores
 *     the route-local discount signal at a fraction of the calls, because the
 *     scan covers ~`exploreTop` origin-relevant routes instead of all 24 pool
 *     entries — most of which are irrelevant from anywhere the pool wasn't
 *     written around (SVO, CPT, a South American origin).
 *
 * Explore fares are indicative and carry NO `price_level`, so phase 1 stays
 * mandatory whichever source is used: it is what yields both a bookable option
 * and Google's low/typical/high grade. An explore source that returns nothing
 * usable degrades to the pool rather than seeding nothing.
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
 * an action at 10 minutes. `source: "explore+calendar"` cuts phase 0 to
 * `windows × exploreTop` (3 × 16 = 48 at the defaults) plus one explore call,
 * and `source: "explore"` removes phase 0 entirely.
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
  ExploreDestination,
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
 */
const DEFAULT_SCAN_START_OFFSET_DAYS = 21;

/** The lib never prices a departure sooner than this; mirrored for the maths. */
const CALENDAR_MIN_LEAD_DAYS = 8;
/** One `google_flights_calendar` request spans this many outbound days. */
const CALENDAR_WINDOW_DAYS = 14;

/**
 * How far ahead the scan must be able to price a departure — the product
 * requirement, in the one place that decides it.
 *
 * Deals two months out are the point of the feature: a curated deal is
 * re-priced by the refresh cron and has no `expiresAt`, so a scan that only
 * reaches ~6 weeks can never surface the cheap shoulder-season dates that make
 * the radar worth opening. Expressed as a horizon rather than a window count
 * because the two are only equivalent at one particular start offset — the
 * previous hardcoded `windows` silently shortened the horizon to ~7 weeks when
 * it was tuned down for speed, which is the regression this constant prevents.
 */
const MIN_HORIZON_DAYS = 60;

/**
 * Windows needed to reach `MIN_HORIZON_DAYS` from a given start offset. Clamped
 * to the same 1–6 range the `calendarWindows` arg accepts.
 */
function windowsForHorizon(startOffsetDays: number): number {
  const start = Math.max(startOffsetDays, CALENDAR_MIN_LEAD_DAYS);
  const span = MIN_HORIZON_DAYS - start + 1;
  return Math.max(1, Math.min(Math.ceil(span / CALENDAR_WINDOW_DAYS), 6));
}

/** How many top-ranked routes get a real (bookable, graded) verify search. */
const VERIFY_HEADROOM = 6;

/**
 * Phase 0 is read-only and quota-bounded regardless of pacing, so run a few
 * routes at once — 72 sequential calendar calls would eat most of the action's
 * lifetime on network latency alone. Phases 1 and 2 stay sequential (they write
 * and they burn the heavier endpoints).
 */
const DEFAULT_SCAN_CONCURRENCY = 8;

/**
 * How many Google Travel Explore destinations become candidates on an
 * explore-backed source. Explore returns the whole reachable grid (70+ from a
 * hub like ATH) sorted cheapest-first; seeding has no use for the tail, and on
 * `"explore+calendar"` this number sets the phase-0 call count directly.
 */
const DEFAULT_EXPLORE_TOP = 16;

/**
 * Rate-limit bucket for the seeder's explore call. `exploreDestinationsPublic`
 * is keyed by an opaque device id — a fixed one here keeps admin presses in
 * their own bucket, clear of real visitors, while still sharing that action's
 * 12h response cache with the public widget.
 */
const EXPLORE_DEVICE_ID = "radar-seed";

/**
 * Wall-clock budgets. Convex kills an action at 10 minutes, and the admin
 * widget calls this over a plain synchronous fetch — so a run that approaches
 * the limit is lost work AND a hung button. Phases 0+1 stop discovering at
 * SCAN_BUDGET_MS, leaving room for phase 2 to actually seed what qualified;
 * TOTAL_BUDGET_MS then stops seeding with margin to spare. Any cut sets
 * `timedOut` in the result so the admin knows to press again.
 *
 * CALENDAR_BUDGET_MS is the phase-0 share, and it is load-bearing rather than a
 * nicety: phase 0 alone cannot produce a deal. A calendar fare is indicative and
 * carries no `price_level`, so a route only becomes seedable after phase 1 spends
 * a real search on it. When both phases shared one deadline, a slow scan ate the
 * whole thing and phase 1 ran ZERO searches — the run then reported success
 * having seeded nothing (observed live: SVO, 3m52s, "time budget hit after 0
 * verify search(es)"). Reserving the tail for phase 1 makes a slow scan degrade
 * (later destinations fall back to the fixed date pair) instead of starving the
 * only phase that can qualify anything.
 *
 * Measured shape of a run at the defaults. A wave of 8 concurrent calendar
 * calls completes in ~11.8s, and the lib walks a destination's `windows`
 * sequentially — so phase 0 costs ceil(24/8)=3 waves × `windows` × 11.8s. At the
 * 3 windows MIN_HORIZON_DAYS requires that is ~106s. The 17/8 SVO run then
 * measured phase 1 + phase 2 at ~140s combined (16 verify searches + ~25 enrich
 * calls), for ~4.1 min end to end.
 *
 * Each budget therefore sits ~40% above its measured phase, and the worst case
 * where every phase runs to its deadline is 7 min — still 3 min inside the
 * 10-minute limit at which Convex kills the action.
 */
const CALENDAR_BUDGET_MS = 2.5 * 60 * 1000;
const SCAN_BUDGET_MS = 4 * 60 * 1000;
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
 * One route to consider, before any pricing work. The fixed pool supplies only
 * a code + city; Google Travel Explore additionally supplies an indicative fare
 * and its own suggested travel dates, which become that route's date fallback.
 */
type SeedCandidate = {
  code: string;
  city: string;
  /** Indicative round-trip fare (explore only) — a discovery signal, never bookable. */
  explorePrice?: number;
  exploreOutbound?: string;
  exploreReturn?: string;
};

/**
 * Explore's suggested pair is usable only when both dates are present, ordered,
 * and far enough out that falling back to them doesn't price a next-week
 * departure — the same lead time the calendar lib enforces.
 */
function usableExploreDates(outbound?: string, ret?: string): boolean {
  if (!outbound || !ret || ret <= outbound) return false;
  return outbound >= dateAhead(CALENDAR_MIN_LEAD_DAYS);
}

/**
 * Candidate generation via Google Travel Explore — the engine behind the public
 * "Where can I go?" widget.
 *
 * One call returns everywhere this origin reaches, cheapest first, each with an
 * indicative fare and a suggested (outbound, return) pair. That makes it a
 * strictly better generator than the fixed pool for any origin the pool wasn't
 * written around: origin-aware, not capped at 24 cities, one call.
 *
 * Goes through `explorePublic.exploreDestinationsPublic` rather than the lib
 * directly, so it shares that action's 12h cache. Sends the minimal input (no
 * interests, stops or time period): the widest grid, and the cache entry most
 * likely to be warm already.
 *
 * Never throws — an explore hiccup must not cost the caller a seeding press, so
 * failure returns an empty list and the caller falls back to the pool.
 */
async function exploreCandidates(
  ctx: any,
  opts: {
    origin: string;
    currency: string;
    adults: number;
    maxPrice?: number;
    covered: Set<string>;
    originCity: string;
    top: number;
  }
): Promise<{ candidates: SeedCandidate[]; returned: number }> {
  let destinations: ExploreDestination[] = [];
  try {
    destinations = await ctx.runAction(
      api.explorePublic.exploreDestinationsPublic,
      {
        deviceId: EXPLORE_DEVICE_ID,
        input: {
          departureId: opts.origin,
          currency: opts.currency,
          // Party size changes which fares exist, so price it in here too.
          adults: opts.adults,
        },
      }
    );
  } catch (err) {
    console.error(
      `[radar-seed] explore failed ${opts.origin}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { candidates: [], returned: 0 };
  }

  const returned = destinations?.length ?? 0;
  const seen = new Set<string>();
  const candidates: SeedCandidate[] = [];

  for (const d of destinations ?? []) {
    const code = d.iata?.trim().toUpperCase();
    // No IATA means no route to search — explore can return region-level rows.
    if (!code || code.length < 3) continue;
    if (code === opts.origin || seen.has(code) || opts.covered.has(code)) {
      continue;
    }
    const city = d.name?.trim() || cityForIata(code);
    // Same-city metro codes (origin JFK vs destination NYC) are not a trip.
    if (city.toLowerCase() === opts.originCity) continue;
    // The engine ignores `max_price` (see searchApiExplore.ts), so the cap is
    // applied here — on the indicative fare, which phase 1 re-prices anyway.
    if (
      opts.maxPrice !== undefined &&
      d.price !== undefined &&
      d.price > opts.maxPrice
    ) {
      continue;
    }
    seen.add(code);
    candidates.push({
      code,
      city,
      explorePrice: d.price,
      exploreOutbound: d.outboundDate,
      exploreReturn: d.returnDate,
    });
  }

  // Explore already sorts cheapest-first, but re-sort after filtering so a row
  // with no price can never outrank one with a real fare.
  candidates.sort(
    (a, b) => (a.explorePrice ?? Infinity) - (b.explorePrice ?? Infinity)
  );

  return { candidates: candidates.slice(0, Math.max(1, opts.top)), returned };
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
    // is tagged by grade ("Great price" for `low` fares, none for `typical`).
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
    /**
     * Where candidate destinations come from. Defaults to `"pool"`, so existing
     * callers are unchanged. See the file header for the trade-offs.
     */
    source: v.optional(
      v.union(
        v.literal("pool"),
        v.literal("explore"),
        v.literal("explore+calendar")
      )
    ),
    /** Explore destinations kept as candidates (explore sources only). 1–40. */
    exploreTop: v.optional(v.float64()),
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
    /** Generator that actually produced the candidates (falls back to "pool"). */
    candidateSource: "pool" | "explore" | "explore+calendar";
    /** Destinations explore returned before filtering (0 when unused). */
    exploreReturned: number;
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
    // is derived per-deal from its grade (a public "Great price" badge for
    // genuine `low` fares, none for merely-`typical` ones).
    const dealTagOverride = args.dealTag?.trim() || undefined;

    // Offset first: the default window count is derived from it, so that moving
    // the start offset can never silently shorten the horizon.
    const startOffsetDays = Math.max(
      0,
      Math.round(args.startOffsetDays ?? DEFAULT_SCAN_START_OFFSET_DAYS)
    );
    const windows = Math.max(
      1,
      Math.min(
        Math.round(args.calendarWindows ?? windowsForHorizon(startOffsetDays)),
        6
      )
    );
    const concurrency = Math.max(
      1,
      Math.min(Math.round(args.concurrency ?? DEFAULT_SCAN_CONCURRENCY), 8)
    );
    const verifyTop = Math.max(
      1,
      Math.round(args.verifyTop ?? count + VERIFY_HEADROOM)
    );
    const requestedSource = args.source ?? "pool";
    const exploreTop = Math.max(
      1,
      Math.min(Math.round(args.exploreTop ?? DEFAULT_EXPLORE_TOP), 40)
    );
    const startedAt = Date.now();
    let timedOut = false;

    // Dates the scan is expected to cover, for the summary. The lib floors the
    // start at its own minimum lead time, so mirror that here.
    let scanFrom = dateAhead(Math.max(startOffsetDays, 8));
    let scanTo = dateAhead(Math.max(startOffsetDays, 8) + windows * 14 - 1);

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
    const poolCandidates: SeedCandidate[] = POPULAR_DESTINATIONS.filter(
      (d) =>
        d.code !== origin &&
        !covered.has(d.code) &&
        d.city.toLowerCase() !== originCity
    ).map((d) => ({ code: d.code, city: d.city }));

    // Candidate generation. An explore source that comes back empty — API down,
    // or an origin the engine doesn't cover — degrades to the pool, because a
    // press that seeds nothing is strictly worse than one that seeds the
    // generic list.
    let candidateSource: "pool" | "explore" | "explore+calendar" =
      requestedSource;
    let exploreReturned = 0;
    let candidatePool: SeedCandidate[] = poolCandidates;

    if (requestedSource !== "pool") {
      const explored = await exploreCandidates(ctx, {
        origin,
        currency,
        adults,
        maxPrice: args.maxPrice,
        covered,
        originCity,
        top: exploreTop,
      });
      exploreReturned = explored.returned;
      if (explored.candidates.length > 0) {
        candidatePool = explored.candidates;
        console.log(
          `[radar-seed] explore ${origin}: ${explored.returned} destination(s) -> ${explored.candidates.length} candidate(s)`
        );
      } else {
        candidateSource = "pool";
        console.warn(
          `[radar-seed] explore gave no usable candidates for ${origin}; falling back to the fixed pool`
        );
      }
    }

    // ── Phase 0 — calendar scan: find each route's own best dates ──
    //
    // One `fetchFlightCalendar` per destination (internally `windows` API
    // calls). Bounded concurrency: these are read-only lookups, and running
    // them one at a time would spend most of the action's lifetime waiting on
    // the network. Quota is identical either way.
    let calendarCalls = 0;
    let calendarEmpty = 0;
    // Destinations the phase-0 cut skipped. Counted (and logged once, not once
    // per skipped route) because a silent truncation is indistinguishable from a
    // thin candidate pool when reading the logs afterwards.
    let calendarSkipped = 0;

    const scans: ScanResult[] = await mapWithConcurrency(
      candidatePool,
      concurrency,
      async (dest): Promise<ScanResult> => {
        // A route's dates when no calendar priced it: explore's own suggested
        // pair when it gave a usable one (route-specific and seasonally
        // sensible), else the fixed window the pool source has always used.
        const useExploreDates = usableExploreDates(
          dest.exploreOutbound,
          dest.exploreReturn
        );
        const fallback: ScanResult = {
          destination: dest.code,
          city: dest.city,
          outboundDate: useExploreDates
            ? dest.exploreOutbound!
            : fallbackOutbound,
          returnDate: useExploreDates ? dest.exploreReturn! : fallbackReturn,
          // Indicative either way — the calendar's fare and explore's are both
          // discovery signals, and phase 1 re-prices whichever survives.
          calendarPrice: dest.explorePrice ?? null,
          calendarDiscount: 0,
          datesScanned: 0,
          fellBack: true,
        };

        // Explore-only source: no calendar phase at all. Explore already
        // carries this route's fare and dates, and there is no distribution
        // behind that single fare — so `calendarDiscount` stays 0 and the
        // shortlist below ranks on absolute price, with phase 1's
        // `price_insights` doing the qualifying.
        if (candidateSource === "explore") return fallback;

        // Out of phase-0 time — take the fixed pair rather than start a fresh
        // scan. Deliberately NOT the shared SCAN_BUDGET_MS: the remainder of
        // that budget belongs to phase 1, which is the only phase that can turn
        // any of these scans into a seedable deal.
        if (Date.now() - startedAt > CALENDAR_BUDGET_MS) {
          timedOut = true;
          calendarSkipped++;
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

    if (calendarSkipped > 0) {
      console.warn(
        `[radar-seed] calendar budget hit ${origin}: ${calendarSkipped}/${candidatePool.length} destination(s) fell back to the fixed date pair; phase 1 keeps the remaining budget`
      );
    }

    // Explore-only mode scanned nothing, so report the span of the dates explore
    // actually suggested rather than a calendar window the run never looked at.
    if (candidateSource === "explore" && scans.length > 0) {
      const dates = scans.map((s) => s.outboundDate).sort();
      scanFrom = dates[0];
      scanTo = dates[dates.length - 1];
    }

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
      // Always spend the FIRST verify search, even past the deadline. The phase-0
      // cap above should keep us well inside it, but a raised `calendarWindows`
      // can still overrun — and breaking here at zero is the one outcome with no
      // upside: the ~48 calendar calls already spent are wasted unless at least
      // one route gets graded. One extra search (~10s, well inside
      // TOTAL_BUDGET_MS) buys the run a chance of seeding something.
      if (verifySearches > 0 && Date.now() - startedAt > SCAN_BUDGET_MS) {
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
        // Public badge: a friendly "Great price" only on genuine `low` fares
        // (unless an explicit override was passed). `typical` fares get no badge.
        const tag = dealTagOverride || (w.priceLevel === "low" ? "Great price" : undefined);

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
      candidateSource,
      exploreReturned,
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
