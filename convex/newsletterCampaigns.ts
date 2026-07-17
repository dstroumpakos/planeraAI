/**
 * Newsletter Broadcasts (one-off marketing campaigns)
 *
 * Lets the marketing team compose an email from STRUCTURED FIELDS in the admin
 * dashboard and send it to opted-in newsletter subscribers (status = "active").
 *
 * This is distinct from the automated drip in `newsletter.ts`:
 *  - the drip is a fixed, per-subscriber sequence walked by a cron;
 *  - a campaign is an ad-hoc blast composed on demand.
 *
 * Both render through the SAME branded email shell (`renderEmail`) and send via
 * the same Postmark action, so the look, footer, and unsubscribe handling are
 * identical.
 *
 * Send flow:
 *  1. `createCampaign` / `updateCampaign` — save a draft (admin only).
 *  2. `sendTestEmail` — render + send a single copy to the admin (safe preview).
 *  3. `startCampaign`  — flip draft → "sending" and kick off the fan-out.
 *  4. `processCampaignSend` — internal action, paginates active subscribers in
 *     batches of 50, sends one email each, and re-schedules itself until done.
 *     A per-(campaign, subscriber) ledger makes it idempotent: a resumed batch
 *     never emails anyone twice.
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
import { Id } from "./_generated/dataModel";
import { assertAdmin } from "./admin";
import {
  renderEmail,
  renderDealsBlock,
  normalizeLang,
  pickTopDeals,
  FOOTER_COPY,
  MARKETING_FROM,
  MARKETING_EMAIL,
  BASE_URL,
  type DealForEmail,
} from "./newsletter";

// Self-referential + cross-file internal references hit the type-inference wall
// until `convex dev` regenerates types; the `as any` cast is the same trick
// crons.ts / adminKpis.ts use. Results are still annotated by hand.
const internal = _internal as any;

// Subscribers processed per fan-out tick. Matches the drip batch size.
const SEND_BATCH_SIZE = 50;

// Postmark broadcast message stream for bulk newsletter sends (separate
// deliverability / bounce / complaint handling from the transactional
// "outbound" stream). Overridable via env; defaults to the "newsletters"
// broadcast stream configured in Postmark.
const NEWSLETTER_STREAM = process.env.NEWSLETTER_MESSAGE_STREAM || "newsletters";

// ---------------------------------------------------------------------------
// Auth helper (token → userId, then assertAdmin). Mirrors adminKpis.ts.
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
  if (!userId) throw new Error("Unauthorized");
  await assertAdmin(ctx, userId);
  return userId;
}

// ---------------------------------------------------------------------------
// Rendering (pure — reuses the shared newsletter email shell)
// ---------------------------------------------------------------------------

interface CampaignContent {
  subject: string;
  preheader: string;
  heading: string;
  para1: string;
  para2?: string;
  ctaText: string;
  ctaUrl: string;
  heroImg?: string;
  includeDeals: boolean;
}

function renderCampaignEmail(
  campaign: CampaignContent,
  language: string | undefined,
  unsubscribeToken: string,
  deals: DealForEmail[],
): { subject: string; html: string; text: string } {
  const lang = normalizeLang(language);
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;
  const dealsBlock =
    campaign.includeDeals && deals.length ? renderDealsBlock(deals, lang) : undefined;

  const html = renderEmail({
    lang,
    preheader: campaign.preheader,
    heading: campaign.heading,
    para1: campaign.para1,
    para2: campaign.para2 ?? "",
    ctaText: campaign.ctaText,
    ctaUrl: campaign.ctaUrl,
    unsubscribeUrl,
    heroImg: campaign.heroImg ?? undefined,
    banner: null,
    dealsBlock,
  });

  const dealsText =
    campaign.includeDeals && deals.length
      ? "\n\n" +
        deals
          .map((d) => `${d.originCity} → ${d.destinationCity}: ${Math.round(d.price)} ${d.currency}`)
          .join("\n")
      : "";

  const text =
    `${campaign.heading}\n\n${campaign.para1}` +
    `${campaign.para2 ? "\n\n" + campaign.para2 : ""}${dealsText}\n\n` +
    `${campaign.ctaText}: ${campaign.ctaUrl}\n\n` +
    `${FOOTER_COPY[lang].contact} ${MARKETING_EMAIL}\n\n` +
    `${FOOTER_COPY[lang].unsubscribe}: ${unsubscribeUrl}`;

  return { subject: campaign.subject, html, text };
}

// Shared validator for the structured composer fields.
const campaignContentArgs = {
  subject: v.string(),
  preheader: v.string(),
  heading: v.string(),
  para1: v.string(),
  para2: v.optional(v.string()),
  ctaText: v.string(),
  ctaUrl: v.string(),
  heroImg: v.optional(v.string()),
  includeDeals: v.boolean(),
  languageFilter: v.optional(v.string()),
  sourceFilter: v.optional(v.string()),
  countryFilter: v.optional(v.string()),
};

// ---------------------------------------------------------------------------
// Admin: list / estimate / compose
// ---------------------------------------------------------------------------

/** Recent campaigns (newest first) for the admin dashboard list. */
export const listCampaigns = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db
      .query("newsletterCampaigns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);
    return rows.map((c) => ({
      _id: c._id,
      subject: c.subject,
      status: c.status,
      languageFilter: c.languageFilter,
      sourceFilter: c.sourceFilter,
      countryFilter: c.countryFilter,
      includeDeals: c.includeDeals,
      targeted: c.targeted ?? 0,
      sent: c.sent ?? 0,
      failed: c.failed ?? 0,
      createdAt: c.createdAt,
      sentAt: c.sentAt,
    }));
  },
});

