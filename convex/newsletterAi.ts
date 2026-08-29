/**
 * AI-generated newsletter drafts (human-in-the-loop)
 *
 * Every 3 days a cron asks OpenAI to write a marketing email for each language
 * that actually has confirmed subscribers. Each draft lands in the admin
 * Newsletter section as `pending_approval` — NOTHING is ever sent automatically.
 * An admin reviews (and can edit) it, then approves, which schedules the send
 * for the AI-suggested date/time, or rejects it.
 *
 * Guards:
 *  - one draft per language per cycle; a language that still has an unapproved
 *    (or scheduled) draft is skipped, so drafts never pile up;
 *  - CTA links are whitelisted to planeraai.app so a hallucinated URL can never
 *    reach a subscriber;
 *  - the suggested send time is validated into a sane window (2h–21 days out).
 */

import { v } from "convex/values";
import { query, action, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { assertAdmin } from "./admin";
import { airportCityName } from "../lib/homeAirport";
import {
  normalizeLang,
  pickGuides,
  routeSearchUrl,
  routePriceWindow,
  HERO_IMAGES,
  CJ_BANNERS,
  type DealForEmail,
  type ItineraryForEmail,
  type AttractionForEmail,
  type PackageForEmail,
} from "./newsletter";

const internal = _internal as any;

// Marketing copy is customer-facing and low-volume (a handful of drafts every
// 3 days), so quality matters more than cost here — hence terra rather than the
// cheaper luna the partner itinerary generator uses.
const MODEL = process.env.NEWSLETTER_AI_MODEL || "gpt-5.6-terra";

// Human-readable language names for the prompt.
const LANG_NAMES: Record<string, string> = {
  en: "English", el: "Greek", es: "Spanish",
  fr: "French", de: "German", ar: "Arabic",
};

// Conservative language → likely audience country, used ONLY to bias which
// content samples we show the model (a Greek email leads with Greek-relevant
// content). Ambiguous languages (en, ar, es) are left unmapped — global
// samples are better than wrong ones. Mirrors the backfill map in
// newsletterCampaigns.ts.
const LANG_TO_LIKELY_COUNTRY: Record<string, string> = {
  el: "gr", fr: "fr", de: "de",
};

// The model may only point the CTA at our own site.
const ALLOWED_CTA_PREFIX = "https://planeraai.app";
const DEFAULT_CTA_URL = "https://planeraai.app/deals";

const MIN_LEAD_MS = 2 * 60 * 60 * 1000;       // never schedule less than 2h out
const MAX_LEAD_MS = 21 * 24 * 60 * 60 * 1000; // nor more than 3 weeks out

// How many previous campaigns (per language) we show the model as "already
// said this — don't repeat it".
const HISTORY_DEPTH = 6;

/**
 * Content angles. By default they are rotated server-side so two consecutive
 * emails to the same audience are never the same pitch — we assign the angle
 * rather than letting the model choose, because a model given the same context
 * tends to converge on the same idea every time. The admin "Generate now"
 * dialog can override the rotation and pin one theme, which is what makes an
 * on-demand draft steerable ("write me a food one for Greece").
 *
 * `label` is what the admin dialog shows; `brief` is what the model is told.
 * Every brief must stay inside PRODUCT_FACTS — a theme that tempts the model
 * toward a feature we do not have is a theme that ships a lie.
 */
const THEMES: Array<{
  id: string;
  label: string;
  brief: string;
  /**
   * Content blocks this angle can actually fill. Handed to the model as the
   * shortlist for the assigned theme, because the generic per-block hints in
   * SYSTEM_PROMPT could only ever name a few themes and silently left every
   * later one with no steer at all.
   */
  blocks: string[];
  /** Stock header photo that suits the angle (overridden by a pinned destination). */
  hero: string;
}> = [
  { id: "flight-deals", label: "Flight deals", brief: "Concrete live fare drops — whichever fares this email carries — and how to grab them before they move.", blocks: ["includePackages"], hero: "flights" },
  { id: "ai-planning", label: "AI trip planning", brief: "How filling in the trip form — destination, dates, budget, interests — gets you a full day-by-day itinerary you can then reorder and edit.", blocks: ["includeGuides", "includeItineraries"], hero: "plan" },
  { id: "destination-inspiration", label: "Destination inspiration", brief: "Spotlight one or two specific destinations worth visiting right now, and why now.", blocks: ["includeSpotlight", "includeSights"], hero: "explore" },
  { id: "community-explore", label: "Explore itineraries", brief: "The Explore section's ready-made destination itineraries, built from patterns across real Planera trips. Editorial guides to browse — NOT user posts, profiles, reviews or comments.", blocks: ["includeItineraries", "includeSpotlight"], hero: "explore" },
  { id: "travel-tips", label: "Practical travel tip", brief: "One genuinely useful practical tip (booking timing, packing, airport or baggage hacks).", blocks: ["includeGuides"], hero: "plan" },
  { id: "seasonal", label: "Seasonal timing", brief: "What to book right now for the season ahead, with a sense of timing.", blocks: ["includePackages", "includeAttractions"], hero: "explore" },
  { id: "weekend-escape", label: "Weekend escape", brief: "Short 2-4 day city breaks that fit into a weekend — quick to plan in the trip form, easy to take. Lean on short-haul deals below, if any.", blocks: ["includeItineraries", "includeSights"], hero: "flights" },
  { id: "budget-focus", label: "Budget travel", brief: "Travelling well on a small budget: how the trip form's total-budget field shapes the whole itinerary, backed only by the real prices listed below — never invented ones.", blocks: ["includeGuides", "includePackages"], hero: "plan" },
  { id: "route-spotlight", label: "Single route spotlight", brief: "Spotlight exactly ONE route from the live deals or flight ideas listed below: why this route is worth a look right now (use its typical-price context if given). If nothing is listed, write about how Low-Fare Radar surfaces cheap fares instead.", blocks: ["includeSights", "includeAttractions"], hero: "flights" },
  { id: "hidden-gems", label: "Hidden gems", brief: "The less obvious side of a destination — quieter neighbourhoods and lesser-known spots, reached by tapping the 'hidden gems' and 'neighbourhood walks' interest chips when planning.", blocks: ["includeSights", "includeItineraries"], hero: "explore" },
  { id: "food-trail", label: "Food & markets", brief: "Eating your way through one destination: how the 'local food' and 'traditional markets' interest chips shape the day-by-day plan around meals and market mornings.", blocks: ["includeAttractions", "includeSights"], hero: "explore" },
  { id: "outdoors-nature", label: "Outdoors & nature", brief: "Trips built around being outside — coast, trails, open air — via the 'nature & outdoors' interest chip. Concrete places, not generic wanderlust.", blocks: ["includeAttractions", "includeItineraries"], hero: "explore" },
  { id: "culture-history", label: "Culture & history", brief: "A destination through its museums, workshops and festivals, using the 'cultural workshops' and 'festivals' interest chips. Name real sights rather than gesturing at 'culture'.", blocks: ["includeSights", "includeAttractions"], hero: "explore" },
  { id: "family-trip", label: "Family trip", brief: "Planning a trip with family: setting the number of travellers and a total budget, and getting a paced day-by-day plan you can retime when the day runs long.", blocks: ["includeItineraries", "includePackages"], hero: "welcome" },
  { id: "plan-together", label: "Plan together", brief: "Planning with other people: share a trip by link and invite travel companions so everyone sees the same itinerary. Only these two sharing features exist — no chat, no comments, no group voting.", blocks: ["includeItineraries", "includeGuides"], hero: "welcome" },
  { id: "off-season", label: "Off-season value", brief: "Why the shoulder season is the smart booking window for a specific destination — thinner crowds and softer prices, backed only by real fares listed below.", blocks: ["includePackages", "includeAttractions"], hero: "explore" },
  { id: "city-compare", label: "Two cities compared", brief: "Two comparable destinations set side by side for the same season and budget, so the reader can pick one. Use destinations that actually appear in the deals, flight ideas or content listed below.", blocks: ["includeSights", "includeItineraries"], hero: "explore" },
];

/** Theme ids, for validating an admin-pinned choice. */
const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/**
 * Next angle for an audience: the first theme not used recently, else the one
 * used longest ago. `recentThemes` is newest-first.
 */
function nextTheme(recentThemes: string[]): (typeof THEMES)[number] {
  const unused = THEMES.filter((t) => !recentThemes.includes(t.id));
  if (unused.length) return unused[0];
  // Everything has been used — pick whichever appears latest in the
  // newest-first list, i.e. the least recently used.
  let best = THEMES[0];
  let bestIdx = -1;
  for (const t of THEMES) {
    const idx = recentThemes.indexOf(t.id);
    if (idx > bestIdx) { bestIdx = idx; best = t; }
  }
  return best;
}

/**
 * What the app actually does. The model has no other source of product truth,
 * so anything missing here it will happily invent — an early draft pitched a
 * free-text "just tell us what you want" chat box, which the app has never had.
 * Keep this in sync with the real product; it is the only thing standing
 * between a plausible-sounding feature and a subscriber discovering it does
 * not exist.
 */
const PRODUCT_FACTS = `PRODUCT TRUTH — the app works EXACTLY like this. Never describe it any other way:
- Trips are created by filling in a FORM, not by chatting. The traveller picks: origin city, destination, start and end dates, number of travellers, a total budget, optional arrival/departure times, and taps interest chips from a fixed list (local food, traditional markets, hidden gems, cultural workshops, nature & outdoors, nightlife, neighbourhood walks, festivals).
- Planera then generates a day-by-day itinerary with activities and times, which the traveller can edit: reorder days, move or retime activities, add and remove them.
- "Low-Fare Radar" is a curated list of live cheap flight deals. Tapping one opens a flight search / the airline or partner site to book. Planera does NOT sell or issue tickets itself.
- "Explore" holds ready-made destination itineraries and guides to browse for inspiration, plus top sights per destination (name, area, best time to visit).
- Some itinerary activities have "book a ticket" partner links (e.g. GetYourGuide) with real prices; booking happens on the partner's site, not inside Planera.
- Travel-agency partners list all-in holiday packages (flights + hotel style bundles) that open on the partner's own site.
- The app has trip sharing via link and trip invites for travel companions.

NEVER claim the app has, and never write copy that implies: a chat box, an AI assistant you type or talk to, free-text prompts like "I want four days in Rome with good food", voice input, photo input, in-app ticket or hotel booking and payment, live human agents, price-drop alerts or auto-rebooking, a loyalty or points scheme, or any feature not listed above. If a theme tempts you toward a feature that is not listed, write about the listed behaviour instead.`;

const SYSTEM_PROMPT = `You are a senior travel-marketing copywriter for Planera AI, an AI trip-planning app (AI itineraries, flight deals via "Low-Fare Radar", destination guides).

${PRODUCT_FACTS}

Write ONE short marketing newsletter email. Rules:
- Write ENTIRELY in the requested language, natural and native — never translated-sounding.
- Warm, concrete, energetic. No hype, no ALL CAPS, no spammy phrases ("ACT NOW", "100% FREE"), no fake urgency or invented discounts.
- Never invent prices, routes or offers. Only reference the live deals provided, if any.
- Never invent FEATURES. Every capability you describe must appear in PRODUCT TRUTH above. Do not quote an example of something a user "just says" or types to the app — there is nowhere to type it.
- subject: under 60 characters, specific, no emoji spam (at most one emoji).
- preheader: under 90 characters, complements the subject (never repeats it).
- heading: under 50 characters.
- para1: 1-2 sentences, the hook. para2: 1-2 sentences, the payoff.
- ctaText: 2-4 words, action-led.
- ctaUrl: MUST be one of https://planeraai.app , https://planeraai.app/deals , https://planeraai.app/explore
- includeDeals: true if the email should show live flight-deal cards under the copy, else false.
- dealCount: how many deal cards to show, 1-5. Use 3 unless the copy clearly calls for more or fewer. Ignored when includeDeals is false.
- CONTENT BLOCKS: besides deals, the email can append cards rendered from the REAL content listed in the user message (itineraries / attractions / packages). Rules:
    * Only set a block's include* flag to true if it is on the assigned theme's SUITED BLOCKS list in the user message AND matching content is listed below. 1-2 blocks maximum — an email with everything is an email about nothing.
    * The cards render automatically; do NOT restate their contents (titles, prices) in para1/para2. The copy should set them up, not duplicate them.
    * If you set a flightRoute below, the email is ABOUT that destination: itinerary, sights, attraction and package cards are then restricted to it, and a block with nothing there renders as nothing at all. So either pick a route matching the content listed below, or keep the email destination-free ("none").
- includeItineraries (true/false) + itineraryCount (1-3, default 2): ready-made destination guides from Explore.
- includeSights (true/false) + sightCount (1-5, default 3): top sights with a one-line description.
- includeAttractions (true/false) + attractionCount (1-4, default 3): bookable tickets/tours with real prices.
- includePackages (true/false) + packageCount (1-3, default 2): partner holiday packages with a from-price; skip for purely informational emails.
- includeGuides (true/false) + guideCount (1-3, default 2): short reading-list cards linking to Planera's travel guides (the available titles are listed in the user message).
- includeSpotlight (true/false): ONE large "trip of the week" feature card of the top Explore itinerary. Counts toward the 1-2 block budget like any other block.
- routeBlock ("calendar" | "teaser" | "none") + flightRoute ("ORIGIN-DEST" IATA pair copied EXACTLY from one of the live deals or flight ideas below, e.g. "ATH-LIS"):
    "calendar" appends a "cheapest days to fly" date/price strip for that route — fits flight-deals, route-spotlight, weekend-escape and seasonal themes.
    "teaser" appends a single "Flights to X — from €Y" price card — fits destination-inspiration.
    The prices are fetched live at send time, so do NOT quote them in para1/para2. Use "none" when nothing is listed or no route fits the theme.
- heroImage: a big photo at the top. When you set a flightRoute, the header is automatically swapped for a real photo of that destination, and your pick below is only the fallback — so choose the stock photo that fits the email, or "none" for no header photo at all:
    "flights" (planes / airport — fare and booking emails)
    "plan"    (maps / planning — AI itinerary emails)
    "explore" (landscapes / discovery — destination and community emails)
    "welcome" (warm, general-purpose)
    "none"    (no image — best for short, text-led emails)
- banner: an optional partner banner under the content, or "none":
    "tripcom" (flights + hotels + packages — broad travel intent)
    "kiwi"    (cheap flights — price-led emails)
    "welcome" (airport transfers — arrival/destination emails)
    "lot"     (LOT Polish Airlines — Warsaw hub, Europe/USA/Asia routes — airline and route-spotlight emails)
    "airserbia" (Air Serbia — Belgrade hub, Balkans + new 2026 routes — airline and route-spotlight emails)
    "none"    (no banner — use this when the email is already busy, or purely informational)
  Choose it only when it genuinely fits the email's subject; a mismatched banner cheapens the email.
- suggestedSendAt: ISO-8601 UTC timestamp for the best moment to send, between 2 days and 10 days from now. Prefer Tuesday-Thursday, 09:00-11:00 in the audience's local time.
- sendRationale: one short English sentence (for the admin, not the reader) explaining the timing choice.

VARIETY IS CRITICAL. This audience receives an email every few days, so a repeat is worse than a weak one:
- Write to the ASSIGNED THEME given below, and nothing else.
- The previous emails are listed below. Do NOT reuse their subject lines, opening words, angle, metaphors, or CTA wording — not even reworded.
- Vary the structure too: if a previous email opened with a question, don't open with a question; if it led with a price, lead with a place or an idea instead.

Return ONLY a JSON object with exactly these keys:
subject, preheader, heading, para1, para2, ctaText, ctaUrl, includeDeals, dealCount, includeItineraries, itineraryCount, includeSights, sightCount, includeAttractions, attractionCount, includePackages, packageCount, includeGuides, guideCount, includeSpotlight, routeBlock, flightRoute, heroImage, banner, suggestedSendAt, sendRationale`;

// ---------------------------------------------------------------------------
// Internal data access
// ---------------------------------------------------------------------------

/**
 * Which languages to generate for: those with confirmed subscribers, minus any
 * that already have an un-actioned (pending_approval / scheduled) draft.
 *
 * `allowStacking` drops `scheduled` from that exclusion, so a language whose
 * only open campaign is already booked for a future date is generated again.
 * The cron leaves it off (unattended runs shouldn't pile up drafts); the admin
 * "Generate now" button turns it on, since queueing several upcoming dates in
 * a row is exactly what that button is for.
 */
export const getGenerationTargets = internalQuery({
  args: { allowStacking: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const counts: Record<string, number> = {};
    for (const s of active) {
      const lang = normalizeLang(s.language);
      counts[lang] = (counts[lang] ?? 0) + 1;
    }

    const blocking = args.allowStacking
      ? (["pending_approval"] as const)
      : (["pending_approval", "scheduled"] as const);
    const busy = new Set<string>();
    for (const status of blocking) {
      const rows = await ctx.db
        .query("newsletterCampaigns")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const c of rows) busy.add(c.languageFilter ?? "");
    }

    // Recent campaigns per language (newest-first) so the generator can avoid
    // repeating itself and rotate to a fresh theme.
    const recentRows = await ctx.db
      .query("newsletterCampaigns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(80);

    const recent: Record<string, Array<{ subject: string; heading: string; theme?: string }>> = {};
    for (const c of recentRows) {
      const lang = c.languageFilter ?? "";
      const bucket = (recent[lang] ??= []);
      if (bucket.length < HISTORY_DEPTH) {
        bucket.push({ subject: c.subject, heading: c.heading, theme: c.theme });
      }
    }

    return {
      languages: Object.entries(counts)
        .filter(([lang]) => !busy.has(lang))
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => ({ lang, count })),
      recent,
    };
  },
});

