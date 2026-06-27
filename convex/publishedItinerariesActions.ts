"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import OpenAI from "openai";

// ── Curated attraction-affiliate matching (mirrors tripsActions.ts) ──
interface AttractionAffiliateLink {
    _id?: string;
    activityTitle: string;
    displayTitle?: string;
    affiliateUrl: string;
    partner?: string;
    active: boolean;
}
function normAff(value: string | undefined | null): string {
    if (!value) return "";
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ");
}
function affTitlesMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.split(" ").length < 2) return false;
    return (
        longer.startsWith(shorter + " ") ||
        longer.endsWith(" " + shorter) ||
        longer.includes(" " + shorter + " ")
    );
}
function findAffLink(key: string, links: AttractionAffiliateLink[]): AttractionAffiliateLink | undefined {
    for (const l of links) {
        if (normAff(l.activityTitle) === key || normAff(l.displayTitle) === key) return l;
    }
    for (const l of links) {
        if (affTitlesMatch(key, normAff(l.activityTitle)) || affTitlesMatch(key, normAff(l.displayTitle))) {
            return l;
        }
    }
    return undefined;
}
/**
 * Attach curated affiliate links to matching sights (slots) by place name —
 * same matching as the app's activities. Mutates `days` in place. Re-runnable:
 * clears any stale link whose curated mapping was removed. Returns match count.
 */
function enrichSlotsWithAffiliates(days: any[], links: AttractionAffiliateLink[]): number {
    const active = (links || []).filter((l) => l.active);
    let matched = 0;
    for (const day of days || []) {
        for (const slot of day.slots || []) {
            const key = normAff(slot.place);
            const link = key && active.length ? findAffLink(key, active) : undefined;
            if (link) {
                slot.affiliateUrl = link.affiliateUrl;
                slot.affiliatePartner = link.partner || "getyourguide";
                matched++;
            } else if (slot.affiliateUrl) {
                delete slot.affiliateUrl;
                delete slot.affiliatePartner;
            }
        }
    }
    return matched;
}

/**
 * Country values are sometimes an IATA airport code (e.g. "PMO", "BUD") — drop
 * those. Legitimate 3-letter country names (USA, UAE) are kept via an allowlist.
 */
const REAL_3LETTER_COUNTRIES = new Set(["USA", "UAE", "UK"]);
function sanitizeCountry(raw: string | undefined): string {
    const c = (raw || "").trim();
    if (/^[A-Z]{3}$/.test(c) && !REAL_3LETTER_COUNTRIES.has(c)) return "";
    return c;
}

/**
 * Aggregation action: merge multiple user-generated trip itineraries
 * into a single curated SEO itinerary for public consumption.
 */
