"use node";

/**
 * SerpApi-backed Low-Fare Radar.
 *
 * For each destination airport, runs a single SerpApi search per sampled
 * date (or pair of dates for round trips), then picks the cheapest option
 * and grades it against the SerpApi `price_insights.price_level`.
 *
 * Designed to be called from a cron or an on-demand admin/screen action.
 * Keeps API usage bounded:
 *   - sequential (not parallel) requests
 *   - one search per destination by default
 *   - reuses the same cache as the user-facing search
 */

import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type {
  DealScore,
  FlightSearchInput,
  LowFareRadarDeal,
  NormalizedFlightOption,
  NormalizedFlightSearchResponse,
} from "../types/flights";

function dealQualityFromPriceLevel(level?: string | null): DealScore {
  switch ((level || "").toLowerCase()) {
    case "low":
      return "strong_deal";
    case "typical":
      return "normal";
    case "high":
      return "expensive";
    default:
      return "unknown";
  }
}

function pickCheapest(
  result: NormalizedFlightSearchResponse
): NormalizedFlightOption | null {
  const all = [...result.bestFlights, ...result.otherFlights].filter(
    (o) => o.price != null
  );
  if (all.length === 0) return null;
  return all.reduce((min, o) =>
    (o.price ?? Infinity) < (min.price ?? Infinity) ? o : min
  );
}

export const searchLowFareRadarDeals = action({
  args: {
    token: v.string(),
    input: v.object({
      homeAirport: v.string(),
      destinationAirports: v.array(v.string()),
      dateFrom: v.string(),
      dateTo: v.string(),
      selectedDates: v.optional(v.array(v.string())),
      currency: v.optional(v.string()),
      maxPrice: v.optional(v.float64()),
      adults: v.optional(v.float64()),
    }),
  },
  handler: async (ctx, args): Promise<LowFareRadarDeal[]> => {
    if (!args.token) throw new Error("Authentication required");
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      throw new Error("Authentication required");
    }

    const {
      homeAirport,
      destinationAirports,
      dateFrom,
      dateTo,
      selectedDates,
      currency = "EUR",
      maxPrice,
      adults = 1,
    } = args.input;

    if (!homeAirport.trim()) throw new Error("homeAirport is required.");
    if (destinationAirports.length === 0) return [];

    // Pick a small set of dates to bound API usage. We never iterate every
    // date in [dateFrom, dateTo] — that explodes SerpApi quota.
    const datesToTry =
      selectedDates && selectedDates.length > 0
        ? selectedDates.slice(0, 3)
        : [dateFrom, dateTo].filter((d, i, arr) => arr.indexOf(d) === i);

    const deals: LowFareRadarDeal[] = [];

    for (const dest of destinationAirports) {
      let bestSoFar: NormalizedFlightOption | null = null;
      let priceInsights: NormalizedFlightSearchResponse["priceInsights"] = null;

      for (const outboundDate of datesToTry) {
        const searchInput: FlightSearchInput = {
          departureId: homeAirport.toUpperCase(),
          arrivalId: dest.toUpperCase(),
          outboundDate,
          type: "one_way",
          currency,
          adults,
          maxPrice,
        };
        try {
          // Reuse the public auth-gated search action so we get the same
          // normalization, caching, and quota path "for free". Radar uses
          // a 7-day cache TTL — fares move slowly enough at this granularity
          // and we want to keep SerpApi quota bounded.
          const result: NormalizedFlightSearchResponse = await ctx.runAction(
            api.flightsSerpApi.searchFlights,
            {
              token: args.token,
              input: searchInput,
              cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
            }
          );
          const cheapest = pickCheapest(result);
          if (
            cheapest &&
            (!bestSoFar ||
              (cheapest.price ?? Infinity) < (bestSoFar.price ?? Infinity))
          ) {
            bestSoFar = cheapest;
            priceInsights = result.priceInsights ?? priceInsights;
          }
        } catch (err) {
          console.error(
            `[LowFareRadar] failed ${homeAirport}->${dest} ${outboundDate}`
          );
        }
      }

      const quality = dealQualityFromPriceLevel(
        priceInsights?.priceLevel as string | undefined
      );

      // Only surface if low or normal — never promote a fare we know is high.
      if (quality === "expensive") {
        deals.push({
          destinationAirport: dest,
          cheapestPrice: bestSoFar?.price ?? null,
          bestOption: null, // do not promote
          priceLevel: priceInsights?.priceLevel ?? undefined,
          typicalPriceRange: priceInsights?.typicalPriceRange ?? undefined,
          dealQuality: quality,
        });
        continue;
      }

      deals.push({
        destinationAirport: dest,
        cheapestPrice: bestSoFar?.price ?? null,
        bestOption: bestSoFar,
        priceLevel: priceInsights?.priceLevel ?? undefined,
        typicalPriceRange: priceInsights?.typicalPriceRange ?? undefined,
        dealQuality: quality,
      });
    }

    return deals;
  },
});
