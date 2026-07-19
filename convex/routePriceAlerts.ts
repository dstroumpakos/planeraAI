/**
 * Per-route fare watches — "email me when THIS flight gets cheaper".
 *
 * NOTE: deliberately NOT a `"use node"` module — it holds mutations and queries,
 * which only run in Convex's default runtime. The pricing action lives here too
 * and uses plain `fetch` via `ctx.runAction`, so no Node built-ins are needed.
 *
 * Distinct from `newsletter.ts`, which is a curated regional deal list. A row
 * in `routePriceAlerts` watches one origin→destination (optionally one date
 * pair) and emails that person when that specific fare falls.
 *
 * Created anonymously from the ChatGPT app and the website, so identity is an
 * email address plus double opt-in — never an account. Same token shape and
 * confirm/unsubscribe flow as the newsletter, so the two feel like one product.
 *
 * COST DISCIPLINE: every check is a paid searchapi call. The cron therefore
 *   • only looks at rows whose `nextCheckAt` is due,
 *   • processes a bounded batch per tick,
 *   • re-checks an individual watch at most every CHECK_INTERVAL_MS,
 *   • and rides the shared flight-search cache, so watches on the same route
 *     and dates cost one upstream call between them.
 */

import { v } from "convex/values";
import {
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { reportError } from "./helpers/reportError";

// How often a single watch is re-priced.
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
// Upper bound on watches re-priced per cron tick (each is one API call).
const BATCH_PER_TICK = 25;
// A drop must clear this much of the baseline to be worth an email.
const MIN_DROP_RATIO = 0.05; // 5%
const MIN_DROP_ABSOLUTE = 10; // or this many currency units, whichever is larger
// Unconfirmed watches are swept away rather than lingering forever.
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Hard cap on how long a flexible-date watch runs.
const MAX_WATCH_MS = 90 * 24 * 60 * 60 * 1000;
// Give up on a watch whose pricing keeps failing.
const MAX_CONSECUTIVE_FAILURES = 5;

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
  );
}

