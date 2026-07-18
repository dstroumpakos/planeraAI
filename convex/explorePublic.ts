"use node";

/**
 * Public, account-free "where can I go?" destination discovery.
 *
 * Account-free mirror of `explore.exploreDestinations` for the ChatGPT App
 * (Apps SDK / MCP), where there is no user session — same searchapi.io
 * `google_travel_explore` engine, same cache key and TTL, so public and
 * authenticated callers share cache entries and the paid quota stays flat.
 *
 * Takes an opaque per-caller `deviceId` used ONLY for rate limiting (never a
 * user record), matching `flightsSearchApi.searchFlightsPublic` and
 * `accommodationsPublic.accommodationsPublic`.
 *
 * IMPORTANT: prices are indicative teasers, NOT bookable. Booking needs a real
 * `google_flights` search for a provider-locked `booking_token`.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import { fetchExploreDestinations, normalizeHl } from "./lib/searchApiExplore";
import type { ExploreDestination, ExploreQuery } from "../types/flights";

// Must stay identical to `explore.ts` so both callers share cache entries.
const EXPLORE_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Keep in lockstep with `explore.ts` — including the version tag. If these
// diverge the two callers silently stop sharing entries and the paid quota
// roughly doubles.
function buildCacheKey(q: ExploreQuery): string {
  return [
    "explore:v3",
    q.departureId.trim().toUpperCase(),
    (q.currency || "EUR").toUpperCase(),
    normalizeHl(q.hl),
    q.travelMode || "all",
    q.interests || "any",
    q.stops || "any",
    q.maxPrice != null ? String(q.maxPrice) : "nomax",
    q.timePeriod || "default",
  ].join("|");
}

export const exploreDestinationsPublic = action({
  args: {
    deviceId: v.string(),
    input: v.object({
      departureId: v.string(),
      currency: v.optional(v.string()),
      hl: v.optional(v.string()),
      gl: v.optional(v.string()),
      travelMode: v.optional(
        v.union(v.literal("all"), v.literal("flights_only"))
      ),
      interests: v.optional(
        v.union(
          v.literal("popular"),
          v.literal("outdoors"),
          v.literal("beaches"),
          v.literal("museums"),
          v.literal("history"),
          v.literal("skiing")
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
  handler: async (ctx, args): Promise<ExploreDestination[]> => {
    const device = (args.deviceId || "").trim();
    if (!device) throw new Error("Missing device id");

    const input = args.input as ExploreQuery;
    if (!input.departureId?.trim()) {
      throw new Error("A departure airport is required.");
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
      const cached: ExploreDestination[] | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(`[explore] public cache hit ${input.departureId}`);
        return cached;
      }

      const destinations = await fetchExploreDestinations(input);
      const result = destinations ?? [];

      console.log(
        `[explore] public ${input.departureId} -> ${result.length} destinations`
      );

      // Only cache a genuine, non-empty result — `fetchExploreDestinations`
      // returns null for both API failure and empty results, so caching an
      // empty array would pin a failed lookup for the full TTL.
      if (result.length > 0) {
        try {
          await ctx.runMutation(internal.flightSearchCache.writeCache, {
            cacheKey,
            kind: "explore",
            ttlMs: EXPLORE_CACHE_TTL_MS,
            normalizedResults: result,
            departureId: input.departureId.trim().toUpperCase(),
            currency: (input.currency ?? "EUR").toUpperCase(),
          });
        } catch {
          console.error("[explore] public cache write failed");
        }
      }

      return result;
    } catch (err) {
      await reportError(ctx, "explorePublic:exploreDestinationsPublic", err, {
        departureId: args.input?.departureId,
      });
      throw err;
    }
  },
});
