/**
 * AI-written sales copy for the three packages a client sees.
 *
 * An agent's real work is not assembling the options — the engines do that in
 * seconds — it is explaining WHY these three, and what you give up by going
 * cheaper. That paragraph is what currently gets typed by hand into an email,
 * and it is the reason a quote takes an hour instead of a minute.
 *
 * ── Two rules this module exists to enforce ────────────────────────────────
 *
 * 1. IT CANNOT LEAK MARGIN. The prompt is built from `toCustomerPackages`, the
 *    projection that has no field for supplier cost, markup or expected
 *    commission. Not "we remember not to include it" — there is nothing to
 *    include. An LLM that never receives a number cannot print it.
 *
 * 2. IT CANNOT INVENT. The model is given the actual lines — carrier, stops,
 *    duration, hotel name, stars, board, activity titles, the total — and told
 *    to write only from them. Copy that promises a rooftop pool nobody booked
 *    is worse than no copy at all, because a client reads it as a commitment.
 *
 * Generation is scheduled AFTER the quote is saved, never inline: a search must
 * not wait on OpenAI, and a quote with no copy is complete and sendable. Every
 * failure path here returns null and leaves the quote exactly as it was.
 */

import { v } from "convex/values";
import { OPENAI_MODEL } from "../lib/openaiModel";
import { makeFunctionReference } from "convex/server";
import { internalAction, internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PackageTier, TravelPackage } from "./model/types";
import { toCustomerPackages, type CustomerPackage } from "./quoteView";
import { guard, notFound } from "./errors";
import { cityForIata } from "../lib/radarDestinations";

/**
 * gpt-5.6-terra, the model Planera's own newsletter copy runs on. gpt-4o-mini
 * wrote Greek a client would notice ("επιβατικά αποσκευές", "ωφέλιμες
 * υπηρεσίες όπως επιστροφές χρημάτων") and called a hotel 5-star unprompted,
 * which on a sales document reads as a promise. Env-switchable as before.
 */
const MODEL = process.env.AGENCY_COPY_MODEL || OPENAI_MODEL;

/**
 * Copy is scheduled after the quote is saved, so nothing waits on it — the
 * timeout only has to fit a reasoning model, not a person.
 */
const OPENAI_TIMEOUT_MS = 60_000;

export interface TierCopy {
  /** A short, concrete name for this option. Not "Comfort" — that is the tier. */
  headline: string;
  /** One or two sentences on who this suits and why. */
  pitch: string;
  /** What you give up at this level, stated plainly. Empty on the top tier. */
  tradeOff: string;
}

export interface QuoteCopy {
  /** A paragraph the agent can paste into an email or read down the phone. */
  summary: string;
  tiers: Partial<Record<PackageTier, TierCopy>>;
  model: string;
  generatedAt: number;
  language: string;
}

// ── Prompt input ────────────────────────────────────────────────────────────

/**
 * Flatten a customer package into the few facts worth writing about.
 *
 * Deliberately narrow. Everything here is already visible to the traveller on
 * the quote document, so nothing new is disclosed to OpenAI, and a smaller
 * payload keeps the model anchored on facts instead of embroidering.
 */
function describePackage(pkg: CustomerPackage): Record<string, unknown> {
  const lines = pkg.lines.map((line) => {
    const o = line.offer;
    switch (o.kind) {
      case "flight":
        return {
          type: "flight",
          carrier: o.outbound[0]?.carrier,
          stops: o.outboundStops,
          durationMinutes: o.totalDurationMinutes,
          cabin: o.cabinClass,
          checkedBags: o.baggage.checked,
          refundable: o.conditions.refundable,
        };
      case "hotel":
        return {
          type: "hotel",
          name: o.name,
          stars: o.starRating,
          guestScore: o.reviewScore,
          board: o.boardType,
          nights: o.nights,
          room: o.roomCategory,
          freeCancellation: o.conditions.refundable,
        };
      case "activity":
        return {
          type: "activity",
          title: o.title,
          durationMinutes: o.durationMinutes,
          rating: o.rating,
          reviews: o.reviewCount,
        };
      case "transfer":
        return { type: "transfer", mode: o.mode, from: o.fromLabel, to: o.toLabel };
      case "service":
        // Added by the agent. Title and description are the agent's own words,
        // so the model may use them — they are facts the agency stated.
        return {
          type: o.category,
          title: o.title,
          description: o.description,
          refundable: o.conditions.refundable,
        };
    }
  });

  return {
    tier: pkg.tier,
    totalMinor: pkg.total.amountMinor,
    currency: pkg.total.currency,
    lines,
  };
}

