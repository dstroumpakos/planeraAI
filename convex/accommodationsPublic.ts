"use node";

/**
 * Public, account-free accommodation search (hotels + Airbnb).
 *
 * Wraps `lib/searchApiAccommodations.fetchAccommodations` — the same engines
 * (`google_hotels` + `airbnb`) that enrich authenticated trip generation in
 * `tripsActions.ts` — and exposes them for the marketing/SEO surfaces and the
 * ChatGPT App (Apps SDK / MCP), where there is no user session.
 *
 * Takes an opaque per-caller `deviceId` used ONLY for rate limiting (never a
 * user record), so public searches never create users. Results are cached for
 * 6h keyed on destination + dates + guests, since nightly rates move slowly and
 * each miss costs two searchapi calls.
 *
 * The API key never crosses the frontend boundary and is never logged.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  fetchAccommodations,
  type Accommodation,
} from "./lib/searchApiAccommodations";

const ACCOMMODATIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function buildCacheKey(input: {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  currency?: string;
}): string {
  return [
    "accom:v1",
    input.destination.trim().toLowerCase(),
    input.checkInDate,
    input.checkOutDate,
    String(input.adults),
    (input.currency || "EUR").toUpperCase(),
  ].join("|");
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export const accommodationsPublic = action({
  args: {
    deviceId: v.string(),
    input: v.object({
      destination: v.string(),
      checkInDate: v.string(), // YYYY-MM-DD
      checkOutDate: v.string(), // YYYY-MM-DD
      adults: v.optional(v.float64()),
      currency: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Accommodation[]> => {
    const device = (args.deviceId || "").trim();
    if (!device) throw new Error("Missing device id");

    const destination = args.input.destination?.trim();
    if (!destination) return [];
    if (!args.input.checkInDate || !args.input.checkOutDate) return [];

    const adults = Math.min(Math.max(args.input.adults ?? 1, 1), 16);
    const currency = (args.input.currency || "EUR").toUpperCase();

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: `pub:${device}`, limit: 30, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) {
      throw new Error(
        "You've searched a lot in a short time. Please wait a few minutes and try again."
      );
    }

    const cacheKey = buildCacheKey({
      destination,
      checkInDate: args.input.checkInDate,
      checkOutDate: args.input.checkOutDate,
      adults,
      currency,
    });

    try {
      const cached: Accommodation[] | null = await ctx.runQuery(
        internal.flightSearchCache.readCache,
        { cacheKey }
      );
      if (cached) {
        console.log(`[accom] public cache hit ${destination}`);
        return cached;
      }

      const results = await fetchAccommodations({
        destination,
        checkInDate: args.input.checkInDate,
        checkOutDate: args.input.checkOutDate,
        adults,
        currency,
        nights: nightsBetween(args.input.checkInDate, args.input.checkOutDate),
      });

      console.log(`[accom] public ${destination} -> ${results.length} stays`);

      // Only cache a genuine, non-empty result (an empty array is also what a
      // failed lookup returns, so caching it would pin the failure for 6h).
      if (results.length > 0) {
        try {
          await ctx.runMutation(internal.flightSearchCache.writeCache, {
            cacheKey,
            kind: "accommodations",
            ttlMs: ACCOMMODATIONS_CACHE_TTL_MS,
            normalizedResults: results,
            currency,
          });
        } catch {
          console.error("[accom] public cache write failed");
        }
      }

      return results;
    } catch (err) {
      await reportError(ctx, "accommodationsPublic:accommodationsPublic", err, {
        destination,
      });
      throw err;
    }
  },
});
