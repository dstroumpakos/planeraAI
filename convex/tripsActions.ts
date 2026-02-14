"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import * as duffel from "./flights/duffel";
import { FEATURES } from "./_features";

// Helper function to generate travel style guidance for OpenAI prompt
function generateTravelStyleGuidance(interests: string[]): string {
    if (!interests || interests.length === 0) {
        return "Create a balanced itinerary with a mix of attractions, dining, and cultural experiences.";
    }

    const styleGuidance: Record<string, string> = {
        "Shopping": "Prioritize shopping experiences throughout the itinerary. Include major shopping districts, malls, boutique areas, and local markets. For each day, suggest at least one shopping activity or visit. Recommend best shopping neighborhoods, flagship stores, and unique local shops. Include shopping tips like best times to visit and local shopping customs.",
        "Nightlife": "Emphasize evening and nighttime activities. Include rooftop bars, nightclubs, live music venues, late-night dining, and evening entertainment. For each day, suggest evening activities and nightlife spots. Recommend the best neighborhoods for nightlife, popular venues, and what to expect. Include tips on dress codes and reservation requirements.",
        "Food": "Make food the centerpiece of the itinerary. Include diverse dining experiences from street food to fine dining. For each day, suggest multiple food-related activities: breakfast spots, lunch venues, dinner restaurants, and food tours. Highlight local specialties, food markets, and culinary experiences. Include food tours, cooking classes, and market visits.",
        "Culture": "Emphasize cultural and historical experiences. Prioritize museums, historical landmarks, galleries, cultural sites, and heritage attractions. For each day, include at least one major cultural attraction. Recommend UNESCO sites, local history museums, art galleries, and cultural events. Include information about local history and cultural significance.",
        "Nature": "Prioritize outdoor and natural experiences. Include parks, gardens, hiking trails, viewpoints, and outdoor activities. For each day, suggest outdoor experiences and nature-based activities. Recommend scenic viewpoints, nature walks, outdoor adventures, and the best times for outdoor activities. Include information about weather and what to bring.",
    };

    const guidance = interests
        .map(interest => styleGuidance[interest])
        .filter(Boolean)
        .join(" ");

    if (interests.length > 1) {
        return `Blend these travel styles naturally throughout the itinerary: ${guidance} Ensure recommendations reflect all selected interests while maintaining a cohesive daily flow. Distribute activities across the day to balance all interests.`;
    }

    return guidance;
}

// Helper function to generate local experiences guidance for OpenAI prompt
function generateLocalExperiencesGuidance(localExperiences: string[] | undefined): string {
    if (!localExperiences || localExperiences.length === 0) {
        return "";
    }

    const experienceLabels: Record<string, string> = {
        "local-food": "local food and street food spots (authentic eateries, food stalls, and local favorites where residents actually eat)",
        "markets": "traditional markets (farmers markets, flea markets, antique markets, and local produce markets)",
        "hidden-gems": "hidden gems and off-the-beaten-path locations (secret spots, lesser-known attractions, local favorites)",
        "workshops": "cultural workshops and hands-on experiences (cooking classes, craft workshops, art sessions, traditional crafts)",
        "nature": "nature and outdoor spots that locals love (neighborhood parks, scenic walks, local hiking spots, urban gardens)",
        "nightlife": "nightlife and local bars (neighborhood bars, local pubs, live music venues, late-night spots where locals go)",
        "neighborhoods": "authentic neighborhood walks (residential areas, local streets, community spots, away from tourist zones)",
        "festivals": "festivals and seasonal events (local celebrations, community events, seasonal activities happening during the visit)",
    };

    const selectedExperiences = localExperiences
        .map(exp => experienceLabels[exp])
        .filter(Boolean);

    if (selectedExperiences.length === 0) {
        return "";
    }

    return `

LOCAL EXPERIENCES PRIORITY: The traveler wants authentic, non-touristy experiences. Prioritize these in the itinerary:
${selectedExperiences.map(exp => `- ${exp}`).join("\n")}

Guidelines for local experiences:
- Recommend places where locals actually go, not tourist traps
- Include specific neighborhood names and local tips
- Avoid generic tourist recommendations when possible
- Do NOT include prices, booking links, or ticket information for these experiences
- Focus on atmosphere, authenticity, and local connection`;
}

// Helper function to generate budget-aware guidance for OpenAI prompt
function generateBudgetGuidance(
    budgetTotal: number | undefined,
    travelerCount: number,
    tripDays: number,
    destination: string
): { budgetTier: string; guidance: string; dailyBudgetPerPerson: number } {
    // Fallback to moderate if no budget provided
    if (!budgetTotal || budgetTotal <= 0) {
        return {
            budgetTier: "moderate",
            dailyBudgetPerPerson: 0,
            guidance: `
**BUDGET GUIDANCE (Moderate assumed — no budget specified):**
No specific budget was provided. Assume a MODERATE budget and provide balanced recommendations.
- Suggest 2–3 activities per day mixing paid attractions with free experiences
- Include standard ticketed museums, popular sights, and mid-range dining
- Recommend public transport primarily, walking when practical
- Include some special experiences (a food tour, a guided walk) balanced with self-guided exploration
Note: Budget was not specified by the traveler, so assume moderate spending (~€100/person/day).`,
        };
    }

    const perPersonBudget = Math.round(budgetTotal / travelerCount);
    const dailyBudgetPerPerson = Math.round(perPersonBudget / Math.max(tripDays, 1));

    // Classify budget tier based on daily per-person spending
    // Low: ≤ €60 | Moderate: €60–€150 | High: €150–€300 | Premium: > €300
    let budgetTier: string;
    let guidance: string;

    if (dailyBudgetPerPerson > 300) {
        budgetTier = "premium";
        guidance = `
**BUDGET GUIDANCE (PREMIUM — €${dailyBudgetPerPerson}/person/day):**
Total trip budget: €${budgetTotal} for ${travelerCount} traveler${travelerCount > 1 ? "s" : ""} over ${tripDays} days (€${perPersonBudget} per person total).

This is a premium-tier trip. Curate 5–6 total items per day (3–4 experiences + 1–2 dining) focused on comfort and exclusivity:
- Include exclusive or VIP activities: private tours, skip-the-line VIP access, private cooking classes with chefs, sunset yacht rides, helicopter tours, wine estate visits
- Recommend fine dining: Michelin-mentioned restaurants, tasting menus, rooftop dining, chef's table experiences
- Prioritize time-efficient routing: private transfers, taxis, minimal transit waste
- Still weave in 1–2 authentic local experiences per day — luxury should not mean tourist traps
- Suggest premium accommodation-adjacent activities (spa, concierge-arranged tours)
- Avoid over-scheduling: quality over quantity, allow breathing room between experiences
- Estimated daily spending: ~€${Math.round(dailyBudgetPerPerson * 0.35)} activities, ~€${Math.round(dailyBudgetPerPerson * 0.45)} dining, ~€${Math.round(dailyBudgetPerPerson * 0.20)} transport/misc`;
    } else if (dailyBudgetPerPerson >= 150) {
        budgetTier = "high";
        guidance = `
**BUDGET GUIDANCE (HIGH — €${dailyBudgetPerPerson}/person/day):**
Total trip budget: €${budgetTotal} for ${travelerCount} traveler${travelerCount > 1 ? "s" : ""} over ${tripDays} days (€${perPersonBudget} per person total).

This is a high-budget trip. Suggest 4–5 total items per day (3 activities + 1 dinner) with quality emphasis:
- Include guided tours, unique cultural experiences, and higher-quality venues
- Recommend skip-the-line tickets for popular attractions
- Suggest a mix of upscale restaurants and well-regarded local eateries
- Optimize convenience: shorter transit routes, occasional taxi/rideshare where sensible
- Include unique splurge-worthy activities (cooking class, evening cruise, exclusive tasting) — at least one per day
- Reduce excessive walking between distant points; cluster activities geographically
- Estimated daily spending: ~€${Math.round(dailyBudgetPerPerson * 0.35)} activities, ~€${Math.round(dailyBudgetPerPerson * 0.43)} dining, ~€${Math.round(dailyBudgetPerPerson * 0.22)} transport/misc`;
    } else if (dailyBudgetPerPerson > 60) {
        budgetTier = "moderate";
        guidance = `
**BUDGET GUIDANCE (MODERATE — €${dailyBudgetPerPerson}/person/day):**
Total trip budget: €${budgetTotal} for ${travelerCount} traveler${travelerCount > 1 ? "s" : ""} over ${tripDays} days (€${perPersonBudget} per person total).

This is a moderate-budget trip. STRICTLY limit to 3 total items per day (2 activities + 1 dinner):
- Mix paid attractions (museums, monuments) with free experiences (parks, viewpoints, neighborhoods)
- Include standard ticketed museums, popular sights, and mid-range dining
- Recommend popular restaurants with good value, local eateries, and some street food
- Use public transport primarily, walking when practical
- Include some special experiences (a food tour, a guided walking tour) but balance with self-guided exploration
- Do NOT exceed 3 items per full day — quality over quantity
- Estimated daily spending: ~€${Math.round(dailyBudgetPerPerson * 0.35)} activities, ~€${Math.round(dailyBudgetPerPerson * 0.40)} dining, ~€${Math.round(dailyBudgetPerPerson * 0.25)} transport/misc`;
    } else {
        budgetTier = "low";
        guidance = `
**BUDGET GUIDANCE (LOW — €${dailyBudgetPerPerson}/person/day):**
Total trip budget: €${budgetTotal} for ${travelerCount} traveler${travelerCount > 1 ? "s" : ""} over ${tripDays} days (€${perPersonBudget} per person total).

This is a low-budget trip. STRICTLY limit to 2 total items per day (1 activity + 1 dinner). Focus on maximizing free value:
- Prioritize FREE attractions: free museum days, parks, public squares, street art, viewpoints, beach walks, public landmarks, neighborhood strolls
- Recommend affordable food: street food, local markets, bakeries, supermarkets, affordable cafes
- Use public transport or walking exclusively — no taxis
- Suggest free walking tours (tip-based), self-guided routes, and open-air attractions
- Limit paid attractions to at most 2 per day; prefer those under €15 per person
- Avoid expensive tours or premium experiences entirely
- Mention discount passes, free entry hours, or youth/student discounts where available
- Pack days efficiently to minimize transport costs
- Estimated daily spending: ~€${Math.round(dailyBudgetPerPerson * 0.30)} activities, ~€${Math.round(dailyBudgetPerPerson * 0.45)} dining, ~€${Math.round(dailyBudgetPerPerson * 0.25)} transport/misc`;
    }

    // Add group-size guidance
    if (travelerCount >= 5) {
        guidance += `

**GROUP SIZE ADJUSTMENTS (${travelerCount} travelers):**
- Large group: prefer activities that accommodate groups well (walking tours, outdoor experiences, group dining)
- Avoid overly crowded small venues; suggest open/spacious alternatives
- Consider group discounts where available
- Plan slightly fewer activities per day to account for group coordination time
- Restaurant recommendations should seat large parties — suggest reservations`;
    } else if (travelerCount >= 3) {
        guidance += `

**GROUP SIZE ADJUSTMENTS (${travelerCount} travelers):**
- Small group: balanced activity density
- Recommend restaurants that handle groups of ${travelerCount} easily
- Shared transport (e.g., single taxi/rideshare) may be cost-effective vs individual tickets`;
    }
    // Solo or couple (1-2) don't need special group guidance

    // Add universal rules
    guidance += `

**GENERAL ITINERARY RULES:**
- Always keep the itinerary geographically logical — cluster nearby activities together
- Distribute spending realistically across days (avoid front-loading or back-loading costs)
- Even with a high budget, do NOT over-schedule — leave breathing room
- Adjust activity types for the group size of ${travelerCount} traveler${travelerCount > 1 ? "s" : ""}`;

    return { budgetTier, dailyBudgetPerPerson, guidance };
}

// Helper function to generate time-aware itinerary guidance based on arrival/departure times
function generateTimeAwareGuidance(
    arrivalTime: string | undefined,
    departureTime: string | undefined,
    startDate: number,
    endDate: number
): { guidance: string; skipLastDay: boolean; firstDayStartTime: string | null; lastDayEndTime: string | null } {
    let guidance = "";
    let skipLastDay = false;
    let firstDayStartTime: string | null = null;
    let lastDayEndTime: string | null = null;
    
    if (arrivalTime) {
        const arrival = new Date(arrivalTime);
        const arrivalHour = arrival.getUTCHours();
        const arrivalMinutes = arrival.getUTCMinutes();
        const arrivalTimeDisplay = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinutes).padStart(2, '0')}`;
        
        // Determine first day activity guidance based on arrival time
        if (arrivalHour >= 20) {
            // Late evening arrival - no real activities possible
            firstDayStartTime = `${String(Math.min(arrivalHour + 2, 22)).padStart(2, '0')}:00`;
            guidance += `
**FIRST DAY (ARRIVAL DAY) — HARD CONSTRAINTS (DO NOT VIOLATE):**
- Airport arrival: ${arrivalTimeDisplay}
- This is a LATE EVENING arrival. After airport transfer + hotel check-in, there is almost no time left.
- ONLY schedule: a light dinner nearby the hotel OR a short evening stroll. Maximum 1 item on Day 1.
- ABSOLUTELY NO attractions, tours, museums, local experiences, cooking classes, food tours, workshops, cafés, or bakeries on Day 1.
- Day 1 is arrival only. Real activities start Day 2 morning.
`;
        } else if (arrivalHour >= 15) {
            // Afternoon arrival - very light activities only
            const earliestActivityHour = Math.min(arrivalHour + 3, 21);
            const earliestTime = `${String(earliestActivityHour).padStart(2, '0')}:00`;
            firstDayStartTime = earliestTime;
            guidance += `
**FIRST DAY (ARRIVAL DAY) — HARD CONSTRAINTS (DO NOT VIOLATE):**
- Airport arrival: ${arrivalTimeDisplay}
- After airport transfer (1-2h) + hotel check-in + freshening up = traveler is NOT free until ${earliestTime}.
- ⛔ Day 1 first activity startTime MUST be "${earliestTime}" or later. Any activity before ${earliestTime} is INVALID.
- ⛔ NO cafés, bakeries, museums, tours, attractions, local experiences, cooking classes, food tours, or workshops on Day 1.
- ✅ ONLY allowed: dinner at a nearby restaurant, a relaxed evening stroll. Maximum 1-2 light items.
- Day 1 is a partial arrival day. Full activity days start from Day 2.
`;
        } else if (arrivalHour >= 12) {
            // Mid-day arrival
            const earliestActivityHour = Math.min(arrivalHour + 3, 20);
            const earliestTime = `${String(earliestActivityHour).padStart(2, '0')}:00`;
            firstDayStartTime = earliestTime;
            guidance += `
**FIRST DAY (ARRIVAL DAY) — HARD CONSTRAINTS (DO NOT VIOLATE):**
- Airport arrival: ${arrivalTimeDisplay}
- After airport transfer (1-2h) + hotel check-in + freshening up = traveler is NOT free until ${earliestTime}.
- ⛔ Day 1 first activity startTime MUST be "${earliestTime}" or later. Any activity before ${earliestTime} is INVALID.
- ⛔ NO morning cafés/bakeries on Day 1. NO local experiences (cooking classes, food tours, workshops) on Day 1.
- ✅ You may schedule 1-2 light afternoon activities and dinner. Keep it relaxed.
- Day 1 is a partial arrival day. Full activity days start from Day 2.
`;
        } else {
            // Morning arrival - relatively full day but still need transit + check-in
            const earliestActivityHour = arrivalHour + 3;
            const earliestTime = `${String(earliestActivityHour).padStart(2, '0')}:00`;
            firstDayStartTime = earliestTime;
            guidance += `
**FIRST DAY (ARRIVAL DAY) — HARD CONSTRAINTS (DO NOT VIOLATE):**
- Airport arrival: ${arrivalTimeDisplay}
- After airport transfer (1-2h) + hotel check-in = traveler is NOT free until ${earliestTime}.
- ⛔ Day 1 first activity startTime MUST be "${earliestTime}" or later. Any activity before ${earliestTime} is INVALID.
- ⛔ NO local experiences (cooking classes, food tours, workshops) on Day 1.
- Schedule a lighter day with fewer activities than normal full days.
- Day 1 is a partial arrival day.
`;
        }
    }
    
    if (departureTime) {
        const departure = new Date(departureTime);
        const departureHour = departure.getUTCHours();
        const departureTimeDisplay = `${String(departureHour).padStart(2, '0')}:${String(departure.getUTCMinutes()).padStart(2, '0')}`;
        
        // Calculate end time (3 hours before departure for airport transfer)
        const endHour = departureHour - 3;
        
        if (departureHour >= 4 && departureHour <= 6) {
            // Very early morning departure - skip activities on last day entirely
            skipLastDay = true;
            guidance += `
