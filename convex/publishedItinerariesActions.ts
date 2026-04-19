"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";

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

        // 8. Upsert the published itinerary
        await ctx.runMutation(internal.publishedItineraries.upsert, {
            slug: finalSlug,
            destination: agg.destination,
            country: agg.country || "",
            continent,
            durationDays: agg.durationDays,
            title: parsed.title || `${agg.destination} in ${agg.durationDays} Days`,
            metaDescription: parsed.meta_description || "",
            intro: parsed.intro || "",
            budgetLevel: parsed.budget_level || "mid-range",
            budgetPerDayEur: parsed.budget_per_day_eur || 80,
            bestFor: parsed.best_for || [],
            bestSeason: parsed.best_season || "",
            heroImage: "",
            days: parsed.days || [],
            practicalInfo: parsed.practical_info || {},
            faqs: parsed.faqs || [],
            relatedItineraries: related,
            sourceTripCount: trips.length,
        });

        console.log(
            `✅ Published itinerary "${finalSlug}" from ${trips.length} trips`
        );
        return null;
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
