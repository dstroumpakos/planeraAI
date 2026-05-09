import { query, mutation, internalMutation, internalQuery, action } from "./_generated/server";
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

/**
 * Admin action: send a deal-alert push notification to every user whose home
 * airport matches the deal's origin (or any of the optional `originsOverride`).
 * Returns counts so the admin widget can show a summary.
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
  },
  handler: async (ctx, args): Promise<{ targeted: number; sent: number; skipped: number; broadcastId: string }> => {
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

    // Find matching users
    const users: Array<{ userId: string; language?: string; homeAirport: string }> =
      await ctx.runQuery(internal.lowFareRadar.getUsersByHomeAirport, { origins });

    // Create a broadcast log row up front so we can include its id in the push
    // payload. Counts are patched in once we know them.
    const broadcastId: any = await ctx.runMutation(internal.lowFareRadar.createBroadcastLog, {
      dealId: args.dealId,
      origins,
      mode: args.customTitle || args.customBody ? "custom" : "auto",
      customTitle: args.customTitle,
      customBody: args.customBody,
      routeSnapshot: `${finalDeal.origin} → ${finalDeal.destination}`,
      targeted: users.length,
    });

    let sent = 0;
    let skipped = 0;

    for (const u of users) {
      const lang = u.language || "en";
      const title = args.customTitle ?? buildBroadcastTitle(lang, finalDeal);
      const body = args.customBody ?? buildBroadcastBody(lang, finalDeal);

      try {
        await ctx.runAction(internal.notifications.sendPushNotification, {
          userId: u.userId,
          title,
          body,
          // type begins with "deal" → respects user's dealAlerts preference
          type: "deal_broadcast",
          data: {
            screen: "deal-trip",
            dealId: args.dealId,
            // broadcastId lets the app attribute taps back to this broadcast row
            broadcastId: String(broadcastId),
            origin: finalDeal.origin,
            originCity: finalDeal.originCity,
            destination: finalDeal.destination,
            destinationCity: finalDeal.destinationCity,
          },
        });
        sent++;
      } catch (err) {
        console.error(`broadcastDealToHomeAirports: failed for user ${u.userId}`, err);
        skipped++;
      }
    }

    // Patch final counts
    await ctx.runMutation(internal.lowFareRadar.finalizeBroadcastLog, {
      broadcastId,
      sent,
      skipped,
    });

    return { targeted: users.length, sent, skipped, broadcastId: String(broadcastId) };
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
    });
  },
});

export const finalizeBroadcastLog = internalMutation({
  args: {
    broadcastId: v.id("notificationBroadcasts"),
    sent: v.float64(),
    skipped: v.float64(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      sent: args.sent,
      skipped: args.skipped,
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
