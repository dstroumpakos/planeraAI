import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
// Planera for Travel Agencies — additive, agency-scoped tenant tables.
import { agencyTables } from "./agency/schema";

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
        // Backward compatibility: keep raw itinerary.
        // itinerary.dayByDayItinerary[].activities[] carries optional `lat`/`lng`
        // (server-geocoded once, via convex/lib/geocoding.ts — null if geocoding
        // found nothing). itinerary.dayByDayItinerary[] itself carries optional
        // `mapImageUrl` (static day-route map URL, null if generation failed),
        // `mapTotalKm`/`mapWalkMinutes` (route totals from the same pass),
        // `mapRouteGeometry` (encoded precision-5 polyline of the walked route,
        // for drawing the real street path instead of straight lines) and
        // `mapWalkableStops`/`mapWalkableMinutes` (how many stops fall inside an
        // N-minute walk of the day's first stop). All are best-effort and may be
        // absent on trips predating the field or still awaiting backfill —
        // never assume they're present.
        itinerary: v.optional(v.any()),
        // Live generation progress for the streaming day-by-day reveal.
        // Drives the "watch your trip build" UI (real progress, not a fake bar).
        generationProgress: v.optional(v.object({
            phase: v.union(
                v.literal("planning"),   // data fetch + before first day streams
                v.literal("building"),   // days are streaming in
                v.literal("enriching"),  // all days present, per-day enrichment running
                v.literal("done"),
            ),
            daysReady: v.float64(),
            totalDays: v.float64(),
        })),
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
        // Platform the trip was generated from: "ios" | "android" | "web" (optional;
        // older trips predate this field and surface as "unknown" in admin)
        platform: v.optional(v.string()),
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
        // Share Card fields — for generating Instagram-story-style trip cards
        tripCardId: v.optional(v.string()), // PLN-BCN-2026-4F8A format
        shareCardPhoto: v.optional(v.object({
            url: v.string(),
            photographer: v.string(),
            photographerUsername: v.optional(v.string()),
        })),
    })
        .index("by_user", ["userId"])
        .index("by_status", ["status"])
        .index("by_tripCardId", ["tripCardId"])
        // Date-range lookups for notifications (avoid scanning all completed trips)
        .index("by_status_startDate", ["status", "startDate"])
        .index("by_status_endDate", ["status", "endDate"]),

    userPlans: defineTable({
        userId: v.string(),
        plan: v.union(v.literal("free"), v.literal("premium")),
        tripsGenerated: v.float64(),
        tripCredits: v.optional(v.float64()),
        subscriptionExpiresAt: v.optional(v.float64()),
        subscriptionType: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
        // Apple IAP tracking
        lastTransactionId: v.optional(v.string()),
        // Stable per-subscription key from Apple. App Store Server Notifications
        // and renewals reference this (not the per-renewal transactionId), so we
        // index it to map an inbound notification back to the owning user.
        originalTransactionId: v.optional(v.string()),
    })
        .index("by_user", ["userId"])
        .index("by_original_transaction", ["originalTransactionId"]),

    // In-App Purchase transaction history (Apple StoreKit + Google Play)
    iapTransactions: defineTable({
        userId: v.string(),
        productId: v.string(),
        transactionId: v.string(),
        receipt: v.optional(v.string()),
        originalTransactionId: v.optional(v.string()),
        processedAt: v.float64(),
        // Which store issued the receipt. Absent on rows written before Play
        // billing existed, which are all Apple — treat undefined as "ios".
        // The renewal cron uses this to pick the right verifier; sending a Play
        // purchase token to Apple's verifyReceipt would fail and, left
        // unrouted, would downgrade paying Android subscribers.
        platform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
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
        // Platform the user signed up from: "ios" | "android" | "web" (optional;
        // older users predate this and are backfilled from push tokens in admin)
        platform: v.optional(v.string()),
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
        // Reservation Inbox: unguessable local-part of this user's personal
        // forwarding address (e.g. "a8f3c2b9ad4e17f0" → a8f3c2b9ad4e17f0@in.planeraai.app).
        // Treat as a secret: anyone who knows it can post reservations into
        // this account, which is why inbound parses land in "needs_review"
        // and unverified senders never auto-attach to a trip.
        reservationAlias: v.optional(v.string()),
    })
        .index("by_user", ["userId"])
        .index("by_referralCode", ["referralCode"])
        .index("by_reservationAlias", ["reservationAlias"]),

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
        // Photographer's Unsplash profile — the link an Unsplash credit points
        // at. Optional: rows cached before this field existed don't have one.
        photographerUrl: v.optional(v.string()),
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

    // Admin-initiated push broadcasts (one row per "Send" click in the widget).
    // Used to track tap-through rate and which deal/notification each tap came from.
    notificationBroadcasts: defineTable({
        dealId: v.optional(v.id("lowFareRadar")),
        // Targeted home airport IATA codes (uppercase)
        origins: v.array(v.string()),
        // Mode: "auto" sends localized template per user; "custom" sends a fixed copy
        mode: v.string(), // "auto" | "custom"
        // For "custom" mode, the exact copy that was sent
        customTitle: v.optional(v.string()),
        customBody: v.optional(v.string()),
        // Snapshot of the deal's route (for display even if the deal is deleted)
        routeSnapshot: v.optional(v.string()), // e.g. "ATH → CDG"
        // Counts at send time
        targeted: v.float64(),
        sent: v.float64(),
        skipped: v.float64(),
        // Tap counter (incremented when users tap the notification in-app)
        taps: v.optional(v.float64()),
        // Unique-user tap counter (incremented only on the first tap per user)
        uniqueTaps: v.optional(v.float64()),
        createdAt: v.float64(),
        // Which auto-template actually went out ("lastCall" | "discount" |
        // "roundTrip" | "oneWay"), or "custom". Lets the admin widget report
        // CTR per copy variant instead of just CTR per send.
        variantId: v.optional(v.string()),
        // Why targeted users did NOT get a push. Without this the widget can
        // only show an opaque "N failed".
        skipReasons: v.optional(v.object({
            noToken: v.optional(v.float64()),
            optedOut: v.optional(v.float64()),
            frequencyCapped: v.optional(v.float64()),
            pushError: v.optional(v.float64()),
        })),
        // Lifecycle. Absent on rows written before scheduling existed — treat
        // a missing status as "sent".
        status: v.optional(v.string()), // "scheduled" | "sending" | "sent" | "cancelled" | "failed"
        // Epoch ms this send is/was scheduled for (absent = sent immediately).
        scheduledFor: v.optional(v.float64()),
        // Scheduler job id, so a scheduled send can actually be called off.
        scheduledJobId: v.optional(v.string()),
        // Set by the admin cancel button; the send loop checks it between chunks.
        cancelRequested: v.optional(v.boolean()),
        // True when wishlist-based targeting widened the audience beyond the
        // home-airport match.
        wishlistTargeted: v.optional(v.boolean()),
        // Frozen send parameters, so a scheduled run can re-resolve its
        // audience at fire time rather than using a stale snapshot.
        params: v.optional(v.any()),
    })
        .index("by_createdAt", ["createdAt"])
        .index("by_deal", ["dealId"])
        .index("by_status", ["status"]),

    // One row per (broadcast, user) tap — used to compute unique tap counts and
    // (later) per-user funnel analytics.
    notificationBroadcastTaps: defineTable({
        broadcastId: v.id("notificationBroadcasts"),
        userId: v.string(),
        tappedAt: v.float64(),
    })
        .index("by_broadcast", ["broadcastId"])
        .index("by_broadcast_user", ["broadcastId", "userId"]),

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

    // Admin-curated attraction affiliate links (GetYourGuide + future partners)
    attractionAffiliateLinks: defineTable({
        destinationCity: v.string(), // normalized lowercase city, e.g. "paris"
        destinationCountry: v.optional(v.string()), // ISO-2 preferred, e.g. "fr"
        activityTitle: v.string(), // normalized lowercase activity title
        displayTitle: v.string(),
        affiliateUrl: v.string(),
        partner: v.optional(v.string()), // e.g. "getyourguide"
        price: v.optional(v.float64()), // ticket price shown in itinerary
        currency: v.optional(v.string()), // ISO 4217, e.g. "EUR"
        topSite: v.boolean(),
        travelStyles: v.optional(v.array(v.string())),
        notes: v.optional(v.string()),
        active: v.boolean(),
        clicks: v.optional(v.float64()), // # of times users tapped this booking link
        lastClickedAt: v.optional(v.float64()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_destination_activity", ["destinationCity", "activityTitle"])
        .index("by_destination", ["destinationCity"])
        .index("by_active", ["active"])
        .index("by_topSite", ["topSite"]),

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
        // Route's typical fare (Google price-insights midpoint, or live-option
        // median) captured on the last price refresh. Powers the "X% below
        // typical" badge in newsletters and the low-fare expiry ceiling. Absent
        // until the deal's first refresh.
        typicalPrice: v.optional(v.float64()),
        // Baggage
        cabinBaggage: v.optional(v.string()),   // "1x 8kg"
        checkedBaggage: v.optional(v.string()),  // "1x 23kg"
        // Metadata
        isRecommended: v.optional(v.boolean()),
        dealTag: v.optional(v.string()),  // "Great price", "Best price"
        bookingUrl: v.optional(v.string()),
        // SerpApi POST-based booking request (Google clk/f endpoint).
        // When present, the app resolves it server-side to the real
        // provider URL via `flightsResolve.resolveBookingUrl`.
        bookingRequest: v.optional(v.object({
            url: v.string(),
            postData: v.string(),
        })),
        expiresAt: v.optional(v.float64()),
        notes: v.optional(v.string()),
        // Travel date range (which months this deal covers)
        travelMonthFrom: v.optional(v.string()),  // "2026-04" format
        travelMonthTo: v.optional(v.string()),     // "2026-06" format
        // Analytics counters
        planTripClicks: v.optional(v.float64()),    // trips generated from this deal
        bookingClicks: v.optional(v.float64()),     // booking URL opens
        // Change tracking
        changeCount: v.optional(v.float64()),       // number of times this deal was updated
        changeLog: v.optional(v.array(v.string())), // human-readable log of changes e.g. ["price 120→99", "airline Ryanair→Aegean"]
        // Status
        active: v.boolean(),
        deletedAt: v.optional(v.float64()),  // soft-delete timestamp (24h after expiry)
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_origin", ["origin"])
        .index("by_destination", ["destination"])
        .index("by_active", ["active"])
        .index("by_origin_destination", ["origin", "destination"]),

    // Low-Fare Radar refresh state — singleton row tracking the periodic
    // searchapi.io price-refresh cron. Powers the admin widget countdown and
    // the "refresh now" button. Read/written via first() (never more than one row).
    radarRefreshState: defineTable({
        lastRefreshAt: v.optional(v.float64()),  // when the last refresh completed
        nextRefreshAt: v.float64(),              // when the next refresh is due
        running: v.optional(v.boolean()),        // guard against overlapping runs
        runStartedAt: v.optional(v.float64()),   // when `running` was set — lets a killed run's lock go stale
        cycleStartedAt: v.optional(v.float64()),  // start of the current refresh CYCLE (may span several runs when one stops on its cap/time budget) — deals already priced since this mark aren't re-priced in the same cycle
        retryCount: v.optional(v.float64()),      // consecutive short-gap retries in the current cycle, capped so a cycle can't park the radar on an hourly cadence forever
        lastResult: v.optional(v.object({
            checked: v.float64(),
            updated: v.float64(),
            unchanged: v.float64(),
            notFound: v.float64(),
            failed: v.float64(),
            expired: v.optional(v.float64()),  // deals retired for exceeding the low-fare ceiling
            skipped: v.optional(v.float64()),  // eligible deals left for the next tick (time budget)
            at: v.float64(),
        })),
        updatedAt: v.float64(),
    }),

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
        rewardedMilestones: v.optional(v.array(v.float64())), // streak milestones already paid out
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

    // Aggregated trip data for SEO itinerary generation (web)
    tripAggregations: defineTable({
        destinationKey: v.string(),
        destination: v.string(),
        country: v.optional(v.string()),
        durationDays: v.float64(),
        tripIds: v.array(v.id("trips")),
        count: v.float64(),
        lastUpdated: v.float64(),
    })
        .index("by_destination_key", ["destinationKey"]),

    // Published SEO itinerary pages (web)
    publishedItineraries: defineTable({
        slug: v.string(),
        destination: v.string(),
        country: v.string(),
        continent: v.string(),
        durationDays: v.float64(),
        title: v.string(),
        metaDescription: v.string(),
        intro: v.string(),
        budgetLevel: v.string(),
        budgetPerDayEur: v.float64(),
        bestFor: v.array(v.string()),
        bestSeason: v.string(),
        heroImage: v.string(),
        // Unsplash attribution for the hero image (photographer + links).
        heroImageData: v.optional(v.any()),
        days: v.any(),
        practicalInfo: v.any(),
        faqs: v.array(v.object({
            question: v.string(),
            answer: v.string(),
        })),
        relatedItineraries: v.array(v.string()),
        sourceTripCount: v.float64(),
        lastAggregated: v.float64(),
        // Per-locale translations of the text fields (el/es/fr/de/ar). English
        // stays canonical in the top-level fields; client overlays the active locale.
        translations: v.optional(v.any()),
        // Draft→approve gate: only "published" rows are served to the website.
        // "rejected" is sticky so the cron won't regenerate a dismissed draft.
        // Optional for backward-compat with any pre-existing rows (treated as published).
        status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("rejected"))),
    })
        .index("by_slug", ["slug"])
        .index("by_destination", ["destination"])
        .index("by_status", ["status"]),

    // WorldPrint — user's living globe profile
    worldPrintProfile: defineTable({
        userId: v.string(),
        signatureColor: v.string(),
        claimedQuestIds: v.array(v.string()),
        lifetimeQuestsCompleted: v.float64(),
        lastActivityAt: v.float64(),
        publicCode: v.string(),
        createdAt: v.float64(),
        title: v.optional(v.string()),
        globeSkin: v.optional(v.string()),
    })
        .index("by_user", ["userId"])
        .index("by_public_code", ["publicCode"]),

    // WorldPrint — individual city visits (verified or planned)
    worldPrintVisits: defineTable({
        userId: v.string(),
        cityId: v.string(),
        countryCode: v.string(),
        status: v.union(
            v.literal("verified"),
            v.literal("planned"),
            v.literal("manual"),
            v.literal("claimed"),
            v.literal("holographic")
        ),
        tripId: v.optional(v.id("trips")),
        verifiedAt: v.float64(),
        // How this visit was verified: "trip" (completed trip with past end date),
        // "gps" (user checked in while physically near the city), "manual".
        verifiedSource: v.optional(v.string()),
        // Last GPS check-in coordinates (for audit / display only).
        lastCheckInLat: v.optional(v.float64()),
        lastCheckInLng: v.optional(v.float64()),
    })
        .index("by_user", ["userId"])
        .index("by_user_and_city", ["userId", "cityId"]),

    // ─────────────────────────────────────────────────────────
    // OTA PACKAGES — Partner travel packages shown in trip view
    // ─────────────────────────────────────────────────────────

    otaPartners: defineTable({
        name: v.string(),
        slug: v.string(),
        description: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        contactEmail: v.string(), // where lead notifications are sent
        ccEmails: v.optional(v.array(v.string())),
        phone: v.optional(v.string()),
        // Optional disclaimer to show under partner cards (e.g. legal text)
        disclaimer: v.optional(v.string()),
        active: v.boolean(),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_slug", ["slug"])
        .index("by_active", ["active"]),

    otaPackages: defineTable({
        partnerId: v.id("otaPartners"),
        title: v.string(),
        subtitle: v.optional(v.string()),
        description: v.string(),
        // Destination matching
        destinationCity: v.optional(v.string()),
        destinationCountry: v.string(),
        destinationCountryCode: v.optional(v.string()), // ISO-2, lowercase
        destinationLat: v.optional(v.float64()),
        destinationLng: v.optional(v.float64()),
        // Duration matching (in days)
        durationDays: v.float64(),
        minDurationDays: v.optional(v.float64()),
        maxDurationDays: v.optional(v.float64()),
        // Pricing (from-price, displayed)
        priceFrom: v.float64(),
        priceCurrency: v.string(), // ISO-4217 e.g. "EUR"
        priceUnit: v.optional(v.union(
            v.literal("per_person"),
            v.literal("per_couple"),
            v.literal("total")
        )),
        // What's included (badges)
        includes: v.array(v.string()), // e.g. ["flights","hotel","transfers","breakfast"]
        // Marketing content
        highlights: v.optional(v.array(v.string())),
        imageUrls: v.array(v.string()),
        heroImageUrl: v.optional(v.string()),
        // Availability window (unix ms)
        availableFrom: v.optional(v.float64()),
        availableTo: v.optional(v.float64()),
        // External references
        externalRef: v.optional(v.string()),
        externalUrl: v.optional(v.string()),
        // Display
        badge: v.optional(v.string()), // e.g. "Best Seller", "Eco"
        sortPriority: v.optional(v.float64()),
        active: v.boolean(),
        // Stats
        viewCount: v.optional(v.float64()),
        leadCount: v.optional(v.float64()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_partner", ["partnerId"])
        .index("by_country", ["destinationCountryCode", "active"])
        .index("by_active", ["active"])
        .index("by_external_ref", ["externalRef"]),

    otaLeads: defineTable({
        userId: v.string(),
        packageId: v.id("otaPackages"),
        partnerId: v.id("otaPartners"),
        tripId: v.optional(v.id("trips")),
        // Trip context snapshot
        destination: v.string(),
        startDate: v.optional(v.float64()),
        endDate: v.optional(v.float64()),
        travelers: v.float64(),
        budget: v.optional(v.float64()),
        // Contact
        contactName: v.string(),
        contactEmail: v.string(),
        contactPhone: v.optional(v.string()),
        preferredContactMethod: v.optional(v.union(
            v.literal("email"),
            v.literal("phone"),
            v.literal("any")
        )),
        message: v.optional(v.string()),
        consentGiven: v.boolean(), // GDPR — user agreed to share data with partner
        // Lifecycle
        status: v.union(
            v.literal("pending"),
            v.literal("sent"),
            v.literal("contacted"),
            v.literal("converted"),
            v.literal("closed"),
            v.literal("failed")
        ),
        sentToPartnerAt: v.optional(v.float64()),
        sendError: v.optional(v.string()),
        partnerNotes: v.optional(v.string()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
    })
        .index("by_user", ["userId"])
        .index("by_partner", ["partnerId"])
        .index("by_package", ["packageId"])
        .index("by_status", ["status"])
        .index("by_trip", ["tripId"]),

    // SerpApi Google Flights cache. Reduces latency & API quota use by
    // caching normalized search responses + booking option lookups for a
    // short window. Stores `any` because the normalized shape is defined in
    // types/flights.ts and may evolve faster than the schema.
    flightSearchCache: defineTable({
        cacheKey: v.string(),
        kind: v.union(
            v.literal("search"),
            v.literal("booking_options"),
            v.literal("explore"),
            v.literal("explore_destination"),
            v.literal("calendar"),
            v.literal("accommodations")
        ),
        departureId: v.optional(v.string()),
        arrivalId: v.optional(v.string()),
        outboundDate: v.optional(v.string()),
        returnDate: v.optional(v.string()),
        type: v.optional(v.string()),
        currency: v.optional(v.string()),
        normalizedResults: v.any(),
        createdAt: v.float64(),
        expiresAt: v.float64(),
    })
        .index("by_cacheKey", ["cacheKey"])
        .index("by_expires", ["expiresAt"]),

    // Fixed-window rate limit for user-facing flight searches. Guards the
    // (paid) SerpApi quota against abuse — especially anonymous public searches
    // from the marketing widget. One row per user; the window resets lazily.
    flightSearchRateLimits: defineTable({
        userId: v.string(),
        windowStart: v.float64(),
        count: v.float64(),
    })
        .index("by_user", ["userId"]),

    // ───────────────────────────── Atlas assistant ──────────────────────────
    // Fixed-window rate limit for Atlas chat turns. Atlas calls OpenAI on every
    // turn (plus a second call per tool round-trip), so an unmetered chat is an
    // open-ended bill. Deliberately a separate table from
    // `flightSearchRateLimits` so a chatty Atlas session can't eat the user's
    // flight-search budget, and vice versa.
    atlasRateLimits: defineTable({
        userId: v.string(),
        windowStart: v.float64(),
        count: v.float64(),
    })
        .index("by_user", ["userId"]),

    // One Atlas chat thread. Previously the whole conversation lived in React
    // state on the Atlas tab and was lost on unmount; persisting it also gives
    // us the corpus needed to see what users actually ask.
    atlasConversations: defineTable({
        userId: v.string(),
        title: v.string(),             // derived from the first user message
        createdAt: v.float64(),
        updatedAt: v.float64(),
        messageCount: v.float64(),
    })
        .index("by_user_updated", ["userId", "updatedAt"]),

    // Individual turns. `cards` holds the structured tool output the UI renders
    // (weather / deals / sights / …) so a reopened thread redraws its cards
    // instead of degrading to plain text.
    atlasMessages: defineTable({
        conversationId: v.id("atlasConversations"),
        userId: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        cards: v.optional(v.any()),
        suggestions: v.optional(v.array(v.string())),
        toolsUsed: v.optional(v.array(v.string())),
        createdAt: v.float64(),
    })
        .index("by_conversation", ["conversationId", "createdAt"])
        .index("by_user", ["userId"]),

    // Short-TTL cache for Atlas tool results. TripAdvisor detail lookups are an
    // N+1 (five detail fetches per restaurant question) and country/holiday
    // facts barely change, so identical tool calls are served from here.
    atlasToolCache: defineTable({
        key: v.string(),               // `${toolName}:${normalized args}`
        payload: v.any(),
        expiresAt: v.float64(),
    })
        .index("by_key", ["key"])
        .index("by_expires", ["expiresAt"]),

    // Cache for AI-resolved IATA codes. When the static destination→airport
    // map can't resolve a city, we ask OpenAI for the nearest airport's IATA
    // code and persist it here so the same place never re-hits OpenAI.
    iataResolutionCache: defineTable({
        cityKey: v.string(),      // normalized (lowercased, trimmed) city name
        iata: v.string(),         // resolved 3-letter IATA code
        // English city/country, filled in by the base-airport resolver
        // (homeAirportAi.ts) so we can rebuild a readable label
        // ("Kalamata, Greece KLX") without another OpenAI round-trip. Absent on
        // rows written by the older destination-only resolver.
        city: v.optional(v.string()),
        country: v.optional(v.string()),
        createdAt: v.float64(),
    })
        .index("by_cityKey", ["cityKey"]),


    // last time each unique error key (source + message hash) was emailed.
    errorReports: defineTable({
        key: v.string(),          // sha1(source + message head)
        source: v.string(),       // e.g. "tripsActions:generateTrip"
        message: v.string(),
        count: v.float64(),       // occurrences since first seen
        firstSeenAt: v.float64(),
        lastSentAt: v.float64(),
    })
        .index("by_key", ["key"]),

    // =========================================================================
    // Partner Itinerary API (e.g. spytrip.gr) — versioned /v1/ HTTP surface.
    // These tables back a self-contained partner API that is isolated from the
    // app's user-session auth. Partners authenticate with a per-partner Bearer
    // key (stored hashed). Generation is async + cached.
    // =========================================================================

    // Per-partner API keys. The raw key is shown ONCE at creation; only the
    // SHA-256 hash is persisted. Each key carries its own rate limit / caps and
    // an HMAC secret used to sign outbound webhooks.
    partnerApiKeys: defineTable({
        keyHash: v.string(),            // SHA-256 hex of the raw Bearer key
        keyPrefix: v.string(),          // first chars (e.g. "pk_live_AbC1") for display
        partnerName: v.string(),        // human label, e.g. "spytrip.gr"
        partnerRef: v.string(),         // stable partner identifier
        webhookSecret: v.string(),      // HMAC-SHA256 secret for webhook signing
        active: v.boolean(),
        rateLimitPerMin: v.float64(),   // requests / minute
        dailyCap: v.float64(),          // generations / day
        monthlyCap: v.float64(),        // generations / month
        createdAt: v.float64(),
        lastUsedAt: v.optional(v.float64()),
        revokedAt: v.optional(v.float64()),
        // Owning partner account (self-service keys). Admin-minted keys have none.
        accountId: v.optional(v.id("partnerAccounts")),
    })
        .index("by_keyHash", ["keyHash"])
        .index("by_partnerRef", ["partnerRef"])
        .index("by_account", ["accountId"]),

    // Partner portal accounts. Partners are invited by email, set a password,
    // then sign in to self-manage their API keys. Password is PBKDF2-hashed.
    partnerAccounts: defineTable({
        email: v.string(),              // lowercased, unique login
        partnerName: v.string(),        // company / brand label
        partnerRef: v.string(),         // stable partner identifier
        // "api" = API consumer (invited, manages keys/usage). "supplier" =
        // self-serve product supplier (signs up + verifies email, manages
        // product listings). Missing = legacy API account.
        kind: v.optional(v.union(v.literal("api"), v.literal("supplier"))),
        passwordHash: v.optional(v.string()), // set once invite is accepted
        status: v.union(
            v.literal("invited"),
            v.literal("pending_verification"), // self-serve signup, email not yet verified
            v.literal("active"),
            v.literal("disabled")
        ),
        inviteTokenHash: v.optional(v.string()), // SHA-256 of one-time invite token
        inviteExpiresAt: v.optional(v.float64()),
        // Self-serve email verification (supplier signup).
        emailVerifyTokenHash: v.optional(v.string()), // SHA-256 of one-time verify token
        emailVerifyExpiresAt: v.optional(v.float64()),
        // Default limits applied to keys this partner creates.
        rateLimitPerMin: v.float64(),
        dailyCap: v.float64(),
        monthlyCap: v.float64(),
        createdAt: v.float64(),
        activatedAt: v.optional(v.float64()),
        lastLoginAt: v.optional(v.float64()),
        // When the partner accepted the Partner API Terms during signup.
        acceptedTermsAt: v.optional(v.float64()),
    })
        .index("by_email", ["email"])
        .index("by_inviteTokenHash", ["inviteTokenHash"])
        .index("by_emailVerifyTokenHash", ["emailVerifyTokenHash"])
        .index("by_partnerRef", ["partnerRef"]),

    // Partner portal sessions (separate from app user sessions). Token is
    // stored hashed; the raw token lives only in the partner's browser.
    partnerAccountSessions: defineTable({
        accountId: v.id("partnerAccounts"),
        tokenHash: v.string(),          // SHA-256 of the session token
        createdAt: v.float64(),
        expiresAt: v.float64(),
    })
        .index("by_tokenHash", ["tokenHash"])
        .index("by_account", ["accountId"]),

    // Rolling usage counters per key + window. `bucket` is the window label,
    // e.g. minute "2026-06-02T14:31", day "2026-06-02", month "2026-06".
    partnerUsageCounters: defineTable({
        keyId: v.id("partnerApiKeys"),
        // "min"/"day"/"month" = metered LLM generations; "cache_day"/"cache_month"
        // = free cache hits (tracked for analytics only, not billed).
        window: v.union(
            v.literal("min"),
            v.literal("day"),
            v.literal("month"),
            v.literal("cache_day"),
            v.literal("cache_month")
        ),
        bucket: v.string(),
        count: v.float64(),
        expiresAt: v.float64(),         // for cleanup of stale buckets
    })
        .index("by_key_window_bucket", ["keyId", "window", "bucket"])
        .index("by_expires", ["expiresAt"]),

    // Canonical partner itinerary resource. Doubles as the async job record and
    // the cache entry. `cacheKey` = hash(normalizedDestination + days + sorted
    // preferences). `source` records how the result was produced.
    partnerItineraries: defineTable({
        itineraryId: v.string(),        // public id, e.g. "itn_AbC123..."
        cacheKey: v.string(),           // normalized cache key (see above)
        keyId: v.id("partnerApiKeys"),  // owning partner key
        partnerRef: v.string(),
        idempotencyKey: v.optional(v.string()),
        destination: v.string(),
        normalizedDestination: v.string(),
        days: v.float64(),
        preferences: v.array(v.string()), // sorted, normalized
        webhookUrl: v.optional(v.string()),
        isPregenerated: v.optional(v.boolean()), // produced by the pre-gen job
        status: v.union(
            v.literal("queued"),
            v.literal("generating"),
            v.literal("ready"),
            v.literal("failed")
        ),
        source: v.optional(v.union(
            v.literal("llm"),
            v.literal("cache"),
            v.literal("pregenerated"),
            v.literal("template")
        )),
        itinerary: v.optional(v.any()),   // { days: [ { day, title, stops: [...] } ] }
        error: v.optional(v.string()),
        webhookDeliveredAt: v.optional(v.float64()),
        createdAt: v.float64(),
        readyAt: v.optional(v.float64()),
    })
        .index("by_itineraryId", ["itineraryId"])
        .index("by_cacheKey", ["cacheKey"])
        .index("by_idempotency", ["keyId", "idempotencyKey"]),

    // Demand signal for the pre-generation "budget". Every live (cache-miss) LLM
    // generation records the requested destination + duration here so the
    // recurring pre-generation cron can fill in the gaps — pre-building the
    // other common durations for cities partners actually ask for, turning
    // future requests into instant cache hits.
    partnerDemand: defineTable({
        destinationKey: v.string(),      // normalized destination
        destination: v.string(),         // last-seen display name
        days: v.float64(),
        count: v.float64(),              // live generations seen for this combo
        firstRequestedAt: v.float64(),
        lastRequestedAt: v.float64(),
        covered: v.boolean(),            // pre-generation has handled this city
        coveredAt: v.optional(v.float64()),
    })
        .index("by_dest_days", ["destinationKey", "days"])
        .index("by_covered_count", ["covered", "count"]),

    // Learned canonical spelling for a city. The first time a partner requests a
    // city we don't pre-generate (e.g. "Porto"), we lock its `cityToken`
    // (normalized text before the first comma) to that spelling. Every later
    // variant ("porto", "Porto, Portugal") then canonicalizes to the same value
    // so it hits the cache instead of triggering a fresh LLM generation. This is
    // what guarantees every requested city ends up matched correctly.
    partnerCityCanonical: defineTable({
        cityToken: v.string(),               // normalized first segment, e.g. "porto"
        canonicalDestination: v.string(),    // locked spelling, e.g. "Porto, Portugal"
        createdAt: v.float64(),
        lastSeenAt: v.float64(),
    })
        .index("by_cityToken", ["cityToken"]),

    // Inbound "Become a partner" applications from the public marketing site.
    // An operator reviews them in /partner-admin and clicks "Invite", which
    // runs the existing invite → signup → portal flow (creates partnerAccounts).
    // status: "new" → "invited" | "dismissed".
    partnerApplications: defineTable({
        companyName: v.string(),
        website: v.optional(v.string()),
        contactName: v.string(),
        email: v.string(),                   // lowercased contact email
        partnershipTypes: v.array(v.string()), // e.g. ["airlines","hotels"]
        monthlyVolume: v.optional(v.string()),
        message: v.optional(v.string()),
        status: v.union(
            v.literal("new"),
            v.literal("invited"),
            v.literal("dismissed")
        ),
        createdAt: v.float64(),
        reviewedAt: v.optional(v.float64()),
    })
        .index("by_status_created", ["status", "createdAt"])
        .index("by_created", ["createdAt"]),

    // Product / offer listings submitted by self-serve supplier partners
    // (`partnerAccounts.kind === "supplier"`). New/edited listings land in
    // status "pending" and an operator approves them in /partner-admin before
    // they go live. status: "pending" → "approved" | "rejected" | "archived".
    partnerProducts: defineTable({
        accountId: v.id("partnerAccounts"),
        partnerRef: v.string(),
        type: v.union(
            v.literal("flight"),
            v.literal("hotel"),
            v.literal("tour"),
            v.literal("experience"),
            v.literal("other")
        ),
        title: v.string(),
        description: v.optional(v.string()),
        destination: v.optional(v.string()), // free-text city/region as supplied
        city: v.optional(v.string()),
        country: v.optional(v.string()),
        price: v.optional(v.float64()),
        currency: v.optional(v.string()),    // ISO 4217, e.g. "EUR"
        bookingUrl: v.optional(v.string()),
        imageUrls: v.optional(v.array(v.string())),
        status: v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("archived")
        ),
        rejectionReason: v.optional(v.string()),
        createdAt: v.float64(),
        updatedAt: v.float64(),
        reviewedAt: v.optional(v.float64()),
    })
        .index("by_account", ["accountId"])
        .index("by_status_created", ["status", "createdAt"]),

    // Cron-computed singleton holding the destination aggregates behind the
    // home "Trending Now" strip and the /destinations screen. Trip documents
    // carry the whole generated `itinerary` blob (~57 KB each), so scanning
    // every completed trip inside a client-facing query blew the 16 MB
    // per-transaction read limit and crashed the app. See destinationStats.ts.
    destinationStats: defineTable({
        computedAt: v.float64(),
        durationMs: v.optional(v.float64()),
        // How many completed trips fed the aggregate, and whether the scan was
        // cut short by the page cap (partial = numbers are a lower bound).
        tripsScanned: v.optional(v.float64()),
        partial: v.optional(v.boolean()),
        // All-time, city-normalised — powers /destinations.
        all: v.array(v.object({
            destination: v.string(),
            count: v.float64(),
            avgBudget: v.float64(),
            avgTripSpend: v.union(v.number(), v.null()),
            spendCurrency: v.string(),
            spendLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
            spendSource: v.union(v.literal("unwto"), v.literal("estimate"), v.null()),
            interests: v.array(v.string()),
        })),
        // Last 30 days, raw destination strings — powers "Trending Now".
        trending: v.array(v.object({
            destination: v.string(),
            count: v.float64(),
            avgBudget: v.float64(),
            avgTripSpend: v.union(v.number(), v.null()),
            spendCurrency: v.string(),
            spendLevel: v.union(v.literal("city"), v.literal("country"), v.null()),
            spendSource: v.union(v.literal("unwto"), v.literal("estimate"), v.null()),
            interests: v.array(v.string()),
        })),
    }),

    // Cached singleton for site-wide trip aggregates. Recomputed by a cron so
    // the public landing query and the admin dashboard never scan the (large)
    // trips table on every request.
    landingStats: defineTable({
        tripsCount: v.float64(),
        usersCount: v.float64(),
        destinationsCount: v.float64(),
        // Admin-dashboard aggregates (optional: populated by the same recompute).
        completedTripsCount: v.optional(v.float64()),
        topTripDestinations: v.optional(
            v.array(v.object({ destination: v.string(), count: v.float64() })),
        ),
        updatedAt: v.float64(),
    }),

    // Per-user activity counters, denormalised by the `recompute-admin-kpis`
    // cron (see adminKpis.ts). The admin user list needs trips/insights/likes
    // counts for every row, but `trips` rows average ~57 KB (they carry the
    // whole itinerary blob), so counting them live costs ~280 documents before
    // the 16 MB per-transaction read limit fires — i.e. a handful of users, not
    // a 500-row page. The KPI cron already scans every trip and insight once an
    // hour, so it accumulates these counts on the way past and writes one tiny
    // row per active user. `admin.listUsersPage` then joins a ~200-byte doc per
    // user instead of megabytes of itineraries.
    //
    // Only users with at least one trip or insight get a row; everyone else is
    // read as zeros. Rows whose `generation` no longer matches the newest run
    // are pruned, so deleting all of a user's trips clears their counters.
    userActivityStats: defineTable({
        userId: v.string(),
        tripsCount: v.float64(),
        upcomingTripsCount: v.float64(),
        pastTripsCount: v.float64(),
        completedTripsCount: v.float64(),
        lastTripAt: v.optional(v.float64()),
        insightsCount: v.float64(),
        approvedInsightsCount: v.float64(),
        totalLikes: v.float64(),
        // Timestamp of the cron run that produced this row. Doubles as the
        // "as of" the admin UI shows and as the prune key for stale rows.
        generation: v.float64(),
    })
        .index("by_user", ["userId"])
        .index("by_generation", ["generation"]),

    // Cron-computed singleton holding the full admin-dashboard KPI set. Like
    // landingStats, this exists so the admin dashboard reads one small doc
    // instead of scanning the large trips/users/plans tables on every load.
    // Recomputed by the `recompute-admin-kpis` cron (see adminKpis.ts).
    // Every field is optional so the shape can evolve additively without a
    // migration and so a partial/first-run write never fails validation.
    adminKpis: defineTable({
        computedAt: v.optional(v.float64()),
        durationMs: v.optional(v.float64()),

        // ---- Trips ----
        trips: v.optional(v.object({
            total: v.float64(),
            completed: v.float64(),
            failed: v.float64(),
            generating: v.float64(),
            pending: v.float64(),
            archived: v.float64(),
            deal: v.float64(),
            multiCity: v.float64(),
            successRatePct: v.float64(),   // completed / (completed + failed)
            avgDurationDays: v.float64(),
            avgTravelers: v.float64(),
            avgBudgetEur: v.float64(),
        })),
        tripsByPlatform: v.optional(v.array(v.object({ key: v.string(), count: v.float64() }))),
        tripsByLanguage: v.optional(v.array(v.object({ key: v.string(), count: v.float64() }))),
        topTripDestinations: v.optional(v.array(v.object({ destination: v.string(), count: v.float64() }))),

        // ---- Users / activation ----
        users: v.optional(v.object({
            total: v.float64(),
            activated: v.float64(),           // >= 1 trip
            activatedCompleted: v.float64(),  // >= 1 completed trip
            onboardingCompleted: v.float64(),
            aiConsent: v.float64(),
            activationRatePct: v.float64(),
        })),
        usersByPlatform: v.optional(v.array(v.object({ key: v.string(), count: v.float64() }))),
        usersByAuthProvider: v.optional(v.array(v.object({ key: v.string(), count: v.float64() }))),

        // ---- Subscriptions / monetization ----
        subs: v.optional(v.object({
            free: v.float64(),
            premium: v.float64(),             // any plan==="premium" (incl. admin-comped)
            premiumMonthly: v.float64(),
            premiumYearly: v.float64(),
            expired: v.float64(),             // premium plan whose subscriptionExpiresAt < now
            // Apple-paywall payers only: premium whose plan carries an Apple
            // transaction id (lastTransactionId/originalTransactionId), which is
            // set exclusively by the real IAP grant path — never by an admin grant.
            // Optional so a pre-existing singleton (written before these were
            // added) still validates on deploy; recompute always populates them.
            premiumPaying: v.optional(v.float64()),        // ever purchased via Apple (still premium)
            premiumPayingActive: v.optional(v.float64()),  // paying AND not expired
            premiumComped: v.optional(v.float64()),        // premium with no Apple txn (admin-granted)
            conversionRatePct: v.float64(),       // premium / total users (all premium)
            payingConversionRatePct: v.optional(v.float64()), // premiumPaying / total users
            estMrrEur: v.float64(),           // from active paying subs only
            estArrEur: v.float64(),
        })),
        iap: v.optional(v.object({
            completed: v.float64(),
            restored: v.float64(),
            refunded: v.float64(),
            failed: v.float64(),
            refundRatePct: v.float64(),
        })),

        // ---- Insights (UGC moderation) ----
        insights: v.optional(v.object({
            total: v.float64(),
            approved: v.float64(),
            pending: v.float64(),
            rejected: v.float64(),
            flagged: v.float64(),
            reported: v.float64(),
            approvalRatePct: v.float64(),
        })),

        // ---- Engagement ----
        engagement: v.optional(v.object({
            activeStreaks: v.float64(),
            avgCurrentStreak: v.float64(),
            longestStreak: v.float64(),
            pushTokens: v.float64(),
            pushOptInRatePct: v.float64(),
        })),
        referrals: v.optional(v.object({
            total: v.float64(),
            pending: v.float64(),
            completed: v.float64(),
            rewarded: v.float64(),
        })),
        notifications: v.optional(v.object({
            broadcasts: v.float64(),
            sent: v.float64(),
            taps: v.float64(),
            uniqueTaps: v.float64(),
            tapThroughRatePct: v.float64(),  // uniqueTaps / sent
        })),

        // ---- Revenue-adjacent (affiliate / leads) ----
        otaLeads: v.optional(v.object({
            total: v.float64(),
            pending: v.float64(),
            sent: v.float64(),
            contacted: v.float64(),
            converted: v.float64(),
            closed: v.float64(),
            failed: v.float64(),
            conversionRatePct: v.float64(),  // converted / total
        })),
        otaPackages: v.optional(v.object({
            active: v.float64(),
            totalViews: v.float64(),
            totalLeads: v.float64(),
        })),
        affiliate: v.optional(v.object({
            activeLinks: v.float64(),
            totalClicks: v.float64(),
            topLinks: v.array(v.object({ title: v.string(), clicks: v.float64() })),
        })),
        radar: v.optional(v.object({
            activeDeals: v.float64(),
            planTripClicks: v.float64(),
            bookingClicks: v.float64(),
        })),

        // ---- Web / SEO ----
        itineraries: v.optional(v.object({
            draft: v.float64(),
            published: v.float64(),
            rejected: v.float64(),
        })),

        // ---- Partner API ----
        partnerApi: v.optional(v.object({
            activeKeys: v.float64(),
            totalKeys: v.float64(),
            applicationsNew: v.float64(),
            productsPending: v.float64(),
        })),

        // ---- Time series: last 30 days ----
        daily: v.optional(v.array(v.object({
            date: v.string(),         // "YYYY-MM-DD" (UTC)
            signups: v.float64(),
            trips: v.float64(),
            completedTrips: v.float64(),
        }))),
    }),

    // Newsletter funnel subscribers (double opt-in + drip sequence).
    // Captured from the marketing site and in-app opt-in card.
    // Per-route fare watches. Distinct from `newsletterSubscribers`, which is a
    // curated regional deal list: a row here watches ONE origin→destination
    // (optionally one date pair) and emails that subscriber when THAT fare
    // drops. Created anonymously from the ChatGPT app / website, so identity is
    // an email address plus double opt-in — never an account.
    routePriceAlerts: defineTable({
        email: v.string(),
        departureId: v.string(),          // IATA, upper-case
        arrivalId: v.string(),
        // Omitted = "any dates" — the watch then tracks the cheapest fare in the
        // rolling calendar window rather than one specific pair.
        outboundDate: v.optional(v.string()), // YYYY-MM-DD
        returnDate: v.optional(v.string()),
        adults: v.optional(v.float64()),
        travelClass: v.optional(v.string()),
        stops: v.optional(v.string()),
        currency: v.string(),

        // Fare when the watch was created — what "dropped" is measured against.
        baselinePrice: v.float64(),
        // Explicit user target ("tell me under €400"). Absent = notify on any
        // meaningful drop below the baseline.
        targetPrice: v.optional(v.float64()),

        lastCheckedPrice: v.optional(v.float64()),
        lastCheckedAt: v.optional(v.float64()),
        // Guards repeat emails: we only re-notify on a further drop below this.
        lastNotifiedPrice: v.optional(v.float64()),
        lastNotifiedAt: v.optional(v.float64()),
        notifyCount: v.optional(v.float64()),
        consecutiveFailures: v.optional(v.float64()),

        status: v.union(
            v.literal("pending"),       // awaiting double opt-in
            v.literal("active"),
            v.literal("unsubscribed"),
            v.literal("expired")        // travel date passed, or watch aged out
        ),
        confirmToken: v.string(),
        unsubscribeToken: v.string(),

        language: v.optional(v.string()),
        source: v.optional(v.string()),   // "chatgpt-app" | "web" | ...
        userId: v.optional(v.string()),   // set if a logged-in user created it

        createdAt: v.float64(),
        confirmedAt: v.optional(v.float64()),
        unsubscribedAt: v.optional(v.float64()),
        // When this watch stops being useful (travel date, or a hard cap).
        expiresAt: v.float64(),
        // Cron ordering: the earliest moment this row should be re-priced.
        nextCheckAt: v.float64(),
    })
        .index("by_confirm_token", ["confirmToken"])
        .index("by_unsubscribe_token", ["unsubscribeToken"])
        .index("by_email", ["email"])
        // Drives the cron: scan active rows whose next check is due.
        .index("by_status_and_next_check", ["status", "nextCheckAt"]),

    newsletterSubscribers: defineTable({
        email: v.string(),
        status: v.union(
            v.literal("pending"),      // awaiting double opt-in confirmation
            v.literal("active"),       // confirmed, receiving emails
            v.literal("unsubscribed"), // opted out
            // Mail we sent came back undeliverable (hard bounce, or enough
            // consecutive soft bounces). Terminal for sending, but distinct
            // from "unsubscribed": the person never asked to leave, the
            // mailbox just stopped existing. Kept separate so the funnel
            // numbers don't blame churn for a deliverability problem.
            v.literal("bounced"),
            // The recipient hit "report spam". Hardest stop we have — never
            // email again, never auto-resubscribe, not even on a new signup.
            v.literal("complained")
        ),
        source: v.optional(v.string()),   // "web" | "app" | etc.
        // Additional signup surfaces this address later came through, e.g.
        // "chatgpt-waitlist". Recorded alongside `source` rather than replacing
        // it so the original attribution survives — campaign targeting matches
        // either. Only set when someone signs up again through a tagged form.
        tags: v.optional(v.array(v.string())),
        language: v.optional(v.string()),
        // ISO-3166-1 alpha-2, lowercase (e.g. "fr", "gr"). Captured at signup
        // from IP geolocation so newsletter deals & targeting are geo-relevant
        // (a French subscriber gets French-origin fares, not Athens ones).
        country: v.optional(v.string()),
        userId: v.optional(v.string()),   // set if a logged-in app user subscribed
        // Double opt-in / unsubscribe tokens (unguessable)
        confirmToken: v.string(),
        unsubscribeToken: v.string(),
        // Drip sequence progress (0 = welcome sent, then 1..N)
        dripStage: v.float64(),
        lastEmailSentAt: v.optional(v.float64()),
        confirmedAt: v.optional(v.float64()),
        unsubscribedAt: v.optional(v.float64()),
        createdAt: v.float64(),

        // --- Deliverability (fed by the Postmark webhook, see emailEvents.ts) ---
        // Hard bounces / spam complaints flip `status` above; these fields are
        // the evidence trail behind that decision and the engagement signal we
        // use to decide who is actually reading.
        bounceCount: v.optional(v.float64()),      // hard bounces seen
        softBounceCount: v.optional(v.float64()),  // transient failures since the last delivery
        lastBounceAt: v.optional(v.float64()),
        lastBounceType: v.optional(v.string()),    // Postmark `Type`, e.g. "HardBounce"
        lastBounceDetail: v.optional(v.string()),  // human-readable reason, truncated
        // When sending to this address was stopped (bounce or complaint).
        suppressedAt: v.optional(v.float64()),
        complainedAt: v.optional(v.float64()),
        lastDeliveredAt: v.optional(v.float64()),
        lastOpenedAt: v.optional(v.float64()),
        lastClickedAt: v.optional(v.float64()),
        openCount: v.optional(v.float64()),
        clickCount: v.optional(v.float64()),
    })
        .index("by_email", ["email"])
        .index("by_confirm_token", ["confirmToken"])
        .index("by_unsubscribe_token", ["unsubscribeToken"])
        .index("by_status", ["status"]),

    // One-off marketing broadcasts composed by the marketing team in the admin
    // dashboard and sent to opted-in newsletter subscribers. Distinct from the
    // automated drip (see newsletter.ts): the drip is a fixed sequence, these
    // are ad-hoc campaigns. Rendered through the same branded email shell.
    newsletterCampaigns: defineTable({
        // --- Structured content (fed into renderEmail) ---
        subject: v.string(),
        preheader: v.string(),
        heading: v.string(),
        para1: v.string(),
        para2: v.optional(v.string()),
        ctaText: v.string(),
        ctaUrl: v.string(),
        heroImg: v.optional(v.string()),   // hosted image URL shown at the top
        includeDeals: v.boolean(),         // append live Low-Fare Radar deal cards
        dealCount: v.optional(v.float64()), // how many deal cards (1-5, default 3)
        // --- Optional enrichment blocks. Each is an opt-in section rendered
        // AFTER the main copy in a stable order (spotlight → itineraries →
        // sights → guides → attractions → packages → route block → deals), so
        // a marketer or the AI can compose a themed email without touching the
        // renderer. Counts clamp to the ranges enforced in newsletterAi.ts /
        // renderCampaignEmail.
        includeItineraries: v.optional(v.boolean()),   // /explore destination guides
        itineraryCount: v.optional(v.float64()),       // 1-3, default 2
        includeSights: v.optional(v.boolean()),        // top sights for the audience's country
        sightCount: v.optional(v.float64()),           // 1-5, default 3
        includeAttractions: v.optional(v.boolean()),   // bookable attractions (GetYourGuide etc.)
        attractionCount: v.optional(v.float64()),      // 1-4, default 3
        includePackages: v.optional(v.boolean()),      // partner OTA packages
        packageCount: v.optional(v.float64()),         // 1-3, default 2
        includeGuides: v.optional(v.boolean()),        // /guides SEO landing pages
        guideCount: v.optional(v.float64()),           // 1-3, default 2
        includeSpotlight: v.optional(v.boolean()),     // large "trip of the week" card (top itinerary)
        // Live-price route block: one flight route rendered as either a
        // "cheapest days to fly" calendar strip or a "flights from €X" teaser
        // card. The route is pinned at compose time (validated against live
        // deals for AI drafts); prices are fetched fresh at send time.
        routeBlock: v.optional(v.union(v.literal("calendar"), v.literal("teaser"))),
        routeOrigin: v.optional(v.string()),           // IATA, e.g. "ATH"
        routeDestination: v.optional(v.string()),      // IATA, e.g. "LIS"
        routeOriginCity: v.optional(v.string()),       // "Athens" — display only
        routeDestinationCity: v.optional(v.string()),  // "Lisbon" — display only
        routeCurrency: v.optional(v.string()),         // ISO 4217, default EUR
        // Dates the pinned route was chosen for, so its prices are re-fetched
        // around them instead of over the default next-fortnight window.
        routeOutboundDate: v.optional(v.string()),     // YYYY-MM-DD
        routeReturnDate: v.optional(v.string()),       // YYYY-MM-DD
        // Multi-route fare list: every route the campaign is about, rendered
        // as one card each with a live "from" price fetched at send time. This
        // is what an admin gets when they tick several routes in the generate
        // dialog — the single `routeBlock` above stays for the one-route case
        // (it also pins the destination focus for the content blocks, which a
        // multi-destination email deliberately has no single answer for).
        routes: v.optional(v.array(v.object({
            origin: v.string(),            // IATA
            destination: v.string(),       // IATA
            originCity: v.string(),        // display only
            destinationCity: v.string(),   // display only
            currency: v.optional(v.string()),
            // The dates the route was PICKED for (from the admin's flight
            // search). Prices are re-fetched around these, so an email about
            // October quotes October.
            outboundDate: v.optional(v.string()),  // YYYY-MM-DD
            returnDate: v.optional(v.string()),    // YYYY-MM-DD
        }))),
        // Affiliate banner to append: "tripcom" | "kiwi" | "welcome" | "lot" | "airserbia" (CJ creatives).
        bannerKey: v.optional(v.string()),
        // --- Targeting (opted-in subscribers only) ---
        languageFilter: v.optional(v.string()), // undefined = all languages
        sourceFilter: v.optional(v.string()),   // undefined = all sources ("web"|"app")
        countryFilter: v.optional(v.string()),  // undefined = all countries (ISO-2, lowercase)
        // --- Lifecycle ---
        // draft            — manually composed, send on demand
        // pending_approval — AI-generated, waiting for an admin decision
        // scheduled        — approved, waiting for its scheduled send time
        // rejected         — admin declined the AI draft (kept for the record)
        status: v.union(
            v.literal("draft"),
            v.literal("pending_approval"),
            v.literal("scheduled"),
            v.literal("sending"),
            v.literal("sent"),
            v.literal("failed"),
            v.literal("rejected"),
        ),
        targeted: v.optional(v.float64()), // recipients matched at send time
        sent: v.optional(v.float64()),        // accepted by Postmark
        failed: v.optional(v.float64()),      // rejected at send time (API error)
        // Skipped because the address is on the suppression list. Counted apart
        // from `failed`: nothing went wrong, we deliberately didn't send.
        suppressed: v.optional(v.float64()),
        // --- Post-send outcomes, updated asynchronously by the Postmark
        // webhook. `sent` is "handed to Postmark"; these are what actually
        // happened to the mail afterwards.
        delivered: v.optional(v.float64()),
        bounced: v.optional(v.float64()),
        complained: v.optional(v.float64()),
        opened: v.optional(v.float64()),      // unique recipients who opened
        clicked: v.optional(v.float64()),     // unique recipients who clicked
        createdBy: v.string(),             // admin userId, or "ai" for generated drafts
        createdAt: v.float64(),
        sentAt: v.optional(v.float64()),   // when the send completed
        // --- AI generation / scheduling ---
        scheduledAt: v.optional(v.float64()),   // when an approved campaign fires
        generatedByAi: v.optional(v.boolean()),
        aiModel: v.optional(v.string()),
        sendRationale: v.optional(v.string()),  // why the AI picked that send time
        // Content angle (e.g. "flight-deals", "ai-planning"). Rotated server-side
        // so consecutive AI emails to the same audience are never alike.
        theme: v.optional(v.string())
    })
        .index("by_status", ["status"])
        .index("by_createdAt", ["createdAt"]),

    // Idempotency ledger: one row per (campaign, subscriber) delivered. A
    // resumed / retried send batch skips subscribers that already have a row,
    // so nobody is emailed twice. Mirrors notificationBroadcastTaps.
    newsletterCampaignSends: defineTable({
        campaignId: v.id("newsletterCampaigns"),
        subscriberId: v.id("newsletterSubscribers"),
        sentAt: v.float64(),
        // Postmark MessageID. The join key for every webhook event that comes
        // back later — without it a bounce is just "some address bounced" and
        // can't be attributed to the campaign that caused it.
        messageId: v.optional(v.string()),
        email: v.optional(v.string()),        // denormalized for the admin table
        // Per-recipient lifecycle. Absent on rows written before this shipped,
        // which the readers treat as "sent".
        status: v.optional(v.union(
            v.literal("sent"),
            v.literal("delivered"),
            v.literal("bounced"),
            v.literal("complained"),
            v.literal("failed")
        )),
        deliveredAt: v.optional(v.float64()),
        bouncedAt: v.optional(v.float64()),
        complainedAt: v.optional(v.float64()),
        openedAt: v.optional(v.float64()),    // first open
        clickedAt: v.optional(v.float64()),   // first click
        openCount: v.optional(v.float64()),
        clickCount: v.optional(v.float64()),
        bounceType: v.optional(v.string()),
        error: v.optional(v.string()),        // send-time API error, truncated
    })
        .index("by_campaign", ["campaignId"])
        .index("by_campaign_subscriber", ["campaignId", "subscriberId"])
        // Webhook lookup: MessageID -> the send it belongs to.
        .index("by_message_id", ["messageId"]),

    // ---------------------------------------------------------------------
    // Email deliverability
    // ---------------------------------------------------------------------

    // The do-not-send list. One row per address that mail must not go to, for
    // ANY stream — marketing or transactional.
    //
    // This is our own copy, deliberately: Postmark keeps a per-message-stream
    // suppression list, but (a) it only stops the stream it belongs to, (b) we
    // are billed for and rate-limited by the attempt either way, and (c) a
    // "406 inactive recipient" rejection is invisible in our own numbers. A
    // local list means we never post a send we already know will fail, and the
    // reason survives where the admin dashboard can show it.
    //
    // Rows are kept after release (`active: false`) so a released address that
    // bounces again reads as a repeat offender rather than a first offence.
    emailSuppressions: defineTable({
        email: v.string(),                 // normalized: trimmed, lowercased
        reason: v.union(
            v.literal("hard_bounce"),      // mailbox does not exist
            v.literal("soft_bounce"),      // transient, but it kept happening
            v.literal("spam_complaint"),   // recipient pressed "report spam"
            v.literal("manual"),           // an admin suppressed it by hand
            v.literal("invalid"),          // Postmark rejected the address itself
            v.literal("unsubscribe")       // Postmark-side unsubscribe / manual list
        ),
        detail: v.optional(v.string()),    // provider description, truncated
        bounceType: v.optional(v.string()),// Postmark `Type` verbatim
        stream: v.optional(v.string()),    // message stream the event came from
        source: v.union(
            v.literal("webhook"),          // Postmark posted an event
            v.literal("send_error"),       // the send API rejected the address
            v.literal("sync"),             // pulled from Postmark's own dump
            v.literal("admin")             // suppressed from the dashboard
        ),
        // false once an admin releases the address; the row stays for history.
        active: v.boolean(),
        eventCount: v.float64(),           // how many times we've suppressed it
        createdAt: v.float64(),
        lastEventAt: v.float64(),
        releasedAt: v.optional(v.float64()),
        releasedBy: v.optional(v.string()),// admin userId
    })
        .index("by_email", ["email"])
        // Dashboard listing: newest suppressions still in force.
        .index("by_active_and_lastEventAt", ["active", "lastEventAt"])
        .index("by_reason_and_lastEventAt", ["reason", "lastEventAt"]),

    // Append-only event log behind every deliverability number we show.
    //
    // Aggregate counters (on the subscriber and the campaign) answer "how many";
    // this answers "which address, when, and why" — the only thing that makes a
    // sudden bounce spike diagnosable. Pruned by a cron (see crons.ts): opens
    // and clicks are high-volume and only interesting in aggregate after a few
    // weeks, while bounces and complaints are kept far longer.
    emailEvents: defineTable({
        email: v.string(),                 // normalized
        type: v.union(
            v.literal("sent"),
            v.literal("delivered"),
            v.literal("bounce"),
            v.literal("complaint"),
            v.literal("open"),
            v.literal("click"),
            v.literal("send_failed"),      // Postmark's API refused the send
            v.literal("suppressed"),       // we declined to send (local list)
            v.literal("subscription_change")
        ),
        messageId: v.optional(v.string()),
        stream: v.optional(v.string()),
        // Attribution, when the event can be tied back to something we sent.
        campaignId: v.optional(v.id("newsletterCampaigns")),
        subscriberId: v.optional(v.id("newsletterSubscribers")),
        // What kind of mail it was ("newsletter-campaign", "newsletter-drip",
        // "transactional", ...). Set from the Postmark Tag / send call site.
        tag: v.optional(v.string()),
        bounceType: v.optional(v.string()),
        // Postmark bounce TypeCode — stable across description wording changes.
        typeCode: v.optional(v.float64()),
        description: v.optional(v.string()),
        detail: v.optional(v.string()),
        link: v.optional(v.string()),      // click events
        platform: v.optional(v.string()),  // open/click client platform
        createdAt: v.float64(),
    })
        .index("by_email_and_createdAt", ["email", "createdAt"])
        .index("by_type_and_createdAt", ["type", "createdAt"])
        .index("by_campaign", ["campaignId"])
        .index("by_createdAt", ["createdAt"]),

    // Reservation Inbox — real bookings the user forwarded to their personal
    // inbound address, parsed into structured rows.
    //
    // These are deliberately NOT merged into `trips.itinerary`. That blob is
    // AI-generated *suggestions*: it gets regenerated, deduped (dedupeVenues)
    // and resequenced (resequenceDayTimes), any of which would silently destroy
    // a real €800 booking. Reservations are user-owned *facts* with a different
    // lifecycle, so they live here and are merged into the day view at render
    // time — pinned to their real times, with AI activities flowing around them.
    //
    // `tripId` is optional: an email can arrive before (or without) a matching
    // trip. Unmatched rows are not an error state — they are the highest-intent
    // trip-generation prompt the product has ("you're in Barcelona Mar 12–16,
    // want a plan around this hotel?").
    tripReservations: defineTable({
        userId: v.string(),
        tripId: v.optional(v.id("trips")),
        type: v.union(
            v.literal("flight"),
            v.literal("hotel"),
            v.literal("car"),
            v.literal("rail"),
            v.literal("ferry"),
            v.literal("activity"),
            v.literal("restaurant"),
            v.literal("other")
        ),
        title: v.string(),
        provider: v.optional(v.string()),          // "Aegean", "Booking.com"
        confirmationCode: v.optional(v.string()),  // PNR / booking reference
        // Absolute instants (ms). The parser resolves local times using the
        // offset in the email when present; when absent we keep the wall-clock
        // string in `details.rawStart` so the UI can show it un-shifted.
        startAt: v.optional(v.float64()),
        endAt: v.optional(v.float64()),
        location: v.optional(v.string()),          // address / airport pair / city
        // Where this booking is headed, as a name a human would type ("Rome").
        // Derived from the arrival end at parse time — `location` is the
        // DEPARTURE terminal for flights, so it cannot stand in for this.
        // Drives both trip matching and the "plan a trip here" prompt shown
        // when nothing matched. Absent when we could not derive one confidently.
        destinationHint: v.optional(v.string()),
        price: v.optional(v.float64()),
        currency: v.optional(v.string()),
        // Per-type extras: flight number, cabin, room type, guest count, rawStart…
        details: v.optional(v.any()),

        // ---- Provenance & trust ----
        source: v.union(v.literal("email"), v.literal("manual")),
        // DKIM/SPF passed on the inbound message. The From header is free text
        // and is never trusted on its own.
        senderVerified: v.optional(v.boolean()),
        sourceFrom: v.optional(v.string()),        // sender address (display only)
        sourceSubject: v.optional(v.string()),     // subject (display only)
        // Raw email bodies are intentionally NOT stored: confirmations carry
        // passport numbers, card last-4 and home addresses. We keep only the
        // extracted fields.
        parseConfidence: v.optional(v.float64()),  // 0..1 from the extractor
        parseModel: v.optional(v.string()),

        status: v.union(
            v.literal("needs_review"),  // parsed, awaiting user confirmation
            v.literal("confirmed"),     // user accepted; safe to render/monitor
            v.literal("rejected"),      // user dismissed (kept for dedupe)
            v.literal("cancelled")      // a later email cancelled this booking
        ),
        // Dedupe key so re-forwarding the same confirmation updates instead of
        // duplicating: hash(userId + type + confirmationCode|title + startAt).
        dedupeKey: v.optional(v.string()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
        reviewedAt: v.optional(v.float64()),
    })
        .index("by_user", ["userId"])
        .index("by_trip", ["tripId"])
        .index("by_user_status", ["userId", "status"])
        .index("by_dedupeKey", ["dedupeKey"]),

    // Trips handed off from the ChatGPT App (Apps SDK / MCP) to the web, so a
    // conversation can end with a real shareable link instead of a dead end.
    // Account-free by design: there is no user session in ChatGPT, so access is
    // controlled entirely by the unguessable `slug` (capability URL) rather
    // than by ownership. Nothing here is private-by-account — treat the slug as
    // the secret and never enumerate these rows on a public surface.
    //
    // `payload` is the already-rendered trip card (flights / hotels /
    // itinerary / budget) exactly as the MCP server assembled it. It is stored
    // denormalized on purpose: fares and nightly rates are point-in-time quotes
    // that must NOT silently re-price when the page is opened later, so the
    // page renders the snapshot and shows `capturedAt` alongside it.
    mcpSavedTrips: defineTable({
        slug: v.string(),                 // unguessable, URL-safe share id
        destination: v.string(),
        days: v.float64(),
        language: v.optional(v.string()), // locale the card was rendered in
        currency: v.optional(v.string()),
        payload: v.any(),                 // the structuredContent snapshot
        // Optional email capture — set only when the user explicitly asked to
        // be emailed the trip. Subscription itself still goes through the
        // double opt-in newsletter flow; this is just provenance.
        email: v.optional(v.string()),
        views: v.float64(),
        createdAt: v.float64(),
        lastViewedAt: v.optional(v.float64()),
        // Set by `update` when the trip is refined from the ChatGPT app. The
        // share page shows the fare snapshot's age off `createdAt`, so this is
        // deliberately a separate field rather than a bump of the original.
        updatedAt: v.optional(v.float64()),
        revision: v.optional(v.float64()),
    })
        .index("by_slug", ["slug"])
        .index("by_createdAt", ["createdAt"]),

    // One row per operator stats report email (see statsReports.ts + the
    // weekly/monthly crons). Two jobs: an audit trail of what was sent, and the
    // BASELINE the next report of the same period diffs against — the only way
    // to get a per-period number out of counters the source tables keep as
    // running totals (radar clicks, affiliate clicks, MRR). `metrics` holds the
    // whole computed payload ({ period, snapshot }) and is intentionally
    // untyped so the report can gain fields without a migration.
    statsReportRuns: defineTable({
        period: v.string(),            // "weekly" | "monthly"
        periodStart: v.float64(),      // window start (ms, inclusive)
        periodEnd: v.float64(),        // window end (ms, exclusive)
        sentAt: v.float64(),
        to: v.string(),
        emailSent: v.boolean(),        // false when Postmark rejected the send
        emailError: v.optional(v.string()),
        metrics: v.any(),
    })
        .index("by_period_sentAt", ["period", "sentAt"]),

    // Trackable short links handed out by the newsletter → social composer.
    //
    // A social card says "tap the link" and the admin pastes one URL into a bio
    // or a story sticker. Pasted raw, that click is invisible: the destination
    // is a public ISR page with no session, so nothing on our side ever learns
    // the post worked. These rows are the redirect in between — `/l/<code>`
    // counts the click and forwards to `targetUrl`.
    //
    // The code is stable per (campaign, slide, kind), so re-opening the
    // composer hands back the SAME link rather than splitting one post's stats
    // across two codes. `targetUrl` is refreshed on mint — an itinerary
    // published after the fact changes where the link goes without resetting
    // what it has earned.
    socialShareLinks: defineTable({
        code: v.string(),                  // URL-safe, unguessable path segment
        campaignId: v.id("newsletterCampaigns"),
        slideIndex: v.float64(),           // which card in the deck
        kind: v.union(v.literal("itinerary"), v.literal("flights")),
        route: v.string(),                 // "Athens → Lisbon", for the admin list
        targetUrl: v.string(),
        clicks: v.float64(),
        createdAt: v.float64(),
        lastClickAt: v.optional(v.float64()),
    })
        .index("by_code", ["code"])
        .index("by_campaign", ["campaignId"]),

    // One row per counted click, so the composer can say "12 today" and not
    // only "212 ever". Deliberately holds NO visitor data — no IP, no user
    // agent, no cookie: the question is how many taps a post earned, and
    // answering it does not require knowing who tapped.
    socialShareLinkClicks: defineTable({
        code: v.string(),
        at: v.float64(),
        referrerHost: v.optional(v.string()),  // "instagram.com", when sent
    })
        .index("by_code_at", ["code", "at"]),

    // ── Planera for Travel Agencies (agency portal) — additive tenant tables ──
    ...agencyTables,
});

