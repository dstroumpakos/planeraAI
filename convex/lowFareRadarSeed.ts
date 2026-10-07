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
 *   - `"pool"` (default) — the first `poolTop` entries of the shared
 *     `POPULAR_DESTINATIONS` list (`./lib/radarDestinations`).
 *   - `"explicit"` — set implicitly when the caller passes `destinations`: only
 *     those codes are scanned, nothing is added and nothing falls back to the
 *     pool. This is how wishlist-driven seeding stays confined to the routes
 *     users actually asked for (home airport → wishlisted city).
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
import {
  MAX_CALENDAR_WINDOWS,
  fetchFlightCalendar,
} from "./lib/searchApiFlightCalendar";
import {
  DEFAULT_POOL_TOP,
  POPULAR_DESTINATIONS,
  calendarAirportFor,
  cityForIata,
  countryForIata,
} from "./lib/radarDestinations";
import {
  CHRISTMAS_DESTINATIONS,
  CHRISTMAS_TRIP_NIGHTS,
  christmasSeason,
  isChristmasTrip,
} from "../lib/christmas";
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
 * The candidate pool itself lives in `./lib/radarDestinations` so the plain
 * Convex runtime can use it too (wishlist-name resolution). The `"pool"` source
 * scans only its first `poolTop` entries — see `DEFAULT_POOL_TOP` there for why.
 */

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
 * Horizon for an explicit destination list (saved-destination routes). These
 * are routes someone asked for, so it is worth looking ~6 months out to find the
 * cheap season: verified 2026-10-01, DEL→CDG was ~€645 ("high") for November
 * but €408 for February, under Google's usual €440–550. Explicit lists are
 * short, so the extra windows cost little quota.
 */
const EXPLICIT_HORIZON_DAYS = 180;

/** Windows fetched in parallel per destination on a long (explicit) scan. */
const EXPLICIT_WINDOW_CONCURRENCY = 3;

/**
 * Windows needed to reach `horizonDays` from a given start offset. Clamped to
 * the same 1–MAX_CALENDAR_WINDOWS range the `calendarWindows` arg accepts.
 */
function windowsForHorizon(
  startOffsetDays: number,
  horizonDays = MIN_HORIZON_DAYS
): number {
  const start = Math.max(startOffsetDays, CALENDAR_MIN_LEAD_DAYS);
  const span = horizonDays - start + 1;
  return Math.max(
    1,
    Math.min(Math.ceil(span / CALENDAR_WINDOW_DAYS), MAX_CALENDAR_WINDOWS)
  );
}

/** How many top-ranked routes get a real (bookable, graded) verify search. */
const VERIFY_HEADROOM = 6;

/**
 * Airports per country group that get a real verify search. A country is
 * scanned across all its main airports, but only its cheapest few on the
 * calendar are worth a (heavier) verify search — one winner is kept anyway.
 */
const GROUP_VERIFY_MAX = 2;

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

/** Whole days from now until a YYYY-MM-DD date (UTC), floored at 0. */
function daysUntil(date: string): number {
  const ms = new Date(`${date}T00:00:00Z`).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

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
  /**
   * Long (explicit) scans only: the cheapest pair from other months, tried in
   * order when Google grades the main pair `high`. A route's cheapest fare is
   * often flat across months, and the first date carrying it can be a 1-night
   * hop Google calls high while the same fare in another month is `typical`
   * (verified 2026-10-01: ATH→DXB €380 was high on 2–3 Nov, typical on 20–27 Jan).
   */
  alternates?: Array<{ outboundDate: string; returnDate: string }>;
};

/** Alternate month-pairs a long scan may verify after a `high` grade. */
const MAX_DATE_ALTERNATES = 2;
/** Shortest trip a long scan will pick, so a 1-night hop never wins on price. */
const MIN_PICK_NIGHTS = 3;