function normalizeEmail(raw: string): string | null {
  const email = (raw || "").trim().toLowerCase();
  // Deliberately permissive: rejecting valid-but-unusual addresses costs a real
  // subscriber, while a typo simply never confirms.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

function isIsoDate(s: string | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * When this watch stops being useful: the day after the outbound date for a
 * dated watch, otherwise the hard cap.
 */
function computeExpiry(outboundDate?: string): number {
  const cap = Date.now() + MAX_WATCH_MS;
  if (!isIsoDate(outboundDate)) return cap;
  const dep = Date.parse(`${outboundDate}T23:59:59Z`);
  if (!Number.isFinite(dep)) return cap;
  return Math.min(dep, cap);
}

/** Is `price` a big enough improvement on `reference` to be worth an email? */
function isMeaningfulDrop(price: number, reference: number): boolean {
  const drop = reference - price;
  if (drop <= 0) return false;
  return drop >= Math.max(reference * MIN_DROP_RATIO, MIN_DROP_ABSOLUTE);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a watch. Returns `pending` until the confirmation link is clicked —
 * we never email fares to an address that has not opted in.
 *
 * `deviceId` is used ONLY for rate limiting and creates no user record.
 */
export const create = mutation({
  args: {
    deviceId: v.string(),
    email: v.string(),
    departureId: v.string(),
    arrivalId: v.string(),
    outboundDate: v.optional(v.string()),
    returnDate: v.optional(v.string()),
    adults: v.optional(v.float64()),
    travelClass: v.optional(v.string()),
    stops: v.optional(v.string()),
    currency: v.optional(v.string()),
    baselinePrice: v.float64(),
    targetPrice: v.optional(v.float64()),
    language: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("already_active"),
      v.literal("invalid_email")
    ),
  }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) return { success: false, status: "invalid_email" as const };

    const departureId = args.departureId.trim().toUpperCase();
    const arrivalId = args.arrivalId.trim().toUpperCase();
    if (!departureId || !arrivalId) {
      return { success: false, status: "invalid_email" as const };
    }
    if (!(args.baselinePrice > 0)) {
      return { success: false, status: "invalid_email" as const };
    }

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      {
        userId: `alert:${args.deviceId || email}`,
        limit: 10,
        windowMs: 60 * 60 * 1000,
      }
    );
    if (!rl.allowed) throw new Error("Too many alert signups. Try again shortly.");

    // One watch per (email, route, dates) — a second request re-arms the
    // existing row instead of stacking duplicate emails on one person.
    const existing = await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const dup = existing.find(
      (a) =>
        a.departureId === departureId &&
        a.arrivalId === arrivalId &&
        (a.outboundDate ?? "") === (args.outboundDate ?? "") &&
        (a.returnDate ?? "") === (args.returnDate ?? "") &&
        (a.status === "active" || a.status === "pending")
    );
    if (dup) {
      await ctx.db.patch(dup._id, {
        baselinePrice: args.baselinePrice,
        targetPrice: args.targetPrice,
        expiresAt: computeExpiry(args.outboundDate),
        nextCheckAt: Date.now() + CHECK_INTERVAL_MS,
      });
      return {
        success: true,
        status:
          dup.status === "active" ? ("already_active" as const) : ("pending" as const),
      };
    }

    const confirmToken = randomToken();
    const unsubscribeToken = randomToken();
    const now = Date.now();

    await ctx.db.insert("routePriceAlerts", {
      email,
      departureId,
      arrivalId,
      outboundDate: isIsoDate(args.outboundDate) ? args.outboundDate : undefined,
      returnDate: isIsoDate(args.returnDate) ? args.returnDate : undefined,
      adults: args.adults,
      travelClass: args.travelClass,
      stops: args.stops,
      currency: (args.currency || "EUR").toUpperCase(),
      baselinePrice: args.baselinePrice,
      targetPrice: args.targetPrice,
      status: "pending",
      confirmToken,
      unsubscribeToken,
      language: args.language,
      source: args.source ?? "chatgpt-app",
      createdAt: now,
      expiresAt: computeExpiry(args.outboundDate),
      // Not checked until confirmed; confirm() pulls this forward.
      nextCheckAt: now + CHECK_INTERVAL_MS,
      notifyCount: 0,
      consecutiveFailures: 0,
    });

    await ctx.scheduler.runAfter(0, internal.routeAlertEmails.sendConfirmEmail, {
      confirmToken,
    });

    return { success: true, status: "pending" as const };
  },
});

/** Double opt-in. Hit from the link in the confirmation email. */
export const confirm = mutation({
  args: { token: v.string() },
  returns: v.object({
    success: v.boolean(),
    alreadyConfirmed: v.boolean(),
    route: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_confirm_token", (q) => q.eq("confirmToken", args.token))
      .unique();
    if (!row) return { success: false, alreadyConfirmed: false };
    const route = `${row.departureId} → ${row.arrivalId}`;
    if (row.status === "active") {
      return { success: true, alreadyConfirmed: true, route };
    }
    if (row.status !== "pending") {
      return { success: false, alreadyConfirmed: false, route };
    }
    await ctx.db.patch(row._id, {
      status: "active",
      confirmedAt: Date.now(),
      // Price it on the next tick so the watch proves itself immediately.
      nextCheckAt: Date.now(),
    });
    return { success: true, alreadyConfirmed: false, route };
  },
});

/** One-click unsubscribe from a single watch. */
export const unsubscribe = mutation({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean(), route: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_unsubscribe_token", (q) =>
        q.eq("unsubscribeToken", args.token)
      )
      .unique();
    if (!row) return { success: false };
    const route = `${row.departureId} → ${row.arrivalId}`;
    if (row.status !== "unsubscribed") {
      await ctx.db.patch(row._id, {
        status: "unsubscribed",
        unsubscribedAt: Date.now(),
      });
    }
    return { success: true, route };
  },
});