/**
 * The trip in words the copy can use. The raw search params carry IATA codes,
 * which is how the model ended up writing "BCN" into a client's paragraph.
 */
function describeTrip(trip: unknown): Record<string, unknown> {
  const t = (trip ?? {}) as {
    originIata?: string;
    destinationIata?: string;
    departDate?: string;
    returnDate?: string;
    nights?: number;
    adults?: number;
    childrenAges?: number[];
    travelers?: number;
  };
  return {
    from: t.originIata ? cityForIata(t.originIata) : undefined,
    to: t.destinationIata ? cityForIata(t.destinationIata) : undefined,
    departDate: t.departDate,
    returnDate: t.returnDate,
    nights: t.nights,
    adults: t.adults,
    childrenAges: t.childrenAges?.length ? t.childrenAges : undefined,
    travellers: t.travelers,
  };
}

const SYSTEM_PROMPT = [
  "You write short sales copy for a travel agency's client-facing quote.",
  "You are given three packages (basic, comfort, premium) for ONE trip, already priced.",
  "",
  "ABSOLUTE RULES:",
  "- Use ONLY the facts given. Never invent a hotel amenity, a view, a landmark,",
  "  an airline service, a discount, or anything not present in the data.",
  "- Never state or guess the agency's cost, commission, markup or profit.",
  "- Never promise availability, and never say a price is guaranteed.",
  "- Do not repeat the price in the copy; the document already shows it.",
  "- A hotel's star rating is exactly the `stars` given. Never call a hotel",
  "  luxury, boutique or 5-star unless the data says so.",
  "- Name the destination city, not airport codes.",
  "",
  "LANGUAGE: write as a senior travel consultant who is a native speaker of the",
  "requested language would write to a client — warm, precise, never salesy or",
  "translated-sounding. In Greek use the terms Greek agencies use: «απευθείας",
  "πτήση», «με ενδιάμεση στάση», «χειραποσκευή», «αποσκευή στο αμπάρι», «με",
  "πρωινό», «μόνο διαμονή», «δωρεάν ακύρωση», «μη επιστρεπτέο». Address the",
  "client in the polite plural (εσείς). No exclamation marks, no emoji.",
  "",
  "For EACH package supply:",
  '  "headline": max 6 words, concrete and specific to THIS option.',
  "             Not the tier name, and never a generic word like 'Comfort'.",
  '  "pitch":    1-2 sentences on who it suits and why, grounded in its lines.',
  '  "tradeOff": ONE honest sentence on what this level gives up compared with',
  "             the more expensive one. For the most expensive package use an",
  "             empty string. Honesty here is the point — an agent loses trust",
  "             faster by hiding a stopover than by naming it.",
  "",
  'Also supply "summary": one paragraph (max 60 words) the agent can send to the',
  "client introducing all three, naming the real difference between them.",
  "",
  'Reply with ONLY JSON: {"summary":"...","basic":{...},"comfort":{...},"premium":{...}}',
  "Omit a package key entirely if that package has no lines.",
].join("\n");

// ── OpenAI ──────────────────────────────────────────────────────────────────

interface RawCopy {
  summary?: string;
  basic?: Partial<TierCopy>;
  comfort?: Partial<TierCopy>;
  premium?: Partial<TierCopy>;
}

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

/**
 * Ask the model. Returns null on EVERY failure — no key, network, non-200,
 * unparseable JSON — because the caller's correct response to all of them is
 * identical: leave the quote without copy.
 */
