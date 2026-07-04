"use node";

/**
 * SerpApi Google Flights — Convex actions.
 *
 * - `searchFlights`     → GET https://serpapi.com/search.json?engine=google_flights
 * - `getBookingOptions` → same endpoint with a `booking_token`
 *
 * All network calls happen here. The SerpApi key never crosses the
 * frontend boundary and is never logged. Responses are normalized through
 * `convex/lib/serpApiFlights.ts` so downstream consumers stay decoupled
 * from SerpApi's raw shape.
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  createFlightSearchCacheKey,
  mapFlightType,
  mapSortBy,
  mapStops,
  mapTravelClass,
  normalizeAirports,
  normalizeBookingOption,
  normalizeFlightOption,
  normalizePriceInsights,
} from "./lib/serpApiFlights";
import type {
  FlightSearchInput,
  NormalizedBookingOptionsResponse,
  NormalizedFlightSearchResponse,
} from "../types/flights";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (user-facing search)
const SEARCH_CACHE_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cap
const BOOKING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

function getSerpApiKey(): string {
  const key = process.env.SERPAPI_API_KEY;
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    // Intentionally vague — never echo env name leakage to clients.
    throw new Error(
      "Flight search is temporarily unavailable. Please try again later."
    );
  }
  return key;
}

function safeAppend(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  params.append(key, String(value));
}

function buildSearchParams(input: FlightSearchInput): URLSearchParams {
  const params = new URLSearchParams();
  params.append("engine", "google_flights");
  params.append("departure_id", input.departureId.trim().toUpperCase());
  params.append("arrival_id", input.arrivalId.trim().toUpperCase());
  params.append("outbound_date", input.outboundDate);
  if (input.type === "round_trip" && input.returnDate) {
    params.append("return_date", input.returnDate);
  }
  params.append("currency", (input.currency ?? "EUR").toUpperCase());
  params.append("hl", "en");
  params.append("type", String(mapFlightType(input.type)));
  params.append("travel_class", String(mapTravelClass(input.travelClass)));
  params.append("stops", String(mapStops(input.stops)));
  params.append("sort_by", String(mapSortBy(input.sortBy)));

  safeAppend(params, "adults", input.adults);
  safeAppend(params, "children", input.children);
  safeAppend(params, "infants_in_seat", input.infantsInSeat);
  safeAppend(params, "infants_on_lap", input.infantsOnLap);
  safeAppend(params, "bags", input.bags);
  safeAppend(params, "max_price", input.maxPrice);
  safeAppend(params, "max_duration", input.maxDuration);
  safeAppend(params, "outbound_times", input.outboundTimes);
  safeAppend(params, "return_times", input.returnTimes);
  // Return-leg selection: fetches the return options for a chosen outbound.
  safeAppend(params, "departure_token", input.departureToken);
  if (input.deepSearch) params.append("deep_search", "true");
  if (input.noCache) params.append("no_cache", "true");

  return params;
}

async function callSerpApi(params: URLSearchParams): Promise<any> {
  params.append("api_key", getSerpApiKey());
  let res: Response;
  try {
    res = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.error("[SerpApi] Network error");
    throw new Error("Could not reach flight search. Check your connection.");
  }

  if (!res.ok) {
    console.error(`[SerpApi] HTTP ${res.status}`);
    throw new Error("Flight search failed. Please try again.");
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error("Flight search returned an invalid response.");
  }

  if (json?.error) {
    // SerpApi returns 200 with `error: string` for several distinct cases:
    //  - "no results" (a legitimate empty search, NOT a failure)
    //  - param errors (bad/past date, unknown airport)
    //  - quota / rate-limit / plan errors
    const detail = String(json.error);
    const lower = detail.toLowerCase();
    console.error("[SerpApi] API error:", detail);

    // Treat "no results" as an empty result set, not a hard error. Google
    // Flights routinely returns this for thin routes/dates (e.g. some
    // ATH->LHR combinations) and it should surface as "no flights found"
    // rather than blowing up trip generation and spamming error reports.
    if (
      lower.includes("hasn't returned any results") ||
      lower.includes("has not returned any results") ||
      lower.includes("no results") ||
      lower.includes("fully booked")
    ) {
      return { __noResults: true };
    }

    // Genuine error — preserve SerpApi's own message so error reports are
    // diagnosable. This text is SerpApi's, not a secret (no key leakage).
    throw new Error(`Flight search unavailable: ${detail}`);
  }
  return json;
}

function normalizeSearchResponse(
  raw: any,
  input: FlightSearchInput
): NormalizedFlightSearchResponse {
  const priceInsights = normalizePriceInsights(raw?.price_insights);
  const bestFlights = Array.isArray(raw?.best_flights)
    ? raw.best_flights.map((o: any, i: number) =>
        normalizeFlightOption(o, "best_flights", i, priceInsights)
      )
    : [];
  const otherFlights = Array.isArray(raw?.other_flights)
    ? raw.other_flights.map((o: any, i: number) =>
        normalizeFlightOption(o, "other_flights", i, priceInsights)
      )
    : [];

  return {
    searchId: raw?.search_metadata?.id ?? null,
    status: raw?.__noResults
      ? "no_results"
      : raw?.search_metadata?.status ?? "unknown",
    searchParameters: raw?.search_parameters ?? {
      departure_id: input.departureId,
      arrival_id: input.arrivalId,
      outbound_date: input.outboundDate,
      return_date: input.returnDate,
    },
    bestFlights,
    otherFlights,
    priceInsights,
    airports: normalizeAirports(raw?.airports),
  };
}

// ============================== searchFlights ===============================

/**
 * Core search flow — validation + cache read + network call + cache write
 * + opportunistic Low-Fare Radar seeding. Shared by the public, auth-gated
 * `searchFlights` action and the `searchFlightsInternal` action used by
 * trusted Convex actions (trip generation, radar cron, etc.).
 */
