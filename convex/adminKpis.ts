import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { assertAdmin } from "./admin";

// Types won't include the functions defined in THIS file until `convex dev`
// regenerates them. Casting to `any` lets the action reference its own sibling
// queries without hitting the self-referential type-inference wall (the same
// trick crons.ts uses). We still annotate every runQuery result by hand so the
// aggregation code stays type-checked.
const internal = _internal as any;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_WINDOW = 30; // days of history kept in the time-series

// Subscription prices used for the MRR/ARR estimate. Configurable via env so
// the numbers stay accurate if pricing changes; defaults are placeholders.
function subscriptionPrices() {
  const monthly = Number(process.env.KPI_PRICE_MONTHLY_EUR ?? "4.99") || 0;
  const yearly = Number(process.env.KPI_PRICE_YEARLY_EUR ?? "29.99") || 0;
  return { monthly, yearly };
}

const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

// UTC "YYYY-MM-DD" for a timestamp.
function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ===========================================================================
// Token → userId (small copy of admin.ts's private helper, so getKpis can
// gate on the same session-token auth the rest of the admin surface uses).
// ===========================================================================
async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

// ===========================================================================
// PROJECTED PAGE QUERIES
// Each returns only the small fields the aggregation needs (never full docs —
// trips/insights carry large blobs), plus the pagination envelope. One page =
// one query execution with its own read budget, so this scales past the
// per-execution limit a single `.collect()` would hit.
//
// NOTE ON READ COST: projecting in JS shrinks the *returned* payload, not the
// bytes READ — Convex has no column projection, so every row costs its full
// document size. `trips` rows average ~57 KB (they carry the whole generated
// `itinerary` blob), which is why the trips scan is the one that shows up in
// dashboard Insights. `maximumBytesRead` below caps a page at the database
// layer, so no single execution can approach the 16 MB transaction limit no
// matter how many rows the paginator decides to scan.
// ===========================================================================

/**
 * Per-page read ceiling for the fat `trips` scan: 2 MB, i.e. 12% of the 16 MB
 * per-transaction limit. Well above any single trip document (the largest
 * multi-city itineraries are a few hundred KB), so a page always makes forward
 * progress; far enough below the limit that the "nearing bytes read" insight
 * can't fire. When the cap truncates a page, `paginate` returns fewer rows with
 * `isDone: false` and `scanAll` simply continues from `continueCursor`.
 */
const TRIPS_PAGE_MAX_BYTES = 2 * 1024 * 1024;

interface TripRow {
  status: string;
  startDate: number;
  endDate: number;
  travelers?: number;
  budget?: number;
  isMultiCity: boolean;
  deal: boolean;
  platform: string;
  language?: string;
  destination?: string;
  userId: string;
  creationTime: number;
}