function nightsBetween(out: string, ret: string): number {
  return Math.round((Date.parse(ret) - Date.parse(out)) / 86400000);
}

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
    /** ~14-day calendar windows scanned per destination. 1–13. More = wider
     *  date search and proportionally more quota. Defaults to ~2 months, or
     *  ~6 months for an explicit `destinations` list. */
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
    /** Pool entries scanned by the `"pool"` source. 1–`POPULAR_DESTINATIONS.length`. */
    poolTop: v.optional(v.float64()),
    /**
     * Exact destination codes (IATA or metro) to scan INSTEAD of any generated
     * candidate list. Overrides `source`. Used by `seedWishlistRoutes`.
     */
    destinations: v.optional(v.array(v.string())),
    /**
     * Countries (or any "one of these" set): every code in a group is scanned,
     * but at most ONE deal is seeded per group — the best qualifying fare. A
     * group is skipped when the origin already has a live deal into it. Used by
     * `seedWishlistRoutes` for saved countries ("Spain" → BCN/MAD/AGP/PMI).
     */
    destinationGroups: v.optional(
      v.array(v.object({ label: v.string(), codes: v.array(v.string()) }))
    ),
    /**
     * Seasonal campaign. `"christmas"` scans `CHRISTMAS_DESTINATIONS` (or the
     * explicit `destinations`) ONLY on festive dates (see `lib/christmas.ts`),
     * treats a route as covered only by an existing Christmas-dated deal, and
     * keeps only fares worth buying: Google-graded `low`, or `typical` but
     * strictly under the route's typical midpoint. Holiday fares are high by
     * default, so a merely-typical Christmas fare is not a deal.
     */
    season: v.optional(v.literal("christmas")),
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
    candidateSource: "pool" | "explore" | "explore+calendar" | "explicit";
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
    const isChristmas = args.season === "christmas";
    const season = isChristmas ? christmasSeason() : null;
    if (season && daysUntil(season.departTo) < CALENDAR_MIN_LEAD_DAYS) {
      throw new ConvexError(
        `Christmas season ${season.departFrom}..${season.departTo} is too close to price`
      );
    }
    // Explicit lists are usually short and every entry was asked for, so the
    // default is "seed everything that qualifies" rather than the pool's top 10.
    // Christmas without an explicit list scans the whole festive list.
    const explicitCodes = Array.from(
      new Set(
        (args.destinations ??
          (isChristmas ? CHRISTMAS_DESTINATIONS.map((d) => d.code) : []))
          .map((c) => String(c).trim().toUpperCase())
          .filter((c) => /^[A-Z]{3}$/.test(c))
      )
    );
    // Country groups: code → group label. A code also listed on its own stays
    // a plain destination (it was asked for by name).
    const groupOf = new Map<string, string>();
    const groupLabels: string[] = [];
    for (const g of args.destinationGroups ?? []) {
      const label = g.label.trim();
      const codes = Array.from(
        new Set(g.codes.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))
      ).filter((c) => !explicitCodes.includes(c));
      if (!label || codes.length === 0) continue;
      groupLabels.push(label);
      for (const c of codes) if (!groupOf.has(c)) groupOf.set(c, label);
    }
    const singleCount = explicitCodes.length;
    explicitCodes.push(...Array.from(groupOf.keys()).filter((c) => !explicitCodes.includes(c)));
    const isExplicit = explicitCodes.length > 0;
    const count = Math.max(
      1,
      Math.min(
        Math.round(args.count ?? (isExplicit ? singleCount + groupLabels.length : 10)),
        20
      )
    );
    const adults = typeof args.adults === "number" && args.adults > 0 ? args.adults : 1;
    // Optional tag override applied to every seeded deal. When omitted, the tag
    // is derived per-deal from its grade (a public "Great price" badge for
    // genuine `low` fares, none for merely-`typical` ones).
    const dealTagOverride = args.dealTag?.trim() || undefined;

    // Offset first: the default window count is derived from it, so that moving
    // the start offset can never silently shorten the horizon.
    //
    // Christmas pins the scan to the festive departure window instead: start on
    // its first day (or the lib's minimum lead, once the season has begun) and
    // stack just enough 14-day windows to reach its last departure.
    const startOffsetDays = season
      ? Math.max(CALENDAR_MIN_LEAD_DAYS, daysUntil(season.departFrom))
      : Math.max(
          0,
          Math.round(args.startOffsetDays ?? DEFAULT_SCAN_START_OFFSET_DAYS)
        );
    const windows = Math.max(
      1,
      Math.min(
        Math.round(
          args.calendarWindows ??
            (season
              ? Math.ceil(
                  (daysUntil(season.departTo) - startOffsetDays + 1) /
                    CALENDAR_WINDOW_DAYS
                )
              : windowsForHorizon(
                  startOffsetDays,
                  isExplicit ? EXPLICIT_HORIZON_DAYS : MIN_HORIZON_DAYS
                ))
        ),
        MAX_CALENDAR_WINDOWS
      )
    );
    // Long scans fetch a few windows at once so they fit the phase-0 budget.
    const windowConcurrency =
      windows > 6 ? EXPLICIT_WINDOW_CONCURRENCY : 1;
    const concurrency = Math.max(
      1,
      Math.min(Math.round(args.concurrency ?? DEFAULT_SCAN_CONCURRENCY), 8)
    );
    const verifyTop = Math.max(
      1,
      Math.round(args.verifyTop ?? count + VERIFY_HEADROOM)
    );
    const requestedSource = isExplicit ? "explicit" : (args.source ?? "pool");
    const exploreTop = Math.max(
      1,
      Math.min(Math.round(args.exploreTop ?? DEFAULT_EXPLORE_TOP), 40)
    );
    const poolTop = Math.max(
      1,
      Math.min(
        Math.round(args.poolTop ?? DEFAULT_POOL_TOP),
        POPULAR_DESTINATIONS.length
      )
    );
    const startedAt = Date.now();
    let timedOut = false;

    // Dates the scan is expected to cover, for the summary. The lib floors the
    // start at its own minimum lead time, so mirror that here.
    let scanFrom = dateAhead(Math.max(startOffsetDays, 8));
    let scanTo = dateAhead(Math.max(startOffsetDays, 8) + windows * 14 - 1);
    if (season) {
      if (scanFrom < season.departFrom) scanFrom = season.departFrom;
      if (scanTo > season.departTo) scanTo = season.departTo;
    }

    // Fixed pair used only when a route's calendar comes back empty, so a thin
    // route degrades to the old behaviour instead of dropping out entirely.
    // Christmas falls back to the week before Christmas Day (or the first
    // still-priceable festive day once that has passed).
    const christmasFallbackOut = season
      ? `${season.departFrom.slice(0, 4)}-12-19`
      : null;
    const fallbackOutbound = season
      ? christmasFallbackOut! >= scanFrom
        ? christmasFallbackOut!
        : scanFrom
      : dateAhead(45);
    const fallbackReturn = season
      ? addNights(fallbackOutbound, CHRISTMAS_TRIP_NIGHTS)
      : dateAhead(52);

    // Skip any destination this origin already has a live deal for (AUTO or
    // curated) — `listActive` already filters to active/non-expired/non-deleted.
    // In Christmas mode only a Christmas-dated deal counts: an October Vienna
    // fare says nothing about December.
    const existing: Array<{
      destination: string;
      outboundDate?: string;
      returnDate?: string;
    }> = await ctx.runQuery(api.lowFareRadar.listActive, { origin });
    const covered = new Set(
      existing
        .filter(
          (d) => !isChristmas || isChristmasTrip(d.outboundDate, d.returnDate)
        )
        .map((d) => d.destination.toUpperCase())
    );
    // A group is covered by a live deal to ANY of its airports, or to anywhere
    // in that country (an ATH→VLC deal already answers "Spain").
    const coveredCountries = new Set(
      Array.from(covered).map((c) => countryForIata(c)).filter((c): c is string => !!c)
    );
    const coveredGroups = new Set<string>();
    for (const [code, label] of groupOf) {
      if (covered.has(code) || coveredCountries.has(label)) coveredGroups.add(label);
    }
    for (const [code, label] of Array.from(groupOf)) {
      if (coveredGroups.has(label)) {
        groupOf.delete(code);
        const i = explicitCodes.indexOf(code);
        if (i >= 0) explicitCodes.splice(i, 1);
      }
    }

    // Exclude the origin itself, anything already covered, and same-city metro
    // codes (e.g. origin JFK vs destination NYC, both "New York").
    const originCity = cityForIata(origin).toLowerCase();
    const usable = (d: { code: string; city: string }) =>
      d.code !== origin &&
      !covered.has(d.code) &&
      d.city.toLowerCase() !== originCity;
    const christmasCity = new Map(
      CHRISTMAS_DESTINATIONS.map((d) => [d.code, d.city])
    );
    const poolCandidates: SeedCandidate[] = isExplicit
      ? explicitCodes
          .map((code) => ({
            code,
            city: (isChristmas && christmasCity.get(code)) || cityForIata(code),
          }))
          .filter(usable)
      : POPULAR_DESTINATIONS.slice(0, poolTop)
          .filter(usable)
          .map((d) => ({ code: d.code, city: d.city }));

    // Candidate generation. An explore source that comes back empty — API down,
    // or an origin the engine doesn't cover — degrades to the pool, because a
    // press that seeds nothing is strictly worse than one that seeds the
    // generic list. An explicit list never widens: it IS the request.
    let candidateSource: "pool" | "explore" | "explore+calendar" | "explicit" =
      requestedSource;
    let exploreReturned = 0;
    let candidatePool: SeedCandidate[] = poolCandidates;

    if (requestedSource !== "pool" && requestedSource !== "explicit") {
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
            // Metro codes (PAR, NYC…) price nothing on the calendar engine;
            // scan their main airport. Phase 1 still searches the metro code.
            {
              departureId: calendarAirportFor(origin),
              arrivalId: calendarAirportFor(dest.code),
              currency,
            },
            {
              windows,
              windowConcurrency,
              startOffsetDays,
              // Keep every priced date — the median below is only meaningful
              // over the full window, not over a thinned "strip" selection.
              maxDates: windows * 14,
              spacingDays: 1,
              // Party size changes which fares are actually bookable, so it
              // must be priced in, not multiplied afterwards.
              adults,
              // A holiday is a week, not the lib's default 5-night hop.
              ...(season ? { returnGapDays: CHRISTMAS_TRIP_NIGHTS } : {}),
            }
          );
        } catch {
          console.error(`[radar-seed] calendar failed ${origin}->${dest.code}`);
        }

        // The last window overshoots the festive range; drop dates outside it
        // so both the picked date and the median are Christmas-only.
        const dates = (calendar?.dates ?? []).filter(
          (d) => !season || isChristmasTrip(d.date, d.returnDate)
        );
        if (dates.length === 0) {
          calendarEmpty++;
          return fallback;
        }

        // The calendar pairs each departure with the return that produced
        // its cheapest fare; only synthesise one if that's missing.
        const returnFor = (d: { date: string; returnDate?: string }) =>
          d.returnDate && d.returnDate > d.date
            ? d.returnDate
            : addNights(d.date, FALLBACK_TRIP_NIGHTS);

        // Long scans: skip 1–2 night hops when real trips exist, and keep the
        // cheapest pair of each other month as fallbacks for phase 1.
        const longScan = windowConcurrency > 1;
        const trips = longScan
          ? dates.filter(
              (d) => nightsBetween(d.date, returnFor(d)) >= MIN_PICK_NIGHTS
            )
          : [];
        const pickFrom = trips.length > 0 ? trips : dates;

        const best = pickFrom.reduce((m, d) => (d.price < m.price ? d : m));
        const mid = median(dates.map((d) => d.price));
        const calendarDiscount =
          mid && mid > 0 ? Math.max(0, (mid - best.price) / mid) : 0;

        let alternates: ScanResult["alternates"];
        if (longScan) {
          const byMonth = new Map<string, (typeof pickFrom)[number]>();
          for (const d of pickFrom) {
            const month = d.date.slice(0, 7);
            if (month === best.date.slice(0, 7)) continue;
            const seen = byMonth.get(month);
            if (!seen || d.price < seen.price) byMonth.set(month, d);
          }
          alternates = [...byMonth.values()]
            .sort((a, b) => a.price - b.price)
            .slice(0, MAX_DATE_ALTERNATES)
            .map((d) => ({ outboundDate: d.date, returnDate: returnFor(d) }));
        }

        return {
          destination: dest.code,
          city: dest.city,
          outboundDate: best.date,
          returnDate: returnFor(best),
          calendarPrice: best.price,
          calendarDiscount,
          datesScanned: dates.length,
          fellBack: false,
          alternates,
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

    // Country groups: only the group's calendar-cheapest few go on to verify.
    const groupKeep = new Set<string>();
    {
      const byGroup = new Map<string, ScanResult[]>();
      for (const sc of scans) {
        const label = groupOf.get(sc.destination);
        if (!label) continue;
        const list = byGroup.get(label) ?? [];
        list.push(sc);
        byGroup.set(label, list);
      }
      for (const list of byGroup.values()) {
        list
          .sort((a, b) => (a.calendarPrice ?? Infinity) - (b.calendarPrice ?? Infinity))
          .slice(0, GROUP_VERIFY_MAX)
          .forEach((sc) => groupKeep.add(sc.destination));
      }
    }
    const groupDone = new Set<string>();

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
      .filter((s) => !groupOf.has(s.destination) || groupKeep.has(s.destination))
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
      const group = groupOf.get(dest.code);
      // One deal per country: stop once a sibling airport qualified.
      if (group && groupDone.has(group)) continue;
      // The picked pair first, then (long scans only) other months' cheapest
      // pairs — stopping at the first that Google grades as a deal.
      const attempts = [
        { outboundDate: scan.outboundDate, returnDate: scan.returnDate },
        ...(scan.alternates ?? []),
      ];
      for (let a = 0; a < attempts.length; a++) {
        const dates = attempts[a];
        if (a > 0 && Date.now() - startedAt > SCAN_BUDGET_MS) {
          timedOut = true;
          break;
        }
        const input: FlightSearchInput = {
          departureId: origin,
          arrivalId: dest.code,
          outboundDate: dates.outboundDate,
          returnDate: dates.returnDate,
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
          // Logged so a route that stays red on the admin widget explains itself.
          if (level !== "low" && level !== "typical") {
            console.log(
              `[radar-seed] rejected ${origin}->${dest.code} ${dates.outboundDate}..${dates.returnDate}: €${cheapest.price} graded "${level || "none"}"`
            );
            continue;
          }

          const range = priceInsights?.typicalPriceRange;
          const mid =
            Array.isArray(range) && range.length === 2
              ? (range[0] + range[1]) / 2
              : null;
          // Christmas: a `typical` holiday fare is still an expensive fare. Keep
          // it only when it is provably under the route's typical midpoint.
          if (
            isChristmas &&
            level !== "low" &&
            !(mid != null && cheapest.price < mid)
          ) {
            continue;
          }
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
            outboundDate: dates.outboundDate,
            returnDate: dates.returnDate,
            option: cheapest,
            priceLevel: level,
            price: cheapest.price,
            discount,
            typicalMid: mid,
          });
          if (group) groupDone.add(group);
          break;
        } catch (err) {
          console.error(`[radar-seed] search failed ${origin}->${dest.code}`);
        }
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

