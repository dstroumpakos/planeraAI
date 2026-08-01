import { query, mutation, internalMutation, internalQuery, action, internalAction } from "./_generated/server";
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

    // Filter active + not expired + not soft-deleted
    return deals.filter(
      (d) => d.active && !d.deletedAt && (!d.expiresAt || d.expiresAt > now)
    );
  },
});

/**
 * Public-facing deal feed for the website widget.
 *
 * Unlike `listActive` (which returns whole documents and is meant for internal
 * / app callers), this projects each deal to an explicit allowlist of display
 * fields and caps the result to `limit`. It never leaks operational metadata:
 * click counters, change logs, soft-delete/update timestamps, the raw SerpApi
 * booking POST payload, or the internal `active` flag are all dropped.
 */
export const listActivePublic = query({
  args: {
    origin: v.optional(v.string()),
    // Homepage shows 3; other widgets may ask for more. Hard-capped below.
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(args.limit ?? 3, 1), 50);

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

    return deals
      .filter(
        (d) => d.active && !d.deletedAt && (!d.expiresAt || d.expiresAt > now)
      )
      // Rank server-side (recommended first, then cheapest) so a small `limit`
      // still returns the *best* deals rather than an arbitrary index-order slice.
      .sort((a, b) => {
        if (!!a.isRecommended !== !!b.isRecommended) return a.isRecommended ? -1 : 1;
        return a.price - b.price;
      })
      .slice(0, limit)
      .map((d) => ({
        // Opaque document handle — needed for React keys and click-through
        // tracking mutations; not sensitive.
        id: d._id,
        // Route
        origin: d.origin,
        originCity: d.originCity,
        destination: d.destination,
        destinationCity: d.destinationCity,
        // Airline
        airline: d.airline,
        airlineLogo: d.airlineLogo,
        flightNumber: d.flightNumber,
        // Outbound leg
        outboundDate: d.outboundDate,
        outboundDeparture: d.outboundDeparture,
        outboundArrival: d.outboundArrival,
        outboundDuration: d.outboundDuration,
        outboundStops: d.outboundStops,
        outboundSegments: d.outboundSegments,
        // Return leg
        returnDate: d.returnDate,
        returnDeparture: d.returnDeparture,
        returnArrival: d.returnArrival,
        returnDuration: d.returnDuration,
        returnAirline: d.returnAirline,
        returnFlightNumber: d.returnFlightNumber,
        returnStops: d.returnStops,
        returnSegments: d.returnSegments,
        // Pricing
        price: d.price,
        totalPrice: d.totalPrice,
        originalPrice: d.originalPrice,
        currency: d.currency,
        typicalPrice: d.typicalPrice,
        // Baggage
        cabinBaggage: d.cabinBaggage,
        checkedBaggage: d.checkedBaggage,
        // Presentation
        isRecommended: d.isRecommended,
        dealTag: d.dealTag,
        bookingUrl: d.bookingUrl,
        expiresAt: d.expiresAt,
        notes: d.notes,
        travelMonthFrom: d.travelMonthFrom,
        travelMonthTo: d.travelMonthTo,
      }));
  },
});

/** Read active attraction affiliate mappings for one destination (used by itinerary generation). */
export const getActiveAttractionLinksForDestination = query({
  args: {
    destinationCity: v.string(),
  },
  handler: async (ctx, args) => {
    const destinationCity = normalizeKey(args.destinationCity);
    return await ctx.db
      .query("attractionAffiliateLinks")
      .withIndex("by_destination", (q) => q.eq("destinationCity", destinationCity))
      .collect()
      .then((rows) => rows.filter((r) => r.active));
  },
});

// ─── Attraction affiliate links (admin-curated, GetYourGuide) ───

const attractionFields = {
  destinationCity: v.string(),
  destinationCountry: v.optional(v.string()),
  activityTitle: v.string(),
  displayTitle: v.optional(v.string()),
  affiliateUrl: v.string(),
  partner: v.optional(v.string()),
  price: v.optional(v.float64()),
  currency: v.optional(v.string()),
  topSite: v.optional(v.boolean()),
  travelStyles: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  active: v.optional(v.boolean()),
};

/** List attraction affiliate mappings (admin only) */
export const listAttractionLinks = query({
  args: {
    adminKey: v.string(),
    destinationCity: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);

    let rows;
    if (args.destinationCity) {
      rows = await ctx.db
        .query("attractionAffiliateLinks")
        .withIndex("by_destination", (q) => q.eq("destinationCity", normalizeKey(args.destinationCity!)))
        .collect();
    } else if (args.activeOnly) {
      rows = await ctx.db
        .query("attractionAffiliateLinks")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    } else {
      rows = await ctx.db.query("attractionAffiliateLinks").collect();
    }

    return rows.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  },
});

/** Create a new attraction affiliate mapping */
export const createAttractionLink = mutation({
  args: {
    adminKey: v.string(),
    ...attractionFields,
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    validateAffiliateUrl(args.affiliateUrl);

    const destinationCity = normalizeKey(args.destinationCity);
    const activityTitle = normalizeKey(args.activityTitle);

    const existing = await ctx.db
      .query("attractionAffiliateLinks")
      .withIndex("by_destination_activity", (q) =>
        q.eq("destinationCity", destinationCity).eq("activityTitle", activityTitle)
      )
      .first();
    if (existing) {
      throw new ConvexError("Attraction mapping already exists for this destination + activity");
    }

    return await ctx.db.insert("attractionAffiliateLinks", {
      destinationCity,
      destinationCountry: args.destinationCountry?.toLowerCase(),
      activityTitle,
      displayTitle: args.displayTitle?.trim() || args.activityTitle.trim(),
      affiliateUrl: args.affiliateUrl.trim(),
      partner: (args.partner || "getyourguide").toLowerCase(),
      price: args.price,
      currency: args.currency?.trim().toUpperCase() || undefined,
      topSite: !!args.topSite,
      travelStyles: args.travelStyles?.map((s) => normalizeKey(s)).filter(Boolean),
      notes: args.notes?.trim(),
      active: args.active ?? true,
      createdAt: Date.now(),
    });
  },
});

/** Update an attraction affiliate mapping */
export const updateAttractionLink = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("attractionAffiliateLinks"),
    destinationCity: v.optional(v.string()),
    destinationCountry: v.optional(v.string()),
    activityTitle: v.optional(v.string()),
    displayTitle: v.optional(v.string()),
    affiliateUrl: v.optional(v.string()),
    partner: v.optional(v.string()),
    price: v.optional(v.float64()),
    currency: v.optional(v.string()),
    topSite: v.optional(v.boolean()),
    travelStyles: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Attraction mapping not found");

    if (args.affiliateUrl !== undefined) {
      validateAffiliateUrl(args.affiliateUrl);
    }

    const nextDestinationCity =
      args.destinationCity !== undefined ? normalizeKey(args.destinationCity) : existing.destinationCity;
    const nextActivityTitle =
      args.activityTitle !== undefined ? normalizeKey(args.activityTitle) : existing.activityTitle;

    // Ensure uniqueness when changing keys
    if (
      nextDestinationCity !== existing.destinationCity ||
      nextActivityTitle !== existing.activityTitle
    ) {
      const conflict = await ctx.db
        .query("attractionAffiliateLinks")
        .withIndex("by_destination_activity", (q) =>
          q.eq("destinationCity", nextDestinationCity).eq("activityTitle", nextActivityTitle)
        )
        .first();
      if (conflict && conflict._id !== args.id) {
        throw new ConvexError("Another mapping already uses this destination + activity");
      }
    }

    const updates: Record<string, any> = { updatedAt: Date.now() };
    if (args.destinationCity !== undefined) updates.destinationCity = nextDestinationCity;
    if (args.destinationCountry !== undefined) updates.destinationCountry = args.destinationCountry?.toLowerCase();
    if (args.activityTitle !== undefined) updates.activityTitle = nextActivityTitle;
    if (args.displayTitle !== undefined)
      updates.displayTitle = args.displayTitle?.trim() || nextActivityTitle;
    if (args.affiliateUrl !== undefined) updates.affiliateUrl = args.affiliateUrl.trim();
    if (args.partner !== undefined) updates.partner = args.partner?.toLowerCase();
    if (args.price !== undefined) updates.price = args.price;
    if (args.currency !== undefined) updates.currency = args.currency?.trim().toUpperCase() || undefined;
    if (args.topSite !== undefined) updates.topSite = !!args.topSite;
    if (args.travelStyles !== undefined)
      updates.travelStyles = args.travelStyles?.map((s: string) => normalizeKey(s)).filter(Boolean);
    if (args.notes !== undefined) updates.notes = args.notes?.trim();
    if (args.active !== undefined) updates.active = args.active;

    await ctx.db.patch(args.id, updates);
  },
});

/** Delete an attraction mapping */
export const deleteAttractionLink = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("attractionAffiliateLinks"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    await ctx.db.delete(args.id);
  },
});

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function validateAffiliateUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ConvexError("Invalid affiliate URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConvexError("Affiliate URL must be an http(s) link");
  }
}

