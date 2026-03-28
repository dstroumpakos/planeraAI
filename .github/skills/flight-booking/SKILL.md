---
name: flight-booking
description: "Work with the Duffel flight booking integration in Bloom. Use when: modifying flight search, offer display, booking drafts, passenger forms, seat/baggage extras, payment flow, or booking confirmation. Covers the full Duffel API lifecycle."
---

# Flight Booking (Duffel Integration)

## When to Use
- Modifying flight search or offer requests
- Working with booking drafts (in-progress selections)
- Editing passenger details or seat/baggage extras
- Updating the payment or checkout flow
- Handling booking confirmations or cancellations

## Architecture

### Booking Flow
```
Search Flights → Select Offer → Create Draft → Add Extras → Collect Passengers → Payment → Confirm Order
```

### Key Files
| File | Purpose |
|------|---------|
| `convex/flights/duffel.ts` | Duffel API wrapper (offer requests, orders) |
| `convex/flights/duffelExtras.ts` | Baggage, seat, and meal extras |
| `convex/flights/fallback.ts` | Fallback offers for degraded service |
| `convex/flightBooking.ts` | Booking queries and business logic |
| `convex/flightBookingMutations.ts` | Mutations for booking state changes |
| `convex/bookingDraft.ts` | Draft queries (in-progress bookings) |
| `convex/bookingDraftMutations.ts` | Draft create/update mutations |
| `app/flight-booking.tsx` | Booking checkout screen |
| `app/flight-offer-details.tsx` | Offer detail view |
| `app/flight-extras.tsx` | Baggage & seat selection screen |
| `app/flight-review.tsx` | Final review before payment |

### Data Model
```
flightBookingDrafts — in-progress selections before checkout
  ├── userId, tripId, offerId
  ├── outboundFlight, returnFlight details
  ├── passengers, seatSelections, paidBaggage
  └── status: draft | ready | expired

flightBookings — completed bookings
  ├── userId, tripId
  ├── duffelOrderId, bookingReference, paymentIntentId
  ├── outboundFlight, returnFlight (airline, times, aircraft)
  ├── passengers, policies, baggage, seatSelections
  └── status: pending_payment | confirmed | cancelled | failed
```

### Duffel API Pattern
All Duffel calls go through Convex actions (which can make HTTP requests):
```typescript
// In convex/flights/duffel.ts
export const searchFlights = authAction({
  args: { origin: v.string(), destination: v.string(), ... },
  handler: async (ctx, args) => {
    const response = await fetch("https://api.duffel.com/air/offer_requests", {
      headers: { Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}` },
      // ...
    });
    return offers;
  },
});
```

## Procedure
1. For search changes, modify `convex/flights/duffel.ts`
2. For extras (seats, bags), modify `convex/flights/duffelExtras.ts`
3. For booking state logic, update `convex/flightBookingMutations.ts`
4. For UI changes, edit the corresponding `app/flight-*.tsx` screen
5. Reference `docs/DUFFEL_FLIGHT_BOOKING_FLOW.md` for the full flow documentation