**LAST DAY (DEPARTURE DAY) CONSTRAINTS:**
- Departure time: ${departureTimeDisplay}
- IMPORTANT: This is an early morning departure. Do NOT schedule any activities on the departure day.
- The traveler needs to rest and prepare the night before.
- Make the PREVIOUS day (Day before departure) lighter - activities should end by 20:00-21:00.
`;
        } else if (departureHour <= 10) {
            // Late morning departure - minimal morning activities
            skipLastDay = true;
            guidance += `
**LAST DAY (DEPARTURE DAY) CONSTRAINTS:**
- Departure time: ${departureTimeDisplay}
- This is a mid-morning departure. Skip activities on departure day - only early breakfast if time permits.
- All itinerary ends on the day before departure.
`;
        } else if (departureHour <= 14) {
            // Early afternoon departure - very light morning only
            lastDayEndTime = `${String(Math.max(7, endHour)).padStart(2, '0')}:00`;
            guidance += `
**LAST DAY (DEPARTURE DAY) CONSTRAINTS:**
- Departure time: ${departureTimeDisplay}
- Very limited time on departure day. Schedule only: breakfast and maybe a brief nearby activity.
- All activities must end by ${String(Math.max(7, endHour)).padStart(2, '0')}:00 at the latest (3 hours before departure for airport transfer).
- Keep packing and checkout time in mind.
`;
        } else {
            // Afternoon/evening departure - partial day available
            const safeEndHour = Math.max(9, endHour);
            lastDayEndTime = `${String(safeEndHour).padStart(2, '0')}:00`;
            guidance += `
**LAST DAY (DEPARTURE DAY) CONSTRAINTS:**
- Departure time: ${departureTimeDisplay}
- Partial day available. Activities must end by ${safeEndHour}:00 (3 hours before departure).
- Schedule lighter activities: breakfast, nearby sights, final shopping.
- Account for checkout time (usually 11:00-12:00) - may need luggage storage.
`;
        }
    }
    
    return { guidance, skipLastDay, firstDayStartTime, lastDayEndTime };
}

export const generate = internalAction({
    args: { 
        tripId: v.id("trips"), 
        prompt: v.string(), 
        skipFlights: v.optional(v.boolean()),
        skipHotel: v.optional(v.boolean()),
        preferredFlightTime: v.optional(v.string()),
        // Arrival/Departure times for time-aware itineraries
        arrivalTime: v.optional(v.string()),
        departureTime: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { tripId, skipFlights, skipHotel, preferredFlightTime, arrivalTime, departureTime } = args;

        console.log("=".repeat(80));
        console.log("🚀 TRIP GENERATION STARTED");
        console.log("=".repeat(80));
        console.log("Trip ID:", tripId);
        console.log("Prompt:", args.prompt);
        console.log("Skip Flights:", skipFlights ? "Yes" : "No");
        console.log("Skip Hotel:", skipHotel ? "Yes" : "No");
        console.log("Preferred Flight Time:", preferredFlightTime || "any");
        console.log("Arrival Time:", arrivalTime || "Not specified");
        console.log("Departure Time:", departureTime || "Not specified");

        // Get trip details
        const trip = await ctx.runQuery(internal.trips.getTripDetails, { tripId });
        if (!trip) {
            console.error("❌ Trip not found!");
            throw new Error("Trip not found");
        }
        
        console.log("📋 Trip details:", JSON.stringify(trip, null, 2));

        // Default origin if not set (for backward compatibility with old trips)
        const origin = trip.origin || "London";

        console.log("✅ Trip details loaded:");
        console.log("  - Destination:", trip.destination);
        console.log("  - Origin:", origin);
        console.log("  - Start Date:", new Date(trip.startDate).toISOString());
        console.log("  - End Date:", new Date(trip.endDate).toISOString());
          console.log("  - Travelers:", trip.travelerCount ?? trip.travelers ?? 1);
        console.log("  - Budget:", trip.budgetTotal ?? trip.budget);
        console.log("  - Interests:", trip.interests);
        console.log("  - Selected Traveler IDs:", trip.selectedTravelerIds || "none");
        
        // V1: Get traveler count with fallback
        const travelerCount = trip.travelerCount ?? trip.travelers ?? 1;

        // Get traveler ages for flight search (if travelers were selected)
        let travelerAges: number[] = [];
        if (trip.selectedTravelerIds && trip.selectedTravelerIds.length > 0) {
            travelerAges = await ctx.runQuery(internal.trips.getTravelerAgesForTrip, { tripId });
            console.log("  - Traveler Ages at departure:", travelerAges);
        }
        
        if (!skipFlights && !origin) {
            console.error("❌ Trip origin is missing!");
            await ctx.runMutation(internal.trips.updateItinerary, {
                tripId,
                itinerary: null,
                status: "failed",
            });
            throw new Error("Trip origin is required");
        }

        console.log("\n" + "=".repeat(80));
        console.log("🔑 CHECKING API KEYS");
        console.log("=".repeat(80));

        // Check if API keys are configured
        const { hasDuffelKey, hasOpenAIKey, hasTripAdvisorKey, hasViatorKey } = checkApiKeys();

        console.log("  - Duffel API:", hasDuffelKey ? "✅ Configured" : "❌ Missing");
        console.log("  - OpenAI API:", hasOpenAIKey ? "✅ Configured" : "❌ Missing");
        console.log("  - TripAdvisor API:", hasTripAdvisorKey ? "✅ Configured" : "❌ Missing");
        console.log("  - Viator API:", hasViatorKey ? "✅ Configured" : "❌ Missing");

        if (!hasDuffelKey) {
            console.warn("⚠️ Duffel API key not configured. Using AI-generated data.");
        }
        if (!hasOpenAIKey) {
            console.warn("⚠️ OpenAI API key not configured. Using basic itinerary.");
        }

        console.log("\n" + "=".repeat(80));
        console.log("🎬 STARTING DATA COLLECTION");
        console.log("=".repeat(80));

        try {
            // ===== PARALLEL DATA FETCHING =====
            // Run all independent API calls simultaneously for faster performance
            console.log("🚀 Starting parallel data fetching...");
            const startTime = Date.now();

            // Define async functions for each data source
            const fetchFlightsAsync = async () => {
                if (skipFlights) {
                    console.log("✈️ Skipping flight search - user already has flights booked");
                    return {
                        skipped: true,
                        message: "You indicated you already have flights booked",
                        dataSource: "user-provided",
                    };
                }
                
                console.log("✈️ Fetching flights...");
                console.log("  - Preferred time:", preferredFlightTime || "any");
                
                if (hasDuffelKey) {
                    try {
                        const originCode = extractIATACode(origin);
                        const destCode = extractIATACode(trip.destination);
                        const departureDate = new Date(trip.startDate).toISOString().split('T')[0];
                        const returnDate = new Date(trip.endDate).toISOString().split('T')[0];

                        console.log(`🔍 Searching flights via Duffel: ${originCode} -> ${destCode}`);
                        
                        if (!originCode || !destCode) {
                            throw new Error("Invalid IATA codes");
                        }
                        
                        if (originCode === destCode) {
                            throw new Error("Origin and destination are the same");
                        }
                        
                        const { offerRequestId, offers } = await duffel.createOfferRequest({
                            originCode,
                            destinationCode: destCode,
                            departureDate,
                            returnDate,
                            adults: travelerCount,
                            passengerAges: travelerAges.length > 0 ? travelerAges : undefined,
                        });

                        if (!offers || offers.length === 0) {
                            console.warn("⚠️ No flights found via Duffel");
                            return await generateRealisticFlights(
                                origin, originCode, trip.destination, destCode,
                                departureDate, returnDate, travelerCount, preferredFlightTime || "any"
                            );
                        }
                        
                        interface FlightOption {
                            id: string;
                            pricePerPerson: number;
                            currency: string;
                            outbound: { airline: string; departure: string; arrival: string; };
                            return?: { airline: string; };
                            isBestPrice?: boolean;
                        }
                        
                        const flightOptions: FlightOption[] = offers.slice(0, 5).map((offer: unknown) =>
                            duffel.transformOfferToFlightOption(offer as Parameters<typeof duffel.transformOfferToFlightOption>[0])
                        );
                        flightOptions.sort((a, b) => a.pricePerPerson - b.pricePerPerson);
                        if (flightOptions.length > 0) flightOptions[0].isBestPrice = true;

                        console.log(`✅ Duffel returned ${flightOptions.length} flight options`);
                        return {
                            options: flightOptions,
                            bestPrice: flightOptions[0]?.pricePerPerson || 0,
                            preferredTime: preferredFlightTime || "any",
                            dataSource: "duffel",
                            offerRequestId,
                        };
                    } catch (error) {
                        console.error("❌ Duffel flights failed:", error);
                        const originCode = extractIATACode(origin);
                        const destCode = extractIATACode(trip.destination);
                        return await generateRealisticFlights(
                            origin, originCode, trip.destination, destCode,
                            new Date(trip.startDate).toISOString().split('T')[0],
                            new Date(trip.endDate).toISOString().split('T')[0],
                            travelerCount, preferredFlightTime || "any"
                        );
                    }
                } else {
                    const originCode = extractIATACode(origin);
                    const destCode = extractIATACode(trip.destination);
                    return await generateRealisticFlights(
                        origin, originCode, trip.destination, destCode,
                        new Date(trip.startDate).toISOString().split('T')[0],
                        new Date(trip.endDate).toISOString().split('T')[0],
                        travelerCount, preferredFlightTime || "any"
                    );
                }
            };

            const fetchHotelsAsync = async () => {
                console.log("🏨 Fetching hotels...");
                if (skipHotel) {
                    console.log("🏨 Skipping hotel search - user already has accommodation booked");
                    return {
                        skipped: true,
                        message: "You indicated you already have accommodation booked",
                        dataSource: "user-provided",
                    };
                }
                return getFallbackHotels(trip.destination);
            };

            const fetchActivitiesAsync = async () => {
                console.log("🎯 Fetching activities...");
                return await searchActivities(trip.destination);
            };

            const fetchRestaurantsAsync = async () => {
                console.log("🍽️ Fetching restaurants...");
                return await searchRestaurants(trip.destination);
            };

            // Run all fetches in parallel
            const [flights, hotels, activities, restaurants] = await Promise.all([
                fetchFlightsAsync(),
                fetchHotelsAsync(),
                fetchActivitiesAsync(),
                fetchRestaurantsAsync(),
            ]);

            const fetchTime = Date.now() - startTime;
            console.log(`✅ All data fetched in ${fetchTime}ms (parallel)`);
            console.log(`   - Flights: ${'dataSource' in flights ? flights.dataSource : 'ready'}`);
            console.log(`   - Hotels: ${typeof hotels === 'object' && 'skipped' in hotels ? "Skipped" : (Array.isArray(hotels) ? hotels.length + " options" : "Unknown")}`);
            console.log(`   - Activities: ${activities.length} options`);
            console.log(`   - Restaurants: ${restaurants.length} options`);

            // 5. Generate transportation options (sync, fast)
            console.log("🚗 Generating transportation options...");
            const transportation = generateTransportationOptions(trip.destination, origin, trip.travelerCount ?? trip.travelers ?? 1);
            console.log(`✅ Transportation ready: ${transportation.length} options`);

            // 6. Generate day-by-day itinerary with OpenAI
            console.log("📝 Generating itinerary with OpenAI...");
            let dayByDayItinerary;
            if (hasOpenAIKey) {
                try {
                    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    const localExperiencesGuidance = generateLocalExperiencesGuidance(trip.localExperiences);
                    
                    // Calculate the number of days
                    const tripDays = Math.ceil((trip.endDate - trip.startDate) / (24 * 60 * 60 * 1000));
                    console.log(`📅 Generating itinerary for ${tripDays} days`);
                    
                    // Generate budget-aware guidance
                    const effectiveTravelerCount = trip.travelerCount ?? trip.travelers ?? 1;
                    const budgetGuidance = generateBudgetGuidance(
                        trip.budgetTotal ?? (typeof trip.budget === "number" ? trip.budget : undefined),
                        effectiveTravelerCount,
                        tripDays,
                        trip.destination
                    );
                    console.log(`💰 Budget tier: ${budgetGuidance.budgetTier}, daily per person: €${budgetGuidance.dailyBudgetPerPerson}`);
                    
                    // Generate time-aware guidance based on arrival/departure times
                    const timeAwareGuidance = generateTimeAwareGuidance(
                        arrivalTime,
                        departureTime,
                        trip.startDate,
                        trip.endDate
                    );
                    
                    console.log(`⏰ Time-aware guidance: skipLastDay=${timeAwareGuidance.skipLastDay}, firstDayStart=${timeAwareGuidance.firstDayStartTime}, lastDayEnd=${timeAwareGuidance.lastDayEndTime}`);
                    
                    // Adjust the effective trip days if we need to skip the last day
                    const effectiveTripDays = timeAwareGuidance.skipLastDay ? tripDays - 1 : tripDays;
                    const daysInstructions = timeAwareGuidance.skipLastDay 
                        ? `Generate ${effectiveTripDays} days of activities (Days 1-${effectiveTripDays}). Day ${tripDays} is departure day with no scheduled activities.`
                        : `Generate exactly ${tripDays} days of itinerary. Do not skip any days.`;

                    // Build budget display for prompt header
                    const budgetTotal = trip.budgetTotal ?? (typeof trip.budget === "number" ? trip.budget : null);
                    const perPersonBudget = budgetTotal ? Math.round(budgetTotal / effectiveTravelerCount) : null;
                    const budgetHeader = budgetTotal
                        ? `Total Budget: €${budgetTotal} (€${perPersonBudget} per person, €${budgetGuidance.dailyBudgetPerPerson}/person/day)`
                        : `Budget: Not specified (assume moderate)`;
                    
                    // Check if the traveler selected Culinary/Food interest
                    const hasCulinaryInterest = trip.interests.some((i: string) => i === 'Food' || i === 'Culinary');

                    // Build arrival day hard constraint for the prompt header
                    const arrivalDayHardConstraint = timeAwareGuidance.firstDayStartTime 
                        ? `\n\n**⛔ ARRIVAL DAY HARD RULE: Day 1 first activity startTime must be "${timeAwareGuidance.firstDayStartTime}" or later. The traveler arrives at the airport and needs ~3 hours (transfer + check-in) before being available. Any Day 1 activity before "${timeAwareGuidance.firstDayStartTime}" will be REJECTED.**`
                        : '';

                    const itineraryPrompt = `Create a detailed day-by-day itinerary for a ${tripDays}-day trip to ${trip.destination} from ${new Date(trip.startDate).toDateString()} to ${new Date(trip.endDate).toDateString()}.

**CRITICAL: ${daysInstructions}**${arrivalDayHardConstraint}

${budgetHeader}
Travelers: ${effectiveTravelerCount}
Budget Tier: ${budgetGuidance.budgetTier.toUpperCase()}
Interests: ${trip.interests.join(", ")}

${budgetGuidance.guidance}

${generateTravelStyleGuidance(trip.interests)}
${localExperiencesGuidance}
${timeAwareGuidance.guidance}

IMPORTANT: For each activity, include:
- Realistic entry prices in EUR that RESPECT the budget tier (${budgetGuidance.budgetTier})
- Whether "Skip the Line" tickets are available (for museums, attractions)${budgetGuidance.budgetTier === "low" ? " — only suggest if affordable within budget" : budgetGuidance.budgetTier === "moderate" ? " — suggest for popular attractions only" : ""}
- Skip the Line price (usually 5-15€ more than regular)
- Duration of the activity in minutes
- Start time and end time (24h format like "09:00", "11:30")
- FULL ADDRESS: Include street name/number, neighborhood, and "${trip.destination}" (e.g., "Piazza del Duomo, 20121 Milan" or "Gothic Quarter, Barcelona"). This is CRITICAL for accurate map directions.

**CULINARY EXPERIENCE RULES (CRITICAL):**
Food recommendations are NOT a separate list — they are embedded as activities with type "restaurant" in the daily timeline.
Each food activity MUST include these additional culinary fields:
- "culinaryMoment": "morning" | "midday" | "evening" — when this meal fits the day
- "culinaryType": "cafe" | "bakery" | "lunch" | "dinner" | "bar" | "street-food" — specific food category
- "whyThisFits": A short 1-sentence insider explanation of why this spot fits at this point in the day (e.g., "Perfect espresso stop after a museum morning" or "Locals come here after work for aperitivo")
- "priceRange": "€" | "€€" | "€€€" — relative cost indicator
- "walkability": "nearby" | "short-walk" | "transit-needed" — how far from previous activity
- "culinaryTags": array of tags like ["local", "casual", "fine-dining", "quick-bite", "scenic", "historic", "market", "family-friendly", "vegetarian-friendly"]

