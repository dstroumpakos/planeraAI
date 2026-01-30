"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { getOffer, createPaymentIntent, createOrder, extractFlightDetails } from "./flights/duffel";
import { Id } from "./_generated/dataModel";

// Create typed function reference for booking links to avoid circular reference
const createBookingLinkRef = makeFunctionReference<
  "mutation",
  { bookingId: Id<"flightBookings">; expiresInDays?: number },
  { token: string; expiresAt: number }
>("bookingLinks:createBookingLink");

// Get flight offer details to verify it's still valid
export const getFlightOffer = action({
  args: {
    offerId: v.string(),
  },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      offer: v.any(),
      pricePerPerson: v.number(),
      totalPrice: v.number(),
      currency: v.string(),
      expiresAt: v.optional(v.string()),
    }),
    v.object({
      valid: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const offer = await getOffer(args.offerId);
      
      if (!offer) {
        return {
          valid: false as const,
          error: "Flight offer not found or has expired. Please search for new flights.",
        };
      }

      const totalAmount = parseFloat(offer.total_amount || "0");
      const numPassengers = offer.passengers?.length || 1;

      return {
        valid: true as const,
        offer,
        pricePerPerson: Math.round(totalAmount / numPassengers),
        totalPrice: Math.round(totalAmount * 100) / 100,
        currency: offer.total_currency || "EUR",
        expiresAt: offer.expires_at,
      };
    } catch (error) {
      console.error("Get offer error:", error);
      return {
        valid: false as const,
        error: "Failed to verify flight offer. Please try again.",
      };
    }
  },
});

// Initialize payment - creates a Payment Intent and returns client token for card collection
export const initializePayment = action({
  args: {
    offerId: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      paymentIntentId: v.string(),
      clientToken: v.string(),
      amount: v.string(),
      currency: v.string(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      // Get the offer to know the amount
      const offer = await getOffer(args.offerId);
      
      if (!offer) {
        return {
          success: false as const,
          error: "Flight offer not found or has expired.",
        };
      }

      // Create a payment intent for the total amount
      const paymentIntent = await createPaymentIntent({
        amount: offer.total_amount,
        currency: offer.total_currency || "GBP",
      });

      return {
        success: true as const,
        paymentIntentId: paymentIntent.id,
        clientToken: paymentIntent.clientToken,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      };
    } catch (error) {
      console.error("Initialize payment error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to initialize payment",
      };
    }
  },
});

// Create a booking after payment is confirmed (for test mode, we can skip payment)
export const createFlightBooking = action({
  args: {
    offerId: v.string(),
    tripId: v.id("trips"),
    passengers: v.array(
      v.object({
        id: v.string(),
        givenName: v.string(),
        familyName: v.string(),
        dateOfBirth: v.string(), // YYYY-MM-DD
        gender: v.union(v.literal("male"), v.literal("female")),
        email: v.string(),
        phoneNumber: v.string(),
        title: v.union(
          v.literal("mr"),
          v.literal("ms"),
          v.literal("mrs"),
          v.literal("miss"),
          v.literal("dr")
        ),
        // Passport information (required for international flights)
        passportNumber: v.optional(v.string()),
        passportIssuingCountry: v.optional(v.string()), // ISO 3166-1 alpha-2 country code
        passportExpiryDate: v.optional(v.string()), // YYYY-MM-DD
      })
    ),
    paymentIntentId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      orderId: v.string(),
      bookingReference: v.string(),
      totalAmount: v.number(),
      currency: v.string(),
      bookingUrl: v.optional(v.string()),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      // Get the offer first
      const offer = await getOffer(args.offerId);
      if (!offer) {
        return {
          success: false as const,
          error: "Flight offer not found or has expired. Please search for new flights.",
        };
      }

      // Get passenger IDs from the offer
      interface OfferPassenger {
        id: string;
        type?: string;
      }
      const offerPassengerIds = (offer.passengers as OfferPassenger[] | undefined)?.map((p) => p.id) || [];

      // Transform passengers to Duffel format, mapping to offer passenger IDs
      const duffelPassengers = args.passengers.map((p, index) => ({
        id: offerPassengerIds[index] || `pas_${index}`,
        given_name: p.givenName,
        family_name: p.familyName,
        born_on: p.dateOfBirth,
        gender: p.gender === "male" ? "m" as const : "f" as const,
        email: p.email,
        phone_number: p.phoneNumber,
        title: p.title,
        // Include passport information if provided
        passport_number: p.passportNumber,
        passport_issuing_country: p.passportIssuingCountry,
        passport_expiry_date: p.passportExpiryDate,
      }));

      console.log(`🛫 Creating booking for ${duffelPassengers.length} passengers...`);
      console.log(`📄 Passport info provided: ${duffelPassengers.filter(p => p.passport_number).length}/${duffelPassengers.length}`);

      // Create the order (booking)
      // In test mode with Duffel Airways, balance payment works automatically
      const order = await createOrder({
        offerId: args.offerId,
        passengers: duffelPassengers,
        paymentIntentId: args.paymentIntentId,
        metadata: {
          tripId: args.tripId,
          source: "planera",
        },
      });

      // Extract flight details for storage
      const flightDetails = extractFlightDetails(offer);

      // Save the booking to the database
      const bookingId = await ctx.runMutation(internal.flightBookingMutations.saveBooking, {
        tripId: args.tripId,
        duffelOrderId: order.id,
        bookingReference: order.bookingReference,
        paymentIntentId: args.paymentIntentId,
        totalAmount: order.totalAmount,
        currency: order.currency,
        outboundFlight: flightDetails.outbound,
        returnFlight: flightDetails.return,
        passengers: args.passengers.map(p => ({
          givenName: p.givenName,
          familyName: p.familyName,
          email: p.email,
        })),
        status: "confirmed",
      });

      console.log(`✅ Booking confirmed: ${order.bookingReference}`);

      // Create a secure booking link for email and sharing
      let bookingUrl: string | undefined;
      try {
        console.log(`🔗 Creating secure booking link for booking ${bookingId}...`);
        const linkResult: { token: string; expiresAt: number } = await ctx.runMutation(createBookingLinkRef, {
          bookingId,
          expiresInDays: 365, // 1 year expiration for booking links
        });
        bookingUrl = `https://planeraai.app/booking/?token=${linkResult.token}`;
        console.log(`🔗 Booking link created: ${bookingUrl}`);
      } catch (linkError) {
        console.error(`⚠️ Failed to create booking link:`, linkError);
      }

      // Send confirmation email asynchronously via Postmark
      try {
        console.log(`📧 Triggering Postmark receipt email for booking ${bookingId}...`);
        await ctx.runAction(internal.postmark.sendBookingReceiptEmail, {
          bookingId,
          bookingUrl,
        });
      } catch (emailError) {
        // Log error but don't fail the booking
        console.error(`⚠️ Failed to send confirmation email:`, emailError);
      }

      return {
        success: true as const,
        orderId: order.id,
        bookingReference: order.bookingReference || "PENDING",
        totalAmount: order.totalAmount,
        currency: order.currency,
        bookingUrl,
      };
    } catch (error) {
      console.error("Create booking error:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to create booking",
      };
    }
  },
});
