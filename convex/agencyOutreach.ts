/**
 * B2B outreach to travel agencies — "Planera for Travel Agencies" partner funnel.
 *
 * Sends a small, personalized, human-looking email to a curated list of Greek
 * travel agencies inviting them onto the agency portal (`convex/agency/`).
 *
 * THE WHOLE DESIGN OF THIS FILE IS ABOUT NOT GETTING FLAGGED AS SPAM.
 * A cold list is the single riskiest thing a sending domain can do, and
 * planeraai.app also carries booking receipts and password resets — mail that
 * MUST arrive. So:
 *
 *  1. SEPARATE STREAM + IDENTITY. Sends go out on a dedicated Postmark
 *     broadcast stream (`AGENCY_OUTREACH_STREAM`) from `partners@`. Postmark
 *     scores reputation per stream, so a bad week here cannot drag receipts
 *     into the spam folder.
 *  2. WARM-UP RAMP. `DAILY_RAMP` starts at a dozen a day and climbs. 547
 *     addresses go out over ~2 weeks, not in one burst. Receiving providers
 *     judge on *rate of change* as much as volume; a domain that jumps from 40
 *     mails/day to 550 is indistinguishable from a compromised account.
 *  3. HOURLY DRIP INSIDE BUSINESS HOURS. The daily budget is spread over
 *     working hours in Athens with a small per-tick cap, so the pattern looks
 *     like a person working a list rather than a machine flushing a queue.
 *  4. CIRCUIT BREAKER. Rolling bounce/complaint rates over the last
 *     `WINDOW_SIZE` sends auto-pause the campaign well before Postmark or an
 *     ISP would act on them. Bounce rate is the metric that gets domains
 *     blocked, and a stale directory list is exactly how it spikes.
 *  5. ONE-CLICK UNSUBSCRIBE. `List-Unsubscribe` + `List-Unsubscribe-Post`
 *     headers on every message (Gmail/Yahoo bulk-sender requirement) plus a
 *     plain link in the body. Making it trivial to leave is what keeps people
 *     from reaching for "report spam" instead — and a complaint costs ~100x a
 *     bounce.
 *  6. LIGHT HTML, REAL TEXT PART, NO LINK TRACKING. The message is a short
 *     business letter, not a newsletter: no hero image, no banners, and links
 *     that point at planeraai.app rather than being rewritten through a
 *     tracking domain.
 *  7. NO ATTACHMENT ON FIRST CONTACT. The deck is linked, not attached; it only
 *     rides along on the follow-up (`deckPolicy`). Unsolicited multi-megabyte
 *     attachments are a textbook filter trigger.
 *
 * Nothing here starts by itself: importing the list leaves the campaign
 * "paused", and an admin has to call `startCampaign`.
 */

import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertAdmin } from "./admin";
import { renderOutreachEmail, type Lang } from "./agencyOutreachCopy";
import { classifyBounce } from "./emailBounceCodes";

// Cross-file internal references need the same escape hatch the rest of the
// codebase uses until `convex dev` regenerates types. Results are hand-typed.
const internal = _internal as any;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Dedicated broadcast stream. Must exist in Postmark before starting. */
const OUTREACH_STREAM = process.env.AGENCY_OUTREACH_STREAM || "agency-outreach";

const OUTREACH_EMAIL = process.env.AGENCY_OUTREACH_EMAIL || "partners@planeraai.app";
const OUTREACH_SENDER_NAME = process.env.AGENCY_OUTREACH_SENDER_NAME || "Planera";
const OUTREACH_FROM = `${OUTREACH_SENDER_NAME} <${OUTREACH_EMAIL}>`;

const POSTMARK_TAG = "agency-outreach";

/**
 * Copy of every outreach send, so the team has a running record without
 * digging through the Postmark log.
 *
 * BCC rather than CC by design: a visible `Cc: marketing@planeraai.app` on a
 * mail that opens "I came across your agency..." tells the recipient it came
 * out of a machine, which is exactly the impression the personalization is
 * there to avoid. Set `AGENCY_OUTREACH_CC` instead if the copy genuinely needs
 * to be visible; both are billed as extra recipients by Postmark.
 */
const OUTREACH_BCC = process.env.AGENCY_OUTREACH_BCC ?? "marketing@planeraai.app";
const OUTREACH_CC = process.env.AGENCY_OUTREACH_CC ?? "";

/**
 * Warm-up ladder: emails per day, indexed by day of the campaign. The last
 * entry is the steady-state ceiling. Deliberately conservative — the list is
 * only 547 addresses, so even the slow ramp finishes in about two weeks, and
 * there is no upside to going faster.
 */
const DAILY_RAMP = [12, 18, 25, 35, 45, 55, 60, 70, 75, 80];
const DAILY_CEILING = 80;

/**
 * Hard ceiling per hourly tick, so a wide budget still drips.
 *
 * Bounded by the action time limit, not by taste: the sender sleeps up to
 * JITTER_MAX_MS between messages, so a tick costs at most
 * (MAX_PER_TICK - 1) * JITTER_MAX_MS. Convex kills an action at 10 minutes, and
 * a tick killed halfway leaves leads claimed but unsent.
 */
const MAX_PER_TICK = 8;
const JITTER_MIN_MS = 15_000;
const JITTER_MAX_MS = 45_000;

/**
 * A lead claimed but not resolved within this window is assumed to belong to a
 * tick that died, and goes back in the queue.
 */
const STALE_CLAIM_MS = 30 * 60 * 1000;

/** Local sending window (Athens). Outside it the tick is a no-op. */
const SEND_HOUR_START = 9;
const SEND_HOUR_END = 17;
/** 0 = Sunday. Weekend sends to businesses get read Monday, or not at all. */
const SEND_DAYS = new Set([1, 2, 3, 4, 5]);

/** Days after the first touch before the single follow-up becomes eligible. */
const FOLLOW_UP_DELAY_MS = 6 * 24 * 60 * 60 * 1000;

// --- Circuit breaker ---
/**
 * Rolling window of sends the health ratios are computed over.
 *
 * Genuinely rolling: the state carries the ids of the last WINDOW_SIZE leads
 * contacted and the ratios are recounted from their CURRENT status. The first
 * version kept running totals that only cleared once a 150-send block filled
 * up, which made it a tumbling window wearing a rolling window's name — two
 * bounces early in a block sat in the numerator while the denominator
 * restarted, so a flawless sending day could not clear the flag, and one did
 * not: 2026-09-03 sent its full cap with zero bounces and was paused the next
 * morning by two bounces from the day before.
 */