/**
 * How many of a user's most recent trips to read when cross-matching deal
 * destinations against places they've already planned. Bounded because trip
 * documents are fat (~57 KB each, they embed the whole itinerary) and this is
 * only used for a soft relevance badge — see the comment at the read site.
 */
const TRIP_MATCH_SCAN_LIMIT = 40;

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

    // Also get user's trip destinations to cross-match.
    //
    // This only needs `destination` + `status`, but Convex reads whole documents
    // and a trip row averages ~57 KB (it embeds the full `itinerary`) — reading
    // every trip a heavy user owns cost 10.19 MB per call, 64% of the 16 MB
    // transaction limit. The cross-match only drives a soft "matches your
    // interests" badge, so bound it to the most recent trips: newer trips are
    // the ones whose destinations still reflect what the user wants.
    const userId = ctx.user?.userId || ctx.user?._id;
    const trips = await ctx.db
      .query("trips")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(TRIP_MATCH_SCAN_LIMIT);

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

    // Filter active deals (exclude soft-deleted), include expired ones (marked)
    const enrichedDeals = deals
      .filter((d: any) => d.active && !d.deletedAt)
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
      (d) => d.active && !d.deletedAt && (!d.expiresAt || d.expiresAt > now)
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

    // Build change log entry
    const trackedFields = [
      'origin', 'originCity', 'destination', 'destinationCity',
      'airline', 'flightNumber', 'outboundDate', 'outboundDeparture', 'outboundArrival',
      'returnDate', 'returnDeparture', 'returnArrival', 'returnAirline',
      'price', 'totalPrice', 'originalPrice', 'currency',
      'cabinBaggage', 'checkedBaggage', 'dealTag', 'bookingUrl',
      'travelMonthFrom', 'travelMonthTo', 'active',
    ];
    const changes: string[] = [];
    for (const field of trackedFields) {
      if (cleanUpdates[field] !== undefined && cleanUpdates[field] !== (existing as any)[field]) {
        const oldVal = (existing as any)[field] ?? '-';
        const newVal = cleanUpdates[field] ?? '-';
        changes.push(`${field}: ${oldVal} -> ${newVal}`);
      }
    }

    if (changes.length > 0) {
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const entry = `[${timestamp}] ${changes.join('; ')}`;
      const prevLog: string[] = (existing as any).changeLog || [];
      cleanUpdates.changeLog = [...prevLog, entry];
      cleanUpdates.changeCount = ((existing as any).changeCount || 0) + 1;
    }

    // If expiresAt was updated, clear soft-delete (deal is alive again)
    if (cleanUpdates.expiresAt !== undefined && cleanUpdates.expiresAt !== existing.expiresAt) {
      cleanUpdates.deletedAt = undefined;
    }

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
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prevLog: string[] = (existing as any).changeLog || [];
    const entry = `[${timestamp}] active: true -> false`;
    await ctx.db.patch(args.id, {
      active: false,
      updatedAt: Date.now(),
      changeCount: ((existing as any).changeCount || 0) + 1,
      changeLog: [...prevLog, entry],
    });
  },
});

/** Soft-delete a deal (keeps it in the database) */
export const remove = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Deal not found");
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prevLog: string[] = (existing as any).changeLog || [];
    const entry = `[${timestamp}] soft-deleted`;
    await ctx.db.patch(args.id, {
      active: false,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      changeCount: ((existing as any).changeCount || 0) + 1,
      changeLog: [...prevLog, entry],
    });
  },
});

/** Permanently delete a deal from the database (admin only) */
export const hardDelete = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    await ctx.db.delete(args.id);
  },
});

/** Restore a soft-deleted deal */
export const restore = mutation({
  args: {
    adminKey: v.string(),
    id: v.id("lowFareRadar"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("Deal not found");
    if (!existing.deletedAt) throw new ConvexError("Deal is not deleted");
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prevLog: string[] = (existing as any).changeLog || [];
    const entry = `[${timestamp}] restored`;

    // Extend expiresAt by 7 days so the deal doesn't immediately appear expired
    // and the cron doesn't re-delete it
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const newExpiresAt = existing.expiresAt ? Date.now() + SEVEN_DAYS : undefined;

    await ctx.db.patch(args.id, {
      active: true,
      deletedAt: undefined,
      ...(newExpiresAt !== undefined ? { expiresAt: newExpiresAt } : {}),
      updatedAt: Date.now(),
      changeCount: ((existing as any).changeCount || 0) + 1,
      changeLog: [...prevLog, entry],
    });
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

/** Increment click count when a user taps an attraction affiliate booking link */
export const trackAttractionClick = mutation({
  args: {
    id: v.id("attractionAffiliateLinks"),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.id);
    if (!link) return;
    await ctx.db.patch(args.id, {
      clicks: (link.clicks ?? 0) + 1,
      lastClickedAt: Date.now(),
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

// ─── Internal: Auto soft-delete expired deals after 24 hours ───

export const softDeleteExpiredDeals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - TWENTY_FOUR_HOURS;

    const allDeals = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    let count = 0;
    for (const deal of allDeals) {
      // Skip already soft-deleted and deals without expiry
      if (deal.deletedAt || !deal.expiresAt) continue;
      // If expired more than 24h ago, soft-delete it
      if (deal.expiresAt <= cutoff) {
        await ctx.db.patch(deal._id, {
          active: false,
          deletedAt: Date.now(),
          updatedAt: Date.now(),
        });
        count++;
      }
    }

    return { softDeleted: count };
  },
});

// ─── Internal: Low-Fare Radar price refresh (searchapi.io, every 4 days) ───

/**
 * List deals eligible for the periodic price refresh:
 *   - active + not soft-deleted
 *   - manually-added / curated only (dealTag !== "AUTO"). AUTO deals already
 *     self-refresh through the search-seeding path and age out in 7 days.
 *   - outbound (and return, if round-trip) date still in the future — searchapi
 *     returns nothing for past dates, so re-pricing them is wasted quota.
 *
 * Ordered stalest-first (oldest `updatedAt`), so when a run stops on its cap or
 * time budget the leftovers are the ones the next run starts with — coverage
 * rotates instead of the same head of the list being re-priced every time.
 */
export const listRefreshableDeals = internalQuery({
  args: {},
  handler: async (ctx) => {
    // YYYY-MM-DD (UTC). Date strings compare correctly lexicographically.
    const today = new Date().toISOString().slice(0, 10);
    const deals = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    return deals
      .filter(
        (d) =>
          d.active &&
          !d.deletedAt &&
          d.dealTag !== "AUTO" &&
          !!d.outboundDate &&
          d.outboundDate >= today &&
          (!d.returnDate || d.returnDate >= today)
      )
      .sort(
        (a, b) =>
          (a.updatedAt ?? a._creationTime) - (b.updatedAt ?? b._creationTime)
      );
  },
});

/**
 * Apply a refreshed fare to a single deal. Only `price`/`totalPrice` are
 * touched — flight times, airline, and any admin-set `originalPrice` are left
 * as curated. Mirrors the admin `update` flow: logs the change and notifies
 * watchers on a price drop.
 */
export const applyPriceRefresh = internalMutation({
  args: {
    id: v.id("lowFareRadar"),
    newPrice: v.float64(),
    // How the fresh fare was matched to this deal's specific flight, for the
    // change log ("flight_number" or "airline_time").
    matchType: v.optional(v.string()),
    // The matched flight number(s), e.g. "A3601" or "A3601+A3602".
    matchedFlight: v.optional(v.string()),
    // "Low fare" ceiling for this route (the typical/average fare, derived from
    // Google's price insights during the refresh). When the refreshed price is
    // above this, the deal is no longer a low fare and gets expired so the
    // radar only ever surfaces genuine deals. Omitted → no ceiling check.
    ceiling: v.optional(v.float64()),
    // Route's typical fare from the same refresh (pre-ratio, unlike `ceiling`).
    // Persisted on the deal so downstream surfaces (newsletter deal cards) can
    // show "X% below typical" without another API call. Omitted → left as-is.
    typicalPrice: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return { changed: false as const, expired: false as const };

    const oldPrice = existing.price;
    const newPrice = Math.round(args.newPrice);

    // Sanity guard: ignore junk values so a bad API response can't corrupt a
    // curated deal.
    if (!(newPrice > 0) || newPrice > 100000)
      return { changed: false as const, expired: false as const };

    const priceChanged = newPrice !== oldPrice;

    // Refresh the stored typical price whenever the caller measured one; a
    // missing/junk value leaves the previous reading in place.
    const typicalPatch =
      args.typicalPrice != null && args.typicalPrice > 0
        ? { typicalPrice: Math.round(args.typicalPrice) }
        : {};

    // Preserve a multi-passenger total by scaling it proportionally with the
    // per-person price (deals store `price` as per-person, `totalPrice` as the
    // group total when it differs).
    const ratio =
      existing.totalPrice && existing.price
        ? existing.totalPrice / existing.price
        : 1;
    const newTotal = Math.round(newPrice * ratio);

    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prevLog: string[] = (existing as any).changeLog || [];
    const matchNote = args.matchedFlight
      ? `, matched ${args.matchedFlight}`
      : args.matchType
      ? `, matched by ${args.matchType}`
      : "";

    // Ceiling rule: the fare has risen above the route's typical price, so this
    // is no longer a low fare — expire it (deactivate so it drops off the radar
    // for users). Runs even when the price itself is unchanged, so a deal that
    // has crept above the ceiling is still retired. Only expire currently-active
    // deals; a bad/zero ceiling never triggers it.
    const overCeiling =
      args.ceiling != null && args.ceiling > 0 && newPrice > args.ceiling;

    if (overCeiling && existing.active) {
      const now = Date.now();
      const entry = `[${timestamp}] EXPIRED: price ${oldPrice} -> ${newPrice} above low-fare ceiling ${Math.round(args.ceiling!)} (auto-refresh${matchNote})`;
      await ctx.db.patch(args.id, {
        price: newPrice,
        totalPrice: newTotal,
        active: false,
        expiresAt: now,
        updatedAt: now,
        changeCount: ((existing as any).changeCount || 0) + 1,
        changeLog: [...prevLog, entry],
        ...typicalPatch,
      });
      return {
        changed: priceChanged,
        expired: true as const,
        oldPrice,
        newPrice,
        ceiling: Math.round(args.ceiling!),
      };
    }

    if (!priceChanged) {
      // No change — record that we checked so admins can see it's fresh.
      await ctx.db.patch(args.id, { updatedAt: Date.now(), ...typicalPatch });
      return { changed: false as const, expired: false as const };
    }

    const entry = `[${timestamp}] price: ${oldPrice} -> ${newPrice} (auto-refresh${matchNote})`;

    await ctx.db.patch(args.id, {
      price: newPrice,
      totalPrice: newTotal,
      updatedAt: Date.now(),
      changeCount: ((existing as any).changeCount || 0) + 1,
      changeLog: [...prevLog, entry],
      ...typicalPatch,
    });

    // Notify watchers on a genuine drop (same behavior as the admin update).
    if (newPrice < oldPrice && existing.active) {
      await ctx.scheduler.runAfter(0, internal.watchedDestinations.notifyPriceDrop, {
        dealId: args.id,
        oldPrice,
        newPrice,
      });
    }

    return { changed: true as const, expired: false as const, oldPrice, newPrice };
  },
});

// ─── Low-Fare Radar refresh state (countdown + manual trigger support) ───

// Keep in sync with the interval in lowFareRadarRefresh.ts / crons.ts.
const RADAR_REFRESH_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * How long a `running` lock stays believable. A refresh run is a Convex action,
 * so it can never legitimately outlive the platform's action time limit
 * (10 min); if the lock is older than this the run was killed mid-flight and
 * never reached `markRadarRefreshCompleted`. Without this the stale lock parks
 * the cron forever — which is exactly what happened on 2026-07-25.
 */
export const RADAR_RUN_LOCK_STALE_MS = 20 * 60 * 1000;

/**
 * Retry gap used when a run stops early on its time budget: the leftover deals
 * are re-priced on the next hourly tick instead of waiting out the full 4 days.
 */
export const RADAR_REFRESH_RETRY_SOON_MS = 60 * 60 * 1000;

/** Admin: current refresh state for the widget countdown + "refresh now" UI. */
export const getRefreshStatus = query({
  args: { adminKey: v.string() },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const state = await ctx.db.query("radarRefreshState").first();
    // A lock older than the action time limit belongs to a killed run — don't
    // show it as "running" (and don't let it disable the "refresh now" button).
    const lockAge = Date.now() - (state?.runStartedAt ?? state?.updatedAt ?? 0);
    const running = !!state?.running && lockAge < RADAR_RUN_LOCK_STALE_MS;
    return {
      lastRefreshAt: state?.lastRefreshAt ?? null,
      nextRefreshAt: state?.nextRefreshAt ?? null,
      running,
      lastResult: state?.lastResult ?? null,
      intervalMs: RADAR_REFRESH_INTERVAL_MS,
      // Server clock so the widget can render a drift-free countdown.
      serverNow: Date.now(),
    };
  },
});

/** Internal: read refresh state (used by the cron tick + manual trigger). */
export const getRadarRefreshStateInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db.query("radarRefreshState").first();
    if (!state) return null;
    const lockAge = Date.now() - (state.runStartedAt ?? state.updatedAt);
    return {
      nextRefreshAt: state.nextRefreshAt,
      // Only a fresh lock blocks a new run; a stale one means the previous run
      // was killed before it could clear it.
      running: !!state.running && lockAge < RADAR_RUN_LOCK_STALE_MS,
      staleLock: !!state.running && lockAge >= RADAR_RUN_LOCK_STALE_MS,
    };
  },
});

/** Internal: ensure the singleton exists; returns the (possibly new) due time. */
export const ensureRadarRefreshState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db.query("radarRefreshState").first();
    if (state) return state.nextRefreshAt;
    const now = Date.now();
    const nextRefreshAt = now + RADAR_REFRESH_INTERVAL_MS;
    await ctx.db.insert("radarRefreshState", {
      nextRefreshAt,
      running: false,
      updatedAt: now,
    });
    return nextRefreshAt;
  },
});

