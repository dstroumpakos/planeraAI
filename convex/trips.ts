import { v } from "convex/values";
import { authMutation, authQuery, authAction } from "./functions";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { isSubscriptionActiveWithGrace } from "./helpers/subscription";
import { getDistanceMeters } from "./helpers/geo";
import { assignActivityIds, dedupeVenues, resequenceDayTimes, reassignTimeSlots } from "./helpers/itinerary";
import { getAvgDailySpend, getAvgStay, SPEND_CURRENCY } from "./destinationSpend";
import { normalizeDestinationKey } from "./partnerApiAuth";
import { UNWTO_COUNTRY_STATS } from "./unwtoCountryStats";
import { toEnglishName } from "../lib/destinationTranslations";

/**
 * Resolve a destination's average spend PER TRIP (per person) + typical stay,
 * preferring REAL UN Tourism (UNWTO) country figures. UNWTO covers ~180
 * countries worldwide; for anything it doesn't have (and city-only strings with
 * no country) we fall back to the curated estimates in destinationSpend.ts,
 * deriving a per-trip figure from the per-day estimate × typical stay.
 * `spendSource` records which was used ("unwto" | "estimate").
 */
function resolveSpendStay(destination: string): {
    avgTripSpend: number | null;
    spendCurrency: string;
    spendLevel: "city" | "country" | null;
    avgStayDays: number | null;
    stayLevel: "city" | "country" | null;
    spendSource: "unwto" | "estimate" | null;
} {
    const segments = destination.split(",").map((s) => s.trim()).filter(Boolean);
    const countryToken = segments.length > 1 ? normalizeDestinationKey(segments[segments.length - 1]) : "";
    const unwto = countryToken ? UNWTO_COUNTRY_STATS[countryToken] : undefined;

    if (unwto) {
        const stay = unwto.stayDays ?? getAvgStay(destination)?.days ?? null;
        return {
            avgTripSpend: unwto.spendPerTripEUR,
            spendCurrency: SPEND_CURRENCY,
            spendLevel: "country",
            avgStayDays: stay,
            stayLevel: stay != null ? "country" : null,
            spendSource: "unwto",
        };
    }

    // Fallback: curated per-day estimate × typical stay → an estimated per-trip.
    const spend = getAvgDailySpend(destination);
    const stay = getAvgStay(destination);
    const stayDays = stay ? stay.days : null;
    return {
        avgTripSpend: spend ? Math.round(spend.amount * (stayDays ?? 4)) : null,
        spendCurrency: SPEND_CURRENCY,
        spendLevel: spend ? spend.level : null,
        avgStayDays: stayDays,
        stayLevel: stay ? stay.level : null,
        spendSource: spend ? "estimate" : null,
    };
}

export const create = authMutation({
    args: {
        token: v.string(),
        destination: v.string(),
        origin: v.string(),
        startDate: v.float64(),
        endDate: v.float64(),
        // V1: budgetTotal (numeric, required)
        budgetTotal: v.float64(),
        // V1: travelerCount (numeric, required, min 1, max 12)
        travelerCount: v.float64(),
        // Legacy field for backward compatibility
        budget: v.optional(v.union(v.float64(), v.string())),
        travelers: v.optional(v.float64()),
        interests: v.array(v.string()),
        // Local Experiences for authentic local recommendations
        localExperiences: v.optional(v.array(v.string())),
        skipFlights: v.optional(v.boolean()),
        skipHotel: v.optional(v.boolean()),
        preferredFlightTime: v.optional(v.string()),
        // Arrival/Departure times (ISO datetime strings in destination timezone)
        arrivalTime: v.optional(v.string()),
        departureTime: v.optional(v.string()),
        // Language preference for AI-generated itinerary content
        language: v.optional(v.string()),
        // Platform the request came from: "ios" | "android" | "web"
        platform: v.optional(v.string()),
         // Disabled in V1 - traveler profiles not used
        selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
    },
    returns: v.id("trips"),
    handler: async (ctx: any, args: any) => {
        console.log("🚀 Creating trip with args:", JSON.stringify(args, null, 2));

        // Validate numeric fields
        if (isNaN(args.startDate)) throw new Error("Invalid startDate: NaN");
        if (isNaN(args.endDate)) throw new Error("Invalid endDate: NaN");
         if (isNaN(args.travelerCount)) throw new Error("Invalid travelerCount: NaN");
        if (isNaN(args.budgetTotal)) throw new Error("Invalid budgetTotal: NaN");
        
        // V1 validation: travelerCount must be 1-12
        if (args.travelerCount < 1 || args.travelerCount > 12) {
            throw new Error("Traveler count must be between 1 and 12");
    }
 // V1 validation: budgetTotal must be positive
        if (args.budgetTotal <= 0) {
            throw new Error("Budget must be greater than 0");
        }
        
        // Compute perPersonBudget
        const perPersonBudget = Math.round(args.budgetTotal / args.travelerCount);
        console.log(`💰 Budget: €${args.budgetTotal} total / ${args.travelerCount} travelers = €${perPersonBudget} per person`);
    
        // Check if user can generate a trip
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .unique();

        // Check permissions (includes 16-day Apple billing grace period)
        const subscriptionStatus = isSubscriptionActiveWithGrace(
            userPlan?.plan,
            userPlan?.subscriptionExpiresAt,
        );
        const isSubActive = subscriptionStatus.active;
        
        const tripCredits = userPlan?.tripCredits ?? 0;
        const tripsGenerated = userPlan?.tripsGenerated ?? 0;
        const hasFreeTrial = tripsGenerated < 1;

        if (!isSubActive && tripCredits <= 0 && !hasFreeTrial) {
            throw new Error("No trip credits available. Please purchase a trip pack or subscribe to Premium.");
        }

        // Deduct credit or use free trial
        if (userPlan) {
            if (isSubActive) {
                // Premium users just increment stats
                await ctx.db.patch(userPlan._id, { 
                    tripsGenerated: tripsGenerated + 1,
                });
            } else if (tripCredits > 0) {
                // Use a trip credit
                await ctx.db.patch(userPlan._id, { 
                    tripCredits: tripCredits - 1,
                    tripsGenerated: tripsGenerated + 1,
                });
            } else {
                // Free trial
                await ctx.db.patch(userPlan._id, { 
                    tripsGenerated: 1,
                });
            }
        } else {
            // New user - create plan and use the 1 free credit
            await ctx.db.insert("userPlans", {
                userId: ctx.user.userId,
                plan: "free",
                tripsGenerated: 1,
                tripCredits: 0, // They used their 1 free credit
            });
        }

        const tripId = await ctx.db.insert("trips", {
            userId: ctx.user.userId,
            destination: args.destination,
            origin: args.origin,
            startDate: args.startDate,
            endDate: args.endDate,
            // V1: New fields
            budgetTotal: args.budgetTotal,
            travelerCount: args.travelerCount,
            perPersonBudget: perPersonBudget,
            // Legacy fields (for backward compatibility)
            budget: args.budgetTotal, // Store as number
            travelers: args.travelerCount,
            interests: args.interests,
            localExperiences: args.localExperiences ?? [],
            status: "generating",
            skipFlights: args.skipFlights ?? false,
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: args.preferredFlightTime ?? "any",
            // Arrival/Departure times for time-aware itineraries
            arrivalTime: args.arrivalTime,
            departureTime: args.departureTime,
            // Language preference for AI-generated content
            language: args.language || "en",
            // Platform the trip was generated from (ios/android/web)
            platform: args.platform,
            // V1: Disabled - not passing traveler profiles
            selectedTravelerIds: undefined,
        });

        const flightInfo = args.skipFlights 
            ? "Note: User already has flights booked, so DO NOT include flight recommendations."
            : `Flying from: ${args.origin}. Preferred flight time: ${args.preferredFlightTime || "any"}`;

        const hotelInfo = args.skipHotel
            ? "Note: User already has accommodation booked, so DO NOT include hotel recommendations."
            : "";

        const localExperiencesInfo = args.localExperiences && args.localExperiences.length > 0
            ? `\nLocal Experiences requested: ${args.localExperiences.join(", ")}. Prioritize authentic, non-touristy options for these experiences.`
            : "";

        // Build arrival/departure time info for the prompt
        // NOTE: Detailed time-aware constraints (3h buffer, activity restrictions) are handled in tripsActions.ts generateTimeAwareGuidance()
        // Keep this section minimal to avoid conflicting instructions
        let arrivalDepartureInfo = "";
        if (args.arrivalTime) {
            const arrivalDate = new Date(args.arrivalTime);
            const arrivalHours = String(arrivalDate.getUTCHours()).padStart(2, '0');
            const arrivalMins = String(arrivalDate.getUTCMinutes()).padStart(2, '0');
            arrivalDepartureInfo += `\nAirport arrival time: ${arrivalHours}:${arrivalMins} on ${arrivalDate.toUTCString().split(' ').slice(0, 4).join(' ')}. Detailed arrival day constraints provided separately.`;
        }
        if (args.departureTime) {
            const departureDate = new Date(args.departureTime);
            const depHours = String(departureDate.getUTCHours()).padStart(2, '0');
            const depMins = String(departureDate.getUTCMinutes()).padStart(2, '0');
            arrivalDepartureInfo += `\nDeparture time: ${depHours}:${depMins} on ${departureDate.toUTCString().split(' ').slice(0, 4).join(' ')}. Detailed departure day constraints provided separately.`;
        }

        const prompt = `Plan a trip to ${args.destination} for ${args.travelerCount} people.
        ${flightInfo}
        ${hotelInfo}
         Budget: €${args.budgetTotal} total (€${perPersonBudget} per person).
        Dates: ${new Date(args.startDate).toDateString()} to ${new Date(args.endDate).toDateString()}.${arrivalDepartureInfo}
        Interests: ${args.interests.join(", ")}.${localExperiencesInfo}`;

        // Schedule the generation action from tripsActions.ts
        await ctx.scheduler.runAfter(0, internal.tripsActions.generate, { 
            tripId, 
            prompt, 
            skipFlights: args.skipFlights ?? false,
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: args.preferredFlightTime ?? "any",
            arrivalTime: args.arrivalTime,
            departureTime: args.departureTime,
            language: args.language || "en",
        });

        // Trigger achievement check
        await ctx.scheduler.runAfter(0, internal.achievements.checkAndUnlock, { userId: ctx.user.userId });

        return tripId;
    },
});