const WINDOW_SIZE = 150;
/**
 * Minimum sends before the ratios mean anything.
 *
 * At 40 the ratio moves in 2.5% steps, so the second bounce in a window trips
 * a 4% ceiling on its own — a coin-flip, not a signal. 100 gives the number
 * one-percent resolution before it is allowed to stop the campaign.
 */
const WINDOW_MIN_SAMPLE = 100;
/**
 * Postmark warns around 5% and reviews accounts near 10%.
 *
 * 7% is above the ~6% a directory-sourced Greek agency list actually bounces
 * after DNS cleaning, and below the level that draws attention. Raised from 4%
 * deliberately (Dionysis, 2026-09-06) once complaints had held at zero across
 * 83 sends: complaints are the metric that damages a domain, bounces mostly
 * damage the sending IP's standing, and this list earns none of the former.
 * If complaints ever appear, MAX_COMPLAINTS below is the guard that matters.
 */
const MAX_BOUNCE_RATE = 0.07;
/** Two complaints in a 150-send window is already an order of magnitude over
 *  the 0.1% threshold Gmail publishes. */
const MAX_COMPLAINTS = 2;

const STATE_KEY = "default";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

async function requireAdmin(ctx: any, token: string): Promise<string> {
  const userId = await getUserIdFromToken(ctx, token);
  if (!userId) throw new ConvexError("Unauthorized");
  await assertAdmin(ctx, userId);
  return userId;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Cheap syntactic screen. Bounces are what get a domain blocked, and a scraped
 * directory always contains a few mangled addresses; catching them here costs
 * nothing, catching them at Postmark costs reputation.
 */
export function isPlausibleEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  if (!/^[^\s@,;<>()[\]\\]+@[^\s@,;<>()[\]\\]+\.[a-z]{2,}$/i.test(email)) return false;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64) return false;
  if (domain.startsWith("-") || domain.includes("..")) return false;
  // Placeholder rows that survive a directory export.
  if (/^(example|test|noreply|no-reply|donotreply)\b/i.test(local)) return false;
  if (/^(example\.|test\.|localhost)/i.test(domain)) return false;
  return true;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Athens wall-clock parts. Falls back to UTC+2 if the tz database is absent. */
function athensNow(now: number): { hour: number; weekday: number; day: string } {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value])
    ) as Record<string, string>;
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return {
      hour: parseInt(parts.hour, 10),
      weekday: weekdayMap[parts.weekday] ?? 1,
      day: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    const d = new Date(now + 2 * 60 * 60 * 1000);
    return {
      hour: d.getUTCHours(),
      weekday: d.getUTCDay(),
      day: d.toISOString().slice(0, 10),
    };
  }
}

function dailyCap(dayIndex: number, override?: number): number {
  if (typeof override === "number" && override > 0) return Math.min(override, DAILY_CEILING);
  const i = Math.max(0, Math.min(dayIndex, DAILY_RAMP.length - 1));
  return DAILY_RAMP[i];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Bounce/complaint counts over the last WINDOW_SIZE sends, recounted from the
 * leads themselves.
 *
 * Derived rather than incremented because a bounce lands minutes to hours
 * AFTER the send that caused it: any counter-based scheme has to decide what
 * to do when the send that owns a bounce falls out of the window, and gets it
 * wrong. Reading ~150 rows once an hour is cheaper than that bug.
 */
async function windowHealth(
  ctx: any,
  state: any
): Promise<{ sent: number; bounced: number; complained: number }> {
  const ids: any[] = state?.recentLeadIds ?? [];
  let bounced = 0;
  let complained = 0;
  for (const id of ids) {
    const lead = await ctx.db.get(id);
    if (!lead) continue;
    if (lead.status === "bounced") bounced++;
    else if (lead.status === "complained") complained++;
  }
  return { sent: ids.length, bounced, complained };
}

async function readState(ctx: any) {
  return await ctx.db
    .query("agencyOutreachState")
    .withIndex("by_key", (q: any) => q.eq("key", STATE_KEY))
    .unique();
}

async function ensureState(ctx: any) {
  const existing = await readState(ctx);
  if (existing) return existing;
  const id = await ctx.db.insert("agencyOutreachState", {
    key: STATE_KEY,
    status: "paused" as const,
    dayIndex: 0,
    sentToday: 0,
    totalSent: 0,
    windowSent: 0,
    windowBounced: 0,
    windowComplained: 0,
    deckPolicy: "followup" as const,
    updatedAt: Date.now(),
  });
  return await ctx.db.get(id);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const leadRowValidator = v.object({
  email: v.string(),
  agencyName: v.string(),
  city: v.optional(v.string()),
  website: v.optional(v.string()),
  phone: v.optional(v.string()),
  agencyType: v.optional(v.string()),
  services: v.optional(v.string()),
  sourceName: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  language: v.optional(v.string()),
});

const importResultValidator = v.object({
  inserted: v.float64(),
  updated: v.float64(),
  skipped: v.float64(),
});

interface LeadRow {
  email: string;
  agencyName: string;
  city?: string;
  website?: string;
  phone?: string;
  agencyType?: string;
  services?: string;
  sourceName?: string;
  sourceUrl?: string;
  language?: string;
}

/**
 * Bulk upsert of scraped leads. Idempotent by email, so the importer can be
 * re-run after fixing the source sheet without duplicating anyone.
 *
 * Rows that fail validation are stored as "skipped" rather than dropped: a
 * silently missing lead is indistinguishable from a scraping bug, and the
 * skip reason is what tells the two apart.
 */
async function importLeadsCore(
  ctx: any,
  rows: LeadRow[]
): Promise<{ inserted: number; updated: number; skipped: number }> {
  await ensureState(ctx);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const now = Date.now();

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const valid = isPlausibleEmail(email);

    const existing = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .unique();

    if (existing) {
      // Never resurrect someone who left, bounced, or complained.
      const terminal = ["opted_out", "bounced", "complained", "replied", "converted"];
      if (!terminal.includes(existing.status)) {
        await ctx.db.patch(existing._id, {
          agencyName: row.agencyName || existing.agencyName,
          city: row.city ?? existing.city,
          website: row.website ?? existing.website,
          phone: row.phone ?? existing.phone,
          agencyType: row.agencyType ?? existing.agencyType,
          services: row.services ?? existing.services,
          sourceName: row.sourceName ?? existing.sourceName,
          sourceUrl: row.sourceUrl ?? existing.sourceUrl,
        });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    await ctx.db.insert("agencyOutreachLeads", {
      email,
      agencyName: row.agencyName?.trim() || email,
      city: row.city?.trim() || undefined,
      website: row.website?.trim() || undefined,
      phone: row.phone?.trim() || undefined,
      agencyType: row.agencyType?.trim() || undefined,
      services: row.services?.trim() || undefined,
      sourceName: row.sourceName?.trim() || undefined,
      sourceUrl: row.sourceUrl?.trim() || undefined,
      language: row.language === "en" ? "en" : "el",
      status: valid ? ("new" as const) : ("skipped" as const),
      skipReason: valid ? undefined : "invalid_email",
      stage: 0,
      optOutToken: randomToken(),
      sendAttempts: 0,
      importedAt: now,
    });
    if (valid) inserted++;
    else skipped++;
  }

  return { inserted, updated, skipped };
}

export const importLeads = mutation({
  args: { token: v.string(), rows: v.array(leadRowValidator) },
  returns: importResultValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await importLeadsCore(ctx, args.rows);
  },
});

/**
 * CLI/dashboard entry point. Internal functions are unreachable from any
 * client, so calling this needs Convex deployment credentials — a higher bar
 * than a user session token, and the only workable route for an operator who
 * signs in with Google and so has no password to script against.
 */
export const importLeadsAdmin = internalMutation({
  args: { rows: v.array(leadRowValidator) },
  returns: importResultValidator,
  handler: async (ctx, args) => await importLeadsCore(ctx, args.rows),
});

// ---------------------------------------------------------------------------
// Deck (Convex file storage)
// ---------------------------------------------------------------------------

export const generateDeckUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setDeck = mutation({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    deckPolicy: v.optional(
      v.union(v.literal("never"), v.literal("followup"), v.literal("always"))
    ),
  },
  returns: v.object({ ok: v.boolean(), url: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const state = await ensureState(ctx);
    await ctx.db.patch(state._id, {
      deckStorageId: args.storageId,
      deckFileName: args.fileName,
      deckPolicy: args.deckPolicy ?? state.deckPolicy ?? "followup",
      updatedAt: Date.now(),
    });
    return { ok: true, url: await ctx.storage.getUrl(args.storageId) };
  },
});

// ---------------------------------------------------------------------------
// Campaign control
// ---------------------------------------------------------------------------

export const generateDeckUploadUrlAdmin = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setDeckAdmin = internalMutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    deckPolicy: v.optional(
      v.union(v.literal("never"), v.literal("followup"), v.literal("always"))
    ),
  },
  returns: v.object({ ok: v.boolean(), url: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const state = await ensureState(ctx);
    await ctx.db.patch(state._id, {
      deckStorageId: args.storageId,
      deckFileName: args.fileName,
      deckPolicy: args.deckPolicy ?? state.deckPolicy ?? "followup",
      updatedAt: Date.now(),
    });
    return { ok: true, url: await ctx.storage.getUrl(args.storageId) };
  },
});