/** Internal: mark a refresh run as started (overlap guard). */
export const markRadarRefreshStarted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const state = await ctx.db.query("radarRefreshState").first();
    if (state) {
      await ctx.db.patch(state._id, { running: true, runStartedAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("radarRefreshState", {
        nextRefreshAt: now + RADAR_REFRESH_INTERVAL_MS,
        running: true,
        runStartedAt: now,
        updatedAt: now,
      });
    }
  },
});

/** Internal: mark a refresh run complete and reset the countdown. */
export const markRadarRefreshCompleted = internalMutation({
  args: {
    result: v.object({
      checked: v.float64(),
      updated: v.float64(),
      unchanged: v.float64(),
      notFound: v.float64(),
      failed: v.float64(),
      expired: v.optional(v.float64()),
      skipped: v.optional(v.float64()),
    }),
    // Set when the run stopped on its time budget with deals still to price:
    // come back in an hour for the leftovers instead of in four days.
    retrySoon: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const nextRefreshAt =
      now +
      (args.retrySoon ? RADAR_REFRESH_RETRY_SOON_MS : RADAR_REFRESH_INTERVAL_MS);
    const lastResult = { ...args.result, at: now };
    const state = await ctx.db.query("radarRefreshState").first();
    if (state) {
      await ctx.db.patch(state._id, {
        lastRefreshAt: now,
        nextRefreshAt,
        running: false,
        runStartedAt: undefined,
        lastResult,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("radarRefreshState", {
        lastRefreshAt: now,
        nextRefreshAt,
        running: false,
        lastResult,
        updatedAt: now,
      });
    }
  },
});

// ─── Admin: Broadcast a deal to users by home airport ───

/** Internal: find all users whose home airport matches one of the given IATA codes */
export const getUsersByHomeAirport = internalQuery({
  args: {
    origins: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const wanted = new Set(args.origins.map((o) => o.toUpperCase()));
    const allSettings = await ctx.db.query("userSettings").collect();
    const matches: Array<{ userId: string; language: string | undefined; homeAirport: string }> = [];
    for (const s of allSettings) {
      if (!s.homeAirport) continue;
      const iataMatch = s.homeAirport.toUpperCase().match(/\b([A-Z]{3})\b/g);
      if (!iataMatch) continue;
      const code = iataMatch[iataMatch.length - 1];
      if (wanted.has(code)) {
        matches.push({
          userId: s.userId,
          language: s.language,
          homeAirport: code,
        });
      }
    }
    return matches;
  },
});

// ─── Broadcast audience resolution ───
//
// One resolver, used by BOTH the admin's reach preview and the actual send, so
// the number the admin sees before pressing Send is the number that gets a
// push. (Previously the widget estimated reach from `getHomeAirports`, which
// counts every user with a home airport — including users who muted deal
// alerts and users with no device token — so it always over-promised.)

const DEAL_PUSH_TYPE = "deal_broadcast";
/** Default: don't push the same user more than one deal alert every 3 days. */
const DEFAULT_DEAL_FREQUENCY_CAP_DAYS = 3;

type BroadcastRecipient = {
  userId: string;
  language: string | undefined;
  homeAirport: string | null;
  viaWishlist: boolean;
  tokens: Array<{ tokenId: any; token: string }>;
};

type BroadcastAudience = {
  recipients: BroadcastRecipient[];
  /** Users matching the targeting rules, before deliverability filtering. */
  matched: number;
  /** Users who will actually receive a push. */
  deliverable: number;
  skipReasons: { noToken: number; optedOut: number; frequencyCapped: number };
  byAirport: Array<{ code: string; matched: number; deliverable: number }>;
  wishlistMatched: number;
};

/** Extract the trailing IATA code from a free-form home airport string. */
function extractIata(homeAirport: string | undefined | null): string | null {
  if (!homeAirport) return null;
  const m = homeAirport.toUpperCase().match(/\b([A-Z]{3})\b/g);
  return m ? m[m.length - 1] : null;
}

/**
 * Resolve who receives a deal broadcast and why everyone else doesn't.
 *
 * Reads userSettings + pushTokens in full (same order of magnitude as the
 * existing getHomeAirports admin query) and one notificationLog row per
 * candidate when a frequency cap is active.
 */
async function resolveDealAudienceImpl(
  ctx: any,
  args: {
    origins: string[];
    /** Also include users who wishlisted this destination, any home airport. */
    wishlistDestination?: string;
    /** Skip users pushed a deal within this many days. 0 disables. */
    frequencyCapDays?: number;
    /** Deal alerts respect `dealAlerts`; onboarding nudges only respect the master toggle. */
    requireDealAlerts?: boolean;
  }
): Promise<BroadcastAudience> {
  const wanted = new Set(args.origins.map((o) => o.toUpperCase()));
  const allSettings = await ctx.db.query("userSettings").collect();

  // userId → candidate
  const candidates = new Map<string, { settings: any; homeAirport: string | null; viaWishlist: boolean }>();
  const settingsByUser = new Map<string, any>();

  for (const s of allSettings) {
    if (!s.userId) continue;
    settingsByUser.set(s.userId, s);
    const code = extractIata(s.homeAirport);
    if (code && wanted.has(code)) {
      candidates.set(s.userId, { settings: s, homeAirport: code, viaWishlist: false });
    }
  }

  // Wishlist widening: users who saved this destination are the warmest
  // audience for it, but were previously unreachable — targeting was
  // home-airport only.
  let wishlistMatched = 0;
  if (args.wishlistDestination) {
    const needle = args.wishlistDestination.trim().toLowerCase();
    if (needle.length >= 3) {
      const wishes = await ctx.db.query("wishlist").collect();
      for (const w of wishes) {
        const dest = (w.destination || "").toLowerCase();
        if (!dest) continue;
        if (dest !== needle && !dest.includes(needle) && !needle.includes(dest)) continue;
        const settings = settingsByUser.get(w.userId);
        if (!settings) continue; // no settings row → no prefs, no tokens
        wishlistMatched++;
        if (!candidates.has(w.userId)) {
          candidates.set(w.userId, {
            settings,
            homeAirport: extractIata(settings.homeAirport),
            viaWishlist: true,
          });
        }
      }
    }
  }

  // Tokens, bulk — one scan instead of one query per user.
  const tokensByUser = new Map<string, Array<{ tokenId: any; token: string }>>();
  const allTokens = await ctx.db.query("pushTokens").collect();
  for (const t of allTokens) {
    if (!candidates.has(t.userId)) continue;
    const list = tokensByUser.get(t.userId) || [];
    list.push({ tokenId: t._id, token: t.token });
    tokensByUser.set(t.userId, list);
  }

  const capDays = args.frequencyCapDays ?? 0;
  const capCutoff = capDays > 0 ? Date.now() - capDays * 24 * 60 * 60 * 1000 : null;

  const recipients: BroadcastRecipient[] = [];
  const skipReasons = { noToken: 0, optedOut: 0, frequencyCapped: 0 };
  const airportStats = new Map<string, { code: string; matched: number; deliverable: number }>();

  const bump = (code: string | null, key: "matched" | "deliverable") => {
    const c = code || "—";
    const row = airportStats.get(c) || { code: c, matched: 0, deliverable: 0 };
    row[key]++;
    airportStats.set(c, row);
  };

  for (const [userId, cand] of candidates.entries()) {
    const s = cand.settings;
    bump(cand.homeAirport, "matched");

    // Preference gates — mirrors notifications.sendPushNotification, which
    // would otherwise silently drop these users after we'd already counted them.
    if (s.pushNotifications === false) { skipReasons.optedOut++; continue; }
    if (args.requireDealAlerts !== false && s.dealAlerts === false) { skipReasons.optedOut++; continue; }

    const tokens = tokensByUser.get(userId);
    if (!tokens || tokens.length === 0) { skipReasons.noToken++; continue; }

    if (capCutoff !== null) {
      const recent = await ctx.db
        .query("notificationLog")
        .withIndex("by_user_type", (q: any) => q.eq("userId", userId).eq("type", DEAL_PUSH_TYPE))
        .order("desc")
        .first();
      if (recent && recent.sentAt >= capCutoff) { skipReasons.frequencyCapped++; continue; }
    }

    bump(cand.homeAirport, "deliverable");
    recipients.push({
      userId,
      language: s.language,
      homeAirport: cand.homeAirport,
      viaWishlist: cand.viaWishlist,
      tokens,
    });
  }

  return {
    recipients,
    matched: candidates.size,
    deliverable: recipients.length,
    skipReasons,
    byAirport: Array.from(airportStats.values()).sort((a, b) => b.matched - a.matched),
    wishlistMatched,
  };
}

export const resolveDealAudience = internalQuery({
  args: {
    origins: v.array(v.string()),
    wishlistDestination: v.optional(v.string()),
    frequencyCapDays: v.optional(v.float64()),
    requireDealAlerts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => resolveDealAudienceImpl(ctx, args),
});

/**
 * Admin: how many users would ACTUALLY receive this broadcast, and why the
 * rest wouldn't. Drives the reach summary in the widget's send modal.
 */
export const getBroadcastReach = query({
  args: {
    adminKey: v.string(),
    origins: v.array(v.string()),
    wishlistDestination: v.optional(v.string()),
    frequencyCapDays: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const audience = await resolveDealAudienceImpl(ctx, {
      origins: args.origins,
      wishlistDestination: args.wishlistDestination,
      frequencyCapDays: args.frequencyCapDays ?? DEFAULT_DEAL_FREQUENCY_CAP_DAYS,
      requireDealAlerts: true,
    });
    // Recipient list stays server-side; the widget only needs the counts.
    return {
      matched: audience.matched,
      deliverable: audience.deliverable,
      skipReasons: audience.skipReasons,
      byAirport: audience.byAirport,
      wishlistMatched: audience.wishlistMatched,
    };
  },
});

/**
 * Admin action: send a deal-alert push notification to every user whose home
 * airport matches the deal's origin (or any of the optional `originsOverride`),
 * optionally widened to users who wishlisted the destination.
 *
 * Supports dry-run (count only) and scheduling. The actual sending happens in
 * `executeBroadcast` so that immediate and scheduled sends share one code path.
 */
export const broadcastDealToHomeAirports = action({
  args: {
    adminKey: v.string(),
    dealId: v.id("lowFareRadar"),
    // Optional: override which origin airports receive the broadcast.
    // Defaults to the deal's own origin.
    originsOverride: v.optional(v.array(v.string())),
    // Optional: custom title/body. If omitted, falls back to localized
    // "Deal found" template per user language.
    customTitle: v.optional(v.string()),
    customBody: v.optional(v.string()),
    // Count the audience and return without sending or logging a broadcast.
    dryRun: v.optional(v.boolean()),
    // Also target users who wishlisted this deal's destination.
    includeWishlist: v.optional(v.boolean()),
    // Skip users already sent a deal alert within N days (0 disables).
    frequencyCapDays: v.optional(v.float64()),
    // Epoch ms. When in the future, the send is queued instead of run now.
    scheduledFor: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<{
    targeted: number;
    sent: number;
    skipped: number;
    broadcastId: string | null;
    matched: number;
    skipReasons: { noToken: number; optedOut: number; frequencyCapped: number };
    scheduled: boolean;
  }> => {
    // Validate admin key
    const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
    if (!expected) {
      throw new ConvexError("CONVEX_LOW_FARE_ADMIN_KEY environment variable not set");
    }
    if (args.adminKey !== expected) {
      throw new ConvexError("Unauthorized: invalid admin key");
    }

    // Load the deal
    const finalDeal: any = await ctx.runQuery(
      (await import("./_generated/api")).api.lowFareRadar.get,
      { id: args.dealId }
    );
    if (!finalDeal) throw new ConvexError("Deal not found");

    const origins = (args.originsOverride && args.originsOverride.length > 0
      ? args.originsOverride
      : [finalDeal.origin]
    ).map((o: string) => o.toUpperCase());

    const frequencyCapDays = args.frequencyCapDays ?? DEFAULT_DEAL_FREQUENCY_CAP_DAYS;
    const wishlistDestination = args.includeWishlist
      ? (finalDeal.destinationCity || finalDeal.destination)
      : undefined;

    // Dry run: resolve the audience, report, send nothing, log nothing.
    if (args.dryRun) {
      const audience: BroadcastAudience = await ctx.runQuery(internal.lowFareRadar.resolveDealAudience, {
        origins,
        wishlistDestination,
        frequencyCapDays,
        requireDealAlerts: true,
      });
      return {
        targeted: audience.deliverable,
        sent: 0,
        skipped: 0,
        broadcastId: null,
        matched: audience.matched,
        skipReasons: audience.skipReasons,
        scheduled: false,
      };
    }

    const mode = args.customTitle || args.customBody ? "custom" : "auto";
    const variantId = mode === "custom"
      ? "custom"
      : pickBroadcastVariant("en", finalDeal).variant.id;

    const params = {
      dealId: args.dealId,
      origins,
      customTitle: args.customTitle,
      customBody: args.customBody,
      includeWishlist: !!args.includeWishlist,
      frequencyCapDays,
    };

    const now = Date.now();
    const isScheduled = !!args.scheduledFor && args.scheduledFor > now + 30_000;

    const broadcastId: any = await ctx.runMutation(internal.lowFareRadar.createBroadcastLog, {
      dealId: args.dealId,
      origins,
      mode,
      customTitle: args.customTitle,
      customBody: args.customBody,
      routeSnapshot: `${finalDeal.origin} → ${finalDeal.destination}`,
      // Filled in for real by the send; a scheduled row re-resolves at fire time.
      targeted: 0,
      variantId,
      status: isScheduled ? "scheduled" : "sending",
      scheduledFor: isScheduled ? args.scheduledFor : undefined,
      wishlistTargeted: !!args.includeWishlist,
      params,
    });

    if (isScheduled) {
      const jobId = await ctx.scheduler.runAt(
        args.scheduledFor!,
        internal.lowFareRadar.executeBroadcast,
        { broadcastId }
      );
      await ctx.runMutation(internal.lowFareRadar.patchBroadcast, {
        broadcastId,
        scheduledJobId: String(jobId),
      });
      return {
        targeted: 0, sent: 0, skipped: 0,
        broadcastId: String(broadcastId),
        matched: 0,
        skipReasons: { noToken: 0, optedOut: 0, frequencyCapped: 0 },
        scheduled: true,
      };
    }

    const result: any = await ctx.runAction(internal.lowFareRadar.executeBroadcast, { broadcastId });
    return {
      targeted: result.targeted,
      sent: result.sent,
      skipped: result.skipped,
      broadcastId: String(broadcastId),
      matched: result.matched,
      skipReasons: result.skipReasons,
      scheduled: false,
    };
  },
});

/**
 * Do the actual sending for a logged broadcast row. Shared by immediate and
 * scheduled sends. Pushes in chunks of 100 (Expo's per-request limit) instead
 * of one HTTP round-trip per user, and honours a mid-flight cancel.
 */
export const executeBroadcast = internalAction({
  args: { broadcastId: v.id("notificationBroadcasts") },
  handler: async (ctx, args): Promise<{
    targeted: number;
    sent: number;
    skipped: number;
    matched: number;
    skipReasons: { noToken: number; optedOut: number; frequencyCapped: number; pushError: number };
    cancelled: boolean;
  }> => {
    const empty = {
      targeted: 0, sent: 0, skipped: 0, matched: 0,
      skipReasons: { noToken: 0, optedOut: 0, frequencyCapped: 0, pushError: 0 },
      cancelled: false,
    };

    const row: any = await ctx.runQuery(internal.lowFareRadar.getBroadcastRow, {
      broadcastId: args.broadcastId,
    });
    if (!row) return empty;
    if (row.status === "cancelled" || row.cancelRequested) {
      return { ...empty, cancelled: true };
    }

    const p = row.params || {};
    const deal: any = p.dealId
      ? await ctx.runQuery((await import("./_generated/api")).api.lowFareRadar.get, { id: p.dealId })
      : null;
    if (!deal) {
      await ctx.runMutation(internal.lowFareRadar.patchBroadcast, {
        broadcastId: args.broadcastId,
        status: "failed",
      });
      return empty;
    }

    await ctx.runMutation(internal.lowFareRadar.patchBroadcast, {
      broadcastId: args.broadcastId,
      status: "sending",
    });

    // Resolve at send time, not at schedule time — opt-outs and new signups
    // between scheduling and firing should be respected.
    const audience: BroadcastAudience = await ctx.runQuery(internal.lowFareRadar.resolveDealAudience, {
      origins: p.origins || [],
      wishlistDestination: p.includeWishlist ? (deal.destinationCity || deal.destination) : undefined,
      frequencyCapDays: p.frequencyCapDays ?? DEFAULT_DEAL_FREQUENCY_CAP_DAYS,
      requireDealAlerts: true,
    });

    await ctx.runMutation(internal.lowFareRadar.patchBroadcast, {
      broadcastId: args.broadcastId,
      targeted: audience.deliverable,
    });

    const data = {
      screen: "deal-trip",
      dealId: p.dealId,
      // broadcastId lets the app attribute taps back to this broadcast row
      broadcastId: String(args.broadcastId),
      origin: deal.origin,
      originCity: deal.originCity,
      destination: deal.destination,
      destinationCity: deal.destinationCity,
    };

    // One message per device, grouped so a chunk never splits a user.
    type Msg = { userId: string; tokenId: any; token: string; title: string; body: string; data: any };
    const perUser: Msg[][] = audience.recipients.map((r) => {
      const lang = (r.language || "en").toLowerCase();
      const title = p.customTitle ?? buildBroadcastTitle(lang, deal);
      const body = p.customBody ?? buildBroadcastBody(lang, deal);
      return r.tokens.map((t) => ({
        userId: r.userId, tokenId: t.tokenId, token: t.token, title, body, data,
      }));
    });

    const CHUNK = 100;
    let sent = 0;
    let pushError = 0;
    let cancelled = false;

    let batch: Msg[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const res: any = await ctx.runAction(internal.notifications.sendExpoBatch, {
        messages: batch,
        type: DEAL_PUSH_TYPE,
      });
      sent += res.deliveredUserIds.length;
      pushError += res.failedUserIds.length;
      batch = [];
    };

    for (const userMsgs of perUser) {
      if (batch.length + userMsgs.length > CHUNK) {
        await flush();
        // Cancel is checked between chunks — a mistargeted blast can be
        // stopped instead of running to completion.
        const check: any = await ctx.runQuery(internal.lowFareRadar.getBroadcastRow, {
          broadcastId: args.broadcastId,
        });
        if (check?.cancelRequested) { cancelled = true; break; }
      }
      batch.push(...userMsgs);
    }
    if (!cancelled) await flush();

    const skipReasons = {
      noToken: audience.skipReasons.noToken,
      optedOut: audience.skipReasons.optedOut,
      frequencyCapped: audience.skipReasons.frequencyCapped,
      pushError,
    };

    await ctx.runMutation(internal.lowFareRadar.finalizeBroadcastLog, {
      broadcastId: args.broadcastId,
      sent,
      skipped: pushError,
      status: cancelled ? "cancelled" : "sent",
      skipReasons,
    });

    return {
      targeted: audience.deliverable,
      sent,
      skipped: pushError,
      matched: audience.matched,
      skipReasons,
      cancelled,
    };
  },
});

/** Admin: stop a scheduled broadcast, or halt one that's mid-send. */
export const cancelBroadcast = mutation({
  args: {
    adminKey: v.string(),
    broadcastId: v.id("notificationBroadcasts"),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const row: any = await ctx.db.get(args.broadcastId);
    if (!row) throw new ConvexError("Broadcast not found");
    if (row.status === "sent" || row.status === "cancelled") {
      return { cancelled: false, reason: "Already finished" };
    }

    // Kill the queued job outright when it hasn't fired yet; the flag covers
    // the case where it's already running.
    if (row.scheduledJobId) {
      try {
        await ctx.scheduler.cancel(row.scheduledJobId as any);
      } catch (err) {
        console.warn("cancelBroadcast: scheduler.cancel failed", err);
      }
    }
    await ctx.db.patch(args.broadcastId, {
      cancelRequested: true,
      status: row.status === "scheduled" ? "cancelled" : row.status,
    });
    return { cancelled: true, reason: null };
  },
});

/**
 * Admin: send one push to a single account (looked up by email) so the copy can
 * be seen on a real device before it goes to thousands of users.
 */
export const sendTestPush = action({
  args: {
    adminKey: v.string(),
    email: v.string(),
    dealId: v.optional(v.id("lowFareRadar")),
    lang: v.optional(v.string()),
    customTitle: v.optional(v.string()),
    customBody: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: number; devices: number; title: string; body: string }> => {
    const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
    if (!expected) throw new ConvexError("CONVEX_LOW_FARE_ADMIN_KEY environment variable not set");
    if (args.adminKey !== expected) throw new ConvexError("Unauthorized: invalid admin key");

    const target: any = await ctx.runQuery(internal.lowFareRadar.findUserByEmail, {
      email: args.email.trim().toLowerCase(),
    });
    if (!target) throw new ConvexError(`No account found for ${args.email}`);
    if (!target.tokens.length) throw new ConvexError(`${args.email} has no registered device`);

    let title = args.customTitle || "";
    let body = args.customBody || "";
    if (!title || !body) {
      if (!args.dealId) throw new ConvexError("Provide a deal or custom copy");
      const deal: any = await ctx.runQuery(
        (await import("./_generated/api")).api.lowFareRadar.get,
        { id: args.dealId }
      );
      if (!deal) throw new ConvexError("Deal not found");
      const lang = (args.lang || target.language || "en").toLowerCase();
      title = title || buildBroadcastTitle(lang, deal);
      body = body || buildBroadcastBody(lang, deal);
    }

    // Type is deliberately NOT "deal_*": a test must not be suppressed by the
    // tester's own deal-alert preference, and must not count toward their
    // frequency cap.
    const res: any = await ctx.runAction(internal.notifications.sendExpoBatch, {
      messages: target.tokens.map((t: any) => ({
        userId: target.userId,
        tokenId: t.tokenId,
        token: t.token,
        title,
        body,
        data: { screen: args.dealId ? "deal-trip" : "home", dealId: args.dealId, test: true },
      })),
      type: "admin_test_push",
      log: false,
    });

    return {
      sent: res.deliveredUserIds.length,
      devices: target.tokens.length,
      title,
      body,
    };
  },
});

export const findUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("userSettings").collect();
    const match = all.find((s: any) => (s.email || "").toLowerCase() === args.email);
    if (!match) return null;
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q: any) => q.eq("userId", match.userId))
      .collect();
    return {
      userId: match.userId,
      language: match.language,
      tokens: tokens.map((t: any) => ({ tokenId: t._id, token: t.token })),
    };
  },
});

