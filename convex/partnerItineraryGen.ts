"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { hmacSha256Hex } from "./partnerApiAuth";

/**
 * Partner API — itinerary generation engine.
 *
 * A DEDICATED partner-only generator, fully separate from the app's
 * `tripsActions.generate()`. It builds a purpose-built N-day plan (never a
 * truncated longer plan), orders stops geographically and by priority
 * (central must-sees first, distant day-trips last), scales the number of
 * attractions with the day count, and weights selection by partner-supplied
 * preferences.
 *
 * Grounding: when cached `destinationSights` exist (lat/lng + neighborhoods),
 * they are fed to the model to improve geographic ordering. Pre-generation
 * pre-warms this for the top cities.
 *
 * Graceful degradation: if the LLM is unavailable, falls back to a template
 * built from cached sights; only fails if there is nothing to fall back to.
 */

// gpt-5.6-luna ($1.00 in / $6.00 out per 1M) is ~60% cheaper than the gpt-5.4
// this replaced ($2.50/$15.00) while being a newer generation, so this is both
// a cost cut and a quality upgrade. Roughly $0.02 vs $0.05 per cold itinerary.
//
// If itinerary quality at luna disappoints, PARTNER_ITINERARY_MODEL=gpt-5.6-terra
// ($2.50/$15.00) matches the app's own trip generation at the old 5.4 price.
//
// NOTE: the model is deliberately NOT part of the itinerary cache key, so
// switching it does not invalidate existing cached itineraries — they age out
// naturally instead of triggering a regeneration wave. That also means a
// quality regression surfaces gradually, only on cache misses.
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

type TripAdvisorRef = {
  url: string | null;
  rating: number | null;
  review_count: number | null;
};

type Stop = {
  name: string;
  category: string;
  description: string;
  start_time: string;
  duration_minutes: number;
  priority: number;
  tags: string[];
  location: {
    address: string | null;
    area: string | null;
    lat: number | null;
    lng: number | null;
  };
  // Forward-compatible: populated later (e.g. restaurant profile links).
  // null until enriched; partners skip rendering when null.
  tripadvisor: TripAdvisorRef | null;
};

type DayPlan = { day: number; title: string; stops: Stop[] };
type Itinerary = { days: DayPlan[] };

