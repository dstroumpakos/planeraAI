/**
 * Scheduled operator stats reports (weekly + monthly).
 *
 * Two crons (see crons.ts) fire this file: every Sunday and on the 1st of each
 * month. Each run measures a time WINDOW, renders a branded HTML digest and
 * mails it to the operator address (STATS_REPORT_TO, default the founder's
 * inbox) through Postmark.
 *
 * Three kinds of numbers go into a report:
 *
 *  1. PERIOD metrics — counted by scanning each table's default (_creationTime)
 *     index in DESCENDING order and stopping as soon as a page falls behind the
 *     window start. Cost therefore scales with activity inside the window, not
 *     with table size. The fat `trips` rows use the same byte-capped pagination
 *     trick as adminKpis.ts (see TRIPS_PAGE_MAX_BYTES there).
 *  2. SNAPSHOT metrics — lifted straight off the cron-computed `adminKpis`
 *     singleton (recomputed hourly), so totals like MRR cost one document read.
 *  3. DELTAS — every run is persisted to `statsReportRuns`. The next run of the
 *     same period diffs against it, which is the only way to get a per-period
 *     number out of counters the source tables keep as running totals (radar
 *     clicks, affiliate clicks, MRR).
 *
 * Run one by hand (e.g. to preview) from the CLI:
 *   npx convex run statsReports:sendWeeklyReport '{"dryRun":true}'
 *   npx convex run statsReports:sendMonthlyReport '{"to":"me@example.com"}'
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal as _internal } from "./_generated/api";

// This file's own functions won't exist in the generated types until
// `npx convex dev`/`codegen` runs, and the action referencing its sibling
// queries would otherwise hit the self-referential inference wall. Same `as any`
// escape hatch crons.ts and adminKpis.ts use; every runQuery result below is
// hand-annotated so the aggregation stays type-checked.
const internal = _internal as any;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TO = "dstroumpakos@planeraai.app";
const BASE_URL = "https://planeraai.app";

// `trips` rows carry the whole generated itinerary (~57 KB each), so a page is
// capped at the database layer rather than by row count — see adminKpis.ts.
const TRIPS_PAGE_MAX_BYTES = 2 * 1024 * 1024;

// Safety rails: a pathological window can never spin a scan until the platform
// kills the action. Hitting one is recorded in `truncated` and surfaced in the
// email footer so a partial number is never mistaken for a real one.
const MAX_PAGES = 300;
const MAX_TRIP_PAGES = 1500;

type Period = "weekly" | "monthly";

// ===========================================================================
// WINDOWED PAGE QUERIES
// One per table. Each walks the default index newest-first and returns only the
// projected fields the aggregation needs, plus whether the scan has walked past
// the start of the window (`reachedStart`) so the caller can stop early.
// ===========================================================================

const windowPageArgs = {
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
  since: v.number(),
  until: v.number(),
};

function makeWindowPage(
  table: string,
  map: (doc: any) => any,
  maximumBytesRead?: number,
) {
  return internalQuery({
    args: windowPageArgs,
    handler: async (ctx, args) => {
      const opts: any = { cursor: args.cursor, numItems: args.numItems };
      if (maximumBytesRead) opts.maximumBytesRead = maximumBytesRead;
      const res = await (ctx.db.query(table as any) as any).order("desc").paginate(opts);
      const page = res.page as any[];
      const rows = page
        .filter((d) => d._creationTime >= args.since && d._creationTime < args.until)
        .map(map);
      // Descending order ⇒ the last row of the page is the oldest one read.
      const oldest = page.length > 0 ? page[page.length - 1]._creationTime : null;
      return {
        rows,
        isDone: res.isDone as boolean,
        continueCursor: res.continueCursor as string,
        reachedStart: res.isDone || (oldest !== null && oldest < args.since),
      };
    },
  });
}

export const _tripsWindow = makeWindowPage(
  "trips",
  (t: any) => ({
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
  }),
  TRIPS_PAGE_MAX_BYTES,
);

export const _usersWindow = makeWindowPage("userSettings", (u: any) => ({
  platform: u.platform || "unknown",
  provider: u.authProvider || "unknown",
  onboardingCompleted: u.onboardingCompleted === true,
}));

export const _sessionsWindow = makeWindowPage("sessions", (s: any) => ({
  userId: s.userId,
}));

export const _insightsWindow = makeWindowPage("insights", (i: any) => ({
  status: i.moderationStatus || "pending",
}));

export const _iapWindow = makeWindowPage("iapTransactions", (t: any) => ({
  status: t.status,
  productId: t.productId || "",
  platform: t.platform || "ios",
}));

export const _newsletterWindow = makeWindowPage("newsletterSubscribers", (s: any) => ({
  status: s.status,
  source: s.source || "unknown",
}));

export const _radarWindow = makeWindowPage("lowFareRadar", (d: any) => ({
  active: d.active === true,
}));

export const _broadcastsWindow = makeWindowPage("notificationBroadcasts", (b: any) => ({
  sent: b.sent || 0,
  taps: b.taps || 0,
  uniqueTaps: b.uniqueTaps || 0,
  status: b.status || "sent",
}));

export const _otaLeadsWindow = makeWindowPage("otaLeads", (l: any) => ({
  status: l.status || "pending",
}));

export const _partnerAppsWindow = makeWindowPage("partnerApplications", () => ({}));

export const _reservationsWindow = makeWindowPage("tripReservations", (r: any) => ({
  source: r.source,
}));

// ===========================================================================
// SMALL DIRECT QUERIES
// ===========================================================================

/**
 * Deduped error keys touched inside the window. `errorReports` holds one row
 * per distinct error (source + message head) with a running `count`, so this is
 * a small table — a bounded take is enough.
 */