export const aggregateAndPublish = internalAction({
    args: {
        destinationKey: v.string(), // e.g. "athens-3"
    },
    returns: v.null(),
    handler: async (ctx, { destinationKey }) => {
        // 1. Get the aggregation record
        const agg = await ctx.runQuery(
            internal.publishedItineraries.getAggregation,
            { destinationKey }
        );
        if (!agg) {
            console.warn(`No aggregation found for ${destinationKey}`);
            return null;
        }

        // 2. Fetch the completed trips
        const trips = await ctx.runQuery(
            internal.publishedItineraries.getTripsForAggregation,
            { tripIds: agg.tripIds }
        );
        if (trips.length === 0) {
            console.warn(`No completed trips for ${destinationKey}`);
            return null;
        }

        // 3. Extract day-by-day itinerary data from each trip
        const tripSummaries = trips.map((trip: any) => {
            const itinerary = trip.itinerary;
            if (!itinerary?.dayByDayItinerary) return null;
            return {
                destination: trip.destination,
                durationDays: Math.ceil(
                    (trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24)
                ),
                budget: trip.budgetTotal || trip.budget || null,
                travelers: trip.travelerCount || trip.travelers || 1,
                interests: trip.interests || [],
                dayByDay: itinerary.dayByDayItinerary.map((day: any) => ({
                    day: day.day,
                    title: day.title,
                    activities: (day.activities || []).map((a: any) => ({
                        time: a.startTime || a.time,
                        title: a.title,
                        description: a.description,
                        address: a.address,
                        type: a.type,
                        price: a.price,
                        currency: a.currency,
                        durationMinutes: a.durationMinutes,
                        tips: a.tips,
                        culinary: a.culinary,
                    })),
                })),
                estimatedDailyExpenses: itinerary.estimatedDailyExpenses,
            };
        }).filter(Boolean);

        if (tripSummaries.length === 0) {
            console.warn(`No valid itinerary data for ${destinationKey}`);
            return null;
        }

        // 4. Get existing slugs for related itineraries
        const relatedSlugs = await ctx.runQuery(
            internal.publishedItineraries.listSlugsByDestination,
            { destination: agg.destination }
        );

        // 5. Call OpenAI to aggregate
        const openai = new OpenAI();
        const slug = destinationKey.replace(/\s+/g, "-").toLowerCase();

        const prompt = `You are a travel content expert. I have ${tripSummaries.length} real user-generated trip itineraries for ${agg.destination} (${agg.durationDays} days). Merge them into ONE curated, SEO-optimized itinerary.

Here are the source itineraries:
${JSON.stringify(tripSummaries, null, 2)}

Output a JSON object with EXACTLY this structure (no markdown, no explanation, just valid JSON):
{
  "title": "string — SEO title like '${agg.destination} in ${agg.durationDays} Days: The Perfect Itinerary'",
  "meta_description": "string — 150-160 char SEO meta description",
  "intro": "string — 2-3 engaging paragraphs introducing the trip",
  "budget_level": "budget" | "mid-range" | "luxury",
  "budget_per_day_eur": number,
  "best_for": ["array of 3-5 traveler types, e.g. 'Culture Lovers', 'Foodies'"],
  "best_season": "string — e.g. 'April to October'",
  "days": [
    {
      "day_number": 1,
      "title": "string — catchy day title",
      "slots": [
        {
          "time_of_day": "morning" | "afternoon" | "evening",
          "place": "string — name of place/attraction",
          "description": "string — 2-3 sentences about the experience",
          "duration_hours": number,
          "category": "culture" | "food" | "beach" | "walking" | "shopping" | "nature" | "nightlife" | "adventure" | "relaxation",
          "coordinates": { "lat": number, "lng": number }
        }
      ],
      "meals": [
        {
          "type": "breakfast" | "lunch" | "dinner",
          "name": "string — restaurant or area name",
          "cuisine": "string",
          "price_range": "€" | "€€" | "€€€"
        }
      ],
      "daily_budget": {
        "meals": number,
        "activities": number,
        "transport": number
      }
    }
  ],
  "practical_info": {
    "getting_around": "string",
    "where_to_stay": "string",
    "money_tips": "string",
    "safety": "string",
    "connectivity": "string"
  },
  "faqs": [
    { "question": "string", "answer": "string" }
  ]
}

Rules:
- Pick the BEST activities/restaurants from all trips, don't just copy one trip
- Each day should have 3 slots (morning, afternoon, evening)
- Each day should have 3 meals (breakfast, lunch, dinner)
- Include real coordinates (lat/lng) for each place
- Write engaging, travel-blog-style descriptions
- Include 5-8 FAQs about visiting ${agg.destination}
- Budget should reflect the average from the source trips
- Provide practical info based on the destination`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.error("OpenAI returned empty content for aggregation");
            return null;
        }

        let parsed: any;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            console.error("Failed to parse OpenAI response:", content);
            return null;
        }

        // 6. Determine continent from country
        const continent = guessContinent(agg.country || "");

        // 7. Build the slug — filter out current slug from related
        const finalSlug = `${slug}-days`;
        const related = relatedSlugs.filter((s: string) => s !== finalSlug);

        // 7b. Hero image from Unsplash (with attribution), queried by the clean
        // city name so airport-code "country" values can't poison the search.
        const country = sanitizeCountry(agg.country);
        let heroImage = "";
        let heroImageData: any = undefined;
        try {
            const img = await ctx.runAction(api.images.getDestinationImage, {
                destination: agg.destination,
            });
            if (img) {
                heroImage = img.url;
                heroImageData = {
                    photographer: img.photographer,
                    photographerUrl: img.photographerUrl,
                    attribution: img.attribution,
                    downloadLocation: img.downloadLocation,
                };
            }
        } catch (e) {
            console.error(`hero image fetch failed for ${finalSlug}:`, e);
        }

        // 7c. Attach curated affiliate links to matching sights (curated-only,
        // same matching as the app). Mutates parsed.days in place.
        try {
            const links = await ctx.runQuery(
                api.lowFareRadar.getActiveAttractionLinksForDestination,
                { destinationCity: agg.destination },
            );
            const n = enrichSlotsWithAffiliates(parsed.days || [], (links as any[]) || []);
            if (n > 0) console.log(`Attached ${n} affiliate link(s) to ${finalSlug} sights`);
        } catch (e) {
            console.error(`affiliate enrich failed for ${finalSlug}:`, e);
        }

        // 8. Upsert the published itinerary
        await ctx.runMutation(internal.publishedItineraries.upsert, {
            slug: finalSlug,
            destination: agg.destination,
            country,
            continent,
            durationDays: agg.durationDays,
            title: parsed.title || `${agg.destination} in ${agg.durationDays} Days`,
            metaDescription: parsed.meta_description || "",
            intro: parsed.intro || "",
            budgetLevel: parsed.budget_level || "mid-range",
            budgetPerDayEur: parsed.budget_per_day_eur || 80,
            bestFor: parsed.best_for || [],
            bestSeason: parsed.best_season || "",
            heroImage,
            heroImageData,
            days: parsed.days || [],
            practicalInfo: parsed.practical_info || {},
            faqs: parsed.faqs || [],
            relatedItineraries: related,
            sourceTripCount: trips.length,
            // New rows land as drafts; upsert preserves status on re-aggregation,
            // so already-approved itineraries stay live when refreshed.
            status: "draft",
        });

        console.log(
            `✅ Aggregated itinerary "${finalSlug}" from ${trips.length} trips (status: draft until approved)`
        );

        // 9. Translate the text fields into the app's other 5 languages and store
        // them. English stays canonical; the website overlays the active locale.
        try {
            const translations = await translateItinerary(openai, parsed);
            await ctx.runMutation(internal.publishedItineraries.setTranslations, {
                slug: finalSlug,
                translations,
            });
            console.log(
                `🌍 Stored ${Object.keys(translations).length} translations for "${finalSlug}"`
            );
        } catch (e) {
            // Translations are best-effort — never fail the whole aggregation.
            console.error(`Translation failed for "${finalSlug}":`, e);
        }

        return null;
    },
});

