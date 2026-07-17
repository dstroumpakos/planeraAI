/**
 * Opportunistic Low-Fare Radar seeding.
 *
 * When a user-facing SerpApi flight search returns a result that we don't
 * already have a curated/admin deal for, we cache the cheapest leg into the
 * `lowFareRadar` table so other users see *something* for that destination
 * the next time the home page loads. Admin-curated deals always take
 * precedence — we never overwrite them.
 *
 * Rules (must match the Low-Fare Radar compliance copy):
 *   - Only seed when SerpApi `price_level` is "low" or "typical".
 *   - Never seed when `price_level` is "high".
 *   - Mark the row with `dealTag: "AUTO"` so admin can distinguish.
 *   - Set a short `expiresAt` (7 days) so stale auto-deals age out.
 *   - Skip if a non-expired deal already exists for the same origin+destination.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { AIRPORTS } from "../lib/airports";

const AUTO_DEAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cityForIata(code: string): string {
  const upper = code.toUpperCase();
  const hit = AIRPORTS.find((a) => a.code === upper);
  return hit?.city ?? upper;
}

function timeOnly(iso?: string | null): string {
  // SerpApi format: "2024-06-10 08:00". Fall back to the raw string.
  if (!iso) return "";
  const parts = iso.split(" ");
  return parts[1] ?? iso;
}

function minutesToHm(mins?: number | null): string | undefined {
  if (mins == null) return undefined;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export const upsertAutoDealFromSerpApi = internalMutation({
  args: {
    origin: v.string(),
    destination: v.string(),
    outboundDate: v.string(),
    returnDate: v.optional(v.string()),
    currency: v.string(),
    priceLevel: v.optional(v.string()),
    // Cheapest normalized flight option (any-shaped so we don't bind tightly
    // to types/flights.ts inside Convex validators).
    option: v.any(),
    // Optional enrichment data from follow-up SerpApi calls.
    returnOption: v.optional(v.any()),
    bookingUrl: v.optional(v.string()),
    bookingRequest: v.optional(v.object({
      url: v.string(),
      postData: v.string(),
    })),
    cabinBaggage: v.optional(v.string()),
    checkedBaggage: v.optional(v.string()),
    totalPrice: v.optional(v.float64()),
    adults: v.optional(v.float64()),
    // Admin-seeding overrides. Defaults preserve the opportunistic AUTO
    // behavior (7-day TTL, "AUTO" tag). The admin batch seeder passes
    // `dealTag:"SEEDED"` + `persistent:true` so filled-airport deals behave
    // like curated ones: no auto-expiry, and re-priced by the refresh cron
    // (which only touches `dealTag !== "AUTO"` rows).
    dealTag: v.optional(v.string()),
    persistent: v.optional(v.boolean()),
    // Extra curated fields the admin seeder derives (typical price → a real
    // strike-through "was" price, and the travel-month window from the dates).
    originalPrice: v.optional(v.float64()),
    travelMonthFrom: v.optional(v.string()),
    travelMonthTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const level = (args.priceLevel || "").toLowerCase();
    if (level === "high") return null; // never promote high fares
    const opt = args.option;
    if (!opt || opt.price == null) return null;

    const origin = args.origin.toUpperCase();
    const destination = args.destination.toUpperCase();

    // Don't overwrite curated deals. If any active, non-expired,
    // non-deleted deal exists for this O&D, leave it alone.
    const now = Date.now();
    const existing = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_origin_destination", (q) =>
        q.eq("origin", origin).eq("destination", destination)
      )
      .collect();

    const liveExisting = existing.filter(
      (d) =>
        d.active &&
        !d.deletedAt &&
        (!d.expiresAt || d.expiresAt > now)
    );

    // If there's a curated (non-AUTO) live deal, never touch it.
    const hasCurated = liveExisting.some((d) => d.dealTag !== "AUTO");
    if (hasCurated) return null;


    // Outbound segments (SerpApi `searchFlights` returns the outbound only
    // in a round-trip query; return-leg detail requires a follow-up call
    // with `departure_token` which we skip to keep quota low.)
    const outboundSegments = Array.isArray(opt.flights)
      ? opt.flights.map((seg: any) => ({
          airline: seg.airline ?? "",
          flightNumber: seg.flightNumber ?? undefined,
          departureAirport: seg.departureAirport?.id ?? "",
          departureTime: timeOnly(seg.departureAirport?.time),
          arrivalAirport: seg.arrivalAirport?.id ?? "",
          arrivalTime: timeOnly(seg.arrivalAirport?.time),
          duration: minutesToHm(seg.durationMinutes),
        }))
      : undefined;

    // Surface layover + emissions detail as human-readable notes since the
    // schema has no dedicated columns for them.
    const noteParts: string[] = [];
    if (Array.isArray(opt.layovers) && opt.layovers.length > 0) {
      const layoverText = opt.layovers
        .map((l: any) => {
          const dur = minutesToHm(l.durationMinutes);
          const overnight = l.overnight ? " (overnight)" : "";
          return `${l.id ?? l.name ?? "?"} ${dur ?? ""}${overnight}`.trim();
        })
        .join(", ");
      noteParts.push(`Layovers: ${layoverText}`);
    }
    if (opt.carbonEmissions?.thisFlight != null) {
      const diff = opt.carbonEmissions.differencePercent;
      const diffText =
        diff != null ? ` (${diff > 0 ? "+" : ""}${diff}% vs typical)` : "";
      noteParts.push(
        `CO₂: ${Math.round(opt.carbonEmissions.thisFlight / 1000)}kg${diffText}`
      );
    }
    const notes = noteParts.length > 0 ? noteParts.join(" • ") : undefined;

    const firstSeg = Array.isArray(opt.flights) ? opt.flights[0] : null;
    const lastSeg = Array.isArray(opt.flights)
      ? opt.flights[opt.flights.length - 1]
      : null;
    if (!firstSeg || !lastSeg) return null;

    const stops = Math.max(0, (opt.flights?.length ?? 1) - 1);

    // Return leg (if SerpApi `departure_token` follow-up was made).
    const ret = args.returnOption;
    const retSegs = ret && Array.isArray(ret.flights) ? ret.flights : null;
    const returnSegments = retSegs
      ? retSegs.map((seg: any) => ({
          airline: seg.airline ?? "",
          flightNumber: seg.flightNumber ?? undefined,
          departureAirport: seg.departureAirport?.id ?? "",
          departureTime: timeOnly(seg.departureAirport?.time),
          arrivalAirport: seg.arrivalAirport?.id ?? "",
          arrivalTime: timeOnly(seg.arrivalAirport?.time),
          duration: minutesToHm(seg.durationMinutes),
        }))
      : undefined;
    const retFirst = retSegs?.[0] ?? null;
    const retLast = retSegs ? retSegs[retSegs.length - 1] : null;

    const payload = {
      origin,
      originCity: cityForIata(origin),
      destination,
      destinationCity: cityForIata(destination),
      airline: firstSeg.airline ?? "Multiple",
      airlineLogo: opt.airlineLogo ?? firstSeg.airlineLogo ?? undefined,
      flightNumber: firstSeg.flightNumber ?? undefined,
      outboundDate: args.outboundDate,
      outboundDeparture: timeOnly(firstSeg.departureAirport?.time),
      outboundArrival: timeOnly(lastSeg.arrivalAirport?.time),
      outboundDuration: minutesToHm(opt.totalDurationMinutes),
      outboundStops: stops,
      outboundSegments,
      returnDate: args.returnDate,
      returnDeparture: retFirst ? timeOnly(retFirst.departureAirport?.time) : undefined,
      returnArrival: retLast ? timeOnly(retLast.arrivalAirport?.time) : undefined,
      returnDuration: ret ? minutesToHm(ret.totalDurationMinutes) : undefined,
      returnAirline: retFirst?.airline ?? undefined,
      returnFlightNumber: retFirst?.flightNumber ?? undefined,
      returnStops: retSegs ? Math.max(0, retSegs.length - 1) : undefined,
      returnSegments,
      // SerpApi returns prices as the TOTAL for the `adults` count passed
      // to the search. Divide to get a true per-person figure for the
      // radar card (which labels it "/pp"), and store the original as
      // `totalPrice`.
      price: Math.round(Number(opt.price) / Math.max(1, args.adults ?? 1)),
      totalPrice: args.totalPrice ?? Number(opt.price),
      // Route's typical price (per-person) so the card can strike it through and
      // show a genuine "-X%" saving. Undefined when there's no real gap.
      originalPrice: args.originalPrice,
      currency: args.currency.toUpperCase(),
      travelMonthFrom: args.travelMonthFrom,
      travelMonthTo: args.travelMonthTo,
      cabinBaggage: args.cabinBaggage,
      checkedBaggage: args.checkedBaggage,
      // Always provide a booking link. Fall back to a Google Flights
      // deep-link that lands directly on the results page (legacy
      // `#flt=` hash format), so the deal card "Book" CTA never
      // dead-ends.
      bookingUrl:
        args.bookingUrl ||
        (args.returnDate
          ? `https://www.google.com/travel/flights?hl=en&curr=${args.currency.toUpperCase()}#flt=${origin}.${destination}.${args.outboundDate}*${destination}.${origin}.${args.returnDate};c:${args.currency.toUpperCase()};e:1;sd:1;t:f`
          : `https://www.google.com/travel/flights?hl=en&curr=${args.currency.toUpperCase()}#flt=${origin}.${destination}.${args.outboundDate};c:${args.currency.toUpperCase()};e:1;sd:1;t:o`),
      bookingRequest: args.bookingRequest,
      notes,
      dealTag: args.dealTag ?? ("AUTO" as const),
      active: true,
      // Persistent (admin-seeded) deals never auto-expire; opportunistic AUTO
      // deals age out after the TTL.
      expiresAt: args.persistent ? undefined : now + AUTO_DEAL_TTL_MS,
      createdAt: now,
    };

    // Refresh an existing AUTO row (cheaper price wins; otherwise just
    // bump expiresAt so it doesn't drift out).
    const existingAuto = liveExisting.find((d) => d.dealTag === "AUTO");
    if (existingAuto) {
      const cheaper = payload.price < existingAuto.price;
      await ctx.db.patch(existingAuto._id, {
        ...(cheaper ? payload : { expiresAt: payload.expiresAt }),
        updatedAt: now,
      });
      return existingAuto._id;
    }

    return await ctx.db.insert("lowFareRadar", payload);
  },
});
