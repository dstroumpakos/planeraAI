import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Public (no auth) stats for the landing page.
 *
 * Reads a cached singleton instead of scanning the (large) trips table on every
 * request. The singleton is recomputed by the `recompute-landing-stats` cron.
 * Returns zeros until the first recompute has run.
 */
export const getLandingStats = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db.query("landingStats").first();
    return {
      tripsCount: stats?.tripsCount ?? 0,
      usersCount: stats?.usersCount ?? 0,
      destinationsCount: stats?.destinationsCount ?? 0,
    };
  },
});

/**
 * Public (no auth) feed of recently generated trips for the landing page's
 * "live" ticker. Anonymized on purpose — returns only the destination and the
 * creation time, never any user-identifying fields.
 */
export const getRecentPublicTrips = query({
  args: {},
  handler: async (ctx) => {
    const trips = await ctx.db
      .query("trips")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .order("desc")
      .take(15);

    // Coarsen the creation time to midnight UTC. The ticker only needs rough
    // recency ("today / a few days ago"); exposing the exact millisecond let
    // anyone enumerate precise trip-creation timing, so we truncate to the day.
    const DAY_MS = 24 * 60 * 60 * 1000;
    return trips.map((t) => ({
      destination: t.destination,
      createdAt: Math.floor(t._creationTime / DAY_MS) * DAY_MS,
    }));
  },
});

// Normalise a "City, Country" destination → country (or the city if no comma),
// matching the behaviour the landing page expects.
function normaliseDestination(destination: string | undefined): string | null {
  if (!destination) return null;
  const parts = destination.split(",").map((s) => s.trim());
  if (parts.length >= 2) return parts[parts.length - 1] || null;
  return parts[0] || null;
}

// One page of trips. Reads full docs (Convex can't project columns) but only a
// small page at a time, so a single execution stays well under the byte limit.
// Returns only the small fields the aggregates need — never full docs.
export const _tripsStatsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("trips").paginate({ cursor, numItems });
    // Raw destinations (for top-destinations) and a completed-trip tally.
    const rawDestinations: string[] = [];
    let completedCount = 0;
    for (const t of res.page) {
      if (t.destination) rawDestinations.push(t.destination);
      if (t.status === "completed") completedCount += 1;
    }
    return {
      rawDestinations,
      completedCount,
      count: res.page.length,
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

// One page of users — only the count is needed.
export const _usersCountPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("userSettings").paginate({ cursor, numItems });
    return {
      count: res.page.length,
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

export const _writeLandingStats = internalMutation({
  args: {
    tripsCount: v.number(),
    usersCount: v.number(),
    destinationsCount: v.number(),
    completedTripsCount: v.number(),
    topTripDestinations: v.array(
      v.object({ destination: v.string(), count: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("landingStats").first();
    const data = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("landingStats", data);
    }
    return null;
  },
});

/**
 * Recompute the cached landing stats by paginating the trips and users tables.
 * Each page is a separate query execution with its own byte budget, so this
 * scales past the per-execution read limit that the old single-`.collect()`
 * implementation hit. Run hourly by cron; also safe to invoke manually.
 */
export const recomputeLandingStats = internalAction({
  args: {},
  handler: async (ctx) => {
    // Trips: total count, completed count, unique destination countries, and
    // per-destination counts (for the admin top-destinations list).
    let tripsCount = 0;
    let completedTripsCount = 0;
    const countries = new Set<string>();
    const destCounts = new Map<string, number>();
    let cursor: string | null = null;
    for (;;) {
      // Explicit annotation breaks the self-referential type inference Convex
      // hits when an action calls queries defined in the same file.
      const res: {
        rawDestinations: string[];
        completedCount: number;
        count: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.publicStats._tripsStatsPage, {
        cursor,
        numItems: 50, // small page: itineraries are large, keep each read modest
      });
      tripsCount += res.count;
      completedTripsCount += res.completedCount;
      for (const raw of res.rawDestinations) {
        const country = normaliseDestination(raw);
        if (country) countries.add(country);
        destCounts.set(raw, (destCounts.get(raw) ?? 0) + 1);
      }
      if (res.isDone) break;
      cursor = res.continueCursor;
    }

    const topTripDestinations = Array.from(destCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([destination, count]) => ({ destination, count }));

    // Users: count only.
    let usersCount = 0;
    cursor = null;
    for (;;) {
      const res: { count: number; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.publicStats._usersCountPage, {
          cursor,
          numItems: 500,
        });
      usersCount += res.count;
      if (res.isDone) break;
      cursor = res.continueCursor;
    }

    await ctx.runMutation(internal.publicStats._writeLandingStats, {
      tripsCount,
      usersCount,
      destinationsCount: countries.size,
      completedTripsCount,
      topTripDestinations,
    });
    return null;
  },
});