// ─── Admin: Nudge users who haven't generated their first trip ───

/** Internal: count users in userSettings who have never created a trip. */
export const getUsersWithoutTrips = internalQuery({
  args: {
    // If provided, exclude users who already received a "first_trip_nudge"
    // within this many milliseconds.
    skipIfNotifiedWithinMs: v.optional(v.float64()),
    // If true, ONLY return users who have previously received a
    // "first_trip_nudge" (used for follow-up apologies/corrections).
    onlyPreviouslyNotified: v.optional(v.boolean()),
    // If true, do not filter out users who already have trips. Used for
    // "Everyone" broadcasts (e.g. global announcements).
    includeUsersWithTrips: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const allSettings = await ctx.db.query("userSettings").collect();

    let usersWithTrips = new Set<string>();
    if (!args.includeUsersWithTrips) {
      const allTrips = await ctx.db.query("trips").collect();
      usersWithTrips = new Set<string>(allTrips.map((t: any) => t.userId));
    }

    const cutoff = args.skipIfNotifiedWithinMs
      ? Date.now() - args.skipIfNotifiedWithinMs
      : null;

    const matches: Array<{ userId: string; language: string | undefined }> = [];
    for (const s of allSettings) {
      if (!s.userId) continue;
      if (!args.includeUsersWithTrips && usersWithTrips.has(s.userId)) continue;

      // Look up most-recent first_trip_nudge once per user (used by both
      // cooldown and the onlyPreviouslyNotified filter).
      let recent: any = null;
      if (cutoff !== null || args.onlyPreviouslyNotified) {
        recent = await ctx.db
          .query("notificationLog")
          .withIndex("by_user_type", (q: any) =>
            q.eq("userId", s.userId).eq("type", "first_trip_nudge")
          )
          .order("desc")
          .first();
      }

      if (args.onlyPreviouslyNotified && !recent) continue;
      if (cutoff !== null && recent && recent.sentAt >= cutoff) continue;

      matches.push({ userId: s.userId, language: s.language });
    }
    return matches;
  },
});