/** Target locales (English is canonical and not re-translated). */
const TRANSLATION_LOCALES: Record<string, string> = {
    el: "Greek",
    es: "Spanish",
    fr: "French",
    de: "German",
    ar: "Arabic",
};

/**
 * Translate only the human-readable text of a parsed English itinerary into each
 * target locale, preserving structure/order so the client can overlay by index.
 * Returns `{ [locale]: { title, metaDescription, intro, bestFor, bestSeason,
 * days[{title,slots[{place,description}],meals[{name,cuisine}]}], practicalInfo, faqs } }`.
 */
async function translateItinerary(openai: any, parsed: any) {
    // Compact source: only the fields that contain natural-language text.
    const source = {
        title: parsed.title,
        meta_description: parsed.meta_description,
        intro: parsed.intro,
        best_for: parsed.best_for || [],
        best_season: parsed.best_season || "",
        days: (parsed.days || []).map((d: any) => ({
            title: d.title,
            slots: (d.slots || []).map((s: any) => ({
                place: s.place,
                description: s.description,
            })),
            meals: (d.meals || []).map((m: any) => ({
                name: m.name,
                cuisine: m.cuisine,
            })),
        })),
        practical_info: parsed.practical_info || {},
        faqs: parsed.faqs || [],
    };

    const translations: Record<string, any> = {};
    for (const [locale, language] of Object.entries(TRANSLATION_LOCALES)) {
        const prompt = `Translate the natural-language string VALUES of the following travel-itinerary JSON into ${language}. Rules:
- Keep the EXACT same JSON structure, keys, array lengths and array order.
- Translate ONLY human-readable text (titles, descriptions, questions, answers, season, traveler types, place/restaurant DESCRIPTIONS).
- Keep proper nouns / place names natural for ${language} readers (transliterate where that's the norm).
- Do NOT add, remove, reorder, or merge any array items.
- Return ONLY the JSON object, no markdown.

JSON:
${JSON.stringify(source)}`;

        try {
            const resp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                response_format: { type: "json_object" },
            });
            const content = resp.choices[0]?.message?.content;
            if (!content) continue;
            const t = JSON.parse(content);
            translations[locale] = {
                title: t.title,
                metaDescription: t.meta_description,
                intro: t.intro,
                bestFor: t.best_for,
                bestSeason: t.best_season,
                days: t.days,
                practicalInfo: t.practical_info,
                faqs: t.faqs,
            };
        } catch (e) {
            console.error(`  translation (${locale}) failed:`, e);
            // Skip this locale; the client falls back to English.
        }
    }
    return translations;
}

