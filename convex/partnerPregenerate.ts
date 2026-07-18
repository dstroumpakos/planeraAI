"use node";

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { buildCacheKey, normalizeDestinationKey } from "./partnerApiAuth";
import { CURATED_CITIES, DEFAULT_DURATIONS } from "./partnerPregenConfig";

/**
 * Partner API — pre-generation of the most common itineraries.
 *
 * Pre-builds itineraries for a curated set of top destinations across the most
 * requested durations so the majority of partner requests are served instantly
 * from cache (zero live LLM cost). Also PRE-WARMS `destinationSights` for each
 * city, giving the generator lat/lng + neighborhood grounding for accurate
 * geographic ordering.
 *
 * Trigger from the dashboard via `triggerPregeneration` (admin-gated), or wire
 * `pregenerateTopCities` into a cron.
 */

// Must track `partnerItineraryGen`: pre-generation writes into the SAME
// itinerary cache (`buildCacheKey` from partnerApiAuth), so if these two drift
// the curated cities — the majority of partner traffic, served from cache —
// silently keep whatever model this file names, and changing the live
// generator's model has no visible effect. Shares the same env var so they
// cannot come apart again.
const MODEL = process.env.PARTNER_ITINERARY_MODEL || "gpt-5.6-luna";

type Sight = {
  name: string;
  shortDescription: string;
  neighborhoodOrArea?: string;
  bestTimeToVisit?: string;
  estDurationHours?: string;
  latitude?: number;
  longitude?: number;
};

/**
 * Fan out pre-generation across the curated cities. Each city is processed in
 * its own scheduled action to stay within per-action time limits.
 */
export const pregenerateTopCities = internalAction({
  args: {
    cities: v.optional(v.array(v.string())),
    durations: v.optional(v.array(v.float64())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cities = args.cities ?? CURATED_CITIES;
    const durations = args.durations ?? DEFAULT_DURATIONS;
    for (let i = 0; i < cities.length; i++) {
      // Stagger to avoid bursts against OpenAI.
      await ctx.scheduler.runAfter(
        i * 4000,
        internal.partnerPregenerate.pregenerateCity,
        { city: cities[i], durations }
      );
    }
    console.log(
      `[pregen] scheduled ${cities.length} cities x ${durations.length} durations`
    );
    return null;
  },
});

/** Pre-warm sights for one city, then enqueue any missing durations. */
export const pregenerateCity = internalAction({
  args: { city: v.string(), durations: v.array(v.float64()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { city, durations } = args;
    const destinationKey = normalizeDestinationKey(city);

    // 1) Pre-warm sights grounding.
    const existing = await ctx.runMutation(internal.sights.getCachedSights, {
      destinationKey,
    });
    if (!existing || existing.sights.length < 15) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const sights = await generateSightsForCity(openaiKey, city);
          if (sights.length >= 10) {
            await ctx.runMutation(internal.partnerApi.savePregenSights, {
              destinationKey,
              sights,
            });
            console.log(`[pregen] warmed ${sights.length} sights for ${city}`);
          }
        } catch (err) {
          console.error(`[pregen] sights failed for ${city}:`, err);
        }
      }
    }

    // 2) Enqueue missing itineraries.
    const systemKeyId = await ctx.runMutation(
      internal.partnerApi.getOrCreateSystemKey,
      {}
    );
    for (const days of durations) {
      const cacheKey = buildCacheKey(city, days, []);
      const cached = await ctx.runQuery(internal.partnerApi.findCached, {
        cacheKey,
      });
      if (cached) continue;
      await ctx.runMutation(internal.partnerApi.enqueueGeneration, {
        keyId: systemKeyId,
        partnerRef: "__system__",
        destination: city,
        normalizedDestination: destinationKey,
        days,
        preferences: [],
        cacheKey,
        isPregenerated: true,
      });
    }
    return null;
  },
});

/**
 * Process the demand budget: pre-build the common durations for cities partners
 * have actually requested live (cache misses), then mark them covered. Runs on
 * a cron so the cache gradually fills with the cities partners really use.
 */
export const pregenerateDemanded = internalAction({
  args: {
    maxCities: v.optional(v.float64()),
    durations: v.optional(v.array(v.float64())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const maxCities = args.maxCities ?? 8;
    const baseDurations = args.durations ?? DEFAULT_DURATIONS;

    const demand: Array<{
      destinationKey: string;
      destination: string;
      days: number;
      count: number;
    }> = await ctx.runQuery(internal.partnerApi.topDemand, { limit: 100 });

    if (!demand.length) {
      console.log("[pregen] demand budget empty — nothing to do");
      return null;
    }

    // Group demand by city; remember the most-requested display name + all the
    // durations partners asked for so far.
    const byCity = new Map<
      string,
      { destination: string; days: Set<number>; count: number }
    >();
    for (const row of demand) {
      const cur = byCity.get(row.destinationKey);
      if (cur) {
        cur.days.add(row.days);
        cur.count += row.count;
      } else {
        byCity.set(row.destinationKey, {
          destination: row.destination,
          days: new Set<number>([row.days]),
          count: row.count,
        });
      }
    }

    // Most-demanded cities first, capped per run to avoid OpenAI bursts.
    const cities = [...byCity.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, maxCities);

    let i = 0;
    for (const [destinationKey, info] of cities) {
      // Cover the common durations plus whatever was actually requested.
      const durations = Array.from(
        new Set<number>([...baseDurations, ...info.days])
      ).sort((a, b) => a - b);

      await ctx.scheduler.runAfter(
        i * 4000,
        internal.partnerPregenerate.pregenerateCity,
        { city: info.destination, durations }
      );
      await ctx.runMutation(internal.partnerApi.markDemandCovered, {
        destinationKey,
      });
      i++;
    }

    console.log(`[pregen] demand budget: scheduled ${cities.length} cities`);
    return null;
  },
});

/** Admin-gated public trigger for the dashboard. */
export const triggerPregeneration = action({
  args: {
    adminToken: v.string(),
    cities: v.optional(v.array(v.string())),
    durations: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const expected = process.env.PARTNER_ADMIN_TOKEN;
    if (!expected || args.adminToken !== expected) {
      throw new ConvexError("Unauthorized.");
    }
    await ctx.scheduler.runAfter(
      0,
      internal.partnerPregenerate.pregenerateTopCities,
      { cities: args.cities, durations: args.durations }
    );
    return {
      ok: true,
      scheduled: (args.cities ?? CURATED_CITIES).length,
    };
  },
});

// ---------------------------------------------------------------------------
// Sights generation (compact, English; mirrors the app's sights schema)
// ---------------------------------------------------------------------------

async function generateSightsForCity(
  apiKey: string,
  city: string
): Promise<Sight[]> {
  const openai = new OpenAI({ apiKey });
  const prompt = `List 20-30 must-see sights and attractions for ${city}.
For each: name, shortDescription (1-2 sentences), neighborhoodOrArea, bestTimeToVisit, estDurationHours (e.g. "2-3"), latitude, longitude.
Start with the most iconic, then progressively local/hidden gems. Use precise real-world coordinates.
Return ONLY valid JSON: { "sights": [ { "name": "...", "shortDescription": "...", "neighborhoodOrArea": "...", "bestTimeToVisit": "...", "estDurationHours": "2-3", "latitude": 0, "longitude": 0 } ] }`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a travel expert. Return only valid JSON matching the requested schema.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("empty sights response");
  const data = JSON.parse(content);
  const sights: Sight[] = Array.isArray(data?.sights) ? data.sights : [];
  return sights;
}