const FIRST_TRIP_NUDGE_COPY: Record<string, { title: string; body: string }> = {
  en: { title: "✈️ Plan your first trip", body: "Where will you go first? Planera builds your itinerary in seconds." },
  el: { title: "✈️ Σχεδίασε το πρώτο σου ταξίδι", body: "Πού θες να πας πρώτα; Το Planera φτιάχνει το πρόγραμμά σου σε δευτερόλεπτα." },
  es: { title: "✈️ Planea tu primer viaje", body: "¿A dónde irás primero? Planera crea tu itinerario en segundos." },
  fr: { title: "✈️ Planifie ton premier voyage", body: "Où iras-tu en premier ? Planera crée ton itinéraire en quelques secondes." },
  de: { title: "✈️ Plane deine erste Reise", body: "Wohin geht's zuerst? Planera erstellt deinen Reiseplan in Sekunden." },
  ar: { title: "✈️ خطط لرحلتك الأولى", body: "إلى أين ستذهب أولاً؟ يُنشئ Planera مسار رحلتك في ثوانٍ." },
};

/**
 * Admin action: send a push notification to every signed-up user who has
 * never created a trip yet. Useful for onboarding nudges.
 */
export const broadcastFirstTripNudge = action({
  args: {
    adminKey: v.string(),
    // Optional: custom title/body for a single language (legacy).
    customTitle: v.optional(v.string()),
    customBody: v.optional(v.string()),
    // Optional: per-language custom copy. Keys are 2-letter lang codes
    // (en/el/es/fr/de/ar). Falls back to "en" entry if a user's language
    // is missing. Takes priority over customTitle/customBody.
    customCopy: v.optional(
      v.record(
        v.string(),
        v.object({ title: v.string(), body: v.string() })
      )
    ),
    // Optional: dry-run — just count targets, don't actually send.
    dryRun: v.optional(v.boolean()),
    // Optional: skip users who received a first_trip_nudge within the last N
    // days. Defaults to 7 days to prevent re-spamming the same users.
    cooldownDays: v.optional(v.float64()),
    // Optional: only target users who already received a previous
    // first_trip_nudge (used for apology/correction follow-ups).
    onlyPreviouslyNotified: v.optional(v.boolean()),
    // Optional: send to ALL users (even those who already have trips).
    // Use sparingly — for global announcements.
    includeUsersWithTrips: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    targeted: number;
    sent: number;
    skipped: number;
    broadcastId: string | null;
    matched?: number;
    skipReasons?: { noToken: number; optedOut: number; frequencyCapped: number; pushError: number };
  }> => {
    const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
    if (!expected) throw new ConvexError("CONVEX_LOW_FARE_ADMIN_KEY environment variable not set");
    if (args.adminKey !== expected) throw new ConvexError("Unauthorized: invalid admin key");

    const cooldownDays = args.cooldownDays ?? 7;
    const skipIfNotifiedWithinMs = cooldownDays > 0 ? cooldownDays * 24 * 60 * 60 * 1000 : undefined;

    const users: Array<{ userId: string; language?: string }> =
      await ctx.runQuery(internal.lowFareRadar.getUsersWithoutTrips, {
        skipIfNotifiedWithinMs,
        onlyPreviouslyNotified: args.onlyPreviouslyNotified,
        includeUsersWithTrips: args.includeUsersWithTrips,
      });

    // Hydrate tokens + master push preference in one pass. Done before the
    // dry-run returns so the preview count is the deliverable count, not the
    // raw match count.
    const hydrated: {
      recipients: Array<{ userId: string; language?: string; tokens: Array<{ tokenId: any; token: string }> }>;
      noToken: number;
      optedOut: number;
    } = await ctx.runQuery(internal.lowFareRadar.hydrateNudgeRecipients, {
      userIds: users.map((u) => u.userId),
    });

    if (args.dryRun) {
      return {
        targeted: hydrated.recipients.length,
        sent: 0,
        skipped: 0,
        broadcastId: null,
        matched: users.length,
        skipReasons: { noToken: hydrated.noToken, optedOut: hydrated.optedOut, frequencyCapped: 0, pushError: 0 },
      };
    }

    const hasCustom = !!(args.customCopy || args.customTitle || args.customBody);
    const previewEn = args.customCopy?.en
      ?? (args.customTitle || args.customBody
        ? { title: args.customTitle || "", body: args.customBody || "" }
        : null);

    const broadcastId: any = await ctx.runMutation(internal.lowFareRadar.createBroadcastLog, {
      origins: [],
      mode: hasCustom ? "first_trip_custom" : "first_trip_nudge",
      customTitle: previewEn?.title,
      customBody: previewEn?.body,
      routeSnapshot: args.includeUsersWithTrips
        ? "Everyone (global broadcast)"
        : args.onlyPreviouslyNotified
        ? "Follow-up: previously notified"
        : "First-trip nudge",
      targeted: hydrated.recipients.length,
      variantId: hasCustom ? "custom" : "nudge",
      status: "sending",
    });

    type Msg = { userId: string; tokenId: any; token: string; title: string; body: string; data: any };
    const perUser: Msg[][] = hydrated.recipients.map((r) => {
      const lang = (r.language || "en").toLowerCase();
      const tpl = FIRST_TRIP_NUDGE_COPY[lang] || FIRST_TRIP_NUDGE_COPY.en;

      // Resolve copy: per-language map → single custom string → auto template.
      let title: string;
      let body: string;
      if (args.customCopy) {
        const entry = args.customCopy[lang] || args.customCopy.en;
        title = entry?.title || args.customTitle || tpl.title;
        body = entry?.body || args.customBody || tpl.body;
      } else {
        title = args.customTitle ?? tpl.title;
        body = args.customBody ?? tpl.body;
      }

      return r.tokens.map((t) => ({
        userId: r.userId,
        tokenId: t.tokenId,
        token: t.token,
        title,
        body,
        data: { screen: "create-trip", broadcastId: String(broadcastId) },
      }));
    });

    const CHUNK = 100;
    let sent = 0;
    let pushError = 0;
    let cancelled = false;
    let batch: Msg[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const res: any = await ctx.runAction(internal.notifications.sendExpoBatch, {
        messages: batch,
        // type "deal_..." would respect dealAlerts; this is an onboarding
        // nudge so we use a neutral type that only respects the master
        // pushNotifications toggle (already applied when hydrating).
        type: "first_trip_nudge",
      });
      sent += res.deliveredUserIds.length;
      pushError += res.failedUserIds.length;
      batch = [];
    };

    for (const userMsgs of perUser) {
      if (batch.length + userMsgs.length > CHUNK) {
        await flush();
        const check: any = await ctx.runQuery(internal.lowFareRadar.getBroadcastRow, { broadcastId });
        if (check?.cancelRequested) { cancelled = true; break; }
      }
      batch.push(...userMsgs);
    }
    if (!cancelled) await flush();

    await ctx.runMutation(internal.lowFareRadar.finalizeBroadcastLog, {
      broadcastId,
      sent,
      skipped: pushError,
      status: cancelled ? "cancelled" : "sent",
      skipReasons: {
        noToken: hydrated.noToken,
        optedOut: hydrated.optedOut,
        frequencyCapped: 0,
        pushError,
      },
    });

    return {
      targeted: hydrated.recipients.length,
      sent,
      skipped: pushError,
      broadcastId: String(broadcastId),
      matched: users.length,
      skipReasons: {
        noToken: hydrated.noToken,
        optedOut: hydrated.optedOut,
        frequencyCapped: 0,
        pushError,
      },
    };
  },
});

