"use node";

/**
 * Booking Draft Actions
 * Handles the flight booking flow: Offer → Extras → Review → Payment → Booking
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getOffer, extractFlightDetails } from "./flights/duffel";
import {
  getOfferWithExtras,
  getSeatMaps,
  createOrderWithServices,
  formatConditionsForDisplay,
} from "./flights/duffelExtras";

// ============================================================================
// Create a new booking draft after offer selection
// ============================================================================
export const createDraft = action({
  args: {
    tripId: v.id("trips"),
    offerId: v.string(),
    travelers: v.array(v.object({
      id: v.id("travelers"),
      firstName: v.string(),
      lastName: v.string(),
      dateOfBirth: v.string(),
      gender: v.union(v.literal("male"), v.literal("female")),
      email: v.optional(v.string()),
      phoneCountryCode: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      passportNumber: v.optional(v.string()),
      passportIssuingCountry: v.optional(v.string()),
      passportExpiryDate: v.optional(v.string()),
    })),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      draftId: v.id("flightBookingDrafts"),
      offerDetails: v.object({
        pricePerPerson: v.number(),
        totalPrice: v.number(),
        currency: v.string(),
        expiresAt: v.optional(v.string()),
        conditions: v.object({
          canChange: v.boolean(),
          canRefund: v.boolean(),
          changePolicy: v.string(),
          refundPolicy: v.string(),
        }),
        includedBaggage: v.array(v.object({
          segmentId: v.string(),
          passengerId: v.string(),
          cabinQuantity: v.number(),
          checkedQuantity: v.number(),
          checkedWeight: v.optional(v.string()),
        })),
        availableBags: v.array(v.object({
          id: v.string(),
          passengerId: v.string(),
          type: v.string(),
          maxQuantity: v.number(),
          priceDisplay: v.string(),
          weight: v.optional(v.string()),
        })),
        seatSelectionAvailable: v.boolean(),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<
    | {
        success: true;
        draftId: Id<"flightBookingDrafts">;
        offerDetails: {
          pricePerPerson: number;
          totalPrice: number;
          currency: string;
          expiresAt?: string;
          conditions: {
            canChange: boolean;
            canRefund: boolean;
            changePolicy: string;
            refundPolicy: string;
          };
          includedBaggage: Array<{
            segmentId: string;
            passengerId: string;
            cabinQuantity: number;
            checkedQuantity: number;
            checkedWeight?: string;
          }>;
          availableBags: Array<{
            id: string;
            passengerId: string;
            type: string;
            maxQuantity: number;
            priceDisplay: string;
            weight?: string;
          }>;
          seatSelectionAvailable: boolean;
        };
      }
    | { success: false; error: string }
  > => {
    try {
      console.log(`📝 Creating booking draft for offer ${args.offerId}...`);

      // Fetch the offer with extras info
      const offerExtras = await getOfferWithExtras(args.offerId);
      if (!offerExtras) {
        return {
          success: false as const,
          error: "Flight offer not found or has expired. Please search for new flights.",
        };
      }

      // Get the base offer for pricing
      const offer = await getOffer(args.offerId);
      if (!offer) {
        return {
          success: false as const,
          error: "Flight offer not found or has expired.",
        };
      }

      const totalAmount = parseFloat(offer.total_amount || "0");
      const numPassengers = offer.passengers?.length || 1;
      const basePriceCents = Math.round(totalAmount * 100);

      // Map travelers to passengers with Duffel passenger IDs
      const offerPassengers = offer.passengers || [];
      const passengers = args.travelers.map((traveler, index) => {
        const offerPassenger = offerPassengers[index];
        // Determine passenger type based on age
        const birthDate = new Date(traveler.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        let type: "adult" | "child" | "infant" = "adult";
        if (age < 2) type = "infant";
        else if (age < 12) type = "child";

        return {
          passengerId: offerPassenger?.id || `pas_${index}`,
          travelerId: traveler.id,
          type,
          givenName: traveler.firstName,
          familyName: traveler.lastName,
          dateOfBirth: traveler.dateOfBirth,
          gender: traveler.gender,
          title: (traveler.gender === "male" ? "mr" : "ms") as "mr" | "ms" | "mrs" | "miss" | "dr",
          email: traveler.email,
          phoneCountryCode: traveler.phoneCountryCode,
          phoneNumber: traveler.phoneNumber,
          passportNumber: traveler.passportNumber,
          passportIssuingCountry: traveler.passportIssuingCountry,
          passportExpiryDate: traveler.passportExpiryDate,
        };
      });

      // Format conditions for display
      const formattedConditions = formatConditionsForDisplay(offerExtras.conditions);

      // Format included baggage for display
      const includedBaggage = offerExtras.includedBaggage.map(bag => ({
        segmentId: bag.segmentId,
        passengerId: bag.passengerId,
        cabinQuantity: bag.cabin?.quantity || 0,
        checkedQuantity: bag.checked?.quantity || 0,
        checkedWeight: bag.checked?.weight
          ? `${bag.checked.weight.amount}${bag.checked.weight.unit}`
          : undefined,
      }));

      // Format available bags for display
      const availableBags = offerExtras.availableBaggageServices.map(bag => ({
        id: bag.id,
        passengerId: bag.passengerId,
        type: bag.type,
        maxQuantity: bag.maxQuantity,
        priceDisplay: `${bag.currency} ${(bag.priceCents / 100).toFixed(2)}`,
        weight: bag.weight ? `${bag.weight.amount}${bag.weight.unit}` : undefined,
      }));

      // Convert included baggage to storage format
      const storedIncludedBaggage = offerExtras.includedBaggage.map(bag => ({
        segmentId: bag.segmentId,
        passengerId: bag.passengerId,
        cabin: bag.cabin ? {
          quantity: BigInt(bag.cabin.quantity),
          type: bag.cabin.type,
        } : undefined,
        checked: bag.checked ? {
          quantity: BigInt(bag.checked.quantity),
          weight: bag.checked.weight,
        } : undefined,
      }));

      // Convert available services to storage format
      const storedAvailableServices = {
        bags: offerExtras.availableBaggageServices.map(bag => ({
          id: bag.id,
          passengerId: bag.passengerId,
          segmentIds: bag.segmentIds,
          type: bag.type,
          maxQuantity: BigInt(bag.maxQuantity),
          priceCents: BigInt(bag.priceCents),
          currency: bag.currency,
          weight: bag.weight,
        })),
        seatsAvailable: offerExtras.seatMapsAvailable,
      };

      // Create the draft in the database
      const draftId: Id<"flightBookingDrafts"> = await ctx.runMutation(internal.bookingDraftMutations.createDraft, {
        tripId: args.tripId,
        offerId: args.offerId,
        offerExpiresAt: offer.expires_at,
        basePriceCents: BigInt(basePriceCents),
        currency: offer.total_currency || "EUR",
        passengers,
        conditions: offerExtras.conditions.changeBeforeDeparture || offerExtras.conditions.refundBeforeDeparture ? {
          changeBeforeDeparture: offerExtras.conditions.changeBeforeDeparture ? {
            allowed: offerExtras.conditions.changeBeforeDeparture.allowed,
            penaltyAmount: offerExtras.conditions.changeBeforeDeparture.penaltyAmount,
            penaltyCurrency: offerExtras.conditions.changeBeforeDeparture.penaltyCurrency,
          } : undefined,
          refundBeforeDeparture: offerExtras.conditions.refundBeforeDeparture ? {
            allowed: offerExtras.conditions.refundBeforeDeparture.allowed,
            penaltyAmount: offerExtras.conditions.refundBeforeDeparture.penaltyAmount,
            penaltyCurrency: offerExtras.conditions.refundBeforeDeparture.penaltyCurrency,
          } : undefined,
        } : undefined,
        includedBaggage: storedIncludedBaggage,
        availableServices: storedAvailableServices,
        totalPriceCents: BigInt(basePriceCents),
      });

      return {
        success: true as const,
        draftId,
        offerDetails: {
          pricePerPerson: Math.round(totalAmount / numPassengers),
          totalPrice: totalAmount,
          currency: offer.total_currency || "EUR",
          expiresAt: offer.expires_at,
          conditions: formattedConditions,
          includedBaggage,
          availableBags,
          seatSelectionAvailable: offerExtras.seatMapsAvailable,
        },
      };
    } catch (error) {
      console.error("Create draft error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to create booking draft",
      };
    }
  },
});

// ============================================================================
// Get seat maps for the offer
// ============================================================================
export const fetchSeatMaps = action({
  args: {
    offerId: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      seatMaps: v.array(v.object({
        segmentId: v.string(),
        sliceId: v.string(),
        cabins: v.array(v.object({
          cabinClass: v.string(),
          deck: v.number(),
          rows: v.array(v.object({
            sections: v.array(v.object({
              elements: v.array(v.object({
                type: v.string(),
                designator: v.optional(v.string()),
                name: v.optional(v.string()),
                disclosures: v.optional(v.array(v.string())),
                availableServices: v.optional(v.array(v.object({
                  id: v.string(),
                  passengerId: v.string(),
                  priceDisplay: v.string(),
                }))),
              })),
            })),
          })),
          wings: v.optional(v.object({
            firstRowIndex: v.number(),
            lastRowIndex: v.number(),
          })),
        })),
      })),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const seatMaps = await getSeatMaps(args.offerId);

      if (!seatMaps || seatMaps.length === 0) {
        return {
          success: false as const,
          error: "Seat selection is not available for this flight.",
        };
      }

      // Transform seat maps for the frontend
      const transformedMaps = seatMaps.map(seatMap => ({
        segmentId: seatMap.segmentId,
        sliceId: seatMap.sliceId,
        cabins: seatMap.cabins.map(cabin => ({
          cabinClass: cabin.cabinClass,
          deck: cabin.deck,
          rows: cabin.rows.map(row => ({
            sections: row.sections.map(section => ({
              elements: section.elements.map(element => ({
                type: element.type,
                designator: element.designator,
                name: element.name,
                disclosures: element.disclosures,
                availableServices: element.availableServices?.map(service => ({
                  id: service.id,
                  passengerId: service.passengerId,
                  priceDisplay: `${service.currency} ${(service.priceCents / 100).toFixed(2)}`,
                })),
              })),
            })),
          })),
          wings: cabin.wings,
        })),
      }));

      return {
        success: true as const,
        seatMaps: transformedMaps,
      };
    } catch (error) {
      console.error("Fetch seat maps error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to fetch seat maps",
      };
    }
  },
});

// ============================================================================
// Complete the booking with selected extras
// ============================================================================
export const completeBooking = action({
  args: {
    draftId: v.id("flightBookingDrafts"),
    paymentIntentId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      orderId: v.string(),
      bookingReference: v.string(),
      totalAmount: v.number(),
      currency: v.string(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      // Get the draft
      const draft = await ctx.runQuery(internal.bookingDraftMutations.getDraft, {
        draftId: args.draftId,
      });

      if (!draft) {
        return {
          success: false as const,
          error: "Booking draft not found or has expired.",
        };
      }

      // Check if policy has been acknowledged
      if (!draft.policyAcknowledged) {
        return {
          success: false as const,
          error: "Please acknowledge the booking policy before proceeding.",
        };
      }

      // Collect all selected service IDs
      const selectedServices: string[] = [];

      // Add bag service IDs
      if (draft.selectedBags) {
        for (const bag of draft.selectedBags) {
          for (let i = 0; i < Number(bag.quantity); i++) {
            selectedServices.push(bag.serviceId);
          }
        }
      }

      // Add seat service IDs
      if (draft.selectedSeats) {
        for (const seat of draft.selectedSeats) {
          selectedServices.push(seat.serviceId);
        }
      }

      // Transform passengers to Duffel format
      const duffelPassengers = draft.passengers.map(p => ({
        id: p.passengerId,
        given_name: p.givenName,
        family_name: p.familyName,
        born_on: p.dateOfBirth,
        gender: (p.gender === "male" ? "m" : "f") as "m" | "f",
        email: p.email || "",
        phone_number: p.phoneCountryCode && p.phoneNumber
          ? `${p.phoneCountryCode}${p.phoneNumber.replace(/\D/g, "")}`
          : "",
        title: p.title,
        passport_number: p.passportNumber,
        passport_issuing_country: p.passportIssuingCountry,
        passport_expiry_date: p.passportExpiryDate,
      }));

      console.log(`🛫 Completing booking for draft ${args.draftId}...`);
      console.log(`   - Passengers: ${duffelPassengers.length}`);
      console.log(`   - Selected services: ${selectedServices.length}`);

      // Create the order with Duffel
      const order = await createOrderWithServices({
        offerId: draft.offerId,
        passengers: duffelPassengers,
        selectedServices: selectedServices.length > 0 ? selectedServices : undefined,
        paymentIntentId: args.paymentIntentId,
        metadata: {
          tripId: draft.tripId,
          draftId: args.draftId,
          source: "planera",
        },
      });

      // Get the offer for flight details
      const offer = await getOffer(draft.offerId);
      const flightDetails = offer ? extractFlightDetails(offer) : null;

      // Build policies from draft conditions
      const policies = draft.conditions ? {
        canChange: draft.conditions.changeBeforeDeparture?.allowed ?? false,
        canRefund: draft.conditions.refundBeforeDeparture?.allowed ?? false,
        changePolicy: draft.conditions.changeBeforeDeparture?.allowed 
          ? (draft.conditions.changeBeforeDeparture.penaltyAmount 
            ? `Changes allowed with ${draft.conditions.changeBeforeDeparture.penaltyCurrency || ''} ${draft.conditions.changeBeforeDeparture.penaltyAmount} fee`
            : "Changes allowed for free")
          : "Changes not allowed",
        refundPolicy: draft.conditions.refundBeforeDeparture?.allowed
          ? (draft.conditions.refundBeforeDeparture.penaltyAmount
            ? `Refunds allowed with ${draft.conditions.refundBeforeDeparture.penaltyCurrency || ''} ${draft.conditions.refundBeforeDeparture.penaltyAmount} fee`
            : "Full refund available")
          : "Non-refundable",
        changePenaltyAmount: draft.conditions.changeBeforeDeparture?.penaltyAmount,
        changePenaltyCurrency: draft.conditions.changeBeforeDeparture?.penaltyCurrency,
        refundPenaltyAmount: draft.conditions.refundBeforeDeparture?.penaltyAmount,
        refundPenaltyCurrency: draft.conditions.refundBeforeDeparture?.penaltyCurrency,
      } : undefined;

      // Build included baggage summary
      const includedBaggage = draft.includedBaggage?.map(bag => {
        const passenger = draft.passengers.find(p => p.passengerId === bag.passengerId);
        return {
          passengerId: bag.passengerId,
          passengerName: passenger ? `${passenger.givenName} ${passenger.familyName}` : undefined,
          cabinBags: bag.cabin?.quantity ? BigInt(bag.cabin.quantity) : undefined,
          checkedBags: bag.checked?.quantity ? BigInt(bag.checked.quantity) : undefined,
          checkedBagWeight: bag.checked?.weight,
        };
      });

      // Build paid baggage summary
      const paidBaggage = draft.selectedBags?.map(bag => {
        const passenger = draft.passengers.find(p => p.passengerId === bag.passengerId);
        return {
          passengerId: bag.passengerId,
          passengerName: passenger ? `${passenger.givenName} ${passenger.familyName}` : undefined,
          type: bag.type,
          quantity: BigInt(bag.quantity),
          priceCents: BigInt(bag.priceCents),
          currency: bag.currency,
          weight: bag.weight,
        };
      });

      // Build seat selections summary
      const seatSelections = draft.selectedSeats?.map(seat => {
        const passenger = draft.passengers.find(p => p.passengerId === seat.passengerId);
        return {
          passengerId: seat.passengerId,
          passengerName: passenger ? `${passenger.givenName} ${passenger.familyName}` : undefined,
          segmentId: seat.segmentId,
          flightNumber: undefined, // Could be extracted from offer if needed
          seatDesignator: seat.seatDesignator,
          priceCents: BigInt(seat.priceCents),
          currency: seat.currency,
        };
      });

      // Parse departure date for timestamp
      let departureTimestamp: number | undefined;
      if (flightDetails?.outbound?.departureDate) {
        const [year, month, day] = flightDetails.outbound.departureDate.split("-").map(Number);
        departureTimestamp = new Date(year, month - 1, day).getTime();
      }

      // Save the completed booking with all details
      const bookingId = await ctx.runMutation(internal.flightBookingMutations.saveBooking, {
        tripId: draft.tripId,
        duffelOrderId: order.id,
        bookingReference: order.bookingReference,
        paymentIntentId: args.paymentIntentId,
        totalAmount: order.totalAmount,
        currency: order.currency,
        basePriceCents: draft.basePriceCents,
        extrasTotalCents: draft.extrasTotalCents,
        outboundFlight: flightDetails?.outbound || {
          airline: "Unknown",
          flightNumber: "",
          departure: "",
          arrival: "",
          departureDate: "",
          origin: "",
          destination: "",
        },
        returnFlight: flightDetails?.return,
        passengers: draft.passengers.map(p => ({
          givenName: p.givenName,
          familyName: p.familyName,
          email: p.email || "",
          type: p.type,
          dateOfBirth: p.dateOfBirth,
        })),
        policies,
        includedBaggage,
        paidBaggage,
        seatSelections,
        status: "confirmed",
        departureTimestamp,
      });

      // Send confirmation email (fire-and-forget, don't block the booking)
      console.log(`📧 Triggering confirmation email for booking ${bookingId}...`);
      try {
        const emailResult = await ctx.runAction(internal.emails.sendFlightConfirmationEmail, {
          bookingId,
        });
        console.log(`📧 Email result:`, JSON.stringify(emailResult));
      } catch (emailError) {
        // Log but don't fail the booking if email fails
        console.error("❌ Failed to send confirmation email:", emailError);
      }

      // Update draft status
      await ctx.runMutation(internal.bookingDraftMutations.updateDraftStatus, {
        draftId: args.draftId,
        status: "completed",
      });

      console.log(`✅ Booking completed: ${order.bookingReference}`);

      return {
        success: true as const,
        orderId: order.id,
        bookingReference: order.bookingReference || "PENDING",
        totalAmount: order.totalAmount,
        currency: order.currency,
      };
    } catch (error) {
      console.error("Complete booking error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to complete booking",
      };
    }
  },
});