/** Minimum completed real trips for a destination+duration before we publish. */
const PUBLISH_THRESHOLD = 3;

/**
 * Cron entry-point: find destinations that have hit the trip threshold and are
 * new or stale, then (re)aggregate each. Batching in a cron keeps the OpenAI
 * cost predictable vs. firing on every trip completion.
 */
export const publishPendingAggregations = internalAction({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        const keys = await ctx.runQuery(
            internal.publishedItineraries.listAggregationsToPublish,
            { threshold: PUBLISH_THRESHOLD }
        );
        if (keys.length === 0) {
            console.log("publishPendingAggregations: nothing to publish");
            return null;
        }
        console.log(`publishPendingAggregations: scheduling ${keys.length} aggregation(s)`);
        // Stagger so concurrent OpenAI calls don't spike; isolate per-key failures.
        // MUST await the scheduler promises — dangling promises may never run.
        await Promise.all(
            keys.map((destinationKey: string, i: number) =>
                ctx.scheduler.runAfter(
                    i * 2000,
                    internal.publishedItinerariesActions.aggregateAndPublish,
                    { destinationKey }
                )
            )
        );
        return null;
    },
});

/**
 * One-off backfill: fetch + store an Unsplash hero image (with attribution) for
 * every published itinerary that lacks one, and clean up airport-code countries.
 * Safe to re-run; only touches rows missing a hero image (unless forceAll).
 */
export const backfillHeroImages = internalAction({
    args: { forceAll: v.optional(v.boolean()) },
    returns: v.object({ scanned: v.float64(), updated: v.float64() }),
    handler: async (ctx, { forceAll }) => {
        const rows: any[] = await ctx.runQuery(internal.publishedItineraries.listAllRows, {});
        let updated = 0;
        for (const row of rows) {
            const needsImage = forceAll || !row.heroImage;
            // Re-derive country from the source aggregation (truth) so a value we
            // previously over-sanitized (e.g. "USA") can be restored.
            const destinationKey = row.slug.replace(/-days$/, "");
            const agg = await ctx.runQuery(
                internal.publishedItineraries.getAggregation,
                { destinationKey }
            );
            const fixedCountry = sanitizeCountry(agg?.country ?? row.country);
            const needsCountry = fixedCountry !== (row.country || "");
            if (!needsImage && !needsCountry) continue;

            let heroImage = row.heroImage || "";
            let heroImageData: any = row.heroImageData;
            if (needsImage) {
                try {
                    const img = await ctx.runAction(api.images.getDestinationImage, {
                        destination: row.destination,
                    });
                    if (img) {
                        heroImage = img.url;
                        heroImageData = {
                            photographer: img.photographer,
                            photographerUrl: img.photographerUrl,
                            attribution: img.attribution,
                            downloadLocation: img.downloadLocation,
                        };
                    }
                } catch (e) {
                    console.error(`backfill image failed for ${row.slug}:`, e);
                }
            }
            await ctx.runMutation(internal.publishedItineraries.setHeroImage, {
                slug: row.slug,
                heroImage,
                heroImageData,
                country: needsCountry ? fixedCountry : undefined,
            });
            updated++;
        }
        console.log(`backfillHeroImages: scanned ${rows.length}, updated ${updated}`);
        return { scanned: rows.length, updated };
    },
});

/**
 * Translate ONE published itinerary's stored English fields into the 5 other
 * locales and store them — WITHOUT regenerating its (approved) English content.
 * One row per action invocation keeps each call within the action time limit.
 */
export const translateOne = internalAction({
    args: { slug: v.string() },
    returns: v.null(),
    handler: async (ctx, { slug }) => {
        const rows: any[] = await ctx.runQuery(internal.publishedItineraries.listAllRows, {});
        const row = rows.find((r) => r.slug === slug);
        if (!row) return null;
        const parsed = {
            title: row.title,
            meta_description: row.metaDescription,
            intro: row.intro,
            best_for: row.bestFor || [],
            best_season: row.bestSeason || "",
            days: row.days || [],
            practical_info: row.practicalInfo || {},
            faqs: row.faqs || [],
        };
        const openai = new OpenAI();
        const translations = await translateItinerary(openai, parsed);
        await ctx.runMutation(internal.publishedItineraries.setTranslations, {
            slug,
            translations,
        });
        console.log(`translateOne: ${slug} → ${Object.keys(translations).length} locales`);
        return null;
    },
});