export const _tripsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("trips").paginate({
      cursor,
      numItems,
      // Hard ceiling on bytes pulled into this transaction — see
      // TRIPS_PAGE_MAX_BYTES. Independent of `numItems`, which only bounds the
      // rows the paginator *returns*, not the bytes it reads getting there.
      maximumBytesRead: TRIPS_PAGE_MAX_BYTES,
    });
    const rows: TripRow[] = res.page.map((t: any) => ({
      status: t.status,
      startDate: t.startDate,
      endDate: t.endDate,
      travelers:
        typeof t.travelerCount === "number"
          ? t.travelerCount
          : typeof t.travelers === "number"
            ? t.travelers
            : undefined,
      budget:
        typeof t.budgetTotal === "number"
          ? t.budgetTotal
          : typeof t.budget === "number"
            ? t.budget
            : undefined,
      isMultiCity: t.isMultiCity === true,
      deal: t.tripType === "deal",
      platform: t.platform || "unknown",
      language: t.language,
      destination: t.destination,
      userId: t.userId,
      creationTime: t._creationTime,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

interface UserRow {
  userId: string;
  platform: string;
  authProvider: string;
  onboardingCompleted: boolean;
  aiConsent: boolean;
  creationTime: number;
}

export const _usersPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("userSettings").paginate({ cursor, numItems });
    const rows: UserRow[] = res.page.map((u: any) => ({
      userId: u.userId,
      platform: u.platform || "unknown",
      authProvider: u.authProvider || "unknown",
      onboardingCompleted: u.onboardingCompleted === true,
      aiConsent: u.aiDataConsent === true,
      creationTime: u._creationTime,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

interface PlanRow {
  plan: string;
  subscriptionType?: string;
  subscriptionExpiresAt?: number;
  // True when this premium plan was granted by a real Apple purchase (the IAP
  // path stamps lastTransactionId/originalTransactionId; admin grants never do).
  hasAppleTxn: boolean;
}

export const _plansPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("userPlans").paginate({ cursor, numItems });
    const rows: PlanRow[] = res.page.map((p: any) => ({
      plan: p.plan,
      subscriptionType: p.subscriptionType,
      subscriptionExpiresAt: p.subscriptionExpiresAt,
      hasAppleTxn: !!(p.lastTransactionId || p.originalTransactionId),
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

interface InsightRow {
  status: string;
  reported: boolean;
  // Carried so the same scan can accumulate the per-user counters behind the
  // admin user list (see userActivityStats in schema.ts).
  userId: string;
  likes: number;
}

export const _insightsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("insights").paginate({ cursor, numItems });
    const rows: InsightRow[] = res.page.map((i: any) => ({
      status: i.moderationStatus || "pending",
      reported: (i.reportsCount || 0) > 0,
      userId: i.userId,
      likes: typeof i.likes === "number" ? i.likes : 0,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _iapPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("iapTransactions").paginate({ cursor, numItems });
    const rows: { status: string }[] = res.page.map((t: any) => ({ status: t.status }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _referralsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("referrals").paginate({ cursor, numItems });
    const rows: { status: string }[] = res.page.map((r: any) => ({ status: r.status }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _streaksPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("userStreaks").paginate({ cursor, numItems });
    const rows: { current: number; longest: number }[] = res.page.map((s: any) => ({
      current: s.currentStreak || 0,
      longest: s.longestStreak || 0,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _pushTokensPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("pushTokens").paginate({ cursor, numItems });
    const rows: { userId: string }[] = res.page.map((t: any) => ({ userId: t.userId }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

// Retention inputs (see retention.ts). Activity days are bounded by
// DAU x RETENTION_WINDOW; the cron prunes anything older.
export const _activityDaysPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number(), sinceDay: v.string() },
  handler: async (ctx, { cursor, numItems, sinceDay }) => {
    const res = await ctx.db
      .query("userActivityDays")
      .withIndex("by_day", (q) => q.gte("day", sinceDay))
      .paginate({ cursor, numItems });
    const rows = res.page.map((r: any) => ({
      userId: r.userId as string,
      day: r.day as string,
      platform: (r.platform as string | undefined) || "unknown",
      tripActive: r.tripActive === true,
    }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _watchersPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("watchedDestinations").paginate({ cursor, numItems });
    const rows = res.page.map((r: any) => ({ userId: r.userId as string }));
    return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const _pruneActivityDays = internalMutation({
  args: { beforeDay: v.string(), limit: v.float64() },
  handler: async (ctx, { beforeDay, limit }) => {
    const stale = await ctx.db
      .query("userActivityDays")
      .withIndex("by_day", (q) => q.lt("day", beforeDay))
      .take(limit);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length };
  },
});

// ===========================================================================
// SMALL-TABLE AGGREGATES (operator-managed / low-volume tables). Each runs as
// its own query execution, so a `.collect()` here stays well under the budget.
// ===========================================================================

export const _otaAgg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const leads = await ctx.db.query("otaLeads").collect();
    const packages = await ctx.db.query("otaPackages").collect();
    const leadCounts = { total: 0, pending: 0, sent: 0, contacted: 0, converted: 0, closed: 0, failed: 0 };
    for (const l of leads as any[]) {
      leadCounts.total++;
      if (l.status in leadCounts) (leadCounts as any)[l.status]++;
    }
    let active = 0, totalViews = 0, totalLeads = 0;
    for (const p of packages as any[]) {
      if (p.active) active++;
      totalViews += p.viewCount || 0;
      totalLeads += p.leadCount || 0;
    }
    return { leadCounts, packages: { active, totalViews, totalLeads } };
  },
});

export const _affiliateAgg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const links = await ctx.db.query("attractionAffiliateLinks").collect();
    let activeLinks = 0, totalClicks = 0;
    for (const l of links as any[]) {
      if (l.active) activeLinks++;
      totalClicks += l.clicks || 0;
    }
    const topLinks = [...(links as any[])]
      .filter((l) => (l.clicks || 0) > 0)
      .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, 5)
      .map((l) => ({ title: l.displayTitle || l.activityTitle || "—", clicks: l.clicks || 0 }));
    return { activeLinks, totalClicks, topLinks };
  },
});

export const _radarAndBroadcastAgg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const deals = await ctx.db
      .query("lowFareRadar")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();
    let planTripClicks = 0, bookingClicks = 0;
    for (const d of deals as any[]) {
      planTripClicks += d.planTripClicks || 0;
      bookingClicks += d.bookingClicks || 0;
    }
    const broadcasts = await ctx.db.query("notificationBroadcasts").collect();
    let sent = 0, taps = 0, uniqueTaps = 0;
    for (const b of broadcasts as any[]) {
      sent += b.sent || 0;
      taps += b.taps || 0;
      uniqueTaps += b.uniqueTaps || 0;
    }
    return {
      radar: { activeDeals: (deals as any[]).length, planTripClicks, bookingClicks },
      notifications: { broadcasts: (broadcasts as any[]).length, sent, taps, uniqueTaps },
    };
  },
});

export const _webAndPartnerAgg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const itins = await ctx.db.query("publishedItineraries").collect();
    const itineraries = { draft: 0, published: 0, rejected: 0 };
    for (const it of itins as any[]) {
      const s = it.status || "published"; // legacy rows (no status) are live
      if (s === "draft") itineraries.draft++;
      else if (s === "rejected") itineraries.rejected++;
      else itineraries.published++;
    }

    const keys = await ctx.db.query("partnerApiKeys").collect();
    let activeKeys = 0;
    for (const k of keys as any[]) if (k.active && !k.revokedAt) activeKeys++;

    const newApps = await ctx.db
      .query("partnerApplications")
      .withIndex("by_status_created", (q: any) => q.eq("status", "new"))
      .collect();
    const pendingProducts = await ctx.db
      .query("partnerProducts")
      .withIndex("by_status_created", (q: any) => q.eq("status", "pending"))
      .collect();

    return {
      itineraries,
      partnerApi: {
        activeKeys,
        totalKeys: (keys as any[]).length,
        applicationsNew: (newApps as any[]).length,
        productsPending: (pendingProducts as any[]).length,
      },
    };
  },
});

// ===========================================================================
// WRITE the singleton.
// ===========================================================================
export const _writeAdminKpis = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const existing = await ctx.db.query("adminKpis").first();
    if (existing) {
      await ctx.db.replace(existing._id, data);
    } else {
      await ctx.db.insert("adminKpis", data);
    }
    return null;
  },
});

// ===========================================================================
// WRITE the per-user activity counters.
//
// One mutation per chunk of users: each is its own transaction with its own
// write budget, and a chunk that fails only costs that chunk. Rows are matched
// on `userId` via the by_user index, so re-runs patch in place rather than
// duplicating.
// ===========================================================================
export const _writeUserActivity = internalMutation({
  args: {
    generation: v.float64(),
    rows: v.array(
      v.object({
        userId: v.string(),
        tripsCount: v.float64(),
        upcomingTripsCount: v.float64(),
        pastTripsCount: v.float64(),
        completedTripsCount: v.float64(),
        lastTripAt: v.optional(v.float64()),
        insightsCount: v.float64(),
        approvedInsightsCount: v.float64(),
        totalLikes: v.float64(),
      }),
    ),
  },
  handler: async (ctx, { generation, rows }) => {
    for (const row of rows) {
      const existing = await ctx.db
        .query("userActivityStats")
        .withIndex("by_user", (q) => q.eq("userId", row.userId))
        .first();
      const doc = { ...row, generation };
      if (existing) {
        await ctx.db.replace(existing._id, doc);
      } else {
        await ctx.db.insert("userActivityStats", doc);
      }
    }
    return null;
  },
});

/**
 * Drop counter rows left behind by an earlier run — a user whose last trip and
 * insight were both deleted stops being written, and without this their stale
 * counts would show forever. Paginated over the `by_generation` index so the
 * caller can drive it to completion in bounded transactions.
 */
export const _pruneUserActivity = internalMutation({
  args: { generation: v.float64(), limit: v.float64() },
  handler: async (ctx, { generation, limit }) => {
    const stale = await ctx.db
      .query("userActivityStats")
      .withIndex("by_generation", (q) => q.lt("generation", generation))
      .take(limit);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length };
  },
});

// ===========================================================================
// RECOMPUTE — the cron entrypoint. Orchestrates the paginated scans + small
// aggregates and writes the singleton. Safe to invoke manually.
// ===========================================================================
export const recomputeAdminKpis = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const now = startedAt;

    // ---- generic paginator over a projected page query ----
    // Byte-capped pages (see TRIPS_PAGE_MAX_BYTES) can come back short, so the
    // loop must not assume a full page means progress. It stops on a cursor
    // that stops advancing, and on a page budget, so a pathological page can
    // never spin this action until the platform kills it.
    const MAX_PAGES_PER_TABLE = 2000;
    async function scanAll<T>(
      run: (cursor: string | null) => Promise<{ rows: T[]; isDone: boolean; continueCursor: string }>,
      onRows: (rows: T[]) => void,
      label = "table",
    ) {
      let cursor: string | null = null;
      for (let page = 0; ; page++) {
        const res = await run(cursor);
        onRows(res.rows);
        if (res.isDone) break;
        if (res.continueCursor === cursor) {
          console.error(`[admin-kpis] ${label}: cursor stopped advancing, stopping scan`);
          break;
        }
        if (page + 1 >= MAX_PAGES_PER_TABLE) {
          console.error(`[admin-kpis] ${label}: hit ${MAX_PAGES_PER_TABLE}-page cap, KPIs may be partial`);
          break;
        }
        cursor = res.continueCursor;
      }
    }

    // day index 0 = today (UTC midnight bucket), up to DAILY_WINDOW-1 days ago
    const dailySignups = new Array(DAILY_WINDOW).fill(0);
    const dailyTrips = new Array(DAILY_WINDOW).fill(0);
    const dailyCompleted = new Array(DAILY_WINDOW).fill(0);
    const dayIndex = (ts: number): number => {
      const idx = Math.floor((now - ts) / DAY_MS);
      return idx >= 0 && idx < DAILY_WINDOW ? idx : -1;
    };

    // ---------- TRIPS ----------
    const trips = {
      total: 0, completed: 0, failed: 0, generating: 0, pending: 0, archived: 0,
      deal: 0, multiCity: 0,
    };
    let durSum = 0, durN = 0, travSum = 0, travN = 0, budgetSum = 0, budgetN = 0;
    const tripPlatform = new Map<string, number>();
    const tripLang = new Map<string, number>();
    const destCounts = new Map<string, number>();
    const owners = new Set<string>();
    const completedOwners = new Set<string>();

    // Per-user counters for the admin user list (see userActivityStats in
    // schema.ts). Filled from the trips and insights scans below — both already
    // walk every row, so this rides along for free rather than paying for a
    // second pass over the fat `trips` table.
    interface ActivityAcc {
      tripsCount: number; upcomingTripsCount: number; pastTripsCount: number;
      completedTripsCount: number; lastTripAt: number;
      insightsCount: number; approvedInsightsCount: number; totalLikes: number;
    }
    const perUser = new Map<string, ActivityAcc>();
    const activityFor = (uid: string): ActivityAcc => {
      let acc = perUser.get(uid);
      if (!acc) {
        acc = {
          tripsCount: 0, upcomingTripsCount: 0, pastTripsCount: 0,
          completedTripsCount: 0, lastTripAt: 0,
          insightsCount: 0, approvedInsightsCount: 0, totalLikes: 0,
        };
        perUser.set(uid, acc);
      }
      return acc;
    };

    await scanAll<TripRow>(
      (cursor) =>
        // 15 rows/page (not 500 like the thin tables): trips are the fat rows,
        // ~57 KB each, so 15 keeps a normal page under ~1 MB. The byte cap
        // inside _tripsPage is the backstop if a page runs into big itineraries.
        ctx.runQuery(internal.adminKpis._tripsPage, { cursor, numItems: 15 }) as Promise<{
          rows: TripRow[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => {
        for (const t of rows) {
          trips.total++;
          if (t.status in trips) (trips as any)[t.status]++;
          if (t.deal) trips.deal++;
          if (t.isMultiCity) trips.multiCity++;
          if (typeof t.startDate === "number" && typeof t.endDate === "number") {
            const d = (t.endDate - t.startDate) / DAY_MS;
            if (d > 0 && d < 400) { durSum += d; durN++; }
          }
          if (typeof t.travelers === "number" && t.travelers > 0) { travSum += t.travelers; travN++; }
          if (typeof t.budget === "number" && t.budget > 0) { budgetSum += t.budget; budgetN++; }
          tripPlatform.set(t.platform, (tripPlatform.get(t.platform) || 0) + 1);
          if (t.language) tripLang.set(t.language, (tripLang.get(t.language) || 0) + 1);
          if (t.destination) destCounts.set(t.destination, (destCounts.get(t.destination) || 0) + 1);
          owners.add(t.userId);
          if (t.status === "completed") completedOwners.add(t.userId);
          if (t.userId) {
            const acc = activityFor(t.userId);
            acc.tripsCount++;
            if (typeof t.endDate === "number" && t.endDate >= now) acc.upcomingTripsCount++;
            else acc.pastTripsCount++;
            if (t.status === "completed") acc.completedTripsCount++;
            if (t.creationTime > acc.lastTripAt) acc.lastTripAt = t.creationTime;
          }
          const di = dayIndex(t.creationTime);
          if (di >= 0) {
            dailyTrips[di]++;
            if (t.status === "completed") dailyCompleted[di]++;
          }
        }
      },
      "trips",
    );

    // ---------- USERS ----------
    const users = { total: 0, onboardingCompleted: 0, aiConsent: 0 };
    const userPlatform = new Map<string, number>();
    const userProvider = new Map<string, number>();
    // userId -> (signup time, platform) for the retention cohorts below. One
    // small entry per user; fine at the current scale, revisit past ~1M users.
    const signupOf = new Map<string, { at: number; platform: string }>();
    await scanAll<UserRow>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._usersPage, { cursor, numItems: 500 }) as Promise<{
          rows: UserRow[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => {
        for (const u of rows) {
          users.total++;
          if (u.onboardingCompleted) users.onboardingCompleted++;
          if (u.aiConsent) users.aiConsent++;
          userPlatform.set(u.platform, (userPlatform.get(u.platform) || 0) + 1);
          userProvider.set(u.authProvider, (userProvider.get(u.authProvider) || 0) + 1);
          const di = dayIndex(u.creationTime);
          if (di >= 0) dailySignups[di]++;
          if (u.userId) signupOf.set(u.userId, { at: u.creationTime, platform: u.platform });
        }
      },
    );

    // ---------- PLANS ----------
    const subs = {
      free: 0, premium: 0, premiumMonthly: 0, premiumYearly: 0, expired: 0,
      premiumPaying: 0, premiumPayingActive: 0, premiumComped: 0,
    };
    // MRR is billed off ACTIVE PAYING subscribers only (exclude comped + expired).
    let payingMonthlyActive = 0, payingYearlyActive = 0;
    await scanAll<PlanRow>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._plansPage, { cursor, numItems: 500 }) as Promise<{
          rows: PlanRow[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => {
        for (const p of rows) {
          if (p.plan === "premium") {
            subs.premium++;
            if (p.subscriptionType === "monthly") subs.premiumMonthly++;
            else if (p.subscriptionType === "yearly") subs.premiumYearly++;
            const isExpired = typeof p.subscriptionExpiresAt === "number" && p.subscriptionExpiresAt < now;
            if (isExpired) subs.expired++;
            if (p.hasAppleTxn) {
              subs.premiumPaying++;
              if (!isExpired) {
                subs.premiumPayingActive++;
                if (p.subscriptionType === "monthly") payingMonthlyActive++;
                else if (p.subscriptionType === "yearly") payingYearlyActive++;
              }
            } else {
              subs.premiumComped++;
            }
          } else {
            subs.free++;
          }
        }
      },
    );

    // ---------- INSIGHTS ----------
    const insights = { total: 0, approved: 0, pending: 0, rejected: 0, flagged: 0, reported: 0 };
    await scanAll<InsightRow>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._insightsPage, { cursor, numItems: 500 }) as Promise<{
          rows: InsightRow[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => {
        for (const i of rows) {
          insights.total++;
          if (i.status in insights) (insights as any)[i.status]++;
          if (i.reported) insights.reported++;
          if (i.userId) {
            const acc = activityFor(i.userId);
            acc.insightsCount++;
            if (i.status === "approved") acc.approvedInsightsCount++;
            acc.totalLikes += i.likes;
          }
        }
      },
    );

    // ---------- IAP ----------
    const iap = { completed: 0, restored: 0, refunded: 0, failed: 0 };
    await scanAll<{ status: string }>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._iapPage, { cursor, numItems: 500 }) as Promise<{
          rows: { status: string }[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => { for (const r of rows) if (r.status in iap) (iap as any)[r.status]++; },
    );

    // ---------- REFERRALS ----------
    const referrals = { total: 0, pending: 0, completed: 0, rewarded: 0 };
    await scanAll<{ status: string }>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._referralsPage, { cursor, numItems: 500 }) as Promise<{
          rows: { status: string }[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => { for (const r of rows) { referrals.total++; if (r.status in referrals) (referrals as any)[r.status]++; } },
    );

    // ---------- STREAKS ----------
    let activeStreaks = 0, streakSum = 0, longestStreak = 0;
    await scanAll<{ current: number; longest: number }>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._streaksPage, { cursor, numItems: 500 }) as Promise<{
          rows: { current: number; longest: number }[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => {
        for (const s of rows) {
          if (s.current > 0) { activeStreaks++; streakSum += s.current; }
          if (s.longest > longestStreak) longestStreak = s.longest;
        }
      },
    );

    // ---------- PUSH TOKENS ----------
    const pushUsers = new Set<string>();
    await scanAll<{ userId: string }>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._pushTokensPage, { cursor, numItems: 500 }) as Promise<{
          rows: { userId: string }[]; isDone: boolean; continueCursor: string;
        }>,
      (rows) => { for (const r of rows) pushUsers.add(r.userId); },
    );

    // ---------- SMALL AGGREGATES ----------
    const ota: {
      leadCounts: { total: number; pending: number; sent: number; contacted: number; converted: number; closed: number; failed: number };
      packages: { active: number; totalViews: number; totalLeads: number };
    } = await ctx.runQuery(internal.adminKpis._otaAgg, {});
    const affiliate: { activeLinks: number; totalClicks: number; topLinks: { title: string; clicks: number }[] } =
      await ctx.runQuery(internal.adminKpis._affiliateAgg, {});
    const radarBroadcast: {
      radar: { activeDeals: number; planTripClicks: number; bookingClicks: number };
      notifications: { broadcasts: number; sent: number; taps: number; uniqueTaps: number };
    } = await ctx.runQuery(internal.adminKpis._radarAndBroadcastAgg, {});
    const webPartner: {
      itineraries: { draft: number; published: number; rejected: number };
      partnerApi: { activeKeys: number; totalKeys: number; applicationsNew: number; productsPending: number };
    } = await ctx.runQuery(internal.adminKpis._webAndPartnerAgg, {});

    // ---------- DERIVE ----------
    const { monthly: priceM, yearly: priceY } = subscriptionPrices();
    const estMrr = round2(payingMonthlyActive * priceM + payingYearlyActive * (priceY / 12));

    const toSortedArray = (m: Map<string, number>) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));

    // time series oldest → newest for charting
    const daily: { date: string; signups: number; trips: number; completedTrips: number }[] = [];
    for (let i = DAILY_WINDOW - 1; i >= 0; i--) {
      daily.push({
        date: utcDay(now - i * DAY_MS),
        signups: dailySignups[i],
        trips: dailyTrips[i],
        completedTrips: dailyCompleted[i],
      });
    }

    // ---------- MARKETING FUNNEL ----------
    // Destination clicks come from the `marketingEvents` day buckets (see
    // marketingEvents.ts); everything else is a re-cut of counts already
    // computed above, grouped here so the dashboard can show the funnel as one
    // panel. The whole window is tens of rows, so this is a single query.
    const sinceDay = utcDay(now - (DAILY_WINDOW - 1) * DAY_MS);
    let eventBuckets: {
      day: string; event: string; surface: string; variant: string | null; count: number;
    }[] = [];
    try {
      eventBuckets = (await ctx.runQuery(internal.marketingEvents._bucketsSince, {
        sinceDay,
      })) as typeof eventBuckets;
    } catch (e) {
      // The table is new: a prod deploy that hasn't picked it up yet must not
      // take the whole KPI run down with it.
      console.error("[admin-kpis] marketingEvents unavailable:", e);
    }

    const dailyDestClicks = new Array(DAILY_WINDOW).fill(0);
    const eventTotals = new Map<string, number>();
    const surfaceTotals = new Map<string, number>();
    const variantTotals = new Map<string, number>();
    // day string -> index, so bucket rows map onto the same 0 = today axis the
    // trip/signup series uses.
    const dayToIndex = new Map<string, number>();
    for (let i = 0; i < DAILY_WINDOW; i++) dayToIndex.set(utcDay(now - i * DAY_MS), i);

    for (const b of eventBuckets) {
      eventTotals.set(b.event, (eventTotals.get(b.event) || 0) + b.count);
      surfaceTotals.set(b.surface, (surfaceTotals.get(b.surface) || 0) + b.count);
      if (b.variant) {
        variantTotals.set(b.variant, (variantTotals.get(b.variant) || 0) + b.count);
      }
      if (b.event === "destination_click") {
        const di = dayToIndex.get(b.day);
        if (di !== undefined) dailyDestClicks[di] += b.count;
      }
    }

    const sumWindow = (arr: number[], days: number) =>
      arr.slice(0, days).reduce((a, n) => a + n, 0);

    const destClicks7d = sumWindow(dailyDestClicks, 7);
    const destClicks30d = sumWindow(dailyDestClicks, DAILY_WINDOW);
    const tripsCreated7d = sumWindow(dailyTrips, 7);
    const tripsCreated30d = sumWindow(dailyTrips, DAILY_WINDOW);
    const signups7d = sumWindow(dailySignups, 7);
    const signups30d = sumWindow(dailySignups, DAILY_WINDOW);

    const marketingDaily: {
      date: string; destinationClicks: number; tripsCreated: number; signups: number;
    }[] = [];
    for (let i = DAILY_WINDOW - 1; i >= 0; i--) {
      marketingDaily.push({
        date: utcDay(now - i * DAY_MS),
        destinationClicks: dailyDestClicks[i],
        tripsCreated: dailyTrips[i],
        signups: dailySignups[i],
      });
    }

    // ---------- RETENTION ----------
    // Classic cohort retention off `userActivityDays` (one row per user-day,
    // written by retention.touchActive). DN = the user had a session on
    // calendar day N after signup. Cohorts are signup weeks (ISO Monday).
    const RETENTION_WINDOW = 60; // days of activity rows kept
    const activitySinceDay = utcDay(now - RETENTION_WINDOW * DAY_MS);
    const activeDaysOf = new Map<string, Set<string>>();     // userId -> days
    const tripActiveDays = new Map<string, Set<string>>();   // userId -> days flagged trip-active
    const platformOf = new Map<string, string>();
    const dailyActiveCount = new Map<string, number>();
    try {
      await scanAll<{ userId: string; day: string; platform: string; tripActive: boolean }>(
        (cursor) =>
          ctx.runQuery(internal.adminKpis._activityDaysPage, {
            cursor, numItems: 1000, sinceDay: activitySinceDay,
          }) as Promise<{ rows: any[]; isDone: boolean; continueCursor: string }>,
        (rows) => {
          for (const r of rows) {
            let set = activeDaysOf.get(r.userId);
            if (!set) { set = new Set(); activeDaysOf.set(r.userId, set); }
            set.add(r.day);
            if (r.tripActive) {
              let ta = tripActiveDays.get(r.userId);
              if (!ta) { ta = new Set(); tripActiveDays.set(r.userId, ta); }
              ta.add(r.day);
            }
            if (r.platform !== "unknown") platformOf.set(r.userId, r.platform);
            dailyActiveCount.set(r.day, (dailyActiveCount.get(r.day) || 0) + 1);
          }
        },
        "activityDays",
      );
    } catch (e) {
      // Table is new — a prod deploy that hasn't picked it up yet must not
      // take the whole KPI run down with it (same treatment as marketingEvents).
      console.error("[admin-kpis] userActivityDays unavailable:", e);
    }

    const dayStrsBack = (n: number) => {
      const out = new Set<string>();
      for (let i = 0; i < n; i++) out.add(utcDay(now - i * DAY_MS));
      return out;
    };
    const last1 = dayStrsBack(1), last7 = dayStrsBack(7), last30 = dayStrsBack(30);
    const activeWithin = (days: Set<string>, window: Set<string>) => {
      for (const d of days) if (window.has(d)) return true;
      return false;
    };

    let dau = 0, wau = 0, mau = 0, wauTripActive = 0;
    const wauByPlatform = new Map<string, number>();
    for (const [uid, days] of activeDaysOf) {
      if (activeWithin(days, last1)) dau++;
      if (activeWithin(days, last30)) mau++;
      if (activeWithin(days, last7)) {
        wau++;
        const ta = tripActiveDays.get(uid);
        if (ta && activeWithin(ta, last7)) wauTripActive++;
        const p = platformOf.get(uid) || signupOf.get(uid)?.platform || "unknown";
        wauByPlatform.set(p, (wauByPlatform.get(p) || 0) + 1);
      }
    }

    // Cohorts: signups in the last 8 ISO weeks.
    const isoMonday = (ts: number) => {
      const d = new Date(ts);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return utcDay(ts - dow * DAY_MS);
    };
    interface Cohort { size: number; d1: number; d7: number; d30: number; d1Eligible: number; d7Eligible: number; d30Eligible: number; }
    const cohorts = new Map<string, Cohort>();
    const platformD7 = new Map<string, { hit: number; eligible: number }>();
    let d1Hit = 0, d1El = 0, d7Hit = 0, d7El = 0, d30Hit = 0, d30El = 0;
    const cohortStart = now - 8 * 7 * DAY_MS;
    for (const [uid, su] of signupOf) {
      if (su.at < cohortStart) continue;
      const week = isoMonday(su.at);
      let c = cohorts.get(week);
      if (!c) { c = { size: 0, d1: 0, d7: 0, d30: 0, d1Eligible: 0, d7Eligible: 0, d30Eligible: 0 }; cohorts.set(week, c); }
      c.size++;
      const days = activeDaysOf.get(uid);
      const ageDays = Math.floor((now - su.at) / DAY_MS);
      const activeOn = (n: number) => !!days && days.has(utcDay(su.at + n * DAY_MS));
      if (ageDays >= 1) { c.d1Eligible++; d1El++; if (activeOn(1)) { c.d1++; d1Hit++; } }
      if (ageDays >= 7) {
        c.d7Eligible++; d7El++;
        const hit = activeOn(7);
        if (hit) { c.d7++; d7Hit++; }
        const pp = platformD7.get(su.platform) || { hit: 0, eligible: 0 };
        pp.eligible++; if (hit) pp.hit++;
        platformD7.set(su.platform, pp);
      }
      if (ageDays >= 30) { c.d30Eligible++; d30El++; if (activeOn(30)) { c.d30++; d30Hit++; } }
    }
    const cohortRows = Array.from(cohorts.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([week, c]) => ({
        week,
        size: c.size,
        d1: c.d1Eligible ? pct(c.d1, c.d1Eligible) : null,
        d7: c.d7Eligible ? pct(c.d7, c.d7Eligible) : null,
        d30: c.d30Eligible ? pct(c.d30, c.d30Eligible) : null,
      }));

    // Watches: how many users hold >=1, and — the leading indicator — how
    // many of the last 30 days' signups left onboarding with one.
    const watchers = new Set<string>();
    try {
      await scanAll<{ userId: string }>(
        (cursor) =>
          ctx.runQuery(internal.adminKpis._watchersPage, { cursor, numItems: 1000 }) as Promise<{
            rows: { userId: string }[]; isDone: boolean; continueCursor: string;
          }>,
        (rows) => { for (const r of rows) watchers.add(r.userId); },
        "watchers",
      );
    } catch (e) {
      console.error("[admin-kpis] watchedDestinations unavailable:", e);
    }
    let newUsers30d = 0, newUsersWithWatch30d = 0;
    for (const [uid, su] of signupOf) {
      if (now - su.at <= 30 * DAY_MS) { newUsers30d++; if (watchers.has(uid)) newUsersWithWatch30d++; }
    }

    // Notification opens come from the marketing buckets already loaded
    // above (event = notification_open, surface = push type).
    const notifOpensByType = new Map<string, number>();
    let notificationOpens7d = 0;
    for (const b of eventBuckets) {
      if (b.event !== "notification_open") continue;
      notifOpensByType.set(b.surface, (notifOpensByType.get(b.surface) || 0) + b.count);
      if (last7.has(b.day)) notificationOpens7d += b.count;
    }

    const dailyActive: { date: string; active: number }[] = [];
    for (let i = DAILY_WINDOW - 1; i >= 0; i--) {
      const d = utcDay(now - i * DAY_MS);
      dailyActive.push({ date: d, active: dailyActiveCount.get(d) || 0 });
    }

    const retention = {
      dau, wau, mau,
      stickinessPct: pct(dau, mau),
      wauTripActive,
      wauBrowsing: Math.max(0, wau - wauTripActive),
      usersWithWatch: watchers.size,
      newUsersWithWatch30d,
      newUsersWithWatchRatePct: pct(newUsersWithWatch30d, newUsers30d),
      d1Pct: pct(d1Hit, d1El),
      d7Pct: pct(d7Hit, d7El),
      d30Pct: pct(d30Hit, d30El),
      cohorts: cohortRows,
      byPlatform: Array.from(new Set([...wauByPlatform.keys(), ...platformD7.keys()]))
        .map((key) => ({
          key,
          wau: wauByPlatform.get(key) || 0,
          d7Pct: pct(platformD7.get(key)?.hit || 0, platformD7.get(key)?.eligible || 0),
        }))
        .sort((a, b) => b.wau - a.wau),
      notificationOpens7d,
      notificationOpensByType: toSortedArray(notifOpensByType),
      dailyActive,
    };

    const data = {
      computedAt: now,
      durationMs: Date.now() - startedAt,
      trips: {
        ...trips,
        successRatePct: pct(trips.completed, trips.completed + trips.failed),
        avgDurationDays: durN ? round2(durSum / durN) : 0,
        avgTravelers: travN ? round2(travSum / travN) : 0,
        avgBudgetEur: budgetN ? Math.round(budgetSum / budgetN) : 0,
      },
      tripsByPlatform: toSortedArray(tripPlatform),
      tripsByLanguage: toSortedArray(tripLang),
      topTripDestinations: Array.from(destCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([destination, count]) => ({ destination, count })),
      users: {
        total: users.total,
        activated: owners.size,
        activatedCompleted: completedOwners.size,
        onboardingCompleted: users.onboardingCompleted,
        aiConsent: users.aiConsent,
        activationRatePct: pct(owners.size, users.total),
      },
      usersByPlatform: toSortedArray(userPlatform),
      usersByAuthProvider: toSortedArray(userProvider),
      subs: {
        ...subs,
        conversionRatePct: pct(subs.premium, users.total),
        payingConversionRatePct: pct(subs.premiumPaying, users.total),
        estMrrEur: estMrr,
        estArrEur: round2(estMrr * 12),
      },
      iap: { ...iap, refundRatePct: pct(iap.refunded, iap.completed + iap.refunded) },
      insights: {
        ...insights,
        approvalRatePct: pct(insights.approved, insights.approved + insights.rejected),
      },
      engagement: {
        activeStreaks,
        avgCurrentStreak: activeStreaks ? round2(streakSum / activeStreaks) : 0,
        longestStreak,
        pushTokens: pushUsers.size,
        pushOptInRatePct: pct(pushUsers.size, users.total),
      },
      referrals,
      notifications: {
        ...radarBroadcast.notifications,
        tapThroughRatePct: pct(radarBroadcast.notifications.uniqueTaps, radarBroadcast.notifications.sent),
      },
      otaLeads: {
        ...ota.leadCounts,
        conversionRatePct: pct(ota.leadCounts.converted, ota.leadCounts.total),
      },
      otaPackages: ota.packages,
      affiliate,
      radar: radarBroadcast.radar,
      itineraries: webPartner.itineraries,
      partnerApi: webPartner.partnerApi,
      marketing: {
        destinationClicks7d: destClicks7d,
        destinationClicks30d: destClicks30d,
        tripsCreated7d,
        tripsCreated30d,
        signups7d,
        signups30d,
        // Onboarding follows signup for every account, so total users is the
        // honest denominator for "how many finished setup".
        onboardingStarted: users.total,
        onboardingCompleted: users.onboardingCompleted,
        onboardingCompletionRatePct: pct(users.onboardingCompleted, users.total),
        premiumConversionRatePct: pct(subs.premium, users.total),
        payingConversionRatePct: pct(subs.premiumPaying, users.total),
        clickToTripRatePct: pct(tripsCreated30d, destClicks30d),
      },
      marketingDaily,
      marketingByEvent: toSortedArray(eventTotals),
      marketingBySurface: toSortedArray(surfaceTotals),
      marketingByVariant: toSortedArray(variantTotals),
      retention,
      daily,
    };

    await ctx.runMutation(internal.adminKpis._writeAdminKpis, { data });

    // ---------- PER-USER ACTIVITY COUNTERS ----------
    // Written after the singleton so a failure here still leaves fresh KPIs.
    // `now` is the generation stamp: every row this run touches gets it, and
    // anything still carrying an older stamp is stale and gets pruned.
    const ACTIVITY_WRITE_CHUNK = 100;
    const ACTIVITY_PRUNE_CHUNK = 200;
    const ACTIVITY_PRUNE_MAX_PASSES = 200;
    try {
      const activityRows = Array.from(perUser.entries()).map(([userId, a]) => ({
        userId,
        tripsCount: a.tripsCount,
        upcomingTripsCount: a.upcomingTripsCount,
        pastTripsCount: a.pastTripsCount,
        completedTripsCount: a.completedTripsCount,
        lastTripAt: a.lastTripAt || undefined,
        insightsCount: a.insightsCount,
        approvedInsightsCount: a.approvedInsightsCount,
        totalLikes: a.totalLikes,
      }));
      for (let i = 0; i < activityRows.length; i += ACTIVITY_WRITE_CHUNK) {
        await ctx.runMutation(internal.adminKpis._writeUserActivity, {
          generation: now,
          rows: activityRows.slice(i, i + ACTIVITY_WRITE_CHUNK),
        });
      }
      let pruned = 0;
      for (let pass = 0; pass < ACTIVITY_PRUNE_MAX_PASSES; pass++) {
        const res: { deleted: number } = await ctx.runMutation(
          internal.adminKpis._pruneUserActivity,
          { generation: now, limit: ACTIVITY_PRUNE_CHUNK },
        );
        pruned += res.deleted;
        if (res.deleted < ACTIVITY_PRUNE_CHUNK) break;
      }

      // Activity days older than the retention window are dead weight — the
      // D30 cohort only ever needs 30 days + 8 weeks of signups, and 60 covers it.
      for (let i = 0; i < 50; i++) {
        const res: { deleted: number } = await ctx.runMutation(
          internal.adminKpis._pruneActivityDays,
          { beforeDay: utcDay(now - RETENTION_WINDOW * DAY_MS), limit: 500 },
        ).catch(() => ({ deleted: 0 }));
        if (res.deleted < 500) break;
      }
      console.log(
        `[admin-kpis] user activity: wrote ${activityRows.length} rows, pruned ${pruned}`,
      );
    } catch (err) {
      // Counters are a convenience on the admin user list, not a KPI input —
      // never let them fail the whole run.
      console.error("[admin-kpis] user activity write failed", err);
    }

    return null;
  },
});

