"use node";

/**
 * Public, account-free itinerary-body translation.
 *
 * WHY THIS LIVES IN CONVEX: the partner API generates itineraries in English
 * only (`partnerItineraryGen` hardcodes English and `/v1/itineraries` has no
 * language parameter), so the ChatGPT App translates the finished English
 * itinerary before rendering. That translation used to run inside the MCP
 * server, which meant a SECOND copy of `OPENAI_API_KEY` on the VPS. Moving the
 * call here means the key stays in exactly one place — Convex — and the MCP
 * server holds no model credentials at all.
 *
 * Deliberately NOT fixing this upstream in the generator: plumbing `language`
 * through the partner schema, http.ts, buildCacheKey and the prompt would
 * fragment the itinerary cache and the LLM spend 6 ways (one generation per
 * language per destination/days). Translating the finished English itinerary
 * keeps ONE cached generation per trip and adds a single cheap pass.
 *
 * ⚠️ This is a PUBLIC endpoint that spends money on every call, which makes it
 * the most abusable function in the deployment. Three guards, in order:
 *   1. per-device rate limit (shared window with the other public actions),
 *   2. a hard cap on days/stops/characters, checked BEFORE the model call,
 *   3. no retries — a failure returns null and the caller serves English.
 *
 * Returns null (never throws) for anything the caller should treat as "just
 * show the English", so translation can never break a trip result.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";
import { reportError } from "./helpers/reportError";

const LANG_NAMES: Record<string, string> = {
  el: "Greek",
  es: "Spanish",
  fr: "French",
  de: "German",
  ar: "Arabic",
};

// Same family as the partner generator; override with
// `npx convex env set TRANSLATE_MODEL gpt-5.6-terra` if quality disappoints.
const MODEL = process.env.TRANSLATE_MODEL || "gpt-5.6-luna";
const TIMEOUT_MS = 12_000;

// Bounds sized to the largest itinerary the tools can request (21 days) with
// generous per-day slack. Anything past this is not a real itinerary.
const MAX_DAYS = 21;
const MAX_STOPS_PER_DAY = 12;
const MAX_CHARS = 40_000;

/**
 * Whether translation is actually configured on THIS deployment.
 *
 * Exists purely so the MCP server's readiness probe can still surface a missing
 * key now that the credential lives here instead of on the VPS. Spends nothing
 * — it reads an env var and returns a boolean, never touching the model.
 */
export const translationConfigured = action({
  args: {},
  returns: v.boolean(),
  handler: async () => Boolean(process.env.OPENAI_API_KEY),
});

export const translateItineraryPublic = action({
  args: {
    deviceId: v.string(),
    lang: v.string(),
    destination: v.string(),
    /**
     * The MINIMAL translatable payload, already stripped by the caller:
     * `[{ i, title, stops: [{ j, name, description }] }]`.
     *
     * Coordinates, times, categories and affiliate links deliberately never
     * cross this boundary — they are re-attached by the caller after merging,
     * so nothing structural can be mangled by the model.
     */
    days: v.any(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args): Promise<any | null> => {
    const device = (args.deviceId || "").trim();
    if (!device) return null;

    const target = LANG_NAMES[args.lang];
    // English (and anything unrecognized) needs no translation.
    if (!target) return null;

    const days = Array.isArray(args.days) ? args.days : [];
    if (!days.length) return null;

    // --- Guards, before we spend anything ---------------------------------
    if (days.length > MAX_DAYS) return null;
    if (days.some((d: any) => (d?.stops?.length ?? 0) > MAX_STOPS_PER_DAY)) {
      return null;
    }
    const serialized = JSON.stringify({ days });
    if (serialized.length > MAX_CHARS) return null;

    const rl: { allowed: boolean } = await ctx.runMutation(
      internal.flightSearchCache.checkRateLimit,
      { userId: `pub:${device}`, limit: 30, windowMs: 15 * 60 * 1000 }
    );
    if (!rl.allowed) return null;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[translate] OPENAI_API_KEY missing — serving English");
      return null;
    }

    try {
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create(
        {
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                "You translate travel itinerary text. Return ONLY valid JSON matching the input structure exactly — same indices, same nesting, no added or removed entries.",
            },
            {
              role: "user",
              content: `Translate the "title", "name" and "description" fields below into ${target}. This is an itinerary for ${args.destination}.

Rules:
- Translate descriptions and day titles naturally and idiomatically — do not translate word-for-word.
- For place names, use the established ${target} exonym when one exists (e.g. the Colosseum has a well-known name in most languages). If a venue has no established ${target} name — restaurants, bars, small local businesses — KEEP THE ORIGINAL NAME so the traveller can find it on a map and say it to a local.
- Keep descriptions to roughly the same length.
- Preserve the exact JSON shape and every "i" / "j" index.

Return JSON of the form {"days":[{"i":0,"title":"...","stops":[{"j":0,"name":"...","description":"..."}]}]}

Input:
${serialized}`,
            },
          ],
          response_format: { type: "json_object" },
        },
        { timeout: TIMEOUT_MS }
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      const translated = Array.isArray(parsed?.days) ? parsed.days : [];
      if (!translated.length) return null;

      console.log(
        `[translate] ${args.lang} ${args.destination} -> ${translated.length} days`
      );
      // The CALLER merges by index against the untouched originals, so a model
      // that drops or mangles an entry degrades field by field instead of
      // blanking content here.
      return { days: translated };
    } catch (err) {
      // Non-fatal by design: report for visibility, hand back null, and the
      // caller serves the English it already has.
      await reportError(ctx, "translatePublic:translateItineraryPublic", err, {
        lang: args.lang,
        destination: args.destination,
      });
      return null;
    }
  },
});
