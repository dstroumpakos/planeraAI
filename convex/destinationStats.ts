import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { resolveSpendStay } from "./trips";

// Sibling functions defined in this file aren't in the generated types until
// `convex dev`/`codegen` runs, so the action references them through `any`.
// Every runQuery result is annotated by hand, same as adminKpis.ts.
const internal = _internal as any;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRENDING_WINDOW_MS = 30 * DAY_MS;

/**
 * Per-page read ceiling for the completed-trips scan. Trip rows are the fat
 * ones — they carry the whole generated `itinerary` blob (~57 KB average, a few
 * hundred KB for long multi-city trips) — so cap a page at 2 MB, well under the
 * 16 MB per-transaction limit. When the cap truncates a page, `paginate`
 * returns fewer rows with `isDone: false` and the scan resumes from the cursor.
 */
const TRIPS_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const TRIPS_PAGE_ITEMS = 25;
/** Safety valve so one run can't loop forever; ~50k trips at 25/page. */
const MAX_PAGES = 2000;
/** Keep the singleton small: only the busiest destinations are ever rendered. */
const MAX_DESTINATIONS = 300;
const MAX_TRENDING = 5;
/** Distinct interests tracked per destination before we stop collecting. */
const MAX_INTERESTS_TRACKED = 12;

interface TripRow {
    destination: string;
    budget?: number;
    interests: string[];
    creationTime: number;
}

/**
 * One page of completed trips, projected down to the four fields the aggregate
 * needs. Projecting shrinks what crosses the wire, not what's READ — Convex has
 * no column projection — which is exactly why `maximumBytesRead` is the thing
 * keeping each execution inside its budget.
 */
export const _completedTripsPage = internalQuery({
    args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
    handler: async (ctx, { cursor, numItems }) => {
        const res = await ctx.db
            .query("trips")
            .withIndex("by_status", (q) => q.eq("status", "completed"))
            .paginate({ cursor, numItems, maximumBytesRead: TRIPS_PAGE_MAX_BYTES });

        const rows: TripRow[] = res.page.map((t: any) => ({
            destination: typeof t.destination === "string" ? t.destination : "",
            budget:
                typeof t.budgetTotal === "number"
                    ? t.budgetTotal
                    : typeof t.budget === "number"
                        ? t.budget
                        : typeof t.budget === "string" && !isNaN(parseFloat(t.budget))
                            ? parseFloat(t.budget)
                            : undefined,
            // Older rows predate the required `interests` field.
            interests: Array.isArray(t.interests) ? t.interests : [],
            creationTime: t._creationTime,
        }));
        return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
    },
});

/**
 * City-only display name: drop the country, collapse whitespace, title-case.
 * Mirrors what the old inline `getAllDestinations` aggregation did so the
 * /destinations screen keeps grouping "Rome, Italy" and "rome" together.
 */
function normalizeDestination(dest: string): string {
    let normalized = dest.trim();
    if (normalized.includes(",")) {
        normalized = normalized.split(",")[0].trim();
    }
    return normalized
        .toLowerCase()
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

interface Bucket {
    displayName: string;
    count: number;
    budgetSum: number;
    budgetN: number;
    interests: Set<string>;
}

function bucketFor(map: Map<string, Bucket>, key: string, displayName: string): Bucket {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = { displayName, count: 0, budgetSum: 0, budgetN: 0, interests: new Set() };
        map.set(key, bucket);
    }
    return bucket;
}

function addTrip(bucket: Bucket, row: TripRow) {
    bucket.count += 1;
    if (typeof row.budget === "number" && !isNaN(row.budget)) {
        bucket.budgetSum += row.budget;
        bucket.budgetN += 1;
    }
    if (bucket.interests.size < MAX_INTERESTS_TRACKED) {
        for (const interest of row.interests) bucket.interests.add(interest);
    }
}