async function startCore(ctx: any, dailyCapOverride?: number) {
  const state = await ensureState(ctx);
  const now = Date.now();
  await ctx.db.patch(state._id, {
    status: "running" as const,
    startedAt: state.startedAt ?? now,
    pausedReason: undefined,
    dailyCapOverride,
    updatedAt: now,
  });
  return { status: "running", dailyCap: dailyCap(state.dayIndex, dailyCapOverride) };
}

async function pauseCore(ctx: any, reason?: string) {
  const state = await ensureState(ctx);
  await ctx.db.patch(state._id, {
    status: "paused" as const,
    pausedReason: reason ?? "manual",
    updatedAt: Date.now(),
  });
  return { status: "paused" };
}

export const startCampaign = mutation({
  args: { token: v.string(), dailyCapOverride: v.optional(v.float64()) },
  returns: v.object({ status: v.string(), dailyCap: v.float64() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await startCore(ctx, args.dailyCapOverride);
  },
});

export const startCampaignAdmin = internalMutation({
  args: { dailyCapOverride: v.optional(v.float64()) },
  returns: v.object({ status: v.string(), dailyCap: v.float64() }),
  handler: async (ctx, args) => await startCore(ctx, args.dailyCapOverride),
});

export const pauseCampaign = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await pauseCore(ctx, args.reason);
  },
});

/** The stop button. Reachable from the CLI without a login, on purpose. */
export const pauseCampaignAdmin = internalMutation({
  args: { reason: v.optional(v.string()) },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => await pauseCore(ctx, args.reason),
});

/** Clears the rolling health window so a fixed list can resume after a trip. */
export const resetHealthWindow = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    await resetWindowCore(ctx);
    return null;
  },
});

/** Same, reachable from the CLI without a login — the other half of the
 *  stop/start pair that `pauseCampaignAdmin` and `startCampaignAdmin` form. */
export const resetHealthWindowAdmin = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await resetWindowCore(ctx);
    return null;
  },
});

async function resetWindowCore(ctx: any): Promise<void> {
  const state = await ensureState(ctx);
  await ctx.db.patch(state._id, {
    recentLeadIds: [],
    windowSent: 0,
    windowBounced: 0,
    windowComplained: 0,
    windowSoftBounced: 0,
    updatedAt: Date.now(),
  });
}

export const setLeadStatus = mutation({
  args: {
    token: v.string(),
    leadId: v.id("agencyOutreachLeads"),
    status: v.union(
      v.literal("replied"),
      v.literal("converted"),
      v.literal("opted_out"),
      v.literal("new")
    ),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const now = Date.now();
    await ctx.db.patch(args.leadId, {
      status: args.status,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.status === "replied" ? { repliedAt: now } : {}),
      ...(args.status === "opted_out" ? { optedOutAt: now } : {}),
      // Any manual status change ends the automated sequence; re-queuing as
      // "new" restarts it from the first touch rather than resuming a stale
      // follow-up timer.
      followUpAt: undefined,
      ...(args.status === "new" ? { stage: 0, lastError: undefined } : {}),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Opt-out (public — reached from the email, no auth)
// ---------------------------------------------------------------------------

export const optOut = mutation({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean(), agencyName: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const lead = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_opt_out_token", (q) => q.eq("optOutToken", args.token))
      .unique();
    // Always answer the same way: the token is a bearer secret, and confirming
    // which tokens exist would let someone enumerate the list.
    if (!lead) return { ok: true, agencyName: undefined };
    if (lead.status !== "opted_out") {
      await ctx.db.patch(lead._id, {
        status: "opted_out" as const,
        optedOutAt: Date.now(),
        followUpAt: undefined,
      });
    }
    return { ok: true, agencyName: lead.agencyName };
  },
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export const overview = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await overviewCore(ctx);
  },
});

export const overviewAdmin = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => await overviewCore(ctx),
});

