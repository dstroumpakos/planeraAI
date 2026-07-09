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
// ===========================================================================

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
    const res = await ctx.db.query("trips").paginate({ cursor, numItems });
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
}

export const _insightsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const res = await ctx.db.query("insights").paginate({ cursor, numItems });
    const rows: InsightRow[] = res.page.map((i: any) => ({
      status: i.moderationStatus || "pending",
      reported: (i.reportsCount || 0) > 0,
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
// RECOMPUTE — the cron entrypoint. Orchestrates the paginated scans + small
// aggregates and writes the singleton. Safe to invoke manually.
// ===========================================================================
export const recomputeAdminKpis = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const now = startedAt;

    // ---- generic paginator over a projected page query ----
    async function scanAll<T>(
      run: (cursor: string | null) => Promise<{ rows: T[]; isDone: boolean; continueCursor: string }>,
      onRows: (rows: T[]) => void,
    ) {
      let cursor: string | null = null;
      for (;;) {
        const res = await run(cursor);
        onRows(res.rows);
        if (res.isDone) break;
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

    await scanAll<TripRow>(
      (cursor) =>
        ctx.runQuery(internal.adminKpis._tripsPage, { cursor, numItems: 50 }) as Promise<{
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
          const di = dayIndex(t.creationTime);
          if (di >= 0) {
            dailyTrips[di]++;
            if (t.status === "completed") dailyCompleted[di]++;
          }
        }
      },
    );

    // ---------- USERS ----------
    const users = { total: 0, onboardingCompleted: 0, aiConsent: 0 };
    const userPlatform = new Map<string, number>();
    const userProvider = new Map<string, number>();
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
      daily,
    };

    await ctx.runMutation(internal.adminKpis._writeAdminKpis, { data });
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
