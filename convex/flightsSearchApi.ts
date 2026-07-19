"use node";

/**
 * searchapi.io Google Flights — Convex actions.
 *
 * The user-facing flight-search screen and its booking-options sheet run on
 * searchapi.io (this module). Trip *generation* (AI itineraries) still runs on
 * SerpApi via `flightsSerpApi.ts` — the two never share a `booking_token`,
 * which is provider-specific and can only be resolved by the vendor that
 * minted it.
 *
 *   - `searchFlights`       → GET searchapi.io/api/v1/search?engine=google_flights
 *   - `searchFlightsPublic` → account-free variant for the marketing widget
 *   - `getBookingOptions`   → same endpoint with a `booking_token`
 *   - `enrichTripBooking`   → post-creation booking enrichment for trips made
 *                             from THIS search flow (consumes its token)
 *
 * Responses are normalized through `convex/lib/serpApiFlights.ts` (tolerant of
 * both vendors' field spellings) so every downstream consumer — hooks,
 * screens, components, the shared `types/flights.ts` — is untouched.
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  normalizeAirports,
  normalizeBookingOption,
  normalizeFlightOption,
  normalizePriceInsights,
} from "./lib/serpApiFlights";
import {
  SEARCHAPI_FLIGHTS_ENDPOINT,
  buildSearchApiBookingParams,
  buildSearchApiSearchParams,
  createSearchApiCacheKey,
} from "./lib/searchApiFlightSearch";
import { glForIata } from "../lib/airports";
import type {
  FlightSearchInput,
  NormalizedBookingOptionsResponse,
  NormalizedFlightSearchResponse,
} from "../types/flights";

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (user-facing search)
const SEARCH_CACHE_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cap
const BOOKING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

function getSearchApiKey(): string {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    // Intentionally vague — never echo env name leakage to clients.
    throw new Error(
      "Flight search is temporarily unavailable. Please try again later."
    );
  }
  return key.trim();
}

/**
 * Network call to searchapi.io. Throws on hard failures (mirrors SerpApi's
 * `callSerpApi`) so the user-facing search surfaces an error; returns
 * `{ __noResults: true }` for legitimately-empty searches.
 */