/** Full draft (for loading into the composer to edit). */
export const getCampaignForAdmin = query({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await ctx.db.get(args.campaignId);
  },
});

/**
 * How many opted-in subscribers match the current targeting filter, so the
 * composer can show "will send to ~N people" before the blast goes out.
 */
export const estimateAudience = query({
  args: {
    token: v.string(),
    languageFilter: v.optional(v.string()),
    sourceFilter: v.optional(v.string()),
    countryFilter: v.optional(v.string()),
  },
  returns: v.object({ count: v.float64(), total: v.float64() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const active = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const count = active.filter((s) =>
      matchesFilter(s, args.languageFilter, args.sourceFilter, args.countryFilter),
    ).length;
    // `total` = all confirmed subscribers regardless of filter, so the UI can
    // show "X of N" and make an over-narrow filter obvious.
    return { count, total: active.length };
  },
});

// ---------------------------------------------------------------------------
// Admin: one-time legacy backfill
// ---------------------------------------------------------------------------

// Conservative language → country (ISO-2) map for the legacy backfill only.
// Ambiguous languages (en, ar) are intentionally omitted — better left unset
// (deals fall back to global) than mis-tagged.
const LANG_TO_COUNTRY: Record<string, string> = {
  el: "gr", fr: "fr", de: "de", es: "es", it: "it", pt: "pt", nl: "nl",
};

/**
 * Best-effort country from a stored language/locale string:
 *  - a full locale ("el-GR", "en_US") yields its region ("gr", "us");
 *  - a bare language falls back to the conservative map above.
 */
function countryFromLanguage(language?: string): string | undefined {
  if (!language) return undefined;
  const parts = language.toLowerCase().split(/[-_]/);
  if (parts.length >= 2 && /^[a-z]{2}$/.test(parts[1]) && parts[1] !== "xx") {
    return parts[1];
  }
  return LANG_TO_COUNTRY[parts[0]];
}

/**
 * One-time: tag existing subscribers (which predate geo capture) with a
 * country derived from their language, so country targeting covers them too.
 * Only fills empty `country` fields — never overwrites a real captured value.
 */
export const backfillCountryFromLanguage = mutation({
  args: { token: v.string() },
  returns: v.object({ updated: v.float64(), scanned: v.float64() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    let updated = 0;
    let scanned = 0;
    for (const status of ["active", "pending"] as const) {
      const rows = await ctx.db
        .query("newsletterSubscribers")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const s of rows) {
        scanned += 1;
        if (s.country) continue;
        const country = countryFromLanguage(s.language);
        if (country) {
          await ctx.db.patch(s._id, { country });
          updated += 1;
        }
      }
    }
    return { updated, scanned };
  },
});

function matchesFilter(
  s: { language?: string; source?: string; country?: string },
  languageFilter?: string,
  sourceFilter?: string,
  countryFilter?: string,
): boolean {
  if (languageFilter && normalizeLang(s.language) !== normalizeLang(languageFilter)) {
    return false;
  }
  if (sourceFilter && (s.source ?? "") !== sourceFilter) return false;
  if (countryFilter && (s.country ?? "") !== countryFilter) return false;
  return true;
}

/** Create a new draft campaign. */
export const createCampaign = mutation({
  args: { token: v.string(), ...campaignContentArgs },
  returns: v.object({ campaignId: v.id("newsletterCampaigns") }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    const { token, ...content } = args;
    const campaignId = await ctx.db.insert("newsletterCampaigns", {
      ...content,
      status: "draft",
      createdBy: userId,
      createdAt: Date.now(),
    });
    return { campaignId };
  },
});

/** Update a draft campaign's content / targeting. Only drafts are editable. */
export const updateCampaign = mutation({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    ...campaignContentArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found.");
    if (campaign.status !== "draft") {
      throw new ConvexError("Only draft campaigns can be edited.");
    }
    const { token, campaignId, ...content } = args;
    await ctx.db.patch(campaignId, content);
    return null;
  },
});