export const generatePartnerItinerary = internalAction({
  args: { docId: v.id("partnerItineraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.runQuery(internal.partnerApi.getDoc, {
      docId: args.docId,
    });
    if (!record) {
      console.error(`[partnerGen] doc ${args.docId} not found`);
      return null;
    }
    if (record.status === "ready") return null; // idempotent re-run guard

    await ctx.runMutation(internal.partnerApi.markGenerating, {
      docId: args.docId,
    });

    const { destination, normalizedDestination, days, preferences } = record;

    // Grounding: reuse cached destination sights if available.
    const cached = await ctx.runMutation(internal.sights.getCachedSights, {
      destinationKey: normalizedDestination,
    });
    const sights: Sight[] = cached?.sights ?? [];

    // -------------------------------------------------------------------
    // 1) Try the LLM
    // -------------------------------------------------------------------
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const itinerary = await generateWithLLM(
          openaiKey,
          destination,
          days,
          preferences,
          sights
        );
        const enriched = await enrichItineraryWithTripAdvisor(
          itinerary,
          destination
        );
        await ctx.runMutation(internal.partnerApi.markReady, {
          docId: args.docId,
          itinerary: enriched,
          source: record.isPregenerated ? "pregenerated" : "llm",
        });
        await fireWebhook(ctx, args.docId);
        return null;
      } catch (err) {
        console.error(`[partnerGen] LLM failed for ${destination}:`, err);
        // fall through to degradation
      }
    } else {
      console.warn("[partnerGen] OPENAI_API_KEY missing — degrading");
    }

    // -------------------------------------------------------------------
    // 2) Graceful degradation: template from cached sights
    // -------------------------------------------------------------------
    if (sights.length >= 3) {
      const template = buildTemplateItinerary(destination, days, sights, preferences);
      const enriched = await enrichItineraryWithTripAdvisor(template, destination);
      await ctx.runMutation(internal.partnerApi.markReady, {
        docId: args.docId,
        itinerary: enriched,
        source: "template",
      });
      await fireWebhook(ctx, args.docId);
      return null;
    }

    // -------------------------------------------------------------------
    // 3) Nothing to fall back to
    // -------------------------------------------------------------------
    await ctx.runMutation(internal.partnerApi.markFailed, {
      docId: args.docId,
      error:
        "Generation temporarily unavailable and no cached data to build a fallback.",
    });
    await fireWebhook(ctx, args.docId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// LLM generation
// ---------------------------------------------------------------------------

async function generateWithLLM(
  apiKey: string,
  destination: string,
  days: number,
  preferences: string[],
  sights: Sight[]
): Promise<Itinerary> {
  const openai = new OpenAI({ apiKey });

  // Stops scale with trip length: denser focus on top must-sees for short
  // trips; day-trips/lesser spots appear only toward the end of longer trips.
  const stopsPerDay = days <= 2 ? 5 : days <= 4 ? 5 : days <= 6 ? 4 : 4;
  const totalStops = stopsPerDay * days;

  const prefLine =
    preferences.length > 0
      ? `Traveler preferences (weight selection toward these): ${preferences.join(", ")}.`
      : "No specific preferences provided — build a well-rounded plan covering the top highlights.";

  const sightsBlock =
    sights.length > 0
      ? `\nUse this curated list of real local sights as your primary candidate pool. ` +
        `Prefer these and use their coordinates/areas for geographic ordering:\n` +
        JSON.stringify(
          sights.slice(0, 40).map((s) => ({
            name: s.name,
            area: s.neighborhoodOrArea ?? null,
            lat: s.latitude ?? null,
            lng: s.longitude ?? null,
            duration: s.estDurationHours ?? null,
          }))
        )
      : "";

  const prompt = `Build a fully optimized ${days}-day travel itinerary for ${destination}.

CRITICAL — purpose-built for EXACTLY ${days} day(s):
- This must be a plan designed specifically for ${days} day(s), NOT the first ${days} days of a longer trip.
- With only ${days} day(s) you must tightly prioritize the absolute top must-see attractions; do not dilute with minor spots.
- Aim for about ${stopsPerDay} stops per day (~${totalStops} stops total), adjusting sensibly for travel time.

ORDERING (very important):
- Order the whole trip geographically and by priority. Put the most iconic, central must-see attractions on the EARLY days.
- Cluster stops that are near each other on the same day to minimize travel.
- Push distant attractions, far suburbs and day-trips toward the LAST day(s). For very short trips, drop day-trips entirely in favor of central highlights.
- Within each day, order stops to form an efficient walking/transit route, not back-and-forth.

PREFERENCES:
- ${prefLine}
- If "food" / culinary is present, include meal stops (cafe/lunch/dinner) at sensible times. If "nightlife" is present, add an evening/late stop. If "beaches", "museums", "nature", etc. are present, bias selection accordingly.
${sightsBlock}

For EACH stop provide:
- name: real, specific venue/landmark name
- category: one of "landmark" | "museum" | "neighborhood" | "park" | "viewpoint" | "market" | "restaurant" | "cafe" | "bar" | "beach" | "shopping" | "tour" | "experience"
- description: 1 concise sentence on what it is / why it's worth it
- start_time: "HH:MM" 24h local time
- duration_minutes: integer
- priority: integer 1-5 where 1 = unmissable must-see, 5 = optional/extra
- tags: array of short lowercase tags (e.g. ["food","local"]) — reflect the relevant preferences
- location: { address: street + neighborhood (or null), area: neighborhood/district (or null), lat: number or null, lng: number or null }

Return ONLY valid JSON in this exact shape:
{
  "days": [
    {
      "day": 1,
      "title": "short day title",
      "stops": [
        {
          "name": "...",
          "category": "landmark",
          "description": "...",
          "start_time": "09:00",
          "duration_minutes": 120,
          "priority": 1,
          "tags": ["iconic"],
          "location": { "address": "...", "area": "...", "lat": 48.8584, "lng": 2.2945 }
        }
      ]
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an expert local travel planner. You design tight, geographically optimized itineraries and return ONLY valid JSON matching the requested schema.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");

  const parsed = JSON.parse(content);
  return normalizeItinerary(parsed, days);
}

// ---------------------------------------------------------------------------
// Normalization — guarantee the public schema regardless of model drift
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  "landmark",
  "museum",
  "neighborhood",
  "park",
  "viewpoint",
  "market",
  "restaurant",
  "cafe",
  "bar",
  "beach",
  "shopping",
  "tour",
  "experience",
]);

function normalizeItinerary(raw: any, expectedDays: number): Itinerary {
  const rawDays: any[] = Array.isArray(raw?.days) ? raw.days : [];
  if (rawDays.length === 0) throw new Error("Model returned no days");

  const days: DayPlan[] = rawDays.slice(0, expectedDays).map((d, i) => {
    const stops: Stop[] = (Array.isArray(d?.stops) ? d.stops : []).map(
      (s: any) => normalizeStop(s)
    );
    return {
      day: typeof d?.day === "number" ? d.day : i + 1,
      title: typeof d?.title === "string" ? d.title : `Day ${i + 1}`,
      stops,
    };
  });

  return { days };
}

function normalizeStop(s: any): Stop {
  const category =
    typeof s?.category === "string" && VALID_CATEGORIES.has(s.category)
      ? s.category
      : "experience";
  const loc = s?.location ?? {};
  return {
    name: String(s?.name ?? "Unnamed stop"),
    category,
    description: String(s?.description ?? ""),
    start_time:
      typeof s?.start_time === "string" ? s.start_time : "09:00",
    duration_minutes:
      typeof s?.duration_minutes === "number" ? s.duration_minutes : 90,
    priority:
      typeof s?.priority === "number"
        ? Math.min(5, Math.max(1, Math.round(s.priority)))
        : 3,
    tags: Array.isArray(s?.tags) ? s.tags.map((t: any) => String(t)) : [],
    location: {
      address: loc?.address != null ? String(loc.address) : null,
      area: loc?.area != null ? String(loc.area) : null,
      lat: typeof loc?.lat === "number" ? loc.lat : null,
      lng: typeof loc?.lng === "number" ? loc.lng : null,
    },
    tripadvisor: normalizeTripAdvisor(s?.tripadvisor),
  };
}

/**
 * Normalize an optional TripAdvisor reference. Returns null unless a usable
 * url is present, so partners can do a simple null-check before rendering.
 */
function normalizeTripAdvisor(ta: any): TripAdvisorRef | null {
  const url = typeof ta?.url === "string" && ta.url.trim() ? ta.url.trim() : null;
  if (!url) return null;
  return {
    url,
    rating: typeof ta?.rating === "number" ? ta.rating : null,
    review_count:
      typeof ta?.review_count === "number" ? ta.review_count : null,
  };
}

// ---------------------------------------------------------------------------
// Template fallback — deterministic, built from cached sights
// ---------------------------------------------------------------------------

function buildTemplateItinerary(
  destination: string,
  days: number,
  sights: Sight[],
  _preferences: string[]
): Itinerary {
  const stopsPerDay = days <= 2 ? 5 : days <= 6 ? 4 : 4;
  const dayPlans: DayPlan[] = [];
  let idx = 0;

  for (let d = 0; d < days; d++) {
    const stops: Stop[] = [];
    let minutes = 9 * 60; // start 09:00
    for (let j = 0; j < stopsPerDay && idx < sights.length; j++, idx++) {
      const sight = sights[idx];
      const dur = parseDurationHours(sight.estDurationHours) * 60;
      stops.push({
        name: sight.name,
        category: "landmark",
        description: sight.shortDescription ?? "",
        start_time: minutesToHHMM(minutes),
        duration_minutes: dur,
        // earlier sights in the curated list are the iconic ones
        priority: idx < 6 ? 1 : idx < 14 ? 2 : 3,
        tags: [],
        location: {
          address: sight.neighborhoodOrArea ?? null,
          area: sight.neighborhoodOrArea ?? null,
          lat: sight.latitude ?? null,
          lng: sight.longitude ?? null,
        },
        tripadvisor: null,
      });
      minutes += dur + 30; // +30 min travel/buffer
    }
    dayPlans.push({
      day: d + 1,
      title: `Day ${d + 1} in ${destination}`,
      stops,
    });
  }

  return { days: dayPlans };
}

function parseDurationHours(v?: string): number {
  if (!v) return 1.5;
  const m = /(\d+(?:\.\d+)?)/.exec(v);
  const n = m ? parseFloat(m[1]) : 1.5;
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// TripAdvisor enrichment — attach restaurant profile links to food stops.
//
// Speed/safety contract:
//  - Runs INSIDE the async generation job (the partner already has a 202 and is
//    polling), and the result is baked into the stored itinerary so cache hits
//    stay instant.
//  - Hard total time budget (ENRICH_BUDGET_MS). If TripAdvisor is slow or down,
//    we abort and return the itinerary unchanged (stops keep tripadvisor:null).
//  - One search call per destination + a few parallel detail calls only for
//    matched food stops. Never throws.
// ---------------------------------------------------------------------------

const FOOD_CATEGORIES = new Set(["restaurant", "cafe", "bar"]);
const ENRICH_BUDGET_MS = 6000;
const TA_SEARCH_TIMEOUT_MS = 3000;
const TA_DETAIL_TIMEOUT_MS = 2500;
const TA_MAX_DETAIL_CALLS = 10;

async function enrichItineraryWithTripAdvisor(
  itinerary: Itinerary,
  destination: string
): Promise<Itinerary> {
  const key = process.env.TRIPADVISOR_API_KEY;
  if (!key) return itinerary;

  // Collect food stops that still need a link.
  const foodStops: Stop[] = [];
  for (const day of itinerary.days) {
    for (const stop of day.stops) {
      if (FOOD_CATEGORIES.has(stop.category) && stop.tripadvisor == null) {
        foodStops.push(stop);
      }
    }
  }
  if (foodStops.length === 0) return itinerary;

  try {
    await raceBudget(
      enrichFoodStops(key, destination, foodStops),
      ENRICH_BUDGET_MS
    );
  } catch (err) {
    console.warn(
      `[partnerGen] TripAdvisor enrichment skipped for ${destination}:`,
      err instanceof Error ? err.message : err
    );
  }
  return itinerary;
}

/** Reject if the work doesn't finish within ms (work keeps the partial result). */
function raceBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`enrichment budget ${ms}ms exceeded`)), ms)
    ),
  ]);
}

async function enrichFoodStops(
  key: string,
  destination: string,
  foodStops: Stop[]
): Promise<void> {
  // Search TripAdvisor per restaurant name and attach the profile link.
  // Capped at TA_MAX_DETAIL_CALLS stops; all run in parallel within the budget.
  const targets = foodStops.slice(0, TA_MAX_DETAIL_CALLS);
  await Promise.all(
    targets.map(async (stop) => {
      try {
        const ref = await lookupRestaurant(key, stop.name, destination);
        if (ref) stop.tripadvisor = ref;
      } catch {
        // Leave this stop's tripadvisor as null on any per-stop failure.
      }
    })
  );
}

/** Find a single restaurant's TripAdvisor profile by name; null if no confident match. */
async function lookupRestaurant(
  key: string,
  name: string,
  destination: string
): Promise<TripAdvisorRef | null> {
  const searchUrl =
    `https://api.content.tripadvisor.com/api/v1/location/search?key=${key}` +
    `&searchQuery=${encodeURIComponent(name + " " + destination)}` +
    `&category=restaurants&language=en`;
  const data = await fetchJson(searchUrl, TA_SEARCH_TIMEOUT_MS);
  const items: Array<{ id: string; name: string }> = Array.isArray(data?.data)
    ? data.data
        .filter((it: any) => it?.location_id && it?.name)
        .map((it: any) => ({ id: String(it.location_id), name: String(it.name) }))
    : [];
  if (items.length === 0) return null;

  // Confident match only: exact normalized name, or strong containment.
  const id = matchPoolEntry(name, items, new Set());
  if (!id) return null;

  // Fetch details for the real web_url + rating + review count.
  try {
    const detailsUrl =
      `https://api.content.tripadvisor.com/api/v1/location/${id}/details` +
      `?key=${key}&language=en`;
    const details = await fetchJson(detailsUrl, TA_DETAIL_TIMEOUT_MS);
    const url =
      typeof details?.web_url === "string" && details.web_url.trim()
        ? details.web_url.trim()
        : `https://www.tripadvisor.com/Restaurant_Review-g${id}`;
    const rating = details?.rating != null ? parseFloat(details.rating) : NaN;
    const reviews =
      details?.num_reviews != null ? parseInt(details.num_reviews, 10) : NaN;
    return {
      url,
      rating: Number.isFinite(rating) ? rating : null,
      review_count: Number.isFinite(reviews) ? reviews : null,
    };
  } catch {
    // Details failed but we have a confident id — return a basic profile link.
    return {
      url: `https://www.tripadvisor.com/Restaurant_Review-g${id}`,
      rating: null,
      review_count: null,
    };
  }
}

/** Normalize a venue name for loose matching. */
function normalizeVenueName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find the best pool entry id for a stop name; prefers exact, then containment. */
function matchPoolEntry(
  stopName: string,
  pool: Array<{ id: string; name: string }>,
  usedIds: Set<string>
): string | null {
  const target = normalizeVenueName(stopName);
  if (!target) return null;

  let containsMatch: string | null = null;
  for (const entry of pool) {
    if (usedIds.has(entry.id)) continue;
    const candidate = normalizeVenueName(entry.name);
    if (!candidate) continue;
    if (candidate === target) return entry.id; // exact wins immediately
    if (
      containsMatch == null &&
      (candidate.includes(target) || target.includes(candidate))
    ) {
      containsMatch = entry.id;
    }
  }
  return containsMatch;
}

/** GET JSON with an AbortController timeout. Throws on non-2xx or timeout. */
async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Webhook delivery (HMAC-SHA256 signed)
// ---------------------------------------------------------------------------

async function fireWebhook(ctx: any, docId: any): Promise<void> {
  const record = await ctx.runQuery(internal.partnerApi.getDoc, { docId });
  if (!record || !record.webhookUrl) return;

  const key = await ctx.runQuery(internal.partnerApiAuth.getKeyById, {
    keyId: record.keyId,
  });
  if (!key) return;

  const payload = {
    event:
      record.status === "ready" ? "itinerary.ready" : "itinerary.failed",
    itinerary_id: record.itineraryId,
    status: record.status,
    partner_ref: record.partnerRef,
    source: record.source ?? null,
    destination: record.destination,
    days: record.days,
    preferences: record.preferences,
    itinerary: record.itinerary ?? null,
    error: record.error ?? null,
  };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Sign "<timestamp>.<body>" to bind the signature to its delivery time.
  const signature = await hmacSha256Hex(key.webhookSecret, `${timestamp}.${body}`);

  try {
    const res = await fetch(record.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Planera-Event": payload.event,
        "X-Planera-Timestamp": timestamp,
        "X-Planera-Signature": `sha256=${signature}`,
      },
      body,
    });
    if (res.ok) {
      await ctx.runMutation(internal.partnerApi.markWebhookDelivered, {
        docId,
      });
    } else {
      console.warn(
        `[partnerGen] webhook ${record.webhookUrl} responded ${res.status}`
      );
    }
  } catch (err) {
    console.error(`[partnerGen] webhook delivery failed:`, err);
  }
}