Culinary placement rules:
1. Morning (before 11:00) → Cafés, bakeries, breakfast spots. ${hasCulinaryInterest ? 'ALWAYS include at least one morning food stop per full day. This is a quick 20-30 min stop and counts toward the daily item total. Set culinaryType to "cafe" or "bakery".' : 'Only include if it fits the flow naturally. Not required.'}
2. Midday (12:00–14:30) → Lunch spots. 1 curated option. Should match the neighborhood you're already in.
3. Evening (19:00–22:00) → Dinner restaurants. 1 curated option. Can be more experiential. ${budgetGuidance.budgetTier === 'low' || budgetGuidance.budgetTier === 'moderate' ? 'For low and moderate budgets, ALWAYS include a dinner as the evening food moment so travelers have something planned for the evening.' : ''}
4. NEVER place fine dining right after a heavy activity block unless it's evening
5. After high-energy activities → suggest casual/quick food, not a sit-down restaurant
6. Avoid repeating similar cuisines on the same day
7. Prefer walkable spots near the day's other activities
8. ${hasCulinaryInterest ? 'Morning cafés/bakeries should ALWAYS be included — they set the tone for the day. Only skip on departure days.' : 'Morning cafés/bakeries are optional — include only when it makes sense for the day.'}
9. Food is part of the day's story, not a checklist — make it feel curated and intentional
10. Tone: confident, local insider feel. Short explanations. No marketing language.
${hasCulinaryInterest ? '11. IMPORTANT: Every full activity day MUST have a morning café/bakery as the FIRST activity of the day. This is non-negotiable. Even on budget trips, a morning coffee stop is essential for the travel experience.' : ''}
12. OPENING HOURS ACCURACY (CRITICAL): Only recommend cafés and bakeries for the morning that are KNOWN to open early (before 8:30 AM). Many bakeries and cafés in European cities open at 7:00–8:00 AM — only suggest those. NEVER recommend a place for a morning stop if it typically opens after 10:00 AM. If you are unsure about opening hours, recommend well-known chain cafés or traditional bakeries that reliably open early. For dinner spots, only recommend restaurants that serve dinner (open after 18:00/19:00). Always match the recommendation to the actual operating hours of that type of venue in ${trip.destination}.

**TIME-AWARE ITINERARY WITH TRAVEL SEGMENTS:**
Between consecutive activities, include realistic travel time based on typical walking distance in ${trip.destination}. Consider:
- City center attractions are usually 10-20 min walk apart
- Activities in different neighborhoods may need 25-40 min walking
- Museums/attractions typically need 1.5-3 hours each
- Meals at restaurants typically last 45-90 minutes

For local experiences (cooking classes, workshops, food tours, neighborhood walks, etc.):
- Set "isLocalExperience": true
- Set "type": "local-experience"
- Include a detailed description of what makes it authentic/local

Include specific activities, restaurants, and attractions for each day. Format as JSON with structure:
{
  "dailyPlan": [
    {
      "day": 1,
      "date": "2024-01-15",
      "title": "Day 1 in ${trip.destination}",
      "activities": [
        {
          "time": "09:00",
          "startTime": "09:00",
          "endTime": "11:00",
          "title": "Activity name",
          "description": "Brief description",
          "address": "Street name, neighborhood or postal code, ${trip.destination}",
          "type": "attraction|museum|restaurant|tour|free|local-experience",
          "price": 25,
          "currency": "EUR",
          "skipTheLine": true,
          "skipTheLinePrice": 35,
          "durationMinutes": 120,
          "duration": "2 hours",
          "tips": "Best to visit early morning",
          "isLocalExperience": false,
          "travelFromPrevious": {
            "walkingMinutes": 15,
            "distanceKm": 1.2,
            "description": "15 min walk through the Gothic Quarter"
          },
          "culinaryMoment": null,
          "culinaryType": null,
          "whyThisFits": null,
          "priceRange": null,
          "walkability": null,
          "culinaryTags": null
        },
        {
          "time": "12:30",
          "startTime": "12:30",
          "endTime": "13:30",
          "title": "Restaurant name",
          "description": "Brief description of the food spot",
          "address": "Street name, neighborhood, ${trip.destination}",
          "type": "restaurant",
          "price": 18,
          "currency": "EUR",
          "durationMinutes": 60,
          "duration": "1 hour",
          "tips": "Try their house special",
          "isLocalExperience": false,
          "travelFromPrevious": {
            "walkingMinutes": 8,
            "distanceKm": 0.6,
            "description": "Short walk down the main boulevard"
          },
          "culinaryMoment": "midday",
          "culinaryType": "lunch",
          "whyThisFits": "Refuel with local comfort food after a morning of exploring",
          "priceRange": "€€",
          "walkability": "nearby",
          "culinaryTags": ["local", "casual", "quick-bite"]
        }
      ]
    }
  ]
}

**ACTIVITY TIMING RULES:**
- First activity of each day: set "travelFromPrevious" to null
- Subsequent activities: include realistic travel time from previous location
- startTime of next activity = previous endTime + walking time
- Ensure no time gaps or overlaps - schedule realistically
- Allow 15-30 min buffer for transit between different areas

**REMINDER: ${timeAwareGuidance.skipLastDay 
    ? `Generate Days 1-${effectiveTripDays} with activities. Day ${tripDays} is departure-only with no activities.` 
    : `Generate ALL ${tripDays} days from Day 1 to Day ${tripDays}.`}${timeAwareGuidance.firstDayStartTime ? ` Day 1 is an ARRIVAL day — first activity must start at "${timeAwareGuidance.firstDayStartTime}" or later, with FEWER items than a full day. Do NOT put a morning café/bakery on Day 1 unless the buffered start time is before 10:00.` : ''} Each full day (NOT arrival/departure days) MUST have EXACTLY ${
        hasCulinaryInterest 
            ? (budgetGuidance.budgetTier === 'low' ? '3' : budgetGuidance.budgetTier === 'moderate' ? '4' : budgetGuidance.budgetTier === 'high' ? '5' : '6')
            : (budgetGuidance.budgetTier === 'low' ? '2' : budgetGuidance.budgetTier === 'moderate' ? '3' : budgetGuidance.budgetTier === 'high' ? '4' : '5')
    } total items (${hasCulinaryInterest ? '1 morning café/bakery + ' : ''}activities + dinner). ${hasCulinaryInterest ? 'On FULL days (not arrival/departure), the first item must be a café or bakery. On arrival day, skip the morning café. ' : ''}Do NOT exceed this number. Arrival day and departure day are PARTIAL days and should have FEWER items (1-2 max).**

**BUDGET COMPLIANCE:** This is a ${budgetGuidance.budgetTier.toUpperCase()} budget trip (€${budgetGuidance.dailyBudgetPerPerson}/person/day). ${
    budgetGuidance.budgetTier === 'low' 
        ? (hasCulinaryInterest 
            ? 'HARD LIMIT: 3 items per day (1 morning café + 1 activity + 1 dinner). The morning café is a quick €3-5 coffee/pastry — always include it. Maximum 1 paid activity. Prioritize free attractions and affordable food.' 
            : 'HARD LIMIT: 2 items per day (1 activity + 1 dinner). Maximum 1 paid activity. ALWAYS include a dinner restaurant in the evening. Prioritize free attractions and affordable food.')
    : budgetGuidance.budgetTier === 'moderate' 
        ? (hasCulinaryInterest 
            ? 'HARD LIMIT: 4 items per day (1 morning café/bakery + 2 activities + 1 dinner). The morning café is a quick €4-8 stop — always include it. Do NOT add more than 4 total. Balance quality and value at around €' + budgetGuidance.dailyBudgetPerPerson + ' per person daily.'
            : 'HARD LIMIT: 3 items per day (2 activities + 1 dinner). ALWAYS include a dinner restaurant in the evening. Do NOT add more than 3 total. Balance quality and value at around €' + budgetGuidance.dailyBudgetPerPerson + ' per person daily.')
    : budgetGuidance.budgetTier === 'high' 
        ? (hasCulinaryInterest 
            ? 'Target 5 items per day (1 morning café/bakery + 3 activities + 1 dinner). Include guided tours and unique experiences. Daily spend up to €' + budgetGuidance.dailyBudgetPerPerson + ' per person.'
            : 'Target 4 items per day (3 activities + 1 dinner). Include guided tours and unique experiences. Daily spend up to €' + budgetGuidance.dailyBudgetPerPerson + ' per person.')
    : (hasCulinaryInterest 
        ? 'Target 6 curated items per day (1 morning café/bakery + 3-4 activities + 1-2 dining experiences). Include exclusive activities and fine dining. Daily spend up to €' + budgetGuidance.dailyBudgetPerPerson + ' per person.'
        : 'Target 5 curated items per day (3-4 activities + 1-2 dining experiences). Include exclusive activities and fine dining. Daily spend up to €' + budgetGuidance.dailyBudgetPerPerson + ' per person.')
    }

Make sure prices are realistic for ${trip.destination} and aligned with the ${budgetGuidance.budgetTier.toUpperCase()} budget tier. Distribute spending evenly across days. Museums typically cost €10-25, skip-the-line adds €5-15. Tours cost €20-80. Restaurants show average meal cost per person.`;
                    
                    // For longer trips or trips with time constraints, we need more tokens
                    // Base: 16000 tokens, +2500 per day, extra buffer for time-aware prompts
                    const hasTimeConstraints = arrivalTime || departureTime;
                    const baseTokens = hasTimeConstraints ? 20000 : 16000;
                    const tokensPerDay = hasTimeConstraints ? 3000 : 2500;
                    const maxTokens = Math.min(100000, Math.max(baseTokens, tripDays * tokensPerDay));
                    
                    console.log(`📝 Using maxTokens: ${maxTokens} (days: ${tripDays}, timeConstraints: ${hasTimeConstraints})`);
                    
                    // Build system prompt with time-awareness and budget awareness
                    const budgetSystemNote = budgetGuidance.budgetTier === 'low'
                        ? ` Prioritize free and budget-friendly options.${hasCulinaryInterest ? ' Always start each day with a morning café/bakery.' : ''} Maximum 1 paid activity per day. ALWAYS include a dinner in the evening. Avoid expensive tours or premium experiences.`
                        : budgetGuidance.budgetTier === 'moderate'
                        ? ` Provide balanced recommendations with good value experiences.${hasCulinaryInterest ? ' Always start each day with a morning café/bakery.' : ''} STRICTLY ${hasCulinaryInterest ? '4' : '3'} total items per day (${hasCulinaryInterest ? '1 café + ' : ''}2 activities + 1 dinner). ALWAYS include a dinner in the evening. Do not exceed ${hasCulinaryInterest ? '4' : '3'}.`
                        : budgetGuidance.budgetTier === 'high'
                        ? ` Include guided tours, unique experiences, and higher-quality venues.${hasCulinaryInterest ? ' Always start each day with a morning café/bakery.' : ''} Suggest ${hasCulinaryInterest ? '5' : '4'} items per day with convenience optimization.`
                        : ` Curate ${hasCulinaryInterest ? '6' : '5'} premium items per day (${hasCulinaryInterest ? '1 morning café + ' : ''}3-4 experiences + 1-2 dining).${hasCulinaryInterest ? ' Always start each day with a curated morning café/bakery.' : ''} Include exclusive activities, fine dining, and time-efficient routing. Focus on comfort and quality.`;
                    
                    const systemPrompt = timeAwareGuidance.skipLastDay
                        ? `You are a travel itinerary planner. Return only valid JSON. Always include realistic prices and booking information for activities. IMPORTANT: Generate ${effectiveTripDays} days of activities (Days 1-${effectiveTripDays}). Day ${tripDays} is departure day with no activities. Respect arrival and departure time constraints.${budgetSystemNote} The traveler's budget tier is ${budgetGuidance.budgetTier.toUpperCase()} (€${budgetGuidance.dailyBudgetPerPerson}/person/day). All recommendations must respect this budget.`
                        : `You are a travel itinerary planner. Return only valid JSON. Always include realistic prices and booking information for activities. IMPORTANT: You must generate the complete itinerary for ALL ${tripDays} days requested. If arrival/departure times are specified, adjust activities accordingly - fewer activities on partial days.${budgetSystemNote} The traveler's budget tier is ${budgetGuidance.budgetTier.toUpperCase()} (€${budgetGuidance.dailyBudgetPerPerson}/person/day). All recommendations must respect this budget.`;
                    
                    const completion = await openai.chat.completions.create({
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: itineraryPrompt },
                        ],
                        model: "gpt-5.2",
                        response_format: { type: "json_object" },
                        max_completion_tokens: maxTokens,
                    });

                    console.log("🔍 OpenAI response:", JSON.stringify(completion.choices[0], null, 2));
                    
                    // Check if response was truncated
                    if (completion.choices[0].finish_reason === "length") {
                        console.warn("⚠️ OpenAI response was truncated due to length limit");
                    }
                    
                    const itineraryContent = completion.choices[0].message.content;
                    if (itineraryContent) {
                        const itineraryData = JSON.parse(itineraryContent);
                        dayByDayItinerary = itineraryData.dailyPlan || [];
                        console.log(`✅ OpenAI generated ${dayByDayItinerary.length} days of itinerary (requested ${tripDays})`);
                        
                        // Check if OpenAI generated enough days - if not, supplement with fallback
                        if (dayByDayItinerary.length < tripDays) {
                            console.warn(`⚠️ OpenAI only generated ${dayByDayItinerary.length}/${tripDays} days, supplementing with fallback`);
                            const fallbackItinerary = generateBasicItinerary(trip, activities, restaurants);
                            
                            // Add missing days from fallback
                            for (let i = dayByDayItinerary.length; i < tripDays; i++) {
                                if (fallbackItinerary[i]) {
                                    // Update the day number and date for the fallback day
                                    const dayDate = new Date(trip.startDate + i * 24 * 60 * 60 * 1000);
                                    const missingDay = {
                                        ...fallbackItinerary[i],
                                        day: i + 1,
                                        date: dayDate.toISOString().split('T')[0],
                                        title: `Day ${i + 1} in ${trip.destination}`,
                                    };
                                    dayByDayItinerary.push(missingDay);
                                }
                            }
                            console.log(`✅ Supplemented to ${dayByDayItinerary.length} days`);
                        }
                        
                        // Merge TripAdvisor data into restaurant activities
                        dayByDayItinerary = mergeRestaurantDataIntoItinerary(dayByDayItinerary, restaurants);
                        
                        // POST-PROCESSING: Enforce arrival day buffer
                        // Even if the AI ignores the prompt, we fix Day 1 activities that start too early
                        if (timeAwareGuidance.firstDayStartTime && dayByDayItinerary.length > 0) {
                            const bufferTime = timeAwareGuidance.firstDayStartTime; // e.g., "18:00"
                            const day1 = dayByDayItinerary[0];
                            if (day1 && day1.activities) {
                                const originalCount = day1.activities.length;
                                day1.activities = day1.activities.filter((activity: any) => {
                                    const actStartTime = activity.startTime || activity.time;
                                    if (!actStartTime) return true;
                                    // Compare time strings "HH:MM" — remove activities before the buffer
                                    return actStartTime >= bufferTime;
                                });
                                const removed = originalCount - day1.activities.length;
                                if (removed > 0) {
                                    console.log(`🛡️ Arrival buffer enforced: removed ${removed} Day 1 activities before ${bufferTime}`);
                                }
                            }
                        }
                    } else {
                        console.warn("⚠️ OpenAI returned empty content, using fallback");
                        dayByDayItinerary = generateBasicItinerary(trip, activities, restaurants);
                    }
                } catch (error) {
                    console.warn("⚠️ OpenAI generation failed, using fallback:", error);
                    dayByDayItinerary = generateBasicItinerary(trip, activities, restaurants);
                }
            } else {
                console.warn("⚠️ OpenAI not configured, using basic itinerary");
                dayByDayItinerary = generateBasicItinerary(trip, activities, restaurants);
            }

            const result = {
                flights,
                hotels,
                activities,
                restaurants,
                transportation,
                dayByDayItinerary,
               estimatedDailyExpenses: calculateDailyExpenses(Number(trip.budgetTotal)),
            };

            console.log("✅ Trip generation complete!");

            await ctx.runMutation(internal.trips.updateItinerary, {
                tripId,
                itinerary: result,
                status: "completed",
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("❌ Error generating itinerary:", error);
            console.error("Error details:", {
                message: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
            });
            
            await ctx.runMutation(internal.trips.updateItinerary, {
                tripId,
                itinerary: null,
                status: "failed",
            });
            
            throw new Error(`Failed to generate trip: ${errorMessage}`);
        }
    },
});

// Helper function to check if API keys are configured
function checkApiKeys() {
    return {
        hasDuffelKey: !!process.env.DUFFEL_ACCESS_TOKEN,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasTripAdvisorKey: !!process.env.TRIPADVISOR_API_KEY,
        hasViatorKey: !!process.env.VIATOR_API_KEY,
    };
}