/** Delete a draft campaign. Sent/sending campaigns are kept for the record. */
export const deleteCampaign = mutation({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    if (campaign.status !== "draft") {
      throw new ConvexError("Only draft campaigns can be deleted.");
    }
    await ctx.db.delete(args.campaignId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Admin: send test / start
// ---------------------------------------------------------------------------

/**
 * Internal auth check for actions (which have no ctx.db). Returns the admin's
 * own email so `sendTestEmail` knows where to deliver the preview.
 */
export const resolveAdminEmail = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    await assertAdmin(ctx, userId);
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    return { email: settings?.email ?? null };
  },
});

/**
 * Render the campaign and send a single copy to the admin (or an explicit
 * address) so marketing can preview real rendering before any fan-out.
 */
export const sendTestEmail = action({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    to: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const admin: { email: string | null } = await ctx.runQuery(
      internal.newsletterCampaigns.resolveAdminEmail,
      { token: args.token },
    );
    const to = args.to ?? admin.email ?? undefined;
    if (!to) {
      return {
        success: false,
        error: "No test recipient — pass an address or set an email on your admin account.",
      };
    }

    const campaign = await ctx.runQuery(internal.newsletterCampaigns.getCampaign, {
      campaignId: args.campaignId,
    });
    if (!campaign) return { success: false, error: "Campaign not found." };

    const allDeals: DealForEmail[] = campaign.includeDeals
      ? await ctx.runQuery(internal.newsletter.getFeaturedDeals, {})
      : [];

    // Test emails use a throwaway unsubscribe token — they never touch the
    // list. Preview shows the country-targeted deals if a country is set,
    // else the global top picks.
    const mail = renderCampaignEmail(
      campaign,
      undefined,
      "test-preview-token",
      pickTopDeals(allDeals, campaign.countryFilter),
    );
    const res: { success: boolean; error?: string } = await ctx.runAction(
      internal.postmark.sendRawEmail,
      {
        to,
        subject: `[TEST] ${mail.subject}`,
        html: mail.html,
        text: mail.text,
        from: MARKETING_FROM,
        replyTo: MARKETING_EMAIL,
        messageStream: NEWSLETTER_STREAM,
      },
    );
    return { success: res.success, error: res.error };
  },
});

