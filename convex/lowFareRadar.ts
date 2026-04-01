import { query, mutation } from "./_generated/server";
import { authQuery } from "./functions";
import { internal as _internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";

// Type assertion: internal references won't exist until `npx convex dev` regenerates types
const internal = _internal as any;

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

    if (!homeAirport) return { deals: [], homeIata: null, wishlistDestinations: [] };

    const now = Date.now();

    // Extract IATA code from homeAirport
    // Possible formats: "Athens, ATH", "ATH - Athens", "ATH", "athens, ath"
    const raw = homeAirport.toUpperCase();
    const iataMatch = raw.match(/\b([A-Z]{3})\b/g);
    let homeIata = "";
    if (iataMatch) {
      homeIata = iataMatch[iataMatch.length - 1];
    }

    if (!homeIata) return { deals: [], homeIata: null, wishlistDestinations: [] };

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

    // Get user's wishlist destinations
    const wishlistItems = await ctx.db
      .query("wishlist")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();
    const wishlistDestinations = wishlistItems.map((i: any) => ({
      destination: i.destination,
      country: i.country || null,
    }));
    const wishlistSet = new Set(
      wishlistItems.map((i: any) => i.destination.toLowerCase())
    );

    // Filter active deals and include expired ones (marked)
    const enrichedDeals = deals
      .filter((d: any) => d.active)
      .map((d: any) => {
        const isExpired = d.expiresAt ? d.expiresAt <= now : false;
        return {
          ...d,
          isExpired,
          matchesPreference: savedDestinations.has(
            d.destinationCity.toLowerCase()
          ),
          matchesWishlist: wishlistSet.has(
            d.destinationCity.toLowerCase()
          ),
        };
      });

    // Sort: non-expired first, then recommended, then wishlist-matched, then preference-matched, then by price
    const sorted = enrichedDeals.sort((a: any, b: any) => {
      // Expired deals go to the end
      if (a.isExpired && !b.isExpired) return 1;
      if (!a.isExpired && b.isExpired) return -1;
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      if (a.matchesWishlist && !b.matchesWishlist) return -1;
      if (!a.matchesWishlist && b.matchesWishlist) return 1;
      if (a.matchesPreference && !b.matchesPreference) return -1;
      if (!a.matchesPreference && b.matchesPreference) return 1;
      return a.price - b.price;
    });

    return {
      deals: sorted,
      homeIata,
      wishlistDestinations,
    };
  },
});

/** Get a single deal by ID */
export const get = query({
  args: { id: v.id("lowFareRadar") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Surprise Me: Get a random active deal, optionally under a max price */
export const surpriseMe = query({
  args: {
    maxPrice: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const allDeals = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    let eligible = allDeals.filter(
      (d) => d.active && (!d.expiresAt || d.expiresAt > now)
    );

    if (args.maxPrice !== undefined) {
      eligible = eligible.filter((d) => d.price <= args.maxPrice!);
    }

    if (eligible.length === 0) return null;

    // Pick a random deal
    const randomIndex = Math.floor(Math.random() * eligible.length);
    return eligible[randomIndex];
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
  travelMonthFrom: v.optional(v.string()),  // "2026-04" format
  travelMonthTo: v.optional(v.string()),    // "2026-06" format
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

    const dealId = await ctx.db.insert("lowFareRadar", {
      ...dealData,
      origin: dealData.origin.toUpperCase(),
      destination: dealData.destination.toUpperCase(),
      active: true,
      createdAt: Date.now(),
    });

    // Notify users watching this destination (non-blocking)
    await ctx.scheduler.runAfter(0, internal.watchedDestinations.notifyMatchingUsers, {
      dealId,
    });

    return dealId;
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

    // Detect price drop for watched destination alerts
    const oldPrice = existing.price;
    const newPrice = cleanUpdates.price;
    const hasPriceDrop = newPrice !== undefined && newPrice < oldPrice;

    await ctx.db.patch(id, cleanUpdates);

    // Notify watchers if price dropped
    if (hasPriceDrop && existing.active) {
      await ctx.scheduler.runAfter(0, internal.watchedDestinations.notifyPriceDrop, {
        dealId: id,
        oldPrice,
        newPrice,
      });
    }
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

/** Get aggregated wishlist destinations from all users (admin only) */
export const getWishlistStats = query({
  args: {
    adminKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const allWishlist = await ctx.db.query("wishlist").collect();

    const destMap: Record<string, { destination: string; country: string | null; count: number }> = {};

    for (const w of allWishlist) {
      const key = w.destination.toLowerCase();
      if (!destMap[key]) {
        destMap[key] = { destination: w.destination, country: (w as any).country || null, count: 0 };
      }
      destMap[key].count++;
    }

    return Object.values(destMap).sort((a, b) => b.count - a.count);
  },
});

// ─── Analytics Tracking ───

/** Increment bookingClicks when a user opens the booking URL */
export const trackBookingClick = mutation({
  args: {
    dealId: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return;
    await ctx.db.patch(args.dealId, {
      bookingClicks: (deal.bookingClicks ?? 0) + 1,
    });
  },
});

/** Increment planTripClicks when a user generates a trip from a deal */
export const trackPlanTripClick = mutation({
  args: {
    dealId: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return;
    await ctx.db.patch(args.dealId, {
      planTripClicks: (deal.planTripClicks ?? 0) + 1,
    });
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
