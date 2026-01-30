# Duffel Flights Integration

This document describes the Duffel Flights API integration for Planera.

## Overview

The app has been migrated from Amadeus to Duffel for flight search and booking functionality. The Duffel provider module handles all flight-related API calls while maintaining backward compatibility with the existing frontend contract.

## Architecture

### Provider Module
- **Location**: `convex/flights/duffel.ts`
- **Responsibilities**:
  - Duffel API authentication
  - Offer request creation (flight search)
  - Offer retrieval and pricing
  - Order creation (booking)
  - Response transformation to frontend format

### Integration Points
- **Trip Generation**: `convex/tripsActions.ts` calls Duffel provider during trip generation
- **Frontend Contract**: All Duffel responses are transformed to match existing flight option format
- **Fallback**: If Duffel is unavailable, the system falls back to AI-generated flight data

## Environment Variables

Configure these in your Convex dashboard or `.env.local`:

```
DUFFEL_ACCESS_TOKEN=<your-duffel-api-token>
DUFFEL_ENV=test  # or "live" for production
```

### Getting Duffel Credentials

1. Sign up at [Duffel](https://duffel.com)
2. Create an API token in your dashboard
3. Use the **test** environment for development
4. Switch to **live** environment for production

## API Flow

### 1. Flight Search (Offer Request)

```typescript
const { offerRequestId, offers } = await duffel.createOfferRequest(
  "LHR",           // origin IATA code
  "CDG",           // destination IATA code
  "2025-12-20",    // departure date (YYYY-MM-DD)
  "2025-12-27",    // return date (YYYY-MM-DD)
  2,               // adults
  0,               // children
  0,               // infants
  "economy"        // cabin class
);
```

**Response**: Array of offers with pricing and flight details

### 2. Get Fresh Pricing (Before Booking)

```typescript
const offer = await duffel.getOffer(offerId);
```

**Response**: Single offer with current pricing

### 3. Create Booking (Order)

```typescript
const order = await duffel.createOrder(
  offerId,
  [
    {
      id: "passenger_id_from_offer",
      given_name: "John",
      family_name: "Doe",
      email: "john@example.com",
      phone_number: "+44123456789"
    }
  ],
  "balance"  // payment type
);
```

**Response**: Order confirmation with booking reference

## Response Format

All Duffel responses are transformed to match the existing frontend contract:

```typescript
{
  id: string;                    // Duffel offer ID
  offerId: string;               // Same as id
  offerRequestId: string;        // For reference
  outbound: {
    airline: string;
    airlineCode: string;
    flightNumber: string;
    duration: string;            // e.g., "2h 30m"
    departure: string;           // e.g., "10:00 AM"
    arrival: string;             // e.g., "12:30 PM"
    stops: number;
    departureTime: string;        // ISO 8601
  };
  return?: {
    // Same structure as outbound
  };
  pricePerPerson: number;        // EUR
  totalPrice: number;            // EUR
  currency: string;              // "EUR"
  isBestPrice: boolean;
  luggage: string;
  cabinBaggage: string;
  checkedBaggageIncluded: boolean;
  checkedBaggagePrice: number;
}
```

## Error Handling

The provider includes comprehensive error handling:

- **Missing credentials**: Throws error with clear message
- **API errors**: Translates Duffel error messages to user-friendly format
- **Network errors**: Logged with request context for debugging
- **No results**: Falls back to AI-generated data

Example error handling in trip generation:

```typescript
try {
  const { offerRequestId, offers } = await duffel.createOfferRequest(...);
  // Process offers
} catch (error) {
  console.error("Duffel flight search failed:", error);
  // Fall back to AI-generated flights
  flights = await generateRealisticFlights(...);
}
```

## Testing

### Test Mode (Sandbox)

1. Set `DUFFEL_ENV=test` in environment variables
2. Use test IATA codes (e.g., LHR, CDG, JFK)
3. Duffel provides test data for development

### Test Credentials

- Use any valid IATA airport codes
- Test payment type: `balance`
- Offers are returned immediately without real pricing

### Debugging

Enable detailed logging by checking the Convex logs:

```
📤 Creating Duffel offer request: { origin, destination, ... }
✅ Duffel offer request created: <offer_request_id>
📥 Retrieved X offers
✅ Order created: <order_id> Booking ref: <booking_reference>
```

## Migration Notes

### From Amadeus

**Removed**:
- `getAmadeusToken()` function
- `searchFlights()` function (Amadeus-specific)
- Amadeus environment variables (`AMADEUS_API_KEY`, `AMADEUS_API_SECRET`)

**Added**:
- Duffel provider module
- Duffel environment variables
- Offer request ID tracking

**Unchanged**:
- Frontend flight option format
- Trip generation flow
- Fallback to AI-generated flights

## Future Enhancements

1. **Hotel Search**: Integrate Duffel Hotels API when available
2. **Seat Selection**: Add seat map and selection during booking
3. **Baggage Management**: Show detailed baggage allowances and pricing
4. **Ancillary Services**: Display and sell additional services (meals, seat upgrades, etc.)
5. **Real-time Pricing**: Cache offers and refresh pricing before booking

## Support

For issues with Duffel API:
- Check [Duffel API Documentation](https://duffel.com/docs)
- Review error messages in Convex logs
- Verify environment variables are set correctly
- Ensure IATA codes are valid

For app-specific issues:
- Check `convex/flights/duffel.ts` for implementation details
- Review `convex/tripsActions.ts` for integration points
- Check frontend contract in `app/trip/[id].tsx`
