/**
 * Email deliverability — suppression list, event log, and the Postmark webhook
 * ingest that feeds both.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module the send path was write-only: `postmark.sendRawEmail`
 * reported whether Postmark *accepted* a message and nothing else. What
 * happened afterwards — bounced, junked, never opened — never came back. Two
 * concrete consequences:
 *
 *   1. A dead mailbox stayed `active` forever. Every drip tick and every
 *      campaign re-sent to it, and each attempt is a hard bounce against our
 *      sending domain's reputation. Mailbox providers score senders on exactly
 *      that ratio, so the addresses that CAN'T receive mail were quietly
 *      degrading delivery for the ones that can.
 *   2. Campaign stats counted "handed to Postmark" as success, so a campaign
 *      that bounced half its list still reported 100% sent.
 *
 * The fix is a feedback loop. Postmark POSTs delivery events to
 * `/postmark/webhook` (see http.ts); this module turns them into:
 *   - a local suppression list consulted BEFORE every send,
 *   - per-recipient outcomes on the campaign ledger,
 *   - engagement fields on the subscriber,
 *   - an append-only event log for the admin dashboard.
 *
 * Everything here is idempotent: Postmark retries webhooks, and a duplicate
 * delivery of the same event must not double-count.
 */

import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { assertAdmin } from "./admin";
import { applyOutreachEmailEvent } from "./agencyOutreach";
import {
  HARD_BOUNCE_CODES,
  IGNORED_BOUNCE_CODES,
  UNSUBSCRIBE_BOUNCE_CODE,
  COMPLAINT_BOUNCE_CODES,
} from "./emailBounceCodes";

const internal = _internal as any;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Bounce TypeCode classification is shared with the B2B outreach breaker;
// see `emailBounceCodes.ts` for what each set means and why.

/**
 * How many soft bounces in a row (with no delivery in between) before we treat
 * the address as dead. Four is roughly a month of drip/campaign cadence — long
 * enough for a full mailbox or a down server to recover, short enough that we
 * stop hammering an address that is never coming back.
 */
const SOFT_BOUNCE_LIMIT = 4;

/** Cap stored provider prose so one verbose ISP can't bloat the table. */
const MAX_DETAIL = 500;

/** Retention for the event log, by class of event (see pruneEmailEvents). */
const OPEN_CLICK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const BOUNCE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function truncate(s: string | undefined, max = MAX_DETAIL): string | undefined {
  if (!s) return undefined;
  const t = String(s).trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

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
  if (!userId) throw new Error("Unauthorized");
  await assertAdmin(ctx, userId);
  return userId;
}

// ---------------------------------------------------------------------------
// Suppression list
// ---------------------------------------------------------------------------

export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "spam_complaint"
  | "manual"
  | "invalid"
  | "unsubscribe";

const suppressionReasonValidator = v.union(
  v.literal("hard_bounce"),
  v.literal("soft_bounce"),
  v.literal("spam_complaint"),
  v.literal("manual"),
  v.literal("invalid"),
  v.literal("unsubscribe"),
);

/**
 * Consulted by `postmark.sendRawEmail` before every single send.
 *
 * Kept intentionally cheap (one indexed point lookup) because it runs once per
 * recipient in a fan-out of thousands.
 */
