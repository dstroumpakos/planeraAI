import { query, mutation } from "./_generated/server";
import { authQuery } from "./functions";
import { ConvexError, v } from "convex/values";

// ─── Public Queries (no auth needed — used by website widget + app) ───

/** List all active deals, optionally filtered by origin */
export const listActive = query({
  args: {
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let deals;

    if (args.origin) {
      deals = await ctx.db
        .query("lowFareRadar")
        .withIndex("by_origin", (q) => q.eq("origin", args.origin!))
        .collect();
    } else {
      deals = await ctx.db
        .query("lowFareRadar")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    }

    // Filter active + not expired
    return deals.filter(
      (d) => d.active && (!d.expiresAt || d.expiresAt > now)
    );
  },
});

/** Get deals matching a user's home airport (for app home page) */
export const getDealsForUser = authQuery({
  args: {},
  handler: async (ctx: any, args: any) => {
    // ctx.user is the userSettings document (from authQuery/validateTokenDirect)
    let homeAirport = ctx.user?.homeAirport;

    if (!homeAirport) {
      // Fallback: query userSettings by userId
      const altSettings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
        .unique();
      homeAirport = altSettings?.homeAirport;
    }

    if (!homeAirport) return [];

    const now = Date.now();

    // Extract IATA code from homeAirport
    // Possible formats: "Athens, ATH", "ATH - Athens", "ATH", "athens, ath"
    const raw = homeAirport.toUpperCase();
    const iataMatch = raw.match(/\b([A-Z]{3})\b/g);
    let homeIata = "";
    if (iataMatch) {
      homeIata = iataMatch[iataMatch.length - 1];
    }

    if (!homeIata) return [];

    // Get deals matching home airport as origin
    let deals = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_origin", (q: any) => q.eq("origin", homeIata))
      .collect();

    // Also get user's trip destinations to cross-match
    const userId = ctx.user?.userId || ctx.user?._id;
    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    const savedDestinations = new Set(
      trips
        .filter((t: any) => t.status === "completed" || t.status === "pending")
        .map((t: any) => t.destination?.toLowerCase())
        .filter(Boolean)
    );

    // Filter active, not expired, and enrich with matching info
    const activeDeals = deals
      .filter((d: any) => d.active && (!d.expiresAt || d.expiresAt > now))
      .map((d: any) => ({
        ...d,
        matchesPreference: savedDestinations.has(
          d.destinationCity.toLowerCase()
        ),
      }));

    // Sort: recommended first, then preference-matched, then by price
    return activeDeals.sort((a: any, b: any) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      if (a.matchesPreference && !b.matchesPreference) return -1;
      if (!a.matchesPreference && b.matchesPreference) return 1;
      return a.price - b.price;
    });
  },
});