async function overviewCore(ctx: any) {
  const state = await readState(ctx);
  const leads = await ctx.db.query("agencyOutreachLeads").collect();

  const byStatus: Record<string, number> = {};
  let opened = 0;
  let clicked = 0;
  for (const l of leads) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    if ((l.openCount ?? 0) > 0) opened++;
    if ((l.clickCount ?? 0) > 0) clicked++;
  }

  const health = await windowHealth(ctx, state);
  const windowSent = health.sent;
  return {
    status: state?.status ?? "paused",
    pausedReason: state?.pausedReason,
    dayIndex: state?.dayIndex ?? 0,
    dailyCap: dailyCap(state?.dayIndex ?? 0, state?.dailyCapOverride),
    sentToday: state?.sentToday ?? 0,
    totalSent: state?.totalSent ?? 0,
    deckAttached: Boolean(state?.deckStorageId),
    deckFileName: state?.deckFileName ?? null,
    deckPolicy: state?.deckPolicy ?? "followup",
    health: {
      windowSent,
      bounceRate: windowSent ? health.bounced / windowSent : 0,
      bounces: health.bounced,
      complaints: health.complained,
      // A running count since the last reset rather than a windowed one, and
      // shown next to the ratio it is deliberately excluded from, so a run
      // full of transient failures is visible rather than merely absent.
      softBounces: state?.windowSoftBounced ?? 0,
      maxBounceRate: MAX_BOUNCE_RATE,
      minSample: WINDOW_MIN_SAMPLE,
    },
    total: leads.length,
    byStatus,
    opened,
    clicked,
    remaining: byStatus["new"] ?? 0,
  };
}

export const listLeads = query({
  args: {
    token: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.float64()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.status) {
      return await ctx.db
        .query("agencyOutreachLeads")
        .withIndex("by_status", (q) => q.eq("status", args.status as any))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("agencyOutreachLeads").order("desc").take(limit);
  },
});

// ---------------------------------------------------------------------------
// List hygiene (DNS verification)
// ---------------------------------------------------------------------------
//
// A scraped directory is mostly dead weight at the edges: agencies that closed,
// domains that lapsed, addresses typed into a listing form years ago. Postmark
// will happily try all of them, and the resulting hard bounces are the single
// metric that gets a sending domain blocked — the first run tripped the breaker
// at 7.5% on exactly this.
//
// Resolving the domain first catches the cheap half of that (a domain with no
// MX and no address record cannot receive mail from anyone, ever) without
// sending anything. It does NOT prove a specific mailbox exists: that needs
// SMTP probing, which is itself reputation-damaging, so the remaining risk is
// deliberately left to the circuit breaker.

/** DNS-over-HTTPS, because a Convex action has fetch and nothing else. */
const DOH_PRIMARY = "https://dns.google/resolve";
const DOH_FALLBACK = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 6000;
/** Domains resolved in parallel. Polite to the resolver, fast enough for 283. */
const DNS_CONCURRENCY = 8;
/** Leads per invocation. Bounded so a pass never nears the action time limit. */
const VERIFY_BATCH = 250;

/** `ok: null` means the resolver failed — verdict unknown, try again later. */
type DomainVerdict =
  | { ok: true; host?: string }
  | { ok: false; reason: string }
  | { ok: null; reason: string };

