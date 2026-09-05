/**
 * Atlas — natural-language trip parsing for the create-trip builder.
 *
 * Step 1 of the builder offers a "just say it" bar: the user types one line
 * ("long weekend in Rome, mid-May, around €900 for two") and lands on the
 * review step with everything filled in.
 *
 * This is deliberately NOT `atlas.chat`. Chat is a conversational, tool-calling
 * loop that costs several rounds and returns prose; this is one cheap call that
 * returns strict JSON, so the bar feels instant and never puts a sentence into
 * a form field.
 *
 * Nothing here trusts the model with anything it can get wrong quietly:
 *
 *   • the destination is resolved against our own tables afterwards, so the
 *     value that reaches `trips.create` is always a canonical "City, Country"
 *     we recognise, never whatever the model spelled;
 *   • dates are clamped to the future and to MAX_TRIP_DAYS;
 *   • travellers and budget are clamped to the same ranges the form enforces;
 *   • interests are intersected with INTERESTS, so an invented one is dropped.
 *
 * A field the user did not mention comes back null and the builder keeps its
 * own default. Parsing failure is never fatal: the caller falls back to the
 * five steps, which is the normal path anyway.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { normalizeDestinationToEnglish } from "../lib/destinationTranslations";
import { resolveAirport } from "../lib/destinationAirports";

/** Same ceiling the client enforces (lib/tripDays.ts). Duplicated deliberately —
 *  Convex functions must not import client-only helpers that pull in RN code. */
const MAX_TRIP_DAYS = 15;
const MIN_TRAVELLERS = 1;
const MAX_TRAVELLERS = 12;
const MIN_BUDGET = 100;
const MAX_BUDGET = 100000;

/** The interest vocabulary the generator understands (lib/data.ts INTERESTS). */
const KNOWN_INTERESTS = [
  "Adventure",
  "Culinary",
  "Culture",
  "Relaxation",
  "Nightlife",
  "Nature",
  "History",
  "Shopping",
  "Luxury",
  "Family",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "2026-05-12" → midday UTC, so a timezone shift can never move the day. */
function parseDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return Number.isFinite(ts) ? ts : null;
}