/**
 * One-off backfill dispatcher: schedules a `translateOne` per itinerary that
 * lacks translations (staggered), so no single action does too many OpenAI
 * calls. Pass forceAll to re-translate everything.
 */
export const backfillTranslations = internalAction({
    args: { forceAll: v.optional(v.boolean()) },
    returns: v.object({ scheduled: v.float64() }),
    handler: async (ctx, { forceAll }) => {
        const rows: any[] = await ctx.runQuery(internal.publishedItineraries.listAllRows, {});
        const todo = rows.filter(
            (r) => forceAll || !(r.translations && Object.keys(r.translations).length > 0)
        );
        await Promise.all(
            todo.map((r, i) =>
                ctx.scheduler.runAfter(i * 30000, internal.publishedItinerariesActions.translateOne, {
                    slug: r.slug,
                })
            )
        );
        console.log(`backfillTranslations: scheduled ${todo.length} translateOne job(s)`);
        return { scheduled: todo.length };
    },
});

/**
 * One-off backfill: attach curated affiliate links to existing published
 * itineraries' sights (curated-only). Re-runnable — also clears links whose
 * curated mapping was removed. Run after adding/removing attractionAffiliateLinks.
 */
export const backfillSightAffiliates = internalAction({
    args: {},
    returns: v.object({ scanned: v.float64(), withLinks: v.float64() }),
    handler: async (ctx) => {
        const rows: any[] = await ctx.runQuery(internal.publishedItineraries.listAllRows, {});
        let withLinks = 0;
        for (const row of rows) {
            const links = await ctx.runQuery(
                api.lowFareRadar.getActiveAttractionLinksForDestination,
                { destinationCity: row.destination },
            );
            const days = row.days || [];
            const n = enrichSlotsWithAffiliates(days, (links as any[]) || []);
            await ctx.runMutation(internal.publishedItineraries.setDays, {
                slug: row.slug,
                days,
            });
            if (n > 0) {
                withLinks++;
                console.log(`backfillSightAffiliates: ${row.slug} → ${n} sight link(s)`);
            }
        }
        return { scanned: rows.length, withLinks };
    },
});

/** Simple continent guesser from country name */
function guessContinent(country: string): string {
    const c = country.toLowerCase();
    const europe = [
        "greece", "italy", "spain", "france", "germany", "portugal",
        "netherlands", "belgium", "austria", "switzerland", "czech republic",
        "czechia", "poland", "croatia", "hungary", "sweden", "norway",
        "denmark", "finland", "iceland", "ireland", "uk", "united kingdom",
        "england", "scotland", "turkey", "romania", "bulgaria", "serbia",
        "montenegro", "albania", "north macedonia", "slovenia", "slovakia",
        "estonia", "latvia", "lithuania", "malta", "cyprus", "luxembourg",
    ];
    const asia = [
        "japan", "china", "thailand", "vietnam", "indonesia", "india",
        "south korea", "malaysia", "philippines", "singapore", "cambodia",
        "laos", "myanmar", "sri lanka", "nepal", "taiwan", "hong kong",
        "maldives", "uae", "united arab emirates", "qatar", "oman",
        "jordan", "israel", "lebanon", "saudi arabia", "georgia", "armenia",
    ];
    const africa = [
        "morocco", "egypt", "south africa", "kenya", "tanzania", "ethiopia",
        "ghana", "nigeria", "tunisia", "senegal", "madagascar", "namibia",
        "botswana", "mozambique", "uganda", "rwanda",
    ];
    const samerica = [
        "brazil", "argentina", "colombia", "peru", "chile", "ecuador",
        "bolivia", "uruguay", "paraguay", "venezuela",
    ];
    const oceania = [
        "australia", "new zealand", "fiji", "samoa",
    ];
    const namerica = [
        "usa", "united states", "canada", "mexico", "costa rica",
        "panama", "cuba", "dominican republic", "jamaica", "bahamas",
        "puerto rico", "guatemala", "belize", "honduras",
    ];

    if (europe.some((e) => c.includes(e))) return "Europe";
    if (asia.some((e) => c.includes(e))) return "Asia";
    if (africa.some((e) => c.includes(e))) return "Africa";
    if (samerica.some((e) => c.includes(e))) return "South America";
    if (oceania.some((e) => c.includes(e))) return "Oceania";
    if (namerica.some((e) => c.includes(e))) return "North America";
    return "Europe"; // default
}