async function dohQuery(name: string, type: "MX" | "A" | "AAAA"): Promise<any | null> {
  for (const base of [DOH_PRIMARY, DOH_FALLBACK]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // Try the other resolver before giving up: a single provider hiccup must
      // never be allowed to mark a live domain dead.
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** At least one answer of the requested record type. */
function hasAnswer(json: any, rrType: number): boolean {
  const answers = Array.isArray(json?.Answer) ? json.Answer : [];
  return answers.some((a: any) => a?.type === rrType);
}

/** DNS RCODEs: 0 NOERROR, 3 NXDOMAIN. Anything else is the resolver failing,
 *  not an answer — SERVFAIL on a live domain is common and must never read as
 *  "this address is dead". */
function isUsable(json: any): boolean {
  return json?.Status === 0 || json?.Status === 3;
}

export async function resolveMailDomain(domain: string): Promise<DomainVerdict> {
  const mx = await dohQuery(domain, "MX");
  if (mx === null) return { ok: null, reason: "resolver_unavailable" };
  if (!isUsable(mx)) return { ok: null, reason: `dns_status_${mx.Status}` };

  // NXDOMAIN is the cleanest verdict there is: the domain does not exist.
  if (mx.Status === 3) return { ok: false, reason: "nxdomain" };

  if (hasAnswer(mx, 15)) {
    const records = (mx.Answer as any[])
      .filter((a) => a?.type === 15 && typeof a.data === "string")
      .map((a) => String(a.data).trim());
    const hosts = records
      .map((r) => {
        const parts = r.split(/\s+/);
        return { pref: Number(parts[0]), host: (parts[1] ?? "").replace(/\.$/, "") };
      })
      .filter((r) => r.host)
      .sort((a, b) => a.pref - b.pref);
    // RFC 7505 "null MX": a single "0 ." record is the domain stating in
    // public that it accepts no mail at all.
    if (hosts.length === 0) return { ok: false, reason: "null_mx" };
    return { ok: true, host: hosts[0].host };
  }

  // No MX is not fatal: RFC 5321 falls back to the address record.
  const a = await dohQuery(domain, "A");
  if (a === null) return { ok: null, reason: "resolver_unavailable" };
  if (!isUsable(a)) return { ok: null, reason: `dns_status_${a.Status}` };
  if (hasAnswer(a, 1)) return { ok: true, host: domain };

  const aaaa = await dohQuery(domain, "AAAA");
  if (aaaa === null) return { ok: null, reason: "resolver_unavailable" };
  if (!isUsable(aaaa)) return { ok: null, reason: `dns_status_${aaaa.Status}` };
  if (hasAnswer(aaaa, 28)) return { ok: true, host: domain };

  return { ok: false, reason: "no_mx" };
}

export const pendingUnverifiedLeads = internalQuery({
  args: { limit: v.optional(v.float64()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? VERIFY_BATCH, 500);
    const rows = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_status", (q) => q.eq("status", "new" as const))
      .collect();
    const pending = rows.filter((r) => r.mxCheckedAt === undefined);
    return {
      leads: pending.slice(0, limit).map((r) => ({ leadId: r._id, email: r.email })),
      remaining: Math.max(0, pending.length - limit),
    };
  },
});

export const applyMxVerification = internalMutation({
  args: {
    results: v.array(
      v.object({
        leadId: v.id("agencyOutreachLeads"),
        ok: v.boolean(),
        reason: v.optional(v.string()),
        host: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({ kept: v.float64(), skipped: v.float64() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let kept = 0;
    let skipped = 0;
    for (const r of args.results) {
      const lead = await ctx.db.get(r.leadId);
      // Anything that moved on while the DNS pass ran (a send, a reply, an
      // opt-out) outranks a verification computed before it.
      if (!lead || lead.status !== "new") continue;
      if (r.ok) {
        await ctx.db.patch(r.leadId, { mxCheckedAt: now, mxHost: r.host });
        kept++;
      } else {
        await ctx.db.patch(r.leadId, {
          status: "skipped" as const,
          skipReason: r.reason ?? "no_mx",
          mxCheckedAt: now,
        });
        skipped++;
      }
    }
    return { kept, skipped };
  },
});

interface VerifyResult {
  checked: number;
  kept: number;
  skipped: number;
  unresolved: number;
  remaining: number;
}

async function verifyPendingCore(ctx: any, limit?: number): Promise<VerifyResult> {
  const batch: any = await ctx.runQuery(internal.agencyOutreach.pendingUnverifiedLeads, {
    limit,
  });
  const leads: Array<{ leadId: Id<"agencyOutreachLeads">; email: string }> = batch.leads ?? [];
  if (leads.length === 0) {
    return { checked: 0, kept: 0, skipped: 0, unresolved: 0, remaining: 0 };
  }

  // One lookup per DOMAIN, not per lead: a directory of Greek agencies is full
  // of shared hosts, and 507 addresses are only 283 domains.
  const domains = Array.from(
    new Set(leads.map((l) => l.email.split("@")[1]).filter(Boolean))
  );
  const verdicts = new Map<string, DomainVerdict>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(DNS_CONCURRENCY, domains.length) }, async () => {
      while (cursor < domains.length) {
        const domain = domains[cursor++];
        verdicts.set(domain, await resolveMailDomain(domain));
      }
    })
  );

  const results: Array<{
    leadId: Id<"agencyOutreachLeads">;
    ok: boolean;
    reason?: string;
    host?: string;
  }> = [];
  let unresolved = 0;
  for (const lead of leads) {
    if (!isPlausibleEmail(lead.email)) {
      results.push({ leadId: lead.leadId, ok: false, reason: "invalid_email" });
      continue;
    }
    const domain = lead.email.split("@")[1];
    const verdict = verdicts.get(domain);
    // An unknown verdict leaves the lead untouched and unverified so the next
    // pass picks it up. Never skip a lead because DNS was having a bad minute.
    if (!verdict || verdict.ok === null) {
      unresolved++;
      continue;
    }
    results.push(
      verdict.ok
        ? { leadId: lead.leadId, ok: true, host: verdict.host }
        : { leadId: lead.leadId, ok: false, reason: verdict.reason }
    );
  }

  const applied: any = await ctx.runMutation(internal.agencyOutreach.applyMxVerification, {
    results,
  });
  return {
    checked: results.length,
    kept: applied.kept,
    skipped: applied.skipped,
    unresolved,
    remaining: batch.remaining + unresolved,
  };
}

const verifyResultValidator = v.object({
  checked: v.float64(),
  kept: v.float64(),
  skipped: v.float64(),
  unresolved: v.float64(),
  remaining: v.float64(),
});

/**
 * Verifies one batch of never-contacted leads and skips the undeliverable
 * ones. Safe to call repeatedly: `remaining` is how many are still unchecked.
 */
export const verifyPendingLeads = action({
  args: { token: v.string(), limit: v.optional(v.float64()) },
  returns: verifyResultValidator,
  handler: async (ctx, args): Promise<VerifyResult> => {
    await ctx.runQuery(internal.agencyOutreach.assertAdminToken, { token: args.token });
    return await verifyPendingCore(ctx, args.limit);
  },
});

export const verifyPendingLeadsAdmin = internalAction({
  args: { limit: v.optional(v.float64()) },
  returns: verifyResultValidator,
  handler: async (ctx, args): Promise<VerifyResult> => await verifyPendingCore(ctx, args.limit),
});

/**
 * One-off repair for leads mislabelled before the SubscriptionChange fix: a
 * hard bounce that Postmark auto-suppressed was recorded as "opted_out", which
 * reads as "they asked to leave" in every funnel number.
 */
export const backfillBounceStatusesAdmin = internalMutation({
  args: {},
  returns: v.object({ relabelled: v.float64() }),
  handler: async (ctx) => {
    const leads = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_status", (q) => q.eq("status", "opted_out" as const))
      .collect();
    let relabelled = 0;
    for (const lead of leads) {
      const suppression = await ctx.db
        .query("emailSuppressions")
        .withIndex("by_email", (q: any) => q.eq("email", lead.email))
        .unique();
      if (!suppression) continue;
      if (suppression.reason === "hard_bounce") {
        await ctx.db.patch(lead._id, { status: "bounced" as const, optedOutAt: undefined });
        relabelled++;
      } else if (suppression.reason === "spam_complaint") {
        await ctx.db.patch(lead._id, { status: "complained" as const, optedOutAt: undefined });
        relabelled++;
      }
    }
    return { relabelled };
  },
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface SendJob {
  leadId: Id<"agencyOutreachLeads">;
  email: string;
  agencyName: string;
  city?: string;
  services?: string;
  language: string;
  stage: 1 | 2;
  optOutToken: string;
}

interface ClaimResult {
  jobs: SendJob[];
  deckUrl: string | null;
  deckStorageId: Id<"_storage"> | null;
  deckFileName: string | null;
  attachOnStage: number | null;
}

/**
 * Decide the budget for this tick and reserve that many leads in one
 * transaction, so a retried or overlapping tick can never double-send.
 *
 * Follow-ups are claimed before first touches: finishing a started
 * conversation is worth more than starting another one, and it keeps the
 * total daily volume flat instead of stacking two sequences on top of
 * each other.
 */
export const claimDueLeads = internalMutation({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<ClaimResult | { jobs: []; reason: string }> => {
    const state = await ensureState(ctx);
    const now = Date.now();
    await ctx.db.patch(state._id, { lastTickAt: now });

    // Recover anything a previous tick claimed and never resolved (timeout,
    // deploy mid-run). Without this a stranded lead is invisible: not "new",
    // so never re-claimed, and not "sent", so never followed up.
    const stale = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_status", (q) => q.eq("status", "queued" as const))
      .take(100);
    for (const lead of stale) {
      if ((lead.queuedAt ?? 0) > now - STALE_CLAIM_MS) continue;
      await ctx.db.patch(lead._id, {
        status: lead.stage >= 1 ? ("sent" as const) : ("new" as const),
        queuedAt: undefined,
      });
    }

    if (state.status !== "running") return { jobs: [], reason: state.status };

    const { hour, weekday, day } = athensNow(now);
    if (!SEND_DAYS.has(weekday)) return { jobs: [], reason: "weekend" };
    if (hour < SEND_HOUR_START || hour >= SEND_HOUR_END) {
      return { jobs: [], reason: "outside_hours" };
    }

    // --- Circuit breaker ---------------------------------------------------
    const health = await windowHealth(ctx, state);
    const windowSent = health.sent;
    // Mirrored onto the state so the dashboard and any other reader see the
    // same numbers the breaker just judged on.
    await ctx.db.patch(state._id, {
      windowSent,
      windowBounced: health.bounced,
      windowComplained: health.complained,
    });
    if (windowSent >= WINDOW_MIN_SAMPLE) {
      const bounceRate = health.bounced / windowSent;
      const complaints = health.complained;
      if (bounceRate > MAX_BOUNCE_RATE || complaints > MAX_COMPLAINTS) {
        const pausedReason =
          bounceRate > MAX_BOUNCE_RATE
            ? `bounce rate ${(bounceRate * 100).toFixed(1)}% over ${windowSent} sends`
            : `${complaints} spam complaints in ${windowSent} sends`;
        await ctx.db.patch(state._id, {
          status: "auto_paused" as const,
          pausedReason,
          updatedAt: now,
        });
        // An auto-pause needs a human to clear it, so it has to reach one. The
        // first trip sat unnoticed from Friday morning to Sunday afternoon and
        // cost a sending day.
        await ctx.scheduler.runAfter(0, internal.agencyOutreach.sendPauseAlert, {
          reason: pausedReason,
          windowSent,
          bounced: health.bounced,
          complained: health.complained,
        });
        return { jobs: [], reason: "auto_paused" };
      }
    }

    // --- Daily budget ------------------------------------------------------
    let sentToday = state.sentToday ?? 0;
    let dayIndex = state.dayIndex ?? 0;
    if (state.counterDay !== day) {
      // New calendar day in Athens: reset the counter and step the ramp. The
      // ramp advances per DAY WITH SENDING, not per elapsed day, so a weekend
      // or a pause does not silently skip the warm-up.
      sentToday = 0;
      if (state.counterDay) dayIndex = dayIndex + 1;
      await ctx.db.patch(state._id, { counterDay: day, sentToday: 0, dayIndex });
    }

    const cap = dailyCap(dayIndex, state.dailyCapOverride);
    const remainingToday = cap - sentToday;
    if (remainingToday <= 0) return { jobs: [], reason: "daily_cap" };

    // Spread what is left over the hours still in the window, so the day drips
    // instead of emptying into the first tick.
    const hoursLeft = Math.max(1, SEND_HOUR_END - hour);
    const perTick = Math.max(
      1,
      Math.min(MAX_PER_TICK, remainingToday, Math.ceil(remainingToday / hoursLeft))
    );

    const jobs: SendJob[] = [];

    const dueFollowUps = await ctx.db
      .query("agencyOutreachLeads")
      .withIndex("by_follow_up", (q) =>
        q.eq("status", "sent" as const).lte("followUpAt", now)
      )
      .take(perTick);

    for (const lead of dueFollowUps) {
      if (jobs.length >= perTick) break;
      jobs.push({
        leadId: lead._id,
        email: lead.email,
        agencyName: lead.agencyName,
        city: lead.city,
        services: lead.services,
        language: lead.language,
        stage: 2,
        optOutToken: lead.optOutToken,
      });
    }

    if (jobs.length < perTick) {
      const fresh = await ctx.db
        .query("agencyOutreachLeads")
        .withIndex("by_status_stage", (q) =>
          q.eq("status", "new" as const).eq("stage", 0)
        )
        .take(perTick - jobs.length);
      for (const lead of fresh) {
        jobs.push({
          leadId: lead._id,
          email: lead.email,
          agencyName: lead.agencyName,
          city: lead.city,
          services: lead.services,
          language: lead.language,
          stage: 1,
          optOutToken: lead.optOutToken,
        });
      }
    }

    for (const job of jobs) {
      await ctx.db.patch(job.leadId, { status: "queued" as const, queuedAt: now });
    }

    const deckUrl = state.deckStorageId
      ? await ctx.storage.getUrl(state.deckStorageId)
      : null;

    const policy = state.deckPolicy ?? "followup";
    return {
      jobs,
      deckUrl,
      deckStorageId: state.deckStorageId ?? null,
      deckFileName: state.deckFileName ?? null,
      attachOnStage: policy === "never" ? null : policy === "always" ? 1 : 2,
    };
  },
});

export const recordSendResult = internalMutation({
  args: {
    leadId: v.id("agencyOutreachLeads"),
    stage: v.float64(),
    success: v.boolean(),
    suppressed: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return null;
    const now = Date.now();

    if (args.success) {
      await ctx.db.patch(args.leadId, {
        status: args.stage === 1 ? ("sent" as const) : ("followed_up" as const),
        stage: args.stage,
        firstSentAt: lead.firstSentAt ?? now,
        lastSentAt: now,
        // Only a first touch schedules a follow-up; the sequence is two mails,
        // full stop. Cold outreach that keeps "circling back" is how a list
        // earns complaints.
        followUpAt: args.stage === 1 ? now + FOLLOW_UP_DELAY_MS : undefined,
        sendAttempts: (lead.sendAttempts ?? 0) + 1,
        lastError: undefined,
      });

      const state = await ensureState(ctx);
      // The window is the last WINDOW_SIZE leads contacted, oldest dropped
      // first. Their statuses — not a counter frozen at send time — are what
      // the breaker reads, so a bounce arriving an hour later still lands in
      // the right window and leaves it again when the send ages out.
      const recentLeadIds = [...(state.recentLeadIds ?? []), args.leadId].slice(-WINDOW_SIZE);
      await ctx.db.patch(state._id, {
        sentToday: (state.sentToday ?? 0) + 1,
        totalSent: (state.totalSent ?? 0) + 1,
        lastSendAt: now,
        recentLeadIds,
        windowSent: recentLeadIds.length,
        updatedAt: now,
      });
      return null;
    }

    // A suppressed address is a decision already made about that address, so
    // it leaves the queue rather than being retried forever.
    await ctx.db.patch(args.leadId, {
      status: args.suppressed ? ("skipped" as const) : ("failed" as const),
      skipReason: args.suppressed ? "suppressed" : undefined,
      lastError: args.error?.slice(0, 300),
      sendAttempts: (lead.sendAttempts ?? 0) + 1,
      followUpAt: undefined,
    });
    return null;
  },
});

/**
 * Hourly tick. Claims a small batch and sends it, one message at a time with a
 * short random gap — an evenly spaced burst is a machine signature, and the
 * gaps cost nothing on a list this size.
 */
export const outreachTick = internalAction({
  args: {},
  returns: v.object({ sent: v.float64(), failed: v.float64(), reason: v.string() }),
  handler: async (ctx): Promise<{ sent: number; failed: number; reason: string }> => {
    const claim: any = await ctx.runMutation(internal.agencyOutreach.claimDueLeads, {});
    const jobs: SendJob[] = claim.jobs ?? [];
    if (jobs.length === 0) {
      return { sent: 0, failed: 0, reason: claim.reason ?? "nothing_due" };
    }

    const siteUrl = process.env.CONVEX_SITE_URL ?? "";
    let sent = 0;
    let failed = 0;

    for (const job of jobs) {
      const optOutUrl = `${siteUrl}/agency-outreach/opt-out?token=${job.optOutToken}`;
      const rendered = renderOutreachEmail({
        agencyName: job.agencyName,
        city: job.city,
        services: job.services,
        lang: job.language === "en" ? "en" : "el",
        stage: job.stage,
        optOutUrl,
        deckUrl: claim.deckUrl ?? undefined,
      });

      // Passed by storage id, not as base64: a Node action's arguments are
      // capped at 5 MiB and the encoded deck is ~8 MB, so the sender reads it
      // from storage itself.
      const attach =
        claim.deckStorageId &&
        claim.attachOnStage !== null &&
        job.stage >= claim.attachOnStage
          ? [
              {
                storageId: claim.deckStorageId,
                name: claim.deckFileName ?? "Planera-Partnership-Deck.pptx",
              },
            ]
          : undefined;

      const res: any = await ctx.runAction(internal.postmark.sendRawEmail, {
        to: job.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        from: OUTREACH_FROM,
        replyTo: OUTREACH_EMAIL,
        // The archived copy carries this lead's own opt-out link, so nobody on
        // the internal address should click it — it would unsubscribe them.
        cc: OUTREACH_CC || undefined,
        bcc: OUTREACH_BCC || undefined,
        messageStream: OUTREACH_STREAM,
        tag: POSTMARK_TAG,
        metadata: {
          leadId: String(job.leadId),
          stage: String(job.stage),
          campaign: "agency-outreach",
        },
        // Opens tell us who to follow up with. Link tracking is deliberately
        // OFF: it rewrites every href to a shared tracking domain, which is a
        // reputation we do not control and a mismatch between the visible and
        // actual URL — both things filters weigh against cold mail.
        trackOpens: true,
        trackLinks: "None",
        headers: {
          "List-Unsubscribe": `<${optOutUrl}>, <mailto:${OUTREACH_EMAIL}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        storageAttachments: attach,
      });

      await ctx.runMutation(internal.agencyOutreach.recordSendResult, {
        leadId: job.leadId,
        stage: job.stage,
        success: Boolean(res?.success),
        suppressed: Boolean(res?.suppressed),
        error: res?.error,
      });

      if (res?.success) sent++;
      else failed++;

      if (job !== jobs[jobs.length - 1]) {
        await new Promise((r) =>
          setTimeout(r, JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS))
        );
      }
    }

    return { sent, failed, reason: "ok" };
  },
});

/**
 * Tells the operator the campaign stopped, at the moment it stops.
 *
 * Sent with `ignoreSuppression`: this is internal mail to a fixed address, and
 * an alert that silently suppresses itself is worse than no alert.
 */
export const sendPauseAlert = internalAction({
  args: {
    reason: v.string(),
    windowSent: v.float64(),
    bounced: v.float64(),
    complained: v.float64(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const to = process.env.STATS_REPORT_TO || "dstroumpakos@planeraai.app";
    const overview: any = await ctx.runQuery(internal.agencyOutreach.overviewAdmin, {});
    const remaining = overview?.remaining ?? 0;
    const subject = `Agency outreach auto-paused — ${args.reason}`;
    const lines = [
      `The travel-agency outreach campaign paused itself.`,
      ``,
      `Reason:      ${args.reason}`,
      `Window:      ${args.bounced} bounces, ${args.complained} complaints in ${args.windowSent} sends`,
      `Sent so far: ${overview?.totalSent ?? 0}`,
      `Still to go: ${remaining} leads never contacted`,
      ``,
      `It will not resume on its own. Clear the health window and restart it`,
      `from the admin dashboard, or investigate the bounces first.`,
    ];
    const text = lines.join("\n");
    const html =
      `<p>The travel-agency outreach campaign paused itself.</p>` +
      `<table cellpadding="4"><tbody>` +
      `<tr><td><b>Reason</b></td><td>${args.reason}</td></tr>` +
      `<tr><td><b>Window</b></td><td>${args.bounced} bounces, ${args.complained} complaints in ${args.windowSent} sends</td></tr>` +
      `<tr><td><b>Sent so far</b></td><td>${overview?.totalSent ?? 0}</td></tr>` +
      `<tr><td><b>Still to go</b></td><td>${remaining} leads never contacted</td></tr>` +
      `</tbody></table>` +
      `<p>It will not resume on its own — clear the health window and restart it, ` +
      `or investigate the bounces first.</p>`;
    await ctx.runAction(internal.postmark.sendRawEmail, {
      to,
      subject,
      html,
      text,
      tag: "agency-outreach-alert",
      ignoreSuppression: true,
    });
    return null;
  },
});

/**
 * Deck as the sender sees it. Shared by the campaign tick and the preview, so
 * a preview cannot quietly differ from the real thing — which is the only
 * reason to send a preview at all.
 */
export const getDeckInfo = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const state = await readState(ctx);
    if (!state?.deckStorageId) return null;
    const policy = state.deckPolicy ?? "followup";
    return {
      storageId: state.deckStorageId,
      fileName: state.deckFileName ?? "Planera-Partnership-Deck.pptx",
      url: await ctx.storage.getUrl(state.deckStorageId),
      attachOnStage: policy === "never" ? null : policy === "always" ? 1 : 2,
    };
  },
});

/** Renders and sends one message to an arbitrary address, for eyeballing. */
async function sendPreviewCore(
  ctx: any,
  opts: { to: string; stage?: number; language?: string; deckUrl?: string }
): Promise<{ success: boolean; error?: string }> {
  const stage = opts.stage === 2 ? 2 : 1;
  const deck: any = await ctx.runQuery(internal.agencyOutreach.getDeckInfo, {});

  const rendered = renderOutreachEmail({
    agencyName: "Ταξιδιωτικό Γραφείο (preview)",
    city: "Αθήνα",
    services: "αεροπορικά εισιτήρια, οργανωμένες εκδρομές",
    lang: opts.language === "en" ? "en" : "el",
    stage,
    optOutUrl: `${process.env.CONVEX_SITE_URL ?? ""}/agency-outreach/opt-out?token=preview`,
    deckUrl: opts.deckUrl ?? deck?.url ?? undefined,
  });

  const wantsAttachment =
    deck && deck.attachOnStage !== null && stage >= deck.attachOnStage;

  const res: any = await ctx.runAction(internal.postmark.sendRawEmail, {
    to: opts.to,
    subject: `[PREVIEW] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    from: OUTREACH_FROM,
    replyTo: OUTREACH_EMAIL,
    messageStream: OUTREACH_STREAM,
    tag: `${POSTMARK_TAG}-preview`,
    trackOpens: false,
    trackLinks: "None",
    storageAttachments: wantsAttachment
      ? [{ storageId: deck.storageId, name: deck.fileName }]
      : undefined,
    ignoreSuppression: true,
  });
  return { success: Boolean(res?.success), error: res?.error };
}

export const sendPreview = action({
  args: {
    token: v.string(),
    to: v.string(),
    stage: v.optional(v.float64()),
    language: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    await ctx.runQuery(internal.agencyOutreach.assertAdminToken, { token: args.token });
    return await sendPreviewCore(ctx, args);
  },
});

export const sendPreviewAdmin = internalAction({
  args: {
    to: v.string(),
    stage: v.optional(v.float64()),
    language: v.optional(v.string()),
    deckUrl: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> =>
    await sendPreviewCore(ctx, args),
});

export const assertAdminToken = internalQuery({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Deliverability feedback
// ---------------------------------------------------------------------------

/**
 * Applies a Postmark webhook event to a lead. Called from
 * `emailEvents.ingestPostmarkEvent` so the outreach list learns about bounces
 * and complaints from the same single write path as everything else — and so
 * the circuit breaker above has something to trip on.
 */
export async function applyOutreachEmailEvent(
  ctx: any,
  opts: {
    email: string;
    recordType: string;
    typeCode?: number;
    bounceType?: string;
    inactive?: boolean;
    description?: string;
    suppressionReason?: string;
    suppressSending?: boolean;
  }
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const lead = await ctx.db
    .query("agencyOutreachLeads")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();
  if (!lead) return;

  const now = Date.now();
  const state = await readState(ctx);
  const note = (opts.description ?? opts.bounceType ?? "").slice(0, 200) || undefined;

  /** Terminal verdicts about the ADDRESS, as opposed to the person's wishes. */
  const alreadyDead = lead.status === "bounced" || lead.status === "complained";

  switch (opts.recordType) {
    case "Bounce": {
      switch (classifyBounce(opts)) {
        // An auto-responder or an address-change notice is not a delivery
        // failure. Counting one against the breaker paused a healthy campaign.
        case "ignored":
          return;

        // The recipient unsubscribed at their ISP. Same intent as the link in
        // the footer, so it lands in the same bucket.
        case "unsubscribe": {
          if (alreadyDead) return;
          await ctx.db.patch(lead._id, {
            status: "opted_out" as const,
            optedOutAt: now,
            followUpAt: undefined,
          });
          return;
        }

        case "complaint": {
          await markComplained(ctx, lead, state, now);
          return;
        }

        case "hard": {
          // No counter to bump: the lead's own status IS the record, and
          // `windowHealth` recounts from it. See WINDOW_SIZE.
          await ctx.db.patch(lead._id, {
            status: "bounced" as const,
            followUpAt: undefined,
            lastError: note,
          });
          return;
        }

        // Soft/transient: a full mailbox, a greylist, a queue that expired.
        // Recorded so it is visible, but deliberately NOT counted against the
        // hard-bounce ratio the breaker trips on and NOT treated as a dead
        // address — the mailbox is probably alive and worth the follow-up.
        case "soft": {
          await ctx.db.patch(lead._id, { lastError: note });
          if (state) {
            await ctx.db.patch(state._id, {
              windowSoftBounced: (state.windowSoftBounced ?? 0) + 1,
              updatedAt: now,
            });
          }
          return;
        }
      }
      return;
    }

    case "SpamComplaint": {
      await markComplained(ctx, lead, state, now);
      return;
    }

    case "SubscriptionChange": {
      // Postmark suppresses an address the moment it hard-bounces or files a
      // complaint, and then fires SubscriptionChange for that suppression.
      // Relabelling the lead "opted_out" here would erase the reason the
      // campaign stopped and report three dead mailboxes as three people who
      // asked to leave.
      if (opts.suppressSending === false) return; // reactivation, not a departure
      const reason = opts.suppressionReason ?? "";
      if (reason === "HardBounce") {
        // Only the status, never the counters: the Bounce event owns the
        // window, and double-counting one address would trip the breaker at
        // half the real rate.
        if (!alreadyDead) {
          await ctx.db.patch(lead._id, { status: "bounced" as const, followUpAt: undefined });
        }
        return;
      }
      if (reason === "SpamComplaint") {
        if (!alreadyDead) {
          await ctx.db.patch(lead._id, { status: "complained" as const, followUpAt: undefined });
        }
        return;
      }
      if (alreadyDead) return;
      await ctx.db.patch(lead._id, {
        status: "opted_out" as const,
        optedOutAt: now,
        followUpAt: undefined,
      });
      return;
    }

    case "Open": {
      await ctx.db.patch(lead._id, {
        openCount: (lead.openCount ?? 0) + 1,
        lastOpenedAt: now,
      });
      return;
    }

    case "Click": {
      await ctx.db.patch(lead._id, {
        clickCount: (lead.clickCount ?? 0) + 1,
        lastClickedAt: now,
      });
      return;
    }

    default:
      return;
  }
}

async function markComplained(ctx: any, lead: any, _state: any, _now: number): Promise<void> {
  if (lead.status !== "complained") {
    await ctx.db.patch(lead._id, {
      status: "complained" as const,
      followUpAt: undefined,
    });
  }
}