/**
 * Spacing between the per-origin runs `seedWishlistRoutes` schedules. Each run
 * is its own action (own 10-minute limit, own budget), so this is only about
 * not hitting searchapi.io with every origin's calendar wave at the same
 * instant — not about fitting inside one action.
 */
const WISHLIST_ORIGIN_STAGGER_MS = 20 * 1000;

/**
 * Demand-driven seeding: search deals ONLY for routes real users have asked
 * for, i.e. (their home airport → a city they saved).
 *
 * The pairing comes from `lowFareRadar.getWishlistRoutes`, which counts BOTH
 * kinds of save — wishlist entries and watched destinations, so the watch a
 * new user taps in onboarding gets searched too. Users without a home airport
 * contribute nothing, and routes that already have a live deal are skipped.
 * The remaining routes are grouped by origin and each origin gets one
 * scheduled `seedDealsForOrigin` run with an explicit `destinations` list —
 * so ATH scans ATH→NYC because an ATH user saved New York, and never
 * ATH→Bali unless an ATH user asked for it.
 *
 * Fans out via the scheduler rather than looping in-process: a single origin
 * can legitimately take minutes, and a serial loop over several would hit the
 * 10-minute action kill and lose the tail. Results land in the radar table as
 * persistent curated deals; the admin view's coverage flags flip on reload.
 */
