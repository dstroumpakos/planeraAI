# Duffel Flight Booking Flow

## Overview
This document describes the complete flight booking flow with Duffel integration, including extras (baggage, seats, policies).

## Call Order Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLIGHT SEARCH PHASE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User enters: Origin, Destination, Dates, Travelers                         │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────┐                            │
│  │  createOfferRequest (duffel.ts)            │                            │
│  │  - Creates offer request with passenger    │                            │
│  │    ages from traveler profiles             │                            │
│  │  - Polls for offers                        │                            │
│  │  - Filters to Duffel Airways (ZZ) for test │                            │
│  └────────────────────────────────────────────┘                            │
│                              │                                               │
│                              ▼                                               │
│  Display flight options (price, times, airlines)                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ User selects an offer
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OFFER DETAILS PHASE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Screen: /flight-offer-details                                              │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────┐                            │
│  │  createDraft (bookingDraft.ts)             │                            │
│  │  - Fetches offer with extras               │                            │
│  │  - Extracts conditions (change/refund)     │                            │
│  │  - Gets included baggage per segment       │                            │
│  │  - Gets available paid services            │                            │
│  │  - Creates flightBookingDrafts record      │                            │
│  └────────────────────────────────────────────┘                            │
│                              │                                               │
│                              ▼                                               │
│  Display:                                                                    │
│  - Flight summary                                                           │
│  - Passenger list                                                           │
│  - Included baggage (cabin/checked)                                         │
│  - Booking policy (changes/refunds)                                         │
│  - Available extras preview                                                 │
│  - Price breakdown                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ User continues
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTRAS PHASE                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Screen: /flight-extras (3 tabs)                                            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TAB 1: BAGS                                                             ││
│  │                                                                          ││
│  │ - Shows included baggage                                                ││
│  │ - Shows purchasable baggage (if available)                              ││
│  │                                                                          ││
│  │ On selection:                                                           ││
│  │ ┌────────────────────────────────────────────┐                         ││
│  │ │  updateBaggageSelections (mutation)        │                         ││
│  │ │  - Saves selected bag service IDs          │                         ││
│  │ │  - Updates extras total in draft           │                         ││
│  │ └────────────────────────────────────────────┘                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TAB 2: POLICY                                                           ││
│  │                                                                          ││
│  │ - Shows change policy (allowed/fee/not allowed)                         ││
│  │ - Shows refund policy (allowed/fee/not allowed)                         ││
│  │ - Requires checkbox acknowledgment                                       ││
│  │                                                                          ││
│  │ On acknowledgment:                                                       ││
│  │ ┌────────────────────────────────────────────┐                         ││
│  │ │  acknowledgePolicy (mutation)              │                         ││
│  │ │  - Sets policyAcknowledged = true          │                         ││
│  │ │  - Records acknowledgment timestamp        │                         ││
│  │ │  - Updates draft status                    │                         ││
│  │ └────────────────────────────────────────────┘                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TAB 3: SEATS                                                            ││
│  │                                                                          ││
│  │ - Initial: "View Available Seats" button                                ││
│  │                                                                          ││
│  │ On load seats:                                                          ││
│  │ ┌────────────────────────────────────────────┐                         ││
│  │ │  fetchSeatMaps (action)                    │                         ││
│  │ │  - Calls Duffel GET /air/seat_maps         │                         ││
│  │ │  - Returns seat map per segment            │                         ││
│  │ │  - Each seat has available services        │                         ││
│  │ └────────────────────────────────────────────┘                         ││
│  │                                                                          ││
│  │ - Display seat map modal                                                ││
│  │ - User selects seat per passenger per segment                           ││
│  │                                                                          ││
│  │ On save:                                                                ││
│  │ ┌────────────────────────────────────────────┐                         ││
│  │ │  updateSeatSelections (mutation)           │                         ││
│  │ │  - Validates: 1 seat per passenger/segment │                         ││
│  │ │  - Saves selected seat service IDs         │                         ││
│  │ │  - Updates extras total in draft           │                         ││
│  │ └────────────────────────────────────────────┘                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  VALIDATION BEFORE CONTINUE:                                                │
│  - Policy must be acknowledged                                              │
│  - Seat selections must be valid (if any)                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ User continues
┌─────────────────────────────────────────────────────────────────────────────┐
│                        REVIEW PHASE                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Screen: /flight-review                                                     │
│                                                                              │
│  ┌────────────────────────────────────────────┐                            │
│  │  getBookingDraft (query)                   │                            │
│  │  - Fetches draft with all selections       │                            │
│  │  - Calculates total with extras            │                            │
│  └────────────────────────────────────────────┘                            │
│                              │                                               │
│                              ▼                                               │
│  Display:                                                                    │
│  - Flight details                                                           │
│  - Passenger list                                                           │
│  - Selected extras (bags, seats)                                            │
│  - Policy acknowledgment status                                             │
│  - Price breakdown (base + extras)                                          │
│  - Terms notice                                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ User completes booking
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BOOKING PHASE                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────┐                            │
│  │  completeBooking (action)                  │                            │
│  │                                             │                            │
│  │  1. Validate draft exists and policy ack'd │                            │
│  │  2. Collect all service IDs:               │                            │
│  │     - Bag service IDs                      │                            │
│  │     - Seat service IDs                     │                            │
│  │  3. Transform passengers to Duffel format  │                            │
│  │  4. Call createOrderWithServices           │                            │
│  │     (includes services in order request)   │                            │
│  │  5. Save flightBookings record             │                            │
│  │  6. Update draft status to "completed"     │                            │
│  │  7. Return booking reference               │                            │
│  └────────────────────────────────────────────┘                            │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────┐                            │
│  │  Duffel POST /air/orders                   │                            │
│  │                                             │                            │
│  │  Request body:                             │                            │
│  │  {                                         │                            │
│  │    type: "instant",                        │                            │
│  │    selected_offers: [offerId],             │                            │
│  │    passengers: [...],                      │                            │
│  │    payments: [...],                        │                            │
│  │    services: [                             │                            │
│  │      { id: "bag_service_id", quantity: 1 },│                            │
│  │      { id: "seat_service_id", quantity: 1 }│                            │
│  │    ]                                       │                            │
│  │  }                                         │                            │
│  └────────────────────────────────────────────┘                            │
│                              │                                               │
│                              ▼                                               │
│  Show confirmation:                                                         │
│  - Booking reference                                                        │
│  - Total paid                                                               │
│  - Email notification info                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### flightBookingDrafts Table

