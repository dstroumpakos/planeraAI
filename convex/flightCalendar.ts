"use node";

/**
 * Flight price calendar — "cheapest days to fly".
 *
 * Wraps searchapi.io's `google_flights_calendar` engine
 * (`convex/lib/searchApiFlightCalendar.ts`). Given an origin + destination it
 * returns the cheapest round-trip dates over the next ~2 weeks, for the
 * "cheapest days to fly" strip on the destination preview. Logged-in only, and
 * the caller supplies the origin (resolved home airport).
 *
 * Mirrors the auth + rate-limit + cache shape of
 * `exploreDestination.exploreDestinationFlights`. Cache `kind:"calendar"`, 12h
 * TTL; the cache key includes today's date so the rolling window refreshes
 * daily and never surfaces a past departure date.
 *
 * IMPORTANT: prices are indicative teasers, NOT bookable. A tapped date opens
 * the real `google_flights` search prefilled with both legs.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import { fetchFlightCalendar } from "./lib/searchApiFlightCalendar";
import type { FlightCalendar, FlightCalendarQuery } from "../types/flights";

const CALENDAR_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function buildCacheKey(q: FlightCalendarQuery): string {
  const today = new Date().toISOString().split("T")[0];
  return [
    "calendar:v1",
    today, // rolling window → refresh daily
    q.departureId.trim().toUpperCase(),
    q.arrivalId.trim().toUpperCase(),
    (q.currency || "EUR").toUpperCase(),
  ].join("|");
}

export const flightCalendar = action({
  args: {
    token: v.string(),
    input: v.object({
      departureId: v.string(),
      arrivalId: v.string(),
      currency: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<FlightCalendar | null> => {
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }

    const input = args.input as FlightCalendarQuery;
    if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
      // No resolvable origin/destination — the strip hides.
      return null;
    }

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
      const cached: FlightCalendar | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(
          `[calendar] cache hit ${input.departureId}->${input.arrivalId}`
        );
        return cached;
      }

      const result = await fetchFlightCalendar(input);

      console.log(
        `[calendar] ${input.departureId}->${input.arrivalId} -> ${
          result ? result.dates.length : 0
        } dates`
      );

      // Only cache a genuine, non-empty result (fetch returns null on both API
      // failure and empty results, so caching null would pin a failed lookup).
      if (result && result.dates.length > 0) {
        try {
          await ctx.runMutation(internal.flightSearchCache.writeCache, {
            cacheKey,
            kind: "calendar",
            ttlMs: CALENDAR_CACHE_TTL_MS,
            normalizedResults: result,
            departureId: result.departureId,
            arrivalId: result.arrivalId,
            currency: result.currency,
          });
        } catch {
          console.error("[calendar] cache write failed");
        }
      }

      return result;
    } catch (err) {
      await reportError(ctx, "flightCalendar:flightCalendar", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});
