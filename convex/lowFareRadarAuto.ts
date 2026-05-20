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

    const firstSeg = Array.isArray(opt.flights) ? opt.flights[0] : null;
    const lastSeg = Array.isArray(opt.flights)
      ? opt.flights[opt.flights.length - 1]
      : null;
    if (!firstSeg || !lastSeg) return null;

    const stops = Math.max(0, (opt.flights?.length ?? 1) - 1);

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
      returnDate: args.returnDate,
      price: Number(opt.price),
      currency: args.currency.toUpperCase(),
      dealTag: "AUTO" as const,
      active: true,
      expiresAt: now + AUTO_DEAL_TTL_MS,
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
