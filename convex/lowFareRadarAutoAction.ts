"use node";

/**
 * Background enrichment for Low-Fare Radar auto-seeded deals.
 *
 * The user-facing `searchFlights` action schedules this internal action
 * fire-and-forget. It performs up to two follow-up SerpApi calls per
 * seeded route (extra quota cost, but only for routes that don't already
 * have a deal):
 *
 *   1. If round-trip and the cheapest outbound has a `departure_token`,
 *      call SerpApi again to fetch return options. Cheapest return wins.
 *   2. Take the resulting `booking_token` (one-way: from cheapest option,
 *      round-trip: from cheapest return option) and call booking options
 *      to grab provider URL + baggage info from `extensions[]`.
 *
 * If any step fails or the API returns nothing useful, we fall back to
 * the outbound-only data we already have. Errors are swallowed — this is
 * best-effort background work.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  normalizeBookingOption,
  normalizeFlightOption,
  normalizePriceInsights,
} from "./lib/serpApiFlights";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

function getSerpApiKey(): string | null {
  const key = process.env.SERPAPI_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) return null;
  return key;
}

async function callSerpApi(params: URLSearchParams): Promise<any | null> {
  const key = getSerpApiKey();
  if (!key) return null;
  params.append("api_key", key);
  try {
    const res = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Pull a baggage hint out of the booking option's `extensions[]` array.
 * SerpApi surfaces strings like:
 *   "Carry-on bag included"
 *   "1 checked bag included"
 *   "Carry-on bag for a fee"
 * We do a light-touch regex match — anything fancier needs the
 * `baggage_prices` array which has a different shape per provider.
 */
function parseBaggage(extensions: string[] | undefined): {
  cabinBaggage?: string;
  checkedBaggage?: string;
} {
  if (!Array.isArray(extensions)) return {};
  const result: { cabinBaggage?: string; checkedBaggage?: string } = {};
  for (const ext of extensions) {
    if (typeof ext !== "string") continue;
    const lower = ext.toLowerCase();
    if (!result.cabinBaggage && /carry[- ]?on|cabin/.test(lower)) {
      result.cabinBaggage = ext;
    }
    if (!result.checkedBaggage && /checked/.test(lower)) {
      result.checkedBaggage = ext;
    }
  }
  return result;
}

export const enrichAndSeedDeal = internalAction({
  args: {
    origin: v.string(),
    destination: v.string(),
    outboundDate: v.string(),
    returnDate: v.optional(v.string()),
    currency: v.string(),
    priceLevel: v.optional(v.string()),
    option: v.any(),
    adults: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<null> => {
    const opt = args.option;
    if (!opt) return null;

    // SerpApi semantics: when `adults=N` is passed, returned `price` is the
    // total for all N passengers, not per-person. We track adults so we
    // can store per-person and total correctly downstream.
    const adults = typeof args.adults === "number" && args.adults > 0 ? args.adults : 1;
    const currency = args.currency.toUpperCase();
    let returnOption: any = null;
    let bookingToken: string | null = opt.bookingToken ?? null;
    let totalPrice: number | undefined = undefined;

    // Step 1 — round-trip return-leg fetch.
    if (args.returnDate && opt.departureToken) {
      const p = new URLSearchParams();
      p.append("engine", "google_flights");
      p.append("departure_id", args.origin);
      p.append("arrival_id", args.destination);
      p.append("outbound_date", args.outboundDate);
      p.append("return_date", args.returnDate);
      p.append("currency", currency);
      p.append("hl", "en");
      p.append("type", "1"); // round-trip
      p.append("adults", String(adults));
      p.append("departure_token", opt.departureToken);
      const raw = await callSerpApi(p);
      if (raw) {
        const priceInsights = normalizePriceInsights(raw?.price_insights);
        const all: any[] = [
          ...(Array.isArray(raw?.best_flights)
            ? raw.best_flights.map((o: any, i: number) =>
                normalizeFlightOption(o, "best_flights", i, priceInsights)
              )
            : []),
          ...(Array.isArray(raw?.other_flights)
            ? raw.other_flights.map((o: any, i: number) =>
                normalizeFlightOption(o, "other_flights", i, priceInsights)
              )
            : []),
        ].filter((o) => o.price != null);
        if (all.length) {
          returnOption = all.reduce((m, o) =>
            (o.price ?? Infinity) < (m.price ?? Infinity) ? o : m
          );
          if (returnOption.bookingToken) {
            bookingToken = returnOption.bookingToken;
            totalPrice = Number(returnOption.price);
          }
        }
      }
    }

    // Step 2 — booking options fetch (URL + baggage).
    let bookingUrl: string | undefined;
    let cabinBaggage: string | undefined;
    let checkedBaggage: string | undefined;
    if (bookingToken) {
      // SerpApi's booking_options endpoint needs the full route + dates
      // alongside the token. Passing only `booking_token` returns an
      // error.
      const p = new URLSearchParams();
      p.append("engine", "google_flights");
      p.append("departure_id", args.origin);
      p.append("arrival_id", args.destination);
      p.append("outbound_date", args.outboundDate);
      if (args.returnDate) {
        p.append("return_date", args.returnDate);
        p.append("type", "1");
      } else {
        p.append("type", "2");
      }
      p.append("booking_token", bookingToken);
      p.append("currency", currency);
      p.append("hl", "en");
      p.append("adults", String(adults));
      const raw = await callSerpApi(p);
      if (raw) {
        const opts = Array.isArray(raw?.booking_options)
          ? raw.booking_options.map((o: any, i: number) =>
              normalizeBookingOption(o, i)
            )
          : [];
        // Pick the cheapest provider that has a URL.
        const withUrl = opts.filter((o: any) => o?.bookingRequest?.url);
        const pick =
          withUrl.length > 0
            ? withUrl.reduce((m: any, o: any) =>
                (o.price ?? Infinity) < (m.price ?? Infinity) ? o : m
              )
            : opts[0];
        if (pick) {
          // Do NOT use pick.bookingRequest.url — it's a POST endpoint
          // requiring form data. The mutation falls back to a Google
          // Flights `#flt=` deep-link which always opens correctly.
          const bag = parseBaggage(pick.extensions);
          cabinBaggage = bag.cabinBaggage;
          checkedBaggage = bag.checkedBaggage;
          if (totalPrice == null && pick.price != null) {
            totalPrice = Number(pick.price);
          }
        }
      }
    }

    try {
      await ctx.runMutation(
        internal.lowFareRadarAuto.upsertAutoDealFromSerpApi,
        {
          origin: args.origin,
          destination: args.destination,
          outboundDate: args.outboundDate,
          returnDate: args.returnDate,
          currency,
          priceLevel: args.priceLevel,
          option: opt,
          returnOption: returnOption ?? undefined,
          bookingUrl,
          cabinBaggage,
          checkedBaggage,
          totalPrice,
          adults,
        }
      );
    } catch (err) {
      console.error("[radar-auto] enrich+seed failed");
      await reportError(ctx, "lowFareRadarAutoAction:enrichAndSeedDeal", err, {
        origin: args.origin,
        destination: args.destination,
      });
    }

    return null;
  },
});
