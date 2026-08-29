/**
 * Trackable short links for the newsletter → social decks.
 *
 * A deal card tells the viewer to tap a link, and the admin pastes that link
 * into an Instagram bio or a story sticker. Pasted raw, the tap is invisible to
 * us: it lands on a public ISR page with no session, so nothing ever tells us
 * whether the post worked. `/l/<code>` sits in the middle — it records the
 * click and forwards to the real page.
 *
 * Two rules the design turns on:
 *
 *   - **A code is stable per (campaign, slide, kind).** Re-opening the composer
 *     must hand back the same link, or one post's clicks end up split across
 *     however many times someone opened the panel. `mint` therefore upserts.
 *   - **A click record holds no visitor data.** No IP, no user agent, no
 *     cookie. The question is how many taps a post earned; answering it does
 *     not require knowing who tapped. The referrer HOST is the one exception,
 *     and only because "instagram vs everything else" is the split that decides
 *     whether the post or the bio did the work.
 *
 * The counter is honest about what it can be: `follow` is public — it has to be,
 * a stranger tapping a story is exactly the caller — so a determined person
 * could inflate a number. It is a marketing metric, not billing.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertAdmin } from "./admin";

// Excludes look-alike characters (0/O, 1/l/I): these get read off phone
// screens and retyped. 10 chars ≈ 49 bits — not enumerable, and still short
// enough to sit in a bio line.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Session token → admin user id, mirroring `newsletterSocial.ts`. */
async function requireAdmin(ctx: any, token: string): Promise<string> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new Error("Unauthorized");
  await assertAdmin(ctx, session.userId);
  return session.userId;
}

const kindValidator = v.union(v.literal("itinerary"), v.literal("flights"));

/**
 * Create (or refresh) the short links for a campaign's deal cards.
 *
 * Idempotent per slide+kind: an existing row keeps its code and its click
 * count, and only its target is brought up to date. That matters because the
 * composer re-mints every time it is opened, and because a destination can
 * legitimately move — an itinerary published for a city that had none turns a
 * flights-only card into an itinerary card without losing the post's history.
 */
export const mint = mutation({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    links: v.array(
      v.object({
        slideIndex: v.float64(),
        kind: kindValidator,
        route: v.string(),
        targetUrl: v.string(),
      }),
    ),
  },
  returns: v.array(
    v.object({
      slideIndex: v.float64(),
      kind: kindValidator,
      code: v.string(),
      clicks: v.float64(),
      lastClickAt: v.optional(v.float64()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const existing = await ctx.db
      .query("socialShareLinks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const out: Array<{
      slideIndex: number;
      kind: "itinerary" | "flights";
      code: string;
      clicks: number;
      lastClickAt?: number;
    }> = [];

    for (const link of args.links) {
      const match = existing.find(
        (r) => r.slideIndex === link.slideIndex && r.kind === link.kind,
      );

      if (match) {
        if (match.targetUrl !== link.targetUrl || match.route !== link.route) {
          await ctx.db.patch(match._id, {
            targetUrl: link.targetUrl,
            route: link.route,
          });
        }
        out.push({
          slideIndex: link.slideIndex,
          kind: link.kind,
          code: match.code,
          clicks: match.clicks,
          lastClickAt: match.lastClickAt,
        });
        continue;
      }

      // Retry on the astronomically unlikely collision rather than pointing two
      // campaigns at one counter.
      let code = randomCode();
      for (let i = 0; i < 5; i++) {
        const clash = await ctx.db
          .query("socialShareLinks")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique();
        if (!clash) break;
        code = randomCode();
      }

      await ctx.db.insert("socialShareLinks", {
        code,
        campaignId: args.campaignId,
        slideIndex: link.slideIndex,
        kind: link.kind,
        route: link.route,
        targetUrl: link.targetUrl,
        clicks: 0,
        createdAt: Date.now(),
      });
      out.push({ slideIndex: link.slideIndex, kind: link.kind, code, clicks: 0 });
    }

    return out;
  },
});

/**
 * Where a code points, without counting a visit.
 *
 * Used by the redirect for link-preview crawlers: Instagram, WhatsApp and every
 * chat app fetch a URL the moment it is pasted, and counting those would report
 * an audience of bots.
 */
export const resolve = query({
  args: { code: v.string() },
  returns: v.union(v.null(), v.object({ targetUrl: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("socialShareLinks")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    return row ? { targetUrl: row.targetUrl } : null;
  },
});

/**
 * Count a click and return where to send it.
 *
 * Public by necessity — the caller is a stranger who tapped a story. Returns
 * null for an unknown code so the redirect can fall back rather than 500.
 */
export const follow = mutation({
  args: { code: v.string(), referrerHost: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ targetUrl: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("socialShareLinks")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!row) return null;

    const now = Date.now();
    await ctx.db.patch(row._id, { clicks: row.clicks + 1, lastClickAt: now });
    await ctx.db.insert("socialShareLinkClicks", {
      code: row.code,
      at: now,
      // Trimmed to a host by the caller; a full referrer URL can carry a path
      // and query that are none of our business.
      referrerHost: args.referrerHost?.slice(0, 100),
    });

    return { targetUrl: row.targetUrl };
  },
});

/**
 * Click counts for one campaign's links, for the composer.
 *
 * `today` and `last7d` come from the per-click rows: a lifetime total alone
 * cannot tell "this post is working right now" from "this link did well in
 * March", which is the only question worth asking the morning after a post.
 */
export const statsForCampaign = query({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.array(
    v.object({
      slideIndex: v.float64(),
      kind: kindValidator,
      code: v.string(),
      route: v.string(),
      targetUrl: v.string(),
      clicks: v.float64(),
      today: v.float64(),
      last7d: v.float64(),
      lastClickAt: v.optional(v.float64()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const rows = await ctx.db
      .query("socialShareLinks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const now = Date.now();
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const weekStart = now - 7 * DAY_MS;

    const out = [];
    for (const row of rows) {
      // Bounded by the window, not by the link's lifetime.
      const recent = await ctx.db
        .query("socialShareLinkClicks")
        .withIndex("by_code_at", (q) => q.eq("code", row.code).gte("at", weekStart))
        .collect();
      out.push({
        slideIndex: row.slideIndex,
        kind: row.kind,
        code: row.code,
        route: row.route,
        targetUrl: row.targetUrl,
        clicks: row.clicks,
        today: recent.filter((c) => c.at >= dayStart).length,
        last7d: recent.length,
        lastClickAt: row.lastClickAt,
      });
    }
    return out.sort((a, b) => a.slideIndex - b.slideIndex || a.kind.localeCompare(b.kind));
  },
});
