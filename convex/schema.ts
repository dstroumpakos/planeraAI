import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    trips: defineTable({
        userId: v.string(),
        destination: v.string(),
        origin: v.optional(v.string()),
        startDate: v.float64(),
        endDate: v.float64(),
        budget: v.union(v.float64(), v.string()),
        travelers: v.float64(),
        interests: v.array(v.string()),
        skipFlights: v.optional(v.boolean()),
        skipHotel: v.optional(v.boolean()),
        preferredFlightTime: v.optional(v.string()),
        // Selected traveler profiles for flight booking
        selectedTravelerIds: v.optional(v.array(v.id("travelers"))),
        status: v.union(
            v.literal("pending"),
            v.literal("generating"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("archived")
        ),
        // Image fields
        destinationImage: v.optional(v.object({
            url: v.string(),
            photographer: v.string(),
            attribution: v.string(),
        })),
        // Backward compatibility: keep raw itinerary
        itinerary: v.optional(v.any()),
        // New structured itinerary items (optional, for future use)
        itineraryItems: v.optional(v.array(v.object({
            day: v.float64(),
            type: v.union(
                v.literal("flight"),
                v.literal("hotel"),
                v.literal("activity"),
                v.literal("restaurant"),
                v.literal("transport")
            ),
            title: v.string(),
            description: v.optional(v.string()),
            startTime: v.optional(v.float64()),
            endTime: v.optional(v.float64()),
            location: v.optional(v.string()),
            price: v.optional(v.float64()),
            currency: v.optional(v.string()),
            bookingUrl: v.optional(v.string()),
            image: v.optional(v.object({
                url: v.string(),
                photographer: v.string(),
                attribution: v.string(),
            })),
            metadata: v.optional(v.any()),
        }))),
        isMultiCity: v.optional(v.boolean()),
        destinations: v.optional(v.array(v.object({
            city: v.string(),
            country: v.string(),
            days: v.float64(),
            order: v.float64(),
        }))),
        optimizedRoute: v.optional(v.any()),
        errorMessage: v.optional(v.string()),
    })
        .index("by_user", ["userId"])
        .index("by_status", ["status"]),

    userPlans: defineTable({
        userId: v.string(),
        plan: v.union(v.literal("free"), v.literal("premium")),
        tripsGenerated: v.float64(),
        tripCredits: v.optional(v.float64()),
        subscriptionExpiresAt: v.optional(v.float64()),
        subscriptionType: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
    }).index("by_user", ["userId"]),

    bookings: defineTable({
        userId: v.string(),
        tripId: v.id("trips"),
        type: v.string(),
        item: v.string(),
        url: v.string(),
        status: v.string(),
        clickedAt: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_trip", ["tripId"]),

    userSettings: defineTable({
        userId: v.string(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        dateOfBirth: v.optional(v.string()),
        profilePicture: v.optional(v.id("_storage")),
        darkMode: v.optional(v.boolean()),
        homeAirport: v.optional(v.string()),
        defaultTravelers: v.optional(v.float64()),
        defaultInterests: v.optional(v.array(v.string())),
        defaultSkipFlights: v.optional(v.boolean()),
        defaultSkipHotel: v.optional(v.boolean()),
        defaultPreferredFlightTime: v.optional(v.string()),
        preferredAirlines: v.optional(v.array(v.string())),
        seatPreference: v.optional(v.string()),
        mealPreference: v.optional(v.string()),
        hotelStarRating: v.optional(v.float64()),
        budgetRange: v.optional(v.string()),
        travelStyle: v.optional(v.string()),
        language: v.optional(v.string()),
        currency: v.optional(v.string()),
        pushNotifications: v.optional(v.boolean()),
        emailNotifications: v.optional(v.boolean()),
        dealAlerts: v.optional(v.boolean()),
        tripReminders: v.optional(v.boolean()),
        onboardingCompleted: v.optional(v.boolean()),
    }).index("by_user", ["userId"]),

    insights: defineTable({
        userId: v.string(),
        destination: v.optional(v.string()),
        destinationId: v.optional(v.string()),
        tripId: v.optional(v.id("trips")),
        content: v.string(),
        category: v.union(
            v.literal("food"),
            v.literal("transport"),
            v.literal("neighborhoods"),
            v.literal("timing"),
            v.literal("hidden_gem"),
            v.literal("avoid"),
            v.literal("other")
        ),
        verified: v.boolean(),
        likes: v.float64(),
        moderationStatus: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("flagged")
        )),
        image: v.optional(v.object({
            url: v.string(),
            photographer: v.optional(v.string()),
            attribution: v.optional(v.string()),
        })),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_destination", ["destinationId"])
        .index("by_user", ["userId"])
        .index("by_moderation_status", ["moderationStatus"]),

    dismissedTrips: defineTable({
        userId: v.string(),
        tripId: v.id("trips"),
        dismissedAt: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_user_and_trip", ["userId", "tripId"]),

    // New: Image cache table for storing Unsplash images
    imageCache: defineTable({
        query: v.string(),
        type: v.union(
            v.literal("destination"),
            v.literal("activity"),
            v.literal("restaurant"),
            v.literal("cuisine")
        ),
        url: v.string(),
        photographer: v.string(),
        attribution: v.string(),
        unsplashId: v.string(),
        cachedAt: v.float64(),
    })
        .index("by_query_and_type", ["query", "type"]),

    events: defineTable({
        userId: v.string(),
        eventType: v.union(
            v.literal("generate_trip"),
            v.literal("save_trip"),
            v.literal("click_booking"),
            v.literal("share_insight"),
            v.literal("view_trip"),
            v.literal("subscribe")
        ),
        tripId: v.optional(v.id("trips")),
        metadata: v.optional(v.object({
            destination: v.optional(v.string()),
            bookingType: v.optional(v.string()),
            bookingUrl: v.optional(v.string()),
            duration: v.optional(v.float64()),
            success: v.optional(v.boolean()),
            errorMessage: v.optional(v.string()),
        })),
        timestamp: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_event_type", ["eventType"])
        .index("by_user_and_type", ["userId", "eventType"]),

    // Flight bookings table for storing completed Duffel orders
    flightBookings: defineTable({
        userId: v.string(),
        tripId: v.id("trips"),
        // Duffel order details
        duffelOrderId: v.string(),
        bookingReference: v.optional(v.string()),
        // Payment details
        paymentIntentId: v.optional(v.string()),
        totalAmount: v.float64(),
        currency: v.string(),
        // Base price before extras
        basePriceCents: v.optional(v.int64()),
        // Extras total
        extrasTotalCents: v.optional(v.int64()),
        // Flight details snapshot
        outboundFlight: v.object({
            airline: v.string(),
            airlineLogo: v.optional(v.string()),
            flightNumber: v.string(),
            departure: v.string(),
            arrival: v.string(),
            departureDate: v.string(),
            departureAirport: v.optional(v.string()),
            arrivalAirport: v.optional(v.string()),
            origin: v.string(),
            destination: v.string(),
            duration: v.optional(v.string()),
            cabinClass: v.optional(v.string()),
            aircraft: v.optional(v.string()),
        }),
        returnFlight: v.optional(v.object({
            airline: v.string(),
            airlineLogo: v.optional(v.string()),
            flightNumber: v.string(),
            departure: v.string(),
            arrival: v.string(),
            departureDate: v.string(),
            departureAirport: v.optional(v.string()),
            arrivalAirport: v.optional(v.string()),
            origin: v.string(),
            destination: v.string(),
            duration: v.optional(v.string()),
            cabinClass: v.optional(v.string()),
            aircraft: v.optional(v.string()),
        })),
        // Passengers with full details
        passengers: v.array(v.object({
            givenName: v.string(),
            familyName: v.string(),
            email: v.string(),
            type: v.optional(v.union(v.literal("adult"), v.literal("child"), v.literal("infant"))),
            dateOfBirth: v.optional(v.string()),
        })),
        // Cancellation & Change policies (from Duffel conditions)
        policies: v.optional(v.object({
            canChange: v.boolean(),
            canRefund: v.boolean(),
            changePolicy: v.string(),
            refundPolicy: v.string(),
            changePenaltyAmount: v.optional(v.string()),
            changePenaltyCurrency: v.optional(v.string()),
            refundPenaltyAmount: v.optional(v.string()),
            refundPenaltyCurrency: v.optional(v.string()),
        })),
        // Included baggage (what comes with the ticket)
        includedBaggage: v.optional(v.array(v.object({
            passengerId: v.string(),
            passengerName: v.optional(v.string()),
            cabinBags: v.optional(v.int64()),
            checkedBags: v.optional(v.int64()),
            checkedBagWeight: v.optional(v.object({
                amount: v.float64(),
                unit: v.string(),
            })),
        }))),
        // Paid extra baggage
        paidBaggage: v.optional(v.array(v.object({
            passengerId: v.string(),
            passengerName: v.optional(v.string()),
            type: v.string(), // "checked" or "carry_on"
            quantity: v.int64(),
            priceCents: v.int64(),
            currency: v.string(),
            weight: v.optional(v.object({
                amount: v.float64(),
                unit: v.string(),
            })),
        }))),
        // Seat selections
        seatSelections: v.optional(v.array(v.object({
            passengerId: v.string(),
            passengerName: v.optional(v.string()),
            segmentId: v.string(),
            flightNumber: v.optional(v.string()),
            seatDesignator: v.string(),
            priceCents: v.int64(),
            currency: v.string(),
        }))),
        // Status
        status: v.union(
            v.literal("pending_payment"),
            v.literal("confirmed"),
            v.literal("cancelled"),
            v.literal("failed")
        ),
        // Timestamps
        createdAt: v.float64(),
        confirmedAt: v.optional(v.float64()),
        // For tracking if flight has departed
        departureTimestamp: v.optional(v.float64()),
        // Email confirmation tracking (for idempotency)
        confirmationEmailSentAt: v.optional(v.float64()),
    })
        .index("by_user", ["userId"])
        .index("by_trip", ["tripId"])
        .index("by_duffel_order", ["duffelOrderId"]),

    // Flight booking drafts - stores in-progress booking selections before payment
    flightBookingDrafts: defineTable({
        userId: v.string(),
        tripId: v.id("trips"),
        // Selected offer
        offerId: v.string(),
        offerExpiresAt: v.optional(v.string()),
        // Pricing
        basePriceCents: v.int64(), // Base price in cents
        currency: v.string(),
        // Passengers with their details
        passengers: v.array(v.object({
            passengerId: v.string(), // Duffel passenger ID from offer
            travelerId: v.optional(v.id("travelers")), // Link to our traveler profile
            type: v.union(v.literal("adult"), v.literal("child"), v.literal("infant")),
            givenName: v.string(),
            familyName: v.string(),
            dateOfBirth: v.string(), // YYYY-MM-DD
            gender: v.union(v.literal("male"), v.literal("female")),
            title: v.union(
                v.literal("mr"),
                v.literal("ms"),
                v.literal("mrs"),
                v.literal("miss"),
                v.literal("dr")
            ),
            email: v.optional(v.string()),
            phoneCountryCode: v.optional(v.string()),
            phoneNumber: v.optional(v.string()),
            passportNumber: v.optional(v.string()),
            passportIssuingCountry: v.optional(v.string()),
            passportExpiryDate: v.optional(v.string()),
        })),
        // Baggage selections (per passenger, per segment)
        selectedBags: v.optional(v.array(v.object({
            passengerId: v.string(),
            segmentId: v.string(),
            serviceId: v.string(), // Duffel service ID
            quantity: v.int64(),
            priceCents: v.int64(),
            currency: v.string(),
            type: v.string(), // "checked", "carry_on"
            weight: v.optional(v.object({
                amount: v.float64(),
                unit: v.string(),
            })),
        }))),
        // Seat selections (per passenger, per segment)
        selectedSeats: v.optional(v.array(v.object({
            passengerId: v.string(),
            segmentId: v.string(),
            serviceId: v.string(), // Duffel service ID
            seatDesignator: v.string(), // e.g., "12A"
            priceCents: v.int64(),
            currency: v.string(),
        }))),
        // Policy acknowledgment
        policyAcknowledged: v.boolean(),
        policyAcknowledgedAt: v.optional(v.float64()),
        // Offer conditions (cached from Duffel)
        conditions: v.optional(v.object({
            changeBeforeDeparture: v.optional(v.object({
                allowed: v.boolean(),
                penaltyAmount: v.optional(v.string()),
                penaltyCurrency: v.optional(v.string()),
            })),
            refundBeforeDeparture: v.optional(v.object({
                allowed: v.boolean(),
                penaltyAmount: v.optional(v.string()),
                penaltyCurrency: v.optional(v.string()),
            })),
        })),
        // Baggage info (cached from Duffel)
        includedBaggage: v.optional(v.array(v.object({
            segmentId: v.string(),
            passengerId: v.string(),
            cabin: v.optional(v.object({
                quantity: v.int64(),
                type: v.optional(v.string()),
            })),
            checked: v.optional(v.object({
                quantity: v.int64(),
                weight: v.optional(v.object({
                    amount: v.float64(),
                    unit: v.string(),
                })),
            })),
        }))),
        // Available services (bags, seats) - cached from Duffel
        availableServices: v.optional(v.object({
            bags: v.optional(v.array(v.object({
                id: v.string(),
                passengerId: v.string(),
                segmentIds: v.array(v.string()),
                type: v.string(),
                maxQuantity: v.int64(),
                priceCents: v.int64(),
                currency: v.string(),
                weight: v.optional(v.object({
                    amount: v.float64(),
                    unit: v.string(),
                })),
            }))),
            seatsAvailable: v.boolean(),
        })),
        // Pricing breakdown
        extrasTotalCents: v.optional(v.int64()),
        totalPriceCents: v.int64(),
        // Status
        status: v.union(
            v.literal("draft"),
            v.literal("extras_selected"),
            v.literal("ready_for_payment"),
            v.literal("completed"),
            v.literal("expired")
        ),
        // Timestamps
        createdAt: v.float64(),
        updatedAt: v.float64(),
        expiresAt: v.optional(v.float64()),
    })
        .index("by_user", ["userId"])
        .index("by_trip", ["tripId"])
        .index("by_offer", ["offerId"])
        .index("by_status", ["status"]),

    // Traveler profiles for flight bookings
    travelers: defineTable({
        userId: v.string(),
        // Personal info (all required for booking)
        firstName: v.string(),
        lastName: v.string(),
        dateOfBirth: v.string(), // YYYY-MM-DD format
        gender: v.union(v.literal("male"), v.literal("female")),
        // Passport info (required for international flights)
        passportNumber: v.string(),
        passportIssuingCountry: v.string(), // ISO 3166-1 alpha-2 country code
        passportExpiryDate: v.string(), // YYYY-MM-DD format
        // Contact info (optional, can be filled at booking time)
        email: v.optional(v.string()),
        phoneCountryCode: v.optional(v.string()), // e.g. "+1", "+44"
        phoneNumber: v.optional(v.string()),
        // Metadata
        isDefault: v.optional(v.boolean()), // Primary traveler
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_user", ["userId"]),

    users: defineTable({
      email: v.string(),
      name: v.optional(v.string()),
      pictureUrl: v.optional(v.string()),
      // Travel preferences
      homeAirport: v.optional(v.string()),
      defaultBudget: v.optional(v.number()), // Deprecated, but keeping for schema compatibility if needed
      defaultTravelers: v.optional(v.number()),
      interests: v.optional(v.array(v.string())),
      flightTimePreference: v.optional(v.string()),
      skipFlights: v.optional(v.boolean()),
      skipHotels: v.optional(v.boolean()),
      // App settings
      pushNotifications: v.optional(v.boolean()),
      emailNotifications: v.optional(v.boolean()),
      currency: v.optional(v.string()),
      language: v.optional(v.string()),
      theme: v.optional(v.string()), // "light", "dark", "system"
      onboardingCompleted: v.optional(v.boolean()),
    }).index("by_email", ["email"]),

    // Booking links for secure external access
    bookingLinks: defineTable({
        token: v.string(),
        bookingId: v.id("flightBookings"),
        expiresAt: v.float64(), // Timestamp when link expires
        createdAt: v.float64(),
    })
        .index("by_token", ["token"]),
});
