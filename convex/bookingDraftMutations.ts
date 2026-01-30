/**
 * Booking Draft Mutations
 * Internal mutations for managing flight booking drafts
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

// ============================================================================
// Internal: Create a new booking draft
// ============================================================================
export const createDraft = internalMutation({
  args: {
    tripId: v.id("trips"),
    offerId: v.string(),
    offerExpiresAt: v.optional(v.string()),
    basePriceCents: v.int64(),
    currency: v.string(),
    passengers: v.array(v.object({
      passengerId: v.string(),
      travelerId: v.optional(v.id("travelers")),
      type: v.union(v.literal("adult"), v.literal("child"), v.literal("infant")),
      givenName: v.string(),
      familyName: v.string(),
      dateOfBirth: v.string(),
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
    totalPriceCents: v.int64(),
  },
  returns: v.id("flightBookingDrafts"),
  handler: async (ctx, args) => {
    // Get the trip to find the userId
    const trip = await ctx.db.get(args.tripId);
    if (!trip) {
      throw new Error("Trip not found");
    }

    const now = Date.now();
    // Set expiry to match offer expiry or 30 minutes from now
    const expiresAt = args.offerExpiresAt
      ? new Date(args.offerExpiresAt).getTime()
      : now + 30 * 60 * 1000;

    const draftId = await ctx.db.insert("flightBookingDrafts", {
      userId: trip.userId,
      tripId: args.tripId,
      offerId: args.offerId,
      offerExpiresAt: args.offerExpiresAt,
      basePriceCents: args.basePriceCents,
      currency: args.currency,
      passengers: args.passengers,
      conditions: args.conditions,
      includedBaggage: args.includedBaggage,
      availableServices: args.availableServices,
      policyAcknowledged: false,
      totalPriceCents: args.totalPriceCents,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return draftId;
  },
});

// ============================================================================
// Internal: Get a booking draft
// ============================================================================
export const getDraft = internalQuery({
  args: {
    draftId: v.id("flightBookingDrafts"),
  },
  returns: v.union(
    v.object({
      _id: v.id("flightBookingDrafts"),
      userId: v.string(),
      tripId: v.id("trips"),
      offerId: v.string(),
      offerExpiresAt: v.optional(v.string()),
      basePriceCents: v.int64(),
      currency: v.string(),
      passengers: v.array(v.object({
        passengerId: v.string(),
        travelerId: v.optional(v.id("travelers")),
        type: v.union(v.literal("adult"), v.literal("child"), v.literal("infant")),
        givenName: v.string(),
        familyName: v.string(),
        dateOfBirth: v.string(),
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
      selectedBags: v.optional(v.array(v.object({
        passengerId: v.string(),
        segmentId: v.string(),
        serviceId: v.string(),
        quantity: v.int64(),
        priceCents: v.int64(),
        currency: v.string(),
        type: v.string(),
        weight: v.optional(v.object({
          amount: v.float64(),
          unit: v.string(),
        })),
      }))),
      selectedSeats: v.optional(v.array(v.object({
        passengerId: v.string(),
        segmentId: v.string(),
        serviceId: v.string(),
        seatDesignator: v.string(),
        priceCents: v.int64(),
        currency: v.string(),
      }))),
      policyAcknowledged: v.boolean(),
      policyAcknowledgedAt: v.optional(v.float64()),
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
      extrasTotalCents: v.optional(v.int64()),
      totalPriceCents: v.int64(),
      status: v.string(),
      createdAt: v.float64(),
      updatedAt: v.float64(),
      expiresAt: v.optional(v.float64()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;

    // Check if expired
    if (draft.expiresAt && Date.now() > draft.expiresAt) {
      return null;
    }

    return draft;
  },
});

// ============================================================================
// Internal: Update draft status
// ============================================================================
export const updateDraftStatus = internalMutation({
  args: {
    draftId: v.id("flightBookingDrafts"),
    status: v.union(
      v.literal("draft"),
      v.literal("extras_selected"),
      v.literal("ready_for_payment"),
      v.literal("completed"),
      v.literal("expired")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ============================================================================
// Public: Get booking draft for display
// ============================================================================
export const getBookingDraft = query({
  args: {
    draftId: v.id("flightBookingDrafts"),
  },
  returns: v.union(
    v.object({
      _id: v.id("flightBookingDrafts"),
      tripId: v.id("trips"),
      offerId: v.string(),
      currency: v.string(),
      basePriceDisplay: v.string(),
      extrasTotalDisplay: v.string(),
      totalPriceDisplay: v.string(),
      passengers: v.array(v.object({
        passengerId: v.string(),
        name: v.string(),
        type: v.string(),
      })),
      selectedBags: v.array(v.object({
        passengerId: v.string(),
        type: v.string(),
        quantity: v.number(),
        priceDisplay: v.string(),
      })),
      selectedSeats: v.array(v.object({
        passengerId: v.string(),
        seatDesignator: v.string(),
        priceDisplay: v.string(),
      })),
      // Included baggage info
      includedBaggage: v.array(v.object({
        passengerId: v.string(),
        cabinBags: v.number(),
        checkedBags: v.number(),
        checkedWeight: v.optional(v.string()),
      })),
      // Available bags for purchase
      availableBags: v.array(v.object({
        id: v.string(),
        passengerId: v.string(),
        type: v.string(),
        maxQuantity: v.number(),
        priceDisplay: v.string(),
        weight: v.optional(v.string()),
      })),
      seatsAvailable: v.boolean(),
      policyAcknowledged: v.boolean(),
      canChange: v.boolean(),
      canRefund: v.boolean(),
      changePolicy: v.string(),
      refundPolicy: v.string(),
      status: v.string(),
      expiresIn: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;

    // Check if expired
    if (draft.expiresAt && Date.now() > draft.expiresAt) {
      return null;
    }

    const formatPrice = (cents: bigint | number, currency: string) =>
      `${currency} ${(Number(cents) / 100).toFixed(2)}`;

    // Calculate extras total
    let extrasTotalCents = 0n;
    if (draft.selectedBags) {
      for (const bag of draft.selectedBags) {
        extrasTotalCents += bag.priceCents * bag.quantity;
      }
    }
    if (draft.selectedSeats) {
      for (const seat of draft.selectedSeats) {
        extrasTotalCents += seat.priceCents;
      }
    }

    // Format conditions
    const canChange = draft.conditions?.changeBeforeDeparture?.allowed ?? false;
    const canRefund = draft.conditions?.refundBeforeDeparture?.allowed ?? false;

    let changePolicy = "Changes not allowed";
    if (canChange) {
      const penalty = draft.conditions?.changeBeforeDeparture;
      if (penalty?.penaltyAmount) {
        changePolicy = `Changes allowed with ${penalty.penaltyCurrency || "EUR"} ${penalty.penaltyAmount} fee`;
      } else {
        changePolicy = "Free changes allowed";
      }
    }

    let refundPolicy = "Non-refundable";
    if (canRefund) {
      const penalty = draft.conditions?.refundBeforeDeparture;
      if (penalty?.penaltyAmount) {
        refundPolicy = `Refundable with ${penalty.penaltyCurrency || "EUR"} ${penalty.penaltyAmount} fee`;
      } else {
        refundPolicy = "Fully refundable";
      }
    }

    // Calculate time until expiry
    const expiresIn = draft.expiresAt
      ? Math.max(0, Math.floor((draft.expiresAt - Date.now()) / 1000 / 60))
      : undefined;

    // Format included baggage per passenger
    const includedBaggageMap = new Map<string, { cabinBags: number; checkedBags: number; checkedWeight?: string }>();
    if (draft.includedBaggage) {
      for (const bag of draft.includedBaggage) {
        const existing = includedBaggageMap.get(bag.passengerId) || { cabinBags: 0, checkedBags: 0 };
        if (bag.cabin) {
          existing.cabinBags += Number(bag.cabin.quantity);
        }
        if (bag.checked) {
          existing.checkedBags += Number(bag.checked.quantity);
          if (bag.checked.weight) {
            existing.checkedWeight = `${bag.checked.weight.amount}${bag.checked.weight.unit}`;
          }
        }
        includedBaggageMap.set(bag.passengerId, existing);
      }
    }

    const includedBaggage = draft.passengers.map(p => {
      const bagInfo = includedBaggageMap.get(p.passengerId) || { cabinBags: 0, checkedBags: 0 };
      return {
        passengerId: p.passengerId,
        cabinBags: bagInfo.cabinBags,
        checkedBags: bagInfo.checkedBags,
        checkedWeight: bagInfo.checkedWeight,
      };
    });

    // Format available bags for purchase
    const availableBags = (draft.availableServices?.bags || []).map(bag => ({
      id: bag.id,
      passengerId: bag.passengerId,
      type: bag.type,
      maxQuantity: Number(bag.maxQuantity),
      priceDisplay: formatPrice(bag.priceCents, bag.currency),
      weight: bag.weight ? `${bag.weight.amount}${bag.weight.unit}` : undefined,
    }));

    return {
      _id: draft._id,
      tripId: draft.tripId,
      offerId: draft.offerId,
      currency: draft.currency,
      basePriceDisplay: formatPrice(draft.basePriceCents, draft.currency),
      extrasTotalDisplay: formatPrice(extrasTotalCents, draft.currency),
      totalPriceDisplay: formatPrice(draft.basePriceCents + extrasTotalCents, draft.currency),
      passengers: draft.passengers.map(p => ({
        passengerId: p.passengerId,
        name: `${p.givenName} ${p.familyName}`,
        type: p.type,
      })),
      selectedBags: (draft.selectedBags || []).map(b => ({
        passengerId: b.passengerId,
        type: b.type,
        quantity: Number(b.quantity),
        priceDisplay: formatPrice(b.priceCents * b.quantity, b.currency),
      })),
      selectedSeats: (draft.selectedSeats || []).map(s => ({
        passengerId: s.passengerId,
        seatDesignator: s.seatDesignator,
        priceDisplay: formatPrice(s.priceCents, s.currency),
      })),
      includedBaggage,
      availableBags,
      seatsAvailable: draft.availableServices?.seatsAvailable ?? false,
      policyAcknowledged: draft.policyAcknowledged,
      canChange,
      canRefund,
      changePolicy,
      refundPolicy,
      status: draft.status,
      expiresIn,
    };
  },
});

// ============================================================================
// Public: Update baggage selections
// ============================================================================
export const updateBaggageSelections = mutation({
  args: {
    draftId: v.id("flightBookingDrafts"),
    selectedBags: v.array(v.object({
      passengerId: v.string(),
      segmentId: v.string(),
      serviceId: v.string(),
      quantity: v.int64(),
      priceCents: v.int64(),
      currency: v.string(),
      type: v.string(),
      weight: v.optional(v.object({
        amount: v.float64(),
        unit: v.string(),
      })),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    // Calculate new extras total
    let extrasTotalCents = 0n;
    for (const bag of args.selectedBags) {
      extrasTotalCents += bag.priceCents * bag.quantity;
    }
    if (draft.selectedSeats) {
      for (const seat of draft.selectedSeats) {
        extrasTotalCents += seat.priceCents;
      }
    }

    await ctx.db.patch(args.draftId, {
      selectedBags: args.selectedBags,
      extrasTotalCents,
      totalPriceCents: draft.basePriceCents + extrasTotalCents,
      status: "extras_selected",
      updatedAt: Date.now(),
    });

    return null;
  },
});

// ============================================================================
// Public: Update seat selections
// ============================================================================
export const updateSeatSelections = mutation({
  args: {
    draftId: v.id("flightBookingDrafts"),
    selectedSeats: v.array(v.object({
      passengerId: v.string(),
      segmentId: v.string(),
      serviceId: v.string(),
      seatDesignator: v.string(),
      priceCents: v.int64(),
      currency: v.string(),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    // Validate: each passenger can only have one seat per segment
    const seatMap = new Map<string, string>();
    for (const seat of args.selectedSeats) {
      const key = `${seat.passengerId}-${seat.segmentId}`;
      if (seatMap.has(key)) {
        throw new Error(`Passenger already has a seat selected for this segment`);
      }
      seatMap.set(key, seat.seatDesignator);
    }

    // Calculate new extras total
    let extrasTotalCents = 0n;
    if (draft.selectedBags) {
      for (const bag of draft.selectedBags) {
        extrasTotalCents += bag.priceCents * bag.quantity;
      }
    }
    for (const seat of args.selectedSeats) {
      extrasTotalCents += seat.priceCents;
    }

    await ctx.db.patch(args.draftId, {
      selectedSeats: args.selectedSeats,
      extrasTotalCents,
      totalPriceCents: draft.basePriceCents + extrasTotalCents,
      status: "extras_selected",
      updatedAt: Date.now(),
    });

    return null;
  },
});

// ============================================================================
// Public: Acknowledge policy
// ============================================================================
export const acknowledgePolicy = mutation({
  args: {
    draftId: v.id("flightBookingDrafts"),
    acknowledged: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, {
      policyAcknowledged: args.acknowledged,
      policyAcknowledgedAt: args.acknowledged ? Date.now() : undefined,
      status: args.acknowledged ? "ready_for_payment" : "extras_selected",
      updatedAt: Date.now(),
    });

    return null;
  },
});

// ============================================================================
// Public: Get draft for a trip
// ============================================================================
export const getDraftForTrip = query({
  args: {
    tripId: v.id("trips"),
  },
  returns: v.union(v.id("flightBookingDrafts"), v.null()),
  handler: async (ctx, args) => {
    const drafts = await ctx.db
      .query("flightBookingDrafts")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .order("desc")
      .collect();

    // Find the first non-completed, non-expired draft
    for (const draft of drafts) {
      if (draft.status === "completed" || draft.status === "expired") {
        continue;
      }
      // Check if expired
      if (draft.expiresAt && Date.now() > draft.expiresAt) {
        continue;
      }
      return draft._id;
    }

    return null;
  },
});