/**
 * @param unwtoOnly Trending Now shows a price only when it's a REAL UN Tourism
 * figure, never a curated internal estimate — matching the old behaviour.
 */
function toEntries(map: Map<string, Bucket>, limit: number, unwtoOnly: boolean) {
    return [...map.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map((data) => {
            const s = resolveSpendStay(data.displayName);
            const useSpend = !unwtoOnly || s.spendSource === "unwto";
            return {
                destination: data.displayName,
                count: data.count,
                avgBudget: data.budgetN > 0 ? data.budgetSum / data.budgetN : 0,
                avgTripSpend: useSpend ? s.avgTripSpend : null,
                spendCurrency: s.spendCurrency,
                spendLevel: useSpend ? s.spendLevel : null,
                spendSource: useSpend ? s.spendSource : null,
                interests: [...data.interests].slice(0, 3),
            };
        });
}

/**
 * Recompute the destination aggregates singleton (cron: every 6h).
 *
 * The /destinations screen used to aggregate every completed trip inside a
 * client-facing query. Once the trips table grew past ~300 completed trips that
 * `.collect()` exceeded Convex's 16 MB per-transaction read limit, the query
 * threw, `useQuery` rethrew during render, and the root ErrorBoundary took the
 * whole app down when the user tapped "See all". Paging the scan here — one
 * read budget per page — keeps it inside the limit no matter how large the
 * table gets, and the screens read one small document.
 */
export const recomputeDestinationStats = internalAction({
    args: {},
    handler: async (ctx) => {
        const startedAt = Date.now();
        const trendingCutoff = startedAt - TRENDING_WINDOW_MS;

        const allMap = new Map<string, Bucket>();
        const trendingMap = new Map<string, Bucket>();

        let cursor: string | null = null;
        let tripsScanned = 0;
        let partial = false;

        for (let page = 0; page < MAX_PAGES; page++) {
            const res: { rows: TripRow[]; isDone: boolean; continueCursor: string } =
                await ctx.runQuery(internal.destinationStats._completedTripsPage, {
                    cursor,
                    numItems: TRIPS_PAGE_ITEMS,
                });

            for (const row of res.rows) {
                if (!row.destination) continue;
                tripsScanned++;

                const normalized = normalizeDestination(row.destination);
                addTrip(bucketFor(allMap, normalized, normalized), row);

                // Trending groups on the RAW destination string ("Rome, Italy"),
                // which is what resolves to a UNWTO country figure.
                if (row.creationTime >= trendingCutoff) {
                    addTrip(bucketFor(trendingMap, row.destination, row.destination), row);
                }
            }

            if (res.isDone) break;
            if (res.continueCursor === cursor) {
                console.error("[destination-stats] cursor stopped advancing, stopping scan");
                partial = true;
                break;
            }
            cursor = res.continueCursor;
            if (page + 1 >= MAX_PAGES) {
                console.error(`[destination-stats] hit ${MAX_PAGES}-page cap, aggregate is partial`);
                partial = true;
            }
        }

        await ctx.runMutation(internal.destinationStats._writeDestinationStats, {
            data: {
                computedAt: startedAt,
                durationMs: Date.now() - startedAt,
                tripsScanned,
                partial,
                all: toEntries(allMap, MAX_DESTINATIONS, false),
                trending: toEntries(trendingMap, MAX_TRENDING, true),
            },
        });

        console.log(
            `[destination-stats] ${tripsScanned} completed trips → ${allMap.size} destinations ` +
            `(${Date.now() - startedAt}ms${partial ? ", PARTIAL" : ""})`,
        );
        return null;
    },
});

export const _writeDestinationStats = internalMutation({
    args: { data: v.any() },
    handler: async (ctx, { data }) => {
        const existing = await ctx.db.query("destinationStats").first();
        if (existing) {
            await ctx.db.patch(existing._id, data);
        } else {
            await ctx.db.insert("destinationStats", data);
        }
        return null;
    },
});
