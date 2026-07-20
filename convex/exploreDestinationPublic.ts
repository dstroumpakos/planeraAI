"use node";

/**
 * Public, account-free single-destination flight teaser.
 *
 * Account-free mirror of `exploreDestination.exploreDestinationFlights` for the
 * ChatGPT App (Apps SDK / MCP), where there is no user session — same
 * searchapi.io `google_travel_explore_destination` engine, same cache key and
 * TTL, so public and authenticated callers share cache entries and the paid
 * quota stays flat.
 *
 * Takes an opaque per-caller `deviceId` used ONLY for rate limiting (never a
 * user record), matching `explorePublic.exploreDestinationsPublic` and
 * `flightsSearchApi.searchFlightsPublic`.
 *
 * IMPORTANT: prices are indicative teasers, NOT bookable. The "See flights" CTA
 * must re-run the real `google_flights` search for a provider-locked
 * `booking_token`.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import { fetchExploreDestinationFlights } from "./lib/searchApiExploreDestination";
import { exploreDestCacheKey as buildCacheKey } from "./lib/searchCacheKeys";
import type {
  ExploreDestinationFlights,
  ExploreDestinationFlightsQuery,
} from "../types/flights";

// Must stay identical to `exploreDestination.ts` so both callers share entries.
const EXPLORE_DEST_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export const exploreDestinationFlightsPublic = action({
  args: {
    deviceId: v.string(),
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
    const device = (args.deviceId || "").trim();
    if (!device) throw new Error("Missing device id");

    const input = args.input as ExploreDestinationFlightsQuery;
    if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
      // No resolvable origin (or destination) — the caller hides the module
      // rather than guessing, so surface a null result, not an error.
      return null;
    }

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: `pub:${device}`, limit: 30, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've explored a lot in a short time. Please wait a few minutes and try again."
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
          `[explore-dest] public cache hit ${input.departureId}->${input.arrivalId}`
        );
        return cached;
      }

      const result = await fetchExploreDestinationFlights(input);

      console.log(
        `[explore-dest] public ${input.departureId}->${input.arrivalId} -> ${
          result ? result.flights.length : 0
        } options`
      );

      // Only cache a genuine, non-empty result. `fetch...` returns null on both
      // API failure AND empty results, so caching null would pin a failed
      // lookup for the full TTL.
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
          console.error("[explore-dest] public cache write failed");
        }
      }

      return result;
    } catch (err) {
      await reportError(
        ctx,
        "exploreDestinationPublic:exploreDestinationFlightsPublic",
        err,
        {
          departureId: args.input?.departureId,
          arrivalId: args.input?.arrivalId,
        }
      );
      throw err;
    }
  },
});
