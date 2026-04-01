import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    trips: defineTable({
        userId: v.string(),
        destination: v.string(),
        origin: v.optional(v.string()),
        startDate: v.float64(),
        endDate: v.float64(),
         // V1: budgetTotal is the primary budget field (numeric, total for all travelers)
        budgetTotal: v.optional(v.float64()),
        // V1: travelerCount is the primary traveler count field
        travelerCount: v.optional(v.float64()),
        // V1: computed field: budgetTotal / travelerCount
        perPersonBudget: v.optional(v.float64()),
        // Legacy fields (kept for backward compatibility)
        budget: v.optional(v.union(v.float64(), v.string())),
        travelers: v.optional(v.float64()),
        interests: v.array(v.string()),
        // Local Experiences for authentic local recommendations
        localExperiences: v.optional(v.array(v.string())),
        skipFlights: v.optional(v.boolean()),
        skipHotel: v.optional(v.boolean()),
        preferredFlightTime: v.optional(v.string()),
        // Arrival/Departure times for time-aware itineraries (ISO datetime strings in destination timezone)
        // When provided, affects itinerary generation:
        // - First day starts from arrival time (not morning)
        // - Last day ends ~3 hours before departure
        // - Early morning departures (04:00-06:00) skip activities on that day
        arrivalTime: v.optional(v.string()), // ISO datetime string, e.g., "2024-01-15T15:30:00"
        departureTime: v.optional(v.string()), // ISO datetime string, e.g., "2024-01-22T18:00:00"
        // Selected traveler profiles for flight booking (disabled in V1)
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
        // Language preference for AI-generated content (e.g., "en", "el", "es", "fr", "de", "ar")
        language: v.optional(v.string()),
        // Location-based: tracks whether user is physically at the destination
        userAtDestination: v.optional(v.boolean()),
        lastLocationCheckAt: v.optional(v.float64()),
        // Server-verified GPS proximity to destination (used for achievement eligibility)
        locationVerified: v.optional(v.boolean()),
        locationVerifiedAt: v.optional(v.float64()),
        // Deal-based trip fields (from Low Fare Radar)
        tripType: v.optional(v.union(v.literal("standard"), v.literal("deal"))),
        dealId: v.optional(v.id("lowFareRadar")),
        dealFlightData: v.optional(v.any()),
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
        // Apple IAP tracking
        lastTransactionId: v.optional(v.string()),
    }).index("by_user", ["userId"]),

    // Apple In-App Purchase transaction history
    iapTransactions: defineTable({
        userId: v.string(),
        productId: v.string(),
        transactionId: v.string(),
        receipt: v.optional(v.string()),
        processedAt: v.float64(),
        status: v.union(
            v.literal("completed"),
            v.literal("restored"),
            v.literal("refunded"),
            v.literal("failed")
        ),
    })
        .index("by_user", ["userId"])
        .index("by_transaction", ["transactionId"]),

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
        // Password hash for email/password users (stored as hex string from SHA-256)
        passwordHash: v.optional(v.string()),
        // Auth provider type: "email", "apple", "google", "anonymous"
        authProvider: v.optional(v.string()),
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
        // First trip guide shown on home page for new users
        hasSeenFirstTripGuide: v.optional(v.boolean()),
        // Trip detail guide shown on first generated trip
        hasSeenTripDetailGuide: v.optional(v.boolean()),
        // AI data sharing consent (Apple guideline 5.1.1/5.1.2)
        aiDataConsent: v.optional(v.boolean()),
        aiDataConsentDate: v.optional(v.float64()),
        // Referral code (unique per user)
        referralCode: v.optional(v.string()),
    })
        .index("by_user", ["userId"])
        .index("by_referralCode", ["referralCode"]),

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
        // Admin moderation fields
        rejectReason: v.optional(v.string()),
        featured: v.optional(v.boolean()),
        reportsCount: v.optional(v.float64()),
        approvedAt: v.optional(v.float64()),
        rejectedAt: v.optional(v.float64()),
        approvedBy: v.optional(v.string()),
        rejectedBy: v.optional(v.string()),
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

    // Track who liked which insight (to prevent double-liking and show like status)
    insightLikes: defineTable({
        userId: v.string(),
        insightId: v.id("insights"),
        likedAt: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_insight", ["insightId"])
        .index("by_user_and_insight", ["userId", "insightId"]),

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
      // Admin & moderation fields
      isAdmin: v.optional(v.boolean()),
      isBanned: v.optional(v.boolean()),
      isShadowBanned: v.optional(v.boolean()),
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

    // V1: Session tokens for API authentication
    sessions: defineTable({
        userId: v.string(),
        token: v.string(),
        sessionId: v.string(),
        createdAt: v.float64(),
        expiresAt: v.float64(),
    })
        .index("by_token", ["token"])
        .index("by_user", ["userId"]),

    // Password reset codes for email/password users
    passwordResetCodes: defineTable({
        // Email address (lowercase) for the reset request
        email: v.string(),
        // SHA-256 hash of the 6-digit code (never store raw code)
        codeHash: v.string(),
        // Expiration timestamp (10 minutes from creation)
        expiresAt: v.float64(),
        // Number of verification attempts (max 5)
        attempts: v.float64(),
        // Whether code has been used or invalidated
        used: v.boolean(),
        // Whether code has been verified (for session-based flow)
        verified: v.boolean(),
        // Creation timestamp
        createdAt: v.float64(),
    })
        .index("by_email", ["email"])
        .index("by_email_created", ["email", "createdAt"]),

    // Push notification tokens (Expo push tokens per device)
    pushTokens: defineTable({
        userId: v.string(),
        token: v.string(), // Expo push token e.g. "ExponentPushToken[...]"
        platform: v.string(), // "ios" | "android"
        deviceName: v.optional(v.string()),
        createdAt: v.float64(),
        updatedAt: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_token", ["token"]),

    // Notification log — tracks what was sent to avoid duplicates
    notificationLog: defineTable({
        userId: v.string(),
        tripId: v.optional(v.id("trips")),
        type: v.string(), // "countdown_7d", "countdown_3d", "countdown_1d", "morning_briefing", "post_trip_review", "plan_next", "anniversary"
        sentAt: v.float64(),
        title: v.string(),
        body: v.string(),
    })
        .index("by_user", ["userId"])
        .index("by_user_type", ["userId", "type"])
        .index("by_trip_type", ["tripId", "type"]),

    // V1: AI-generated sights for destinations (no limit)
    destinationSights: defineTable({
        // Link to trip for trip-specific sights
        tripId: v.optional(v.id("trips")),
        // Destination key (e.g., "paris-france", "tokyo-japan")
        destinationKey: v.string(),
        // Array of sights (as many as AI generates)
        sights: v.array(v.object({
            name: v.string(),
            shortDescription: v.string(),
            neighborhoodOrArea: v.optional(v.string()),
            bestTimeToVisit: v.optional(v.string()),
            estDurationHours: v.optional(v.string()),
            latitude: v.optional(v.float64()),
            longitude: v.optional(v.float64()),
        })),
        createdAt: v.float64(),
    })
        .index("by_trip", ["tripId"])
        .index("by_destination_key", ["destinationKey"]),

    // Low Fare Radar — flight deals managed via website widget, shown in app
    lowFareRadar: defineTable({
        // Route
        origin: v.string(),           // IATA code e.g. "ATH"
        originCity: v.string(),        // e.g. "Athens"
        destination: v.string(),       // IATA code e.g. "CDG"
        destinationCity: v.string(),   // e.g. "Paris"
        // Airline
        airline: v.string(),
        airlineLogo: v.optional(v.string()),
        flightNumber: v.optional(v.string()),
        // Outbound leg
        outboundDate: v.string(),      // "2024-03-15"
        outboundDeparture: v.string(), // "08:00"
        outboundArrival: v.string(),   // "10:30"
        outboundDuration: v.optional(v.string()),
        outboundStops: v.optional(v.number()),  // 0=direct, 1=one stop, etc.
        outboundSegments: v.optional(v.array(v.object({
            airline: v.string(),
            flightNumber: v.optional(v.string()),
            departureAirport: v.string(),  // IATA code
            departureTime: v.string(),     // "08:00"
            arrivalAirport: v.string(),    // IATA code
            arrivalTime: v.string(),       // "10:30"
            duration: v.optional(v.string()),
        }))),
        // Return leg (optional for one-way)
        returnDate: v.optional(v.string()),
        returnDeparture: v.optional(v.string()),
        returnArrival: v.optional(v.string()),
        returnDuration: v.optional(v.string()),
        returnAirline: v.optional(v.string()),
        returnFlightNumber: v.optional(v.string()),
        returnStops: v.optional(v.number()),
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
        price: v.float64(),
        totalPrice: v.optional(v.float64()),
        originalPrice: v.optional(v.float64()),
        currency: v.string(),         // "EUR", "USD", etc.
        // Baggage
        cabinBaggage: v.optional(v.string()),   // "1x 8kg"
        checkedBaggage: v.optional(v.string()),  // "1x 23kg"
        // Metadata
        isRecommended: v.optional(v.boolean()),
        dealTag: v.optional(v.string()),  // "HOT DEAL", "LOWEST PRICE"
        bookingUrl: v.optional(v.string()),
        expiresAt: v.optional(v.float64()),
        notes: v.optional(v.string()),
        // Travel date range (which months this deal covers)
        travelMonthFrom: v.optional(v.string()),  // "2026-04" format
        travelMonthTo: v.optional(v.string()),     // "2026-06" format
        // Analytics counters
        planTripClicks: v.optional(v.float64()),    // trips generated from this deal
        bookingClicks: v.optional(v.float64()),     // booking URL opens
        // Status
        active: v.boolean(),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_origin", ["origin"])
        .index("by_destination", ["destination"])
        .index("by_active", ["active"])
        .index("by_origin_destination", ["origin", "destination"]),

    // Watched Destinations — users watching destinations for deal alerts
    watchedDestinations: defineTable({
        userId: v.string(),
        destination: v.string(),          // normalized lowercase city name e.g. "paris"
        destinationIata: v.optional(v.string()), // IATA code if known e.g. "CDG"
        createdAt: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_destination", ["destination"])
        .index("by_user_destination", ["userId", "destination"]),

    // Trip Share Links — shareable read-only links to trip itineraries
    tripShareLinks: defineTable({
        tripId: v.id("trips"),
        userId: v.string(),
        token: v.string(),
        expiresAt: v.float64(),
        createdAt: v.float64(),
    })
        .index("by_token", ["token"])
        .index("by_trip", ["tripId"]),

    // Trip Collaborators — group trip planning with role-based access
    tripCollaborators: defineTable({
        tripId: v.id("trips"),
        userId: v.string(),
        role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
        inviteToken: v.optional(v.string()),  // set when invite is pending (no userId yet)
        joinedAt: v.float64(),
    })
        .index("by_trip", ["tripId"])
        .index("by_user", ["userId"])
        .index("by_trip_user", ["tripId", "userId"])
        .index("by_invite_token", ["inviteToken"]),

    // ---- Engagement Features ----

    // User Achievements — unlocked badges/milestones
    userAchievements: defineTable({
        userId: v.string(),
        achievementId: v.string(),
        unlockedAt: v.float64(),
        seen: v.optional(v.boolean()),
    })
        .index("by_user", ["userId"])
        .index("by_user_and_achievement", ["userId", "achievementId"]),

    // Wishlist — saved dream destinations
    wishlist: defineTable({
        userId: v.string(),
        destination: v.string(),
        country: v.optional(v.string()),
        notes: v.optional(v.string()),
        targetDateRange: v.optional(v.object({
            startMonth: v.float64(),
            startYear: v.float64(),
            endMonth: v.optional(v.float64()),
            endYear: v.optional(v.float64()),
        })),
        priority: v.optional(v.union(
            v.literal("dream"),
            v.literal("planned"),
            v.literal("someday")
        )),
        image: v.optional(v.object({
            url: v.string(),
            photographer: v.optional(v.string()),
        })),
        dealAlertEnabled: v.optional(v.boolean()),
        addedAt: v.float64(),
    })
        .index("by_user", ["userId"]),

    // User Streaks — daily check-in tracking
    userStreaks: defineTable({
        userId: v.string(),
        currentStreak: v.float64(),
        longestStreak: v.float64(),
        lastCheckInDate: v.string(), // "YYYY-MM-DD"
        streakShieldUsedAt: v.optional(v.float64()),
        totalCheckIns: v.float64(),
    })
        .index("by_user", ["userId"]),

    // Referrals — invite friends reward system
    referrals: defineTable({
        referrerId: v.string(),
        referredUserId: v.optional(v.string()),
        referralCode: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("completed"),
            v.literal("rewarded")
        ),
        rewardType: v.optional(v.string()),
        createdAt: v.float64(),
        completedAt: v.optional(v.float64()),
    })
        .index("by_referrer", ["referrerId"])
        .index("by_code", ["referralCode"])
        .index("by_referred_user", ["referredUserId"]),
});