// Create a trip from a Low Fare Radar deal
export const createFromDeal = authMutation({
    args: {
        token: v.string(),
        dealId: v.id("lowFareRadar"),
        budgetTotal: v.float64(),
        travelerCount: v.float64(),
        interests: v.array(v.string()),
        localExperiences: v.optional(v.array(v.string())),
        skipHotel: v.optional(v.boolean()),
        language: v.optional(v.string()),
        destinationCountry: v.optional(v.string()),
        originCountry: v.optional(v.string()),
        destinationCityFallback: v.optional(v.string()),
        originCityFallback: v.optional(v.string()),
        // Platform the request came from: "ios" | "android" | "web"
        platform: v.optional(v.string()),
    },
    returns: v.id("trips"),
    handler: async (ctx: any, args: any) => {
        // Fetch the deal
        const deal = await ctx.db.get(args.dealId);
        if (!deal || !deal.active) {
            throw new Error("This deal is no longer available");
        }

        // Validate
        if (args.travelerCount < 1 || args.travelerCount > 12) {
            throw new Error("Traveler count must be between 1 and 12");
        }
        if (args.budgetTotal <= 0) {
            throw new Error("Budget must be greater than 0");
        }

        const perPersonBudget = Math.round(args.budgetTotal / args.travelerCount);

        // Compute dates from deal
        const startDate = new Date(deal.outboundDate).getTime();
        const endDate = deal.returnDate
            ? new Date(deal.returnDate).getTime()
            : startDate + 3 * 24 * 60 * 60 * 1000; // Default 3 days for one-way

        // Check credits (same logic as create)
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .unique();

        const subscriptionStatus = isSubscriptionActiveWithGrace(
            userPlan?.plan,
            userPlan?.subscriptionExpiresAt,
        );
        const isSubActive = subscriptionStatus.active;
        const tripCredits = userPlan?.tripCredits ?? 0;
        const tripsGenerated = userPlan?.tripsGenerated ?? 0;
        const hasFreeTrial = tripsGenerated < 1;

        if (!isSubActive && tripCredits <= 0 && !hasFreeTrial) {
            throw new Error("No trip credits available. Please purchase a trip pack or subscribe to Premium.");
        }

        // Deduct credit
        if (userPlan) {
            if (isSubActive) {
                await ctx.db.patch(userPlan._id, { tripsGenerated: tripsGenerated + 1 });
            } else if (tripCredits > 0) {
                await ctx.db.patch(userPlan._id, { tripCredits: tripCredits - 1, tripsGenerated: tripsGenerated + 1 });
            } else {
                await ctx.db.patch(userPlan._id, { tripsGenerated: 1 });
            }
        } else {
            await ctx.db.insert("userPlans", {
                userId: ctx.user.userId,
                plan: "free",
                tripsGenerated: 1,
                tripCredits: 0,
            });
        }

        // Build deal flight data matching the itinerary.flights.options format
        const dealFlightData = {
            options: [{
                id: `deal-${deal._id}`,
                outbound: {
                    airline: deal.airline,
                    flightNumber: deal.flightNumber || "",
                    departure: deal.outboundDeparture,
                    arrival: deal.outboundArrival,
                    duration: deal.outboundDuration || "",
                    stops: deal.outboundStops ?? 0,
                    segments: deal.outboundSegments || undefined,
                },
                return: deal.returnDate ? {
                    airline: deal.returnAirline || deal.airline,
                    flightNumber: deal.returnFlightNumber || "",
                    departure: deal.returnDeparture || "",
                    arrival: deal.returnArrival || "",
                    duration: deal.returnDuration || "",
                    stops: deal.returnStops ?? 0,
                    segments: deal.returnSegments || undefined,
                } : undefined,
                pricePerPerson: deal.price,
                totalPrice: deal.totalPrice || deal.price * 2,
                currency: deal.currency,
                isBestPrice: true,
                checkedBaggageIncluded: !!deal.checkedBaggage,
                checkedBaggagePrice: 0,
                luggage: deal.cabinBaggage || "Check airline",
                bookingUrl: deal.bookingUrl || "",
                bookingRequest: deal.bookingRequest,
            }],
            bestPrice: deal.price,
            dataSource: "low-fare-radar",
            dealId: deal._id,
        };

        // Use city names; fall back to frontend-passed names if AI extraction left them empty.
        // Normalize to canonical English (names may be localized, e.g. Greek "Ρώμη")
        // so the stored destination stays consistent, matches the AI prompt, and
        // yields correct Unsplash imagery.
        const effectiveOriginCity = toEnglishName(deal.originCity || args.originCityFallback || deal.origin);
        const effectiveDestCity = toEnglishName(deal.destinationCity || args.destinationCityFallback || deal.destination);
        const effectiveOriginCountry = args.originCountry ? toEnglishName(args.originCountry) : undefined;
        const effectiveDestCountry = args.destinationCountry ? toEnglishName(args.destinationCountry) : undefined;

        const origin = effectiveOriginCountry
            ? `${effectiveOriginCity}, ${effectiveOriginCountry}`
            : effectiveOriginCity;
        const destination = effectiveDestCountry
            ? `${effectiveDestCity}, ${effectiveDestCountry}`
            : effectiveDestCity;

        const tripId = await ctx.db.insert("trips", {
            userId: ctx.user.userId,
            destination,
            origin,
            startDate,
            endDate,
            budgetTotal: args.budgetTotal,
            travelerCount: args.travelerCount,
            perPersonBudget,
            budget: args.budgetTotal,
            travelers: args.travelerCount,
            interests: args.interests,
            localExperiences: args.localExperiences ?? [],
            status: "generating",
            skipFlights: true, // Flight comes from the deal
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: "any",
            arrivalTime: deal.outboundDate && deal.outboundArrival
                ? `${deal.outboundDate}T${deal.outboundArrival}:00`
                : undefined,
            departureTime: deal.returnDate && deal.returnDeparture
                ? `${deal.returnDate}T${deal.returnDeparture}:00`
                : undefined,
            language: args.language || "en",
            platform: args.platform,
            tripType: "deal",
            dealId: args.dealId,
            dealFlightData,
        });

        const flightInfo = `Flying from: ${origin} to ${destination}. Flight already booked via Low Fare Radar deal (${deal.airline}, ${deal.outboundDeparture}-${deal.outboundArrival}). Do NOT include flight recommendations — focus on activities, hotels, and restaurants.`;

        const hotelInfo = args.skipHotel
            ? "Note: User already has accommodation booked, so DO NOT include hotel recommendations."
            : "";

        const prompt = `Plan a trip to ${destination} for ${args.travelerCount} people.
        ${flightInfo}
        ${hotelInfo}
        Budget: €${args.budgetTotal} total (€${perPersonBudget} per person).
        Dates: ${new Date(startDate).toDateString()} to ${new Date(endDate).toDateString()}.
        Interests: ${args.interests.join(", ")}.`;

        await ctx.scheduler.runAfter(0, internal.tripsActions.generate, {
            tripId,
            prompt,
            skipFlights: true,
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: "any",
            arrivalTime: deal.outboundDate && deal.outboundArrival
                ? `${deal.outboundDate}T${deal.outboundArrival}:00`
                : undefined,
            departureTime: deal.returnDate && deal.returnDeparture
                ? `${deal.returnDate}T${deal.returnDeparture}:00`
                : undefined,
            language: args.language || "en",
        });

        // Track plan-trip click on the deal
        await ctx.db.patch(args.dealId, {
            planTripClicks: (deal.planTripClicks ?? 0) + 1,
        });

        return tripId;
    },
});