// ===========================================================================
// PUBLIC (admin-gated) READ. Reads the cron-computed singleton and layers on a
// couple of cheap, always-fresh live signals (in-flight trip generations and
// the current moderation queue) that matter more when up-to-the-second.
// ===========================================================================
export const getKpis = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    await assertAdmin(ctx, userId);

    const snapshot = await ctx.db.query("adminKpis").first();

    // Live: trips currently generating (indexed, small take) — a stuck-job /
    // reliability signal that shouldn't wait for the next cron tick.
    const now = Date.now();
    const generatingDocs = await ctx.db
      .query("trips")
      .withIndex("by_status", (q) => q.eq("status", "generating"))
      .order("asc")
      .take(200);
    let oldestGeneratingMs: number | null = null;
    if (generatingDocs.length > 0) {
      oldestGeneratingMs = now - generatingDocs[0]._creationTime;
    }

    // Live: current moderation queue (small).
    const pendingInsights = await ctx.db
      .query("insights")
      .withIndex("by_moderation_status", (q) => q.eq("moderationStatus", "pending"))
      .take(500);
    const flaggedInsights = await ctx.db
      .query("insights")
      .withIndex("by_moderation_status", (q) => q.eq("moderationStatus", "flagged"))
      .take(500);

    return {
      ...(snapshot ?? {}),
      _hasSnapshot: !!snapshot,
      live: {
        generatingTrips: generatingDocs.length,
        generatingTripsCapped: generatingDocs.length === 200,
        oldestGeneratingMs,
        pendingInsights: pendingInsights.length,
        pendingInsightsCapped: pendingInsights.length === 500,
        flaggedInsights: flaggedInsights.length,
      },
    };
  },
});
