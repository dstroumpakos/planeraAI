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
/** Rolling window of sends the health ratios are computed over. */
const WINDOW_SIZE = 150;
/** Minimum sends before the ratios mean anything. */
const WINDOW_MIN_SAMPLE = 40;
/** Postmark warns around 5%; stopping at 4% leaves room to fix the list. */
const MAX_BOUNCE_RATE = 0.04;
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
    const state = await ensureState(ctx);
    await ctx.db.patch(state._id, {
      windowSent: 0,
      windowBounced: 0,
      windowComplained: 0,
      updatedAt: Date.now(),
    });
    return null;
  },
});

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

  const windowSent = state?.windowSent ?? 0;
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
      bounceRate: windowSent ? (state?.windowBounced ?? 0) / windowSent : 0,
      complaints: state?.windowComplained ?? 0,
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
    const windowSent = state.windowSent ?? 0;
    if (windowSent >= WINDOW_MIN_SAMPLE) {
      const bounceRate = (state.windowBounced ?? 0) / windowSent;
      const complaints = state.windowComplained ?? 0;
      if (bounceRate > MAX_BOUNCE_RATE || complaints > MAX_COMPLAINTS) {
        await ctx.db.patch(state._id, {
          status: "auto_paused" as const,
          pausedReason:
            bounceRate > MAX_BOUNCE_RATE
              ? `bounce rate ${(bounceRate * 100).toFixed(1)}% over ${windowSent} sends`
              : `${complaints} spam complaints in ${windowSent} sends`,
          updatedAt: now,
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
      const windowSent = (state.windowSent ?? 0) + 1;
      const rollover = windowSent > WINDOW_SIZE;
      await ctx.db.patch(state._id, {
        sentToday: (state.sentToday ?? 0) + 1,
        totalSent: (state.totalSent ?? 0) + 1,
        lastSendAt: now,
        windowSent: rollover ? 1 : windowSent,
        windowBounced: rollover ? 0 : state.windowBounced ?? 0,
        windowComplained: rollover ? 0 : state.windowComplained ?? 0,
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
  opts: { email: string; recordType: string }
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const lead = await ctx.db
    .query("agencyOutreachLeads")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();
  if (!lead) return;

  const now = Date.now();
  const state = await readState(ctx);

  switch (opts.recordType) {
    case "Bounce": {
      await ctx.db.patch(lead._id, {
        status: "bounced" as const,
        followUpAt: undefined,
      });
      if (state) {
        await ctx.db.patch(state._id, {
          windowBounced: (state.windowBounced ?? 0) + 1,
          updatedAt: now,
        });
      }
      return;
    }
    case "SpamComplaint": {
      await ctx.db.patch(lead._id, {
        status: "complained" as const,
        followUpAt: undefined,
      });
      if (state) {
        await ctx.db.patch(state._id, {
          windowComplained: (state.windowComplained ?? 0) + 1,
          updatedAt: now,
        });
      }
      return;
    }
    case "SubscriptionChange": {
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
