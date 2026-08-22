// Read-only reporting on how much Mapbox API volume the trip pipeline actually
// generates, bucketed by month.
//
// Exists to answer one question with a number instead of a guess: what does a
// month of Planera cost against each Mapbox SKU, and specifically how many
// geocoding results end up STORED on trip documents (which Mapbox bills as
// permanent geocoding, a different SKU from temporary lookups).
//
// Nothing here writes. Run it from the CLI:
//   npx convex run mapboxUsage:report --prod
//   npx convex run mapboxUsage:report --prod '{"months": 12}'

import { v } from "convex/values";
import { internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many Search Box requests one activity costs on average.
 *
 * geocodeActivityMapbox tries up to three query strings (address, cleaned
 * title, raw title) and stops at the first plausible hit, so the true figure is
 * between 1 and 3. 1.4 assumes most activities resolve on their first or second
 * try - deliberately conservative rather than optimistic, since the point of
 * this report is to avoid understating a bill.
 */
const GEOCODE_ATTEMPTS_PER_ACTIVITY = 1.4;

/** One page of trips, reduced to just the counts this report needs. */
export const listTripCountsPage = internalQuery({
    args: {
        cursor: v.union(v.string(), v.null()),
        numItems: v.float64(),
    },
    returns: v.any(),
    handler: async (ctx: any, args: any) => {
        // Newest first, so the caller can stop as soon as it walks past its window.
        const page = await ctx.db
            .query("trips")
            .order("desc")
            .paginate({ cursor: args.cursor, numItems: args.numItems });

        const trips = page.page.map((trip: any) => {
            const days = Array.isArray(trip.itinerary?.dayByDayItinerary)
                ? trip.itinerary.dayByDayItinerary
                : [];
            let activities = 0;
            let storedCoords = 0;
            let daysWithMap = 0;
            for (const day of days) {
                const list = Array.isArray(day?.activities) ? day.activities : [];
                activities += list.length;
                for (const a of list) {
                    if (typeof a?.lat === "number" && typeof a?.lng === "number") storedCoords++;
                }
                if (day?.mapImageUrl) daysWithMap++;
            }
            return {
                createdAt: trip._creationTime,
                status: trip.status,
                days: days.length,
                activities,
                storedCoords,
                daysWithMap,
            };
        });

        return { trips, isDone: page.isDone, continueCursor: page.continueCursor };
    },
});

/**
 * Monthly Mapbox request volume, derived from real trip data.
 *
 * Per-SKU, because Mapbox prices them separately - a number that looks fine
 * against Static Images can still be a problem against permanent geocoding.
 */
export const report = internalAction({
    args: { months: v.optional(v.float64()) },
    returns: v.any(),
    handler: async (ctx: any, args: any) => {
        const months = args.months ?? 6;
        const since = Date.now() - months * 30 * DAY_MS;

        const buckets = new Map<
            string,
            { trips: number; days: number; activities: number; storedCoords: number; daysWithMap: number }
        >();
        let cursor: string | null = null;
        let scanned = 0;
        let reachedWindowEdge = false;

        // Trips arrive newest-first, so the first one older than the window ends
        // the scan - no point paging through years of history for a 6-month view.
        while (!reachedWindowEdge) {
            // Cast: _generated/api only learns about this file at deploy time.
            const page: any = await ctx.runQuery((internal as any).mapboxUsage.listTripCountsPage, {
                cursor,
                numItems: 200,
            });
            for (const trip of page.trips) {
                scanned++;
                if (trip.createdAt < since) {
                    reachedWindowEdge = true;
                    break;
                }
                const key = new Date(trip.createdAt).toISOString().slice(0, 7); // YYYY-MM
                const bucket = buckets.get(key) ?? {
                    trips: 0, days: 0, activities: 0, storedCoords: 0, daysWithMap: 0,
                };
                bucket.trips++;
                bucket.days += trip.days;
                bucket.activities += trip.activities;
                bucket.storedCoords += trip.storedCoords;
                bucket.daysWithMap += trip.daysWithMap;
                buckets.set(key, bucket);
            }
            if (page.isDone) break;
            cursor = page.continueCursor;
        }

        const rows = [...buckets.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .map(([month, b]) => ({
                month,
                trips: b.trips,
                days: b.days,
                activities: b.activities,
                // Coordinates persisted on trip documents = the permanent-geocoding exposure.
                storedCoords: b.storedCoords,
                // Per-SKU request estimates for the CURRENT (post-Mapbox) pipeline.
                est: {
                    // Search Box: one destination lookup per trip + attempts per activity.
                    geocode: Math.round(b.trips + b.activities * GEOCODE_ATTEMPTS_PER_ACTIVITY),
                    // One Directions call per day with 2+ stops.
                    directions: b.days,
                    // One Isochrone call per day (walkability).
                    isochrone: b.days,
                    // One Static Image per day, fetched by every client that views it.
                    staticImages: b.daysWithMap,
                },
            }));

        const recent = rows.slice(0, 3);
        const avg = (pick: (r: any) => number) =>
            recent.length ? Math.round(recent.reduce((s, r) => s + pick(r), 0) / recent.length) : 0;

        const summary = {
            windowMonths: months,
            tripsScanned: scanned,
            monthly: rows,
            last3MonthAverage: {
                trips: avg((r) => r.trips),
                activities: avg((r) => r.activities),
                storedCoords: avg((r) => r.storedCoords),
                geocodeRequests: avg((r) => r.est.geocode),
                directionsRequests: avg((r) => r.est.directions),
                isochroneRequests: avg((r) => r.est.isochrone),
                staticImageRequests: avg((r) => r.est.staticImages),
            },
            note:
                `geocode estimate assumes ${GEOCODE_ATTEMPTS_PER_ACTIVITY} Search Box attempts per activity; ` +
                `storedCoords is the permanent-geocoding exposure (coordinates written to trip documents). ` +
                `staticImages counts days with a cached map URL - actual image requests scale with VIEWS, not days.`,
        };

        console.log("[mapbox-usage]", JSON.stringify(summary, null, 2));
        return summary;
    },
});
