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
  renderItinerariesBlock,
  renderSightsBlock,
  renderAttractionsBlock,
  renderPackagesBlock,
  renderGuidesBlock,
  renderSpotlightBlock,
  renderCalendarBlock,
  renderTeaserBlock,
  normalizeLang,
  pickTopDeals,
  pickGuides,
  dealPriceSignal,
  CJ_BANNERS,
  FOOTER_COPY,
  INVITE_COPY,
  MARKETING_FROM,
  MARKETING_EMAIL,
  BASE_URL,
  queryFeaturedDeals,
  queryFeaturedItineraries,
  queryFeaturedSights,
  queryFeaturedAttractions,
  queryFeaturedPackages,
  type DealForEmail,
  type ItineraryForEmail,
  type SightForEmail,
  type AttractionForEmail,
  type PackageForEmail,
  type RouteBlockMeta,
} from "./newsletter";
import { calendarCacheKey, exploreDestCacheKey } from "./lib/searchCacheKeys";
import type { FlightCalendar, ExploreDestinationFlights } from "../types/flights";

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
  dealCount?: number;
  // Optional enrichment blocks — each is opt-in and paired with a count. If
  // the flag is on but no content is available at send-time the block is
  // silently omitted; a missing section is always better than an empty one.
  includeItineraries?: boolean;
  itineraryCount?: number;
  includeSights?: boolean;
  sightCount?: number;
  includeAttractions?: boolean;
  attractionCount?: number;
  includePackages?: boolean;
  packageCount?: number;
  includeGuides?: boolean;
  guideCount?: number;
  includeSpotlight?: boolean;
  // Live-price route block (one pinned route, fetched fresh at send time).
  routeBlock?: "calendar" | "teaser";
  routeOrigin?: string;
  routeDestination?: string;
  routeOriginCity?: string;
  routeDestinationCity?: string;
  routeCurrency?: string;
  bannerKey?: string;
}

/**
 * Everything the renderer needs beyond the campaign's own fields — the live
 * content already-fetched-and-picked by the caller. Kept as a single arg so
 * new block types can be added without another signature bump.
 */
interface CampaignExtras {
  deals: DealForEmail[];
  itineraries: ItineraryForEmail[];
  sights: SightForEmail[];
  attractions: AttractionForEmail[];
  packages: PackageForEmail[];
  // Large "trip of the week" card; when both spotlight and the itinerary list
  // are on, the builders dedupe so the spotlighted trip never appears twice.
  spotlight: ItineraryForEmail | null;
  // Route-block payloads — at most one is non-null, matching `routeBlock`.
  // Null on a fetch/cache miss, in which case the block is silently omitted.
  calendar: FlightCalendar | null;
  teaser: ExploreDestinationFlights | null;
}