async function _runSearch(
  ctx: any,
  input: FlightSearchInput,
  cacheTtlMs?: number
): Promise<NormalizedFlightSearchResponse> {
  if (!input.departureId?.trim()) throw new Error("Departure airport is required.");
  if (!input.arrivalId?.trim()) throw new Error("Arrival airport is required.");
  if (!input.outboundDate) throw new Error("Outbound date is required.");
  if ((input.type ?? "round_trip") === "round_trip" && !input.returnDate) {
    throw new Error("Return date is required for round-trip searches.");
  }

  const cacheKey = createFlightSearchCacheKey(input);

  if (!input.noCache) {
    const cached: NormalizedFlightSearchResponse | null = await ctx.runQuery(
      internal.flightSearchCache.readCache,
      { cacheKey }
    );
    if (cached) {
      console.log(
        `[SerpApi] cache hit ${input.departureId}->${input.arrivalId} ${input.outboundDate}`
      );
      return cached;
    }
  }

  const params = buildSearchParams(input);
  const raw = await callSerpApi(params);
  const normalized = normalizeSearchResponse(raw, input);

  console.log(
    `[SerpApi] search ${input.departureId}->${input.arrivalId} ${input.outboundDate}` +
      (input.returnDate ? `/${input.returnDate}` : "") +
      ` status=${normalized.status} best=${normalized.bestFlights.length} other=${normalized.otherFlights.length}`
  );

  const ttlMs = Math.min(
    Math.max(cacheTtlMs ?? SEARCH_CACHE_TTL_MS, 0),
    SEARCH_CACHE_TTL_MAX_MS
  );
  try {
    await ctx.runMutation(internal.flightSearchCache.writeCache, {
      cacheKey,
      kind: "search",
      ttlMs,
      normalizedResults: normalized,
      departureId: input.departureId,
      arrivalId: input.arrivalId,
      outboundDate: input.outboundDate,
      returnDate: input.returnDate,
      type: input.type ?? "round_trip",
      currency: (input.currency ?? "EUR").toUpperCase(),
    });
  } catch (err) {
    console.error("[SerpApi] cache write failed");
  }

  // Radar seeding only applies to first-leg searches; a return-leg fetch
  // (departure_token) is already scoped to one outbound and would double-seed.
  if (input.departureToken) return normalized;

  try {
    const all = [...normalized.bestFlights, ...normalized.otherFlights]
      .filter((o) => o.price != null);
    const cheapest = all.length
      ? all.reduce((m, o) => ((o.price ?? Infinity) < (m.price ?? Infinity) ? o : m))
      : null;
    if (cheapest) {
      // Fire-and-forget: enrichment action does up to 2 follow-up SerpApi
      // calls (return leg + booking options) then writes the deal. Doesn't
      // block the user-facing search response.
      await ctx.scheduler.runAfter(
        0,
        internal.lowFareRadarAutoAction.enrichAndSeedDeal,
        {
          origin: input.departureId,
          destination: input.arrivalId,
          outboundDate: input.outboundDate,
          returnDate: input.returnDate,
          currency: (input.currency ?? "EUR").toUpperCase(),
          priceLevel: (normalized.priceInsights?.priceLevel as string) ?? undefined,
          option: cheapest,
          adults: typeof input.adults === "number" && input.adults > 0 ? input.adults : 1,
        }
      );
    }
  } catch (err) {
    console.error("[SerpApi] radar seed schedule failed");
  }

  return normalized;
}