// Create a trip from a flight selected in the SerpApi flight search screen.
// Same flow as createFromDeal, but the flight data comes straight from the
// client (normalized SerpApi option) instead of a stored lowFareRadar deal.
export const createFromFlight = authMutation({
    args: {
        token: v.string(),
        // Route (IATA codes + resolved city/country names from the client)
        origin: v.string(),
        destination: v.string(),
        originCity: v.optional(v.string()),
        destinationCity: v.optional(v.string()),
        originCountry: v.optional(v.string()),
        destinationCountry: v.optional(v.string()),
        // Outbound flight details
        airline: v.string(),
        flightNumber: v.optional(v.string()),
        outboundDate: v.string(),               // "2026-06-10"
        outboundDeparture: v.optional(v.string()), // "08:00"
        outboundArrival: v.optional(v.string()),   // "10:30"
        outboundDuration: v.optional(v.string()),
        outboundStops: v.optional(v.float64()),
        outboundSegments: v.optional(v.array(v.object({
            airline: v.string(),
            flightNumber: v.optional(v.string()),
            departureAirport: v.string(),
            departureTime: v.string(),
            arrivalAirport: v.string(),
            arrivalTime: v.string(),
            duration: v.optional(v.string()),
        }))),
        // Return leg (present when the user completed the two-step
        // outbound + return selection in the search screen).
        returnDate: v.optional(v.string()),
        returnDeparture: v.optional(v.string()),
        returnArrival: v.optional(v.string()),
        returnAirline: v.optional(v.string()),
        returnFlightNumber: v.optional(v.string()),
        returnDuration: v.optional(v.string()),
        returnStops: v.optional(v.float64()),
        returnSegments: v.optional(v.array(v.object({
            airline: v.string(),
            flightNumber: v.optional(v.string()),
            departureAirport: v.string(),
            departureTime: v.string(),
            arrivalAirport: v.string(),
            arrivalTime: v.string(),
            duration: v.optional(v.string()),
        }))),
        // Pricing
        pricePerPerson: v.float64(),
        totalPrice: v.optional(v.float64()),
        currency: v.string(),
        // SerpApi booking token of the selected itinerary — used to fetch
        // booking link(s) right after creation (tokens are short-lived).
        bookingToken: v.optional(v.string()),
        // Passenger count the flight search ran with. The booking token is
        // tied to it, so it may differ from the trip's final travelerCount.
        searchAdults: v.optional(v.float64()),
        // Trip preferences filled in by the user
        budgetTotal: v.float64(),
        travelerCount: v.float64(),
        interests: v.array(v.string()),
        localExperiences: v.optional(v.array(v.string())),
        skipHotel: v.optional(v.boolean()),
        language: v.optional(v.string()),
        platform: v.optional(v.string()),
    },
    returns: v.id("trips"),
    handler: async (ctx: any, args: any) => {
        // Validate
        if (args.travelerCount < 1 || args.travelerCount > 12) {
            throw new Error("Traveler count must be between 1 and 12");
        }
        if (args.budgetTotal <= 0) {
            throw new Error("Budget must be greater than 0");
        }

        const perPersonBudget = Math.round(args.budgetTotal / args.travelerCount);

        const startDate = new Date(args.outboundDate).getTime();
        if (isNaN(startDate)) throw new Error("Invalid outbound date");
        const endDate = args.returnDate
            ? new Date(args.returnDate).getTime()
            : startDate + 3 * 24 * 60 * 60 * 1000; // Default 3 days for one-way

        // Check credits (same logic as create)
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .unique();

        const subscriptionStatus = isSubscriptionActiveWithGrace(
            userPlan?.plan,
            userPlan?.subscriptionExpiresAt,
        );
        const isSubActive = subscriptionStatus.active;
        const tripCredits = userPlan?.tripCredits ?? 0;
        const tripsGenerated = userPlan?.tripsGenerated ?? 0;
        const hasFreeTrial = tripsGenerated < 1;

        if (!isSubActive && tripCredits <= 0 && !hasFreeTrial) {
            throw new Error("No trip credits available. Please purchase a trip pack or subscribe to Premium.");
        }

        // Deduct credit
        if (userPlan) {
            if (isSubActive) {
                await ctx.db.patch(userPlan._id, { tripsGenerated: tripsGenerated + 1 });
            } else if (tripCredits > 0) {
                await ctx.db.patch(userPlan._id, { tripCredits: tripCredits - 1, tripsGenerated: tripsGenerated + 1 });
            } else {
                await ctx.db.patch(userPlan._id, { tripsGenerated: 1 });
            }
        } else {
            await ctx.db.insert("userPlans", {
                userId: ctx.user.userId,
                plan: "free",
                tripsGenerated: 1,
                tripCredits: 0,
            });
        }

        // Build flight data matching the itinerary.flights.options format
        const dealFlightData = {
            options: [{
                id: `flight-search-${Date.now()}`,
                outbound: {
                    airline: args.airline,
                    flightNumber: args.flightNumber || "",
                    departure: args.outboundDeparture || "",
                    arrival: args.outboundArrival || "",
                    duration: args.outboundDuration || "",
                    stops: args.outboundStops ?? 0,
                    segments: args.outboundSegments || undefined,
                },
                return: args.returnDate && args.returnDeparture ? {
                    airline: args.returnAirline || args.airline,
                    flightNumber: args.returnFlightNumber || "",
                    departure: args.returnDeparture,
                    arrival: args.returnArrival || "",
                    duration: args.returnDuration || "",
                    stops: args.returnStops ?? 0,
                    segments: args.returnSegments || undefined,
                } : undefined,
                pricePerPerson: args.pricePerPerson,
                totalPrice: args.totalPrice || args.pricePerPerson * args.travelerCount,
                currency: args.currency,
                isBestPrice: true,
                checkedBaggageIncluded: false,
                checkedBaggagePrice: 0,
                luggage: "Check airline",
                bookingUrl: "",
            }],
            bestPrice: args.pricePerPerson,
            dataSource: "flight-search",
        };

        // City/country names may arrive in the user's language (e.g. Greek
        // "Ρώμη") from the explore/flight-search flow. Store the destination in
        // canonical English so it stays consistent with the English origin,
        // matches the AI prompt, and yields correct Unsplash imagery.
        const effectiveOriginCity = toEnglishName(args.originCity || args.origin);
        const effectiveDestCity = toEnglishName(args.destinationCity || args.destination);
        const effectiveOriginCountry = args.originCountry ? toEnglishName(args.originCountry) : undefined;
        const effectiveDestCountry = args.destinationCountry ? toEnglishName(args.destinationCountry) : undefined;

        const origin = effectiveOriginCountry
            ? `${effectiveOriginCity}, ${effectiveOriginCountry}`
            : effectiveOriginCity;
        const destination = effectiveDestCountry
            ? `${effectiveDestCity}, ${effectiveDestCountry}`
            : effectiveDestCity;

        const arrivalTime = args.outboundDate && args.outboundArrival
            ? `${args.outboundDate}T${args.outboundArrival}:00`
            : undefined;
        const departureTime = args.returnDate && args.returnDeparture
            ? `${args.returnDate}T${args.returnDeparture}:00`
            : undefined;

        const tripId = await ctx.db.insert("trips", {
            userId: ctx.user.userId,
            destination,
            origin,
            startDate,
            endDate,
            budgetTotal: args.budgetTotal,
            travelerCount: args.travelerCount,
            perPersonBudget,
            budget: args.budgetTotal,
            travelers: args.travelerCount,
            interests: args.interests,
            localExperiences: args.localExperiences ?? [],
            status: "generating",
            skipFlights: true, // Flight comes from the search selection
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: "any",
            arrivalTime,
            departureTime,
            language: args.language || "en",
            platform: args.platform,
            // Reuse the deal trip type so the locked-flight rendering applies;
            // dataSource "flight-search" in dealFlightData tells them apart.
            tripType: "deal",
            dealFlightData,
        });

        const flightInfo = `Flying from: ${origin} to ${destination}. Flight already selected via flight search (${args.airline}${args.outboundDeparture ? `, ${args.outboundDeparture}-${args.outboundArrival}` : ""}). Do NOT include flight recommendations — focus on activities, hotels, and restaurants.`;

        const hotelInfo = args.skipHotel
            ? "Note: User already has accommodation booked, so DO NOT include hotel recommendations."
            : "";

        const prompt = `Plan a trip to ${destination} for ${args.travelerCount} people.
        ${flightInfo}
        ${hotelInfo}
        Budget: €${args.budgetTotal} total (€${perPersonBudget} per person).
        Dates: ${new Date(startDate).toDateString()} to ${new Date(endDate).toDateString()}.
        Interests: ${args.interests.join(", ")}.`;

        await ctx.scheduler.runAfter(0, internal.tripsActions.generate, {
            tripId,
            prompt,
            skipFlights: true,
            skipHotel: args.skipHotel ?? false,
            preferredFlightTime: "any",
            arrivalTime,
            departureTime,
            language: args.language || "en",
        });

        // Fetch booking link(s) for the locked flight while the token is
        // still valid. Best-effort — the trip works without them. Uses the
        // searchapi.io enrichment because this token was minted by the
        // searchapi.io-backed search screen (tokens are provider-locked).
        if (args.bookingToken) {
            await ctx.scheduler.runAfter(0, internal.flightsSearchApi.enrichTripBooking, {
                tripId,
                bookingToken: args.bookingToken,
                departureId: args.origin,
                arrivalId: args.destination,
                outboundDate: args.outboundDate,
                returnDate: args.returnDate,
                currency: args.currency,
                adults: args.searchAdults ?? args.travelerCount,
            });
        }

        await ctx.scheduler.runAfter(0, internal.achievements.checkAndUnlock, { userId: ctx.user.userId });

        return tripId;
    },
});