/**
 * Internal: attach device tokens + master push preference to a list of nudge
 * targets. Nudges are onboarding messages, so `dealAlerts` does not apply —
 * only the master `pushNotifications` toggle.
 */
export const hydrateNudgeRecipients = internalQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const wanted = new Set(args.userIds);
    const allSettings = await ctx.db.query("userSettings").collect();
    const settingsByUser = new Map<string, any>();
    for (const s of allSettings) {
      if (s.userId && wanted.has(s.userId)) settingsByUser.set(s.userId, s);
    }

    const tokensByUser = new Map<string, Array<{ tokenId: any; token: string }>>();
    const allTokens = await ctx.db.query("pushTokens").collect();
    for (const t of allTokens) {
      if (!wanted.has(t.userId)) continue;
      const list = tokensByUser.get(t.userId) || [];
      list.push({ tokenId: t._id, token: t.token });
      tokensByUser.set(t.userId, list);
    }

    const recipients: Array<{ userId: string; language?: string; tokens: Array<{ tokenId: any; token: string }> }> = [];
    let noToken = 0;
    let optedOut = 0;

    for (const userId of args.userIds) {
      const s = settingsByUser.get(userId);
      if (s && s.pushNotifications === false) { optedOut++; continue; }
      const tokens = tokensByUser.get(userId);
      if (!tokens || tokens.length === 0) { noToken++; continue; }
      recipients.push({ userId, language: s?.language, tokens });
    }

    return { recipients, noToken, optedOut };
  },
});