export const searchFlights = action({
  args: {
    token: v.string(),
    input: v.object({
      departureId: v.string(),
      arrivalId: v.string(),
      outboundDate: v.string(),
      returnDate: v.optional(v.string()),
      type: v.optional(
        v.union(v.literal("one_way"), v.literal("round_trip"))
      ),
      currency: v.optional(v.string()),
      adults: v.optional(v.float64()),
      children: v.optional(v.float64()),
      infantsInSeat: v.optional(v.float64()),
      infantsOnLap: v.optional(v.float64()),
      travelClass: v.optional(
        v.union(
          v.literal("economy"),
          v.literal("premium_economy"),
          v.literal("business"),
          v.literal("first")
        )
      ),
      stops: v.optional(
        v.union(
          v.literal("any"),
          v.literal("nonstop"),
          v.literal("one_stop_or_fewer"),
          v.literal("two_stops_or_fewer")
        )
      ),
      sortBy: v.optional(
        v.union(
          v.literal("top"),
          v.literal("price"),
          v.literal("departure_time"),
          v.literal("arrival_time"),
          v.literal("duration"),
          v.literal("emissions")
        )
      ),
      bags: v.optional(v.float64()),
      maxPrice: v.optional(v.float64()),
      maxDuration: v.optional(v.float64()),
      outboundTimes: v.optional(v.string()),
      returnTimes: v.optional(v.string()),
      deepSearch: v.optional(v.boolean()),
      noCache: v.optional(v.boolean()),
      departureToken: v.optional(v.string()),
    }),
    // Optional cache TTL override (ms). Capped at 7 days. Used by
    // background workers like the Low-Fare Radar to keep SerpApi quota
    // bounded; user-facing searches should omit this and get the 30-min
    // default.
    cacheTtlMs: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<NormalizedFlightSearchResponse> => {
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }
    try {
      return await _runSearch(ctx, args.input as FlightSearchInput, args.cacheTtlMs);
    } catch (err) {
      await reportError(ctx, "flightsSerpApi:searchFlights", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

// Internal variant for trusted server-side callers (trip generation, crons).
// Same flow, no token check. Never expose to the client.
export const searchFlightsInternal = internalAction({
  args: {
    input: v.any(),
    cacheTtlMs: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<NormalizedFlightSearchResponse> => {
    try {
      return await _runSearch(ctx, args.input as FlightSearchInput, args.cacheTtlMs);
    } catch (err) {
      await reportError(ctx, "flightsSerpApi:searchFlightsInternal", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

// ========================== enrichTripBooking ===============================

/**
 * Post-creation enrichment for trips created from the flight search screen.
 *
 * Booking tokens are short-lived, so `trips.createFromFlight` schedules this
 * immediately. It fetches SerpApi booking options for the selected itinerary
 * and stores booking link(s) on the trip's flight data:
 *   - "together" option  → one link that books both legs (preferred)
 *   - "separate tickets" → distinct outbound + return links
 * Best-effort: failures are swallowed; the trip simply keeps no book button.
 */
export const enrichTripBooking = internalAction({
  args: {
    tripId: v.id("trips"),
    bookingToken: v.string(),
    departureId: v.string(),
    arrivalId: v.string(),
    outboundDate: v.string(),
    returnDate: v.optional(v.string()),
    currency: v.optional(v.string()),
    adults: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const p = new URLSearchParams();
      p.append("engine", "google_flights");
      p.append("departure_id", args.departureId.toUpperCase());
      p.append("arrival_id", args.arrivalId.toUpperCase());
      p.append("outbound_date", args.outboundDate);
      if (args.returnDate) {
        p.append("return_date", args.returnDate);
        p.append("type", "1");
      } else {
        p.append("type", "2");
      }
      p.append("booking_token", args.bookingToken);
      p.append("currency", (args.currency ?? "EUR").toUpperCase());
      p.append("hl", "en");
      // NOTE: no `adults` param — the booking_token already encodes the
      // passenger count, and sending adults here triggers an HTTP 400.

      const raw = await callSerpApi(p);
      const opts: any[] = Array.isArray(raw?.booking_options) ? raw.booking_options : [];

      const toRequest = (br: any) =>
        br?.url && br?.post_data ? { url: String(br.url), postData: String(br.post_data) } : undefined;

      // Full provider list (mirrors the in-app booking sheet) so the trip's
      // Flights tab can offer the same choice of booking sites. Each entry
      // keeps the POST-based booking_request, resolved at tap-time.
      const bookingProviders = opts
        .map((o) => {
          const leg = o?.together ?? o?.departing ?? o?.returning ?? o;
          return {
            bookWith: leg?.book_with ?? null,
            price: Number(leg?.price) || null,
            airlineLogos: Array.isArray(leg?.airline_logos) ? leg.airline_logos : [],
            extensions: Array.isArray(leg?.extensions) ? leg.extensions.slice(0, 3) : [],
            bookingRequest: toRequest(leg?.booking_request) ?? null,
          };
        })
        .filter((p) => p.bookingRequest)
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

      // Primary booking link for the prominent button:
      //   Rule 1 — one provider books both legs with a single link.
      //   Rule 2 — separate tickets: one link per leg.
      const together = opts
        .map((o) => ({
          price: Number(o?.together?.price) || Infinity,
          request: toRequest(o?.together?.booking_request),
        }))
        .filter((c) => c.request)
        .sort((a, b) => a.price - b.price);

      const separate = opts
        .map((o) => ({
          price:
            (Number(o?.departing?.price) || 0) + (Number(o?.returning?.price) || 0) || Infinity,
          outbound: toRequest(o?.departing?.booking_request),
          ret: toRequest(o?.returning?.booking_request),
        }))
        .filter((c) => c.outbound && c.ret)
        .sort((a, b) => a.price - b.price);

      const patch: any = { tripId: args.tripId };
      if (bookingProviders.length > 0) patch.bookingProviders = bookingProviders;
      if (together.length > 0) {
        patch.bookingRequest = together[0].request;
      } else if (separate.length > 0) {
        patch.outboundBookingRequest = separate[0].outbound;
        patch.returnBookingRequest = separate[0].ret;
      }

      if (patch.bookingProviders || patch.bookingRequest || patch.outboundBookingRequest) {
        await ctx.runMutation(internal.trips.setFlightBookingData, patch);
        console.log(
          `[SerpApi] trip booking enriched (providers=${bookingProviders.length}, together=${together.length}, separate=${separate.length})`
        );
      }
      return null;
    } catch (err) {
      // Best-effort — never block or fail trip creation over booking links.
      console.error("[SerpApi] trip booking enrichment failed");
      await reportError(ctx, "flightsSerpApi:enrichTripBooking", err, {
        tripId: String(args.tripId),
      });
      return null;
    }
  },
});

// =========================== getBookingOptions ==============================

export const getBookingOptions = action({
  args: {
    token: v.string(),
    input: v.object({
      bookingToken: v.string(),
      currency: v.optional(v.string()),
      hl: v.optional(v.string()),
      gl: v.optional(v.string()),
      departureId: v.optional(v.string()),
      arrivalId: v.optional(v.string()),
      outboundDate: v.optional(v.string()),
      returnDate: v.optional(v.string()),
      adults: v.optional(v.float64()),
    }),
  },
  handler: async (ctx, args): Promise<NormalizedBookingOptionsResponse> => {
    try {
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }

    const {
      bookingToken,
      currency,
      hl,
      gl,
      departureId,
      arrivalId,
      outboundDate,
      returnDate,
      adults,
    } = args.input;
    if (!bookingToken || !bookingToken.trim()) {
      throw new Error("Booking token is required.");
    }

    const cacheKey = `booking|${bookingToken}|${(currency ?? "EUR").toUpperCase()}`;

    const cached: NormalizedBookingOptionsResponse | null = await ctx.runQuery(
      internal.flightSearchCache.readCache,
      { cacheKey }
    );
    if (cached) {
      console.log(`[SerpApi] booking-options cache hit`);
      return cached;
    }

    const params = new URLSearchParams();
    params.append("engine", "google_flights");
    // SerpApi's booking_options endpoint rejects a bare booking_token — it
    // needs the same route + dates as the original search. Mirror the exact
    // param shape used by the proven trip-generation path (tripsActions.ts):
    // route + dates + type + booking_token + currency + hl, and NOTHING else.
    // Passing extras like `adults` here triggers an HTTP 400.
    if (departureId) params.append("departure_id", departureId.toUpperCase());
    if (arrivalId) params.append("arrival_id", arrivalId.toUpperCase());
    if (outboundDate) params.append("outbound_date", outboundDate);
    if (returnDate) {
      params.append("return_date", returnDate);
      params.append("type", "1"); // round trip
    } else if (outboundDate) {
      params.append("type", "2"); // one way
    }
    params.append("booking_token", bookingToken);
    params.append("currency", (currency ?? "EUR").toUpperCase());
    params.append("hl", hl ?? "en");
    if (gl) params.append("gl", gl);
    void adults; // intentionally not sent — see comment above

    // Booking options are best-effort. If SerpApi rejects the request (e.g.
    // an expired/invalid booking_token, which is common by the time a user
    // taps through), degrade to an empty provider list so the sheet shows
    // "No providers available" instead of a hard error banner.
    let raw: any;
    try {
      raw = await callSerpApi(params);
    } catch (serpErr) {
      console.warn("[SerpApi] booking-options fetch failed; returning empty list");
      return {
        selectedFlights: [],
        baggagePrices: null,
        bookingOptions: [],
        priceInsights: null,
      };
    }

    const priceInsights = normalizePriceInsights(raw?.price_insights);
    const selectedFlights = Array.isArray(raw?.selected_flights)
      ? raw.selected_flights.map((o: any, i: number) =>
          normalizeFlightOption(o, "best_flights", i, priceInsights)
        )
      : [];
    const bookingOptions = Array.isArray(raw?.booking_options)
      ? raw.booking_options.map((o: any, i: number) => normalizeBookingOption(o, i))
      : [];

    const normalized: NormalizedBookingOptionsResponse = {
      selectedFlights,
      baggagePrices: raw?.baggage_prices ?? null,
      bookingOptions,
      priceInsights,
    };

    console.log(
      `[SerpApi] booking-options providers=${bookingOptions.length}`
    );

    try {
      await ctx.runMutation(internal.flightSearchCache.writeCache, {
        cacheKey,
        kind: "booking_options",
        ttlMs: BOOKING_CACHE_TTL_MS,
        normalizedResults: normalized,
        currency: (currency ?? "EUR").toUpperCase(),
      });
    } catch {
      // best-effort
    }

    return normalized;
    } catch (err) {
      await reportError(ctx, "flightsSerpApi:getBookingOptions", err, {
        bookingToken: args.input?.bookingToken?.slice(0, 24),
      });
      throw err;
    }
  },
});