/** Read a watch by either token, so the confirm/unsubscribe pages can name it. */
export const getByToken = query({
  args: { token: v.string(), kind: v.union(v.literal("confirm"), v.literal("unsubscribe")) },
  handler: async (ctx, args) => {
    const row =
      args.kind === "confirm"
        ? await ctx.db
            .query("routePriceAlerts")
            .withIndex("by_confirm_token", (q) => q.eq("confirmToken", args.token))
            .unique()
        : await ctx.db
            .query("routePriceAlerts")
            .withIndex("by_unsubscribe_token", (q) =>
              q.eq("unsubscribeToken", args.token)
            )
            .unique();
    if (!row) return null;
    // Never expose the sibling token or the raw email.
    return {
      departureId: row.departureId,
      arrivalId: row.arrivalId,
      outboundDate: row.outboundDate,
      returnDate: row.returnDate,
      currency: row.currency,
      baselinePrice: row.baselinePrice,
      targetPrice: row.targetPrice,
      status: row.status,
      language: row.language,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal: cron plumbing
// ---------------------------------------------------------------------------

/** Active watches whose next check is due, oldest-due first, bounded. */
export const listDueAlerts = internalQuery({
  args: { now: v.float64(), limit: v.float64() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_status_and_next_check", (q) =>
        q.eq("status", "active").lte("nextCheckAt", args.now)
      )
      .order("asc")
      .take(args.limit);
  },
});

/** Watches to retire: expired travel dates and unconfirmed stragglers. */
export const listStaleAlerts = internalQuery({
  args: { now: v.float64(), limit: v.float64() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_status_and_next_check", (q) => q.eq("status", "active"))
      .take(200);
    const pending = await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_status_and_next_check", (q) => q.eq("status", "pending"))
      .take(200);
    const stale = [
      ...active.filter((a) => a.expiresAt <= args.now),
      ...pending.filter((a) => a.createdAt + PENDING_TTL_MS <= args.now),
    ];
    return stale.slice(0, args.limit).map((a) => a._id);
  },
});

export const markExpired = internalMutation({
  args: { ids: v.array(v.id("routePriceAlerts")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.patch(id, { status: "expired" });
    }
  },
});

/** Record the outcome of one price check. */
export const recordCheck = internalMutation({
  args: {
    id: v.id("routePriceAlerts"),
    price: v.optional(v.float64()),
    notified: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const now = Date.now();
    const failures = args.failed ? (row.consecutiveFailures ?? 0) + 1 : 0;
    const patch: Record<string, unknown> = {
      lastCheckedAt: now,
      nextCheckAt: now + CHECK_INTERVAL_MS,
      consecutiveFailures: failures,
    };
    if (args.price !== undefined) patch.lastCheckedPrice = args.price;
    if (args.notified && args.price !== undefined) {
      patch.lastNotifiedPrice = args.price;
      patch.lastNotifiedAt = now;
      patch.notifyCount = (row.notifyCount ?? 0) + 1;
      // A drop email resets the bar: the new, lower fare becomes the baseline,
      // so the next email requires a further genuine drop rather than firing
      // again on the same news.
      patch.baselinePrice = args.price;
    }
    // Stop burning API calls on a watch that never prices successfully.
    if (failures >= MAX_CONSECUTIVE_FAILURES) patch.status = "expired";
    await ctx.db.patch(args.id, patch);
  },
});

/** Full row for the emailing action (kept internal — carries email + tokens). */
export const getAlertInternal = internalQuery({
  args: { confirmToken: v.optional(v.string()), id: v.optional(v.id("routePriceAlerts")) },
  handler: async (ctx, args) => {
    if (args.id) return await ctx.db.get(args.id);
    if (!args.confirmToken) return null;
    return await ctx.db
      .query("routePriceAlerts")
      .withIndex("by_confirm_token", (q) => q.eq("confirmToken", args.confirmToken!))
      .unique();
  },
});


// ---------------------------------------------------------------------------
// Cron: re-price due watches and email genuine drops
// ---------------------------------------------------------------------------

/**
 * Price ONE watch. Dated watches use the exact date pair; flexible watches fall
 * back to the cheapest fare in the rolling calendar window.
 *
 * Returns null when pricing failed, which is deliberately distinguished from
 * "no drop": a failure must not reset the failure counter or move the baseline.
 */
async function priceWatch(ctx: any, row: any): Promise<number | null> {
  try {
    if (row.outboundDate) {
      const res: any = await ctx.runAction(internal.flightsSearchApi.internalSearch, {
        input: {
          departureId: row.departureId,
          arrivalId: row.arrivalId,
          outboundDate: row.outboundDate,
          returnDate: row.returnDate,
          type: row.returnDate ? "round_trip" : "one_way",
          adults: row.adults ?? 1,
          travelClass: row.travelClass ?? undefined,
          stops: row.stops ?? undefined,
          currency: row.currency,
          sortBy: "price",
        },
      });
      const options = [...(res?.bestFlights || []), ...(res?.otherFlights || [])];
      const prices = options
        .map((o: any) => o?.price)
        .filter((p: any) => typeof p === "number" && p > 0);
      if (!prices.length) return null;
      return Math.min(...prices);
    }

    // Flexible watch: cheapest fare anywhere in the scanned window.
    const cal: any = await ctx.runAction(
      internal.routePriceAlerts.priceFlexibleWatch,
      {
        departureId: row.departureId,
        arrivalId: row.arrivalId,
        currency: row.currency,
        adults: row.adults ?? 1,
      }
    );
    return typeof cal === "number" && cal > 0 ? cal : null;
  } catch {
    return null;
  }
}

/** Cheapest fare in the rolling calendar window, for flexible-date watches. */
export const priceFlexibleWatch = internalAction({
  args: {
    departureId: v.string(),
    arrivalId: v.string(),
    currency: v.string(),
    adults: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<number | null> => {
    const cal: any = await ctx.runAction(internal.flightCalendar.fetchForWatch, args);
    const dates: any[] = cal?.dates || [];
    const prices = dates
      .map((d) => d?.price)
      .filter((p) => typeof p === "number" && p > 0);
    return prices.length ? Math.min(...prices) : null;
  },
});

/**
 * Cron tick. Retires stale watches, then re-prices a bounded batch of due ones
 * and emails only drops that clear the noise floor.
 */
export const checkDueAlerts = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // 1) Retire watches whose travel date passed or that were never confirmed.
    try {
      const staleIds: any[] = await ctx.runQuery(
        internal.routePriceAlerts.listStaleAlerts,
        { now, limit: 100 }
      );
      if (staleIds.length) {
        await ctx.runMutation(internal.routePriceAlerts.markExpired, {
          ids: staleIds,
        });
      }
    } catch (err) {
      await reportError(ctx, "routePriceAlerts:retireStale", err, {});
    }

    // 2) Re-price the due batch.
    const due: any[] = await ctx.runQuery(internal.routePriceAlerts.listDueAlerts, {
      now,
      limit: BATCH_PER_TICK,
    });
    if (!due.length) return { checked: 0, notified: 0 };

    let notified = 0;
    for (const row of due) {
      const price = await priceWatch(ctx, row);
      if (price === null) {
        await ctx.runMutation(internal.routePriceAlerts.recordCheck, {
          id: row._id,
          failed: true,
        });
        continue;
      }

      // An explicit target is a hard threshold; otherwise the drop has to be
      // big enough to be worth an interruption. `lastNotifiedPrice` keeps a
      // slow slide from generating a mail every single tick.
      const reference =
        row.lastNotifiedPrice != null
          ? Math.min(row.lastNotifiedPrice, row.baselinePrice)
          : row.baselinePrice;
      const shouldNotify =
        row.targetPrice != null
          ? price <= row.targetPrice && isMeaningfulDrop(price, reference)
          : isMeaningfulDrop(price, reference);

      if (shouldNotify) {
        try {
          await ctx.runAction(internal.routeAlertEmails.sendDropEmail, {
            id: row._id,
            price,
            was: reference,
          });
          notified++;
        } catch (err) {
          await reportError(ctx, "routePriceAlerts:sendDropEmail", err, {
            departureId: row.departureId,
            arrivalId: row.arrivalId,
          });
        }
      }

      await ctx.runMutation(internal.routePriceAlerts.recordCheck, {
        id: row._id,
        price,
        notified: shouldNotify,
      });
    }

    console.log(
      `[routeAlerts] checked=${due.length} notified=${notified}`
    );
    return { checked: due.length, notified };
  },
});
