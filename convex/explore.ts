"use node";

/**
 * Travel Explore — "Where can I go?" destination discovery.
 *
 * Wraps searchapi.io's `google_travel_explore` engine
 * (`convex/lib/searchApiExplore.ts`). Given a single departure airport it
 * returns a ranked list of reachable destinations with indicative prices.
 *
 * Mirrors the auth + rate-limit + cache shape of
 * `flightsSerpApi.searchFlights`:
 *   - token auth via `authNativeDb.getSessionByToken`
 *   - per-user rate limit via `flightSearchCache.checkRateLimit`
 *   - response cache via `flightSearchCache` (kind:"explore") with a long TTL,
 *     since Explore data moves slowly and this keeps the paid quota tiny.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import { fetchExploreDestinations } from "./lib/searchApiExplore";
import type { ExploreDestination, ExploreQuery } from "../types/flights";

// Explore data is stable over hours — a long cache keeps quota tiny.
const EXPLORE_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function buildCacheKey(q: ExploreQuery): string {
  return [
    "explore",
    q.departureId.trim().toUpperCase(),
    (q.currency || "EUR").toUpperCase(),
    q.travelMode || "all",
    q.interests || "any",
    q.stops || "any",
    q.maxPrice != null ? String(q.maxPrice) : "nomax",
    q.timePeriod || "default",
  ].join("|");
}

export const exploreDestinations = action({
  args: {
    token: v.string(),
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
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }

    const input = args.input as ExploreQuery;
    if (!input.departureId?.trim()) {
      throw new Error("A departure airport is required.");
    }

    // Per-user rate limit — same generous window as flight search, guarding the
    // shared SearchApi quota from abuse.
    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: String(session.userId), limit: 60, windowMs: 15 * 60 * 1000 }
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
        console.log(`[explore] cache hit ${input.departureId}`);
        return cached;
      }

      const destinations = await fetchExploreDestinations(input);
      const result = destinations ?? [];

      console.log(
        `[explore] ${input.departureId} -> ${result.length} destinations`
      );

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
        console.error("[explore] cache write failed");
      }

      return result;
    } catch (err) {
      await reportError(ctx, "explore:exploreDestinations", err, {
        departureId: args.input?.departureId,
      });
      throw err;
    }
  },
});
