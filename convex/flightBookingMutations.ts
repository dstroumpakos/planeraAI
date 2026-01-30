import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authQuery } from "./functions";

// Validator for flight details
const flightDetailsValidator = v.object({
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
});

// Validator for passenger
const passengerValidator = v.object({
  givenName: v.string(),
  familyName: v.string(),
  email: v.string(),
  type: v.optional(v.union(v.literal("adult"), v.literal("child"), v.literal("infant"))),
  dateOfBirth: v.optional(v.string()),
});

// Validator for policies
const policiesValidator = v.object({
  canChange: v.boolean(),
  canRefund: v.boolean(),
  changePolicy: v.string(),
  refundPolicy: v.string(),
  changePenaltyAmount: v.optional(v.string()),
  changePenaltyCurrency: v.optional(v.string()),
  refundPenaltyAmount: v.optional(v.string()),
  refundPenaltyCurrency: v.optional(v.string()),
});

// Validator for included baggage
const includedBaggageValidator = v.object({
  passengerId: v.string(),
  passengerName: v.optional(v.string()),
  cabinBags: v.optional(v.int64()),
  checkedBags: v.optional(v.int64()),
  checkedBagWeight: v.optional(v.object({
    amount: v.float64(),
    unit: v.string(),
  })),
});

// Validator for paid baggage
const paidBaggageValidator = v.object({
  passengerId: v.string(),
  passengerName: v.optional(v.string()),
  type: v.string(),
  quantity: v.int64(),
  priceCents: v.int64(),
  currency: v.string(),
  weight: v.optional(v.object({
    amount: v.float64(),
    unit: v.string(),
  })),
});

// Validator for seat selections
const seatSelectionValidator = v.object({
  passengerId: v.string(),
  passengerName: v.optional(v.string()),
  segmentId: v.string(),
  flightNumber: v.optional(v.string()),
  seatDesignator: v.string(),
  priceCents: v.int64(),
  currency: v.string(),
});