async function callSearchApi(params: URLSearchParams): Promise<any> {
  const key = getSearchApiKey();
  let res: Response;
  try {
    res = await fetch(`${SEARCHAPI_FLIGHTS_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });
  } catch {
    console.error("[searchapi] Network error");
    throw new Error("Could not reach flight search. Check your connection.");
  }

  if (!res.ok) {
    console.error(`[searchapi] HTTP ${res.status}`);
    throw new Error("Flight search failed. Please try again.");
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error("Flight search returned an invalid response.");
  }

  if (json?.error) {
    const detail = String(json.error);
    const lower = detail.toLowerCase();
    console.error("[searchapi] API error:", detail);

    // Treat "no results" as an empty result set, not a hard error — Google
    // Flights routinely returns this for thin routes/dates.
    if (
      lower.includes("hasn't returned any results") ||
      lower.includes("has not returned any results") ||
      lower.includes("no results") ||
      lower.includes("no flights") ||
      lower.includes("fully booked")
    ) {
      return { __noResults: true };
    }

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
 * + opportunistic Low-Fare Radar seeding. Shared by the authenticated
 * `searchFlights` and the account-free `searchFlightsPublic`.
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

  const cacheKey = createSearchApiCacheKey(input);

  if (!input.noCache) {
    const cached: NormalizedFlightSearchResponse | null = await ctx.runQuery(
      internal.flightSearchCache.readCache,
      { cacheKey }
    );
    if (cached) {
      console.log(
        `[searchapi] cache hit ${input.departureId}->${input.arrivalId} ${input.outboundDate}`
      );
      return cached;
    }
  }

  const params = buildSearchApiSearchParams(input);
  const raw = await callSearchApi(params);
  const normalized = normalizeSearchResponse(raw, input);

  console.log(
    `[searchapi] search ${input.departureId}->${input.arrivalId} ${input.outboundDate}` +
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
    console.error("[searchapi] cache write failed");
  }

  // Radar seeding only applies to first-leg searches; a return-leg fetch
  // (departure_token) is already scoped to one outbound and would double-seed.
  if (input.departureToken) return normalized;

  try {
    const all = [...normalized.bestFlights, ...normalized.otherFlights].filter(
      (o) => o.price != null
    );
    const cheapest = all.length
      ? all.reduce((m, o) => ((o.price ?? Infinity) < (m.price ?? Infinity) ? o : m))
      : null;
    if (cheapest) {
      // Fire-and-forget: the seed action does up to 2 follow-up calls (return
      // leg + booking options). `provider: "searchapi"` is REQUIRED so those
      // calls resolve this search's searchapi token on searchapi, not SerpApi.
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
          provider: "searchapi",
        }
      );
    }
  } catch (err) {
    console.error("[searchapi] radar seed schedule failed");
  }

  return normalized;
}

// Shared validator for the flight-search input, reused by the authenticated
// `searchFlights` and the account-free public `searchFlightsPublic`.
const FLIGHT_SEARCH_INPUT = v.object({
  departureId: v.string(),
  arrivalId: v.string(),
  outboundDate: v.string(),
  returnDate: v.optional(v.string()),
  type: v.optional(v.union(v.literal("one_way"), v.literal("round_trip"))),
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
  carryOnBags: v.optional(v.float64()),
  checkedBags: v.optional(v.float64()),
  showCheapestFlights: v.optional(v.boolean()),
  showHiddenFlights: v.optional(v.boolean()),
  hideSeparateTickets: v.optional(v.boolean()),
  maxPrice: v.optional(v.float64()),
  maxDuration: v.optional(v.float64()),
  outboundTimes: v.optional(v.string()),
  returnTimes: v.optional(v.string()),
  deepSearch: v.optional(v.boolean()),
  noCache: v.optional(v.boolean()),
  departureToken: v.optional(v.string()),
});

export const searchFlights = action({
  args: {
    token: v.string(),
    input: FLIGHT_SEARCH_INPUT,
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
    // Per-user rate limit: guards the paid search quota from abuse. Generous
    // enough for genuine browsing; strict enough to cap a single session.
    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: String(session.userId), limit: 60, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've searched a lot in a short time. Please wait a few minutes and try again."
      );
    }
    try {
      return await _runSearch(ctx, args.input as FlightSearchInput, args.cacheTtlMs);
    } catch (err) {
      await reportError(ctx, "flightsSearchApi:searchFlights", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

/**
 * Public, account-free flight search for the marketing / SEO widget. Takes an
 * opaque per-browser `deviceId` used ONLY for rate limiting (never a user
 * record), so public searches never create users.
 */
export const searchFlightsPublic = action({
  args: {
    deviceId: v.string(),
    input: FLIGHT_SEARCH_INPUT,
  },
  handler: async (ctx, args): Promise<NormalizedFlightSearchResponse> => {
    const device = (args.deviceId || "").trim();
    if (!device) throw new Error("Missing device id");

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: `pub:${device}`, limit: 30, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've searched a lot in a short time. Please wait a few minutes and try again."
      );
    }

    try {
      // Public searches always use the default cache TTL (no override).
      return await _runSearch(ctx, args.input as FlightSearchInput, undefined);
    } catch (err) {
      await reportError(ctx, "flightsSearchApi:searchFlightsPublic", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

/**
 * Server-side search with no auth and no rate limit, for scheduled work such as
 * the route price-alert cron. NOT reachable from a client — internal only.
 *
 * Deliberately skips the per-caller rate limiter: the caller is our own cron,
 * which already bounds its batch size, and throttling it would silently stop
 * fare watches from being checked.
 */
export const internalSearch = internalAction({
  args: { input: FLIGHT_SEARCH_INPUT },
  handler: async (ctx, args): Promise<NormalizedFlightSearchResponse> => {
    return await _runSearch(ctx, args.input as FlightSearchInput, undefined);
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
      } = args.input;
      if (!bookingToken || !bookingToken.trim()) {
        throw new Error("Booking token is required.");
      }

      const cacheKey = `sabooking|${bookingToken}|${(currency ?? "EUR").toUpperCase()}`;

      const cached: NormalizedBookingOptionsResponse | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(`[searchapi] booking-options cache hit`);
        return cached;
      }

      const params = buildSearchApiBookingParams({
        bookingToken,
        currency,
        hl,
        gl,
        departureId,
        arrivalId,
        outboundDate,
        returnDate,
      });

      // Booking options are best-effort. If searchapi rejects the request
      // (e.g. an expired/invalid booking_token, common by the time a user taps
      // through), degrade to an empty provider list so the sheet shows
      // "No providers available" instead of a hard error banner.
      let raw: any;
      try {
        raw = await callSearchApi(params);
      } catch (serpErr) {
        console.warn("[searchapi] booking-options fetch failed; returning empty list");
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

      console.log(`[searchapi] booking-options providers=${bookingOptions.length}`);

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
      await reportError(ctx, "flightsSearchApi:getBookingOptions", err, {
        bookingToken: args.input?.bookingToken?.slice(0, 24),
      });
      throw err;
    }
  },
});

// ========================== enrichTripBooking ===============================

/**
 * Post-creation booking enrichment for trips created from the searchapi.io
 * flight-search screen. `trips.createFromFlight` schedules this immediately
 * (booking tokens are short-lived), passing the token minted by THIS search
 * flow — which is why the enrichment must resolve on searchapi, not SerpApi.
 *
 * Stores the full provider list plus the primary book link(s) on the trip's
 * flight data:
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
      const params = buildSearchApiBookingParams({
        bookingToken: args.bookingToken,
        currency: args.currency,
        gl: glForIata(args.departureId),
        departureId: args.departureId,
        arrivalId: args.arrivalId,
        outboundDate: args.outboundDate,
        returnDate: args.returnDate,
      });

      const raw = await callSearchApi(params);
      const opts: any[] = Array.isArray(raw?.booking_options)
        ? raw.booking_options
        : [];

      const toRequest = (br: any) =>
        br?.url && br?.post_data
          ? { url: String(br.url), postData: String(br.post_data) }
          : undefined;

      // Full provider list (mirrors the in-app booking sheet) so the trip's
      // Flights tab offers the same choice of booking sites. searchapi.io
      // nests split-itinerary legs under `departure`/`arrival` (SerpApi used
      // `departing`/`returning`); non-split options keep the fields top-level.
      const bookingProviders = opts
        .map((o) => {
          const leg = o?.together ?? o?.departure ?? o?.arrival ?? o;
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
          price: Number(o?.together?.price ?? o?.price) || Infinity,
          request: toRequest(o?.together?.booking_request ?? o?.booking_request),
        }))
        .filter((c) => c.request)
        .sort((a, b) => a.price - b.price);

      const separate = opts
        .map((o) => ({
          price:
            (Number(o?.departure?.price) || 0) + (Number(o?.arrival?.price) || 0) ||
            Infinity,
          outbound: toRequest(o?.departure?.booking_request),
          ret: toRequest(o?.arrival?.booking_request),
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
          `[searchapi] trip booking enriched (providers=${bookingProviders.length}, together=${together.length}, separate=${separate.length})`
        );
      }
      return null;
    } catch (err) {
      // Best-effort — never block or fail trip creation over booking links.
      console.error("[searchapi] trip booking enrichment failed");
      await reportError(ctx, "flightsSearchApi:enrichTripBooking", err, {
        tripId: String(args.tripId),
      });
      return null;
    }
  },
});