export const _errorsWindow = internalQuery({
  args: { since: v.number(), until: v.number() },
  handler: async (ctx, { since, until }) => {
    // Newest keys first, so a table that ever outgrows the take still reports
    // the errors that are actually current.
    const rows = await ctx.db.query("errorReports").order("desc").take(1000);
    const inWindow = rows.filter(
      (e: any) => e.lastSentAt >= since && e.lastSentAt < until,
    );
    return {
      kinds: inWindow.length,
      events: inWindow.reduce((s: number, e: any) => s + (e.count || 0), 0),
      top: [...inWindow]
        .sort((a: any, b: any) => (b.count || 0) - (a.count || 0))
        .slice(0, 5)
        .map((e: any) => ({
          source: e.source as string,
          message: String(e.message || "").slice(0, 160),
          count: (e.count || 0) as number,
        })),
    };
  },
});

/** Confirmed newsletter list size. Bounded take — 5,000+ is reported as a floor. */
export const _newsletterActiveCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(5000);
    return { count: rows.length, capped: rows.length === 5000 };
  },
});

/** The hourly admin-KPI singleton — source of every cumulative total. */
export const _kpiSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("adminKpis").first(),
});

/** Most recent report of the same period, for period-over-period deltas. */
export const _previousRun = internalQuery({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    return await ctx.db
      .query("statsReportRuns")
      .withIndex("by_period_sentAt", (q) => q.eq("period", period))
      .order("desc")
      .first();
  },
});

export const _saveRun = internalMutation({
  args: {
    period: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    sentAt: v.number(),
    to: v.string(),
    emailSent: v.boolean(),
    emailError: v.optional(v.string()),
    metrics: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("statsReportRuns", args);
    return null;
  },
});

// ===========================================================================
// PERIOD WINDOW
// ===========================================================================

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Formatted by hand rather than via Intl so the output is identical in every
// Convex runtime and never depends on locale data being present.
function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/**
 * Weekly = the 7 days up to the moment the cron fires (Sunday).
 * Monthly = the whole previous CALENDAR month, so the report that lands on the
 * 1st is a clean "here is July", not a rolling 30 days.
 */