// Helper function to extract IATA code from city name
function extractIATACode(cityName: string): string {
    if (!cityName) {
        console.warn("⚠️ extractIATACode called with empty/null input");
        return "";
    }
    
    console.log(`🔎 Extracting IATA code from: "${cityName}"`);
    
    // If input is already a 3-letter IATA code
    if (/^[A-Z]{3}$/.test(cityName.trim().toUpperCase())) {
        console.log(`   → Already an IATA code: ${cityName.trim().toUpperCase()}`);
        return cityName.trim().toUpperCase();
    }
    
    // Check if IATA code is in parentheses like "Paris (CDG)" or "London - LHR"
    const iataMatch = cityName.match(/\(([A-Z]{3})\)/) || cityName.match(/[-–]\s*([A-Z]{3})$/);
    if (iataMatch) {
        console.log(`   → Found IATA in input: ${iataMatch[1]}`);
        return iataMatch[1];
    }
    
    const cityToIATA: Record<string, string> = {
        // Europe - Major Cities
        "london": "LHR",
        "london heathrow": "LHR",
        "london gatwick": "LGW",
        "london stansted": "STN",
        "london luton": "LTN",
        "london city": "LCY",
        "paris": "CDG",
        "paris charles de gaulle": "CDG",
        "paris orly": "ORY",
        "rome": "FCO",
        "rome fiumicino": "FCO",
        "barcelona": "BCN",
        "athens": "ATH",
        "amsterdam": "AMS",
        "berlin": "BER",
        "munich": "MUC",
        "frankfurt": "FRA",
        "madrid": "MAD",
        "lisbon": "LIS",
        "prague": "PRG",
        "vienna": "VIE",
        "budapest": "BUD",
        "warsaw": "WAW",
        "krakow": "KRK",
        "istanbul": "IST",
        "dublin": "DUB",
        "edinburgh": "EDI",
        "manchester": "MAN",
        "birmingham": "BHX",
        "glasgow": "GLA",
        "milan": "MXP",
        "milan malpensa": "MXP",
        "milan linate": "LIN",
        "florence": "FLR",
        "venice": "VCE",
        "naples": "NAP",
        "nice": "NCE",
        "zurich": "ZRH",
        "geneva": "GVA",
        "brussels": "BRU",
        "copenhagen": "CPH",
        "stockholm": "ARN",
        "oslo": "OSL",
        "helsinki": "HEL",
        "reykjavik": "KEF",
        "santorini": "JTR",
        "mykonos": "JMK",
        "crete": "HER",
        "rhodes": "RHO",
        "corfu": "CFU",
        "porto": "OPO",
        "seville": "SVQ",
        "denver": "DEN",
        "dallas": "DFW",
        "atlanta": "ATL",
        "las vegas": "LAS",
        "phoenix": "PHX",
        "san diego": "SAN",
        "portland": "PDX",
        "new orleans": "MSY",
        "nashville": "BNA",
        "austin": "AUS",
        "houston": "IAH",
        "philadelphia": "PHL",
        "minneapolis": "MSP",
        "detroit": "DTW",
        "orlando": "MCO",
        "tampa": "TPA",
        "fort lauderdale": "FLL",
        "san jose": "SJC",
        "salt lake city": "SLC",
        "charlotte": "CLT",
        "raleigh": "RDU",
        "pittsburgh": "PIT",
        "st louis": "STL",
        "kansas city": "MCI",
        "indianapolis": "IND",
        "cleveland": "CLE",
        "columbus": "CMH",
        "cincinnati": "CVG",
        "milwaukee": "MKE",
        "baltimore": "BWI",
        "san antonio": "SAT",
        "sacramento": "SMF",
        "oakland": "OAK",
        "anchorage": "ANC",
        
        // Hawaii
        "hawaii": "HNL",
        "honolulu": "HNL",
        "maui": "OGG",
        "kauai": "LIH",
        "big island": "KOA",
        "kona": "KOA",
        
        // Caribbean
        "cancun": "CUN",
        "playa del carmen": "CUN",
        "riviera maya": "CUN",
        "tulum": "CUN",
        "jamaica": "MBJ",
        "montego bay": "MBJ",
        "punta cana": "PUJ",
        "santo domingo": "SDQ",
        "puerto rico": "SJU",
        "san juan": "SJU",
        "aruba": "AUA",
        "curacao": "CUR",
        "st maarten": "SXM",
        "barbados": "BGI",
        "bahamas": "NAS",
        "nassau": "NAS",
        "turks and caicos": "PLS",
        "cayman islands": "GCM",
        "grand cayman": "GCM",
        "bermuda": "BDA",
        "virgin islands": "STT",
        "st thomas": "STT",
        "antigua": "ANU",
        "st lucia": "UVF",
        "trinidad": "POS",
        "martinique": "FDF",
        "guadeloupe": "PTP",
        
        // Mexico
        "mexico city": "MEX",
        "guadalajara": "GDL",
        "monterrey": "MTY",
        "los cabos": "SJD",
        "cabo san lucas": "SJD",
        "puerto vallarta": "PVR",
        "acapulco": "ACA",
        "oaxaca": "OAX",
        "merida": "MID",
        "cozumel": "CZM",
        
        // Canada
        "toronto": "YYZ",
        "vancouver": "YVR",
        "montreal": "YUL",
        "calgary": "YYC",
        "edmonton": "YEG",
        "ottawa": "YOW",
        "quebec city": "YQB",
        "halifax": "YHZ",
        "winnipeg": "YWG",
        "victoria": "YYJ",
        
        // Central America
        "costa rica": "SJO",
        "san jose costa rica": "SJO",
        "panama city": "PTY",
        "panama": "PTY",
        "belize": "BZE",
        "belize city": "BZE",
        "guatemala city": "GUA",
        "guatemala": "GUA",
        "managua": "MGA",
        "nicaragua": "MGA",
        "honduras": "SAP",
        "el salvador": "SAL",
        
        // South America
        "buenos aires": "EZE",
        "sao paulo": "GRU",
        "rio de janeiro": "GIG",
        "rio": "GIG",
        "lima": "LIM",
        "bogota": "BOG",
        "medellin": "MDE",
        "cartagena": "CTG",
        "santiago": "SCL",
        "quito": "UIO",
        "guayaquil": "GYE",
        "cusco": "CUZ",
        "machu picchu": "CUZ",
        "montevideo": "MVD",
        "asuncion": "ASU",
        "la paz": "LPB",
        "caracas": "CCS",
        
        // Africa
        "cape town": "CPT",
        "johannesburg": "JNB",
        "durban": "DUR",
        "cairo": "CAI",
        "alexandria": "HBE",
        "luxor": "LXR",
        "sharm el sheikh": "SSH",
        "hurghada": "HRG",
        "marrakech": "RAK",
        "casablanca": "CMN",
        "fez": "FEZ",
        "tunis": "TUN",
        "nairobi": "NBO",
        "mombasa": "MBA",
        "zanzibar": "ZNZ",
        "dar es salaam": "DAR",
        "addis ababa": "ADD",
        "accra": "ACC",
        "lagos": "LOS",
        "dakar": "DSS",
        "mauritius": "MRU",
        "seychelles": "SEZ",
        "reunion": "RUN",
        "madagascar": "TNR",
        "victoria falls": "VFA",
        "windhoek": "WDH",
        "namibia": "WDH",
        "botswana": "GBE",
        "gaborone": "GBE",
        "rwanda": "KGL",
        "kigali": "KGL",
        "kilimanjaro": "JRO",
        
        // Oceania
        "sydney": "SYD",
        "melbourne": "MEL",
        "brisbane": "BNE",
        "perth": "PER",
        "adelaide": "ADL",
        "cairns": "CNS",
        "gold coast": "OOL",
        "auckland": "AKL",
        "wellington": "WLG",
        "christchurch": "CHC",
        "queenstown": "ZQN",
        "fiji": "NAN",
        "nadi": "NAN",
        "tahiti": "PPT",
        "bora bora": "BOB",
        "new caledonia": "NOU",
        "vanuatu": "VLI",
        "samoa": "APW",
        
        // Island Destinations
        "maldives": "MLE",
        "male": "MLE",
        "sri lanka": "CMB",
        "cuba": "HAV",
        "havana": "HAV",
    };

    const normalized = cityName.toLowerCase().trim();
    
    // Remove common suffixes like ", Country" or ", State"
    const cleanedName = normalized
        .replace(/,\s*[a-z\s]+$/i, '')  // Remove ", Country" or ", State"
        .replace(/\s+(airport|international|intl)$/i, '')  // Remove "Airport" suffix
        .trim();
    
    // Try exact match first
    if (cityToIATA[cleanedName]) {
        console.log(`   → Exact match: ${cityToIATA[cleanedName]}`);
        return cityToIATA[cleanedName];
    }
    
    if (cityToIATA[normalized]) {
        console.log(`   → Match on normalized: ${cityToIATA[normalized]}`);
        return cityToIATA[normalized];
    }
    
    // Try partial match (city name contained in input)
    for (const [city, code] of Object.entries(cityToIATA)) {
        if (cleanedName.includes(city) || city.includes(cleanedName)) {
            console.log(`   → Partial match "${city}": ${code}`);
            return code;
        }
    }
    
    // Last resort: check if input contains any known city
    for (const [city, code] of Object.entries(cityToIATA)) {
        if (normalized.includes(city)) {
            console.log(`   → Found city "${city}" in input: ${code}`);
            return code;
        }
    }
    
    console.warn(`⚠️ Could not find IATA code for "${cityName}" (cleaned: "${cleanedName}")`);
    return ""; // Return empty string instead of default to trigger validation
}

// Helper function to get fallback hotel data
function getFallbackHotels(destination: string) {
    interface HotelData {
        name: string;
        stars: number;
        price: number;
        currency: string;
        description: string;
    }
    const hotels: Record<string, HotelData[]> = {
        "paris": [
            { name: "Hotel Le Marais", stars: 4, price: 150, currency: "EUR", description: "Charming 4-star hotel in the heart of Le Marais" },
            { name: "Boutique Hotel Montmartre", stars: 3, price: 95, currency: "EUR", description: "Cozy 3-star hotel near Sacré-Cœur" },
            { name: "Luxury Palace Hotel", stars: 5, price: 350, currency: "EUR", description: "5-star luxury hotel on the Champs-Élysées" },
        ],
        "rome": [
            { name: "Hotel Colosseum View", stars: 4, price: 140, currency: "EUR", description: "4-star hotel with Colosseum views" },
            { name: "Trastevere Inn", stars: 3, price: 85, currency: "EUR", description: "Charming 3-star hotel in Trastevere" },
            { name: "Vatican Palace Hotel", stars: 5, price: 320, currency: "EUR", description: "Luxury 5-star hotel near Vatican" },
        ],
        "barcelona": [
            { name: "Sagrada Familia Hotel", stars: 4, price: 130, currency: "EUR", description: "Modern 4-star hotel near Sagrada Familia" },
            { name: "Gothic Quarter Inn", stars: 3, price: 80, currency: "EUR", description: "Cozy 3-star hotel in the Gothic Quarter" },
            { name: "Luxury Eixample Hotel", stars: 5, price: 300, currency: "EUR", description: "5-star luxury hotel in Eixample" },
        ],
    };

    const destLower = destination.toLowerCase();
    for (const [city, cityHotels] of Object.entries(hotels)) {
        if (destLower.includes(city)) {
            return cityHotels;
        }
    }

    // Generic fallback
    return [
        { name: "City Center Hotel", stars: 4, price: 120, currency: "EUR", description: "4-star hotel in city center" },
        { name: "Budget Inn", stars: 2, price: 60, currency: "EUR", description: "Budget-friendly 2-star hotel" },
        { name: "Luxury Resort", stars: 5, price: 280, currency: "EUR", description: "5-star luxury resort" },
    ];
}

// Helper function to search for activities using Viator API
async function searchActivities(destination: string) {
    // V1: Viator is disabled - always use AI-generated fallback data
    if (!FEATURES.VIATOR || !FEATURES.ACTIVITIES_PROVIDER) {
        console.log("⚠️ Viator/Activities provider disabled in V1 - using AI-generated sights");
        return getFallbackActivities(destination);
    }
    
    interface ViatorProduct {
        title?: string;
        name?: string;
        productCode?: string;
        images?: Array<{
            variants?: Array<{
                url?: string;
                width?: number;
            }>;
        }>;
        duration?: {
            fixedDurationInMinutes?: number;
            variableDurationFromMinutes?: number;
            variableDurationToMinutes?: number;
        };
        pricing?: {
            summary?: {
                fromPrice?: number;
            };
            currency?: string;
        };
        reviews?: {
            combinedAverageRating?: number;
            totalReviews?: number;
        };
        description?: string;
        productUrl?: string;
        flags?: string[];
    }
    
    const apiKey = process.env.VIATOR_API_KEY;
    
    if (!apiKey) {
        console.warn("⚠️ Viator API key not configured, using fallback activities");
        return getFallbackActivities(destination);
    }
    
    try {
        console.log(`🎯 Searching Viator activities for: ${destination}`);
        
        // Use products/search endpoint with searchTerm
        const productsResponse = await fetch(
            "https://api.viator.com/partner/products/search",
            {
                method: "POST",
                headers: {
                    "Accept": "application/json;version=2.0",
                    "Accept-Language": "en-US",
                    "Content-Type": "application/json",
                    "exp-api-key": apiKey,
                },
                body: JSON.stringify({
                    searchTerm: destination,
                    sorting: {
                        sort: "TRAVELER_RATING",
                        order: "DESC",
                    },
                    pagination: {
                        start: 1,
                        count: 15,
                    },
                    currency: "EUR",
                }),
            }
        );
        
        if (!productsResponse.ok) {
            const errorText = await productsResponse.text();
            console.warn(`⚠️ Viator products search failed: ${productsResponse.status}`, errorText);
            return getFallbackActivities(destination);
        }
        
        const productsData = await productsResponse.json();
        const products: ViatorProduct[] = productsData.products || [];
        
        console.log(`✅ Found ${products.length} Viator activities`);
        
        if (products.length > 0) {
            console.log("📦 Sample Viator product:", JSON.stringify(products[0], null, 2));
        }
        
        // Transform Viator products to our format
        const activities = products.map((product: ViatorProduct) => {
            let imageUrl: string | null = null;
            
            if (product.images && Array.isArray(product.images) && product.images.length > 0) {
                const firstImage = product.images[0];
                if (firstImage.variants && Array.isArray(firstImage.variants)) {
                    const sortedVariants = [...firstImage.variants].sort((a, b) => (a.width || 0) - (b.width || 0));
                    const mediumVariant = sortedVariants.find((v) => (v.width || 0) >= 400 && (v.width || 0) <= 800);
                    const fallbackVariant = sortedVariants.find((v) => (v.width || 0) >= 200);
                    imageUrl = mediumVariant?.url || fallbackVariant?.url || sortedVariants[sortedVariants.length - 1]?.url || null;
                }
            }
            
            const title = product.title || product.name || "Activity";
            
            let duration = "Varies";
            if (product.duration) {
                if (product.duration.fixedDurationInMinutes) {
                    const hours = Math.round(product.duration.fixedDurationInMinutes / 60);
                    duration = hours > 0 ? `${hours} hour${hours > 1 ? 's' : ''}` : `${product.duration.fixedDurationInMinutes} min`;
                } else if (product.duration.variableDurationFromMinutes && product.duration.variableDurationToMinutes) {
                    const fromHours = Math.round(product.duration.variableDurationFromMinutes / 60);
                    const toHours = Math.round(product.duration.variableDurationToMinutes / 60);
                    duration = `${fromHours}-${toHours} hours`;
                }
            }
            
            return {
                name: title,
                title: title,
                type: categorizeActivity(title),
                price: product.pricing?.summary?.fromPrice || 0,
                currency: product.pricing?.currency || "EUR",
                rating: product.reviews?.combinedAverageRating || null,
                reviewCount: product.reviews?.totalReviews || 0,
                duration,
                description: product.description?.substring(0, 300) || "",
                bookingUrl: product.productUrl || `https://www.viator.com/tours/${product.productCode}`,
                productCode: product.productCode,
                image: imageUrl,
                imageUrl: imageUrl,
                skipTheLine: product.flags?.includes("SKIP_THE_LINE") || title.toLowerCase().includes("skip") || false,
                dataSource: "viator",
            };
        });
        
        console.log(`✅ Transformed ${activities.length} activities`);
        
        return activities.length > 0 ? activities : getFallbackActivities(destination);
    } catch (error) {
        console.error("❌ Viator API error:", error);
        return getFallbackActivities(destination);
    }
}

// Helper to categorize activities based on title
function categorizeActivity(title: string): string {
    const titleLower = (title || "").toLowerCase();
    
    if (titleLower.includes("museum") || titleLower.includes("gallery")) return "museum";
    if (titleLower.includes("tour") || titleLower.includes("walking")) return "tour";
    if (titleLower.includes("food") || titleLower.includes("culinary") || titleLower.includes("tasting")) return "food";
    if (titleLower.includes("cruise") || titleLower.includes("boat")) return "cruise";
    if (titleLower.includes("show") || titleLower.includes("concert") || titleLower.includes("performance")) return "entertainment";
    if (titleLower.includes("adventure") || titleLower.includes("hiking") || titleLower.includes("outdoor")) return "adventure";
    if (titleLower.includes("workshop") || titleLower.includes("class")) return "experience";
    
    return "attraction";
}