// ─── Broadcast logging (internal mutations + admin queries + tap tracking) ───

export const createBroadcastLog = internalMutation({
  args: {
    dealId: v.optional(v.id("lowFareRadar")),
    origins: v.array(v.string()),
    mode: v.string(),
    customTitle: v.optional(v.string()),
    customBody: v.optional(v.string()),
    routeSnapshot: v.optional(v.string()),
    targeted: v.float64(),
    variantId: v.optional(v.string()),
    status: v.optional(v.string()),
    scheduledFor: v.optional(v.float64()),
    wishlistTargeted: v.optional(v.boolean()),
    params: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notificationBroadcasts", {
      dealId: args.dealId,
      origins: args.origins,
      mode: args.mode,
      customTitle: args.customTitle,
      customBody: args.customBody,
      routeSnapshot: args.routeSnapshot,
      targeted: args.targeted,
      sent: 0,
      skipped: 0,
      taps: 0,
      uniqueTaps: 0,
      createdAt: Date.now(),
      variantId: args.variantId,
      status: args.status ?? "sending",
      scheduledFor: args.scheduledFor,
      wishlistTargeted: args.wishlistTargeted,
      params: args.params,
    });
  },
});

/** Internal: read a broadcast row (used by the send loop + cancel checks). */
export const getBroadcastRow = internalQuery({
  args: { broadcastId: v.id("notificationBroadcasts") },
  handler: async (ctx, args) => await ctx.db.get(args.broadcastId),
});

/** Internal: patch arbitrary lifecycle fields on a broadcast row. */
export const patchBroadcast = internalMutation({
  args: {
    broadcastId: v.id("notificationBroadcasts"),
    status: v.optional(v.string()),
    targeted: v.optional(v.float64()),
    scheduledJobId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.targeted !== undefined) patch.targeted = args.targeted;
    if (args.scheduledJobId !== undefined) patch.scheduledJobId = args.scheduledJobId;
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.broadcastId, patch);
  },
});

export const finalizeBroadcastLog = internalMutation({
  args: {
    broadcastId: v.id("notificationBroadcasts"),
    sent: v.float64(),
    skipped: v.float64(),
    status: v.optional(v.string()),
    skipReasons: v.optional(v.object({
      noToken: v.optional(v.float64()),
      optedOut: v.optional(v.float64()),
      frequencyCapped: v.optional(v.float64()),
      pushError: v.optional(v.float64()),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      sent: args.sent,
      skipped: args.skipped,
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.skipReasons !== undefined ? { skipReasons: args.skipReasons } : {}),
    });
  },
});

/**
 * Called by the app when a user taps a deal-broadcast notification.
 * Auth is intentionally light — we only need to verify the user is logged in
 * via their session token. Tap counts are coarse engagement metrics, not
 * security-sensitive data.
 */
export const trackBroadcastTap = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("notificationBroadcasts"),
  },
  handler: async (ctx, args) => {
    // Validate session token
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      // Silently no-op rather than throw — analytics shouldn't break the UX
      return null;
    }

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) return null;

    // Always increment total taps
    const newTaps = (broadcast.taps ?? 0) + 1;

    // Check if this user has tapped before to compute uniqueTaps
    const previousTap = await ctx.db
      .query("notificationBroadcastTaps")
      .withIndex("by_broadcast_user", (q) =>
        q.eq("broadcastId", args.broadcastId).eq("userId", session.userId)
      )
      .first();

    let newUniqueTaps = broadcast.uniqueTaps ?? 0;
    if (!previousTap) {
      newUniqueTaps += 1;
      await ctx.db.insert("notificationBroadcastTaps", {
        broadcastId: args.broadcastId,
        userId: session.userId,
        tappedAt: Date.now(),
      });
    }

    await ctx.db.patch(args.broadcastId, {
      taps: newTaps,
      uniqueTaps: newUniqueTaps,
    });
    return null;
  },
});

/** Admin: list recent broadcasts for the analytics tab. */
export const listBroadcasts = query({
  args: {
    adminKey: v.string(),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const limit = args.limit ?? 100;
    const rows = await ctx.db
      .query("notificationBroadcasts")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);

    // Enrich with deal route info if the deal still exists
    const enriched = await Promise.all(
      rows.map(async (b) => {
        let dealInfo: any = null;
        if (b.dealId) {
          const deal = await ctx.db.get(b.dealId);
          if (deal) {
            dealInfo = {
              origin: deal.origin,
              originCity: deal.originCity,
              destination: deal.destination,
              destinationCity: deal.destinationCity,
              price: deal.price,
              currency: deal.currency,
              active: deal.active,
              deletedAt: deal.deletedAt,
            };
          }
        }
        return { ...b, dealInfo };
      })
    );

    return enriched;
  },
});

/**
 * Admin: how many people who tapped this broadcast actually started a trip.
 *
 * Tap-through was the end of the funnel before this — but a push exists to
 * produce trips, not taps. Computed on demand (per row the admin expands)
 * rather than in listBroadcasts, which would make the list query heavy.
 */
export const getBroadcastConversions = query({
  args: {
    adminKey: v.string(),
    broadcastId: v.id("notificationBroadcasts"),
    // Trips created within this window after the tap count as converted.
    windowHours: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    validateAdminKey(args.adminKey);
    const windowMs = (args.windowHours ?? 72) * 60 * 60 * 1000;

    const taps = await ctx.db
      .query("notificationBroadcastTaps")
      .withIndex("by_broadcast", (q) => q.eq("broadcastId", args.broadcastId))
      .take(500);

    let converted = 0;
    let dealTrips = 0;
    for (const tap of taps) {
      const trips = await ctx.db
        .query("trips")
        .withIndex("by_user", (q) => q.eq("userId", tap.userId))
        .collect();
      const hit = trips.find(
        (t: any) => t._creationTime >= tap.tappedAt && t._creationTime <= tap.tappedAt + windowMs
      );
      if (hit) {
        converted++;
        if ((hit as any).tripType === "deal") dealTrips++;
      }
    }

    return {
      tapUsers: taps.length,
      converted,
      dealTrips,
      conversionRatePct: taps.length > 0 ? Math.round((converted / taps.length) * 1000) / 10 : 0,
      windowHours: args.windowHours ?? 72,
      truncated: taps.length === 500,
    };
  },
});



