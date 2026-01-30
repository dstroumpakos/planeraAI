/**
 * Email Helper Functions
 * Internal queries and mutations for the email system
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get booking details for email generation
 */
export const getBookingForEmail = internalQuery({
  args: {
    bookingId: v.id("flightBookings"),
  },
  returns: v.union(
    v.object({
      _id: v.id("flightBookings"),
      bookingReference: v.optional(v.string()),
      totalAmount: v.float64(),
      currency: v.string(),
      confirmationEmailSentAt: v.optional(v.float64()),
      outboundFlight: v.object({
        airline: v.string(),
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
      }),
      returnFlight: v.optional(v.object({
        airline: v.string(),
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
      })),
      passengers: v.array(v.object({
        givenName: v.string(),
        familyName: v.string(),
        email: v.string(),
        type: v.optional(v.union(v.literal("adult"), v.literal("child"), v.literal("infant"))),
        dateOfBirth: v.optional(v.string()),
      })),
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
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) {
      return null;
    }

    return {
      _id: booking._id,
      bookingReference: booking.bookingReference,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      confirmationEmailSentAt: booking.confirmationEmailSentAt,
      outboundFlight: booking.outboundFlight,
      returnFlight: booking.returnFlight,
      passengers: booking.passengers,
      policies: booking.policies,
      includedBaggage: booking.includedBaggage,
    };
  },
});

/**
 * Mark confirmation email as sent (for idempotency)
 */
export const markConfirmationEmailSent = internalMutation({
  args: {
    bookingId: v.id("flightBookings"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, {
      confirmationEmailSentAt: Date.now(),
    });
    return null;
  },
});
