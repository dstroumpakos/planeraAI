"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import * as duffel from "./flights/duffel";

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

export const generate = internalAction({
    args: { 
        tripId: v.id("trips"), 
        prompt: v.string(), 
        skipFlights: v.optional(v.boolean()),
        skipHotel: v.optional(v.boolean()),
        preferredFlightTime: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { tripId, skipFlights, skipHotel, preferredFlightTime } = args;

        console.log("=".repeat(80));
        console.log("🚀 TRIP GENERATION STARTED");
        console.log("=".repeat(80));
        console.log("Trip ID:", tripId);
        console.log("Prompt:", args.prompt);
        console.log("Skip Flights:", skipFlights ? "Yes" : "No");
        console.log("Skip Hotel:", skipHotel ? "Yes" : "No");
        console.log("Preferred Flight Time:", preferredFlightTime || "any");

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
        console.log("  - Travelers:", trip.travelers);
        console.log("  - Budget:", trip.budget);
        console.log("  - Interests:", trip.interests);
        console.log("  - Selected Traveler IDs:", trip.selectedTravelerIds || "none");
        
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
            let flights = null;
            let hotels;
            // These must use 'let' because the linter incorrectly suggests const 
            // but they're declared here and assigned later in the try block
            // eslint-disable-next-line prefer-const
            let activities;
            // eslint-disable-next-line prefer-const
            let restaurants;

            // 1. Fetch flights (with fallback) - SKIP if user already has flights
            if (skipFlights) {
                console.log("✈️ Skipping flight search - user already has flights booked");
                flights = {
                    skipped: true,
                    message: "You indicated you already have flights booked",
                    dataSource: "user-provided",
                };
            } else {
                console.log("✈️ Fetching flights...");
                console.log("  - Preferred time:", preferredFlightTime || "any");
                if (hasDuffelKey) {
                    try {
                        const originCode = extractIATACode(origin);
                        const destCode = extractIATACode(trip.destination);
                        const departureDate = new Date(trip.startDate).toISOString().split('T')[0];
                        const returnDate = new Date(trip.endDate).toISOString().split('T')[0];

                        console.log(`🔍 Searching flights via Duffel: ${originCode} -> ${destCode}`);
                        console.log(`   Origin input: "${origin}", Destination input: "${trip.destination}"`);
                        console.log(`   Departure: ${departureDate}, Return: ${returnDate}, Adults: ${trip.travelers}`);
                        
                        // Validate IATA codes before calling Duffel
                        if (!originCode || !destCode) {
                            console.warn(`⚠️ Invalid IATA codes - Origin: "${originCode}", Dest: "${destCode}". Falling back to AI flights.`);
                            throw new Error("Invalid IATA codes");
                        }
                        
                        if (originCode === destCode) {
                            console.warn(`⚠️ Origin and destination are the same (${originCode}). Falling back to AI flights.`);
                            throw new Error("Origin and destination are the same");
                        }
                        
                        const { offerRequestId, offers } = await duffel.createOfferRequest({
                            originCode,
                            destinationCode: destCode,
                            departureDate,
                            returnDate,
                            adults: trip.travelers,
                            passengerAges: travelerAges.length > 0 ? travelerAges : undefined,
                        });

                        if (!offers || offers.length === 0) {
                            console.warn("⚠️ No flights found via Duffel");
                            flights = await generateRealisticFlights(
                                origin,
                                originCode,
                                trip.destination,
                                destCode,
                                new Date(trip.startDate).toISOString().split('T')[0],
                                new Date(trip.endDate).toISOString().split('T')[0],
                                trip.travelers,
                                preferredFlightTime || "any"
                            );
                        } else {
                            // Define interface for flight option
                            interface FlightOption {
                                id: string;
                                pricePerPerson: number;
                                currency: string;
                                outbound: {
                                    airline: string;
                                    departure: string;
                                    arrival: string;
                                };
                                return?: {
                                    airline: string;
                                };
                                isBestPrice?: boolean;
                            }
                            
                            // Transform Duffel offers to our format
                            const flightOptions: FlightOption[] = offers.slice(0, 5).map((offer: unknown) =>
                                duffel.transformOfferToFlightOption(offer as Parameters<typeof duffel.transformOfferToFlightOption>[0])
                            );

                            // Sort by price and mark best price
                            flightOptions.sort((a, b) => a.pricePerPerson - b.pricePerPerson);
                            if (flightOptions.length > 0) {
                                flightOptions[0].isBestPrice = true;
                            }

                            console.log(`✅ Duffel returned ${flightOptions.length} flight options`);
                            console.log(`   Best price: €${flightOptions[0]?.pricePerPerson || 'N/A'}`);
                            console.log(`   Sample flight: ${flightOptions[0]?.outbound?.airline} - ${flightOptions[0]?.outbound?.departure} to ${flightOptions[0]?.outbound?.arrival}`);

                            flights = {
                                options: flightOptions,
                                bestPrice: flightOptions[0]?.pricePerPerson || 0,
                                preferredTime: preferredFlightTime || "any",
                                dataSource: "duffel",
                                offerRequestId,
                            };
                        }
                    } catch (error) {
                        console.error("❌ Duffel flights failed:", error);
                        const originCode = extractIATACode(origin);
                        const destCode = extractIATACode(trip.destination);
                        flights = await generateRealisticFlights(
                            origin,
                            originCode,
                            trip.destination,
                            destCode,
                            new Date(trip.startDate).toISOString().split('T')[0],
                            new Date(trip.endDate).toISOString().split('T')[0],
                            trip.travelers,
                            preferredFlightTime || "any"
                        );
                    }
                } else {
                    const originCode = extractIATACode(origin);
                    const destCode = extractIATACode(trip.destination);
                    flights = await generateRealisticFlights(
                        origin,
                        originCode,
                        trip.destination,
                        destCode,
                        new Date(trip.startDate).toISOString().split('T')[0],
                        new Date(trip.endDate).toISOString().split('T')[0],
                        trip.travelers,
                        preferredFlightTime || "any"
                    );
                }
                console.log("✅ Flights ready:", flights.dataSource);
            }

            // 2. Fetch hotels (with fallback)
            console.log("🏨 Fetching hotels...");
            if (skipHotel) {
                console.log("✈️ Skipping hotel search - user already has accommodation booked");
                hotels = {
                    skipped: true,
                    message: "You indicated you already have accommodation booked",
                    dataSource: "user-provided",
                };
            } else {
                // Currently using fallback hotel data
                // TODO: Integrate with Duffel Hotels API when available
                hotels = getFallbackHotels(trip.destination);
            }
            console.log(`✅ Hotels ready: ${typeof hotels === 'object' && 'skipped' in hotels ? "Skipped" : (Array.isArray(hotels) ? hotels.length + " options" : "Unknown")}`);

            // 3. Fetch activities (with fallback)
            console.log("🎯 Fetching activities...");
            activities = await searchActivities(trip.destination); // eslint-disable-line prefer-const
            console.log(`✅ Activities ready: ${activities.length} options`);

            // 4. Fetch restaurants (with fallback)
            console.log("🍽️ Fetching restaurants...");
            restaurants = await searchRestaurants(trip.destination); // eslint-disable-line prefer-const
            console.log(`✅ Restaurants ready: ${restaurants.length} options`);

            // 5. Generate transportation options
            console.log("🚗 Generating transportation options...");
            const transportation = generateTransportationOptions(trip.destination, origin, trip.travelers);
            console.log(`✅ Transportation ready: ${transportation.length} options`);

            // 6. Generate day-by-day itinerary with OpenAI
            console.log("📝 Generating itinerary with OpenAI...");
            let dayByDayItinerary;
            if (hasOpenAIKey) {
                try {
                    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    const budgetDisplay = typeof trip.budget === "number" ? `€${trip.budget}` : trip.budget;
                    const itineraryPrompt = `Create a detailed day-by-day itinerary for a trip to ${trip.destination} from ${new Date(trip.startDate).toDateString()} to ${new Date(trip.endDate).toDateString()}.

Budget: ${budgetDisplay}
Travelers: ${trip.travelers}
Interests: ${trip.interests.join(", ")}

${generateTravelStyleGuidance(trip.interests)}

IMPORTANT: For each activity, include:
- Realistic entry prices in EUR
- Whether "Skip the Line" tickets are available (for museums, attractions)
- Skip the Line price (usually 5-15€ more than regular)
- A booking URL (use real booking platforms like GetYourGuide, Viator, or official sites)

Include specific activities, restaurants, and attractions for each day. Format as JSON with structure:
{
  "dailyPlan": [
    {
      "day": 1,
      "date": "2024-01-15",
      "title": "Day 1 in ${trip.destination}",
      "activities": [
        {
          "time": "09:00 AM",
          "title": "Activity name",
          "description": "Brief description",
          "type": "attraction|museum|restaurant|tour|free",
          "price": 25,
          "currency": "EUR",
          "skipTheLine": true,
          "skipTheLinePrice": 35,
          "duration": "2-3 hours",
          "bookingUrl": "https://www.getyourguide.com/...",
          "tips": "Best to visit early morning"
        }
      ]
    }
  ]
}

Make sure prices are realistic for ${trip.destination}. Museums typically cost €10-25, skip-the-line adds €5-15. Tours cost €20-80. Restaurants show average meal cost per person.`;
                    const completion = await openai.chat.completions.create({
                        messages: [
                            { role: "system", content: "You are a travel itinerary planner. Return only valid JSON. Always include realistic prices and booking information for activities." },
                            { role: "user", content: itineraryPrompt },
                        ],
                        model: "gpt-4o",
                        response_format: { type: "json_object" },
                    });

                    const itineraryContent = completion.choices[0].message.content;
                    if (itineraryContent) {
                        const itineraryData = JSON.parse(itineraryContent);
                        dayByDayItinerary = itineraryData.dailyPlan || [];
                        console.log(`✅ OpenAI generated ${dayByDayItinerary.length} days of itinerary`);
                        
                        // Merge TripAdvisor data into restaurant activities
                        dayByDayItinerary = mergeRestaurantDataIntoItinerary(dayByDayItinerary, restaurants);
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
                estimatedDailyExpenses: calculateDailyExpenses(Number(trip.budget)),
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
        { name: "Sunset Experience", title: "Sunset Experience", type: "experience", price: 45, currency: "EUR", rating: 4.8, reviewCount: 150, duration: "2 hours", description: "Watch the sunset from the best viewpoint", bookingUrl: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(destination)}`, skipTheLine: false, dataSource: "fallback", image: null, imageUrl: null },
    ];
}

// Helper function to search for restaurants using TripAdvisor API
async function searchRestaurants(destination: string) {
    // TripAdvisor Content API requires domain whitelisting which may not be configured
    // Using fallback data for now - user can set up TripAdvisor API key and configure domain
    console.log(`🍽️ Using fallback restaurants for: ${destination}`);
    return getFallbackRestaurants(destination);
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
            { name: "Le Comptoir du Panthéon", cuisine: "French", priceRange: "€€€", rating: 4.7, reviewCount: 2340, address: "10 Rue Soufflot", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Chez Janou", cuisine: "Provençal", priceRange: "€€", rating: 4.5, reviewCount: 4560, address: "2 Rue Roger Verlomme", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Pink Mamma", cuisine: "Italian", priceRange: "€€", rating: 4.6, reviewCount: 8920, address: "20bis Rue de Douai", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Bouillon Chartier", cuisine: "French", priceRange: "€", rating: 4.3, reviewCount: 12340, address: "7 Rue du Faubourg Montmartre", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
            { name: "Le Bouillon Pigalle", cuisine: "French Bistro", priceRange: "€€", rating: 4.4, reviewCount: 5670, address: "22 Boulevard de Clichy", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187147-Paris", dataSource: "fallback" },
        ],
        "rome": [
            { name: "Roscioli Salumeria con Cucina", cuisine: "Italian", priceRange: "€€€", rating: 4.8, reviewCount: 3450, address: "Via dei Giubbonari 21", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Pizzarium", cuisine: "Pizza", priceRange: "€", rating: 4.7, reviewCount: 6780, address: "Via della Meloria 43", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Da Enzo al 29", cuisine: "Roman", priceRange: "€€", rating: 4.6, reviewCount: 5230, address: "Salita dei Crescenzi 31", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Armando al Pantheon", cuisine: "Italian", priceRange: "€€€", rating: 4.5, reviewCount: 4120, address: "Salita dei Vascellari 29", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
            { name: "Supplì Roma", cuisine: "Roman Street Food", priceRange: "€", rating: 4.4, reviewCount: 2890, address: "Via di San Francesco a Ripa 137", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187791-Rome", dataSource: "fallback" },
        ],
        "barcelona": [
            { name: "Cal Pep", cuisine: "Catalan", priceRange: "€€€", rating: 4.6, reviewCount: 4560, address: "Plaça de les Olles 8", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Cervecería Catalana", cuisine: "Tapas", priceRange: "€€", rating: 4.5, reviewCount: 9870, address: "Carrer de Mallorca 236", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "La Pepita", cuisine: "Spanish", priceRange: "€€", rating: 4.7, reviewCount: 3210, address: "Carrer de Còrsega 343", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "El Xampanyet", cuisine: "Catalan Tapas", priceRange: "€", rating: 4.4, reviewCount: 5430, address: "Carrer de Montcada 22", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
            { name: "Can Culleretes", cuisine: "Catalan", priceRange: "€€", rating: 4.3, reviewCount: 2890, address: "Carrer d'en Quintana 5", tripAdvisorUrl: "https://www.tripadvisor.com/Restaurant_Review-g187497-Barcelona", dataSource: "fallback" },
        ],
    };
    
    // Check if we have fallback for this city
    for (const [city, restaurants] of Object.entries(fallbackByCity)) {
        if (destLower.includes(city)) {
            return restaurants;
        }
    }
    
    // Generic fallback
    return [
        { name: "Local Bistro", cuisine: "Local", priceRange: "€€", rating: 4.5, reviewCount: 250, address: "City Center", tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`, dataSource: "fallback" },
        { name: "Traditional Restaurant", cuisine: "Traditional", priceRange: "€€", rating: 4.4, reviewCount: 180, address: "Old Town", tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`, dataSource: "fallback" },
        { name: "Fine Dining", cuisine: "International", priceRange: "€€€€", rating: 4.8, reviewCount: 120, address: "Downtown", tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`, dataSource: "fallback" },
        { name: "Street Food Market", cuisine: "Street Food", priceRange: "€", rating: 4.3, reviewCount: 420, address: "Market Square", tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`, dataSource: "fallback" },
        { name: "Seafood Restaurant", cuisine: "Seafood", priceRange: "€€€", rating: 4.6, reviewCount: 310, address: "Harbor Area", tripAdvisorUrl: `https://www.tripadvisor.com/Restaurants-${encodeURIComponent(destination)}`, dataSource: "fallback" },
    ];
}

// Helper function to generate transportation options
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateTransportationOptions(destination: string, origin: string, travelers: number) {
    return [
        { name: "Public Transport Pass", price: 15, currency: "EUR", description: "24-hour public transport pass" },
        { name: "Taxi/Uber", price: 25, currency: "EUR", description: "Average taxi ride in city" },
        { name: "Car Rental", price: 50, currency: "EUR", description: "Daily car rental" },
        { name: "Bike Rental", price: 10, currency: "EUR", description: "Daily bike rental" },
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
}

function generateBasicItinerary(trip: TripData, activities: Array<{ title?: string }>, restaurants: RestaurantInfo[]) {
    const days = Math.ceil((trip.endDate - trip.startDate) / (24 * 60 * 60 * 1000));
    const dailyPlan = [];
    
    // Get destination-specific activities with prices
    const destActivities = getActivitiesWithPrices(trip.destination);
    
    for (let i = 0; i < days; i++) {
        const dayActivities: ItineraryActivity[] = [];
        
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
        { title: "Walking Tour", description: "Explore the historic center", type: "tour", price: 12, skipTheLine: false, skipTheLinePrice: null, duration: "2 hours", bookingUrl: `https://www.getyourguide.com/s/?q=${encodeURIComponent(destination)}`, tips: null },
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