```typescript
{
  userId: string,
  tripId: Id<"trips">,
  
  // Offer
  offerId: string,
  offerExpiresAt?: string,
  
  // Pricing
  basePriceCents: bigint,
  currency: string,
  
  // Passengers
  passengers: [{
    passengerId: string,      // Duffel passenger ID
    travelerId?: Id<"travelers">,
    type: "adult" | "child" | "infant",
    givenName: string,
    familyName: string,
    dateOfBirth: string,      // YYYY-MM-DD
    gender: "male" | "female",
    title: "mr" | "ms" | "mrs" | "miss" | "dr",
    email?: string,
    phoneCountryCode?: string,
    phoneNumber?: string,
    passportNumber?: string,
    passportIssuingCountry?: string,
    passportExpiryDate?: string,
  }],
  
  // Selections
  selectedBags?: [{
    passengerId: string,
    segmentId: string,
    serviceId: string,        // Duffel service ID for booking
    quantity: bigint,
    priceCents: bigint,
    currency: string,
    type: string,             // "checked" | "carry_on"
    weight?: { amount: number, unit: string },
  }],
  
  selectedSeats?: [{
    passengerId: string,
    segmentId: string,
    serviceId: string,        // Duffel service ID for booking
    seatDesignator: string,   // e.g., "12A"
    priceCents: bigint,
    currency: string,
  }],
  
  // Policy
  policyAcknowledged: boolean,
  policyAcknowledgedAt?: number,
  
  // Cached offer data
  conditions?: {
    changeBeforeDeparture?: {
      allowed: boolean,
      penaltyAmount?: string,
      penaltyCurrency?: string,
    },
    refundBeforeDeparture?: {
      allowed: boolean,
      penaltyAmount?: string,
      penaltyCurrency?: string,
    },
  },
  
  includedBaggage?: [{
    segmentId: string,
    passengerId: string,
    cabin?: { quantity: bigint, type?: string },
    checked?: { quantity: bigint, weight?: { amount: number, unit: string } },
  }],
  
  availableServices?: {
    bags?: [...],
    seatsAvailable: boolean,
  },
  
  // Totals
  extrasTotalCents?: bigint,
  totalPriceCents: bigint,
  
  // Status
  status: "draft" | "extras_selected" | "ready_for_payment" | "completed" | "expired",
  
  // Timestamps
  createdAt: number,
  updatedAt: number,
  expiresAt?: number,         // Matches offer expiry or 30 min
}
```

## Edge Cases Handled

### 1. Non-Refundable Fares
- `conditions.refundBeforeDeparture.allowed = false`
- UI shows red badge: "Non-refundable"
- User must acknowledge before proceeding

### 2. Changes Not Allowed
- `conditions.changeBeforeDeparture.allowed = false`
- UI shows red badge: "Changes not allowed"
- User must acknowledge before proceeding

### 3. Seat Maps Not Available
- `getSeatMaps()` returns null or empty
- UI shows info message: "Seat selection not available for this flight"
- Seats tab shows "Not available" state
- User can proceed without seat selection

### 4. No Paid Baggage Available
- `availableServices.bags` is empty
- UI shows only included baggage
- Info message: "Additional baggage may be available at check-in"

### 5. Offer Expired
- Draft has `expiresAt` timestamp
- `getBookingDraft()` returns null if expired
- User sees error and must search again

### 6. Policy Not Acknowledged
- `completeBooking()` returns error
- UI shows warning on Policy tab
- Continue button disabled until acknowledged

### 7. Invalid Seat Selection
- `updateSeatSelections()` validates:
  - One seat per passenger per segment
  - Seat must have available service for passenger
- Throws error if validation fails

## API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/air/offer_requests` | POST | Search flights |
| `/air/offers/{id}?return_available_services=true` | GET | Get offer with extras |
| `/air/seat_maps?offer_id={id}` | GET | Get seat maps |
| `/air/orders` | POST | Create booking |
| `/payments/payment_intents` | POST | Create payment intent |
| `/payments/payment_intents/{id}/actions/confirm` | POST | Confirm payment |

## Files Structure

```
convex/
├── flights/
│   ├── duffel.ts              # Core Duffel API functions
│   └── duffelExtras.ts        # Extras API (baggage, seats, conditions)
├── bookingDraft.ts            # Actions for booking flow
├── bookingDraftMutations.ts   # Mutations/queries for draft management
├── flightBooking.ts           # Flight booking action
├── flightBookingMutations.ts  # Internal mutations for bookings
└── schema.ts                  # Data model

app/
├── flight-offer-details.tsx   # Fare details screen
├── flight-extras.tsx          # Extras screen (bags/policy/seats tabs)
└── flight-review.tsx          # Review & complete booking screen
```