/** Get a single deal by ID */
export const get = query({
  args: { id: v.id("lowFareRadar") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── Admin Mutations (called from website widget with admin key) ───

const dealFields = {
  origin: v.string(),
  originCity: v.string(),
  destination: v.string(),
  destinationCity: v.string(),
  airline: v.string(),
  airlineLogo: v.optional(v.string()),
  flightNumber: v.optional(v.string()),
  outboundDate: v.string(),
  outboundDeparture: v.string(),
  outboundArrival: v.string(),
  outboundDuration: v.optional(v.string()),
  outboundStops: v.optional(v.number()),
  outboundSegments: v.optional(v.array(v.object({
    airline: v.string(),
    flightNumber: v.optional(v.string()),
    departureAirport: v.string(),
    departureTime: v.string(),
    arrivalAirport: v.string(),
    arrivalTime: v.string(),
    duration: v.optional(v.string()),
  }))),
  returnDate: v.optional(v.string()),
  returnDeparture: v.optional(v.string()),
  returnArrival: v.optional(v.string()),
  returnDuration: v.optional(v.string()),
  returnAirline: v.optional(v.string()),
  returnFlightNumber: v.optional(v.string()),
  returnStops: v.optional(v.number()),
  returnSegments: v.optional(v.array(v.object({
    airline: v.string(),
    flightNumber: v.optional(v.string()),
    departureAirport: v.string(),
    departureTime: v.string(),
    arrivalAirport: v.string(),
    arrivalTime: v.string(),
    duration: v.optional(v.string()),
  }))),
  price: v.float64(),
  totalPrice: v.optional(v.float64()),
  originalPrice: v.optional(v.float64()),
  currency: v.string(),
  cabinBaggage: v.optional(v.string()),
  checkedBaggage: v.optional(v.string()),
  isRecommended: v.optional(v.boolean()),
  dealTag: v.optional(v.string()),
  bookingUrl: v.optional(v.string()),
  expiresAt: v.optional(v.float64()),
  notes: v.optional(v.string()),
};

/** Create a new low-fare deal (admin only — validated by adminKey) */
export const create = mutation({
  args: {
    adminKey: v.string(),
    ...dealFields,
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const { adminKey, ...dealData } = args;

    return await ctx.db.insert("lowFareRadar", {
      ...dealData,
      origin: dealData.origin.toUpperCase(),
      destination: dealData.destination.toUpperCase(),
      active: true,
      createdAt: Date.now(),
    });
  },
});

/** Update an existing deal */
export const update = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
    ...Object.fromEntries(
      Object.entries(dealFields).map(([k, v_]) => [k, v.optional(v_ as any)])
    ),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const { adminKey, id, ...updates } = args;

    const existing = await ctx.db.get(id);
    if (!existing) throw new ConvexError("Deal not found");

    // Filter out undefined values
    const cleanUpdates: Record<string, any> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    if (cleanUpdates.origin) cleanUpdates.origin = cleanUpdates.origin.toUpperCase();
    if (cleanUpdates.destination) cleanUpdates.destination = cleanUpdates.destination.toUpperCase();

    await ctx.db.patch(id, cleanUpdates);
  },
});

/** Deactivate a deal */
export const deactivate = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Deal not found");
    await ctx.db.patch(args.id, { active: false, updatedAt: Date.now() });
  },
});

/** Delete a deal permanently */
export const remove = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    await ctx.db.delete(args.id);
  },
});

/** List all deals for admin (including inactive) */
export const listAll = query({
  args: {
    adminKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const deals = await ctx.db.query("lowFareRadar").collect();
    return deals.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Get aggregated home airports from all users (admin only) */
export const getHomeAirports = query({
  args: {
    adminKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const allSettings = await ctx.db.query("userSettings").collect();

    const airportMap: Record<string, { code: string; city: string; count: number }> = {};

    for (const s of allSettings) {
      if (!s.homeAirport) continue;
      const raw = s.homeAirport.toUpperCase();
      const iataMatch = raw.match(/\b([A-Z]{3})\b/g);
      if (!iataMatch) continue;
      const code = iataMatch[iataMatch.length - 1];
      if (!airportMap[code]) {
        // Try to extract city name from "City, CODE" or "CODE - City" formats
        const cityMatch = s.homeAirport.match(/^([^,]+),/);
        const city = cityMatch ? cityMatch[1].trim() : s.homeAirport.replace(/\b[A-Z]{3}\b/g, '').replace(/[-,]/g, '').trim();
        airportMap[code] = { code, city: city || code, count: 0 };
      }
      airportMap[code].count++;
    }

    return Object.values(airportMap).sort((a, b) => b.count - a.count);
  },
});

// ─── Helpers ───

function validateAdminKey(key: string) {
  // Use environment variable for admin key.
  // Set CONVEX_LOW_FARE_ADMIN_KEY in your Convex dashboard environment variables.
  const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
  if (!expected) {
    throw new ConvexError(
      "CONVEX_LOW_FARE_ADMIN_KEY environment variable not set"
    );
  }
  if (key !== expected) {
    throw new ConvexError("Unauthorized: invalid admin key");
  }
}
