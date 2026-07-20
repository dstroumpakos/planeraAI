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
import { action, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import {
  normalizeLang,
  pickGuides,
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
 * Content angles, rotated server-side so two consecutive emails to the same
 * audience are never the same pitch. We assign the angle rather than letting
 * the model choose, because a model given the same context tends to converge
 * on the same idea every time.
 */
const THEMES: Array<{ id: string; brief: string }> = [
  { id: "flight-deals", brief: "Concrete live fare drops from the deals listed below and how to grab them before they move." },
  { id: "ai-planning", brief: "How filling in the trip form — destination, dates, budget, interests — gets you a full day-by-day itinerary you can then reorder and edit." },
  { id: "destination-inspiration", brief: "Spotlight one or two specific destinations worth visiting right now, and why now." },
  { id: "community-explore", brief: "The Explore section's ready-made destination itineraries, built from patterns across real Planera trips. Editorial guides to browse — NOT user posts, profiles, reviews or comments." },
  { id: "travel-tips", brief: "One genuinely useful practical tip (booking timing, packing, airport or baggage hacks)." },
  { id: "seasonal", brief: "What to book right now for the season ahead, with a sense of timing." },
  { id: "weekend-escape", brief: "Short 2-4 day city breaks that fit into a weekend — quick to plan in the trip form, easy to take. Lean on short-haul deals below, if any." },
  { id: "budget-focus", brief: "Travelling well on a small budget: how the trip form's total-budget field shapes the whole itinerary, backed only by the real prices listed below — never invented ones." },
  { id: "route-spotlight", brief: "Spotlight exactly ONE route from the live deals listed below: why this fare is worth a look right now (use its typical-price context if given). If no deals are listed, write about how Low-Fare Radar surfaces cheap fares instead." },
];

/**
 * Next angle for an audience: the first theme not used recently, else the one
 * used longest ago. `recentThemes` is newest-first.
 */
function nextTheme(recentThemes: string[]): { id: string; brief: string } {
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
    * Only set a block's include* flag to true if matching content is listed below AND it genuinely fits the assigned theme. 1-2 blocks maximum — an email with everything is an email about nothing.
    * The cards render automatically; do NOT restate their contents (titles, prices) in para1/para2. The copy should set them up, not duplicate them.
- includeItineraries (true/false) + itineraryCount (1-3, default 2): ready-made destination guides from Explore. Fits destination-inspiration and community-explore themes.
- includeSights (true/false) + sightCount (1-5, default 3): top sights with a one-line description. Fits destination-inspiration.
- includeAttractions (true/false) + attractionCount (1-4, default 3): bookable tickets/tours with real prices. Fits destination and seasonal themes.
- includePackages (true/false) + packageCount (1-3, default 2): partner holiday packages with a from-price. Fits seasonal and deals-adjacent themes; skip for purely informational emails.
- includeGuides (true/false) + guideCount (1-3, default 2): short reading-list cards linking to Planera's travel guides (the available titles are listed in the user message). Fits travel-tips, ai-planning and informational emails.
- includeSpotlight (true/false): ONE large "trip of the week" feature card of the top Explore itinerary. Fits destination-inspiration and community-explore themes. Counts toward the 1-2 block budget like any other block.
- routeBlock ("calendar" | "teaser" | "none") + flightRoute ("ORIGIN-DEST" IATA pair copied EXACTLY from one of the live deals below, e.g. "ATH-LIS"):
    "calendar" appends a "cheapest days to fly" date/price strip for that route — fits flight-deals, route-spotlight, weekend-escape and seasonal themes.
    "teaser" appends a single "Flights to X — from €Y" price card — fits destination-inspiration.
    The prices are fetched live at send time, so do NOT quote them in para1/para2. Use "none" when no deals are listed or no route fits the theme.
- heroImage: a big photo at the top. Pick the one that fits the email, or "none":
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
    routeBlock: v.optional(v.union(v.literal("calendar"), v.literal("teaser"))),
    routeOrigin: v.optional(v.string()),
    routeDestination: v.optional(v.string()),
    routeOriginCity: v.optional(v.string()),
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

function resolveCtaUrl(raw: unknown): string {
  const url = typeof raw === "string" ? raw.trim() : "";
  return url.startsWith(ALLOWED_CTA_PREFIX) ? url : DEFAULT_CTA_URL;
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
 * Block flag: on only if the model asked AND the sample list we showed it is
 * non-empty. The model only ever sees real content, but a `true` against an
 * empty source would render nothing and silently disappoint the reviewer.
 */
function resolveFlag(raw: unknown, available: number): boolean {
  return raw === true && available > 0;
}

/**
 * Route block: only accepted when the model's "ORIGIN-DEST" pair matches a
 * LIVE deal's route exactly — a hallucinated route never reaches a campaign.
 * The matched deal supplies the display cities and currency, so those can't
 * be invented either.
 */
function resolveRouteBlock(
  rawKind: unknown,
  rawRoute: unknown,
  deals: DealForEmail[],
):
  | {
      routeBlock: "calendar" | "teaser";
      routeOrigin: string;
      routeDestination: string;
      routeOriginCity: string;
      routeDestinationCity: string;
      routeCurrency: string;
    }
  | undefined {
  const kind = rawKind === "calendar" || rawKind === "teaser" ? rawKind : undefined;
  if (!kind) return undefined;
  const m =
    typeof rawRoute === "string"
      ? rawRoute.trim().toUpperCase().match(/^([A-Z]{3})\s*[-–>→]+\s*([A-Z]{3})$/)
      : null;
  if (!m) return undefined;
  const deal = deals.find(
    (d) => d.origin?.toUpperCase() === m[1] && d.destination?.toUpperCase() === m[2],
  );
  if (!deal) return undefined;
  return {
    routeBlock: kind,
    routeOrigin: m[1],
    routeDestination: m[2],
    routeOriginCity: deal.originCity,
    routeDestinationCity: deal.destinationCity,
    routeCurrency: deal.currency,
  };
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

/** `reason` explains a zero-draft run so the admin UI can say why. */
type GenerationResult = {
  generated: number;
  skipped: number;
  reason?: string;
};

export const generateAiCampaigns = internalAction({
  args: { allowStacking: v.optional(v.boolean()) },
  returns: v.object({
    generated: v.float64(),
    skipped: v.float64(),
    reason: v.optional(v.string()),
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

    for (const { lang, count } of targets.languages) {
      const langName = LANG_NAMES[lang] ?? "English";
      const history = targets.recent[lang] ?? [];
      const theme = nextTheme(history.map((h) => h.theme ?? "").filter(Boolean));

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

      const historyBlock = history.length
        ? `Previous emails to THIS audience (newest first) — do not repeat any of these:\n` +
          history.map((h, i) => `${i + 1}. "${h.subject}" — ${h.heading}`).join("\n") +
          `\n`
        : `This is the first email to this audience.\n`;

      const userPrompt =
        `Today is ${new Date().toISOString().slice(0, 10)} (UTC).\n` +
        `Target language: ${langName}.\n` +
        `Audience: ${count} opted-in subscriber(s) of Planera AI.\n\n` +
        `ASSIGNED THEME: ${theme.id} — ${theme.brief}\n\n` +
        historyBlock +
        `\n` +
        (dealLines
          ? `Live flight deals you may reference (do NOT invent others):\n${dealLines}\n`
          : `There are no live flight deals right now — do not mention specific prices, and set includeDeals to false.\n`) +
        `\n${contentLines}\n`;

      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            response_format: { type: "json_object" },
            // No `temperature`: the gpt-5.6 family rejects it (same reason no
            // other OpenAI call in this repo sets it). Budget is generous
            // because reasoning tokens count toward this limit — too low and
            // the JSON comes back truncated.
            max_completion_tokens: 2000,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (!response.ok) {
          // Surface OpenAI's own message — "Incorrect API key provided" vs
          // "model not found" vs a quota error are very different fixes, and
          // the bare status code hides which one it is.
          const detail = await response.text().catch(() => "");
          console.error(
            `[newsletterAi] OpenAI ${response.status} for "${lang}" (model=${MODEL}): ${detail.slice(0, 500)}`,
          );
          skipped += 1;
          continue;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        if (!content) { skipped += 1; continue; }

        const p = JSON.parse(content);
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
          ctaUrl: resolveCtaUrl(p.ctaUrl),
          includeDeals: p.includeDeals === true && allDeals.length > 0,
          dealCount: resolveDealCount(p.dealCount),
          includeItineraries: resolveFlag(p.includeItineraries, itins.length),
          itineraryCount: resolveCount(p.itineraryCount, 2, 3),
          includeSights: p.includeSights === true,
          sightCount: resolveCount(p.sightCount, 3, 5),
          includeAttractions: resolveFlag(p.includeAttractions, attrs.length),
          attractionCount: resolveCount(p.attractionCount, 3, 4),
          includePackages: resolveFlag(p.includePackages, pkgs.length),
          packageCount: resolveCount(p.packageCount, 2, 3),
          includeGuides: resolveFlag(p.includeGuides, guides.length),
          guideCount: resolveCount(p.guideCount, 2, 3),
          includeSpotlight: resolveFlag(p.includeSpotlight, itins.length),
          ...(resolveRouteBlock(p.routeBlock, p.flightRoute, allDeals) ?? {}),
          heroImg: resolveHeroImg(p.heroImage),
          bannerKey: resolveBannerKey(p.banner),
          languageFilter: lang,
          scheduledAt: resolveSendAt(p.suggestedSendAt),
          sendRationale: cap(p.sendRationale, 300) || undefined,
          aiModel: MODEL,
          theme: theme.id,
        });
        generated += 1;
      } catch (error: any) {
        console.error(`[newsletterAi] generation failed for "${lang}":`, error?.message);
        skipped += 1;
      }
    }

    return { generated, skipped };
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
  args: { token: v.string() },
  returns: v.object({
    generated: v.float64(),
    skipped: v.float64(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<GenerationResult> => {
    // Throws unless the caller is an admin.
    await ctx.runQuery(internal.newsletterCampaigns.resolveAdminEmail, {
      token: args.token,
    });
    return await ctx.runAction(internal.newsletterAi.generateAiCampaigns, {
      allowStacking: true,
    });
  },
});