/** Persist a generated draft awaiting admin approval. */
export const insertAiCampaign = internalMutation({
  args: {
    subject: v.string(),
    preheader: v.string(),
    heading: v.string(),
    para1: v.string(),
    para2: v.optional(v.string()),
    ctaText: v.string(),
    ctaUrl: v.string(),
    includeDeals: v.boolean(),
    dealCount: v.optional(v.float64()),
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
    routes: v.optional(v.array(v.object({
      origin: v.string(),
      destination: v.string(),
      originCity: v.string(),
      destinationCity: v.string(),
      currency: v.optional(v.string()),
      outboundDate: v.optional(v.string()),
      returnDate: v.optional(v.string()),
    }))),
    routeBlock: v.optional(v.union(v.literal("calendar"), v.literal("teaser"))),
    routeOrigin: v.optional(v.string()),
    routeDestination: v.optional(v.string()),
    routeOriginCity: v.optional(v.string()),
    routeOutboundDate: v.optional(v.string()),
    routeReturnDate: v.optional(v.string()),
    routeDestinationCity: v.optional(v.string()),
    routeCurrency: v.optional(v.string()),
    heroImg: v.optional(v.string()),
    bannerKey: v.optional(v.string()),
    languageFilter: v.string(),
    scheduledAt: v.float64(),
    sendRationale: v.optional(v.string()),
    aiModel: v.string(),
    theme: v.string(),
  },
  returns: v.id("newsletterCampaigns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("newsletterCampaigns", {
      ...args,
      status: "pending_approval",
      generatedByAi: true,
      createdBy: "ai",
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Validation of the model's output
// ---------------------------------------------------------------------------

function cap(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/** Clamp the AI's suggested send time into a sane future window. */
function resolveSendAt(raw: unknown): number {
  const now = Date.now();
  const fallback = now + 2 * 24 * 60 * 60 * 1000; // +2 days
  if (typeof raw !== "string") return fallback;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return fallback;
  if (ts < now + MIN_LEAD_MS) return now + MIN_LEAD_MS;
  if (ts > now + MAX_LEAD_MS) return fallback;
  return ts;
}

function resolveCtaUrl(raw: unknown, route?: RoutePin): string {
  const url = typeof raw === "string" ? raw.trim() : "";
  const safe = url.startsWith(ALLOWED_CTA_PREFIX) ? url : DEFAULT_CTA_URL;
  if (route && safe === DEFAULT_CTA_URL) {
    return routeSearchUrl({
      originCity: route.routeOriginCity,
      destinationCity: route.routeDestinationCity,
      origin: route.routeOrigin,
      destination: route.routeDestination,
    });
  }
  return safe;
}

/** Hero image key → hosted URL. Anything unrecognised means "no image". */
function resolveHeroImg(raw: unknown): string | undefined {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return HERO_IMAGES[key];
}

/** Affiliate banner key, validated against the CJ creative set. */
function resolveBannerKey(raw: unknown): string | undefined {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return key in CJ_BANNERS ? key : undefined;
}

/** Deal-card count, clamped to a sane 1-5. */
function resolveDealCount(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : 3;
  return Math.min(5, Math.max(1, Number.isFinite(n) ? n : 3));
}

/** Generic block count, clamped to [1, hi] with a per-block default. */
function resolveCount(raw: unknown, def: number, hi: number): number {
  const n = typeof raw === "number" ? Math.round(raw) : def;
  return Math.min(hi, Math.max(1, Number.isFinite(n) ? n : def));
}

/**
 * Block flag: on only if the model asked, the sample list we showed it is
 * non-empty, AND the block belongs to the assigned theme.
 *
 * Availability alone was not enough: the model sees real content for every
 * block on every run, so nothing stopped a packing-tips email from appending
 * holiday packages. `suited` is the theme's own list — the same one the prompt
 * shows — which keeps the email on the angle the admin picked.
 */
function resolveFlag(raw: unknown, available: number, suited = true): boolean {
  return raw === true && available > 0 && suited;
}

/**
 * A route the model is allowed to build a route block on: either a live
 * curated deal or an admin-searched flight idea. Both carry the display cities
 * and currency, so nothing about the route is ever inventable.
 */
type RouteCandidate = Pick<
  DealForEmail,
  "origin" | "destination" | "originCity" | "destinationCity" | "currency"
>;

/**
 * "ATH-LIS" → ["ATH","LIS"]. Anything that isn't a pair of IATA codes is not a
 * route claim at all — which is different from a WRONG claim, and the caller
 * treats the two differently.
 */
function parseRoutePair(raw: unknown): RegExpMatchArray | null {
  return typeof raw === "string"
    ? raw.trim().toUpperCase().match(/^([A-Z]{3})\s*[-–>→]+\s*([A-Z]{3})$/)
    : null;
}

/** A resolved route pin. `routeBlock` is absent when the model asked for no block. */
type RoutePin = {
  routeBlock?: "calendar" | "teaser";
  routeOrigin: string;
  routeDestination: string;
  routeOriginCity: string;
  routeDestinationCity: string;
  routeCurrency: string;
  /** Dates the route was picked for, when it came from a targeted search. */
  routeOutboundDate?: string;
  routeReturnDate?: string;
};

/**
 * Route pin: only accepted when the model's "ORIGIN-DEST" pair matches one of
 * the offered routes exactly — a hallucinated route never reaches a campaign.
 * The matched route supplies the display cities and currency, so those can't
 * be invented either.
 *
 * The block KIND is resolved separately from the route, because the two mean
 * different things: the route pins what the email is about (it also focuses
 * the itinerary/sights/attraction blocks), while the kind only decides whether
 * a live-price strip is appended. The caller decides what an absent kind means.
 */
function resolveRoute(
  rawKind: unknown,
  rawRoute: unknown,
  candidates: RouteCandidate[],
): RoutePin | undefined {
  const kind = rawKind === "calendar" || rawKind === "teaser" ? rawKind : undefined;
  const m = parseRoutePair(rawRoute);
  if (!m) return undefined;
  const route = candidates.find(
    (d) => d.origin?.toUpperCase() === m[1] && d.destination?.toUpperCase() === m[2],
  );
  if (!route) return undefined;
  return {
    ...(kind ? { routeBlock: kind } : {}),
    routeOrigin: m[1],
    routeDestination: m[2],
    routeOriginCity: route.originCity,
    routeDestinationCity: route.destinationCity,
    routeCurrency: route.currency,
  };
}

// ---------------------------------------------------------------------------
// Admin-facing metadata + live flight search
//
// The cron generates on autopilot: rotate the theme, use whatever curated
// deals exist. The admin "Generate now" dialog can do better — pin a theme and
// hand the generator a set of routes discovered with a LIVE searchapi.io
// search, so a draft can be about anywhere we can actually fly to, not only
// the handful of routes currently sitting in Low-Fare Radar.
//
// Flight ideas are DISCOVERY signals, not bookable fares (same caveat as the
// Explore grid in the app). They therefore never render as deal cards and the
// prompt forbids quoting their prices; their only structural use is as a
// whitelist for the route block, whose prices are re-fetched at send time.
// ---------------------------------------------------------------------------

/** Token -> admin check for the query context in this file. */
async function requireAdminQuery(ctx: any, token: string): Promise<void> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new Error("Unauthorized");
  await assertAdmin(ctx, session.userId);
}

/**
 * The theme catalogue for the admin dialog. Lives here rather than being
 * duplicated in the web admin so the picker and the generator can never drift
 * apart — a theme id the UI offers is always one the generator accepts.
 */
export const listThemes = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({ id: v.string(), label: v.string(), brief: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireAdminQuery(ctx, args.token);
    return THEMES.map((t) => ({ id: t.id, label: t.label, brief: t.brief }));
  },
});

/** One discovered route the generator may write about. */
const flightIdeaValidator = v.object({
  origin: v.string(),
  originCity: v.string(),
  destination: v.string(),
  destinationCity: v.string(),
  country: v.optional(v.string()),
  price: v.optional(v.float64()),
  currency: v.string(),
  outboundDate: v.optional(v.string()),
  returnDate: v.optional(v.string()),
  airline: v.optional(v.string()),
  stops: v.optional(v.float64()),
  flightDuration: v.optional(v.string()),
  avgHotelPerNight: v.optional(v.float64()),
});

export type FlightIdea = {
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  country?: string;
  price?: number;
  currency: string;
  outboundDate?: string;
  returnDate?: string;
  airline?: string;
  stops?: number;
  flightDuration?: string;
  avgHotelPerNight?: number;
};

const IATA_RE = /^[A-Z]{3}$/;

/** Trimmed, upper-cased IATA code, or undefined when it isn't one. */
function asIata(raw: unknown): string | undefined {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return IATA_RE.test(code) ? code : undefined;
}

/**
 * Live route discovery for the admin dialog.
 *
 * With no `destination` this is the Explore grid — "where can I fly from ATH,
 * and roughly for how much" — which is what makes a genuinely different
 * newsletter possible each time. With a `destination` it is the single-route
 * teaser, for when the admin already knows what they want to write about.
 *
 * Both paths go through the SAME cache the app uses, so repeated searches
 * while composing cost nothing extra.
 */
export const searchFlightIdeas = action({
  args: {
    token: v.string(),
    origin: v.string(),
    destination: v.optional(v.string()),
    currency: v.optional(v.string()),
    interests: v.optional(
      v.union(
        v.literal("popular"),
        v.literal("outdoors"),
        v.literal("beaches"),
        v.literal("museums"),
        v.literal("history"),
        v.literal("skiing"),
      ),
    ),
    stops: v.optional(
      v.union(
        v.literal("any"),
        v.literal("nonstop"),
        v.literal("one_stop_or_fewer"),
        v.literal("two_stops_or_fewer"),
      ),
    ),
    maxPrice: v.optional(v.float64()),
    timePeriod: v.optional(v.string()),
    limit: v.optional(v.float64()),
  },
  returns: v.object({
    origin: v.string(),
    originCity: v.string(),
    currency: v.string(),
    ideas: v.array(flightIdeaValidator),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    origin: string;
    originCity: string;
    currency: string;
    ideas: FlightIdea[];
    reason?: string;
  }> => {
    // Throws unless the caller is an admin.
    await ctx.runQuery(internal.newsletterCampaigns.resolveAdminEmail, {
      token: args.token,
    });

    const origin = asIata(args.origin);
    if (!origin) {
      throw new Error("Enter the departure airport as a 3-letter IATA code, e.g. ATH.");
    }
    const originCity = airportCityName(origin) ?? origin;
    const currency = (args.currency || "EUR").trim().toUpperCase();
    const limit = Math.min(24, Math.max(1, Math.round(args.limit ?? 12)));
    const destination = asIata(args.destination);

    // Single route: the destination teaser, collapsed to its cheapest option.
    if (destination) {
      if (destination === origin) {
        throw new Error("Origin and destination must be different airports.");
      }
      const teaser: any = await ctx.runAction(
        internal.exploreDestination.fetchTeaserForCampaign,
        { departureId: origin, arrivalId: destination, currency },
      );
      const flights: any[] = Array.isArray(teaser?.flights) ? teaser.flights : [];
      const cheapest = flights
        .filter((f) => typeof f?.price === "number" && f.price > 0)
        .sort((a, b) => a.price - b.price)[0];
      if (!cheapest && teaser?.cheapestPrice == null) {
        return {
          origin,
          originCity,
          currency,
          ideas: [],
          reason:
            `No live fares came back for ${origin}-${destination}. Check the codes, or ` +
            `search without a destination to see where else you can fly from ${origin}.`,
        };
      }
      return {
        origin,
        originCity,
        currency,
        ideas: [
          {
            origin,
            originCity,
            destination,
            destinationCity: airportCityName(destination) ?? destination,
            price: cheapest?.price ?? teaser?.cheapestPrice ?? undefined,
            currency: teaser?.currency ?? currency,
            outboundDate: cheapest?.outboundDate,
            returnDate: cheapest?.returnDate,
            airline: cheapest?.airline,
            stops: cheapest?.stops,
            flightDuration: cheapest?.flightDuration,
          },
        ],
      };
    }

    // Discovery grid: everywhere reachable from this origin.
    const destinations: any[] = await ctx.runAction(
      internal.explore.exploreForCampaign,
      {
        input: {
          departureId: origin,
          currency,
          // The grid is only ever read by us and by the model, both of which
          // work in English — a localized copy per audience language would
          // just fragment the shared cache for no gain.
          hl: "en-US",
          ...(args.interests ? { interests: args.interests } : {}),
          ...(args.stops ? { stops: args.stops } : {}),
          ...(args.maxPrice ? { maxPrice: args.maxPrice } : {}),
          ...(args.timePeriod?.trim() ? { timePeriod: args.timePeriod.trim() } : {}),
        },
      },
    );

    const ideas: FlightIdea[] = [];
    for (const d of destinations) {
      // A route block keys off IATA codes, and a price is what makes the idea
      // worth showing at all — anything missing either is not an idea we can
      // act on, so it never reaches the admin or the model.
      const iata = asIata(d?.iata);
      if (!iata || iata === origin) continue;
      const price = typeof d?.price === "number" && d.price > 0 ? d.price : undefined;
      if (!price) continue;
      if (ideas.some((i) => i.destination === iata)) continue;
      ideas.push({
        origin,
        originCity,
        destination: iata,
        // The Explore grid names DESTINATIONS, not airport cities: CDG comes
        // back as "Versailles", NCE as "Provence". Left as-is that name became
        // the campaign's pinned city — so the email was headed "Athens →
        // Versailles", the content blocks hunted for Versailles itineraries,
        // and the hero photo was of the palace rather than Paris. The
        // airport's own city is the honest label for a flight that lands
        // there; the engine's name is the fallback for an airport we don't
        // know.
        destinationCity: airportCityName(iata) ?? (typeof d?.name === "string" ? d.name : iata),
        country: typeof d?.country === "string" ? d.country : undefined,
        price,
        currency,
        outboundDate: typeof d?.outboundDate === "string" ? d.outboundDate : undefined,
        returnDate: typeof d?.returnDate === "string" ? d.returnDate : undefined,
        airline: typeof d?.airline === "string" ? d.airline : undefined,
        stops: typeof d?.stops === "number" ? d.stops : undefined,
        flightDuration:
          typeof d?.flightDuration === "string" ? d.flightDuration : undefined,
        avgHotelPerNight:
          typeof d?.avgHotelPerNight === "number" ? d.avgHotelPerNight : undefined,
      });
    }
    ideas.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    if (!ideas.length) {
      // The Explore engine answers "no results" for plenty of legitimate
      // filter combinations, and the bare error in the logs doesn't say which
      // one — so record exactly what was asked for.
      console.warn(
        `[newsletterAi] no flight ideas for ${origin} ` +
        `(interests=${args.interests ?? "any"}, stops=${args.stops ?? "any"}, ` +
        `maxPrice=${args.maxPrice ?? "none"}, timePeriod=${args.timePeriod || "default"}, ` +
        `currency=${currency}) — ${destinations.length} raw destination(s) came back`,
      );
    }

    return {
      origin,
      originCity,
      currency,
      ideas: ideas.slice(0, limit),
      reason: ideas.length
        ? undefined
        : `No destinations came back for ${origin}. Check the airport code, raise the ` +
          `price cap, or try again — the provider occasionally returns nothing at all.`,
    };
  },
});

/** Route cards one email may carry — mirrors MAX_CAMPAIGN_ROUTES in the renderer. */
const MAX_CAMPAIGN_ROUTES = 5;

/** Which live-price source has fares for a route, if any. */
type FareKind = "calendar" | "teaser";

/** `ATH-BCN`, the key every fare lookup is filed under. */
function routeKey(r: { origin: string; destination: string }): string {
  return `${r.origin}-${r.destination}`;
}

/**
 * Ask both price engines about one route and report which has fares.
 *
 * The two have different coverage and neither is a superset: the destination
 * teaser is city-oriented and comes back empty for ordinary airport pairs
 * (ATH-CDG among them), while the calendar is a real route search. They are
 * also plainly FLAKY — ATH-VCE and ATH-BCN both answered "no results" once and
 * returned fares on the next call ninety seconds later — so a single empty
 * answer is retried before a route is written off. Only non-empty responses
 * are cached, so the retry is a genuine second look, not a cache replay.
 */
async function resolveFareKind(
  ctx: any,
  route: FlightIdea,
  lang: string,
): Promise<FareKind | null> {
  const base = {
    departureId: route.origin,
    arrivalId: route.destination,
    currency: route.currency,
  };
  // Price the window the route was FOUND in. The search may have been for a
  // week in October; quoting the next fortnight instead is how an October
  // email ended up showing September dates.
  const window = routePriceWindow(route);

  const calendarHasFares = async (): Promise<boolean> => {
    const cal: any = await ctx.runAction(internal.flightCalendar.fetchForCampaign, {
      ...base,
      startOffsetDays: window.startOffsetDays,
      returnGapDays: window.returnGapDays,
    });
    return (cal?.dates ?? []).some((d: any) => d?.price > 0);
  };
  // `hl` is part of the teaser cache key, so warming it with the campaign's
  // language is what makes the admin preview a hit rather than a miss.
  const teaserHasFares = async (): Promise<boolean> => {
    const teaser: any = await ctx.runAction(internal.exploreDestination.fetchTeaserForCampaign, {
      ...base,
      hl: lang,
      timePeriod: window.timePeriod,
    });
    return (
      teaser?.cheapestPrice != null ||
      (teaser?.flights ?? []).some((f: any) => typeof f?.price === "number" && f.price > 0)
    );
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (await calendarHasFares()) return "calendar";
    if (await teaserHasFares()) return "teaser";
    if (attempt === 1) {
      console.warn(`[newsletterAi] ${routeKey(route)} came back empty — retrying once`);
    }
  }
  return null;
}

/**
 * Resolve fares for every attached route ONCE per run, before any copy is
 * written.
 *
 * Two reasons this happens up front rather than after the draft. First, the
 * copy must name exactly the destinations that will show a price — an email
 * headlined "Venice, London and Barcelona" with a single London card is worse
 * than one that only promises London. Second, a calendar lookup takes ~25s, so
 * asking per language both doubled the wait and let two languages disagree
 * about which routes had fares.
 *
 * Runs the routes concurrently: five parallel lookups is a trivial burst for
 * the provider, where five sequential ones is two minutes of spinner.
 */
async function resolveRouteFares(
  ctx: any,
  ideas: FlightIdea[],
  lang: string,
): Promise<Map<string, FareKind>> {
  const resolved = new Map<string, FareKind>();
  const kinds = await Promise.all(
    ideas.map((i) => resolveFareKind(ctx, i, lang).catch(() => null)),
  );
  ideas.forEach((i, idx) => {
    const kind = kinds[idx];
    if (kind) resolved.set(routeKey(i), kind);
    else console.warn(`[newsletterAi] no live fare for ${routeKey(i)} — route dropped`);
  });
  return resolved;
}

/**
 * One chat round-trip: returns the parsed JSON draft, or null when OpenAI
 * refused, timed out on content, or answered with something unparseable.
 * Kept separate from the generation loop so a rejected draft can simply be
 * asked for again with a corrective turn appended.
 */
async function requestDraft(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  lang: string,
): Promise<any | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      // No `temperature`: the gpt-5.6 family rejects it (same reason no other
      // OpenAI call in this repo sets it). Budget is generous because
      // reasoning tokens count toward this limit — too low and the JSON comes
      // back truncated.
      max_completion_tokens: 2000,
      messages,
    }),
  });

  if (!response.ok) {
    // Surface OpenAI's own message — "Incorrect API key provided" vs "model
    // not found" vs a quota error are very different fixes, and the bare
    // status code hides which one it is.
    const detail = await response.text().catch(() => "");
    console.error(
      `[newsletterAi] OpenAI ${response.status} for "${lang}" (model=${MODEL}): ${detail.slice(0, 500)}`,
    );
    return null;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    console.error(`[newsletterAi] unparseable JSON for "${lang}"`);
    return null;
  }
}