// Store booking link(s) on a flight-search trip's locked flight data.
// Called by flightsSerpApi.enrichTripBooking right after trip creation.
// Patches dealFlightData and, if generation already copied it into the
// itinerary, the itinerary's flights block too (avoids the race between
// enrichment and AI generation, both scheduled at creation time).
export const setFlightBookingData = internalMutation({
    args: {
        tripId: v.id("trips"),
        bookingUrl: v.optional(v.string()),
        bookingRequest: v.optional(v.object({ url: v.string(), postData: v.string() })),
        outboundBookingUrl: v.optional(v.string()),
        outboundBookingRequest: v.optional(v.object({ url: v.string(), postData: v.string() })),
        returnBookingUrl: v.optional(v.string()),
        returnBookingRequest: v.optional(v.object({ url: v.string(), postData: v.string() })),
        // Full provider list (mirrors the booking sheet) for the Flights tab.
        bookingProviders: v.optional(v.array(v.object({
            bookWith: v.union(v.string(), v.null()),
            price: v.union(v.float64(), v.null()),
            airlineLogos: v.array(v.string()),
            extensions: v.array(v.string()),
            bookingRequest: v.object({ url: v.string(), postData: v.string() }),
        }))),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;

        const bookingFields: Record<string, any> = {};
        if (args.bookingUrl) bookingFields.bookingUrl = args.bookingUrl;
        if (args.bookingRequest) bookingFields.bookingRequest = args.bookingRequest;
        if (args.outboundBookingUrl) bookingFields.outboundBookingUrl = args.outboundBookingUrl;
        if (args.outboundBookingRequest) bookingFields.outboundBookingRequest = args.outboundBookingRequest;
        if (args.returnBookingUrl) bookingFields.returnBookingUrl = args.returnBookingUrl;
        if (args.returnBookingRequest) bookingFields.returnBookingRequest = args.returnBookingRequest;
        if (args.bookingProviders && args.bookingProviders.length > 0) {
            bookingFields.bookingProviders = args.bookingProviders;
        }
        if (Object.keys(bookingFields).length === 0) return null;

        const patch: Record<string, any> = {};

        if (trip.dealFlightData?.options?.length) {
            patch.dealFlightData = {
                ...trip.dealFlightData,
                options: trip.dealFlightData.options.map((o: any, i: number) =>
                    i === 0 ? { ...o, ...bookingFields } : o
                ),
            };
        }

        if (trip.itinerary?.flights?.options?.length) {
            patch.itinerary = {
                ...trip.itinerary,
                flights: {
                    ...trip.itinerary.flights,
                    options: trip.itinerary.flights.options.map((o: any, i: number) =>
                        i === 0 ? { ...o, ...bookingFields } : o
                    ),
                },
            };
        }

        if (Object.keys(patch).length > 0) {
            await ctx.db.patch(args.tripId, patch);
        }
        return null;
    },
});

// Internal query to get trip details
export const getTripDetails = internalQuery({
    args: { tripId: v.id("trips") },
    returns: v.union(
        v.null(),
        v.object({
            _id: v.id("trips"),
            _creationTime: v.number(),
            userId: v.string(),
            destination: v.string(),
            origin: v.optional(v.string()),
            startDate: v.number(),
            endDate: v.number(),
               // V1: New fields
            budgetTotal: v.optional(v.number()),
            travelerCount: v.optional(v.number()),
            perPersonBudget: v.optional(v.number()),
            // Legacy fields (optional for backward compatibility)
            budget: v.optional(v.union(v.number(), v.string())),
            travelers: v.optional(v.number()),
            interests: v.array(v.string()),
            localExperiences: v.optional(v.array(v.string())),
            skipFlights: v.optional(v.boolean()),
            skipHotel: v.optional(v.boolean()),
            preferredFlightTime: v.optional(v.string()),
            // Arrival/Departure times for time-aware itineraries
            arrivalTime: v.optional(v.string()),
            departureTime: v.optional(v.string()),
            // Language preference
            language: v.optional(v.string()),
            // Platform the trip was created from ("web" | "ios" | "android")
            platform: v.optional(v.string()),
            selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
            // Deal trip fields
            tripType: v.optional(v.string()),
            dealId: v.optional(v.id("lowFareRadar")),
            dealFlightData: v.optional(v.any()),
            status: v.string(),
            itinerary: v.optional(v.any()),
            generationProgress: v.optional(v.object({
                phase: v.union(
                    v.literal("planning"),
                    v.literal("building"),
                    v.literal("enriching"),
                    v.literal("done"),
                ),
                daysReady: v.number(),
                totalDays: v.number(),
            })),
            // Image fields
            destinationImage: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                attribution: v.string(),
            })),
            // Structured itinerary items (future use)
            itineraryItems: v.optional(v.any()),
            // Multi-city fields
            isMultiCity: v.optional(v.boolean()),
            destinations: v.optional(v.array(v.object({
                city: v.string(),
                country: v.string(),
                days: v.number(),
                order: v.number(),
            }))),
            optimizedRoute: v.optional(v.any()),
            errorMessage: v.optional(v.string()),
            // Location-based fields
            userAtDestination: v.optional(v.boolean()),
            lastLocationCheckAt: v.optional(v.number()),
            locationVerified: v.optional(v.boolean()),
            locationVerifiedAt: v.optional(v.number()),
            // Share Card fields
            tripCardId: v.optional(v.string()),
            shareCardPhoto: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                photographerUsername: v.optional(v.string()),
            })),
        })
    ),
    handler: async (ctx: any, args: any) => {
        return await ctx.db.get(args.tripId);
    },
});

// Internal query to get traveler ages for a trip's selected travelers
export const getTravelerAgesForTrip = internalQuery({
    args: { 
        tripId: v.id("trips"),
    },
    returns: v.array(v.number()),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip || !trip.selectedTravelerIds || trip.selectedTravelerIds.length === 0) {
            return [];
        }
        
        const departureDate = new Date(trip.startDate);
        const ages: number[] = [];
        
        for (const travelerId of trip.selectedTravelerIds) {
            const traveler = await ctx.db.get(travelerId);
            if (!traveler) continue;
            
            // Calculate age at departure date
            const birthDate = new Date(traveler.dateOfBirth);
            let age = departureDate.getFullYear() - birthDate.getFullYear();
            const monthDiff = departureDate.getMonth() - birthDate.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && departureDate.getDate() < birthDate.getDate())) {
                age--;
            }
            ages.push(age);
        }
        
        return ages;
    },
});

export const updateItinerary = internalMutation({
    args: {
        tripId: v.id("trips"),
        itinerary: v.any(),
        status: v.union(v.literal("generating"), v.literal("completed"), v.literal("failed")),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        await ctx.db.patch(args.tripId, {
            itinerary: args.itinerary,
            status: args.status,
        });
        return null;
    },
});

// ========================= Streaming day-by-day reveal =========================
// These mutations power the live "watch your trip build" experience. The
// generation action streams the itinerary one day at a time (NDJSON) and calls
// these to append each day and patch its enrichment independently.

/** Read the streamed day list for off-critical-path enrichment. */
export const getItineraryDays = internalQuery({
    args: { tripId: v.id("trips") },
    returns: v.any(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        const days = trip?.itinerary?.dayByDayItinerary;
        return Array.isArray(days) ? days : [];
    },
});