// ─── Broadcast translations / formatters ───
//
// Templates are ordered by priority. The first variant whose required vars are
// available for a deal is used. This lets us tailor the copy to deal context
// (% off, last-call expiry, round-trip, one-way) without bloating the action.
//
// Marketing principles applied:
//  • Hook = destination + price in the first ~30 chars (fits iOS lock screen).
//  • One emoji max per line (tested to feel premium, not spammy).
//  • Specifics over vague ("save 38%" beats "great deal").
//  • Urgency only when real (expiresAt within 48h).
//  • Single, clear CTA verb ("Tap to plan", "Lock it in", "Grab it").

type BroadcastVariant = {
  id: "lastCall" | "discount" | "roundTrip" | "oneWay";
  title: string;
  body: string;
};

const BROADCAST_VARIANTS: Record<string, BroadcastVariant[]> = {
  en: [
    {
      id: "lastCall",
      title: "⏰ Last call: {{dest}} {{currency}}{{price}}",
      body: "Your {{origin}} → {{dest}} deal expires soon. {{currency}}{{price}}/pp — tap to lock it in before it's gone.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% from {{origin}}",
      body: "{{origin}} → {{dest}} now {{currency}}{{price}}/pp (was {{currency}}{{originalPrice}}). Save {{currency}}{{savings}} — tap to grab it.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} from {{currency}}{{price}}",
      body: "Round-trip {{origin}} ↔ {{dest}} for {{currency}}{{price}} per person. Tap and your AI itinerary is ready in minutes.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} from {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} from just {{currency}}{{price}}/pp. Tap to see the deal and plan your trip.",
    },
  ],
  el: [
    {
      id: "lastCall",
      title: "⏰ Τελευταία ευκαιρία: {{dest}} {{currency}}{{price}}",
      body: "Η προσφορά {{origin}} → {{dest}} λήγει σύντομα. {{currency}}{{price}}/άτομο — πατήστε για να την κλειδώσετε.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% από {{origin}}",
      body: "{{origin}} → {{dest}} τώρα {{currency}}{{price}}/άτομο (ήταν {{currency}}{{originalPrice}}). Εξοικονομήστε {{currency}}{{savings}} — πατήστε για να κλείσετε.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} από {{currency}}{{price}}",
      body: "Με επιστροφή {{origin}} ↔ {{dest}} {{currency}}{{price}} το άτομο. Πατήστε και το AI φτιάχνει το ταξίδι σε λίγα λεπτά.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} από {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} από μόλις {{currency}}{{price}}/άτομο. Πατήστε για την προσφορά και σχεδιάστε το ταξίδι.",
    },
  ],
  es: [
    {
      id: "lastCall",
      title: "⏰ Última llamada: {{dest}} {{currency}}{{price}}",
      body: "Tu oferta {{origin}} → {{dest}} caduca pronto. {{currency}}{{price}}/pers — tócala para reservarla antes de que vuele.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% desde {{origin}}",
      body: "{{origin}} → {{dest}} ahora {{currency}}{{price}}/pers (antes {{currency}}{{originalPrice}}). Ahorra {{currency}}{{savings}} — tócala ya.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} desde {{currency}}{{price}}",
      body: "Ida y vuelta {{origin}} ↔ {{dest}} por {{currency}}{{price}} por persona. Tócala y tu itinerario IA está listo en minutos.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} desde {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} desde solo {{currency}}{{price}}/pers. Tócala para ver la oferta y planear el viaje.",
    },
  ],
  fr: [
    {
      id: "lastCall",
      title: "⏰ Dernier appel : {{dest}} {{currency}}{{price}}",
      body: "Votre offre {{origin}} → {{dest}} expire bientôt. {{currency}}{{price}}/pers — appuyez pour la sécuriser.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% depuis {{origin}}",
      body: "{{origin}} → {{dest}} à {{currency}}{{price}}/pers (au lieu de {{currency}}{{originalPrice}}). Économisez {{currency}}{{savings}} — appuyez pour foncer.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} dès {{currency}}{{price}}",
      body: "Aller-retour {{origin}} ↔ {{dest}} à {{currency}}{{price}} par personne. Appuyez : votre itinéraire IA est prêt en quelques minutes.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} dès {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} dès {{currency}}{{price}}/pers. Appuyez pour voir l'offre et planifier votre voyage.",
    },
  ],
  de: [
    {
      id: "lastCall",
      title: "⏰ Letzte Chance: {{dest}} {{currency}}{{price}}",
      body: "Dein Deal {{origin}} → {{dest}} läuft bald aus. {{currency}}{{price}}/Pers. — jetzt tippen und sichern.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% ab {{origin}}",
      body: "{{origin}} → {{dest}} jetzt {{currency}}{{price}}/Pers. (statt {{currency}}{{originalPrice}}). Spare {{currency}}{{savings}} — gleich tippen.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} ab {{currency}}{{price}}",
      body: "Hin & zurück {{origin}} ↔ {{dest}} für {{currency}}{{price}} pro Person. Tippen — dein KI-Reiseplan ist in wenigen Minuten fertig.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} ab {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} ab nur {{currency}}{{price}}/Pers. Tippen, um den Deal zu sehen und zu planen.",
    },
  ],
  ar: [
    {
      id: "lastCall",
      title: "⏰ آخر فرصة: {{dest}} {{currency}}{{price}}",
      body: "عرض {{origin}} → {{dest}} ينتهي قريبًا. {{currency}}{{price}} للشخص — اضغط لتأمينه الآن.",
    },
    {
      id: "discount",
      title: "✈️ {{dest}} −{{discount}}% من {{origin}}",
      body: "{{origin}} → {{dest}} الآن {{currency}}{{price}} للشخص (بدلًا من {{currency}}{{originalPrice}}). وفّر {{currency}}{{savings}} — اضغط الآن.",
    },
    {
      id: "roundTrip",
      title: "✈️ {{origin}} ↔ {{dest}} من {{currency}}{{price}}",
      body: "ذهاب وعودة {{origin}} ↔ {{dest}} بـ {{currency}}{{price}} للشخص. اضغط ليجهّز الذكاء الاصطناعي رحلتك خلال دقائق.",
    },
    {
      id: "oneWay",
      title: "✈️ {{dest}} من {{currency}}{{price}}",
      body: "{{origin}} → {{dest}} من {{currency}}{{price}} فقط للشخص. اضغط لرؤية العرض وتخطيط الرحلة.",
    },
  ],
};

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

/** Choose the best variant for a deal: lastCall > discount(≥15%) > roundTrip > oneWay. */
function pickBroadcastVariant(lang: string, deal: any): { variant: BroadcastVariant; vars: Record<string, string> } {
  const variants = BROADCAST_VARIANTS[lang] || BROADCAST_VARIANTS.en;
  const byId = (id: BroadcastVariant["id"]) =>
    variants.find((v) => v.id === id) ||
    BROADCAST_VARIANTS.en.find((v) => v.id === id)!;

  const baseVars: Record<string, string> = {
    dest: deal.destinationCity || deal.destination,
    origin: deal.originCity || deal.origin,
    currency: currencySymbol(deal.currency),
    price: formatPrice(deal.price),
  };

  // 1. Last call — expires within 48h
  if (deal.expiresAt && deal.expiresAt - Date.now() <= FORTY_EIGHT_HOURS && deal.expiresAt > Date.now()) {
    return { variant: byId("lastCall"), vars: baseVars };
  }

  // 2. Discount ≥ 15%
  if (deal.originalPrice && deal.price && deal.originalPrice > deal.price) {
    const discountPct = Math.round((1 - deal.price / deal.originalPrice) * 100);
    if (discountPct >= 15) {
      return {
        variant: byId("discount"),
        vars: {
          ...baseVars,
          discount: String(discountPct),
          originalPrice: formatPrice(deal.originalPrice),
          savings: formatPrice(deal.originalPrice - deal.price),
        },
      };
    }
  }

  // 3. Round-trip
  if (deal.returnDate) {
    return { variant: byId("roundTrip"), vars: baseVars };
  }

  // 4. One-way / default
  return { variant: byId("oneWay"), vars: baseVars };
}

function buildBroadcastTitle(lang: string, deal: any): string {
  const { variant, vars } = pickBroadcastVariant(lang, deal);
  return interpolate(variant.title, vars);
}

function buildBroadcastBody(lang: string, deal: any): string {
  const { variant, vars } = pickBroadcastVariant(lang, deal);
  return interpolate(variant.body, vars);
}

function interpolate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), val);
  }
  return out;
}

function formatPrice(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n as any)) return "";
  // Strip trailing .00 for cleaner copy: 89 not 89.00
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function currencySymbol(code: string | undefined): string {
  switch ((code || "").toUpperCase()) {
    case "EUR": return "€";
    case "USD": return "$";
    case "GBP": return "£";
    default: return (code || "") + " ";
  }
}
