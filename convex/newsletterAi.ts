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
import { normalizeLang, type DealForEmail } from "./newsletter";

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
  { id: "ai-planning", brief: "How Planera's AI turns one sentence into a complete day-by-day itinerary in seconds." },
  { id: "destination-inspiration", brief: "Spotlight one or two specific destinations worth visiting right now, and why now." },
  { id: "community-explore", brief: "Real trips and tips from other Planera travellers — social proof and discovery." },
  { id: "travel-tips", brief: "One genuinely useful practical tip (booking timing, packing, airport or baggage hacks)." },
  { id: "seasonal", brief: "What to book right now for the season ahead, with a sense of timing." },
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

const SYSTEM_PROMPT = `You are a senior travel-marketing copywriter for Planera AI, an AI trip-planning app (AI itineraries, flight deals via "Low-Fare Radar", destination guides).

Write ONE short marketing newsletter email. Rules:
- Write ENTIRELY in the requested language, natural and native — never translated-sounding.
- Warm, concrete, energetic. No hype, no ALL CAPS, no spammy phrases ("ACT NOW", "100% FREE"), no fake urgency or invented discounts.
- Never invent prices, routes or offers. Only reference the live deals provided, if any.
- subject: under 60 characters, specific, no emoji spam (at most one emoji).
- preheader: under 90 characters, complements the subject (never repeats it).
- heading: under 50 characters.
- para1: 1-2 sentences, the hook. para2: 1-2 sentences, the payoff.
- ctaText: 2-4 words, action-led.
- ctaUrl: MUST be one of https://planeraai.app , https://planeraai.app/deals , https://planeraai.app/explore
- includeDeals: true if the email is about flight deals/prices, else false.
- suggestedSendAt: ISO-8601 UTC timestamp for the best moment to send, between 2 days and 10 days from now. Prefer Tuesday-Thursday, 09:00-11:00 in the audience's local time.
- sendRationale: one short English sentence (for the admin, not the reader) explaining the timing choice.

VARIETY IS CRITICAL. This audience receives an email every few days, so a repeat is worse than a weak one:
- Write to the ASSIGNED THEME given below, and nothing else.
- The previous emails are listed below. Do NOT reuse their subject lines, opening words, angle, metaphors, or CTA wording — not even reworded.
- Vary the structure too: if a previous email opened with a question, don't open with a question; if it led with a price, lead with a place or an idea instead.

Return ONLY a JSON object with exactly these keys:
subject, preheader, heading, para1, para2, ctaText, ctaUrl, includeDeals, suggestedSendAt, sendRationale`;

// ---------------------------------------------------------------------------
// Internal data access
// ---------------------------------------------------------------------------

/**
 * Which languages to generate for: those with confirmed subscribers, minus any
 * that already have an un-actioned (pending_approval / scheduled) draft.
 */
export const getGenerationTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const counts: Record<string, number> = {};
    for (const s of active) {
      const lang = normalizeLang(s.language);
      counts[lang] = (counts[lang] ?? 0) + 1;
    }

    const busy = new Set<string>();
    for (const status of ["pending_approval", "scheduled"] as const) {
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

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

export const generateAiCampaigns = internalAction({
  args: {},
  returns: v.object({ generated: v.float64(), skipped: v.float64() }),
  handler: async (ctx): Promise<{ generated: number; skipped: number }> => {
    // Trimmed: a stray newline/space pasted into the dashboard env var makes
    // the Authorization header malformed and OpenAI answers 401.
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      console.error("[newsletterAi] OPENAI_API_KEY not set — skipping generation");
      return { generated: 0, skipped: 0 };
    }

    const targets: {
      languages: Array<{ lang: string; count: number }>;
      recent: Record<string, Array<{ subject: string; heading: string; theme?: string }>>;
    } = await ctx.runQuery(internal.newsletterAi.getGenerationTargets, {});
    if (!targets.languages.length) return { generated: 0, skipped: 0 };

    // Live deals give the copy something real to reference.
    const allDeals: DealForEmail[] = await ctx.runQuery(
      internal.newsletter.getFeaturedDeals,
      {},
    );
    const dealLines = allDeals
      .slice(0, 6)
      .map(
        (d) =>
          `- ${d.originCity} → ${d.destinationCity}: ${Math.round(d.price)} ${d.currency}` +
          `${d.returnDate ? " (round trip)" : " (one way)"}`,
      )
      .join("\n");

    let generated = 0;
    let skipped = 0;

    for (const { lang, count } of targets.languages) {
      const langName = LANG_NAMES[lang] ?? "English";
      const history = targets.recent[lang] ?? [];
      const theme = nextTheme(history.map((h) => h.theme ?? "").filter(Boolean));

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
          : `There are no live flight deals right now — do not mention specific prices, and set includeDeals to false.\n`);

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
 * demand instead of waiting for the next 72h tick. Runs the exact same logic
 * and guards as the cron — drafts still land as `pending_approval` and nothing
 * is ever sent without approval.
 */
export const generateNow = action({
  args: { token: v.string() },
  returns: v.object({ generated: v.float64(), skipped: v.float64() }),
  handler: async (ctx, args): Promise<{ generated: number; skipped: number }> => {
    // Throws unless the caller is an admin.
    await ctx.runQuery(internal.newsletterCampaigns.resolveAdminEmail, {
      token: args.token,
    });
    return await ctx.runAction(internal.newsletterAi.generateAiCampaigns, {});
  },
});