/** Patch just the live progress object (phase / day counts). */
export const setGenerationProgress = internalMutation({
    args: {
        tripId: v.id("trips"),
        phase: v.union(
            v.literal("planning"),
            v.literal("building"),
            v.literal("enriching"),
            v.literal("done"),
        ),
        daysReady: v.optional(v.float64()),
        totalDays: v.optional(v.float64()),
        // When true, clears any previously-streamed days so a regeneration starts
        // from an empty list instead of appending onto stale data.
        resetItinerary: v.optional(v.boolean()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;
        const prev = trip.generationProgress ?? { phase: "planning", daysReady: 0, totalDays: 0 };
        const patch: any = {
            generationProgress: {
                phase: args.phase,
                daysReady: args.daysReady ?? prev.daysReady ?? 0,
                totalDays: args.totalDays ?? prev.totalDays ?? 0,
            },
        };
        if (args.resetItinerary) {
            patch.itinerary = { ...(trip.itinerary ?? {}), dayByDayItinerary: [] };
        }
        await ctx.db.patch(args.tripId, patch);
        return null;
    },
});

/**
 * Append one freshly-streamed day to the itinerary so it appears on screen
 * immediately (un-enriched). Creates the itinerary scaffold on the first day.
 */
export const appendItineraryDay = internalMutation({
    args: {
        tripId: v.id("trips"),
        day: v.any(),
        totalDays: v.optional(v.float64()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;

        const itinerary = trip.itinerary ?? {};
        const days = Array.isArray(itinerary.dayByDayItinerary)
            ? [...itinerary.dayByDayItinerary]
            : [];
        days.push(args.day);

        const prev = trip.generationProgress ?? { phase: "building", daysReady: 0, totalDays: 0 };
        const totalDays = args.totalDays ?? prev.totalDays ?? days.length;

        await ctx.db.patch(args.tripId, {
            itinerary: { ...itinerary, dayByDayItinerary: days },
            generationProgress: {
                phase: "building",
                daysReady: days.length,
                totalDays,
            },
        });
        return null;
    },
});

/**
 * Day-scoped enrichment patch. Overwrites only dayByDayItinerary[dayIndex] so
 * concurrent per-day enrichment writes don't clobber each other (Convex OCC
 * serializes them). Flips phase -> "done" once every day has been enriched.
 */
export const patchDayEnrichment = internalMutation({
    args: {
        tripId: v.id("trips"),
        dayIndex: v.float64(),
        day: v.any(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip || !trip.itinerary) return null;

        const itinerary = trip.itinerary;
        const days = Array.isArray(itinerary.dayByDayItinerary)
            ? [...itinerary.dayByDayItinerary]
            : [];
        if (args.dayIndex < 0 || args.dayIndex >= days.length) return null;

        // Mark this day as enriched so we can detect completion.
        days[args.dayIndex] = { ...args.day, _enriched: true };

        const prev = trip.generationProgress ?? { phase: "enriching", daysReady: days.length, totalDays: days.length };
        const totalDays = prev.totalDays || days.length;
        const allDaysPresent = days.length >= totalDays;
        const allEnriched = allDaysPresent && days.every((d: any) => d && d._enriched);

        await ctx.db.patch(args.tripId, {
            itinerary: { ...itinerary, dayByDayItinerary: days },
            generationProgress: {
                phase: allEnriched ? "done" : "enriching",
                daysReady: days.length,
                totalDays,
            },
        });
        return null;
    },
});

/**
 * Finalize the base itinerary once the full stream is in: attach the
 * non-day-list parts of the result (flights, hotels, etc.) and the authoritative
 * final day list, flip status to "completed" so the trip is viewable, and move
 * into the "enriching" phase (or "done" if there's nothing to enrich).
 */
export const writeBaseItinerary = internalMutation({
    args: {
        tripId: v.id("trips"),
        itineraryExtras: v.any(), // { flights, hotels, activities, restaurants, transportation, estimatedDailyExpenses }
        days: v.array(v.any()),
        totalDays: v.float64(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;

        // Guardrail: stamp stable ids (for the editable/DnD UI) and drop any
        // venue that the model repeated across the trip before persisting.
        const withIds = assignActivityIds(args.days);
        const { days, removedCount } = dedupeVenues(withIds);
        if (removedCount > 0) {
            console.log(`writeBaseItinerary: deduped ${removedCount} repeated venue(s)`);
        }

        await ctx.db.patch(args.tripId, {
            itinerary: { ...args.itineraryExtras, dayByDayItinerary: days },
            status: "completed",
            generationProgress: {
                phase: days.length > 0 ? "enriching" : "done",
                daysReady: days.length,
                totalDays: args.totalDays || days.length,
            },
        });

        // Record this completed trip for SEO aggregation (powers the website's
        // /explore published itineraries). Best-effort: a failure here must never
        // break trip completion, so it's isolated in try/catch. Inlined rather
        // than calling publishedItineraries.upsertAggregation because a mutation
        // cannot invoke another mutation.
        try {
            const raw = (trip.destination || "").trim();
            const city = raw.split(",")[0].trim();
            const citySlug = city
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            if (citySlug) {
                const country = raw.includes(",")
                    ? raw.slice(raw.indexOf(",") + 1).trim()
                    : undefined;
                const durationDays = Math.max(
                    1,
                    Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24)),
                );
                const destinationKey = `${citySlug}-${durationDays}`;
                const existingAgg = await ctx.db
                    .query("tripAggregations")
                    .withIndex("by_destination_key", (q: any) =>
                        q.eq("destinationKey", destinationKey),
                    )
                    .unique();
                if (existingAgg) {
                    if (!existingAgg.tripIds.includes(args.tripId)) {
                        await ctx.db.patch(existingAgg._id, {
                            tripIds: [...existingAgg.tripIds, args.tripId],
                            count: existingAgg.tripIds.length + 1,
                            lastUpdated: Date.now(),
                        });
                    }
                } else {
                    await ctx.db.insert("tripAggregations", {
                        destinationKey,
                        destination: city,
                        country,
                        durationDays,
                        tripIds: [args.tripId],
                        count: 1,
                        lastUpdated: Date.now(),
                    });
                }
            }
        } catch (e) {
            console.error("writeBaseItinerary: failed to record trip aggregation", e);
        }
        return null;
    },
});

/**
 * Heartbeat: tiny no-op mutation called between major steps of the
 * generation action. Writing to Convex periodically prevents the
 * scheduler from incorrectly marking a long-running Node action as
 * dead and triggering spurious retries (the source of "Transient
 * error 0ms" log entries).
 */
export const heartbeatGeneration = internalMutation({
    args: { tripId: v.id("trips") },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        // No-op patch — touches the row without changing meaningful state.
        await ctx.db.patch(args.tripId, {});
        return null;
    },
});

/**
 * Watchdog: marks trips stuck in "generating" status as "failed".
 *
 * Scheduled trip generation actions can fail at the Convex platform level
 * (transient errors, cold-start failures) before our handler ever runs.
 * When that happens the trip stays in "generating" forever. This watchdog
 * sweeps any trip that has been "generating" for longer than the threshold
 * and marks it failed so the user sees a clear error state instead of an
 * infinite spinner.
 */
export const failStuckGeneratingTrips = internalMutation({
    args: {},
    returns: v.object({
        scanned: v.float64(),
        failed: v.float64(),
    }),
    handler: async (ctx: any) => {
        const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
        const cutoff = Date.now() - STUCK_THRESHOLD_MS;

        // Cheap early-exit: if no trips are currently "generating", skip all work.
        // This keeps the watchdog effectively free when the app is idle.
        const firstGenerating = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) => q.eq("status", "generating"))
            .first();

        if (!firstGenerating) {
            return { scanned: 0, failed: 0 };
        }

        // Second early-exit: if the oldest "generating" trip is younger than the
        // threshold, no trip can possibly be stuck yet — skip the full scan.
        if (firstGenerating._creationTime >= cutoff) {
            return { scanned: 0, failed: 0 };
        }

        const stuckTrips = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) => q.eq("status", "generating"))
            .collect();

        let failed = 0;
        for (const trip of stuckTrips) {
            // _creationTime approximates the start of generation: trips are
            // created with status="generating" and the action is scheduled
            // immediately afterwards.
            if (trip._creationTime < cutoff) {
                await ctx.db.patch(trip._id, {
                    status: "failed",
                    errorMessage:
                        "Trip generation timed out. Please try again.",
                });
                failed++;
            }
        }

        if (failed > 0) {
            console.warn(
                `🐕 Watchdog: marked ${failed}/${stuckTrips.length} stuck "generating" trips as failed`,
            );
        }

        return { scanned: stuckTrips.length, failed };
    },
});

/**
 * One-shot backfill: SerpApi returns `price` as the total fare for all
 * passengers, but until May 2026 we stored it as `pricePerPerson` without
 * dividing. This walks every trip and rewrites itinerary.flights.{options,
 * pricePerPerson,price,bestPrice} to the correct per-person value.
 *
 * Idempotent: marks trips with `itinerary.flights._perPersonNormalized=true`
 * after fixing and skips them on re-runs. Duffel-sourced flights are also
 * marked so they're never touched (Duffel always returned per-person).
 *
 * Run from the Convex dashboard:
 *   await ctx.runMutation(internal.trips.backfillFlightPricePerPerson, {})
 */
export const backfillFlightPricePerPerson = internalMutation({
    args: {},
    returns: v.object({
        scanned: v.float64(),
        updated: v.float64(),
        skipped: v.float64(),
    }),
    handler: async (ctx: any) => {
        const trips = await ctx.db.query("trips").collect();
        let updated = 0;
        let skipped = 0;
        for (const trip of trips) {
            const it = trip.itinerary;
            const flights = it && typeof it === "object" ? it.flights : undefined;
            if (!flights || typeof flights !== "object") {
                skipped++;
                continue;
            }
            if (flights._perPersonNormalized) {
                skipped++;
                continue;
            }
            const travelerCount = trip.travelerCount ?? trip.travelers ?? 1;
            const dataSource = flights.dataSource;
            // Duffel was already per-person. Just stamp the flag.
            if (dataSource === "duffel" || travelerCount <= 1) {
                await ctx.db.patch(trip._id, {
                    itinerary: {
                        ...it,
                        flights: { ...flights, _perPersonNormalized: true },
                    },
                });
                updated++;
                continue;
            }
            const fixedOptions = Array.isArray(flights.options)
                ? flights.options.map((opt: any) => {
                      if (!opt || typeof opt.pricePerPerson !== "number") return opt;
                      return {
                          ...opt,
                          pricePerPerson: Math.round(opt.pricePerPerson / travelerCount),
                      };
                  })
                : flights.options;
            const fixedBestPrice =
                typeof flights.bestPrice === "number"
                    ? Math.round(flights.bestPrice / travelerCount)
                    : flights.bestPrice;
            const fixedPricePerPerson =
                typeof flights.pricePerPerson === "number"
                    ? Math.round(flights.pricePerPerson / travelerCount)
                    : flights.pricePerPerson;
            const fixedPrice =
                typeof flights.price === "number" && flights.pricePerPerson == null
                    ? Math.round(flights.price / travelerCount)
                    : flights.price;
            await ctx.db.patch(trip._id, {
                itinerary: {
                    ...it,
                    flights: {
                        ...flights,
                        options: fixedOptions,
                        bestPrice: fixedBestPrice,
                        pricePerPerson: fixedPricePerPerson,
                        price: fixedPrice,
                        _perPersonNormalized: true,
                    },
                },
            });
            updated++;
        }
        return { scanned: trips.length, updated, skipped };
    },
});

