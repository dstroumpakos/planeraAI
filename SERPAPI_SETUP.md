# SerpApi Google Flights — Setup & Notes

## 1. Environment variable

```powershell
# Use a NEW private SerpApi key — do not copy any key from documentation.
npx convex env set SERPAPI_API_KEY "your_new_private_key_here"
```

Verify:

```powershell
npx convex env list
```

The key is read only inside `convex/flightsSerpApi.ts` via `getSerpApiKey()`.
It is **never** sent to the mobile client and **never** logged.

## 2. Files added

| Layer    | File                                                       |
| -------- | ---------------------------------------------------------- |
| Types    | `types/flights.ts`                                         |
| Helpers  | `convex/lib/serpApiFlights.ts`                             |
| Cache    | `convex/flightSearchCache.ts` (+ schema table)             |
| Actions  | `convex/flightsSerpApi.ts` (`searchFlights`, `getBookingOptions`) |
| Radar    | `convex/lowFareRadarSearch.ts` (`searchLowFareRadarDeals`) |
| Hooks    | `hooks/useFlightSearch.ts`, `hooks/useFlightBookingOptions.ts` |
| UI       | `components/flights/*`                                     |
| Screen   | `app/flights/search.tsx`                                   |

## 3. Routing from trip details

Pass prefill via query params:

```ts
router.push({
  pathname: "/flights/search",
  params: {
    departureId: trip.originAirport,     // or homeAirport
    arrivalId: trip.destinationAirport,
    outboundDate: "2026-06-10",
    returnDate: "2026-06-17",
    adults: String(trip.travelerCount ?? 1),
    currency: "EUR",
  },
});
```

The label for that button should be **“Find flights for this trip”**.

## 4. Cache

`flightSearchCache` table stores both search results (30 min TTL) and
booking-option lookups (10 min TTL). Pass `noCache: true` in the search
input to force a live fetch. A `purgeExpired` internal mutation is
available if you want to wire it into `convex/crons.ts`.

## 5. Booking handoff — `url` vs `post_data`

SerpApi returns provider booking info as either:

- `booking_request.url` — open with `Linking.openURL(url)` (✅ MVP).
- `booking_request.post_data` — provider expects a POST. React Native cannot
  securely submit an external POST. For MVP, `BookingOptionCard.tsx` shows
  a "not available in the app yet" message for POST-only providers.
  A future backend-rendered handoff page (e.g. a Convex HTTP action returning
  an HTML form that auto-submits) can fill the gap.

## 6. Compliance copy (do not change)

- Buttons: **Find flights**, **View flight**, **View booking options**,
  **Continue to provider**, **Check availability**.
- Disclaimer (shown near search & booking actions):

  > Planera helps you discover flight options. Booking and payment are
  > completed directly with external providers. Prices and availability
  > may change.

- **Never** use phrases like “Book with Planera”, “Pay with Planera”,
  “Planera ticket”, or “Planera booking”.

## 7. Low-Fare Radar rules

`searchLowFareRadarDeals` only promotes results where
`price_insights.price_level` is `"low"` or `"typical"`. Anything graded
`"high"` is returned with `bestOption: null` so the UI does not promote
it. It samples at most 3 dates per destination and runs sequentially to
keep SerpApi quota bounded.

## 8. Debug examples

```ts
// One-way
{ departureId: "ATH", arrivalId: "BCN", outboundDate: "2026-06-10",
  currency: "EUR", type: "one_way" }

// Round-trip
{ departureId: "ATH", arrivalId: "FCO", outboundDate: "2026-07-05",
  returnDate: "2026-07-09", currency: "EUR", type: "round_trip" }

// Long-haul
{ departureId: "ATH", arrivalId: "JFK", outboundDate: "2026-08-10",
  returnDate: "2026-08-20", currency: "EUR", type: "round_trip" }
```

Logs only include: `departureId`, `arrivalId`, `outboundDate`,
`returnDate`, status, and result counts. No API key, no PII.

## 9. i18n

For brevity, the new UI components use English strings inline. Before
release, move user-facing strings into a `flights.serpapi` namespace in
`lib/i18n/en.json` and mirror across el/es/fr/de/ar. The compliance
disclaimer should be reviewed by legal before localizing.

## 10. Google repo sync

After verifying on iOS, mirror these files to the Google repo at
`C:\Users\nioni\Desktop\Bloom-planeraAI_google` per the `google-sync`
skill. None of these files diverge between repos.