// Fallback activities when Viator API is unavailable
function getFallbackActivities(destination: string) {
    interface ActivityData {
        name: string;
        title: string;
        type: string;
        price: number;
        currency: string;
        rating: number;
        reviewCount: number;
        duration: string;
        description: string;
        bookingUrl: string;
        skipTheLine: boolean;
        dataSource: string;
        image: string | null;
        imageUrl: string | null;
    }
    const destLower = destination.toLowerCase();
    
    const fallbackByCity: Record<string, ActivityData[]> = {
        "paris": [
            { name: "Eiffel Tower Summit Access", title: "Eiffel Tower Summit Access", type: "attraction", price: 42, currency: "EUR", rating: 4.7, reviewCount: 15420, duration: "2-3 hours", description: "Skip the lines and visit all levels including the summit", bookingUrl: "https://www.viator.com/tours/Paris/Eiffel-Tower", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Louvre Museum Guided Tour", title: "Louvre Museum Guided Tour", type: "museum", price: 65, currency: "EUR", rating: 4.8, reviewCount: 8930, duration: "3 hours", description: "Expert-led tour of the world's largest art museum", bookingUrl: "https://www.viator.com/tours/Paris/Louvre", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Seine River Dinner Cruise", title: "Seine River Dinner Cruise", type: "cruise", price: 89, currency: "EUR", rating: 4.6, reviewCount: 5240, duration: "2.5 hours", description: "Gourmet dinner while cruising past illuminated monuments", bookingUrl: "https://www.viator.com/tours/Paris/Seine-Cruise", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Montmartre Walking Tour", title: "Montmartre Walking Tour", type: "tour", price: 25, currency: "EUR", rating: 4.9, reviewCount: 3210, duration: "2 hours", description: "Explore the artistic bohemian neighborhood", bookingUrl: "https://www.viator.com/tours/Paris/Montmartre", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "French Cooking Class", title: "French Cooking Class", type: "experience", price: 120, currency: "EUR", rating: 4.9, reviewCount: 1890, duration: "4 hours", description: "Learn to cook classic French dishes", bookingUrl: "https://www.viator.com/tours/Paris/Cooking", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
        ],
        "rome": [
            { name: "Colosseum Underground Tour", title: "Colosseum Underground Tour", type: "attraction", price: 75, currency: "EUR", rating: 4.9, reviewCount: 12340, duration: "3 hours", description: "Exclusive access to underground chambers and arena floor", bookingUrl: "https://www.viator.com/tours/Rome/Colosseum", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Vatican Museums & Sistine Chapel", title: "Vatican Museums & Sistine Chapel", type: "museum", price: 59, currency: "EUR", rating: 4.7, reviewCount: 18920, duration: "3 hours", description: "Skip-the-line access to the Vatican's treasures", bookingUrl: "https://www.viator.com/tours/Rome/Vatican", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Trastevere Food Tour", title: "Trastevere Food Tour", type: "food", price: 79, currency: "EUR", rating: 4.8, reviewCount: 4560, duration: "4 hours", description: "Taste authentic Roman cuisine in the charming Trastevere district", bookingUrl: "https://www.viator.com/tours/Rome/Food-Tour", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Pasta Making Class", title: "Pasta Making Class", type: "experience", price: 65, currency: "EUR", rating: 4.9, reviewCount: 2340, duration: "3 hours", description: "Learn to make fresh pasta from a local chef", bookingUrl: "https://www.viator.com/tours/Rome/Pasta", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Rome by Night Walking Tour", title: "Rome by Night Walking Tour", type: "tour", price: 35, currency: "EUR", rating: 4.7, reviewCount: 2890, duration: "2.5 hours", description: "See Rome's monuments beautifully illuminated", bookingUrl: "https://www.viator.com/tours/Rome/Night-Tour", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
        ],
        "barcelona": [
            { name: "Sagrada Familia Guided Tour", title: "Sagrada Familia Guided Tour", type: "attraction", price: 47, currency: "EUR", rating: 4.8, reviewCount: 21340, duration: "2 hours", description: "Skip-the-line access with expert guide", bookingUrl: "https://www.viator.com/tours/Barcelona/Sagrada-Familia", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Park Güell Express Tour", title: "Park Güell Express Tour", type: "attraction", price: 24, currency: "EUR", rating: 4.6, reviewCount: 8760, duration: "2 hours", description: "Discover Gaudí's colorful mosaic park", bookingUrl: "https://www.viator.com/tours/Barcelona/Park-Guell", skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Tapas & Wine Tour", title: "Tapas & Wine Tour", type: "food", price: 89, currency: "EUR", rating: 4.9, reviewCount: 5430, duration: "4 hours", description: "Sample authentic tapas in the Gothic Quarter", bookingUrl: "https://www.viator.com/tours/Barcelona/Tapas", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Flamenco Show & Dinner", title: "Flamenco Show & Dinner", type: "entertainment", price: 75, currency: "EUR", rating: 4.7, reviewCount: 3210, duration: "2 hours", description: "Traditional flamenco performance with dinner", bookingUrl: "https://www.viator.com/tours/Barcelona/Flamenco", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
            { name: "Gothic Quarter Walking Tour", title: "Gothic Quarter Walking Tour", type: "tour", price: 20, currency: "EUR", rating: 4.8, reviewCount: 4560, duration: "2 hours", description: "Explore medieval streets and hidden squares", bookingUrl: "https://www.viator.com/tours/Barcelona/Gothic", skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
        ],
    };
    
    // Check if we have fallback for this city
    for (const [city, activities] of Object.entries(fallbackByCity)) {
        if (destLower.includes(city)) {
            return activities;
        }
    }
    
    // Generic fallback
    return [
        { name: "City Highlights Tour", title: "City Highlights Tour", type: "tour", price: 35, currency: "EUR", rating: 4.5, reviewCount: 500, duration: "3 hours", description: "Discover the best of the city with a local guide", bookingUrl: `https://www.getyourguide.com/s/?q=${encodeURIComponent(destination)}`, skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
        { name: "Main Museum Visit", title: "Main Museum Visit", type: "museum", price: 20, currency: "EUR", rating: 4.6, reviewCount: 300, duration: "2 hours", description: "Explore the city's main museum", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, skipTheLine: true, dataSource: "fallback", image: null, imageUrl: null },
        { name: "Local Food Experience", title: "Local Food Experience", type: "food", price: 65, currency: "EUR", rating: 4.7, reviewCount: 200, duration: "3 hours", description: "Taste local specialties with a foodie guide", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
        { name: "Walking Tour", title: "Walking Tour", type: "tour", price: 18, currency: "EUR", rating: 4.4, reviewCount: 400, duration: "2 hours", description: "Explore the historic center on foot", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
          { name: "Sunset Viewpoint", title: "Sunset Viewpoint", type: "free", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "1 hour", bookingUrl: null, tips: "Arrive 30 min before sunset" },
    ];
}

// Helper function to search for restaurants using TripAdvisor API
async function searchRestaurants(destination: string) {
    const tripadvisorKey = process.env.TRIPADVISOR_API_KEY;
    
    if (!tripadvisorKey) {
        console.log(`🍽️ TripAdvisor API key not configured, using fallback restaurants for: ${destination}`);
        return getFallbackRestaurants(destination);
    }

    try {
        console.log(`🍽️ Attempting to fetch restaurants from TripAdvisor for: ${destination}`);
        
        // Search directly for restaurants in the destination
        const searchUrl = `https://api.content.tripadvisor.com/api/v1/location/search?key=${tripadvisorKey}&searchQuery=${encodeURIComponent("restaurants " + destination)}&category=restaurants&language=en`;
        
        console.log(`📡 Searching TripAdvisor for restaurants in: ${destination}`);
        
        const searchResponse = await fetch(searchUrl, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            }
        });
        
        console.log(`📊 TripAdvisor Response Status: ${searchResponse.status}`);
        
        if (!searchResponse.ok) {
            const errorBody = await searchResponse.text();
            console.error(`❌ TripAdvisor search failed (${searchResponse.status}):`, errorBody.substring(0, 200));
            return getFallbackRestaurants(destination);
        }
        
        const searchData = await searchResponse.json() as any;
        
        if (!searchData.data || searchData.data.length === 0) {
            console.log(`❌ No restaurants found for: ${destination}`);
            return getFallbackRestaurants(destination);
        }
        
        console.log(`✅ Found ${searchData.data.length} results from TripAdvisor`);
        
        // Get details for each restaurant to get the web_url
        const restaurantsWithDetails = await Promise.all(
            searchData.data.slice(0, 20).map(async (item: any) => {
                try {
                    // Fetch details for each restaurant to get the web_url
                    const detailsUrl = `https://api.content.tripadvisor.com/api/v1/location/${item.location_id}/details?key=${tripadvisorKey}&language=en`;
                    const detailsResponse = await fetch(detailsUrl, {
                        method: "GET",
                        headers: { "Accept": "application/json" }
                    });
                    
                    if (detailsResponse.ok) {
                        const details = await detailsResponse.json() as any;
                        return {
                            name: details.name || item.name || "Restaurant",
                            cuisine: details.cuisine?.map((c: any) => c.localized_name || c.name).join(", ") || "Various",
                            priceRange: details.price_level || "€€",
                            rating: parseFloat(details.rating) || 4.0,
                            reviewCount: parseInt(details.num_reviews) || 0,
                            address: details.address_obj?.address_string || item.address_obj?.address_string || destination,
                            tripAdvisorUrl: details.web_url || `https://www.tripadvisor.com/Restaurant_Review-g${item.location_id}`,
                            dataSource: "tripadvisor",
                        };
                    }
                } catch (e) {
                    console.log(`⚠️ Could not fetch details for ${item.name}`);
                }
                
                // Fallback if details fetch fails - construct URL manually
                return {
                    name: item.name || "Restaurant",
                    cuisine: "Various",
                    priceRange: "€€",
                    rating: 4.0,
                    reviewCount: 0,
                    address: item.address_obj?.address_string || destination,
                    tripAdvisorUrl: `https://www.tripadvisor.com/Restaurant_Review-g${item.location_id}`,
                    dataSource: "tripadvisor",
                };
            })
        );
        
        console.log(`✅ Returning ${restaurantsWithDetails.length} restaurants with TripAdvisor URLs`);
        return restaurantsWithDetails;
    } catch (error) {
        console.error("❌ TripAdvisor API error:", error);
        console.log(`🍽️ Falling back to default restaurants for: ${destination}`);
        return getFallbackRestaurants(destination);
    }
}

// Fallback restaurants when TripAdvisor API is unavailable
function getFallbackRestaurants(destination: string) {
    interface RestaurantData {
        name: string;
        cuisine: string;
        priceRange: string;
        rating: number;
        reviewCount: number;
        address: string;
        tripAdvisorUrl: string;
        dataSource: string;
    }
    const destLower = destination.toLowerCase();
    
    const fallbackByCity: Record<string, RestaurantData[]> = {
        "paris": [
            { name: "Le Comptoir du Panthéon", cuisine: "French", priceRange: "€€€", rating: 4.7, reviewCount: 2340, address: "10 Rue Soufflot, 5th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Chez Janou", cuisine: "Provençal", priceRange: "€€", rating: 4.5, reviewCount: 4560, address: "2 Rue Roger Verlomme, 3rd Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Pink Mamma", cuisine: "Italian", priceRange: "€€", rating: 4.6, reviewCount: 8920, address: "20bis Rue de Douai, 9th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Bouillon Chartier", cuisine: "French", priceRange: "€", rating: 4.3, reviewCount: 12340, address: "7 Rue du Faubourg Montmartre, 9th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Bouillon Pigalle", cuisine: "French Bistro", priceRange: "€€", rating: 4.4, reviewCount: 5670, address: "22 Boulevard de Clichy, 18th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Relais de l'Entrecôte", cuisine: "French Steakhouse", priceRange: "€€", rating: 4.5, reviewCount: 7890, address: "15 Rue Marbeuf, 8th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Breizh Café", cuisine: "Crêperie", priceRange: "€€", rating: 4.6, reviewCount: 3450, address: "109 Rue Vieille du Temple, 3rd Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Petit Cler", cuisine: "French Bistro", priceRange: "€€", rating: 4.7, reviewCount: 2180, address: "29 Rue Cler, 7th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "L'As du Fallafel", cuisine: "Middle Eastern", priceRange: "€", rating: 4.4, reviewCount: 9870, address: "34 Rue des Rosiers, 4th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Café de Flore", cuisine: "French Café", priceRange: "€€€", rating: 4.3, reviewCount: 11200, address: "172 Boulevard Saint-Germain, 6th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Bouillon Racine", cuisine: "French", priceRange: "€€", rating: 4.5, reviewCount: 4320, address: "3 Rue Racine, 6th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Frenchie", cuisine: "Modern French", priceRange: "€€€€", rating: 4.8, reviewCount: 3890, address: "5 Rue du Nil, 2nd Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Chez l'Ami Jean", cuisine: "Basque", priceRange: "€€€", rating: 4.6, reviewCount: 2650, address: "27 Rue Malar, 7th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Cinq", cuisine: "Haute Cuisine", priceRange: "€€€€", rating: 4.9, reviewCount: 1890, address: "31 Avenue George V, 8th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Au Pied de Cochon", cuisine: "French Brasserie", priceRange: "€€€", rating: 4.2, reviewCount: 6540, address: "6 Rue Coquillière, 1st Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Clover Grill", cuisine: "Grilled Meats", priceRange: "€€€", rating: 4.5, reviewCount: 1560, address: "6 Rue Bailleul, 1st Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Baratin", cuisine: "French Wine Bar", priceRange: "€€", rating: 4.6, reviewCount: 1230, address: "3 Rue Jouye-Rouve, 20th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Holybelly", cuisine: "Brunch & Coffee", priceRange: "€€", rating: 4.5, reviewCount: 3780, address: "19 Rue Lucien Sampaix, 10th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Train Bleu", cuisine: "French Brasserie", priceRange: "€€€", rating: 4.4, reviewCount: 5430, address: "Gare de Lyon, 12th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Septime", cuisine: "Modern French", priceRange: "€€€€", rating: 4.8, reviewCount: 2890, address: "80 Rue de Charonne, 11th Arr.", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
        ],
        "rome": [
            { name: "Roscioli Salumeria con Cucina", cuisine: "Italian", priceRange: "€€€", rating: 4.8, reviewCount: 3450, address: "Via dei Giubbonari 21, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Pizzarium", cuisine: "Pizza", priceRange: "€", rating: 4.7, reviewCount: 6780, address: "Via della Meloria 43, Prati", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Da Enzo al 29", cuisine: "Roman", priceRange: "€€", rating: 4.6, reviewCount: 5230, address: "Via dei Vascellari 29, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Armando al Pantheon", cuisine: "Italian", priceRange: "€€€", rating: 4.5, reviewCount: 4120, address: "Salita dei Crescenzi 31, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Supplì Roma", cuisine: "Roman Street Food", priceRange: "€", rating: 4.4, reviewCount: 2890, address: "Via di San Francesco a Ripa 137, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Tonnarello", cuisine: "Roman", priceRange: "€€", rating: 4.3, reviewCount: 7650, address: "Via della Paglia 1, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "La Pergola", cuisine: "Haute Cuisine", priceRange: "€€€€", rating: 4.9, reviewCount: 1890, address: "Via Alberto Cadlolo 101, Monte Mario", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Cacio e Pepe", cuisine: "Roman Pasta", priceRange: "€€", rating: 4.5, reviewCount: 3240, address: "Via Giuseppe Avezzana 11, Prati", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Antico Forno Roscioli", cuisine: "Bakery & Pizza", priceRange: "€", rating: 4.6, reviewCount: 4560, address: "Via dei Chiavari 34, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Trattoria Da Teo", cuisine: "Roman", priceRange: "€€", rating: 4.5, reviewCount: 2780, address: "Piazza dei Ponziani 7, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Il Pagliaccio", cuisine: "Modern Italian", priceRange: "€€€€", rating: 4.8, reviewCount: 1340, address: "Via dei Banchi Vecchi 129a, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Dar Filettaro a Santa Barbara", cuisine: "Roman Street Food", priceRange: "€", rating: 4.3, reviewCount: 3890, address: "Largo dei Librari 88, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Osteria Fernanda", cuisine: "Modern Roman", priceRange: "€€€", rating: 4.7, reviewCount: 1650, address: "Via Crescenzo del Monte 18, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Felice a Testaccio", cuisine: "Roman", priceRange: "€€", rating: 4.5, reviewCount: 4320, address: "Via Mastro Giorgio 29, Testaccio", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Grazia & Graziella", cuisine: "Italian", priceRange: "€€", rating: 4.4, reviewCount: 2560, address: "Largo M.D. Fumasoni Biondi 5, Trastevere", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Trapizzino", cuisine: "Street Food", priceRange: "€", rating: 4.5, reviewCount: 3120, address: "Via Giovanni Branca 88, Testaccio", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Emma Pizzeria", cuisine: "Pizza", priceRange: "€€", rating: 4.4, reviewCount: 5670, address: "Via del Monte della Farina 28, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Ristorante Aroma", cuisine: "Fine Dining", priceRange: "€€€€", rating: 4.8, reviewCount: 2340, address: "Via Labicana 125, Colosseo", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Primo al Pigneto", cuisine: "Modern Roman", priceRange: "€€€", rating: 4.6, reviewCount: 1890, address: "Via del Pigneto 46, Pigneto", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Gelateria Giolitti", cuisine: "Gelato & Café", priceRange: "€", rating: 4.3, reviewCount: 8760, address: "Via degli Uffici del Vicario 40, Centro Storico", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
        ],
        "barcelona": [
            { name: "Cal Pep", cuisine: "Catalan", priceRange: "€€€", rating: 4.6, reviewCount: 4560, address: "Plaça de les Olles 8, El Born", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Cervecería Catalana", cuisine: "Tapas", priceRange: "€€", rating: 4.5, reviewCount: 9870, address: "Carrer de Mallorca 236, Eixample", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "La Pepita", cuisine: "Spanish", priceRange: "€€", rating: 4.7, reviewCount: 3210, address: "Carrer de Còrsega 343, Gràcia", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "El Xampanyet", cuisine: "Catalan Tapas", priceRange: "€", rating: 4.4, reviewCount: 5430, address: "Carrer de Montcada 22, El Born", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Can Culleretes", cuisine: "Catalan", priceRange: "€€", rating: 4.3, reviewCount: 2890, address: "Carrer d'en Quintana 5, Barri Gòtic", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Tickets Bar", cuisine: "Tapas & Molecular", priceRange: "€€€€", rating: 4.8, reviewCount: 4560, address: "Avinguda del Paral·lel 164, Sant Antoni", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Bar Mut", cuisine: "Mediterranean", priceRange: "€€€", rating: 4.5, reviewCount: 2340, address: "Carrer de Pau Claris 192, Eixample", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "La Boqueria Market Stalls", cuisine: "Market Food", priceRange: "€", rating: 4.4, reviewCount: 15600, address: "La Rambla 91, Raval", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Can Paixano (La Xampanyeria)", cuisine: "Tapas & Cava", priceRange: "€", rating: 4.3, reviewCount: 6780, address: "Carrer de la Reina Cristina 7, Barceloneta", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Quimet & Quimet", cuisine: "Tapas & Montaditos", priceRange: "€€", rating: 4.7, reviewCount: 3450, address: "Carrer del Poeta Cabanyes 25, Poble Sec", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Bodega 1900", cuisine: "Vermouth & Tapas", priceRange: "€€€", rating: 4.6, reviewCount: 2120, address: "Carrer de Tamarit 91, Sant Antoni", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "La Mar Salada", cuisine: "Seafood", priceRange: "€€", rating: 4.4, reviewCount: 3890, address: "Passeig de Joan de Borbó 58, Barceloneta", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Flax & Kale", cuisine: "Healthy & Flexitarian", priceRange: "€€", rating: 4.5, reviewCount: 5670, address: "Carrer dels Tallers 74b, Raval", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Federal Café", cuisine: "Brunch & Coffee", priceRange: "€€", rating: 4.4, reviewCount: 2340, address: "Carrer del Parlament 39, Sant Antoni", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Els Quatre Gats", cuisine: "Catalan", priceRange: "€€€", rating: 4.2, reviewCount: 7890, address: "Carrer de Montsió 3, Barri Gòtic", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Can Solé", cuisine: "Seafood", priceRange: "€€€", rating: 4.5, reviewCount: 3210, address: "Carrer de Sant Carles 4, Barceloneta", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Granja Viader", cuisine: "Traditional Café", priceRange: "€", rating: 4.3, reviewCount: 2560, address: "Carrer d'en Xuclà 4, Raval", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Disfrutar", cuisine: "Avant-Garde", priceRange: "€€€€", rating: 4.9, reviewCount: 2890, address: "Carrer de Villarroel 163, Eixample", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Bar Cañete", cuisine: "Spanish Tapas", priceRange: "€€€", rating: 4.6, reviewCount: 4120, address: "Carrer de la Unió 17, Raval", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "La Vinatería del Call", cuisine: "Catalan Wine Bar", priceRange: "€€", rating: 4.5, reviewCount: 3780, address: "Carrer de Sant Domènec del Call 9, Barri Gòtic", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
        ],
        "marrakech": [
            { name: "Dar Moha", cuisine: "Moroccan Fine Dining", priceRange: "€€€", rating: 4.8, reviewCount: 2890, address: "81 Rue Dar el Bacha, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Riad Karmela", cuisine: "Moroccan", priceRange: "€€", rating: 4.6, reviewCount: 1560, address: "Derb Lalla Azzouna, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Café des Épices", cuisine: "Moroccan Café", priceRange: "€", rating: 4.5, reviewCount: 3210, address: "Rahba Lakdima, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Le Jardin", cuisine: "Moroccan-Mediterranean", priceRange: "€€€", rating: 4.7, reviewCount: 2340, address: "32 Souk Sidi Abdelaziz, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Jemaa el-Fnaa Food Stalls", cuisine: "Street Food", priceRange: "€", rating: 4.3, reviewCount: 4560, address: "Place Jemaa el-Fnaa, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Al Fassia", cuisine: "Traditional Moroccan", priceRange: "€€€", rating: 4.6, reviewCount: 3120, address: "232 Avenue Mohammed V, Guéliz", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Nomad", cuisine: "Modern Moroccan", priceRange: "€€€", rating: 4.5, reviewCount: 4890, address: "1 Derb Aarjane, Rahba Lakdima, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "La Maison Arabe", cuisine: "Moroccan Fine Dining", priceRange: "€€€€", rating: 4.8, reviewCount: 1890, address: "1 Derb Assehbe, Bab Doukkala, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Chez Chegrouni", cuisine: "Moroccan", priceRange: "€", rating: 4.2, reviewCount: 5670, address: "Jemaa el-Fnaa, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "BKLYN", cuisine: "Burgers & Brunch", priceRange: "€€", rating: 4.4, reviewCount: 1230, address: "Rue Oum Er Rabia, Guéliz", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Amal Women's Training Center", cuisine: "Moroccan", priceRange: "€", rating: 4.7, reviewCount: 2340, address: "Rue Allal Ben Ahmed, Guéliz", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Le Trou au Mur", cuisine: "Moroccan Fusion", priceRange: "€€€", rating: 4.5, reviewCount: 1780, address: "21 Rue Mouassine, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Terrasse des Épices", cuisine: "Moroccan Rooftop", priceRange: "€€", rating: 4.4, reviewCount: 3560, address: "15 Souk Cherifia, Sidi Abdelaziz, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Pepe Nero", cuisine: "Italian-Moroccan", priceRange: "€€€", rating: 4.6, reviewCount: 2890, address: "17 Derb Cherkaoui, Douar Graoua, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Kui-Zin", cuisine: "Moroccan Street Food", priceRange: "€", rating: 4.3, reviewCount: 1450, address: "9 Rue Jbel Lakhdar, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "La Famille", cuisine: "Vegetarian Moroccan", priceRange: "€€", rating: 4.5, reviewCount: 1890, address: "42 Rue Riad Zitoun el Jdid, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Dar Yacout", cuisine: "Moroccan Fine Dining", priceRange: "€€€€", rating: 4.7, reviewCount: 2560, address: "79 Sidi Ahmed Soussi, Bab Doukkala, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Café Clock", cuisine: "Moroccan-International", priceRange: "€€", rating: 4.4, reviewCount: 4120, address: "224 Derb Chtouka, Kasbah, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Henna Café", cuisine: "Moroccan Café", priceRange: "€", rating: 4.3, reviewCount: 1340, address: "93 Arset Aouzal, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
            { name: "Le Salama", cuisine: "Moroccan Rooftop", priceRange: "€€€", rating: 4.5, reviewCount: 3670, address: "40 Rue des Banques, Jemaa el-Fnaa, Medina", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g143998-Marrakech", dataSource: "fallback" },
        ],
    };
    
    // Check if we have fallback for this city
    for (const [city, restaurants] of Object.entries(fallbackByCity)) {
        if (destLower.includes(city)) {
            return restaurants;
        }
    }
    
    // Generic fallback - 20 restaurants for any destination
    const restaurantTypes = [
        { cuisine: "Local Traditional", priceRange: "€€", ratingBase: 4.5 },
        { cuisine: "Street Food", priceRange: "€", ratingBase: 4.3 },
        { cuisine: "Fine Dining", priceRange: "€€€€", ratingBase: 4.8 },
        { cuisine: "Seafood", priceRange: "€€€", ratingBase: 4.5 },
        { cuisine: "International", priceRange: "€€", ratingBase: 4.2 },
        { cuisine: "Café & Brunch", priceRange: "€", ratingBase: 4.4 },
        { cuisine: "Mediterranean", priceRange: "€€€", ratingBase: 4.6 },
        { cuisine: "Vegetarian", priceRange: "€€", ratingBase: 4.3 },
        { cuisine: "Steakhouse", priceRange: "€€€", ratingBase: 4.4 },
        { cuisine: "Asian Fusion", priceRange: "€€", ratingBase: 4.5 },
        { cuisine: "Bakery & Pastry", priceRange: "€", ratingBase: 4.6 },
        { cuisine: "Wine Bar & Tapas", priceRange: "€€€", ratingBase: 4.5 },
        { cuisine: "Pizza", priceRange: "€", ratingBase: 4.4 },
        { cuisine: "Rooftop Dining", priceRange: "€€€€", ratingBase: 4.7 },
        { cuisine: "Bistro", priceRange: "€€", ratingBase: 4.3 },
        { cuisine: "Modern Cuisine", priceRange: "€€€", ratingBase: 4.6 },
        { cuisine: "Market Food", priceRange: "€", ratingBase: 4.2 },
        { cuisine: "BBQ & Grill", priceRange: "€€", ratingBase: 4.4 },
        { cuisine: "Traditional Home Cooking", priceRange: "€€", ratingBase: 4.5 },
        { cuisine: "Dessert & Gelato", priceRange: "€", ratingBase: 4.3 },
    ];
    const areas = ["City Center", "Old Town", "Downtown", "Market District", "Waterfront", "Arts Quarter", "Historic Quarter", "Harbor Area", "Main Square", "University Area", "Garden District", "Riverside", "Station Area", "Cultural Quarter", "Shopping District", "Beachfront", "Hill District", "Palace Quarter", "Park Area", "Lakeside"];
    
    return restaurantTypes.map((type, index) => ({
        name: `${type.cuisine} ${areas[index]} Restaurant`,
        cuisine: type.cuisine,
        priceRange: type.priceRange,
        rating: type.ratingBase,
        reviewCount: 200 + (index * 80),
        address: areas[index],
        tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`,
        dataSource: "fallback",
    }));
}

// Helper function to generate transportation options
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateTransportationOptions(destination: string, origin: string, travelers: number) {
    // Extract city name from destination (e.g., "Barcelona, Spain" -> "barcelona")
    const city = destination.split(',')[0].toLowerCase().trim();
    
    // City-specific transportation data
    const cityTransport: Record<string, any[]> = {
        "barcelona": [
            {
                type: "public_transport",
                provider: "TMB Barcelona",
                description: "Metro, bus, and tram network covering the entire city",
                options: [
                    { mode: "Metro", description: "8 lines covering all major attractions", singleTicketPrice: 2.55, dayPassPrice: 11.20 },
                    { mode: "T-Casual Card", description: "10 trips on metro/bus/tram", singleTicketPrice: 11.35 },
                    { mode: "Hola BCN!", description: "Unlimited travel for tourists", dayPassPrice: 17.50 },
                ],
            },
            {
                type: "rideshare",
                provider: "Uber / Cabify / Bolt",
                description: "Rideshare apps widely available",
                estimatedPrice: "8-15€ within city center",
            },
            {
                type: "taxi",
                provider: "Barcelona Taxi",
                description: "Yellow & black taxis, metered fares",
                estimatedPrice: "10-20€ within city",
                features: ["Airport: ~40€", "Cash & card accepted"],
            },
        ],
        "paris": [
            {
                type: "public_transport",
                provider: "RATP Paris",
                description: "Metro, RER, bus network",
                options: [
                    { mode: "Metro", description: "16 lines, runs until 1am (2am weekends)", singleTicketPrice: 2.15, dayPassPrice: 16.60 },
                    { mode: "Navigo Easy", description: "Rechargeable card for t+ tickets", singleTicketPrice: 2.15 },
                    { mode: "Paris Visite", description: "Tourist pass with unlimited travel", dayPassPrice: 14.95 },
                ],
            },
            {
                type: "rideshare",
                provider: "Uber / Bolt / FREE NOW",
                description: "Widely available throughout Paris",
                estimatedPrice: "10-20€ within city",
            },
        ],
        "rome": [
            {
                type: "public_transport",
                provider: "ATAC Roma",
                description: "Metro, bus, and tram network",
                options: [
                    { mode: "Metro", description: "3 lines (A, B, C)", singleTicketPrice: 1.50, dayPassPrice: 7.00 },
                    { mode: "Roma Pass", description: "48/72hr transport + museums", dayPassPrice: 32.00 },
                ],
            },
            {
                type: "taxi",
                provider: "Rome Taxi",
                description: "White taxis with meters",
                estimatedPrice: "10-15€ within center",
                features: ["Fixed airport fare: €50", "Use official taxi stands"],
            },
        ],
        "tokyo": [
            {
                type: "public_transport",
                provider: "Tokyo Metro & JR",
                description: "Extensive train and metro network",
                options: [
                    { mode: "Suica/Pasmo Card", description: "Rechargeable IC card for all transport", singleTicketPrice: 1.50 },
                    { mode: "Tokyo Subway Ticket", description: "Unlimited metro for tourists", dayPassPrice: 8.00 },
                    { mode: "JR Pass", description: "For bullet trains & JR lines (7 days)", dayPassPrice: 50.00 },
                ],
            },
        ],
        "london": [
            {
                type: "public_transport",
                provider: "TfL London",
                description: "Tube, buses, and Overground",
                options: [
                    { mode: "Oyster Card", description: "Pay as you go with daily cap", singleTicketPrice: 2.80, dayPassPrice: 8.10 },
                    { mode: "Contactless", description: "Use your bank card directly", singleTicketPrice: 2.80 },
                    { mode: "Travelcard", description: "Unlimited daily/weekly travel", dayPassPrice: 15.20 },
                ],
            },
            {
                type: "rideshare",
                provider: "Uber / Bolt",
                description: "Available throughout London",
                estimatedPrice: "15-25£ within zones 1-2",
            },
        ],
        "new york": [
            {
                type: "public_transport",
                provider: "MTA New York",
                description: "Subway and buses 24/7",
                options: [
                    { mode: "OMNY / MetroCard", description: "Tap to pay or buy a card", singleTicketPrice: 2.90, dayPassPrice: 34.00 },
                    { mode: "7-Day Unlimited", description: "Best for tourists", dayPassPrice: 34.00 },
                ],
            },
            {
                type: "rideshare",
                provider: "Uber / Lyft",
                description: "Widely available",
                estimatedPrice: "$15-30 within Manhattan",
            },
            {
                type: "taxi",
                provider: "Yellow Cab",
                description: "Iconic NYC taxis",
                estimatedPrice: "$15-25 + tip",
                features: ["JFK: ~$70 flat rate", "Cash & card accepted"],
            },
        ],
        "amsterdam": [
            {
                type: "public_transport",
                provider: "GVB Amsterdam",
                description: "Trams, buses, and metro",
                options: [
                    { mode: "OV-chipkaart", description: "Rechargeable card", singleTicketPrice: 2.40, dayPassPrice: 9.00 },
                    { mode: "I amsterdam City Card", description: "Transport + museums", dayPassPrice: 65.00 },
                ],
            },
            {
                type: "bike",
                provider: "Bike Rental",
                description: "The Dutch way! Rent a bike",
                estimatedPrice: "12-15€/day",
                features: ["OV-fiets at stations", "MacBike", "Yellow Bike"],
            },
        ],
    };
    
    // Check if we have specific data for this city
    const specificData = cityTransport[city];
    
    if (specificData) {
        return specificData;
    }
    
    // Generic transportation options for unknown cities
    return [
        {
            type: "public_transport",
            provider: "Local Public Transport",
            description: "Check Google Maps for local transit options",
            options: [
                { mode: "Bus/Metro", description: "Most cities have public transport", singleTicketPrice: 2.00, dayPassPrice: 8.00 },
            ],
        },
        {
            type: "rideshare",
            provider: "Uber / Bolt / Local Apps",
            description: "Rideshare apps are available in most cities",
            estimatedPrice: "Varies by city",
        },
        {
            type: "taxi",
            provider: "Local Taxis",
            description: "Official taxis from stands or call",
            estimatedPrice: "Varies by city",
            features: ["Always use metered taxis", "Ask hotel to call for you"],
        },
    ];
}

// Merge TripAdvisor restaurant data into itinerary activities
interface ItineraryDay {
    day: number;
    title?: string;
    activities?: ItineraryActivity[];
}

interface ItineraryActivity {
    time?: string;
    title?: string;
    description?: string;
    type?: string;
    price?: number;
    currency?: string;
    skipTheLine?: boolean;
    skipTheLinePrice?: number | null;
    duration?: string;
    bookingUrl?: string | null;
    tips?: string | null;
    fromTripAdvisor?: boolean;
    tripAdvisorUrl?: string | null;
    tripAdvisorRating?: number | null;
    tripAdvisorReviewCount?: number | null;
    cuisine?: string | null;
    priceRange?: string | null;
    address?: string | null;
    // Culinary experience fields
    culinaryMoment?: string | null;
    culinaryType?: string | null;
    whyThisFits?: string | null;
    walkability?: string | null;
    culinaryTags?: string[] | null;
}

interface RestaurantInfo {
    name?: string;
    cuisine?: string;
    priceRange?: string;
    rating?: number;
    reviewCount?: number;
    address?: string;
    tripAdvisorUrl?: string;
}

function mergeRestaurantDataIntoItinerary(dayByDayItinerary: ItineraryDay[], restaurants: RestaurantInfo[]): ItineraryDay[] {
    if (!restaurants || restaurants.length === 0) {
        return dayByDayItinerary;
    }
    
    console.log(`🔄 Merging TripAdvisor data for ${restaurants.length} restaurants into itinerary`);
    
    // Create a map of restaurant names (lowercase) to their TripAdvisor data
    const restaurantMap = new Map<string, RestaurantInfo>();
    for (const restaurant of restaurants) {
        if (restaurant.name) {
            restaurantMap.set(restaurant.name.toLowerCase(), restaurant);
        }
    }
    
    let mergedCount = 0;
    
    // Go through each day and each activity
    for (const day of dayByDayItinerary) {
        if (!day.activities) continue;
        
        for (let i = 0; i < day.activities.length; i++) {
            const activity = day.activities[i];
            
            // Check if this is a restaurant activity
            if (activity.type === "restaurant" || activity.type === "meal" || 
                activity.title?.toLowerCase().includes("lunch") || 
                activity.title?.toLowerCase().includes("dinner") ||
                activity.title?.toLowerCase().includes("breakfast") ||
                activity.title?.toLowerCase().includes("restaurant")) {
                
                // Try to find a matching restaurant from TripAdvisor data
                const activityNameLower = activity.title?.toLowerCase() || "";
                
                // First try exact match
                let matchedRestaurant = restaurantMap.get(activityNameLower);
                
                // If no exact match, try to find a partial match or assign by index
                if (!matchedRestaurant) {
                    // Try partial match
                    for (const [name, restaurant] of restaurantMap) {
                        if (activityNameLower.includes(name) || name.includes(activityNameLower)) {
                            matchedRestaurant = restaurant;
                            break;
                        }
                    }
                }
                
                // If still no match, assign a restaurant based on meal type
                if (!matchedRestaurant && restaurants.length > 0) {
                    const dayIndex = day.day - 1;
                    const isLunch = activityNameLower.includes("lunch");
                    const isDinner = activityNameLower.includes("dinner");
                    
                    // Assign different restaurants for lunch and dinner
                    const restaurantIndex = isLunch 
                        ? (dayIndex * 2) % restaurants.length 
                        : isDinner 
                            ? (dayIndex * 2 + 1) % restaurants.length 
                            : dayIndex % restaurants.length;
                    
                    matchedRestaurant = restaurants[restaurantIndex];
                }
                
                // Merge TripAdvisor data if we found a match
                if (matchedRestaurant && (matchedRestaurant.tripAdvisorUrl || matchedRestaurant.rating)) {
                    day.activities[i] = {
                        ...activity,
                        type: "restaurant",
                        fromTripAdvisor: true,
                        tripAdvisorUrl: matchedRestaurant.tripAdvisorUrl || null,
                        tripAdvisorRating: matchedRestaurant.rating || null,
                        tripAdvisorReviewCount: matchedRestaurant.reviewCount || null,
                        cuisine: matchedRestaurant.cuisine || activity.cuisine || null,
                        priceRange: matchedRestaurant.priceRange || activity.priceRange || null,
                        address: matchedRestaurant.address || activity.address || null,
                        // Update title to use actual restaurant name if available
                        title: matchedRestaurant.name || activity.title,
                        // Update description to include cuisine info
                        description: activity.description || `${matchedRestaurant.cuisine || "Local"} cuisine - ${matchedRestaurant.priceRange || "€€"}`,
                        // Preserve culinary fields from AI generation
                        culinaryMoment: activity.culinaryMoment || null,
                        culinaryType: activity.culinaryType || null,
                        whyThisFits: activity.whyThisFits || null,
                        walkability: activity.walkability || null,
                        culinaryTags: activity.culinaryTags || null,
                    };
                    mergedCount++;
                }
            }
        }
    }
    
    console.log(`✅ Merged TripAdvisor data into ${mergedCount} restaurant activities`);
    return dayByDayItinerary;
}

// Generate a basic itinerary without OpenAI
interface TripData {
    destination: string;
    startDate: number;
    endDate: number;
    interests?: string[];
}

function generateBasicItinerary(trip: TripData, activities: Array<{ title?: string }>, restaurants: RestaurantInfo[]) {
    const days = Math.ceil((trip.endDate - trip.startDate) / (24 * 60 * 60 * 1000));
    const dailyPlan = [];
    const hasCulinary = (trip.interests || []).some(i => i === 'Food' || i === 'Culinary');
    
    // Get destination-specific activities with prices
    const destActivities = getActivitiesWithPrices(trip.destination);
    
    for (let i = 0; i < days; i++) {
        const dayActivities: ItineraryActivity[] = [];
        
        // Morning café/bakery — only if Culinary interest selected
        if (hasCulinary) {
            dayActivities.push({
                time: "8:30 AM",
                title: `Morning Coffee & Pastry`,
                description: `Start the day at a local café in ${trip.destination}`,
                type: "restaurant",
                price: 5,
                currency: "EUR",
                skipTheLine: false,
                skipTheLinePrice: null,
                duration: "30 min",
                bookingUrl: null,
                tips: "Ask the barista for their specialty",
                culinaryMoment: "morning",
                culinaryType: "cafe",
                whyThisFits: "Ease into the day like a local with coffee and a fresh pastry",
                priceRange: "€",
                walkability: "nearby",
                culinaryTags: ["local", "casual", "quick-bite"],
            });
        }
        
        // Morning activity
        const morningActivity = destActivities[i % destActivities.length];
        dayActivities.push({
            time: "9:00 AM",
            title: morningActivity?.title || activities[i % activities.length]?.title || "Morning Activity",
            description: morningActivity?.description || "Explore and enjoy the local attractions",
            type: morningActivity?.type || "attraction",
            price: morningActivity?.price || 15,
            currency: "EUR",
            skipTheLine: morningActivity?.skipTheLine || false,
            skipTheLinePrice: morningActivity?.skipTheLinePrice || null,
            duration: morningActivity?.duration || "2-3 hours",
            bookingUrl: morningActivity?.bookingUrl || `https://www.getyourguide.com/s/?q=${encodeURIComponent(trip.destination)}`,
            tips: morningActivity?.tips || null,
        });
        
        // Lunch - include TripAdvisor data if available
        const lunchRestaurant = restaurants[i % restaurants.length];
        const lunchActivity: ItineraryActivity = {
            time: "1:00 PM",
            title: lunchRestaurant?.name || "Lunch",
            description: `${lunchRestaurant?.cuisine || "Local"} cuisine - ${lunchRestaurant?.priceRange || "€€"}`,
            type: "restaurant",
            price: lunchRestaurant?.priceRange === "€" ? 15 : lunchRestaurant?.priceRange === "€€€" ? 45 : lunchRestaurant?.priceRange === "€€€€" ? 80 : 25,
            currency: "EUR",
            skipTheLine: false,
            skipTheLinePrice: null,
            duration: "1-1.5 hours",
            bookingUrl: null,
            tips: "Reservations recommended",
            culinaryMoment: "midday",
            culinaryType: "lunch",
            whyThisFits: "A solid midday stop to refuel after the morning",
            priceRange: lunchRestaurant?.priceRange || "€€",
            walkability: "nearby",
            culinaryTags: ["local", "casual"],
        };
        
        // Add TripAdvisor data if available
        if (lunchRestaurant?.tripAdvisorUrl || lunchRestaurant?.rating) {
            lunchActivity.fromTripAdvisor = true;
            lunchActivity.tripAdvisorUrl = lunchRestaurant.tripAdvisorUrl || null;
            lunchActivity.tripAdvisorRating = lunchRestaurant.rating || null;
            lunchActivity.tripAdvisorReviewCount = lunchRestaurant.reviewCount || null;
            lunchActivity.cuisine = lunchRestaurant.cuisine || null;
            lunchActivity.priceRange = lunchRestaurant.priceRange || null;
            lunchActivity.address = lunchRestaurant.address || null;
        }
        
        dayActivities.push(lunchActivity);
        
        // Afternoon activity
        const afternoonActivity = destActivities[(i + 1) % destActivities.length];
        dayActivities.push({
            time: "3:00 PM",
            title: afternoonActivity?.title || activities[(i + 1) % activities.length]?.title || "Afternoon Activity",
            description: afternoonActivity?.description || "Continue exploring",
            type: afternoonActivity?.type || "attraction",
            price: afternoonActivity?.price || 12,
            currency: "EUR",
            skipTheLine: afternoonActivity?.skipTheLine || false,
            skipTheLinePrice: afternoonActivity?.skipTheLinePrice || null,
            duration: afternoonActivity?.duration || "2 hours",
            bookingUrl: afternoonActivity?.bookingUrl || `https://www.viator.com/searchResults/all?text=${encodeURIComponent(trip.destination)}`,
            tips: afternoonActivity?.tips || null,
        });
        
        // Dinner - include TripAdvisor data if available
        const dinnerRestaurant = restaurants[(i + 1) % restaurants.length];
        const dinnerActivity: ItineraryActivity = {
            time: "7:00 PM",
            title: dinnerRestaurant?.name || "Dinner",
            description: `${dinnerRestaurant?.cuisine || "Local"} cuisine - ${dinnerRestaurant?.priceRange || "€€"}`,
            type: "restaurant",
            price: dinnerRestaurant?.priceRange === "€" ? 20 : dinnerRestaurant?.priceRange === "€€€" ? 55 : dinnerRestaurant?.priceRange === "€€€€" ? 100 : 35,
            currency: "EUR",
            skipTheLine: false,
            skipTheLinePrice: null,
            duration: "2 hours",
            bookingUrl: null,
            tips: "Try local specialties",
            culinaryMoment: "evening",
            culinaryType: "dinner",
            whyThisFits: "Wind down the day with a proper dinner",
            priceRange: dinnerRestaurant?.priceRange || "€€",
            walkability: "short-walk",
            culinaryTags: ["local", "casual"],
        };
        
        // Add TripAdvisor data if available
        if (dinnerRestaurant?.tripAdvisorUrl || dinnerRestaurant?.rating) {
            dinnerActivity.fromTripAdvisor = true;
            dinnerActivity.tripAdvisorUrl = dinnerRestaurant.tripAdvisorUrl || null;
            dinnerActivity.tripAdvisorRating = dinnerRestaurant.rating || null;
            dinnerActivity.tripAdvisorReviewCount = dinnerRestaurant.reviewCount || null;
            dinnerActivity.cuisine = dinnerRestaurant.cuisine || null;
            dinnerActivity.priceRange = dinnerRestaurant.priceRange || null;
            dinnerActivity.address = dinnerRestaurant.address || null;
        }
        
        dayActivities.push(dinnerActivity);
        
        dailyPlan.push({
            day: i + 1,
            title: `Day ${i + 1} in ${trip.destination}`,
            activities: dayActivities,
        });
    }
    
    return dailyPlan;
}

// Get activities with prices for specific destinations
function getActivitiesWithPrices(destination: string) {
    const destLower = destination.toLowerCase();
    
    const destinationActivities: Record<string, Array<{
        title: string;
        description: string;
        type: string;
        price: number;
        skipTheLine: boolean;
        skipTheLinePrice: number | null;
        duration: string;
        bookingUrl: string | null;
        tips: string | null;
    }>> = {
        "paris": [
            { title: "Eiffel Tower Summit", description: "Visit all levels including the summit", type: "attraction", price: 26, skipTheLine: true, skipTheLinePrice: 42, duration: "2-3 hours", bookingUrl: "https://www.getyourguide.com/paris-l16/eiffel-tower-summit-access-t395601/", tips: "Book at least 2 weeks in advance" },
            { title: "Louvre Museum", description: "World's largest art museum with Mona Lisa", type: "museum", price: 17, skipTheLine: true, skipTheLinePrice: 32, duration: "3-4 hours", bookingUrl: "https://www.getyourguide.com/paris-l16/louvre-museum-timed-entrance-ticket-t395439/", tips: "Enter via Carrousel entrance to avoid crowds" },
            { title: "Musée d'Orsay", description: "Impressionist masterpieces in a former train station", type: "museum", price: 16, skipTheLine: true, skipTheLinePrice: 29, duration: "2-3 hours", bookingUrl: "https://www.getyourguide.com/paris-l16/musee-d-orsay-skip-the-line-t395440/", tips: "Visit on Thursday evening for late opening" },
            { title: "Versailles Palace", description: "Royal château with stunning gardens", type: "attraction", price: 20, skipTheLine: true, skipTheLinePrice: 45, duration: "4-5 hours", bookingUrl: "https://www.getyourguide.com/versailles-l217/versailles-palace-skip-the-line-ticket-t395441/", tips: "Arrive early to see the gardens" },
            { title: "Seine River Cruise", description: "Scenic boat tour along the Seine", type: "tour", price: 15, skipTheLine: false, skipTheLinePrice: null, duration: "1 hour", bookingUrl: "https://www.getyourguide.com/paris-l16/seine-river-cruise-t395602/", tips: "Sunset cruises are most romantic" },
        ],
        "rome": [
            { title: "Colosseum & Roman Forum", description: "Ancient amphitheater and ruins", type: "attraction", price: 18, skipTheLine: true, skipTheLinePrice: 35, duration: "3 hours", bookingUrl: "https://www.getyourguide.com/rome-l33/colosseum-roman-forum-skip-the-line-t395442/", tips: "Visit at sunrise or sunset to avoid heat" },
            { title: "Vatican Museums & Sistine Chapel", description: "World-famous art collection and Michelangelo's ceiling", type: "museum", price: 17, skipTheLine: true, skipTheLinePrice: 40, duration: "3-4 hours", bookingUrl: "https://www.getyourguide.com/rome-l33/vatican-museums-sistine-chapel-skip-the-line-t395443/", tips: "Visit on Wednesday morning when Pope is at St. Peter's" },
            { title: "St. Peter's Basilica Dome", description: "Climb to the top for panoramic views", type: "attraction", price: 10, skipTheLine: true, skipTheLinePrice: 25, duration: "1.5 hours", bookingUrl: "https://www.getyourguide.com/rome-l33/st-peters-basilica-dome-climb-t395444/", tips: "Take the elevator option to save energy" },
            { title: "Borghese Gallery", description: "Stunning art collection in beautiful villa", type: "museum", price: 35, skipTheLine: true, skipTheLinePrice: 45, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/rome-l33/borghese-gallery-skip-the-line-t395445/", tips: "Reservations mandatory - book weeks ahead" },
            { title: "Trastevere Food Tour", description: "Iconic landmarks in historic center", type: "free", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "2-3 hours", bookingUrl: null, tips: "Best for evening strolls and dinner" },
        ],
        "barcelona": [
            { title: "Sagrada Familia", description: "Gaudí's unfinished masterpiece basilica", type: "attraction", price: 26, skipTheLine: true, skipTheLinePrice: 40, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/barcelona-l45/sagrada-familia-skip-the-line-t395446/", tips: "Book tower access for amazing views" },
            { title: "Park Güell", description: "Colorful mosaic park by Gaudí", type: "attraction", price: 10, skipTheLine: true, skipTheLinePrice: 22, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/barcelona-l45/park-guell-skip-the-line-t395447/", tips: "Morning light is best for photos" },
            { title: "Casa Batlló", description: "Gaudí's stunning modernist building", type: "museum", price: 35, skipTheLine: true, skipTheLinePrice: 45, duration: "1.5 hours", bookingUrl: "https://www.getyourguide.com/barcelona-l45/casa-batllo-skip-the-line-t395448/", tips: "Evening visits include light show" },
            { title: "La Pedrera (Casa Milà)", description: "Another Gaudí masterpiece with rooftop warriors", type: "museum", price: 25, skipTheLine: true, skipTheLinePrice: 35, duration: "1.5 hours", bookingUrl: "https://www.getyourguide.com/barcelona-l45/la-pedrera-skip-the-line-t395449/", tips: "Only open July-September" },
            { title: "Gothic Quarter Walking Tour", description: "Medieval streets and hidden squares", type: "tour", price: 15, skipTheLine: false, skipTheLinePrice: null, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/barcelona-l45/gothic-quarter-tour-t395450/", tips: "Free tours available with tips" },
        ],
        "athens": [
            { title: "Acropolis & Parthenon", description: "Ancient citadel and iconic temple", type: "attraction", price: 20, skipTheLine: true, skipTheLinePrice: 38, duration: "3 hours", bookingUrl: "https://www.getyourguide.com/athens-l128/acropolis-skip-the-line-t395451/", tips: "Visit at sunrise or sunset to avoid heat" },
            { title: "Acropolis Museum", description: "World's largest archaeological museum", type: "museum", price: 15, skipTheLine: true, skipTheLinePrice: 25, duration: "2-3 hours", bookingUrl: "https://www.getyourguide.com/athens-l128/national-archaeological-museum-t395454/", tips: "Don't miss the Antikythera mechanism" },
            { title: "Ancient Agora", description: "Ancient marketplace and Temple of Hephaestus", type: "attraction", price: 10, skipTheLine: false, skipTheLinePrice: null, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/athens-l128/ancient-agora-t395453/", tips: "Included in combined ticket" },
            { title: "National Archaeological Museum", description: "Greece's largest archaeological museum", type: "museum", price: 12, skipTheLine: true, skipTheLinePrice: 20, duration: "3-4 hours", bookingUrl: "https://www.getyourguide.com/athens-l128/national-archaeological-museum-t395454/", tips: "Don't miss the Antikythera mechanism" },
            { title: "Plaka & Monastiraki Walk", description: "Historic neighborhoods with shops and tavernas", type: "free", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "2-3 hours", bookingUrl: null, tips: "Best for evening strolls and dinner" },
        ],
        "london": [
            { title: "Tower of London", description: "Historic castle with Crown Jewels", type: "attraction", price: 33, skipTheLine: true, skipTheLinePrice: 45, duration: "3 hours", bookingUrl: "https://www.getyourguide.com/london-l57/tower-of-london-skip-the-line-t395455/", tips: "Join a Yeoman Warder tour" },
            { title: "Westminster Abbey", description: "Gothic abbey with royal history", type: "attraction", price: 27, skipTheLine: true, skipTheLinePrice: 38, duration: "2 hours", bookingUrl: "https://www.getyourguide.com/london-l57/westminster-abbey-skip-the-line-t395456/", tips: "Audio guide included" },
            { title: "British Museum", description: "World history and culture - free entry", type: "museum", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "3-4 hours", bookingUrl: "https://www.britishmuseum.org", tips: "Donation suggested, special exhibits extra" },
            { title: "London Eye", description: "Giant observation wheel with city views", type: "attraction", price: 32, skipTheLine: true, skipTheLinePrice: 45, duration: "1 hour", bookingUrl: "https://www.getyourguide.com/london-l57/london-eye-skip-the-line-t395457/", tips: "Book sunset slot for best photos" },
            { title: "Buckingham Palace", description: "Royal residence (summer opening)", type: "attraction", price: 30, skipTheLine: true, skipTheLinePrice: 42, duration: "2-3 hours", bookingUrl: "https://www.getyourguide.com/london-l57/buckingham-palace-t395458/", tips: "Only open July-September" },
        ],
        "amsterdam": [
            { title: "Anne Frank House", description: "Historic house museum", type: "museum", price: 16, skipTheLine: true, skipTheLinePrice: 28, duration: "1.5 hours", bookingUrl: "https://www.annefrank.org", tips: "Book exactly 2 months in advance at 10am" },
            { title: "Van Gogh Museum", description: "World's largest Van Gogh collection", type: "museum", price: 22, skipTheLine: true, skipTheLinePrice: 32, duration: "2-3 hours", bookingUrl: "https://www.getyourguide.com/amsterdam-l36/van-gogh-museum-skip-the-line-t395459/", tips: "Book timed entry in advance" },
            { title: "Rijksmuseum", description: "Dutch Golden Age masterpieces", type: "museum", price: 22, skipTheLine: true, skipTheLinePrice: 35, duration: "3-4 hours", bookingUrl: "https://www.getyourguide.com/amsterdam-l36/rijksmuseum-skip-the-line-t395460/", tips: "Don't miss The Night Watch" },
            { title: "Canal Cruise", description: "Explore Amsterdam's UNESCO waterways", type: "tour", price: 18, skipTheLine: false, skipTheLinePrice: null, duration: "1 hour", bookingUrl: "https://www.getyourguide.com/amsterdam-l36/canal-cruise-t395461/", tips: "Evening cruises are magical" },
            { title: "Heineken Experience", description: "Interactive brewery tour", type: "attraction", price: 23, skipTheLine: true, skipTheLinePrice: 30, duration: "1.5 hours", bookingUrl: "https://www.getyourguide.com/amsterdam-l36/heineken-experience-t395462/", tips: "Includes 2 beers" },
        ],
    };
    
    // Check if we have specific activities for this destination
    for (const [city, activities] of Object.entries(destinationActivities)) {
        if (destLower.includes(city)) {
            return activities;
        }
    }
    
    // Generic fallback
    return [
        { title: `City Highlights Tour`, description: "Discover the best of the city with a local guide", type: "tour", price: 25, skipTheLine: false, skipTheLinePrice: null, duration: "3 hours", bookingUrl: `https://www.getyourguide.com/s/?q=${encodeURIComponent(destination)}`, tips: null },
        { title: "Main Museum", description: "Explore local history and culture", type: "museum", price: 15, skipTheLine: true, skipTheLinePrice: 25, duration: "2 hours", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, tips: null },
        { title: "Walking Tour", description: "Explore the historic center", type: "tour", price: 12, skipTheLine: false, skipTheLinePrice: null, duration: "2 hours", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, tips: null },
        { title: "Local Market Visit", description: "Experience local life and cuisine", type: "free", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "2-3 hours", bookingUrl: null, tips: "Best in the morning" },
        { title: "Sunset Viewpoint", description: "Best views of the city", type: "free", price: 0, skipTheLine: false, skipTheLinePrice: null, duration: "1 hour", bookingUrl: null, tips: "Arrive 30 min before sunset" },
    ];
}

// Calculate daily expenses based on budget
function calculateDailyExpenses(budget: string | number): number {
    // Handle old string format
    if (typeof budget === "string") {
        const budgetMap: Record<string, number> = {
            "Low": 1000,
            "Medium": 2000,
            "High": 4000,
            "Luxury": 8000,
        };
        budget = budgetMap[budget] || 2000;
    }
    
    // Estimate daily expenses as roughly 30% of total budget divided by typical 7-day trip
    const estimatedDailyExpense = (budget * 0.3) / 7;
    return Math.max(50, Math.round(estimatedDailyExpense)); // Minimum €50/day
}

// Generate realistic flight data using AI and real airline routes (fallback when Duffel unavailable)
async function generateRealisticFlights(
    origin: string,
    originCode: string,
    destination: string,
    destCode: string,
    departureDate: string,
    returnDate: string,
    adults: number,
    preferredFlightTime: string = "any"
) {
    console.log("🤖 Generating realistic flight data with AI...");
    console.log(`   Preferred time: ${preferredFlightTime}`);
    
    // Get realistic airlines for this route
    const airlines = getRealisticAirlinesForRoute(originCode, destCode);
    
    // Calculate realistic flight duration based on distance
    const duration = calculateFlightDuration(originCode, destCode);
    
    // Define time slots based on preference
    const timeSlots = [
        { name: "morning", departure: "06:30 AM", label: "Early Morning" },
        { name: "morning", departure: "09:15 AM", label: "Morning" },
        { name: "afternoon", departure: "13:45 PM", label: "Afternoon" },
        { name: "evening", departure: "18:30 PM", label: "Evening" },
        { name: "night", departure: "22:15 PM", label: "Night" },
    ];
    
    // Calculate base price
    const basePrice = calculateRealisticPrice(originCode, destCode);
    
    // Generate a booking URL (Skyscanner deep link)
    const depDateStr = departureDate.slice(2).replace(/-/g, '');
    const retDateStr = returnDate.slice(2).replace(/-/g, '');
    const bookingUrl = `https://www.skyscanner.com/transport/flights/${originCode}/${destCode}/${depDateStr}/${retDateStr}`;

    // Generate multiple flight options
    const flightOptions = [];
    
    // Generate 4 different flight options with varying times and prices
    const selectedSlots = preferredFlightTime === "any" 
        ? [timeSlots[1], timeSlots[2], timeSlots[3], timeSlots[0]] // Morning, Afternoon, Evening, Early
        : [
            timeSlots.find(s => s.name === preferredFlightTime) || timeSlots[1],
            ...timeSlots.filter(s => s.name !== preferredFlightTime).slice(0, 3)
        ];
    
    let bestPrice = Infinity;
    
    // First pass to find best price
    for (let i = 0; i < 4; i++) {
        // Price varies: early morning and night are cheaper, afternoon is most expensive
        const priceMultiplier = i === 0 ? 1.0 : i === 1 ? 1.15 : i === 2 ? 1.25 : 0.9;
        const price = Math.round(basePrice * priceMultiplier);
        if (price < bestPrice) bestPrice = price;
    }
    
    for (let i = 0; i < 4; i++) {
        const slot = selectedSlots[i] || timeSlots[i];
        const airline = airlines[i % airlines.length];
        
        // Price varies: early morning and night are cheaper, afternoon is most expensive
        const priceMultiplier = i === 0 ? 1.0 : i === 1 ? 1.15 : i === 2 ? 1.25 : 0.9;
        const price = Math.round(basePrice * priceMultiplier);
        
        const outboundDeparture = slot.departure;
        const outboundArrival = addHoursToTime(outboundDeparture, duration);
        
        // Return flight times (different from outbound)
        const returnSlot = timeSlots[(i + 2) % timeSlots.length];
        const returnDeparture = returnSlot.departure;
        const returnArrival = addHoursToTime(returnDeparture, duration);
        
        flightOptions.push({
            id: i + 1,
            outbound: {
                airline: airline.name,
                airlineCode: airline.code,
                flightNumber: `${airline.code}${Math.floor(Math.random() * 9000) + 1000}`,
                duration: `${Math.floor(duration)}h ${Math.round((duration % 1) * 60)}m`,
                departure: outboundDeparture,
                arrival: outboundArrival,
                stops: i === 3 ? 1 : 0, // Last option has 1 stop (cheaper)
                departureTime: `${departureDate}T${convertTo24Hour(outboundDeparture)}:00`,
            },
            return: {
                airline: airline.name,
                airlineCode: airline.code,
                flightNumber: `${airline.code}${Math.floor(Math.random() * 9000) + 1000}`,
                duration: `${Math.floor(duration)}h ${Math.round((duration % 1) * 60)}m`,
                departure: returnDeparture,
                arrival: returnArrival,
                stops: i === 3 ? 1 : 0,
                departureTime: `${returnDate}T${convertTo24Hour(returnDeparture)}:00`,
            },
            luggage: i < 2 ? "1 checked bag included" : "Cabin bag only",
            cabinBaggage: "1 cabin bag (8kg) included",
            checkedBaggageIncluded: i < 2, // First 2 options include checked bag
            checkedBaggagePrice: i < 2 ? 0 : (25 + Math.floor(Math.random() * 20)), // €25-45 if not included
            pricePerPerson: price,
            totalPrice: price * adults,
            currency: "EUR",
            isBestPrice: price === bestPrice,
            timeCategory: slot.name,
            matchesPreference: preferredFlightTime === "any" || slot.name === preferredFlightTime,
            label: slot.label,
            bookingUrl,
        });
    }
    
    // Sort by preference match first, then by price
    flightOptions.sort((a, b) => {
        if (a.matchesPreference && !b.matchesPreference) return -1;
        if (!a.matchesPreference && b.matchesPreference) return 1;
        return a.pricePerPerson - b.pricePerPerson;
    });
    
    return {
        options: flightOptions,
        bestPrice,
        preferredTime: preferredFlightTime,
        dataSource: "ai-generated",
    };
}

// Helper to convert 12-hour time to 24-hour format
function convertTo24Hour(time12h: string): string {
    const [time, period] = time12h.split(' ');
    const [hStr, mStr] = time.split(':');
    let h = Number(hStr);
    const m = Number(mStr);
    
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Get realistic airlines that operate on a specific route
function getRealisticAirlinesForRoute(originCode: string, destCode: string): Array<{ code: string; name: string }> {
    // Map of major airlines by region
    const airlinesByRegion: Record<string, Array<{ code: string; name: string }>> = {
        EU: [
            { code: "LH", name: "Lufthansa" },
            { code: "AF", name: "Air France" },
            { code: "BA", name: "British Airways" },
            { code: "IB", name: "Iberia" },
            { code: "KL", name: "KLM" },
            { code: "SQ", name: "Singapore Airlines" },
            { code: "EK", name: "Emirates" },
        ],
        US: [
            { code: "AA", name: "American Airlines" },
            { code: "UA", name: "United Airlines" },
            { code: "DL", name: "Delta Air Lines" },
            { code: "SW", name: "Southwest Airlines" },
        ],
        ASIA: [
            { code: "SQ", name: "Singapore Airlines" },
            { code: "CX", name: "Cathay Pacific" },
            { code: "NH", name: "All Nippon Airways" },
            { code: "CA", name: "Air China" },
        ],
    };

    // Determine region based on airport codes
    const euCodes = ["LHR", "CDG", "AMS", "FCO", "MAD", "BCN", "VIE", "ZRH", "MUC", "ORY"];
    const usCodes = ["JFK", "LAX", "ORD", "DFW", "ATL", "MIA", "SFO", "BOS"];
    const asiaCodes = ["SIN", "HKG", "NRT", "HND", "PVG", "PEK", "BKK", "ICN"];

    let region = "EU";
    if (usCodes.includes(originCode) || usCodes.includes(destCode)) region = "US";
    if (asiaCodes.includes(originCode) || asiaCodes.includes(destCode)) region = "ASIA";

    // Use euCodes for determining EU region (suppress unused warning)
    if (euCodes.includes(originCode) || euCodes.includes(destCode)) region = "EU";

    return airlinesByRegion[region] || airlinesByRegion["EU"];
}

// Calculate realistic flight duration based on airport codes (simplified)
function calculateFlightDuration(originCode: string, destCode: string): number {
    // Approximate flight times between major cities (in hours)
    const distances: Record<string, Record<string, number>> = {
        LHR: { CDG: 1.25, AMS: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2.5, VIE: 2.5, ZRH: 1.5, MUC: 2, ORY: 1.25 },
        CDG: { LHR: 1.25, AMS: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2.5, VIE: 2.5, ZRH: 1.5, MUC: 2, ORY: 0.5 },
        AMS: { LHR: 1.25, CDG: 1.25, FCO: 2.5, MAD: 2.5, BCN: 2, VIE: 2, ZRH: 1.5, MUC: 2 },
        FCO: { LHR: 2.5, CDG: 2.5, AMS: 2.5, MAD: 3, BCN: 2, VIE: 2, ZRH: 2, MUC: 2 },
        MAD: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 3, BCN: 2, VIE: 3, ZRH: 2.5, MUC: 2.5 },
        BCN: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 2.5, MAD: 2, VIE: 3, ZRH: 2.5, MUC: 2.5 },
        VIE: { LHR: 2.5, CDG: 2.5, AMS: 2.5, FCO: 2, MAD: 3, BCN: 2, ZRH: 1.5, MUC: 1 },
        ZRH: { LHR: 1.5, CDG: 1.5, AMS: 1.5, FCO: 2, MAD: 2.5, BCN: 2.5, VIE: 1.5, MUC: 1 },
        MUC: { LHR: 2, CDG: 2, AMS: 2, FCO: 2, MAD: 2.5, BCN: 2.5, VIE: 1, ZRH: 1 },
    };

    // Default to 2.5 hours if route not found
    return distances[originCode]?.[destCode] || 2.5;
}

// Calculate realistic pricing based on route
function calculateRealisticPrice(originCode: string, destCode: string): number {
    // Base prices for different route types (in EUR)
    const shortHaul = 80;  // < 2 hours
    const mediumHaul = 150; // 2-4 hours
    const longHaul = 400;   // > 4 hours

    const duration = calculateFlightDuration(originCode, destCode);

    if (duration < 2) return shortHaul + Math.random() * 40;
    if (duration < 4) return mediumHaul + Math.random() * 100;
    return longHaul + Math.random() * 200;
}

// Helper to add hours to a time string
function addHoursToTime(time: string, hours: number): string {
    const [timePart, period] = time.split(' ');
    let [h, m] = timePart.split(':').map(Number);

    // Convert to 24-hour format
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;

    // Add hours
    h += Math.floor(hours);
    const minutesToAdd = Math.round((hours % 1) * 60);
    m += minutesToAdd;

    // Handle minute overflow
    if (m >= 60) {
        h += Math.floor(m / 60);
        m = m % 60;
    }

    // Handle hour overflow
    h = h % 24;

    // Convert back to 12-hour format
    const newPeriod = h >= 12 ? 'PM' : 'AM';
    const newH = h % 12 || 12;

    return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${newPeriod}`;
}