export const seedWishlistRoutes = action({
  args: {
    adminKey: v.string(),
    /** Report the plan without scheduling any searches. */
    dryRun: v.optional(v.boolean()),
    /** Restrict to one origin (e.g. from a per-airport button). */
    origin: v.optional(v.string()),
    currency: v.optional(v.string()),
    adults: v.optional(v.float64()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    dryRun: boolean;
    /** Routes with no live deal, grouped by origin, in schedule order. */
    origins: Array<{
      origin: string;
      originCity: string;
      /** `airports` is set on saved COUNTRIES: searched together, one deal kept. */
      destinations: Array<{ code: string; city: string; users: number; airports?: string[] }>;
      /** Seconds from now this origin's run starts (0 on dry runs). */
      startsInSeconds: number;
    }>;
    routesTotal: number;
    routesCovered: number;
    routesScheduled: number;
    unresolved: Array<{ destination: string; count: number }>;
    noHomeAirport: number;
  }> => {
    validateAdminKey(args.adminKey);
    const onlyOrigin = args.origin?.trim().toUpperCase() || undefined;

    const demand: {
      routes: Array<{
        origin: string;
        originCity: string;
        destination: string;
        destinationCity: string;
        users: number;
        wishlistUsers?: number;
        watchUsers?: number;
        sources?: Array<"wishlist" | "watch">;
        hasLive: boolean;
        kind?: "country";
        airports?: string[];
      }>;
      unresolved: Array<{ destination: string; count: number }>;
      noHomeAirport: number;
    } = await ctx.runQuery(api.lowFareRadar.getWishlistRoutes, {
      adminKey: args.adminKey,
    });

    const relevant = demand.routes.filter(
      (r) => !onlyOrigin || r.origin === onlyOrigin
    );
    const gaps = relevant.filter((r) => !r.hasLive);

    // Group by origin, keeping the query's demand order inside each group.
    const byOrigin = new Map<
      string,
      { originCity: string; destinations: Array<{ code: string; city: string; users: number; airports?: string[] }> }
    >();
    for (const r of gaps) {
      let g = byOrigin.get(r.origin);
      if (!g) {
        g = { originCity: r.originCity, destinations: [] };
        byOrigin.set(r.origin, g);
      }
      g.destinations.push({
        code: r.destination,
        city: r.destinationCity,
        users: r.users,
        ...(r.kind === "country" && r.airports?.length ? { airports: r.airports } : {}),
      });
    }

    // Busiest origins first so the most-wanted routes get priced soonest.
    const ordered = Array.from(byOrigin.entries()).sort(
      (a, b) =>
        b[1].destinations.reduce((n, d) => n + d.users, 0) -
        a[1].destinations.reduce((n, d) => n + d.users, 0)
    );

    const dryRun = !!args.dryRun;
    const origins: Array<{
      origin: string;
      originCity: string;
      destinations: Array<{ code: string; city: string; users: number; airports?: string[] }>;
      startsInSeconds: number;
    }> = [];

    for (let i = 0; i < ordered.length; i++) {
      const [origin, g] = ordered[i];
      const delayMs = i * WISHLIST_ORIGIN_STAGGER_MS;
      if (!dryRun) {
        // Self-reference through the generated api; cast because the file's
        // own exports aren't typed until codegen runs (same as `internal`).
        await ctx.scheduler.runAfter(
          delayMs,
          (api as any).lowFareRadarSeed.seedDealsForOrigin,
          {
            adminKey: args.adminKey,
            origin,
            destinations: g.destinations.filter((d) => !d.airports).map((d) => d.code),
            destinationGroups: g.destinations
              .filter((d) => d.airports)
              .map((d) => ({ label: d.code, codes: d.airports! })),
            currency: args.currency,
            adults: args.adults,
          }
        );
      }
      origins.push({
        origin,
        originCity: g.originCity,
        destinations: g.destinations,
        startsInSeconds: dryRun ? 0 : Math.round(delayMs / 1000),
      });
    }

    console.log(
      `[radar-seed] saved-destination ${dryRun ? "plan" : "scheduled"}: ${gaps.length} route(s) across ${origins.length} origin(s); ${relevant.length - gaps.length} already covered; ${demand.unresolved.length} unresolved name(s); ${demand.noHomeAirport} save(s) without a home airport`
    );

    return {
      dryRun,
      origins,
      routesTotal: relevant.length,
      routesCovered: relevant.length - gaps.length,
      routesScheduled: dryRun ? 0 : gaps.length,
      unresolved: demand.unresolved,
      noHomeAirport: demand.noHomeAirport,
    };
  },
});

/**
 * Christmas campaign: run the festive scan (`seedDealsForOrigin` with
 * `season: "christmas"`) for every home airport that has users, busiest first.
 *
 * Same fan-out shape as `seedWishlistRoutes` — one scheduled action per origin,
 * staggered — because each origin can take minutes. Each run scans the ~25
 * `CHRISTMAS_DESTINATIONS` over two calendar windows (~50 calendar calls) plus
 * its verify/enrich searches, so `maxOrigins` is the quota knob: always dry-run
 * first. Seeded deals are ordinary curated deals, so the refresh cron re-prices
 * them and expires any that climb back above the route's typical fare.
 */
export const seedChristmasDeals = action({
  args: {
    adminKey: v.string(),
    /** Report the plan without scheduling any searches. */
    dryRun: v.optional(v.boolean()),
    /** Restrict to one origin. */
    origin: v.optional(v.string()),
    /** Busiest N home airports (default 5, max 30). */
    maxOrigins: v.optional(v.float64()),
    /** Skip airports with fewer users than this (default 1). */
    minUsers: v.optional(v.float64()),
    /** Deals to keep per origin (default 8). */
    count: v.optional(v.float64()),
    /** Restrict the festive list to these codes. */
    destinations: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    adults: v.optional(v.float64()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    dryRun: boolean;
    season: { departFrom: string; departTo: string };
    destinations: string[];
    origins: Array<{
      origin: string;
      city: string;
      users: number;
      startsInSeconds: number;
    }>;
  }> => {
    validateAdminKey(args.adminKey);
    const onlyOrigin = args.origin?.trim().toUpperCase() || undefined;
    const maxOrigins = Math.max(1, Math.min(Math.round(args.maxOrigins ?? 5), 30));
    const minUsers = Math.max(1, Math.round(args.minUsers ?? 1));
    const count = Math.max(1, Math.min(Math.round(args.count ?? 8), 20));
    const destinations =
      args.destinations && args.destinations.length > 0
        ? args.destinations.map((c) => c.trim().toUpperCase())
        : CHRISTMAS_DESTINATIONS.map((d) => d.code);

    const airports: Array<{ code: string; city: string; count: number }> =
      await ctx.runQuery(api.lowFareRadar.getHomeAirports, {
        adminKey: args.adminKey,
      });
    const picked = onlyOrigin
      ? [
          airports.find((a) => a.code === onlyOrigin) ?? {
            code: onlyOrigin,
            city: cityForIata(onlyOrigin),
            count: 0,
          },
        ]
      : airports.filter((a) => a.count >= minUsers).slice(0, maxOrigins);

    const dryRun = !!args.dryRun;
    const origins = [];
    for (let i = 0; i < picked.length; i++) {
      const a = picked[i];
      const delayMs = i * WISHLIST_ORIGIN_STAGGER_MS;
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          delayMs,
          (api as any).lowFareRadarSeed.seedDealsForOrigin,
          {
            adminKey: args.adminKey,
            origin: a.code,
            season: "christmas",
            destinations,
            count,
            currency: args.currency,
            adults: args.adults,
          }
        );
      }
      origins.push({
        origin: a.code,
        city: a.city,
        users: a.count,
        startsInSeconds: dryRun ? 0 : Math.round(delayMs / 1000),
      });
    }

    const season = christmasSeason();
    console.log(
      `[radar-seed] christmas ${dryRun ? "plan" : "scheduled"}: ${origins.length} origin(s) x ${destinations.length} destination(s), departures ${season.departFrom}..${season.departTo}`
    );

    return {
      dryRun,
      season: { departFrom: season.departFrom, departTo: season.departTo },
      destinations,
      origins,
    };
  },
});