export const isSuppressed = internalQuery({
  args: { email: v.string() },
  returns: v.object({
    suppressed: v.boolean(),
    reason: v.optional(v.string()),
    detail: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .first();
    if (!row || !row.active) return { suppressed: false };
    return { suppressed: true, reason: row.reason, detail: row.detail };
  },
});

/**
 * Add (or re-arm) a suppression. Idempotent: a repeat event on an already
 * suppressed address bumps `eventCount` and the timestamp instead of inserting
 * a second row, so "how many distinct dead addresses" stays answerable.
 *
 * Also mirrors the decision onto the subscriber row, because the campaign and
 * drip recipient queries select on `status` — a suppression that didn't change
 * the status would be enforced one send too late, after the API call.
 */
async function applySuppression(
  ctx: any,
  args: {
    email: string;
    reason: SuppressionReason;
    source: "webhook" | "send_error" | "sync" | "admin";
    detail?: string;
    bounceType?: string;
    stream?: string;
  },
): Promise<void> {
  const email = normalizeEmail(args.email);
  const now = Date.now();

  const existing = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      active: true,
      reason: args.reason,
      detail: truncate(args.detail) ?? existing.detail,
      bounceType: args.bounceType ?? existing.bounceType,
      stream: args.stream ?? existing.stream,
      source: args.source,
      eventCount: (existing.eventCount ?? 0) + 1,
      lastEventAt: now,
      releasedAt: undefined,
      releasedBy: undefined,
    });
  } else {
    await ctx.db.insert("emailSuppressions", {
      email,
      reason: args.reason,
      detail: truncate(args.detail),
      bounceType: args.bounceType,
      stream: args.stream,
      source: args.source,
      active: true,
      eventCount: 1,
      createdAt: now,
      lastEventAt: now,
    });
  }

  // Reflect it on the subscriber so recipient queries stop selecting them.
  const sub = await ctx.db
    .query("newsletterSubscribers")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();
  if (!sub) return;

  // A recorded opt-out outranks a bounce: someone who unsubscribed stays
  // unsubscribed in the funnel numbers even if their mailbox later dies.
  if (sub.status === "unsubscribed" || sub.status === "complained") return;

  const nextStatus =
    args.reason === "spam_complaint"
      ? "complained"
      : args.reason === "unsubscribe"
        ? "unsubscribed"
        : "bounced";

  await ctx.db.patch(sub._id, {
    status: nextStatus,
    suppressedAt: now,
    ...(nextStatus === "complained" ? { complainedAt: now } : {}),
    ...(nextStatus === "unsubscribed" ? { unsubscribedAt: now } : {}),
  });
}