export const list = authQuery({
    args: {
        token: v.string(),
    },
    returns: v.array(
        v.object({
            _id: v.id("trips"),
            _creationTime: v.float64(),
            userId: v.string(),
            destination: v.string(),
            origin: v.optional(v.string()),
            startDate: v.float64(),
            endDate: v.float64(),
            // V1: New fields
            budgetTotal: v.optional(v.float64()),
            travelerCount: v.optional(v.float64()),
            perPersonBudget: v.optional(v.float64()),
            // Legacy fields
            budget: v.optional(v.union(v.float64(), v.string())),
            travelers: v.optional(v.float64()),
            interests: v.array(v.string()),
            localExperiences: v.optional(v.array(v.string())),
            skipFlights: v.optional(v.boolean()),
            skipHotel: v.optional(v.boolean()),
            preferredFlightTime: v.optional(v.string()),
            arrivalTime: v.optional(v.string()),
            departureTime: v.optional(v.string()),
            selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
            status: v.string(),
            itinerary: v.optional(v.any()),
            itineraryItems: v.optional(v.any()),
            generationProgress: v.optional(v.object({
                phase: v.union(v.literal("planning"), v.literal("building"), v.literal("enriching"), v.literal("done")),
                daysReady: v.float64(),
                totalDays: v.float64(),
            })),
            isMultiCity: v.optional(v.boolean()),
            optimizedRoute: v.optional(v.any()),
            destinations: v.optional(v.any()),
            errorMessage: v.optional(v.string()),
            language: v.optional(v.string()),
            platform: v.optional(v.string()),
            destinationImage: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                attribution: v.string(),
            })),
            userAtDestination: v.optional(v.boolean()),
            lastLocationCheckAt: v.optional(v.float64()),
            locationVerified: v.optional(v.boolean()),
            locationVerifiedAt: v.optional(v.float64()),
            tripType: v.optional(v.string()),
            dealId: v.optional(v.id("lowFareRadar")),
            dealFlightData: v.optional(v.any()),
            tripCardId: v.optional(v.string()),
            shareCardPhoto: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                photographerUsername: v.optional(v.string()),
            })),
        })
    ),
    handler: async (ctx: any) => {
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .order("desc")
            .collect();
            // Compute perPersonBudget on the fly for older trips that don't have it
        return trips.map((trip: any) => {
            const budgetTotal = trip.budgetTotal ?? (typeof trip.budget === 'number' ? trip.budget : 2000);
            const travelerCount = trip.travelerCount ?? trip.travelers ?? 1;
            const perPersonBudget = trip.perPersonBudget ?? Math.round(budgetTotal / travelerCount);
            
            return {
                ...trip,
                budgetTotal,
                travelerCount,
                perPersonBudget,
            };
        });
    },
});

export const get = authQuery({
    args: { 
        token: v.string(),
        tripId: v.id("trips") 
    },
    returns: v.union(
        v.null(),
        v.object({
            _id: v.id("trips"),
            _creationTime: v.number(),
            userId: v.string(),
            destination: v.string(),
            origin: v.optional(v.string()),
            startDate: v.number(),
            endDate: v.number(),
            // V1: budget is now optional, prefer budgetTotal
            budget: v.optional(v.union(v.number(), v.string())),
            budgetTotal: v.optional(v.number()),
            // V1: travelers is now optional, prefer travelerCount
            travelers: v.optional(v.number()),
            travelerCount: v.optional(v.number()),
            perPersonBudget: v.optional(v.number()),
            interests: v.array(v.string()),
            skipFlights: v.optional(v.boolean()),
            skipHotel: v.optional(v.boolean()),
            preferredFlightTime: v.optional(v.string()),
            selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
            status: v.union(v.literal("pending"), v.literal("generating"), v.literal("completed"), v.literal("failed"), v.literal("archived")),
            itinerary: v.optional(v.any()),
            itineraryItems: v.optional(v.any()),
            // Live day-by-day generation progress (drives streaming UI). Kept in
            // the returns validator so clients receive `phase` while generating.
            generationProgress: v.optional(v.object({
                phase: v.union(v.literal("planning"), v.literal("building"), v.literal("enriching"), v.literal("done")),
                daysReady: v.number(),
                totalDays: v.number(),
            })),
            isMultiCity: v.optional(v.boolean()),
            destinations: v.optional(v.any()),
            optimizedRoute: v.optional(v.any()),
            errorMessage: v.optional(v.string()),
            hasBeenRegenerated: v.optional(v.boolean()),
            destinationImage: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                attribution: v.string(),
            })),
            localExperiences: v.optional(v.array(v.string())),
            arrivalTime: v.optional(v.string()),
            departureTime: v.optional(v.string()),
            language: v.optional(v.string()),
            platform: v.optional(v.string()),
            userAtDestination: v.optional(v.boolean()),
            lastLocationCheckAt: v.optional(v.number()),
            locationVerified: v.optional(v.boolean()),
            locationVerifiedAt: v.optional(v.number()),
            tripType: v.optional(v.string()),
            dealId: v.optional(v.id("lowFareRadar")),
            dealFlightData: v.optional(v.any()),
            tripCardId: v.optional(v.string()),
            shareCardPhoto: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                photographerUsername: v.optional(v.string()),
            })),
            // User plan info
            userPlan: v.optional(v.string()),
            hasFullAccess: v.optional(v.boolean()),
            isSubscriptionActive: v.optional(v.boolean()),
            tripCredits: v.optional(v.number()),
        })
    ),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;
     
        // Get user plan info
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .unique();

      // Check if user has full access (includes 16-day Apple billing grace period)
        const subscriptionStatus = isSubscriptionActiveWithGrace(
            userPlan?.plan,
            userPlan?.subscriptionExpiresAt,
        );
        const isSubscriptionActive = subscriptionStatus.active;
        
        const tripCredits = userPlan?.tripCredits ?? 0;
        const tripsGenerated = userPlan?.tripsGenerated ?? 0;
        
        // User has full access if:
        // 1. They have an active premium subscription, OR
        // 2. They have trip credits (paid for trips), OR
         // 3. They used their free trial (first trip)
        const hasFullAccess = isSubscriptionActive || tripCredits > 0 || tripsGenerated >= 1;

        return {
            ...trip,
            userPlan: userPlan?.plan ?? "free",
            hasFullAccess,
            isSubscriptionActive,
            tripCredits,
        };
    },
});

export const update = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        destination: v.optional(v.string()),
        origin: v.optional(v.string()),
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        budget: v.optional(v.union(v.number(), v.string())),
        travelers: v.optional(v.number()),
        interests: v.optional(v.array(v.string())),
        // New fields for edit parity with create-trip
        localExperiences: v.optional(v.array(v.string())),
        arrivalTime: v.optional(v.string()),
        departureTime: v.optional(v.string()),
        budgetTotal: v.optional(v.number()),
        travelerCount: v.optional(v.number()),
    },
    handler: async (ctx: any, args: any) => {
        const { tripId, token, ...updates } = args;
        // Remove undefined values
        const cleanUpdates: Record<string, any> = {};
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                cleanUpdates[key] = value;
            }
        }
        await ctx.db.patch(tripId, cleanUpdates);
    },
});

/** Remove an activity from a specific day in the itinerary */
export const removeActivity = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        activityIndex: v.number(),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");
        if (!trip.itinerary?.dayByDayItinerary) throw new Error("No itinerary");

        const days = [...trip.itinerary.dayByDayItinerary];
        if (args.dayIndex < 0 || args.dayIndex >= days.length) throw new Error("Invalid day");
        const day = { ...days[args.dayIndex] };
        const activities = [...day.activities];
        if (args.activityIndex < 0 || args.activityIndex >= activities.length) throw new Error("Invalid activity");

        activities.splice(args.activityIndex, 1);
        day.activities = activities;
        days[args.dayIndex] = day;

        await ctx.db.patch(args.tripId, {
            itinerary: { ...trip.itinerary, dayByDayItinerary: days },
        });
    },
});

/** Update a single activity's fields in the itinerary */
export const updateActivity = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        activityIndex: v.number(),
        updates: v.any(),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");
        if (!trip.itinerary?.dayByDayItinerary) throw new Error("No itinerary");

        const days = [...trip.itinerary.dayByDayItinerary];
        if (args.dayIndex < 0 || args.dayIndex >= days.length) throw new Error("Invalid day");
        const day = { ...days[args.dayIndex] };
        const activities = [...day.activities];
        if (args.activityIndex < 0 || args.activityIndex >= activities.length) throw new Error("Invalid activity");

        activities[args.activityIndex] = { ...activities[args.activityIndex], ...args.updates };
        day.activities = activities;

        // A time edit can reorder the day — re-sort by start time so the day
        // stays chronological. Then run the whole-trip de-dup guardrail in case
        // the edit collided a venue with another day.
        days[args.dayIndex] = resequenceDayTimes(day);
        const { days: dedupedDays } = dedupeVenues(days);

        await ctx.db.patch(args.tripId, {
            itinerary: { ...trip.itinerary, dayByDayItinerary: dedupedDays },
        });
    },
});