async function askOpenAi(
  packages: CustomerPackage[],
  trip: unknown,
  language: string,
): Promise<QuoteCopy | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[agency:packageCopy] OPENAI_API_KEY not set — skipping");
    return null;
  }

  const withLines = packages.filter((p) => p.lines.length > 0);
  // Nothing to sell: a quote where every tier came back empty needs a fix, not
  // a paragraph about it.
  if (withLines.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        // No `temperature`: reasoning models reject it and the model is
        // env-switchable, same as the other AI modules here.
        // Reasoning tokens count toward this limit; too low and the JSON comes
        // back truncated, which reads here as "no copy".
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `Write in ${language}.`,
              `Trip: ${JSON.stringify(describeTrip(trip))}`,
              `Packages: ${JSON.stringify(withLines.map(describePackage))}`,
            ].join("\n\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[agency:packageCopy] OpenAI ${response.status} (model=${MODEL}): ${detail.slice(0, 300)}`,
      );
      return null;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;

    const raw = JSON.parse(content) as RawCopy;
    const tiers: Partial<Record<PackageTier, TierCopy>> = {};
    for (const tier of ["basic", "comfort", "premium"] as PackageTier[]) {
      const t = raw[tier];
      if (!t) continue;
      const headline = clean(t.headline, 60);
      const pitch = clean(t.pitch, 400);
      // A tier with no usable text is omitted rather than rendered blank.
      if (!headline && !pitch) continue;
      tiers[tier] = { headline, pitch, tradeOff: clean(t.tradeOff, 200) };
    }

    const summary = clean(raw.summary, 700);
    if (!summary && Object.keys(tiers).length === 0) return null;

    return { summary, tiers, model: MODEL, generatedAt: Date.now(), language };
  } catch (err) {
    const e = err as Error;
    console.warn(
      `[agency:packageCopy] generation failed: ${e.name === "AbortError" ? "timed out" : e.message}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Convex wiring ───────────────────────────────────────────────────────────

interface CopyContext {
  quoteRowId: Id<"quotes">;
  packages: TravelPackage[];
  searchParams: unknown;
  language: string;
  revision: number;
}

/** Load what the generator needs. Internal: never exposed to a client. */
export const _loadForCopy = internalMutation({
  args: { quoteId: v.string(), agencyId: v.id("agencies"), revision: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<CopyContext | null> =>
    guard("packageCopy.load", async () => {
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      // Re-derive the tenant from the row rather than trusting the caller.
      if (!row || row.agencyId !== args.agencyId) return null;

      // A later edit superseded this run: skip it, the run for that edit follows.
      if (args.revision !== undefined && args.revision !== (row.copyRevision ?? 0)) return null;

      const agency = await ctx.db.get(row.agencyId);
      return {
        quoteRowId: row._id,
        revision: row.copyRevision ?? 0,
        // Hidden options are not on the client's document, so they must not be
        // in the paragraph that introduces it either.
        packages: ((row.packages ?? []) as TravelPackage[]).filter((p) => !p.hidden),
        searchParams: row.searchParams,
        language: agency?.branding?.quoteLanguage || "Greek",
      };
    }),
});

export const _saveCopy = internalMutation({
  args: {
    quoteRowId: v.id("quotes"),
    agencyId: v.id("agencies"),
    copy: v.any(),
    revision: v.optional(v.float64()),
  },
  handler: async (ctx, args): Promise<null> =>
    guard("packageCopy.save", async () => {
      const row = await ctx.db.get(args.quoteRowId);
      if (!row || row.agencyId !== args.agencyId) throw notFound("quote");
      // The quote was edited while the model was writing: this copy describes
      // lines that are no longer there. The newer run will write its own.
      if (args.revision !== undefined && args.revision !== (row.copyRevision ?? 0)) return null;
      await ctx.db.patch(args.quoteRowId, { aiCopy: args.copy, updatedAt: Date.now() });
      return null;
    }),
});

const loadRef = makeFunctionReference<
  "mutation",
  { quoteId: string; agencyId: Id<"agencies">; revision?: number },
  CopyContext | null
>("agency/packageCopy:_loadForCopy");

const saveRef = makeFunctionReference<
  "mutation",
  { quoteRowId: Id<"quotes">; agencyId: Id<"agencies">; copy: unknown; revision?: number },
  null
>("agency/packageCopy:_saveCopy");

/**
 * Scheduled straight after a quote is saved. Fire-and-forget by design: it
 * cannot fail the search that produced the quote, and a quote without copy is
 * a complete, sendable quote.
 */
export const generate = internalAction({
  args: { quoteId: v.string(), agencyId: v.id("agencies"), revision: v.optional(v.float64()) },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runMutation(loadRef, {
      quoteId: args.quoteId,
      agencyId: args.agencyId,
      revision: args.revision,
    });
    if (!context) return null;

    // THE load-bearing line: the customer projection is what reaches the model,
    // and it has no field for cost, markup or margin.
    const customer = toCustomerPackages(context.packages);

    const copy = await askOpenAi(customer, context.searchParams, context.language);
    if (!copy) return null;

    await ctx.runMutation(saveRef, {
      quoteRowId: context.quoteRowId,
      agencyId: args.agencyId,
      copy,
      revision: context.revision,
    });
    return null;
  },
});