function renderCampaignEmail(
  campaign: CampaignContent & { countryFilter?: string },
  language: string | undefined,
  unsubscribeToken: string,
  extras: CampaignExtras,
): { subject: string; html: string; text: string } {
  const lang = normalizeLang(language);
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;

  // Guides are constants (no DB), so they're picked here per-recipient — a
  // Greek reader gets the Greek pages even on an all-languages campaign.
  const guides = campaign.includeGuides
    ? pickGuides(language, clampCount(campaign.guideCount, 2, 3), campaign.countryFilter)
    : [];

  // Display cities for the route block, falling back to the IATA codes so a
  // half-filled route still renders something sensible.
  const routeMeta: RouteBlockMeta = {
    originCity: campaign.routeOriginCity || campaign.routeOrigin || "",
    destinationCity: campaign.routeDestinationCity || campaign.routeDestination || "",
  };

  // Enrichment blocks concatenate into a single HTML string in a stable
  // order — the spotlight centerpiece, then inspiration (itineraries → sights
  // → guides), then commercial (attractions → packages → route prices →
  // flight deals). An unavailable block collapses to "" so ordering never
  // leaves a visible gap.
  const enrichment = [
    campaign.includeSpotlight && extras.spotlight
      ? renderSpotlightBlock(extras.spotlight, lang) : "",
    campaign.includeItineraries && extras.itineraries.length
      ? renderItinerariesBlock(extras.itineraries, lang) : "",
    campaign.includeSights && extras.sights.length
      ? renderSightsBlock(extras.sights, lang) : "",
    guides.length ? renderGuidesBlock(guides, lang) : "",
    campaign.includeAttractions && extras.attractions.length
      ? renderAttractionsBlock(extras.attractions, lang) : "",
    campaign.includePackages && extras.packages.length
      ? renderPackagesBlock(extras.packages, lang) : "",
    campaign.routeBlock === "calendar" && extras.calendar
      ? renderCalendarBlock(extras.calendar, routeMeta, lang) : "",
    campaign.routeBlock === "teaser" && extras.teaser
      ? renderTeaserBlock(extras.teaser, routeMeta, lang) : "",
    campaign.includeDeals && extras.deals.length
      ? renderDealsBlock(extras.deals, lang) : "",
  ].filter(Boolean).join("");

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
    // Affiliate banner is opt-in per campaign; the key is validated against
    // the CJ creative set so an unknown value just renders nothing.
    banner: (campaign.bannerKey && CJ_BANNERS[campaign.bannerKey as keyof typeof CJ_BANNERS]) || null,
    dealsBlock: enrichment || undefined,
    invite: true,
  });

  // Plain-text alternative: same content, no images, no styling. Some clients
  // (and screen readers) prefer this, and it drives spam scoring down.
  const textParts: string[] = [`${campaign.heading}`, campaign.para1];
  if (campaign.para2) textParts.push(campaign.para2);
  if (campaign.includeSpotlight && extras.spotlight) {
    const s = extras.spotlight;
    textParts.push(
      `★ ${s.title} — ${s.destination} (${Math.round(s.durationDays)}d)\n` +
        `${BASE_URL}/explore/${encodeURIComponent(s.slug)}`,
    );
  }
  if (campaign.includeItineraries && extras.itineraries.length) {
    textParts.push(
      extras.itineraries
        .map((i) => `• ${i.title} — ${i.destination} (${i.durationDays}d)`)
        .join("\n"),
    );
  }
  if (campaign.includeSights && extras.sights.length) {
    textParts.push(extras.sights.map((s) => `• ${s.name}`).join("\n"));
  }
  if (guides.length) {
    textParts.push(
      guides.map((g) => `• ${g.title} — ${BASE_URL}/guides/${g.slug}`).join("\n"),
    );
  }
  if (campaign.includeAttractions && extras.attractions.length) {
    textParts.push(
      extras.attractions
        .map((a) => {
          const price = a.price != null && a.currency
            ? ` — from ${Math.round(a.price)} ${a.currency}` : "";
          return `• ${a.displayTitle}${price}`;
        })
        .join("\n"),
    );
  }
  if (campaign.includePackages && extras.packages.length) {
    textParts.push(
      extras.packages
        .map((p) => `• ${p.title} — from ${Math.round(p.priceFrom)} ${p.priceCurrency}`)
        .join("\n"),
    );
  }
  if (campaign.routeBlock === "calendar" && extras.calendar?.dates?.length) {
    const top = extras.calendar.dates.filter((d) => d.price > 0).slice(0, 3);
    if (top.length) {
      textParts.push(
        `${routeMeta.originCity} → ${routeMeta.destinationCity}:\n` +
          top.map((d) => `• ${d.date}: ${Math.round(d.price)} ${extras.calendar!.currency}`).join("\n"),
      );
    }
  }
  if (campaign.routeBlock === "teaser" && extras.teaser) {
    const prices = (extras.teaser.flights ?? [])
      .map((f) => f.price)
      .filter((p): p is number => typeof p === "number" && p > 0);
    const cheapest = extras.teaser.cheapestPrice ?? (prices.length ? Math.min(...prices) : undefined);
    if (cheapest) {
      textParts.push(
        `${routeMeta.originCity} → ${routeMeta.destinationCity}: from ${Math.round(cheapest)} ${extras.teaser.currency}`,
      );
    }
  }
  if (campaign.includeDeals && extras.deals.length) {
    textParts.push(
      extras.deals
        .map((d) => {
          const signal = dealPriceSignal(d);
          const note = signal?.kind === "below_typical" ? ` (-${signal.pct}%)` : "";
          return `• ${d.originCity} → ${d.destinationCity}: ${Math.round(d.price)} ${d.currency}${note}`;
        })
        .join("\n"),
    );
  }
  textParts.push(`${INVITE_COPY[lang].text} ${BASE_URL}`);
  textParts.push(`${campaign.ctaText}: ${campaign.ctaUrl}`);
  textParts.push(`${FOOTER_COPY[lang].contact} ${MARKETING_EMAIL}`);
  textParts.push(`${FOOTER_COPY[lang].unsubscribe}: ${unsubscribeUrl}`);
  const text = textParts.join("\n\n");

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
  dealCount: v.optional(v.float64()),
  // Optional enrichment blocks — parallel structure to includeDeals/dealCount.
  includeItineraries: v.optional(v.boolean()),
  itineraryCount: v.optional(v.float64()),
  includeSights: v.optional(v.boolean()),
  sightCount: v.optional(v.float64()),
  includeAttractions: v.optional(v.boolean()),
  attractionCount: v.optional(v.float64()),
  includePackages: v.optional(v.boolean()),
  packageCount: v.optional(v.float64()),
  includeGuides: v.optional(v.boolean()),
  guideCount: v.optional(v.float64()),
  includeSpotlight: v.optional(v.boolean()),
  // Live-price route block: pin one route and render it as either a
  // "cheapest days to fly" calendar strip or a "flights from €X" teaser card.
  routeBlock: v.optional(v.union(v.literal("calendar"), v.literal("teaser"))),
  routeOrigin: v.optional(v.string()),
  routeDestination: v.optional(v.string()),
  routeOriginCity: v.optional(v.string()),
  routeDestinationCity: v.optional(v.string()),
  routeCurrency: v.optional(v.string()),
  bannerKey: v.optional(v.string()),
  languageFilter: v.optional(v.string()),
  sourceFilter: v.optional(v.string()),
  countryFilter: v.optional(v.string()),
  // Optional send time for a manually composed campaign. Empty = send on
  // demand; set = the composer schedules it via `approveCampaign`.
  scheduledAt: v.optional(v.float64()),
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
      scheduledAt: c.scheduledAt,
      generatedByAi: c.generatedByAi ?? false,
      sendRationale: c.sendRationale,
      theme: c.theme,
      heading: c.heading,
      para1: c.para1,
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
    // AI drafts are editable too — that's the point of the review step.
    if (campaign.status !== "draft" && campaign.status !== "pending_approval") {
      throw new ConvexError("Only draft or pending campaigns can be edited.");
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
    if (campaign.status !== "draft" && campaign.status !== "rejected") {
      throw new ConvexError("Only draft or rejected campaigns can be deleted.");
    }
    await ctx.db.delete(args.campaignId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Enrichment content plumbing
//
// Deals stay per-subscriber (existing behaviour — a Greek subscriber sees GR
// deals, a German one sees DE deals — driven by the deal's `origin` IATA).
// The other enrichment blocks are picked ONCE per send at the campaign's
// `countryFilter`, because that's the audience the marketer targeted; running
// extra queries per subscriber for content that changes far more slowly
// than fares would be wasteful and cache-hostile. Exceptions: guides (pure
// constants, picked per recipient language inside the renderer) and the
// route block (fetched per batch through the shared searchapi cache).
// ---------------------------------------------------------------------------

// Clamp helper: read a count, default to `def`, keep inside [1, hi].
function clampCount(n: number | undefined, def: number, hi: number): number {
  const raw = Math.round(Number.isFinite(n as number) ? (n as number) : def);
  return Math.min(hi, Math.max(1, raw));
}

/**
 * How many itineraries to fetch, and how to split them: the spotlight (when
 * on) takes the top-ranked one, the list gets the rest — so the same trip is
 * never both the centerpiece and a list row.
 */
function splitItineraries(
  campaign: CampaignContent,
  fetched: ItineraryForEmail[],
): { spotlight: ItineraryForEmail | null; itineraries: ItineraryForEmail[] } {
  const spotlight = campaign.includeSpotlight ? (fetched[0] ?? null) : null;
  const itineraries = campaign.includeItineraries
    ? fetched.slice(campaign.includeSpotlight ? 1 : 0)
    : [];
  return { spotlight, itineraries };
}

function itineraryFetchCount(campaign: CampaignContent): number {
  return (
    (campaign.includeItineraries ? clampCount(campaign.itineraryCount, 2, 3) : 0) +
    (campaign.includeSpotlight ? 1 : 0)
  );
}

/** The route block's pinned route, or null when not (fully) configured. */
function routeBlockInputs(
  campaign: CampaignContent,
): { kind: "calendar" | "teaser"; origin: string; destination: string; currency?: string } | null {
  if (!campaign.routeBlock || !campaign.routeOrigin || !campaign.routeDestination) return null;
  return {
    kind: campaign.routeBlock,
    origin: campaign.routeOrigin,
    destination: campaign.routeDestination,
    currency: campaign.routeCurrency,
  };
}

/**
 * Direct read of the shared searchapi cache (same rows
 * `flightSearchCache.readCache` serves), for query contexts that cannot call
 * the fetch actions. Expired rows read as misses.
 */
async function readSearchCacheFromDb(db: any, cacheKey: string): Promise<any | null> {
  const row = await db
    .query("flightSearchCache")
    .withIndex("by_cacheKey", (q: any) => q.eq("cacheKey", cacheKey))
    .first();
  if (!row || row.expiresAt < Date.now()) return null;
  return row.normalizedResults;
}

/**
 * Query-context build (used by `previewCampaign`). No runQuery hops. The
 * route block is CACHE-ONLY here — a query can't hit searchapi — so a preview
 * may omit it on a cold cache; the test-send (an action) always shows it.
 */
async function buildExtrasFromDb(
  db: any,
  campaign: CampaignContent & { countryFilter?: string; languageFilter?: string },
  deals: DealForEmail[],
): Promise<CampaignExtras> {
  const country = campaign.countryFilter;
  const itinMax = itineraryFetchCount(campaign);
  const route = routeBlockInputs(campaign);
  const [fetchedItins, sights, attractions, packages, calendar, teaser] = await Promise.all([
    itinMax
      ? queryFeaturedItineraries(db, { country, max: itinMax })
      : Promise.resolve<ItineraryForEmail[]>([]),
    campaign.includeSights
      ? queryFeaturedSights(db, { max: clampCount(campaign.sightCount, 3, 5) })
      : Promise.resolve<SightForEmail[]>([]),
    campaign.includeAttractions
      ? queryFeaturedAttractions(db, { country, max: clampCount(campaign.attractionCount, 3, 4) })
      : Promise.resolve<AttractionForEmail[]>([]),
    campaign.includePackages
      ? queryFeaturedPackages(db, { country, max: clampCount(campaign.packageCount, 2, 3) })
      : Promise.resolve<PackageForEmail[]>([]),
    route?.kind === "calendar"
      ? readSearchCacheFromDb(db, calendarCacheKey({
          departureId: route.origin, arrivalId: route.destination, currency: route.currency,
        })) as Promise<FlightCalendar | null>
      : Promise.resolve<FlightCalendar | null>(null),
    route?.kind === "teaser"
      ? readSearchCacheFromDb(db, exploreDestCacheKey({
          departureId: route.origin, arrivalId: route.destination, currency: route.currency,
          hl: campaign.languageFilter,
        })) as Promise<ExploreDestinationFlights | null>
      : Promise.resolve<ExploreDestinationFlights | null>(null),
  ]);
  return {
    deals: campaign.includeDeals
      ? pickTopDeals(deals, country, clampCount(campaign.dealCount, 3, 5))
      : [],
    ...splitItineraries(campaign, fetchedItins),
    sights,
    attractions,
    packages,
    calendar,
    teaser,
  };
}

/**
 * Action-context build (used by `sendTestEmail` and the fan-out). Same shape
 * as `buildExtrasFromDb` but goes through runQuery, since actions have no
 * direct db handle. Deals list is passed in so the send loop can re-slice it
 * per subscriber.
 */
async function fetchExtrasForCampaign(
  ctx: any,
  campaign: CampaignContent & { countryFilter?: string; languageFilter?: string },
  deals: DealForEmail[],
): Promise<CampaignExtras> {
  const country = campaign.countryFilter;
  const itinMax = itineraryFetchCount(campaign);
  const route = routeBlockInputs(campaign);
  const [fetchedItins, sights, attractions, packages, calendar, teaser] = await Promise.all([
    itinMax
      ? ctx.runQuery(internal.newsletter.getFeaturedItineraries, { country, max: itinMax })
      : Promise.resolve<ItineraryForEmail[]>([]),
    campaign.includeSights
      ? ctx.runQuery(internal.newsletter.getFeaturedSights, { max: clampCount(campaign.sightCount, 3, 5) })
      : Promise.resolve<SightForEmail[]>([]),
    campaign.includeAttractions
      ? ctx.runQuery(internal.newsletter.getFeaturedAttractions, { country, max: clampCount(campaign.attractionCount, 3, 4) })
      : Promise.resolve<AttractionForEmail[]>([]),
    campaign.includePackages
      ? ctx.runQuery(internal.newsletter.getFeaturedPackages, { country, max: clampCount(campaign.packageCount, 2, 3) })
      : Promise.resolve<PackageForEmail[]>([]),
    // Route-block prices are fetched live (cache-backed, so at most one
    // searchapi call per TTL window across all batches of a send).
    route?.kind === "calendar"
      ? ctx.runAction(internal.flightCalendar.fetchForCampaign, {
          departureId: route.origin, arrivalId: route.destination, currency: route.currency,
        })
      : Promise.resolve<FlightCalendar | null>(null),
    route?.kind === "teaser"
      ? ctx.runAction(internal.exploreDestination.fetchTeaserForCampaign, {
          departureId: route.origin, arrivalId: route.destination, currency: route.currency,
          hl: campaign.languageFilter,
        })
      : Promise.resolve<ExploreDestinationFlights | null>(null),
  ]);
  return {
    deals: campaign.includeDeals
      ? pickTopDeals(deals, country, clampCount(campaign.dealCount, 3, 5))
      : [],
    ...splitItineraries(campaign, fetchedItins),
    sights,
    attractions,
    packages,
    calendar,
    teaser,
  };
}

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
 * Render a campaign to HTML without sending anything, so the admin dashboard
 * can show it in an iframe. Goes through the exact same `renderCampaignEmail`
 * path as the real fan-out — including live deals for the campaign's country —
 * so the preview is what subscribers actually receive.
 *
 * Read-only and side-effect free: no Postmark call, no send ledger, and a
 * throwaway unsubscribe token that is never linked to a subscriber.
 */
export const previewCampaign = query({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.union(
    v.null(),
    v.object({ subject: v.string(), html: v.string(), text: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    const allDeals: DealForEmail[] = campaign.includeDeals
      ? await queryFeaturedDeals(ctx.db)
      : [];
    const extras = await buildExtrasFromDb(ctx.db, campaign, allDeals);

    return renderCampaignEmail(campaign, undefined, "preview-token", extras);
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
    const extras: CampaignExtras = await fetchExtrasForCampaign(ctx, campaign, allDeals);

    // Test emails use a throwaway unsubscribe token — they never touch the
    // list. Preview shows the country-targeted deals if a country is set,
    // else the global top picks.
    const mail = renderCampaignEmail(campaign, undefined, "test-preview-token", extras);
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

// ---------------------------------------------------------------------------
// Admin: approve / reject AI-generated drafts
// ---------------------------------------------------------------------------

/**
 * Approve a pending AI draft and SCHEDULE it for the given time (defaults to
 * the AI's suggested `scheduledAt`). Nothing goes out until that moment, and
 * `startScheduledCampaign` re-checks the status when the timer fires — so
 * cancelling is just a status change, no job bookkeeping needed.
 */
export const approveCampaign = mutation({
  args: {
    token: v.string(),
    campaignId: v.id("newsletterCampaigns"),
    scheduledAt: v.optional(v.float64()),
  },
  returns: v.object({ scheduledAt: v.float64() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found.");
    if (campaign.status !== "pending_approval" && campaign.status !== "draft") {
      throw new ConvexError("Only a pending or draft campaign can be approved.");
    }

    const when = args.scheduledAt ?? campaign.scheduledAt ?? Date.now();
    if (when < Date.now() - 60_000) {
      throw new ConvexError("Scheduled time is in the past.");
    }

    await ctx.db.patch(args.campaignId, {
      status: "scheduled",
      scheduledAt: when,
      targeted: 0,
      sent: 0,
      failed: 0,
    });
    await ctx.scheduler.runAt(when, internal.newsletterCampaigns.startScheduledCampaign, {
      campaignId: args.campaignId,
    });
    return { scheduledAt: when };
  },
});

/** Decline an AI draft. Kept (not deleted) so the record survives. */
export const rejectCampaign = mutation({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found.");
    if (campaign.status !== "pending_approval") {
      throw new ConvexError("Only a pending campaign can be rejected.");
    }
    await ctx.db.patch(args.campaignId, { status: "rejected" });
    return null;
  },
});

/**
 * Pull a scheduled campaign back to draft before it fires. The pending
 * scheduler job stays queued but no-ops, since it only acts on "scheduled".
 */
export const cancelScheduledCampaign = mutation({
  args: { token: v.string(), campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new ConvexError("Campaign not found.");
    if (campaign.status !== "scheduled") {
      throw new ConvexError("Only a scheduled campaign can be cancelled.");
    }
    await ctx.db.patch(args.campaignId, { status: "draft", scheduledAt: undefined });
    return null;
  },
});

/** Scheduler callback: start the send if the campaign is still scheduled. */
export const startScheduledCampaign = internalMutation({
  args: { campaignId: v.id("newsletterCampaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    // Cancelled / already sent / rejected in the meantime — do nothing.
    if (!campaign || campaign.status !== "scheduled") return null;
    await ctx.db.patch(args.campaignId, { status: "sending" });
    await ctx.scheduler.runAfter(0, internal.newsletterCampaigns.processCampaignSend, {
      campaignId: args.campaignId,
      cursor: null,
    });
    return null;
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
    // Enrichment content is fetched once per BATCH (not per subscriber): it
    // is campaign-country scoped, unlike deals which re-slice per subscriber
    // below. Refetching each batch (not once per campaign) keeps a long
    // fan-out from pinning hours-stale attraction prices.
    const batchExtras: CampaignExtras = await fetchExtrasForCampaign(ctx, campaign, allDeals);

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
      // Deals re-slice per subscriber country; the other blocks are shared.
      const mail = renderCampaignEmail(campaign, sub.language, sub.unsubscribeToken, {
        ...batchExtras,
        deals: campaign.includeDeals
          ? pickTopDeals(allDeals, sub.country, clampCount(campaign.dealCount, 3, 5))
          : [],
      });
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