/** Flip a draft to "sending" and kick off the batched fan-out. */
export const startCampaign = mutation({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found.");
    if (campaign.status !== "draft") {
      throw new ConvexError("This campaign has already been sent.");
    }
    await ctx.db.patch(args.campaignId, {
      status: "sending",
      targeted: 0,
      sent: 0,
      failed: 0,
    });
    await ctx.scheduler.runAfter(0, internal.newsletterCampaigns.processCampaignSend, {
      campaignId: args.campaignId,
      cursor: null,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal: fan-out
// ---------------------------------------------------------------------------

export const getCampaign = internalQuery({
  args: { campaignId: v.id("newsletterCampaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

/** One page of active subscribers matching the campaign's targeting filter. */
export const getCampaignRecipientsPage = internalQuery({
  args: {
    languageFilter: v.optional(v.string()),
    sourceFilter: v.optional(v.string()),
    countryFilter: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    numItems: v.float64(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ numItems: args.numItems, cursor: args.cursor });

    const page = result.page
      .filter((s) => matchesFilter(s, args.languageFilter, args.sourceFilter, args.countryFilter))
      .map((s) => ({
        _id: s._id,
        email: s.email,
        language: s.language,
        country: s.country,
        unsubscribeToken: s.unsubscribeToken,
      }));

    return {
      page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/** Of the given subscribers, which have NOT yet received this campaign. */
export const filterUnsent = internalQuery({
  args: {
    campaignId: v.id("newsletterCampaigns"),
    subscriberIds: v.array(v.id("newsletterSubscribers")),
  },
  handler: async (ctx, args) => {
    const unsent: Id<"newsletterSubscribers">[] = [];
    for (const subscriberId of args.subscriberIds) {
      const existing = await ctx.db
        .query("newsletterCampaignSends")
        .withIndex("by_campaign_subscriber", (q) =>
          q.eq("campaignId", args.campaignId).eq("subscriberId", subscriberId),
        )
        .first();
      if (!existing) unsent.push(subscriberId);
    }
    return unsent;
  },
});

/**
 * Persist a batch's results: write ledger rows for the delivered subscribers
 * (double-guarded by the unique index) and bump the campaign counters.
 */
export const recordCampaignSends = internalMutation({
  args: {
    campaignId: v.id("newsletterCampaigns"),
    sentSubscriberIds: v.array(v.id("newsletterSubscribers")),
    failedCount: v.float64(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    for (const subscriberId of args.sentSubscriberIds) {
      const existing = await ctx.db
        .query("newsletterCampaignSends")
        .withIndex("by_campaign_subscriber", (q) =>
          q.eq("campaignId", args.campaignId).eq("subscriberId", subscriberId),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("newsletterCampaignSends", {
        campaignId: args.campaignId,
        subscriberId,
        sentAt: now,
      });
      inserted += 1;
    }

    const campaign = await ctx.db.get(args.campaignId);
    if (campaign) {
      const attempted = args.sentSubscriberIds.length + args.failedCount;
      await ctx.db.patch(args.campaignId, {
        sent: (campaign.sent ?? 0) + inserted,
        failed: (campaign.failed ?? 0) + args.failedCount,
        targeted: (campaign.targeted ?? 0) + attempted,
      });
    }
    return null;
  },
});

/** Mark the campaign done (or failed if it was cancelled mid-flight). */
export const finalizeCampaign = internalMutation({
  args: { campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "sending") return null;
    await ctx.db.patch(args.campaignId, { status: "sent", sentAt: Date.now() });
    return null;
  },
});

/**
 * Batched fan-out. Sends one page of subscribers, records results, then
 * re-schedules itself until the list is exhausted. Idempotent via the ledger.
 */
export const processCampaignSend = internalAction({
  args: {
    campaignId: v.id("newsletterCampaigns"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const campaign = await ctx.runQuery(internal.newsletterCampaigns.getCampaign, {
      campaignId: args.campaignId,
    });
    if (!campaign || campaign.status !== "sending") return null;

    const allDeals: DealForEmail[] = campaign.includeDeals
      ? await ctx.runQuery(internal.newsletter.getFeaturedDeals, {})
      : [];

    const pageResult: {
      page: Array<{
        _id: Id<"newsletterSubscribers">;
        email: string;
        language?: string;
        country?: string;
        unsubscribeToken: string;
      }>;
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.newsletterCampaigns.getCampaignRecipientsPage, {
      languageFilter: campaign.languageFilter,
      sourceFilter: campaign.sourceFilter,
      countryFilter: campaign.countryFilter,
      cursor: args.cursor,
      numItems: SEND_BATCH_SIZE,
    });

    const ids = pageResult.page.map((s) => s._id);
    const unsent: Id<"newsletterSubscribers">[] = ids.length
      ? await ctx.runQuery(internal.newsletterCampaigns.filterUnsent, {
          campaignId: args.campaignId,
          subscriberIds: ids,
        })
      : [];
    const unsentSet = new Set(unsent.map((id) => String(id)));

    const sentIds: Id<"newsletterSubscribers">[] = [];
    let failedCount = 0;

    for (const sub of pageResult.page) {
      if (!unsentSet.has(String(sub._id))) continue;
      const mail = renderCampaignEmail(
        campaign,
        sub.language,
        sub.unsubscribeToken,
        pickTopDeals(allDeals, sub.country),
      );
      const res: { success: boolean; error?: string } = await ctx.runAction(
        internal.postmark.sendRawEmail,
        {
          to: sub.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          from: MARKETING_FROM,
          replyTo: MARKETING_EMAIL,
          messageStream: NEWSLETTER_STREAM,
        },
      );
      if (res.success) sentIds.push(sub._id);
      else failedCount += 1;
    }

    if (sentIds.length || failedCount) {
      await ctx.runMutation(internal.newsletterCampaigns.recordCampaignSends, {
        campaignId: args.campaignId,
        sentSubscriberIds: sentIds,
        failedCount,
      });
    }

    if (!pageResult.isDone) {
      await ctx.scheduler.runAfter(0, internal.newsletterCampaigns.processCampaignSend, {
        campaignId: args.campaignId,
        cursor: pageResult.continueCursor,
      });
    } else {
      await ctx.runMutation(internal.newsletterCampaigns.finalizeCampaign, {
        campaignId: args.campaignId,
      });
    }

    return null;
  },
});