function windowFor(period: Period, now: number): { since: number; until: number; label: string } {
  if (period === "monthly") {
    const d = new Date(now);
    const until = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const start = new Date(until);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return {
      since: start.getTime(),
      until,
      label: `${MONTHS_LONG[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  }
  const until = now;
  const since = now - 7 * DAY_MS;
  return { since, until, label: `${fmtDay(since)} – ${fmtDay(until)}` };
}

// ===========================================================================
// COLLECTION
// ===========================================================================

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

function subscriptionPrices() {
  // Same env vars the admin KPI MRR estimate uses, so the two agree.
  const monthly = Number(process.env.KPI_PRICE_MONTHLY_EUR ?? "4.99") || 0;
  const yearly = Number(process.env.KPI_PRICE_YEARLY_EUR ?? "29.99") || 0;
  return { monthly, yearly };
}

const toSorted = (m: Map<string, number>) =>
  Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));

async function collectPeriod(ctx: any, since: number, until: number) {
  const truncated: string[] = [];

  /** Walk a windowed page query newest-first until it passes the window start. */
  async function scan<T>(
    fn: any,
    numItems: number,
    onRows: (rows: T[]) => void,
    label: string,
    maxPages = MAX_PAGES,
  ) {
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      const res: {
        rows: T[];
        isDone: boolean;
        continueCursor: string;
        reachedStart: boolean;
      } = await ctx.runQuery(fn, { cursor, numItems, since, until });
      onRows(res.rows);
      if (res.reachedStart || res.isDone) break;
      if (res.continueCursor === cursor) {
        console.error(`[stats-report] ${label}: cursor stopped advancing`);
        truncated.push(label);
        break;
      }
      if (page + 1 >= maxPages) {
        console.error(`[stats-report] ${label}: hit ${maxPages}-page cap`);
        truncated.push(label);
        break;
      }
      cursor = res.continueCursor;
    }
  }

  // ---------- TRIPS ----------
  const trips = {
    created: 0, completed: 0, failed: 0, generating: 0, pending: 0, archived: 0,
    deal: 0, multiCity: 0,
  };
  let durSum = 0, durN = 0, travSum = 0, travN = 0, budgetSum = 0, budgetN = 0;
  const tripPlatform = new Map<string, number>();
  const tripLang = new Map<string, number>();
  const destCounts = new Map<string, number>();
  const planners = new Set<string>();

  await scan<any>(
    internal.statsReports._tripsWindow,
    15,
    (rows) => {
      for (const t of rows) {
        trips.created++;
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
        planners.add(t.userId);
      }
    },
    "trips",
    MAX_TRIP_PAGES,
  );

  // ---------- USERS ----------
  let newUsers = 0, onboarded = 0;
  const userPlatform = new Map<string, number>();
  const userProvider = new Map<string, number>();
  await scan<any>(internal.statsReports._usersWindow, 500, (rows) => {
    for (const u of rows) {
      newUsers++;
      if (u.onboardingCompleted) onboarded++;
      userPlatform.set(u.platform, (userPlatform.get(u.platform) || 0) + 1);
      userProvider.set(u.provider, (userProvider.get(u.provider) || 0) + 1);
    }
  }, "userSettings");

  // ---------- SESSIONS (logins ≈ activity) ----------
  let logins = 0;
  const activeUsers = new Set<string>();
  await scan<any>(internal.statsReports._sessionsWindow, 500, (rows) => {
    for (const s of rows) { logins++; activeUsers.add(s.userId); }
  }, "sessions");

  // ---------- INSIGHTS ----------
  let insightsCreated = 0;
  await scan<any>(internal.statsReports._insightsWindow, 200, (rows) => {
    insightsCreated += rows.length;
  }, "insights");

  // ---------- IAP ----------
  const iap = { purchases: 0, restores: 0, refunds: 0, failed: 0, monthly: 0, yearly: 0 };
  await scan<any>(internal.statsReports._iapWindow, 500, (rows) => {
    for (const t of rows) {
      if (t.status === "completed") {
        iap.purchases++;
        const id = String(t.productId).toLowerCase();
        if (id.includes("year") || id.includes("annual")) iap.yearly++;
        else iap.monthly++;
      } else if (t.status === "restored") iap.restores++;
      else if (t.status === "refunded") iap.refunds++;
      else if (t.status === "failed") iap.failed++;
    }
  }, "iapTransactions");

  const prices = subscriptionPrices();
  const estGrossEur = round2(iap.monthly * prices.monthly + iap.yearly * prices.yearly);

  // ---------- NEWSLETTER ----------
  const newsletter = { signups: 0, active: 0, pending: 0, unsubscribed: 0 };
  await scan<any>(internal.statsReports._newsletterWindow, 500, (rows) => {
    for (const s of rows) {
      newsletter.signups++;
      if (s.status in newsletter) (newsletter as any)[s.status]++;
    }
  }, "newsletterSubscribers");

  // ---------- RADAR + PUSH ----------
  let dealsAdded = 0, dealsStillActive = 0;
  await scan<any>(internal.statsReports._radarWindow, 500, (rows) => {
    for (const d of rows) { dealsAdded++; if (d.active) dealsStillActive++; }
  }, "lowFareRadar");

  const push = { broadcasts: 0, sent: 0, taps: 0, uniqueTaps: 0 };
  await scan<any>(internal.statsReports._broadcastsWindow, 500, (rows) => {
    for (const b of rows) {
      if (b.status === "scheduled" || b.status === "cancelled") continue;
      push.broadcasts++;
      push.sent += b.sent;
      push.taps += b.taps;
      push.uniqueTaps += b.uniqueTaps;
    }
  }, "notificationBroadcasts");

  // ---------- LEADS ----------
  let otaLeads = 0, otaConverted = 0;
  await scan<any>(internal.statsReports._otaLeadsWindow, 500, (rows) => {
    for (const l of rows) { otaLeads++; if (l.status === "converted") otaConverted++; }
  }, "otaLeads");

  let partnerApplications = 0;
  await scan<any>(internal.statsReports._partnerAppsWindow, 500, (rows) => {
    partnerApplications += rows.length;
  }, "partnerApplications");

  let reservations = 0, reservationsByEmail = 0;
  await scan<any>(internal.statsReports._reservationsWindow, 500, (rows) => {
    for (const r of rows) { reservations++; if (r.source === "email") reservationsByEmail++; }
  }, "tripReservations");

  // ---------- HEALTH ----------
  const errors: { kinds: number; events: number; top: { source: string; message: string; count: number }[] } =
    await ctx.runQuery(internal.statsReports._errorsWindow, { since, until });

  const newsletterTotal: { count: number; capped: boolean } =
    await ctx.runQuery(internal.statsReports._newsletterActiveCount, {});

  return {
    users: {
      new: newUsers,
      onboarded,
      byPlatform: toSorted(userPlatform),
      byProvider: toSorted(userProvider),
    },
    activity: {
      logins,
      activeUsers: activeUsers.size,
      planners: planners.size,
    },
    trips: {
      ...trips,
      successRatePct: pct(trips.completed, trips.completed + trips.failed),
      avgDurationDays: durN ? round2(durSum / durN) : 0,
      avgTravelers: travN ? round2(travSum / travN) : 0,
      avgBudgetEur: budgetN ? Math.round(budgetSum / budgetN) : 0,
      byPlatform: toSorted(tripPlatform),
      byLanguage: toSorted(tripLang),
      topDestinations: Array.from(destCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([destination, count]) => ({ destination, count })),
    },
    insights: { created: insightsCreated },
    monetization: { ...iap, estGrossEur },
    newsletter: { ...newsletter, activeTotal: newsletterTotal.count, activeTotalCapped: newsletterTotal.capped },
    radar: { dealsAdded, dealsStillActive, ...push, tapRatePct: pct(push.uniqueTaps, push.sent) },
    leads: { otaLeads, otaConverted, partnerApplications, reservations, reservationsByEmail },
    health: errors,
    truncated,
  };
}

/** The cumulative totals worth trending, lifted off the hourly KPI singleton. */
function extractSnapshot(kpi: any) {
  return {
    computedAt: (kpi?.computedAt ?? null) as number | null,
    usersTotal: kpi?.users?.total ?? 0,
    usersActivated: kpi?.users?.activated ?? 0,
    activationRatePct: kpi?.users?.activationRatePct ?? 0,
    tripsTotal: kpi?.trips?.total ?? 0,
    tripsSuccessRatePct: kpi?.trips?.successRatePct ?? 0,
    premium: kpi?.subs?.premium ?? 0,
    premiumPayingActive: kpi?.subs?.premiumPayingActive ?? 0,
    payingConversionRatePct: kpi?.subs?.payingConversionRatePct ?? 0,
    estMrrEur: kpi?.subs?.estMrrEur ?? 0,
    estArrEur: kpi?.subs?.estArrEur ?? 0,
    pushTokens: kpi?.engagement?.pushTokens ?? 0,
    activeDeals: kpi?.radar?.activeDeals ?? 0,
    radarPlanTripClicks: kpi?.radar?.planTripClicks ?? 0,
    radarBookingClicks: kpi?.radar?.bookingClicks ?? 0,
    affiliateClicks: kpi?.affiliate?.totalClicks ?? 0,
    publishedItineraries: kpi?.itineraries?.published ?? 0,
    draftItineraries: kpi?.itineraries?.draft ?? 0,
    partnerActiveKeys: kpi?.partnerApi?.activeKeys ?? 0,
    partnerProductsPending: kpi?.partnerApi?.productsPending ?? 0,
    partnerApplicationsNew: kpi?.partnerApi?.applicationsNew ?? 0,
    insightsPending: kpi?.insights?.pending ?? 0,
    insightsFlagged: kpi?.insights?.flagged ?? 0,
  };
}

type PeriodMetrics = Awaited<ReturnType<typeof collectPeriod>>;
type SnapshotMetrics = ReturnType<typeof extractSnapshot>;

// ===========================================================================
// RENDERING
// ===========================================================================

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#1A1A1A";
const MUTED = "#6E6E6E";
const GOOD = "#0F7B4F";
const BAD = "#C0392B";

function fmtInt(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "−" : "") + s;
}
const fmtEur = (n: number) => `€${fmtInt(n)}`;
const fmtPct = (n: number) => `${n}%`;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Reads a dotted path out of a previous run's stored metrics. */
function prevNum(prev: any, path: string): number | null {
  if (!prev) return null;
  let cur: any = prev;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[key];
  }
  return typeof cur === "number" ? cur : null;
}

/** Whole numbers stay whole; small fractional deltas keep one decimal. */
function fmtDelta(n: number): string {
  return Number.isInteger(n) ? fmtInt(n) : String(Math.round(n * 10) / 10);
}

/**
 * "▲ +12 (+8.3%)" in green / red. `invert` flips the colouring for metrics
 * where down is good (errors, refunds).
 */
function deltaHtml(cur: number, prev: number | null, invert = false): string {
  if (prev === null) {
    return `<span style="color:#B8B8B8;font-size:12px;">—</span>`;
  }
  const diff = round2(cur - prev);
  if (diff === 0) {
    return `<span style="color:${MUTED};font-size:12px;">no change</span>`;
  }
  const up = diff > 0;
  const good = invert ? !up : up;
  const share = prev > 0 ? ` (${up ? "+" : "−"}${Math.abs(Math.round((diff / prev) * 1000) / 10)}%)` : "";
  const sign = up ? "▲ +" : "▼ −";
  return `<span style="color:${good ? GOOD : BAD};font-size:12px;font-weight:600;">${sign}${fmtDelta(Math.abs(diff))}${share}</span>`;
}

/**
 * Counters the source tables only keep as running totals: the per-period number
 * is the rise since the previous report, which needs a stored baseline. Without
 * one (first run) the honest answer is "unknown", not zero.
 */
function sinceLast(current: number, baseline: number | null): string {
  return baseline === null ? "—" : fmtInt(current - baseline);
}

function row(label: string, value: string, delta: string, hint?: string): string {
  return `<tr>
    <td width="52%" style="padding:9px 0;border-bottom:1px solid #F1EFEA;font-family:${FONT};font-size:14px;color:${INK};">${esc(label)}${
      hint ? `<span style="display:block;font-size:11px;color:${MUTED};line-height:1.4;">${esc(hint)}</span>` : ""
    }</td>
    <td align="right" style="padding:9px 0;border-bottom:1px solid #F1EFEA;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};white-space:nowrap;">${value}</td>
    <td align="right" style="padding:9px 0 9px 14px;border-bottom:1px solid #F1EFEA;font-family:${FONT};white-space:nowrap;">${delta}</td>
  </tr>`;
}

/**
 * Breakdown rows ("ios 150 · web 51 · …"). The value goes UNDER the label on
 * its own full-width line: as a third column it would be a long non-wrapping
 * string that forces the 640px shell wider than a phone screen.
 */
function listRow(label: string, value: string): string {
  return `<tr>
    <td colspan="3" style="padding:9px 0;border-bottom:1px solid #F1EFEA;font-family:${FONT};">
      <span style="font-size:14px;color:${INK};">${esc(label)}</span>
      <span style="display:block;margin-top:3px;font-size:13px;line-height:1.6;font-weight:600;color:${INK};">${value}</span>
    </td>
  </tr>`;
}

function section(title: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `<tr><td style="padding:26px 32px 0;">
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">${esc(title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>
  </td></tr>`;
}

function tile(label: string, value: string, sub: string): string {
  return `<td width="50%" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;border-radius:14px;">
      <tr><td style="padding:16px 18px;font-family:${FONT};">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${MUTED};">${esc(label)}</p>
        <p style="margin:0;font-size:28px;line-height:1.1;font-weight:800;color:${INK};letter-spacing:-0.8px;">${value}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${MUTED};">${sub}</p>
      </td></tr>
    </table>
  </td>`;
}

function listLine(items: { key: string; count: number }[], max = 5): string {
  if (items.length === 0) return "—";
  return items.slice(0, max).map((i) => `${esc(i.key)} ${fmtInt(i.count)}`).join(" · ");
}

/** Exported so a local harness can render a report to HTML without sending it. */
export function renderReport(opts: {
  period: Period;
  label: string;
  since: number;
  until: number;
  now: number;
  cur: PeriodMetrics;
  snap: SnapshotMetrics;
  prev: any | null;
}): { subject: string; html: string; text: string } {
  const { period, label, cur, snap, prev } = opts;
  const prevMetrics = prev?.metrics ?? null;
  const p = (path: string) => prevNum(prevMetrics, `period.${path}`);
  const s = (path: string) => prevNum(prevMetrics, `snapshot.${path}`);
  const periodWord = period === "weekly" ? "week" : "month";
  const title = period === "weekly" ? "Weekly report" : "Monthly report";

  const subject =
    `📊 Planera ${period === "weekly" ? "weekly" : "monthly"} · ${label} · ` +
    `${fmtInt(cur.users.new)} signups · ${fmtInt(cur.trips.created)} trips · ${fmtEur(snap.estMrrEur)} MRR`;

  const sections: string[] = [];

  sections.push(
    section("Growth", [
      row("New users", fmtInt(cur.users.new), deltaHtml(cur.users.new, p("users.new"))),
      row("Completed onboarding", fmtInt(cur.users.onboarded), deltaHtml(cur.users.onboarded, p("users.onboarded"))),
      row("Active users", fmtInt(cur.activity.activeUsers), deltaHtml(cur.activity.activeUsers, p("activity.activeUsers")), "distinct users who signed in"),
      row("Sign-ins", fmtInt(cur.activity.logins), deltaHtml(cur.activity.logins, p("activity.logins"))),
      row("Users who planned a trip", fmtInt(cur.activity.planners), deltaHtml(cur.activity.planners, p("activity.planners"))),
      row("Total users", fmtInt(snap.usersTotal), deltaHtml(snap.usersTotal, s("usersTotal")), `${fmtPct(snap.activationRatePct)} have created a trip`),
      listRow("Signups by platform", listLine(cur.users.byPlatform)),
      listRow("Signups by provider", listLine(cur.users.byProvider)),
    ]),
  );

  sections.push(
    section("Trips", [
      row("Trips created", fmtInt(cur.trips.created), deltaHtml(cur.trips.created, p("trips.created"))),
      row("Completed", fmtInt(cur.trips.completed), deltaHtml(cur.trips.completed, p("trips.completed"))),
      row("Failed", fmtInt(cur.trips.failed), deltaHtml(cur.trips.failed, p("trips.failed"), true)),
      row("Generation success rate", fmtPct(cur.trips.successRatePct), deltaHtml(cur.trips.successRatePct, p("trips.successRatePct"))),
      row("From a radar deal", fmtInt(cur.trips.deal), deltaHtml(cur.trips.deal, p("trips.deal"))),
      row("Multi-city", fmtInt(cur.trips.multiCity), deltaHtml(cur.trips.multiCity, p("trips.multiCity"))),
      row("Avg trip length", `${cur.trips.avgDurationDays} d`, deltaHtml(cur.trips.avgDurationDays, p("trips.avgDurationDays"))),
      row("Avg travellers", `${cur.trips.avgTravelers}`, deltaHtml(cur.trips.avgTravelers, p("trips.avgTravelers"))),
      row("Avg budget", fmtEur(cur.trips.avgBudgetEur), deltaHtml(cur.trips.avgBudgetEur, p("trips.avgBudgetEur"))),
      listRow("Top destinations", cur.trips.topDestinations.length
        ? cur.trips.topDestinations.map((d) => `${esc(d.destination)} ${fmtInt(d.count)}`).join(" · ")
        : "—"),
      listRow("By platform", listLine(cur.trips.byPlatform)),
      listRow("By language", listLine(cur.trips.byLanguage, 6)),
      row("Trips all-time", fmtInt(snap.tripsTotal), deltaHtml(snap.tripsTotal, s("tripsTotal"))),
    ]),
  );

  sections.push(
    section("Revenue", [
      row("Purchases", fmtInt(cur.monetization.purchases), deltaHtml(cur.monetization.purchases, p("monetization.purchases")), `${cur.monetization.monthly} monthly · ${cur.monetization.yearly} yearly`),
      row("Est. gross this " + periodWord, fmtEur(cur.monetization.estGrossEur), deltaHtml(cur.monetization.estGrossEur, p("monetization.estGrossEur")), "at configured EUR list prices"),
      row("Restores", fmtInt(cur.monetization.restores), deltaHtml(cur.monetization.restores, p("monetization.restores"))),
      row("Refunds", fmtInt(cur.monetization.refunds), deltaHtml(cur.monetization.refunds, p("monetization.refunds"), true)),
      row("Failed purchases", fmtInt(cur.monetization.failed), deltaHtml(cur.monetization.failed, p("monetization.failed"), true)),
      row("Est. MRR", fmtEur(snap.estMrrEur), deltaHtml(snap.estMrrEur, s("estMrrEur")), `ARR ${fmtEur(snap.estArrEur)}`),
      row("Active paying subscribers", fmtInt(snap.premiumPayingActive), deltaHtml(snap.premiumPayingActive, s("premiumPayingActive")), `${fmtPct(snap.payingConversionRatePct)} of all users`),
      row("Premium accounts (incl. comped)", fmtInt(snap.premium), deltaHtml(snap.premium, s("premium"))),
    ]),
  );

  sections.push(
    section("Deals, push & newsletter", [
      row("Radar deals added", fmtInt(cur.radar.dealsAdded), deltaHtml(cur.radar.dealsAdded, p("radar.dealsAdded")), `${cur.radar.dealsStillActive} still active`),
      row("Active deals right now", fmtInt(snap.activeDeals), deltaHtml(snap.activeDeals, s("activeDeals"))),
      row("Deal → plan-trip clicks", sinceLast(snap.radarPlanTripClicks, s("radarPlanTripClicks")), "", `since last report · ${fmtInt(snap.radarPlanTripClicks)} all-time`),
      row("Deal → booking clicks", sinceLast(snap.radarBookingClicks, s("radarBookingClicks")), "", `since last report · ${fmtInt(snap.radarBookingClicks)} all-time`),
      row("Affiliate clicks", sinceLast(snap.affiliateClicks, s("affiliateClicks")), "", `since last report · ${fmtInt(snap.affiliateClicks)} all-time`),
      row("Push broadcasts", fmtInt(cur.radar.broadcasts), deltaHtml(cur.radar.broadcasts, p("radar.broadcasts")), `${fmtInt(cur.radar.sent)} notifications sent`),
      row("Push tap-through", fmtPct(cur.radar.tapRatePct), deltaHtml(cur.radar.tapRatePct, p("radar.tapRatePct")), `${fmtInt(cur.radar.uniqueTaps)} unique taps`),
      row("Push-enabled devices", fmtInt(snap.pushTokens), deltaHtml(snap.pushTokens, s("pushTokens"))),
      row("Newsletter signups", fmtInt(cur.newsletter.signups), deltaHtml(cur.newsletter.signups, p("newsletter.signups")), `${cur.newsletter.active} confirmed · ${cur.newsletter.pending} pending`),
      row("Confirmed subscribers", `${fmtInt(cur.newsletter.activeTotal)}${cur.newsletter.activeTotalCapped ? "+" : ""}`, deltaHtml(cur.newsletter.activeTotal, p("newsletter.activeTotal"))),
    ]),
  );

  sections.push(
    section("Leads & partners", [
      row("OTA leads", fmtInt(cur.leads.otaLeads), deltaHtml(cur.leads.otaLeads, p("leads.otaLeads")), `${cur.leads.otaConverted} converted`),
      row("Partner applications", fmtInt(cur.leads.partnerApplications), deltaHtml(cur.leads.partnerApplications, p("leads.partnerApplications"))),
      row("Reservations captured", fmtInt(cur.leads.reservations), deltaHtml(cur.leads.reservations, p("leads.reservations")), `${cur.leads.reservationsByEmail} forwarded by email`),
      row("Active partner API keys", fmtInt(snap.partnerActiveKeys), deltaHtml(snap.partnerActiveKeys, s("partnerActiveKeys"))),
    ]),
  );

  // "Needs you" — actionable queues. Only rendered when something is waiting.
  const todo: string[] = [];
  if (snap.insightsPending > 0) todo.push(`${fmtInt(snap.insightsPending)} insights awaiting moderation`);
  if (snap.insightsFlagged > 0) todo.push(`${fmtInt(snap.insightsFlagged)} flagged insights`);
  if (snap.draftItineraries > 0) todo.push(`${fmtInt(snap.draftItineraries)} draft itineraries to approve`);
  if (snap.partnerProductsPending > 0) todo.push(`${fmtInt(snap.partnerProductsPending)} partner products pending`);
  if (snap.partnerApplicationsNew > 0) todo.push(`${fmtInt(snap.partnerApplicationsNew)} new partner applications`);
  const todoBlock = todo.length
    ? `<tr><td style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFBE0;border-radius:14px;border-left:4px solid #FFE500;">
          <tr><td style="padding:16px 18px;font-family:${FONT};">
            <p style="margin:0 0 8px;font-size:13px;font-weight:800;color:${INK};">Waiting on you</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#4A4A4A;">${todo.map((t) => `• ${esc(t)}`).join("<br/>")}</p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const errorRows = cur.health.top.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background:#FAF9F6;border-radius:12px;">
        <tr><td style="padding:14px 16px;font-family:${FONT};font-size:12px;line-height:1.7;color:#4A4A4A;">${cur.health.top
          .map((e) => `<b style="color:${INK};">${esc(e.source)}</b> ×${fmtInt(e.count)}<br/><span style="color:${MUTED};">${esc(e.message)}</span>`)
          .join("<br/><br/>")}</td></tr>
      </table>`
    : "";

  sections.push(
    section("Content & health", [
      row("Insights posted", fmtInt(cur.insights.created), deltaHtml(cur.insights.created, p("insights.created"))),
      row("Published SEO itineraries", fmtInt(snap.publishedItineraries), deltaHtml(snap.publishedItineraries, s("publishedItineraries"))),
      row("Distinct errors", fmtInt(cur.health.kinds), deltaHtml(cur.health.kinds, p("health.kinds"), true)),
      row("Error occurrences", fmtInt(cur.health.events), deltaHtml(cur.health.events, p("health.events"), true)),
    ]),
  );

  const footNotes: string[] = [];
  footNotes.push(
    prev
      ? `Deltas compare against the previous ${periodWord}'s report (${fmtDateTime(prev.sentAt)}).`
      : `First ${periodWord}ly report — no previous run to compare against yet.`,
  );
  if (snap.computedAt) footNotes.push(`All-time totals from the admin KPI snapshot computed ${fmtDateTime(snap.computedAt)}.`);
  if (cur.truncated.length) {
    footNotes.push(`⚠️ Scan limit reached for: ${cur.truncated.join(", ")} — those numbers are undercounted.`);
  }

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Planera ${esc(title)} — ${esc(label)}</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
${fmtInt(cur.users.new)} new users · ${fmtInt(cur.trips.created)} trips · ${fmtEur(snap.estMrrEur)} MRR · ${fmtInt(cur.monetization.purchases)} purchases
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">
      <tr><td style="padding:30px 32px 0;">
        <a href="${BASE_URL}" style="text-decoration:none;display:inline-block;"><img src="${BASE_URL}/logo.png" alt="Planera" width="120" style="display:block;width:120px;max-width:120px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-family:${FONT};">
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">${esc(title)}</p>
        <h1 style="margin:0 0 6px;font-size:30px;line-height:1.15;font-weight:800;color:${INK};letter-spacing:-1px;">${esc(label)}</h1>
        <p style="margin:0;font-size:13px;color:${MUTED};">${esc(fmtDateTime(opts.since))} → ${esc(fmtDateTime(opts.until))}</p>
      </td></tr>
      <tr><td style="padding:18px 26px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${tile("New users", fmtInt(cur.users.new), `${fmtInt(snap.usersTotal)} all-time`)}
            ${tile("Trips created", fmtInt(cur.trips.created), `${fmtPct(cur.trips.successRatePct)} success`)}
          </tr>
          <tr>
            ${tile("Est. MRR", fmtEur(snap.estMrrEur), `${fmtInt(snap.premiumPayingActive)} paying subs`)}
            ${tile("Purchases", fmtInt(cur.monetization.purchases), `${fmtEur(cur.monetization.estGrossEur)} est. gross`)}
          </tr>
        </table>
      </td></tr>${todoBlock}${sections.join("")}
      <tr><td style="padding:0 32px;">${errorRows}</td></tr>
      <tr><td style="padding:26px 32px 30px;font-family:${FONT};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:#1A1A1A;">
          <a href="${BASE_URL}/admin" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px;">Open the admin dashboard</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px 30px;border-top:1px solid #F0EEE9;font-family:${FONT};">
        ${footNotes.map((n) => `<p style="margin:0 0 6px;font-size:11px;line-height:1.6;color:#9A9A9A;">${esc(n)}</p>`).join("")}
        <p style="margin:8px 0 0;font-size:11px;line-height:1.6;color:#9A9A9A;">Automated internal report — not a marketing email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `PLANERA ${title.toUpperCase()} — ${label}`,
    `${fmtDateTime(opts.since)} → ${fmtDateTime(opts.until)}`,
    "",
    `New users: ${fmtInt(cur.users.new)} (all-time ${fmtInt(snap.usersTotal)})`,
    `Active users: ${fmtInt(cur.activity.activeUsers)} · sign-ins ${fmtInt(cur.activity.logins)} · planners ${fmtInt(cur.activity.planners)}`,
    `Trips created: ${fmtInt(cur.trips.created)} (completed ${fmtInt(cur.trips.completed)}, failed ${fmtInt(cur.trips.failed)}, ${fmtPct(cur.trips.successRatePct)} success)`,
    `Top destinations: ${cur.trips.topDestinations.slice(0, 5).map((d) => `${d.destination} ${d.count}`).join(", ") || "—"}`,
    `Purchases: ${fmtInt(cur.monetization.purchases)} (est. gross ${fmtEur(cur.monetization.estGrossEur)}) · refunds ${fmtInt(cur.monetization.refunds)}`,
    `Est. MRR: ${fmtEur(snap.estMrrEur)} · paying subs ${fmtInt(snap.premiumPayingActive)}`,
    `Radar: ${fmtInt(cur.radar.dealsAdded)} deals added · ${fmtInt(cur.radar.broadcasts)} broadcasts · ${fmtInt(cur.radar.sent)} pushes · ${fmtPct(cur.radar.tapRatePct)} tap-through`,
    `Newsletter: ${fmtInt(cur.newsletter.signups)} signups · ${fmtInt(cur.newsletter.activeTotal)} confirmed`,
    `Leads: ${fmtInt(cur.leads.otaLeads)} OTA · ${fmtInt(cur.leads.partnerApplications)} partner applications · ${fmtInt(cur.leads.reservations)} reservations`,
    `Insights posted: ${fmtInt(cur.insights.created)}`,
    `Errors: ${fmtInt(cur.health.kinds)} distinct / ${fmtInt(cur.health.events)} occurrences`,
    todo.length ? `\nWaiting on you:\n${todo.map((t) => `- ${t}`).join("\n")}` : "",
    "",
    ...footNotes,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

// ===========================================================================
// ENTRYPOINTS
// ===========================================================================

async function runReport(
  ctx: any,
  period: Period,
  args: { to?: string; dryRun?: boolean },
): Promise<{ period: Period; to: string; subject: string; sent: boolean; error?: string }> {
  const now = Date.now();
  const { since, until, label } = windowFor(period, now);
  const to = args.to || process.env.STATS_REPORT_TO || DEFAULT_TO;

  const cur: PeriodMetrics = await collectPeriod(ctx, since, until);
  const kpi = await ctx.runQuery(internal.statsReports._kpiSnapshot, {});
  const snap = extractSnapshot(kpi);
  const prev = await ctx.runQuery(internal.statsReports._previousRun, { period });

  const { subject, html, text } = renderReport({
    period, label, since, until, now, cur, snap, prev,
  });

  let sent = false;
  let error: string | undefined;
  if (args.dryRun) {
    console.log(`[stats-report] dry run (${period}) — would send to ${to}: ${subject}`);
  } else {
    const res: { success: boolean; error?: string } = await ctx.runAction(
      internal.postmark.sendRawEmail,
      { to, subject, html, text },
    );
    sent = res.success;
    error = res.error;
    if (!res.success) console.error(`[stats-report] send failed: ${res.error}`);
  }

  // Persisted even on a send failure: the stored metrics are what the NEXT
  // report diffs against, and "since the last run" stays truthful either way.
  // Dry runs are never persisted, so previewing can't poison the baseline.
  if (!args.dryRun) {
    await ctx.runMutation(internal.statsReports._saveRun, {
      period,
      periodStart: since,
      periodEnd: until,
      sentAt: now,
      to,
      emailSent: sent,
      emailError: error,
      metrics: { period: cur, snapshot: snap },
    });
  }

  return { period, to, subject, sent, error };
}

/** Cron: every Sunday. Covers the 7 days up to the moment it fires. */
export const sendWeeklyReport = internalAction({
  args: { to: v.optional(v.string()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => await runReport(ctx, "weekly", args),
});

/** Cron: the 1st of each month. Covers the whole previous calendar month. */
export const sendMonthlyReport = internalAction({
  args: { to: v.optional(v.string()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => await runReport(ctx, "monthly", args),
});