// Internal mutation to save booking to database
export const saveBooking = internalMutation({
  args: {
    tripId: v.id("trips"),
    duffelOrderId: v.string(),
    bookingReference: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
    totalAmount: v.number(),
    currency: v.string(),
    basePriceCents: v.optional(v.int64()),
    extrasTotalCents: v.optional(v.int64()),
    outboundFlight: flightDetailsValidator,
    returnFlight: v.optional(flightDetailsValidator),
    passengers: v.array(passengerValidator),
    policies: v.optional(policiesValidator),
    includedBaggage: v.optional(v.array(includedBaggageValidator)),
    paidBaggage: v.optional(v.array(paidBaggageValidator)),
    seatSelections: v.optional(v.array(seatSelectionValidator)),
    status: v.union(
      v.literal("pending_payment"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("failed")
    ),
    departureTimestamp: v.optional(v.float64()),
  },
  returns: v.id("flightBookings"),
  handler: async (ctx, args) => {
    // Get the trip to find the userId
    const trip = await ctx.db.get(args.tripId);
    if (!trip) {
      throw new Error("Trip not found");
    }

    const bookingId = await ctx.db.insert("flightBookings", {
      userId: trip.userId,
      tripId: args.tripId,
      duffelOrderId: args.duffelOrderId,
      bookingReference: args.bookingReference,
      paymentIntentId: args.paymentIntentId,
      totalAmount: args.totalAmount,
      currency: args.currency,
      basePriceCents: args.basePriceCents,
      extrasTotalCents: args.extrasTotalCents,
      outboundFlight: args.outboundFlight,
      returnFlight: args.returnFlight,
      passengers: args.passengers,
      policies: args.policies,
      includedBaggage: args.includedBaggage,
      paidBaggage: args.paidBaggage,
      seatSelections: args.seatSelections,
      status: args.status,
      createdAt: Date.now(),
      confirmedAt: args.status === "confirmed" ? Date.now() : undefined,
      departureTimestamp: args.departureTimestamp,
    });

    return bookingId;
  },
});

// Public query to get bookings for a trip
export const getBookingsForTrip = query({
  args: {
    tripId: v.id("trips"),
  },
  returns: v.array(v.object({
    _id: v.id("flightBookings"),
    bookingReference: v.optional(v.string()),
    totalAmount: v.float64(),
    currency: v.string(),
    status: v.string(),
    outboundFlight: v.object({
      airline: v.string(),
      flightNumber: v.string(),
      departure: v.string(),
      arrival: v.string(),
      departureDate: v.string(),
      origin: v.string(),
      destination: v.string(),
    }),
    returnFlight: v.optional(v.object({
      airline: v.string(),
      flightNumber: v.string(),
      departure: v.string(),
      arrival: v.string(),
      departureDate: v.string(),
      origin: v.string(),
      destination: v.string(),
    })),
    passengers: v.array(v.object({
      givenName: v.string(),
      familyName: v.string(),
      email: v.string(),
    })),
    createdAt: v.float64(),
  })),
  handler: async (ctx, args) => {
    const bookings = await ctx.db
      .query("flightBookings")
      .withIndex("by_trip", (q) => q.eq("tripId", args.tripId))
      .collect();
    
    return bookings.map(b => ({
      _id: b._id,
      bookingReference: b.bookingReference,
      totalAmount: b.totalAmount,
      currency: b.currency,
      status: b.status,
      outboundFlight: {
        airline: b.outboundFlight.airline,
        flightNumber: b.outboundFlight.flightNumber,
        departure: b.outboundFlight.departure,
        arrival: b.outboundFlight.arrival,
        departureDate: b.outboundFlight.departureDate,
        origin: b.outboundFlight.origin,
        destination: b.outboundFlight.destination,
      },
      returnFlight: b.returnFlight ? {
        airline: b.returnFlight.airline,
        flightNumber: b.returnFlight.flightNumber,
        departure: b.returnFlight.departure,
        arrival: b.returnFlight.arrival,
        departureDate: b.returnFlight.departureDate,
        origin: b.returnFlight.origin,
        destination: b.returnFlight.destination,
      } : undefined,
      passengers: b.passengers.map(p => ({
        givenName: p.givenName,
        familyName: p.familyName,
        email: p.email,
      })),
      createdAt: b.createdAt,
    }));
  },
});

// Authenticated query to get all user's flight bookings for the profile page
export const getUserFlightBookings = authQuery({
  args: {},
  returns: v.array(v.object({
    _id: v.id("flightBookings"),
    tripId: v.id("trips"),
    tripDestination: v.optional(v.string()),
    duffelOrderId: v.string(),
    bookingReference: v.optional(v.string()),
    totalAmount: v.float64(),
    currency: v.string(),
    basePriceCents: v.optional(v.int64()),
    extrasTotalCents: v.optional(v.int64()),
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
    paidBaggage: v.optional(v.array(v.object({
      passengerId: v.string(),
      passengerName: v.optional(v.string()),
      type: v.string(),
      quantity: v.int64(),
      priceCents: v.int64(),
      currency: v.string(),
      weight: v.optional(v.object({
        amount: v.float64(),
        unit: v.string(),
      })),
    }))),
    seatSelections: v.optional(v.array(v.object({
      passengerId: v.string(),
      passengerName: v.optional(v.string()),
      segmentId: v.string(),
      flightNumber: v.optional(v.string()),
      seatDesignator: v.string(),
      priceCents: v.int64(),
      currency: v.string(),
    }))),
    status: v.string(),
    createdAt: v.float64(),
    confirmedAt: v.optional(v.float64()),
    departureTimestamp: v.optional(v.float64()),
    // Computed fields
    isUpcoming: v.boolean(),
    isPast: v.boolean(),
  })),
  handler: async (ctx) => {
    const bookings = await ctx.db
      .query("flightBookings")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .order("desc")
      .collect();
    
    const now = Date.now();
    
    // Get trip destinations for each booking
    const results = await Promise.all(bookings.map(async (b) => {
      const trip = await ctx.db.get(b.tripId);
      
      // Parse departure date to determine if flight is upcoming or past
      let departureTimestamp = b.departureTimestamp;
      if (!departureTimestamp && b.outboundFlight.departureDate) {
        const [year, month, day] = b.outboundFlight.departureDate.split("-").map(Number);
        departureTimestamp = new Date(year, month - 1, day).getTime();
      }
      
      const isUpcoming = departureTimestamp ? departureTimestamp > now : false;
      const isPast = departureTimestamp ? departureTimestamp <= now : false;
      
      return {
        _id: b._id,
        tripId: b.tripId,
        tripDestination: trip?.destination,
        duffelOrderId: b.duffelOrderId,
        bookingReference: b.bookingReference,
        totalAmount: b.totalAmount,
        currency: b.currency,
        basePriceCents: b.basePriceCents,
        extrasTotalCents: b.extrasTotalCents,
        outboundFlight: b.outboundFlight,
        returnFlight: b.returnFlight,
        passengers: b.passengers,
        policies: b.policies,
        includedBaggage: b.includedBaggage,
        paidBaggage: b.paidBaggage,
        seatSelections: b.seatSelections,
        status: b.status,
        createdAt: b.createdAt,
        confirmedAt: b.confirmedAt,
        departureTimestamp,
        isUpcoming,
        isPast,
      };
    }));
    
    return results;
  },
});