/**
 * One prompt line per idea. Prices are shown to the model so it can judge
 * which destination is worth writing about — the SYSTEM_PROMPT forbids
 * repeating them in the copy.
 */
function ideaLine(i: FlightIdea): string {
  const price = i.price ? ` ~${Math.round(i.price)} ${i.currency}` : "";
  const dates = i.outboundDate
    ? ` (${i.outboundDate}${i.returnDate ? ` to ${i.returnDate}` : ""})`
    : "";
  const hotel = i.avgHotelPerNight
    ? `, hotels ~${Math.round(i.avgHotelPerNight)} ${i.currency}/night`
    : "";
  const country = i.country ? `, ${i.country}` : "";
  return `- [${i.origin}-${i.destination}] ${i.originCity} to ${i.destinationCity}${country}:${price}${dates}${hotel}`;
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

/**
 * `reason` explains a zero-draft run so the admin UI can say why; `themes`
 * lists the angle each draft was written to, so the dialog can confirm what it
 * actually produced rather than just a count.
 */
type GenerationResult = {
  generated: number;
  skipped: number;
  reason?: string;
  themes?: string[];
};

export const generateAiCampaigns = internalAction({
  args: {
    allowStacking: v.optional(v.boolean()),
    // Pin the angle instead of rotating (admin dialog). An unknown id falls
    // back to the rotation rather than failing the run.
    themeId: v.optional(v.string()),
    // Restrict the run to these audience languages; empty/absent means every
    // language that has subscribers.
    languages: v.optional(v.array(v.string())),
    // Routes discovered by `searchFlightIdeas`, offered to the model as
    // destinations worth writing about and as route-block candidates.
    flightIdeas: v.optional(v.array(flightIdeaValidator)),
  },
  returns: v.object({
    generated: v.float64(),
    skipped: v.float64(),
    reason: v.optional(v.string()),
    themes: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args): Promise<GenerationResult> => {
    // Trimmed: a stray newline/space pasted into the dashboard env var makes
    // the Authorization header malformed and OpenAI answers 401.
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      console.error("[newsletterAi] OPENAI_API_KEY not set — skipping generation");
      return { generated: 0, skipped: 0, reason: "OPENAI_API_KEY is not set." };
    }

    const targets: {
      languages: Array<{ lang: string; count: number }>;
      recent: Record<string, Array<{ subject: string; heading: string; theme?: string }>>;
    } = await ctx.runQuery(internal.newsletterAi.getGenerationTargets, {
      allowStacking: args.allowStacking,
    });
    if (!targets.languages.length) {
      return {
        generated: 0,
        skipped: 0,
        reason:
          "No language needs a draft — every audience either has no confirmed " +
          "subscribers or already has a draft awaiting approval.",
      };
    }

    // Admin can narrow the run to one audience (e.g. "a Greek one, about
    // food"). Languages that are filtered out here were still generatable —
    // they just weren't asked for.
    // Not `normalizeLang`: that maps anything unrecognised onto "en", so a
    // stale code from the UI would silently generate an English draft instead
    // of none.
    const wanted = new Set<string>(
      (args.languages ?? [])
        .map((l) => (l || "").trim().toLowerCase().split("-")[0])
        .filter((l) => l in LANG_NAMES),
    );
    const languages = wanted.size
      ? targets.languages.filter((t) => wanted.has(t.lang))
      : targets.languages;
    if (!languages.length) {
      return {
        generated: 0,
        skipped: 0,
        reason:
          "The selected language has no confirmed subscribers, or already has a " +
          "draft awaiting approval. Approve or reject that one first.",
      };
    }

    // An unknown id (a stale UI, a renamed theme) rotates as usual rather than
    // failing the run — a draft on the wrong angle beats no draft at all.
    const pinnedTheme = args.themeId ? THEME_BY_ID.get(args.themeId) : undefined;

    // Discovered routes are shared across languages: the search is per origin,
    // not per audience. Attaching them is a DIRECTIVE, not a hint — an admin
    // who ticked two routes wants an email about those routes, so the draft is
    // rejected below unless it comes back pinned to one of them.
    const attachedIdeas: FlightIdea[] = ((args.flightIdeas ?? []) as FlightIdea[]).slice(
      0,
      MAX_CAMPAIGN_ROUTES,
    );

    // Which of the ticked routes can actually carry a price, resolved once for
    // the whole run (see `resolveRouteFares`). Priced routes are what the copy
    // is allowed to promise; if NONE of them price, the admin's picks are still
    // the email's subject — they just arrive without cards.
    const fareKinds = attachedIdeas.length
      ? await resolveRouteFares(ctx, attachedIdeas, languages[0].lang)
      : new Map<string, FareKind>();
    const pricedIdeas = attachedIdeas.filter((i) => fareKinds.has(routeKey(i)));
    const flightIdeas = pricedIdeas.length ? pricedIdeas : attachedIdeas;

    // Fare cards are the multi-route rendering. A single surviving route is
    // better served by the pinned route block, which also focuses the rest of
    // the email on that destination.
    const campaignRoutes =
      pricedIdeas.length > 1
        ? pricedIdeas.map((i) => ({
            origin: i.origin,
            destination: i.destination,
            originCity: i.originCity,
            destinationCity: i.destinationCity,
            currency: i.currency,
            // Carried so every later price lookup — preview, social deck, send
            // — asks about the same dates this route was chosen for.
            outboundDate: i.outboundDate,
            returnDate: i.returnDate,
          }))
        : undefined;

    const ideaLines = flightIdeas.map(ideaLine).join("\n");
    const requiredRoutes = flightIdeas
      .map((i) => `${i.origin}-${i.destination} (${i.destinationCity})`)
      .join(", ");

    // Live deals give the copy something real to reference.
    const allDeals: DealForEmail[] = await ctx.runQuery(
      internal.newsletter.getFeaturedDeals,
      {},
    );
    const dealLines = allDeals
      .slice(0, 6)
      .map((d) => {
        // Typical-price context lets the copy make honest "well under the
        // usual fare" claims; the route code feeds the flightRoute picker.
        const typical =
          d.typicalPrice && d.typicalPrice > d.price
            ? `, typically ~${Math.round(d.typicalPrice)} ${d.currency}`
            : "";
        return (
          `- [${d.origin}-${d.destination}] ${d.originCity} → ${d.destinationCity}: ` +
          `${Math.round(d.price)} ${d.currency}${d.returnDate ? " (round trip)" : " (one way)"}${typical}`
        );
      })
      .join("\n");

    let generated = 0;
    let skipped = 0;
    const themesUsed: string[] = [];

    for (const { lang, count } of languages) {
      const langName = LANG_NAMES[lang] ?? "English";
      const history = targets.recent[lang] ?? [];
      const theme =
        pinnedTheme ?? nextTheme(history.map((h) => h.theme ?? "").filter(Boolean));

      // Real content this audience could be shown, so the model writes toward
      // cards that will actually render — and never has to invent. Country
      // bias is best-effort; global content is the fallback, not an error.
      const likelyCountry = LANG_TO_LIKELY_COUNTRY[lang];
      const [itins, attrs, pkgs]: [ItineraryForEmail[], AttractionForEmail[], PackageForEmail[]] =
        await Promise.all([
          ctx.runQuery(internal.newsletter.getFeaturedItineraries, { country: likelyCountry, max: 3 }),
          ctx.runQuery(internal.newsletter.getFeaturedAttractions, { country: likelyCountry, max: 4 }),
          ctx.runQuery(internal.newsletter.getFeaturedPackages, { country: likelyCountry, max: 3 }),
        ]);

      // Guides are constants (bilingual landing pages), picked with the same
      // weekly rotation the renderer uses so the model sees the exact titles
      // that would render.
      const guides = pickGuides(lang, 3, likelyCountry);

      const contentLines = [
        itins.length
          ? `Explore itineraries that would render as cards (set includeItineraries to use; the FIRST one is what includeSpotlight would feature):\n` +
            itins.map((i) => `- "${i.title}" — ${i.destination}, ${Math.round(i.durationDays)} days, ${i.budgetLevel}`).join("\n")
          : `No Explore itineraries are available — includeItineraries and includeSpotlight MUST be false.`,
        guides.length
          ? `Travel guides that would render as reading cards (set includeGuides to use):\n` +
            guides.map((g) => `- "${g.title}"`).join("\n")
          : `No travel guides are available — includeGuides MUST be false.`,
        attrs.length
          ? `Bookable attractions that would render as cards (set includeAttractions to use):\n` +
            attrs.map((a) => `- "${a.displayTitle}" — ${a.destinationCity}${a.price != null && a.currency ? `, from ${Math.round(a.price)} ${a.currency}` : ""}`).join("\n")
          : `No bookable attractions are available — includeAttractions MUST be false.`,
        pkgs.length
          ? `Partner holiday packages that would render as cards (set includePackages to use):\n` +
            pkgs.map((p) => `- "${p.title}" — ${[p.destinationCity, p.destinationCountry].filter(Boolean).join(", ")}, from ${Math.round(p.priceFrom)} ${p.priceCurrency}`).join("\n")
          : `No partner packages are available — includePackages MUST be false.`,
        `Top-sights lists exist for recently planned destinations; includeSights may be true only for a destination-focused email.`,
      ].join("\n\n");

      // Deals and attached ideas are both legitimate route sources; a
      // hallucinated third route still can't get through.
      const routeCandidates: RouteCandidate[] = [...allDeals, ...flightIdeas];

      const historyBlock = history.length
        ? `Previous emails to THIS audience (newest first) — do not repeat any of these:\n` +
          history.map((h, i) => `${i + 1}. "${h.subject}" — ${h.heading}`).join("\n") +
          `\n`
        : `This is the first email to this audience.\n`;

      const userPrompt =
        `Today is ${new Date().toISOString().slice(0, 10)} (UTC).\n` +
        `Target language: ${langName}.\n` +
        `Audience: ${count} opted-in subscriber(s) of Planera AI.\n\n` +
        `ASSIGNED THEME: ${theme.id} — ${theme.brief}\n` +
        `SUITED BLOCKS for this theme (still 1-2 maximum, and only when the matching ` +
        `content is listed below): ${theme.blocks.join(", ")}. Leave every other block false.\n` +
        `Suggested heroImage for this theme: ${theme.hero} (override only if the copy clearly ` +
        `calls for another).` +
        (flightIdeas.length
          ? ` Apply this angle TO the required destination below — the theme is the ANGLE, the required route is the SUBJECT.`
          : "") +
        `\n\n` +
        (flightIdeas.length === 1
          ? `REQUIRED SUBJECT MATTER — not optional. The marketing team picked this route from ` +
            `a live flight search, and this email is about it and nothing else:\n` +
            `${ideaLines}\n` +
            `- Build the entire email around that destination, in the voice of the assigned theme. ` +
            `If the theme implies several destinations (e.g. comparing two cities), apply its ` +
            `angle to this one instead — the route wins.\n` +
            `- You MUST return flightRoute as that route's exact ORIGIN-DEST code, and routeBlock ` +
            `"calendar" or "teaser". A draft about any other destination is rejected outright.\n` +
            `- The fare above is INDICATIVE: never quote a price, date or airline from it in the ` +
            `copy. The route block fetches real prices at send time.\n\n`
          : flightIdeas.length
            ? `REQUIRED SUBJECT MATTER — not optional. The marketing team picked these ` +
              `${flightIdeas.length} routes from a live flight search, and this email is about ` +
              `ALL of them together:\n` +
              `${ideaLines}\n` +
              (campaignRoutes
                ? `- A fare card for EVERY route above is appended to the email automatically, ` +
                  `each with a live price. So write copy that sets up the whole set — a short ` +
                  `round-up in the voice of the assigned theme — and do NOT list the routes or ` +
                  `their prices in para1/para2; the cards already do that.\n`
                : `- No price cards will render this time, so the copy carries the whole email: ` +
                  `name the destinations, and never imply a specific fare.\n`) +
              `- Name the destinations in the subject/heading only if two or three fit naturally.\n` +
              `- If the assigned theme implies a different NUMBER of destinations (one route to ` +
              `spotlight, two to compare), the routes above win — apply the theme's angle across ` +
              `the whole set.\n` +
              `- Set flightRoute to whichever route you lead with (exact ORIGIN-DEST code from ` +
              `the list) and routeBlock to "none" — a single-route strip on top of the fare cards ` +
              `would just repeat one of them.\n` +
              `- The fares above are INDICATIVE: never quote a price, date or airline in the copy.\n\n`
            : "") +
        historyBlock +
        `\n` +
        (dealLines
          ? (flightIdeas.length
              ? `Curated Low-Fare Radar deals — these are INVENTORY for the deal cards only. The ` +
                `email must NOT be about them; if none of them serve the required destination, ` +
                `set includeDeals to false:\n${dealLines}\n`
              : `Live flight deals you may reference (do NOT invent others):\n${dealLines}\n`)
          : `There are no live flight deals right now — do not mention specific prices, and set includeDeals to false.\n`) +
        `\n${contentLines}\n`;

      try {
        const messages: Array<{ role: string; content: string }> = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ];

        // With routes attached the draft has one more thing to get right, and
        // the cheapest way to fix a model that wandered off is to tell it so
        // and ask once more. Without them a single call is the whole flow, as
        // before.
        let p: any = null;
        let routePin: RoutePin | undefined;
        for (let attempt = 1; attempt <= (flightIdeas.length ? 2 : 1); attempt++) {
          const draft = await requestDraft(apiKey, messages, lang);
          if (!draft) break;
          const pin = resolveRoute(draft.routeBlock, draft.flightRoute, routeCandidates);

          if (!flightIdeas.length) {
            // Unattached runs keep the original contract: a route only counts
            // when the model also asked for a block, so a stray flightRoute
            // can't silently narrow every content block to one city.
            p = draft;
            routePin = pin?.routeBlock ? pin : undefined;
            break;
          }

          // Is the draft on the routes the admin ticked?
          //
          // With ONE route the model must name it: that route is the email's
          // whole subject, and a draft that named something else wandered off.
          //
          // With SEVERAL, the fare cards are attached server-side and the copy
          // is a round-up, so we told the model to lead with one and it may
          // reasonably name none at all. Silence is therefore fine — only a
          // route from OUTSIDE the ticked set means it drifted.
          const named = parseRoutePair(draft.flightRoute);
          const namedIsAttached =
            !!named &&
            flightIdeas.some((i) => i.origin === named[1] && i.destination === named[2]);
          const onTarget =
            flightIdeas.length === 1
              ? !!pin && namedIsAttached
              : !named || namedIsAttached;
          if (onTarget) {
            p = draft;
            // One route: pin it, which also focuses the content blocks and the
            // header photo on that destination. A model that named the route
            // but no block gets the teaser card — on-topic, and its prices are
            // fetched fresh at send time.
            //
            // Several routes: the fare list below carries them all, so no
            // single route is pinned — pinning one would narrow every other
            // block to one of three destinations and swap the header photo to
            // it, which is not what a round-up email is.
            // Several routes: the fare list carries them all, so nothing is
            // pinned. One route: the block kind is whichever engine actually
            // answered for it — the model's preference only wins when it
            // matches what exists, and a route with no fares keeps the pin
            // (for focus and the header photo) but loses the empty block.
            const kind = pin ? fareKinds.get(routeKey({
              origin: pin.routeOrigin,
              destination: pin.routeDestination,
            })) : undefined;
            if (flightIdeas.length > 1) {
              routePin = undefined;
            } else if (kind) {
              // `kind` is whichever engine answered, which is not always the
              // one the model asked for — data beats preference, and each
              // block renders its own heading, so the copy still reads right.
              // The chosen dates ride along so the block prices them.
              const picked = flightIdeas.find(
                (i) => i.origin === pin!.routeOrigin && i.destination === pin!.routeDestination,
              );
              routePin = {
                ...pin!,
                routeBlock: kind,
                routeOutboundDate: picked?.outboundDate,
                routeReturnDate: picked?.returnDate,
              };
            } else {
              const { routeBlock: _none, ...unpinnedBlock } = pin!;
              routePin = unpinnedBlock;
            }
            break;
          }

          console.warn(
            `[newsletterAi] "${lang}" draft ignored the required routes ` +
            `(got flightRoute=${JSON.stringify(draft.flightRoute)}, attempt ${attempt}/2)`,
          );
          messages.push(
            { role: "assistant", content: JSON.stringify(draft).slice(0, 4000) },
            {
              role: "user",
              content:
                `That draft is not about a required route. Rewrite it so the whole email is ` +
                `about exactly ONE of: ${requiredRoutes}. Set flightRoute to that route's ` +
                `ORIGIN-DEST code and routeBlock to "calendar" or "teaser". Return the JSON ` +
                `object again.`,
            },
          );
        }

        if (!p) {
          if (flightIdeas.length) {
            console.error(
              `[newsletterAi] no on-target draft for "${lang}" after 2 attempts (required: ${requiredRoutes})`,
            );
          }
          skipped += 1;
          continue;
        }

        // The assigned theme's own block list (see THEMES), applied below.
        const suits = (block: string) => theme.blocks.includes(block);

        const subject = cap(p.subject, 120);
        const heading = cap(p.heading, 120);
        const para1 = cap(p.para1, 600);
        const ctaText = cap(p.ctaText, 40);
        // A draft missing any of these isn't reviewable — drop it.
        if (!subject || !heading || !para1 || !ctaText) { skipped += 1; continue; }

        // Belt-and-braces on top of the prompt: never surface a draft whose
        // subject or heading duplicates a recent one. Better no draft this
        // cycle than a repeat landing in subscribers' inboxes.
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
        const isRepeat = history.some(
          (h) => norm(h.subject) === norm(subject) || norm(h.heading) === norm(heading),
        );
        if (isRepeat) {
          console.warn(`[newsletterAi] dropped repeat draft for "${lang}": ${subject}`);
          skipped += 1;
          continue;
        }

        await ctx.runMutation(internal.newsletterAi.insertAiCampaign, {
          subject,
          preheader: cap(p.preheader, 160) || subject,
          heading,
          para1,
          para2: cap(p.para2, 600) || undefined,
          ctaText,
          // A route email's CTA should land on that route's search, not on the
          // generic deals list. Only the default /deals pick is rewritten — a
          // model that deliberately chose /explore for a content-led email
          // keeps it.
          ctaUrl: resolveCtaUrl(p.ctaUrl, routePin),
          // Curated radar deals are suppressed on a routed email: the fare
          // cards ARE its deals section, and appending three unrelated
          // destinations under them is how a "Venice, London, Barcelona"
          // email ended up also selling Malta.
          includeDeals: p.includeDeals === true && allDeals.length > 0 && !campaignRoutes,
          dealCount: resolveDealCount(p.dealCount),
          includeItineraries: resolveFlag(p.includeItineraries, itins.length, suits("includeItineraries")),
          itineraryCount: resolveCount(p.itineraryCount, 2, 3),
          // Sights have no pre-fetched sample list (they are looked up per
          // destination at send time), so availability can't be checked here —
          // the theme still can.
          includeSights: p.includeSights === true && suits("includeSights"),
          sightCount: resolveCount(p.sightCount, 3, 5),
          includeAttractions: resolveFlag(p.includeAttractions, attrs.length, suits("includeAttractions")),
          attractionCount: resolveCount(p.attractionCount, 3, 4),
          includePackages: resolveFlag(p.includePackages, pkgs.length, suits("includePackages")),
          packageCount: resolveCount(p.packageCount, 2, 3),
          includeGuides: resolveFlag(p.includeGuides, guides.length, suits("includeGuides")),
          guideCount: resolveCount(p.guideCount, 2, 3),
          includeSpotlight: resolveFlag(p.includeSpotlight, itins.length, suits("includeSpotlight")),
          ...(routePin ?? {}),
          routes: campaignRoutes,
          heroImg: resolveHeroImg(p.heroImage),
          bannerKey: resolveBannerKey(p.banner),
          languageFilter: lang,
          scheduledAt: resolveSendAt(p.suggestedSendAt),
          sendRationale: cap(p.sendRationale, 300) || undefined,
          aiModel: MODEL,
          theme: theme.id,
        });
        generated += 1;
        if (!themesUsed.includes(theme.id)) themesUsed.push(theme.id);
        // One line per draft, so "did it use the routes I ticked?" is
        // answerable from the Convex logs without reopening the dashboard.
        console.log(
          `[newsletterAi] drafted "${lang}" theme=${theme.id} ` +
          `attachedRoutes=${attachedIdeas.length || "none"} ` +
          `route=${routePin ? `${routePin.routeOrigin}-${routePin.routeDestination} (${routePin.routeBlock})` : "none"} ` +
          `fareCards=${campaignRoutes?.length ?? 0} ` +
          `subject="${subject}"`,
        );
      } catch (error: any) {
        console.error(`[newsletterAi] generation failed for "${lang}":`, error?.message);
        skipped += 1;
      }
    }

    // A run that produced nothing has to say why, or the dialog can only
    // shrug. Every early exit above already carries a reason; this covers the
    // drafts that were built and then thrown away.
    const reason =
      generated === 0 && skipped > 0
        ? flightIdeas.length
          ? "The model kept writing about other destinations instead of the routes you " +
            "picked, so nothing was saved. Try again, attach fewer routes, or pick a " +
            "destination-led theme."
          : "OpenAI returned nothing usable this run — the Convex logs have its error."
        : undefined;

    return {
      generated,
      skipped,
      reason,
      themes: themesUsed.length ? themesUsed : undefined,
    };
  },
});