/** Schedule AI replacement of a single activity */
export const scheduleReplaceActivity = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        activityIndex: v.number(),
        language: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

        await (ctx as any).scheduler.runAfter(0, (internal as any).tripsActions.replaceActivity, {
            tripId: args.tripId,
            dayIndex: args.dayIndex,
            activityIndex: args.activityIndex,
            language: args.language,
        });
    },
});

// Clear travelFromPrevious on the first activity of a day (it has no predecessor
// to walk from). Returns a new day object; input is not mutated.
function clearFirstTravel(day: any): any {
    if (!day || !Array.isArray(day.activities) || day.activities.length === 0) return day;
    const activities = day.activities.map((a: any, i: number) =>
        i === 0 && a && a.travelFromPrevious ? { ...a, travelFromPrevious: null } : a
    );
    return { ...day, activities };
}

/**
 * Move an activity within a day or across days (drag-and-drop backend).
 * Splices the activity out of the source day and inserts it into the target
 * day at `toActivityIndex`. Covers both reorder-within-day and cross-day move.
 */
export const moveActivity = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        fromDayIndex: v.number(),
        fromActivityIndex: v.number(),
        toDayIndex: v.number(),
        toActivityIndex: v.number(),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");
        if (!trip.itinerary?.dayByDayItinerary) throw new Error("No itinerary");

        const days = [...trip.itinerary.dayByDayItinerary];
        if (args.fromDayIndex < 0 || args.fromDayIndex >= days.length) throw new Error("Invalid source day");
        if (args.toDayIndex < 0 || args.toDayIndex >= days.length) throw new Error("Invalid target day");

        const sameDay = args.fromDayIndex === args.toDayIndex;
        // Snapshot the source day's original (chronological) order BEFORE any
        // splice so a same-day reorder can keep the time column in place.
        const originalSourceActivities = [...(days[args.fromDayIndex].activities || [])];

        const fromDay = { ...days[args.fromDayIndex], activities: [...originalSourceActivities] };
        if (args.fromActivityIndex < 0 || args.fromActivityIndex >= fromDay.activities.length) {
            throw new Error("Invalid source activity");
        }

        // Pull the moved activity out of the source day.
        const [moved] = fromDay.activities.splice(args.fromActivityIndex, 1);
        days[args.fromDayIndex] = fromDay;

        // Insert into the target day (re-read after the source splice so a
        // same-day move sees the post-removal array). Clamp the insert index.
        const targetDay = { ...days[args.toDayIndex], activities: [...(days[args.toDayIndex].activities || [])] };
        const insertIndex = Math.max(0, Math.min(args.toActivityIndex, targetDay.activities.length));
        targetDay.activities.splice(insertIndex, 0, moved);
        days[args.toDayIndex] = targetDay;

        if (sameDay) {
            // Reorder within a day: times belong to POSITIONS, not activities —
            // keep the chronological slots fixed and let the activities move
            // between them (otherwise the time column runs backwards).
            const reordered = reassignTimeSlots(originalSourceActivities, days[args.toDayIndex].activities);
            days[args.toDayIndex] = { ...days[args.toDayIndex], activities: reordered };
        } else {
            // Cross-day move: the moved activity carries its old time into a new
            // day, so re-sort the target day by time to keep it chronological.
            days[args.toDayIndex] = resequenceDayTimes(days[args.toDayIndex]);
        }

        // The first activity of any touched day has no predecessor to walk from.
        days[args.fromDayIndex] = clearFirstTravel(days[args.fromDayIndex]);
        days[args.toDayIndex] = clearFirstTravel(days[args.toDayIndex]);

        const withIds = assignActivityIds(days);
        const { days: dedupedDays } = dedupeVenues(withIds);

        await ctx.db.patch(args.tripId, {
            itinerary: { ...trip.itinerary, dayByDayItinerary: dedupedDays },
        });
    },
});

/** Insert a user-provided (manual) activity into a day at a given index. */
export const addActivityManual = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        insertIndex: v.number(),
        activity: v.any(),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");
        if (!trip.itinerary?.dayByDayItinerary) throw new Error("No itinerary");

        const days = [...trip.itinerary.dayByDayItinerary];
        if (args.dayIndex < 0 || args.dayIndex >= days.length) throw new Error("Invalid day");

        const day = { ...days[args.dayIndex], activities: [...(days[args.dayIndex].activities || [])] };
        const insertIndex = Math.max(0, Math.min(args.insertIndex, day.activities.length));
        day.activities.splice(insertIndex, 0, args.activity);

        // Re-sort by time so a manually-timed activity lands in chronological order.
        days[args.dayIndex] = clearFirstTravel(resequenceDayTimes(day));

        const withIds = assignActivityIds(days);
        const { days: dedupedDays } = dedupeVenues(withIds);

        await ctx.db.patch(args.tripId, {
            itinerary: { ...trip.itinerary, dayByDayItinerary: dedupedDays },
        });
    },
});

/** Schedule AI generation of a new activity inserted into a day. */
export const scheduleAddActivityAI = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        insertIndex: v.number(),
        language: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

        await (ctx as any).scheduler.runAfter(0, (internal as any).tripsActions.addActivityAI, {
            tripId: args.tripId,
            dayIndex: args.dayIndex,
            insertIndex: args.insertIndex,
            language: args.language,
        });
    },
});

/** Schedule AI regeneration of a whole day (keeping the rest of the trip). */
export const scheduleRegenerateDay = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        dayIndex: v.number(),
        language: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");
        if (!trip.itinerary?.dayByDayItinerary) throw new Error("No itinerary");

        const days = trip.itinerary.dayByDayItinerary;
        if (args.dayIndex < 0 || args.dayIndex >= days.length) throw new Error("Invalid day");

        await (ctx as any).scheduler.runAfter(0, (internal as any).tripsActions.regenerateDayAction, {
            tripId: args.tripId,
            dayIndex: args.dayIndex,
            language: args.language,
        });
    },
});

// Update whether user is physically at the trip destination (used by location notifications)
export const updateLocationStatus = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        atDestination: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

        await ctx.db.patch(args.tripId, {
            userAtDestination: args.atDestination,
            lastLocationCheckAt: Date.now(),
        });
        return null;
    },
});

// Internal mutation to mark a trip as location-verified (called from verifyPresenceAtDestination action)
export const markLocationVerified = internalMutation({
    args: {
        tripId: v.id("trips"),
        userId: v.string(),
    },
    handler: async (ctx, args) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip || trip.userId !== args.userId) return;
        if (trip.locationVerified) return; // already verified

        await ctx.db.patch(args.tripId, {
            locationVerified: true,
            locationVerifiedAt: Date.now(),
            userAtDestination: true,
            lastLocationCheckAt: Date.now(),
        });

        // Re-evaluate achievements now that a trip is verified
        await ctx.scheduler.runAfter(0, internal.achievements.checkAndUnlock, {
            userId: args.userId,
        });
    },
});

