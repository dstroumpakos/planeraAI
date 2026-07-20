"use node";

/**
 * Travel Explore — single-destination flight teaser.
 *
 * Wraps searchapi.io's `google_travel_explore_destination` engine
 * (`convex/lib/searchApiExploreDestination.ts`). Given an origin + one
 * destination it returns indicative flight options for that route — the data
 * behind the "Flights from your city, from €X" module on a destination preview
 * page.
 *
 * Only meaningful for a logged-in user whose origin (home airport) we can
 * resolve; the caller passes that as `departureId`. With no origin there is
 * nothing to show, so the module simply hides.
 *
 * Mirrors the auth + rate-limit + cache shape of `explore.exploreDestinations`:
 *   - token auth via `authNativeDb.getSessionByToken`
 *   - per-user rate limit via `flightSearchCache.checkRateLimit`
 *   - response cache via `flightSearchCache` (kind:"explore_destination").
 *
 * The cache key includes the ORIGIN, so it is per (origin × destination ×
 * params) — lower hit rate than the origin-agnostic discovery grid, but bounded
 * because logged-in users cluster on a handful of home airports. TTL is shorter
 * than the discovery grid's since a single route's price moves faster.
 *
 * IMPORTANT: prices are indicative teasers, NOT bookable. The "See flights" CTA
 * must re-run the real `google_flights` search for a provider-locked
 * `booking_token`.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import { fetchExploreDestinationFlights } from "./lib/searchApiExploreDestination";
import { exploreDestCacheKey as buildCacheKey } from "./lib/searchCacheKeys";
import type {
  ExploreDestinationFlights,
  ExploreDestinationFlightsQuery,
} from "../types/flights";

// A single route's fares move faster than the whole discovery grid, but still
// slowly enough that a few hours keeps the paid quota small.
const EXPLORE_DEST_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export const exploreDestinationFlights = action({
  args: {
    token: v.string(),
    input: v.object({
      departureId: v.string(),
      arrivalId: v.string(),
      currency: v.optional(v.string()),
      hl: v.optional(v.string()),
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
      maxPrice: v.optional(v.float64()),
      adults: v.optional(v.float64()),
      timePeriod: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<ExploreDestinationFlights | null> => {
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }

    const input = args.input as ExploreDestinationFlightsQuery;
    if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
      // No resolvable origin (or destination) — the module hides rather than
      // guessing an origin, so surface a null result, not an error.
      return null;
    }

    // Per-user rate limit — shares the same window/counter as the other
    // SearchApi-backed user actions, guarding the paid quota.
    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: String(session.userId), limit: 60, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've looked up a lot of flights in a short time. Please wait a few minutes and try again."
      );
    }

    try {
      const cacheKey = buildCacheKey(input);
      const cached: ExploreDestinationFlights | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(
          `[explore-dest] cache hit ${input.departureId}->${input.arrivalId}`
        );
        return cached;
      }

      const result = await fetchExploreDestinationFlights(input);

      console.log(
        `[explore-dest] ${input.departureId}->${input.arrivalId} -> ${
          result ? result.flights.length : 0
        } options`
      );

      // Only cache a genuine, non-empty result. `fetch...` returns null on both
      // API failure AND empty results, so caching null would pin a failed
      // lookup for the full TTL (the bug the sibling explore action guards).
      if (result && result.flights.length > 0) {
        try {
          await ctx.runMutation(internal.flightSearchCache.writeCache, {
            cacheKey,
            kind: "explore_destination",
            ttlMs: EXPLORE_DEST_CACHE_TTL_MS,
            normalizedResults: result,
            departureId: result.departureId,
            arrivalId: result.arrivalId,
            currency: result.currency,
          });
        } catch {
          console.error("[explore-dest] cache write failed");
        }
      }

      return result;
    } catch (err) {
      await reportError(ctx, "exploreDestination:exploreDestinationFlights", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

/**
 * Cache-backed teaser fetch for the newsletter's route block ("Flights to
 * Lisbon — from €X"). Internal and unauthenticated by design: the caller is
 * our own campaign fan-out, once per send batch. Shares the cache (and cache
 * key) with the in-app and public teaser callers, so a popular route is
 * usually a pure hit.
 */
export const fetchTeaserForCampaign = internalAction({
  args: {
    departureId: v.string(),
    arrivalId: v.string(),
    currency: v.optional(v.string()),
    hl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExploreDestinationFlights | null> => {
    const input: ExploreDestinationFlightsQuery = {
      departureId: args.departureId,
      arrivalId: args.arrivalId,
      currency: args.currency,
      hl: args.hl,
    };
    if (!input.departureId?.trim() || !input.arrivalId?.trim()) return null;

    try {
      const cacheKey = buildCacheKey(input);
      const cached: ExploreDestinationFlights | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) return cached;

      const result = await fetchExploreDestinationFlights(input);
      if (result && result.flights.length > 0) {
        try {
          await ctx.runMutation(internal.flightSearchCache.writeCache, {
            cacheKey,
            kind: "explore_destination",
            ttlMs: EXPLORE_DEST_CACHE_TTL_MS,
            normalizedResults: result,
            departureId: result.departureId,
            arrivalId: result.arrivalId,
            currency: result.currency,
          });
        } catch {
          console.error("[explore-dest] campaign cache write failed");
        }
      }
      return result;
    } catch (err) {
      // A missing teaser must never fail a newsletter send — report and omit.
      await reportError(ctx, "exploreDestination:fetchTeaserForCampaign", err, {
        departureId: args.departureId,
        arrivalId: args.arrivalId,
      });
      return null;
    }
  },
});