/**
 * Admin-triggered generation ("Generate now"), so drafts can be produced on
 * demand instead of waiting for the next 72h tick. Same logic as the cron and
 * the same safety rail — drafts land as `pending_approval` and nothing is ever
 * sent without approval — but `allowStacking` lets an admin queue a second
 * campaign for a later date while one is already scheduled.
 *
 * A campaign still awaiting approval blocks its language either way: generating
 * on top of it would just create two drafts competing for the same slot.
 */
export const generateNow = action({
  args: {
    token: v.string(),
    // All optional: with none of them this is exactly the old button.
    themeId: v.optional(v.string()),
    languages: v.optional(v.array(v.string())),
    flightIdeas: v.optional(v.array(flightIdeaValidator)),
  },
  returns: v.object({
    generated: v.float64(),
    skipped: v.float64(),
    reason: v.optional(v.string()),
    themes: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args): Promise<GenerationResult> => {
    // Throws unless the caller is an admin.
    await ctx.runQuery(internal.newsletterCampaigns.resolveAdminEmail, {
      token: args.token,
    });
    // Exactly what the dialog asked for, before anything interprets it — the
    // one line that separates "the UI didn't send my choice" from "the
    // generator ignored it".
    console.log(
      `[newsletterAi] generateNow requested: theme=${args.themeId ?? "auto"} ` +
      `languages=${(args.languages ?? []).join(",") || "all"} ` +
      `routes=${(args.flightIdeas ?? []).map((i) => `${i.origin}-${i.destination}`).join(",") || "none"}`,
    );
    return await ctx.runAction(internal.newsletterAi.generateAiCampaigns, {
      allowStacking: true,
      themeId: args.themeId,
      languages: args.languages,
      flightIdeas: args.flightIdeas,
    });
  },
});
