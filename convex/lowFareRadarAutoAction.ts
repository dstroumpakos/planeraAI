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
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { reportError } from "./helpers/reportError";
import {
  normalizeFlightOption,
  normalizePriceInsights,
} from "./lib/serpApiFlights";
import { SEARCHAPI_FLIGHTS_ENDPOINT } from "./lib/searchApiFlightSearch";

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

async function callSearchApi(params: URLSearchParams): Promise<any | null> {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || !key.trim()) return null;
  try {
    const res = await fetch(`${SEARCHAPI_FLIGHTS_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${key.trim()}` },
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
    // Which vendor minted `option`'s token — the follow-up return-leg and
    // booking-options calls MUST resolve on the same one (tokens are
    // provider-locked). Defaults to "serpapi" so existing callers are
    // unaffected; the searchapi.io user-search path passes "searchapi".
    provider: v.optional(v.union(v.literal("serpapi"), v.literal("searchapi"))),
    // Admin-seeding pass-throughs (see upsertAutoDealFromSerpApi). Omitted by
    // the opportunistic user-search path, which keeps the AUTO defaults.
    dealTag: v.optional(v.string()),
    persistent: v.optional(v.boolean()),
    originalPrice: v.optional(v.float64()),
    travelMonthFrom: v.optional(v.string()),
    travelMonthTo: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const opt = args.option;
    if (!opt) return null;

    const useSearchApi = args.provider === "searchapi";
    const call = useSearchApi ? callSearchApi : callSerpApi;

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
      // round-trip: SerpApi `type=1` vs searchapi.io `flight_type=round_trip`
      if (useSearchApi) p.append("flight_type", "round_trip");
      else p.append("type", "1");
      p.append("adults", String(adults));
      p.append("departure_token", opt.departureToken);
      const raw = await call(p);
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
    let bookingRequest: { url: string; postData: string } | undefined;
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
        if (useSearchApi) p.append("flight_type", "round_trip");
        else p.append("type", "1");
      } else {
        if (useSearchApi) p.append("flight_type", "one_way");
        else p.append("type", "2");
      }
      p.append("booking_token", bookingToken);
      p.append("currency", currency);
      p.append("hl", "en");
      // searchapi.io's booking endpoint rejects `adults` (the token already
      // encodes passengers); SerpApi's radar path has historically sent it.
      if (!useSearchApi) p.append("adults", String(adults));
      const raw = await call(p);
      if (raw) {
        const rawOpts: any[] = Array.isArray(raw?.booking_options)
          ? raw.booking_options
          : [];

        // A radar row stores ONE `bookingRequest`, so it must book the whole
        // itinerary. Split / separate-ticket options cover a single leg each
        // (searchapi.io nests them under `departure`/`arrival`, SerpApi under
        // `departing`/`returning`) and carry that leg's half-price — so a
        // naive cheapest-first pick always selects them and sends the user to
        // an outbound-only checkout while the card shows the round-trip fare.
        // Only whole-itinerary options qualify: `together` when the vendor
        // nests it, otherwise a flat option with no split legs present.
        const whole = rawOpts
          .map((o: any) => {
            const leg =
              o?.together ??
              (o?.departure || o?.arrival || o?.departing || o?.returning
                ? null
                : o);
            const br = leg?.booking_request;
            if (!br?.url || !br?.post_data) return null;
            return {
              price:
                typeof leg.price === "number" ? leg.price : Number(leg.price),
              extensions: Array.isArray(leg.extensions)
                ? leg.extensions
                : undefined,
              bookingRequest: {
                url: String(br.url),
                postData: String(br.post_data),
              },
            };
          })
          .filter(Boolean) as Array<{
          price: number;
          extensions?: string[];
          bookingRequest: { url: string; postData: string };
        }>;

        // Cheapest provider that books the full trip.
        const pick = whole.length
          ? whole.reduce((m, o) =>
              (o.price || Infinity) < (m.price || Infinity) ? o : m
            )
          : null;

        if (pick) {
          // Capture the POST-based booking_request so the app can resolve it
          // to the real provider URL at click-time (mirrors the regular trip
          // flight booking flow).
          bookingRequest = pick.bookingRequest;
          const bag = parseBaggage(pick.extensions);
          cabinBaggage = bag.cabinBaggage;
          checkedBaggage = bag.checkedBaggage;
          if (totalPrice == null && Number.isFinite(pick.price)) {
            totalPrice = pick.price;
          }
        } else if (rawOpts.length > 0) {
          // Every provider offered split tickets only — keep the Google
          // Flights fallback rather than link to half the trip.
          console.warn(
            `[radar-auto] ${args.origin}->${args.destination}: ${rawOpts.length} booking option(s), none whole-itinerary; using fallback link`
          );
        }
      }
    }

    // Seeded (persistent, admin-curated) deals pre-resolve the Google POST
    // booking_request into the real provider URL — the same link the flight
    // search shows — and store it as `bookingUrl`. The app still re-resolves
    // `bookingRequest` fresh at click-time; this just replaces the Google
    // Flights fallback with a genuine provider link for any consumer (web
    // widget, exports) that reads `bookingUrl` directly.
    if (args.persistent && bookingRequest?.url && bookingRequest?.postData) {
      try {
        const resolved: any = await ctx.runAction(
          api.flightsResolve.resolveBookingUrl,
          { url: bookingRequest.url, postData: bookingRequest.postData }
        );
        if (resolved?.ok && resolved.url) bookingUrl = resolved.url;
      } catch {
        // Keep the Google Flights fallback if resolution fails.
      }
    }

    try {
      const dealId: string | null = await ctx.runMutation(
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
          bookingRequest,
          cabinBaggage,
          checkedBaggage,
          totalPrice,
          adults,
          dealTag: args.dealTag,
          persistent: args.persistent,
          originalPrice: args.originalPrice,
          travelMonthFrom: args.travelMonthFrom,
          travelMonthTo: args.travelMonthTo,
        }
      );
      return dealId ?? null;
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