/** Internal entry point for the send path (a 406/300 from the Postmark API). */
export const suppressFromSendError = internalMutation({
  args: {
    email: v.string(),
    reason: suppressionReasonValidator,
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applySuppression(ctx, {
      email: args.email,
      reason: args.reason,
      source: "send_error",
      detail: args.detail,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

type EventType =
  | "sent"
  | "delivered"
  | "bounce"
  | "complaint"
  | "open"
  | "click"
  | "send_failed"
  | "suppressed"
  | "subscription_change";

async function logEvent(
  ctx: any,
  ev: {
    email: string;
    type: EventType;
    messageId?: string;
    stream?: string;
    campaignId?: Id<"newsletterCampaigns">;
    subscriberId?: Id<"newsletterSubscribers">;
    tag?: string;
    bounceType?: string;
    typeCode?: number;
    description?: string;
    detail?: string;
    link?: string;
    platform?: string;
    createdAt?: number;
  },
): Promise<void> {
  await ctx.db.insert("emailEvents", {
    email: normalizeEmail(ev.email),
    type: ev.type,
    messageId: ev.messageId,
    stream: ev.stream,
    campaignId: ev.campaignId,
    subscriberId: ev.subscriberId,
    tag: ev.tag,
    bounceType: ev.bounceType,
    typeCode: ev.typeCode,
    description: truncate(ev.description, 200),
    detail: truncate(ev.detail),
    link: truncate(ev.link, 300),
    platform: ev.platform,
    createdAt: ev.createdAt ?? Date.now(),
  });
}

/**
 * Called by `postmark.sendRawEmail` when a send never reached the wire (API
 * error) or was skipped by the local suppression list. Gives the dashboard a
 * record of failures that produce no webhook, because Postmark never accepted
 * the message in the first place.
 */
export const recordSendFailure = internalMutation({
  args: {
    email: v.string(),
    type: v.union(v.literal("send_failed"), v.literal("suppressed")),
    detail: v.optional(v.string()),
    tag: v.optional(v.string()),
    stream: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await logEvent(ctx, {
      email: args.email,
      type: args.type,
      detail: args.detail,
      tag: args.tag,
      stream: args.stream,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Webhook ingest
// ---------------------------------------------------------------------------

/**
 * Resolve an event back to the campaign send it belongs to.
 *
 * Two paths, in order of trust:
 *   1. The Postmark MessageID, looked up in the send ledger. Exact, and works
 *      for every send once the ledger records the id.
 *   2. The `Metadata` we attach at send time (campaignId/subscriberId) — the
 *      fallback for mail whose ledger row was never written (e.g. the send
 *      succeeded but the batch's bookkeeping mutation didn't run).
 */
async function resolveAttribution(
  ctx: any,
  args: { messageId?: string; metadata?: Record<string, string> },
): Promise<{
  send: Doc<"newsletterCampaignSends"> | null;
  campaignId?: Id<"newsletterCampaigns">;
  subscriberId?: Id<"newsletterSubscribers">;
}> {
  let send: Doc<"newsletterCampaignSends"> | null = null;

  if (args.messageId) {
    send = await ctx.db
      .query("newsletterCampaignSends")
      .withIndex("by_message_id", (q: any) => q.eq("messageId", args.messageId))
      .first();
  }

  if (send) {
    return { send, campaignId: send.campaignId, subscriberId: send.subscriberId };
  }

  // Metadata fallback. Ids arrive as opaque strings; a stale or garbled one must
  // never throw inside the webhook, so every use is guarded by a `get`.
  const meta = args.metadata ?? {};
  const campaignId = meta.campaignId as Id<"newsletterCampaigns"> | undefined;
  const subscriberId = meta.subscriberId as Id<"newsletterSubscribers"> | undefined;
  return { send: null, campaignId, subscriberId };
}

/** Bump a campaign counter, tolerating a missing or non-campaign id. */
async function bumpCampaign(
  ctx: any,
  campaignId: Id<"newsletterCampaigns"> | undefined,
  field: "delivered" | "bounced" | "complained" | "opened" | "clicked",
): Promise<void> {
  if (!campaignId) return;
  let campaign: Doc<"newsletterCampaigns"> | null = null;
  try {
    campaign = await ctx.db.get(campaignId);
  } catch {
    return; // not a campaigns id — the event came from some other mail
  }
  if (!campaign) return;
  await ctx.db.patch(campaignId, { [field]: ((campaign as any)[field] ?? 0) + 1 });
}

/** Shared by the SpamComplaint record type and complaint-shaped bounce codes. */
async function handleComplaint(
  ctx: any,
  o: {
    email: string;
    sub: Doc<"newsletterSubscribers"> | null;
    send: Doc<"newsletterCampaignSends"> | null;
    attribution: Record<string, any>;
    args: any;
    now: number;
  },
): Promise<{ handled: boolean; action: string }> {
  await logEvent(ctx, {
    ...o.attribution,
    email: o.email,
    type: "complaint",
    typeCode: o.args.typeCode,
    bounceType: o.args.bounceType,
    description: o.args.description,
    detail: o.args.detail,
    createdAt: o.now,
  });

  if (o.send && o.send.status !== "complained") {
    await ctx.db.patch(o.send._id, { status: "complained", complainedAt: o.now });
    await bumpCampaign(ctx, o.send.campaignId, "complained");
  }

  await applySuppression(ctx, {
    email: o.email,
    reason: "spam_complaint",
    source: "webhook",
    detail: o.args.description ?? o.args.detail,
    bounceType: o.args.bounceType,
    stream: o.args.stream,
  });

  return { handled: true, action: "complaint" };
}

/**
 * The single write path for every Postmark event.
 *
 * The HTTP action does nothing but authenticate and normalize; all state
 * changes happen here so a whole event lands atomically (log row + suppression
 * + subscriber + campaign counters), and a webhook retry re-runs it safely.
 */
export const ingestPostmarkEvent = internalMutation({
  args: {
    recordType: v.string(),
    email: v.string(),
    messageId: v.optional(v.string()),
    stream: v.optional(v.string()),
    tag: v.optional(v.string()),
    bounceType: v.optional(v.string()),
    typeCode: v.optional(v.float64()),
    description: v.optional(v.string()),
    detail: v.optional(v.string()),
    inactive: v.optional(v.boolean()),
    link: v.optional(v.string()),
    platform: v.optional(v.string()),
    suppressSending: v.optional(v.boolean()),
    suppressionReason: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    occurredAt: v.optional(v.float64()),
  },
  returns: v.object({ handled: v.boolean(), action: v.string() }),
  handler: async (ctx, args): Promise<{ handled: boolean; action: string }> => {
    const email = normalizeEmail(args.email);
    if (!email) return { handled: false, action: "no_email" };

    const now = args.occurredAt ?? Date.now();
    const { send, campaignId, subscriberId } = await resolveAttribution(ctx, {
      messageId: args.messageId,
      metadata: args.metadata,
    });

    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    const attribution = {
      campaignId: send?.campaignId ?? campaignId,
      subscriberId: send?.subscriberId ?? sub?._id ?? subscriberId,
      messageId: args.messageId,
      stream: args.stream,
      tag: args.tag,
    };

    // The B2B outreach list is a separate table with its own throttle and
    // circuit breaker, but it shares this single write path so a bounce can
    // never be recorded in one place and missed in the other.
    // Passed the full bounce context, not just the record type: without the
    // TypeCode the outreach breaker cannot tell an out-of-office reply from a
    // dead mailbox, and without the suppression reason it cannot tell a real
    // unsubscribe from the auto-suppression Postmark fires after a hard bounce.
    await applyOutreachEmailEvent(ctx, {
      email,
      recordType: args.recordType,
      typeCode: args.typeCode,
      bounceType: args.bounceType,
      inactive: args.inactive,
      description: args.description ?? args.detail,
      suppressionReason: args.suppressionReason,
      suppressSending: args.suppressSending,
    });

    switch (args.recordType) {
      // -------------------------------------------------------------- Delivery
      case "Delivery": {
        await logEvent(ctx, { ...attribution, email, type: "delivered", createdAt: now });
        if (send && send.status !== "delivered") {
          await ctx.db.patch(send._id, { status: "delivered", deliveredAt: now });
          await bumpCampaign(ctx, send.campaignId, "delivered");
        }
        if (sub) {
          // A delivery clears the soft-bounce streak: whatever was transiently
          // wrong with the mailbox has resolved.
          await ctx.db.patch(sub._id, { lastDeliveredAt: now, softBounceCount: 0 });
        }
        return { handled: true, action: "delivered" };
      }

      // ---------------------------------------------------------------- Bounce
      case "Bounce": {
        const code = args.typeCode ?? 0;

        if (IGNORED_BOUNCE_CODES.has(code)) {
          return { handled: true, action: "ignored" };
        }

        // Postmark routes ISP unsubscribes and spam reports through the bounce
        // webhook too; both mean "stop", but for different reasons and with
        // different funnel accounting.
        if (code === UNSUBSCRIBE_BOUNCE_CODE) {
          await logEvent(ctx, {
            ...attribution,
            email,
            type: "subscription_change",
            typeCode: code,
            bounceType: args.bounceType,
            description: args.description,
            createdAt: now,
          });
          await applySuppression(ctx, {
            email,
            reason: "unsubscribe",
            source: "webhook",
            detail: args.description ?? args.detail,
            bounceType: args.bounceType,
            stream: args.stream,
          });
          return { handled: true, action: "unsubscribed" };
        }

        if (COMPLAINT_BOUNCE_CODES.has(code)) {
          return await handleComplaint(ctx, { email, sub, send, attribution, args, now });
        }

        // `Inactive` is Postmark's own verdict that it has deactivated the
        // address — authoritative regardless of how we'd classify the code.
        const isHard = HARD_BOUNCE_CODES.has(code) || args.inactive === true;

        await logEvent(ctx, {
          ...attribution,
          email,
          type: "bounce",
          typeCode: code,
          bounceType: args.bounceType,
          description: args.description,
          detail: args.detail,
          createdAt: now,
        });

        if (send && send.status !== "bounced") {
          await ctx.db.patch(send._id, {
            status: "bounced",
            bouncedAt: now,
            bounceType: args.bounceType,
          });
          await bumpCampaign(ctx, send.campaignId, "bounced");
        }

        if (isHard) {
          if (sub) {
            await ctx.db.patch(sub._id, {
              bounceCount: (sub.bounceCount ?? 0) + 1,
              lastBounceAt: now,
              lastBounceType: args.bounceType,
              lastBounceDetail: truncate(args.description, 200),
            });
          }
          await applySuppression(ctx, {
            email,
            reason: "hard_bounce",
            source: "webhook",
            detail: args.description ?? args.detail,
            bounceType: args.bounceType,
            stream: args.stream,
          });
          return { handled: true, action: "hard_bounce" };
        }

        // Soft bounce — tolerate a few, then give up.
        const streak = (sub?.softBounceCount ?? 0) + 1;
        if (sub) {
          await ctx.db.patch(sub._id, {
            softBounceCount: streak,
            lastBounceAt: now,
            lastBounceType: args.bounceType,
            lastBounceDetail: truncate(args.description, 200),
          });
        }
        if (streak >= SOFT_BOUNCE_LIMIT) {
          await applySuppression(ctx, {
            email,
            reason: "soft_bounce",
            source: "webhook",
            detail: `${SOFT_BOUNCE_LIMIT} consecutive soft bounces. Last: ${
              args.description ?? args.bounceType ?? "unknown"
            }`,
            bounceType: args.bounceType,
            stream: args.stream,
          });
          return { handled: true, action: "soft_bounce_suppressed" };
        }
        return { handled: true, action: "soft_bounce" };
      }

      // --------------------------------------------------------- SpamComplaint
      case "SpamComplaint": {
        return await handleComplaint(ctx, { email, sub, send, attribution, args, now });
      }

      // ------------------------------------------------------------------ Open
      case "Open": {
        await logEvent(ctx, {
          ...attribution,
          email,
          type: "open",
          platform: args.platform,
          createdAt: now,
        });
        if (send) {
          const isFirst = !send.openedAt;
          await ctx.db.patch(send._id, {
            openedAt: send.openedAt ?? now,
            openCount: (send.openCount ?? 0) + 1,
          });
          // Campaign "opened" counts UNIQUE recipients, so only the first open
          // of each send bumps it — otherwise one forwarded email inflates the
          // rate past 100%.
          if (isFirst) await bumpCampaign(ctx, send.campaignId, "opened");
        }
        if (sub) {
          await ctx.db.patch(sub._id, {
            lastOpenedAt: now,
            openCount: (sub.openCount ?? 0) + 1,
          });
        }
        return { handled: true, action: "open" };
      }

      // ----------------------------------------------------------------- Click
      case "Click": {
        await logEvent(ctx, {
          ...attribution,
          email,
          type: "click",
          link: args.link,
          platform: args.platform,
          createdAt: now,
        });
        if (send) {
          const isFirst = !send.clickedAt;
          await ctx.db.patch(send._id, {
            clickedAt: send.clickedAt ?? now,
            clickCount: (send.clickCount ?? 0) + 1,
          });
          if (isFirst) await bumpCampaign(ctx, send.campaignId, "clicked");
        }
        if (sub) {
          await ctx.db.patch(sub._id, {
            lastClickedAt: now,
            clickCount: (sub.clickCount ?? 0) + 1,
          });
        }
        return { handled: true, action: "click" };
      }

      // ---------------------------------------------------- SubscriptionChange
      case "SubscriptionChange": {
        await logEvent(ctx, {
          ...attribution,
          email,
          type: "subscription_change",
          description: args.suppressionReason,
          createdAt: now,
        });
        // Postmark-side suppression (someone used the List-Unsubscribe header,
        // or an admin added them in Postmark). Mirror it locally, or we'd keep
        // posting sends Postmark silently refuses.
        if (args.suppressSending) {
          const reason: SuppressionReason =
            args.suppressionReason === "SpamComplaint"
              ? "spam_complaint"
              : args.suppressionReason === "HardBounce"
                ? "hard_bounce"
                : "unsubscribe";
          await applySuppression(ctx, {
            email,
            reason,
            source: "webhook",
            detail: args.suppressionReason,
            stream: args.stream,
          });
          return { handled: true, action: "suppressed" };
        }
        // Reinstated on Postmark's side — drop our block too so the address can
        // opt back in normally.
        const existing = await ctx.db
          .query("emailSuppressions")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first();
        if (existing && existing.active) {
          await ctx.db.patch(existing._id, { active: false, releasedAt: now });
        }
        return { handled: true, action: "reinstated" };
      }

      default:
        return { handled: false, action: `unknown:${args.recordType}` };
    }
  },
});

// ---------------------------------------------------------------------------
// Admin surface
// ---------------------------------------------------------------------------

/**
 * Everything the Deliverability panel needs in one round trip: current
 * suppression totals, the rolling send-outcome mix, and the derived rates that
 * decide whether the sending domain is healthy.
 *
 * Rates are computed against DELIVERABLE ATTEMPTS (delivered + bounced +
 * complained), not against "sent", because a send whose outcome hasn't been
 * reported yet would otherwise drag every rate down and make a campaign that is
 * still in flight look broken.
 */
export const deliverabilityOverview = query({
  args: { token: v.string(), days: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const days = Math.min(Math.max(args.days ?? 30, 1), 365);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .collect();

    const counts: Record<string, number> = {
      delivered: 0,
      bounce: 0,
      complaint: 0,
      open: 0,
      click: 0,
      send_failed: 0,
      suppressed: 0,
      subscription_change: 0,
    };
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

    // Suppression list composition. One row per dead address, so a full scan is
    // cheap and gives exact per-reason totals.
    const suppressions = await ctx.db.query("emailSuppressions").collect();
    const byReason: Record<string, number> = {};
    let activeSuppressions = 0;
    for (const s of suppressions) {
      if (!s.active) continue;
      activeSuppressions += 1;
      byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
    }

    const attempts = counts.delivered + counts.bounce + counts.complaint;
    const pct = (n: number, d: number) =>
      d > 0 ? Math.round((n / d) * 10000) / 100 : 0;

    // Newest problems first — the list an operator actually acts on.
    const recentProblems = events
      .filter(
        (e) => e.type === "bounce" || e.type === "complaint" || e.type === "send_failed",
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((e) => ({
        _id: e._id,
        email: e.email,
        type: e.type,
        bounceType: e.bounceType,
        description: e.description,
        detail: e.detail,
        createdAt: e.createdAt,
      }));

    return {
      days,
      counts,
      attempts,
      rates: {
        bounce: pct(counts.bounce, attempts),
        complaint: pct(counts.complaint, attempts),
        // Opens/clicks are measured against delivered mail — the only mail that
        // could have been opened.
        open: pct(counts.open, counts.delivered),
        click: pct(counts.click, counts.delivered),
      },
      suppressions: {
        active: activeSuppressions,
        byReason,
        total: suppressions.length,
      },
      recentProblems,
      // Industry alarm thresholds: sustained >2% bounces or >0.1% complaints
      // puts a sending domain at risk. Surfaced here so the UI doesn't hardcode
      // them and both sides stay in step.
      thresholds: { bounce: 2, complaint: 0.1 },
    };
  },
});

/** Filtered suppression list for the admin table. */
export const listSuppressions = query({
  args: {
    token: v.string(),
    reason: v.optional(v.string()),
    search: v.optional(v.string()),
    includeReleased: v.optional(v.boolean()),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000);
    const search = args.search?.trim().toLowerCase();

    const rows = args.includeReleased
      ? await ctx.db.query("emailSuppressions").order("desc").take(2000)
      : await ctx.db
          .query("emailSuppressions")
          .withIndex("by_active_and_lastEventAt", (q) => q.eq("active", true))
          .order("desc")
          .take(2000);

    const matched = rows.filter(
      (r) =>
        (!args.reason || r.reason === args.reason) &&
        (!search || r.email.includes(search)),
    );

    return {
      matched: matched.length,
      rows: matched.slice(0, limit).map((r) => ({
        _id: r._id,
        email: r.email,
        reason: r.reason,
        detail: r.detail,
        bounceType: r.bounceType,
        stream: r.stream,
        source: r.source,
        active: r.active,
        eventCount: r.eventCount,
        createdAt: r.createdAt,
        lastEventAt: r.lastEventAt,
        releasedAt: r.releasedAt,
      })),
    };
  },
});

/** Full history for one address — the "why isn't this person getting mail" view. */
export const emailHistory = query({
  args: { token: v.string(), email: v.string(), limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const email = normalizeEmail(args.email);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_email_and_createdAt", (q) => q.eq("email", email))
      .order("desc")
      .take(limit);

    const suppression = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    return {
      email,
      subscriber: sub
        ? {
            _id: sub._id,
            status: sub.status,
            language: sub.language,
            country: sub.country,
            bounceCount: sub.bounceCount ?? 0,
            softBounceCount: sub.softBounceCount ?? 0,
            openCount: sub.openCount ?? 0,
            clickCount: sub.clickCount ?? 0,
            lastDeliveredAt: sub.lastDeliveredAt,
            lastOpenedAt: sub.lastOpenedAt,
            lastClickedAt: sub.lastClickedAt,
            suppressedAt: sub.suppressedAt,
          }
        : null,
      suppression: suppression
        ? {
            reason: suppression.reason,
            detail: suppression.detail,
            active: suppression.active,
            eventCount: suppression.eventCount,
            lastEventAt: suppression.lastEventAt,
          }
        : null,
      events: events.map((e) => ({
        _id: e._id,
        type: e.type,
        bounceType: e.bounceType,
        description: e.description,
        detail: e.detail,
        link: e.link,
        tag: e.tag,
        createdAt: e.createdAt,
      })),
    };
  },
});

/**
 * Lift a suppression.
 *
 * Spam complaints are NOT releasable from here: re-mailing someone who pressed
 * "report spam" is the fastest way to get a sending domain blacklisted, and no
 * dashboard button should put that one click away. Those addresses can only
 * come back by signing up again themselves.
 *
 * Releasing also schedules the matching delete on Postmark's own suppression
 * list — clearing ours alone would just produce a 406 on the next send.
 */
export const releaseSuppression = mutation({
  args: { token: v.string(), email: v.string() },
  returns: v.object({ released: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx, args.token);
    const email = normalizeEmail(args.email);
    const now = Date.now();

    const row = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!row || !row.active) return { released: false, reason: "not_suppressed" };
    if (row.reason === "spam_complaint") {
      throw new ConvexError(
        "Spam complaints can't be released. This address reported us as spam; re-sending puts the sending domain at risk. They can subscribe again themselves.",
      );
    }

    await ctx.db.patch(row._id, { active: false, releasedAt: now, releasedBy: adminId });

    // Put the subscriber back where they were. A bounce is a mail-system fact,
    // not a decision by the person, so restoring them to `active` is right —
    // but only if they hadn't also unsubscribed.
    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (sub && sub.status === "bounced") {
      await ctx.db.patch(sub._id, {
        status: "active",
        suppressedAt: undefined,
        softBounceCount: 0,
      });
    }

    await ctx.scheduler.runAfter(0, internal.postmark.deletePostmarkSuppression, {
      email,
      stream: row.stream,
    });

    return { released: true };
  },
});

/** Suppress an address by hand (e.g. a complaint that arrived as a reply). */
export const suppressEmail = mutation({
  args: {
    token: v.string(),
    email: v.string(),
    reason: v.optional(suppressionReasonValidator),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    await applySuppression(ctx, {
      email: args.email,
      reason: args.reason ?? "manual",
      source: "admin",
      detail: args.detail,
    });
    return null;
  },
});

/**
 * Per-campaign delivery report. Reads the ledger rather than trusting the
 * denormalized counters, so a campaign whose counters predate this feature (or
 * drifted) still reports the truth.
 */
export const campaignDeliveryStats = query({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found");

    const sends = await ctx.db
      .query("newsletterCampaignSends")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    let delivered = 0,
      bounced = 0,
      complained = 0,
      opened = 0,
      clicked = 0,
      pending = 0;
    for (const s of sends) {
      switch (s.status ?? "sent") {
        case "delivered":
          delivered += 1;
          break;
        case "bounced":
          bounced += 1;
          break;
        case "complained":
          complained += 1;
          break;
        default:
          pending += 1; // accepted by Postmark, no outcome reported yet
      }
      if (s.openedAt) opened += 1;
      if (s.clickedAt) clicked += 1;
    }

    const accounted = delivered + bounced + complained;
    const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : 0);

    const problems = sends
      .filter((s) => s.status === "bounced" || s.status === "complained")
      .sort(
        (a, b) =>
          (b.bouncedAt ?? b.complainedAt ?? 0) - (a.bouncedAt ?? a.complainedAt ?? 0),
      )
      .slice(0, 50)
      .map((s) => ({
        email: s.email,
        status: s.status,
        bounceType: s.bounceType,
        at: s.bouncedAt ?? s.complainedAt,
      }));

    return {
      campaignId: args.campaignId,
      subject: campaign.subject,
      sentAt: campaign.sentAt,
      sent: sends.length,
      suppressed: campaign.suppressed ?? 0,
      failed: campaign.failed ?? 0,
      delivered,
      bounced,
      complained,
      opened,
      clicked,
      pending,
      rates: {
        delivered: rate(delivered, accounted),
        bounce: rate(bounced, accounted),
        complaint: rate(complained, accounted),
        open: rate(opened, delivered),
        click: rate(clicked, delivered),
      },
      problems,
    };
  },
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Trim the event log (cron, daily).
 *
 * Opens and clicks are by far the highest-volume rows and lose their value once
 * the campaign they belong to has been reviewed; the per-send `openedAt` /
 * `openCount` aggregates outlive them. Bounces and complaints are the audit
 * trail behind a suppression, so they keep a much longer window.
 *
 * Bounded per run (`take`) so a backlog is worked off over several nights
 * instead of blowing the transaction limit in one go.
 */
export const pruneEmailEvents = internalMutation({
  args: { limit: v.optional(v.float64()) },
  returns: v.object({ deleted: v.float64() }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 2000, 5000);
    const now = Date.now();
    const hardCutoff = now - BOUNCE_RETENTION_MS;

    const candidates = await ctx.db
      .query("emailEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", now - OPEN_CLICK_RETENTION_MS))
      .take(limit);

    let deleted = 0;
    for (const e of candidates) {
      const keepLonger =
        e.type === "bounce" || e.type === "complaint" || e.type === "send_failed";
      if (keepLonger && e.createdAt >= hardCutoff) continue;
      await ctx.db.delete(e._id);
      deleted += 1;
    }
    return { deleted };
  },
});

/**
 * Bulk-import a batch from Postmark's own suppression dump.
 *
 * This is a BACKFILL for addresses Postmark deactivated before the webhook
 * existed (or while it was failing). It never resurrects a suppression an admin
 * released — the local list is the source of truth once we've seen an address.
 */
export const importSuppressions = internalMutation({
  args: {
    stream: v.string(),
    rows: v.array(
      v.object({
        email: v.string(),
        reason: v.string(),
      }),
    ),
  },
  returns: v.object({ imported: v.float64() }),
  handler: async (ctx, args) => {
    let imported = 0;
    for (const row of args.rows) {
      const email = normalizeEmail(row.email);
      if (!email) continue;
      const existing = await ctx.db
        .query("emailSuppressions")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (existing) continue;

      const reason: SuppressionReason =
        row.reason === "SpamComplaint"
          ? "spam_complaint"
          : row.reason === "HardBounce"
            ? "hard_bounce"
            : row.reason === "ManualSuppression"
              ? "manual"
              : "unsubscribe";

      await applySuppression(ctx, {
        email,
        reason,
        source: "sync",
        detail: `Imported from Postmark stream "${args.stream}"`,
        stream: args.stream,
      });
      imported += 1;
    }
    return { imported };
  },
});