export const parseTripRequest = action({
  args: {
    token: v.string(),
    /** The raw line the user typed. Capped client-side, capped again here. */
    text: v.string(),
    /** UI locale — the user may well describe the trip in their own language. */
    language: v.optional(v.string()),
    /** Resolved home airport label, so "from home" and "a weekend away" work. */
    origin: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    destination: v.union(v.string(), v.null()),
    startDate: v.union(v.float64(), v.null()),
    endDate: v.union(v.float64(), v.null()),
    travelerCount: v.union(v.float64(), v.null()),
    budgetTotal: v.union(v.float64(), v.null()),
    interests: v.array(v.string()),
    /** True when we recognised the destination well enough to search flights. */
    destinationResolved: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const empty = {
      ok: false,
      destination: null,
      startDate: null,
      endDate: null,
      travelerCount: null,
      budgetTotal: null,
      interests: [] as string[],
      destinationResolved: false,
    };

    const user = await ctx.runQuery(api.users.validateToken, { token: args.token });
    if (!user) throw new Error("Authentication required");

    const text = String(args.text || "").trim().slice(0, 400);
    if (text.length < 3) return empty;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.ATLAS_MODEL || "gpt-4o-mini";
    if (!OPENAI_API_KEY) {
      console.error("[AtlasParse] OPENAI_API_KEY not set");
      return empty;
    }

    // Today in UTC, so relative phrases ("next month", "mid-May") resolve
    // against a date the model can see rather than its training cutoff.
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const system = [
      "You turn one sentence describing a trip into JSON for a travel planner.",
      `Today is ${todayIso}. All dates are in the future.`,
      args.origin ? `The traveller departs from ${args.origin}.` : "",
      "Return ONLY a JSON object with these keys:",
      '{"destination": string|null, "startDate": "YYYY-MM-DD"|null, "endDate": "YYYY-MM-DD"|null,',
      '"travelerCount": number|null, "budgetTotal": number|null, "interests": string[]}',
      "",
      'destination: the city in ENGLISH as "City, Country" (e.g. "Rome, Italy"). Never the origin.',
      "startDate/endDate: only if the text implies specific dates or a month; a bare month means a sensible span inside it.",
      "travelerCount: number of people travelling, not the number of rooms.",
      "budgetTotal: total for the whole party in euros, as a plain number. If the text gives a per-person figure, multiply it.",
      `interests: zero or more of exactly these values: ${KNOWN_INTERESTS.join(", ")}.`,
      "Use null for anything the text does not say. Never invent a destination.",
    ]
      .filter(Boolean)
      .join("\n");

    let parsed: any = null;
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: text },
          ],
          max_tokens: 220,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        console.error("[AtlasParse] OpenAI error:", response.status, await response.text());
        return empty;
      }
      const data: any = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      parsed = typeof content === "string" ? JSON.parse(content) : null;
    } catch (error) {
      console.error("[AtlasParse] parse failed:", error);
      return empty;
    }

    if (!parsed || typeof parsed !== "object") return empty;

    // ── Destination: the model proposes, our own tables dispose ─────────────
    let destination: string | null = null;
    let destinationResolved = false;
    if (typeof parsed.destination === "string" && parsed.destination.trim()) {
      const canonical = normalizeDestinationToEnglish(parsed.destination.trim()).slice(0, 120);
      // Only accept it if we can place it on the map — otherwise flight search
      // and the day generator would both be working from a name we don't know.
      const airport = resolveAirport(canonical);
      destination = canonical;
      destinationResolved = !!airport?.iata;
    }

    // ── Dates: future-only, ordered, inside the length cap ──────────────────
    let startDate = parseDate(parsed.startDate);
    let endDate = parseDate(parsed.endDate);
    const floor = Date.now() - DAY_MS; // today still counts as bookable
    if (startDate !== null && startDate < floor) startDate = null;
    if (startDate === null) endDate = null;
    if (startDate !== null && endDate !== null) {
      if (endDate <= startDate) {
        endDate = startDate + DAY_MS;
      }
      const days = Math.round((endDate - startDate) / DAY_MS) + 1;
      if (days > MAX_TRIP_DAYS) {
        endDate = startDate + (MAX_TRIP_DAYS - 1) * DAY_MS;
      }
    }

    // ── Party and money: the same ranges the form itself enforces ───────────
    let travelerCount: number | null = null;
    if (typeof parsed.travelerCount === "number" && Number.isFinite(parsed.travelerCount)) {
      travelerCount = Math.round(clamp(parsed.travelerCount, MIN_TRAVELLERS, MAX_TRAVELLERS));
    }

    let budgetTotal: number | null = null;
    if (typeof parsed.budgetTotal === "number" && Number.isFinite(parsed.budgetTotal)) {
      budgetTotal = Math.round(clamp(parsed.budgetTotal, MIN_BUDGET, MAX_BUDGET));
    }

    // ── Interests: intersection with the known vocabulary, max three ────────
    const interests: string[] = Array.isArray(parsed.interests)
      ? parsed.interests
          .filter((i: unknown): i is string => typeof i === "string")
          .map((i: string) => KNOWN_INTERESTS.find((k) => k.toLowerCase() === i.trim().toLowerCase()))
          .filter((i: string | undefined): i is string => !!i)
          .slice(0, 3)
      : [];

    return {
      ok: !!destination || startDate !== null || travelerCount !== null || budgetTotal !== null || interests.length > 0,
      destination,
      startDate,
      endDate,
      travelerCount,
      budgetTotal,
      interests: Array.from(new Set(interests)),
      destinationResolved,
    };
  },
});
