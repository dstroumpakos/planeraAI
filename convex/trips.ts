import { v } from "convex/values";
import { authMutation, authQuery } from "./functions";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { isSubscriptionActiveWithGrace } from "./helpers/subscription";

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
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
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
                userId: ctx.user._id,
                plan: "free",
                tripsGenerated: 1,
                tripCredits: 0, // They used their 1 free credit
            });
        }

        const tripId = await ctx.db.insert("trips", {
            userId: ctx.user._id,
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
        let arrivalDepartureInfo = "";
        if (args.arrivalTime) {
            const arrivalDate = new Date(args.arrivalTime);
            const arrivalTimeStr = arrivalDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            arrivalDepartureInfo += `\nArrival time at destination: ${arrivalTimeStr} local time on ${arrivalDate.toDateString()}.`;
            arrivalDepartureInfo += " The first day's itinerary should start AFTER arrival - schedule light activities appropriate for the remaining time.";
        }
        if (args.departureTime) {
            const departureDate = new Date(args.departureTime);
            const departureHour = departureDate.getHours();
            const departureTimeStr = departureDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            arrivalDepartureInfo += `\nDeparture time from destination: ${departureTimeStr} local time on ${departureDate.toDateString()}.`;
            
            // Handle early morning departure edge case
            if (departureHour >= 4 && departureHour <= 6) {
                arrivalDepartureInfo += " IMPORTANT: This is an early morning departure - do NOT schedule any activities on the departure day. The previous day should end earlier (around 20:00-21:00) to allow time for rest and packing.";
            } else {
                arrivalDepartureInfo += " The last day's itinerary should end approximately 3 hours before departure to allow time for airport transfer and check-in.";
            }
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
        });

        return tripId;
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
            selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
            status: v.string(),
            itinerary: v.optional(v.any()),
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
            skipFlights: v.optional(v.boolean()),
            skipHotel: v.optional(v.boolean()),
            preferredFlightTime: v.optional(v.string()),
            selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
            status: v.string(),
            itinerary: v.optional(v.any()),
            isMultiCity: v.optional(v.boolean()),
            optimizedRoute: v.optional(v.any()),
            destinations: v.optional(v.any()),
        })
    ),
    handler: async (ctx: any) => {
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
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
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user._id))
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
        let arrivalDepartureInfo = "";
        if (trip.arrivalTime) {
            const arrivalDate = new Date(trip.arrivalTime);
            arrivalDepartureInfo += ` Arrival time at destination: ${arrivalDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}.`;
        }
        if (trip.departureTime) {
            const departureDate = new Date(trip.departureTime);
            arrivalDepartureInfo += ` Departure time: ${departureDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}.`;
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
        avgRating: v.float64(),
        interests: v.array(v.string()),
    })),
    handler: async (ctx: any) => {
        // Get completed trips only (using status index)
        const completedTrips = await ctx.db
            .query("trips")
            .withIndex("by_status", (q: any) => q.eq("status", "completed"))
            .collect();

        // Filter for trips from the last 30 days
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentTrips = completedTrips.filter((trip: any) => 
            trip._creationTime >= thirtyDaysAgo
        );

        // If no recent trips, return empty array
        if (recentTrips.length === 0) {
            return [];
        }

        // Group by destination and aggregate data
        const destinationMap: Record<string, {
            count: number;
            budgets: number[];
            allInterests: string[];
            ratings: number[];
        }> = {};

        recentTrips.forEach((trip: any) => {
            if (!destinationMap[trip.destination]) {
                destinationMap[trip.destination] = {
                    count: 0,
                    budgets: [],
                    allInterests: [],
                    ratings: [],
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
            
            // Add a default rating (you can enhance this later with actual ratings)
            destinationMap[trip.destination].ratings.push(4.5 + Math.random() * 0.5);
        });

        // Convert to array and sort by count
        const trending = Object.entries(destinationMap)
            .map(([destination, data]) => ({
                destination,
                count: data.count,
                avgBudget: data.budgets.length > 0 
                    ? data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length 
                    : 0,
                avgRating: data.ratings.length > 0
                    ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
                    : 4.5,
                interests: [...new Set(data.allInterests)].slice(0, 3), // Top 3 unique interests
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5); // Return top 5

        return trending;
    },
});

export const getAllDestinations = query({
    args: {},
    returns: v.array(v.object({
        destination: v.string(),
        count: v.float64(),
        avgBudget: v.float64(),
        avgRating: v.float64(),
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
            ratings: number[];
        }> = {};

        completedTrips.forEach((trip: any) => {
            const normalizedDest = normalizeDestination(trip.destination);
            
            if (!destinationMap[normalizedDest]) {
                destinationMap[normalizedDest] = {
                    displayName: normalizedDest,
                    count: 0,
                    budgets: [],
                    allInterests: [],
                    ratings: [],
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
            
            // Add a default rating
            destinationMap[normalizedDest].ratings.push(4.5 + Math.random() * 0.5);
        });

        // Convert to array and sort by count (most popular first)
        const allDestinations = Object.values(destinationMap)
            .map((data) => ({
                destination: data.displayName,
                count: data.count,
                avgBudget: data.budgets.length > 0 
                    ? data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length 
                    : 0,
                avgRating: data.ratings.length > 0
                    ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
                    : 4.5,
                interests: [...new Set(data.allInterests)].slice(0, 3),
            }))
            .sort((a, b) => b.count - a.count);

        return allDestinations;
    },
});
