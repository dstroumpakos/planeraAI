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

import { action, internalAction } from "./_generated/server";
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

/**
 * Public, account-free flight price calendar — "cheapest days to fly" — for the
 * marketing/SEO widget and the ChatGPT App (Apps SDK / MCP). Mirrors
 * `flightCalendar` but takes an opaque per-caller `deviceId` used ONLY for rate
 * limiting (never a user record), so public calendar lookups never create users.
 *
 * Same searchapi.io engine, same 12h cache (shared cache key), so public and
 * authenticated lookups warm the same cache. Prices remain indicative teasers.
 */
export const flightCalendarPublic = action({
  args: {
    deviceId: v.string(),
    input: v.object({
      departureId: v.string(),
      arrivalId: v.string(),
      currency: v.optional(v.string()),
    }),
    /**
     * Days from today where the scan starts. Lets the caller target a specific
     * future month (e.g. "October") instead of only the next few weeks.
     */
    startOffsetDays: v.optional(v.float64()),
    /**
     * Party + fare filters. `adults` is a correctness input, not a nicety: the
     * cheapest fare class may not have N seats, so a 1-adult price multiplied
     * by N understates a group trip.
     */
    adults: v.optional(v.float64()),
    children: v.optional(v.float64()),
    travelClass: v.optional(
      v.union(
        v.literal("economy"),
        v.literal("premium_economy"),
        v.literal("business"),
        v.literal("first_class")
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
    carryOnBags: v.optional(v.float64()),
    checkedBags: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<FlightCalendar | null> => {
    const device = (args.deviceId || "").trim();
    if (!device) throw new Error("Missing device id");

    const input = args.input as FlightCalendarQuery;
    if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
      return null;
    }

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: `pub:${device}`, limit: 30, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've looked up a lot of flights in a short time. Please wait a few minutes and try again."
      );
    }

    try {
      // Distinct cache key (`|wide`) so the multi-window public result never
      // collides with the compact single-window teaser under the same route.
      // The start offset is part of the key: a scan of October must not serve
      // a cached scan of August.
      // `|r1` marks the payload shape that carries per-departure return options.
      // Bumping it retires entries cached before the two-leg picker existed,
      // which would otherwise serve a calendar the widget cannot page a return
      // leg from for up to 12h after deploy.
      const startOffset = args.startOffsetDays ?? 0;
      // Filters change the fares, so they MUST be part of the key — otherwise a
      // business-class or 3-adult scan would serve (and poison) the economy
      // single-adult entry for the same route.
      const filterKey = [
        args.adults && args.adults > 1 ? `a${args.adults}` : "",
        args.children ? `c${args.children}` : "",
        args.travelClass && args.travelClass !== "economy" ? args.travelClass : "",
        args.stops && args.stops !== "any" ? args.stops : "",
        args.carryOnBags ? `cb${args.carryOnBags}` : "",
        args.checkedBags ? `kb${args.checkedBags}` : "",
      ]
        .filter(Boolean)
        .join(",");
      const cacheKey =
        `${buildCacheKey(input)}|wide|off${Math.round(startOffset)}|r1` +
        (filterKey ? `|f:${filterKey}` : "");
      const cached: FlightCalendar | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(
          `[calendar] public cache hit ${input.departureId}->${input.arrivalId}`
        );
        return cached;
      }

      // Scan ~6 weeks (3 stacked windows) so ChatGPT can show many more dates
      // than the mobile strip. 3 windows = 3 searchapi calls on a cache miss.
      const result = await fetchFlightCalendar(input, {
        windows: 3,
        maxDates: 60,
        startOffsetDays: args.startOffsetDays,
        // Public callers (ChatGPT app, marketing widget) render a two-leg
        // picker, so they need every return option per departure.
        includeReturns: true,
        adults: args.adults,
        children: args.children,
        travelClass: args.travelClass,
        stops: args.stops,
        carryOnBags: args.carryOnBags,
        checkedBags: args.checkedBags,
      });

      console.log(
        `[calendar] public ${input.departureId}->${input.arrivalId} -> ${
          result ? result.dates.length : 0
        } dates`
      );

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
          console.error("[calendar] public cache write failed");
        }
      }

      return result;
    } catch (err) {
      await reportError(ctx, "flightCalendar:flightCalendarPublic", err, {
        departureId: args.input?.departureId,
        arrivalId: args.input?.arrivalId,
      });
      throw err;
    }
  },
});

/**
 * Cheapest-fare lookup for a flexible-date price watch (see
 * `routePriceAlerts.ts`). Internal and unauthenticated by design: the caller is
 * our own cron, which already bounds how many watches it prices per tick.
 *
 * Uses the single-window scan — a watch only needs the cheapest fare in the
 * near window, not the wide multi-window grid the ChatGPT calendar renders.
 */
export const fetchForWatch = internalAction({
  args: {
    departureId: v.string(),
    arrivalId: v.string(),
    currency: v.string(),
    adults: v.optional(v.float64()),
  },
  handler: async (_ctx, args): Promise<FlightCalendar | null> => {
    return await fetchFlightCalendar(
      {
        departureId: args.departureId,
        arrivalId: args.arrivalId,
        currency: args.currency,
      },
      { adults: args.adults }
    );
  },
});