// Server-side GPS verification: client sends raw coordinates, server geocodes destination
// and checks distance. This removes the client from the trust boundary for achievements.
const MAX_DESTINATION_RADIUS_M = 50_000; // 50 km
const VERIFICATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export const verifyPresenceAtDestination = authAction({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        latitude: v.float64(),
        longitude: v.float64(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;

        // Fetch the trip via internal query
        const trip = await ctx.runQuery(internal.trips.getTripForVerification, {
            tripId: args.tripId,
        });
        if (!trip || trip.userId !== userId) return null;

        // Already verified — nothing to do
        if (trip.locationVerified) return null;

        // Rate-limit: skip if checked recently
        if (trip.lastLocationCheckAt && Date.now() - trip.lastLocationCheckAt < VERIFICATION_COOLDOWN_MS) {
            return null;
        }

        // Trip must be within its date range (give 1-day buffer on each side for time zones)
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        if (now < trip.startDate - dayMs || now > trip.endDate + dayMs) {
            return null;
        }

        // Server-side geocode the destination via Nominatim
        const destinations = [];
        if (trip.destinations && Array.isArray(trip.destinations)) {
            for (const d of trip.destinations) {
                destinations.push(`${d.city}, ${d.country}`);
            }
        }
        if (destinations.length === 0 && trip.destination) {
            destinations.push(trip.destination);
        }

        // Check against ANY destination (multi-city: one match = verified)
        for (const dest of destinations) {
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(dest)}&limit=1`,
                    { headers: { "User-Agent": "PlaneraAI/1.0" } }
                );
                const data = await res.json();
                if (!data?.[0]) continue;

                const destLat = parseFloat(data[0].lat);
                const destLng = parseFloat(data[0].lon);
                const distance = getDistanceMeters(args.latitude, args.longitude, destLat, destLng);

                if (distance <= MAX_DESTINATION_RADIUS_M) {
                    // User is at destination — mark verified
                    await ctx.runMutation(internal.trips.markLocationVerified, {
                        tripId: args.tripId,
                        userId,
                    });
                    return null;
                }

                // Respect Nominatim rate limit (1 req/sec)
                await new Promise((r) => setTimeout(r, 1100));
            } catch {
                // Nominatim failure — don't block, just skip this destination
                continue;
            }
        }

        return null;
    },
});

// Internal query used by verifyPresenceAtDestination action to read trip data
export const getTripForVerification = internalQuery({
    args: { tripId: v.id("trips") },
    handler: async (ctx, args) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;
        return {
            userId: trip.userId,
            destination: trip.destination,
            destinations: trip.destinations,
            startDate: trip.startDate,
            endDate: trip.endDate,
            locationVerified: trip.locationVerified,
            lastLocationCheckAt: trip.lastLocationCheckAt,
        };
    },
});

export const regenerate = authMutation({
    args: { 
        token: v.string(),
        tripId: v.id("trips") 
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");

        await ctx.db.patch(args.tripId, { status: "generating" });

        // Use the newer field names with fallbacks for backward compatibility
        const travelerCount = trip.travelerCount ?? trip.travelers ?? 1;
        const budget = trip.budgetTotal ?? trip.budget ?? "moderate";
        const origin = trip.origin || "Not specified";
        
        // Build arrival/departure info string
        // NOTE: Detailed time-aware constraints (3h buffer, activity restrictions) are handled in tripsActions.ts generateTimeAwareGuidance()
        let arrivalDepartureInfo = "";
        if (trip.arrivalTime) {
            const arrivalDate = new Date(trip.arrivalTime);
            const arrivalHours = String(arrivalDate.getUTCHours()).padStart(2, '0');
            const arrivalMins = String(arrivalDate.getUTCMinutes()).padStart(2, '0');
            arrivalDepartureInfo += ` Airport arrival: ${arrivalHours}:${arrivalMins}. Detailed arrival constraints provided separately.`;
        }
        if (trip.departureTime) {
            const departureDate = new Date(trip.departureTime);
            const depHours = String(departureDate.getUTCHours()).padStart(2, '0');
            const depMins = String(departureDate.getUTCMinutes()).padStart(2, '0');
            arrivalDepartureInfo += ` Departure: ${depHours}:${depMins}. Detailed departure constraints provided separately.`;
        }
        
        // Build local experiences info
        let localExperiencesInfo = "";
        if (trip.localExperiences && trip.localExperiences.length > 0) {
            localExperiencesInfo = ` Local experiences wanted: ${trip.localExperiences.join(", ")}.`;
        }

        const prompt = `Plan a trip to ${trip.destination} from ${origin} for ${travelerCount} people.
        Budget: €${budget}.
        Dates: ${new Date(trip.startDate).toDateString()} to ${new Date(trip.endDate).toDateString()}.${arrivalDepartureInfo}
        Interests: ${trip.interests.join(", ")}.${localExperiencesInfo}`;

        await ctx.scheduler.runAfter(0, internal.tripsActions.generate, { 
            tripId: args.tripId, 
            prompt,
            arrivalTime: trip.arrivalTime,
            departureTime: trip.departureTime,
            language: trip.language || "en",
        });
    },
});

export const deleteTrip = authMutation({
    args: { 
        token: v.string(),
        tripId: v.id("trips") 
    },
    handler: async (ctx: any, args: any) => {
        await ctx.db.delete(args.tripId);

    },
});

export const getTrendingDestinations = query({
    args: {},
    returns: v.array(v.object({
        destination: v.string(),
        count: v.float64(),
        avgBudget: v.float64(),
        // Curated average daily spend per person for the destination (see
        // destinationSpend.ts). Null when we have no figure for it.
        avgTripSpend: v.union(v.number(), v.null()),
        spendCurrency: v.string(),
        spendLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
        spendSource: v.union(v.literal("unwto"), v.literal("estimate"), v.null()),
        interests: v.array(v.string()),
    })),
    handler: async (ctx: any) => {
        // Only read completed trips from the last 30 days. _creationTime is the
        // implicit final column of every index, so we can range on it here and
        // avoid reading the entire (large) completed-trips history.
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentTrips = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) =>
                q.eq("status", "completed").gte("_creationTime", thirtyDaysAgo),
            )
            .collect();

        // If no recent trips, return empty array
        if (recentTrips.length === 0) {
            return [];
        }

        // Group by destination and aggregate data
        const destinationMap: Record<string, {
            count: number;
            budgets: number[];
            allInterests: string[];
        }> = {};

        recentTrips.forEach((trip: any) => {
            if (!destinationMap[trip.destination]) {
                destinationMap[trip.destination] = {
                    count: 0,
                    budgets: [],
                    allInterests: [],
                };
            }

            destinationMap[trip.destination].count += 1;

             // Get budget value - prefer budgetTotal, then budget
            const budgetValue = trip.budgetTotal ?? trip.budget;
            const budgetNum = typeof budgetValue === "string"
                ? parseFloat(budgetValue)
                : budgetValue;
            if (budgetNum !== undefined && !isNaN(budgetNum)) {
                destinationMap[trip.destination].budgets.push(budgetNum);
            }

            // Collect interests
            destinationMap[trip.destination].allInterests.push(...trip.interests);
        });

        // Convert to array and sort by count
        const trending = Object.entries(destinationMap)
            .map(([destination, data]) => {
                const s = resolveSpendStay(destination);
                // Trending Now only surfaces REAL UN Tourism (UNWTO) figures — never
                // the curated internal estimates. Drop the spend for anything that
                // didn't resolve to UNWTO so the card hides the price entirely.
                const isUnwto = s.spendSource === "unwto";
                return {
                    destination,
                    count: data.count,
                    avgBudget: data.budgets.length > 0
                        ? data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length
                        : 0,
                    avgTripSpend: isUnwto ? s.avgTripSpend : null,
                    spendCurrency: s.spendCurrency,
                    spendLevel: isUnwto ? s.spendLevel : null,
                    spendSource: isUnwto ? s.spendSource : null,
                    interests: [...new Set(data.allInterests)].slice(0, 3), // Top 3 unique interests
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5); // Return top 5

        return trending;
    },
});

/**
 * Curated facts for a single destination (avg daily spend + typical stay
 * length), resolved from the static datasets in destinationSpend.ts. Used by
 * the destination preview screen. Fields are null when we have no figure.
 */
export const getDestinationFacts = query({
    args: { destination: v.string() },
    returns: v.object({
        avgTripSpend: v.union(v.number(), v.null()),
        spendCurrency: v.string(),
        spendLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
        spendSource: v.union(v.literal("unwto"), v.literal("estimate"), v.null()),
        avgStayDays: v.union(v.number(), v.null()),
        stayLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
    }),
    handler: async (ctx: any, args: any) => {
        const s = resolveSpendStay(args.destination);
        return {
            avgTripSpend: s.avgTripSpend,
            spendCurrency: s.spendCurrency,
            spendLevel: s.spendLevel,
            spendSource: s.spendSource,
            avgStayDays: s.avgStayDays,
            stayLevel: s.stayLevel,
        };
    },
});

export const getAllDestinations = query({
    args: {},
    returns: v.array(v.object({
        destination: v.string(),
        count: v.float64(),
        avgBudget: v.float64(),
        avgTripSpend: v.union(v.number(), v.null()),
        spendCurrency: v.string(),
        spendLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
        spendSource: v.union(v.literal("unwto"), v.literal("estimate"), v.null()),
        interests: v.array(v.string()),
    })),
    handler: async (ctx: any) => {
        // Get completed trips only
        const completedTrips = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) => q.eq("status", "completed"))
            .collect();

        // If no trips, return empty array
        if (completedTrips.length === 0) {
            return [];
        }

        // Helper function to normalize destination names
        // Extracts city name and formats it properly
        const normalizeDestination = (dest: string): string => {
            // Remove extra whitespace and trim
            let normalized = dest.trim();
            
            // Extract city name (before comma if present)
            if (normalized.includes(",")) {
                normalized = normalized.split(",")[0].trim();
            }
            
            // Capitalize first letter of each word
            normalized = normalized
                .toLowerCase()
                .split(" ")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");
            
            return normalized;
        };

        // Group by normalized destination and aggregate data
        const destinationMap: Record<string, {
            displayName: string;
            count: number;
            budgets: number[];
            allInterests: string[];
        }> = {};

        completedTrips.forEach((trip: any) => {
            const normalizedDest = normalizeDestination(trip.destination);

            if (!destinationMap[normalizedDest]) {
                destinationMap[normalizedDest] = {
                    displayName: normalizedDest,
                    count: 0,
                    budgets: [],
                    allInterests: [],
                };
            }

            destinationMap[normalizedDest].count += 1;

        // Get budget value - prefer budgetTotal, then budget
            const budgetValue = trip.budgetTotal ?? trip.budget;
            const budgetNum = typeof budgetValue === "string"
                ? parseFloat(budgetValue)
                : budgetValue;
            if (budgetNum !== undefined && !isNaN(budgetNum)) {
                destinationMap[normalizedDest].budgets.push(budgetNum);
            }

            // Collect interests
            destinationMap[normalizedDest].allInterests.push(...trip.interests);
        });

        // Convert to array and sort by count (most popular first)
        // Note: display names here are city-only (country stripped), so UNWTO
        // (country-keyed) rarely matches — most resolve to curated estimates.
        const allDestinations = Object.values(destinationMap)
            .map((data) => {
                const s = resolveSpendStay(data.displayName);
                return {
                    destination: data.displayName,
                    count: data.count,
                    avgBudget: data.budgets.length > 0
                        ? data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length
                        : 0,
                    avgTripSpend: s.avgTripSpend,
                    spendCurrency: s.spendCurrency,
                    spendLevel: s.spendLevel,
                    spendSource: s.spendSource,
                    interests: [...new Set(data.allInterests)].slice(0, 3),
                };
            })
            .sort((a, b) => b.count - a.count);

        return allDestinations;
    },
});
