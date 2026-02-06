# Arrival & Departure Times Feature

## Overview

This feature adds support for arrival and departure times in trip itineraries, making them **time-aware** rather than just date-based. When users provide flight times, the AI will generate itineraries that respect these constraints.

## Data Model Changes

### Schema (`convex/schema.ts`)

Added two new optional fields to the `trips` table:

```typescript
// Arrival/Departure times for time-aware itineraries (ISO datetime strings in destination timezone)
arrivalTime: v.optional(v.string()), // e.g., "2024-01-15T15:30:00"
departureTime: v.optional(v.string()), // e.g., "2024-01-22T18:00:00"
```

These fields store ISO datetime strings representing the local time at the destination.

## Backend Changes

### Trip Creation (`convex/trips.ts`)

- Added `arrivalTime` and `departureTime` to mutation args
- Stores these values in the database
- Builds a prompt with arrival/departure context for itinerary generation
- Passes time information to the generation action

### Itinerary Generation (`convex/tripsActions.ts`)

Added `generateTimeAwareGuidance()` helper function that:

1. **Analyzes arrival time** and determines first-day constraints:
   - Late evening arrival (20:00+): Only check-in and light dinner
   - Afternoon arrival (15:00-20:00): Light activities after arrival
   - Mid-day arrival (12:00-15:00): Afternoon activities available
   - Morning arrival: Nearly full day with delayed start

2. **Analyzes departure time** and determines last-day constraints:
   - Very early departure (04:00-06:00): **Skip last day entirely**, end previous day at 20:00-21:00
   - Late morning departure (06:00-10:00): Skip last day activities
   - Early afternoon (10:00-14:00): Very light morning only
   - Later departure: Partial day available (ends 3 hours before)

3. **Passes guidance to OpenAI** via:
   - Updated system prompt mentioning time-awareness
   - Detailed instructions in user prompt about constraints
   - Adjusted day count for skipLastDay scenario

## UI Changes (`app/create-trip.tsx`)

### New "Flight Times" Section

Added an optional section after the Dates section with:

- **Arrival Time Input**: "Arrival at destination"
- **Departure Time Input**: "Departure from destination"
- Clear buttons to remove set times
- Helper text explaining impact on itinerary
- Uses `@react-native-community/datetimepicker` for time selection

### Time Picker Modal

- iOS: Full modal with spinner picker
- Android: Native time picker dialog
- Shows context-aware labels explaining the impact

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Arrival after 20:00 | Only check-in and dinner on Day 1 |
| Arrival 15:00-20:00 | Light afternoon activities, dinner, evening stroll |
| Departure 04:00-06:00 | **No activities on departure day**; previous day ends 20:00-21:00 |
| Departure 06:00-10:00 | Skip departure day activities |
| Departure afternoon | Activities end 3 hours before departure |
| No times provided | Default behavior (full day activities) |

## Backward Compatibility

- Fields are **optional** - existing trips without times continue to work
- Legacy trips render normally with date-only logic
- New trips can selectively set arrival, departure, neither, or both

## Usage Examples

### Example 1: Late Afternoon Arrival
```
Arrival: 15:30 on January 15
```
Generated itinerary for Day 1:
- 17:00 - Check into hotel, freshen up
- 18:30 - Neighborhood walk
- 20:00 - Dinner at local restaurant

### Example 2: Early Morning Departure
```
Departure: 05:30 on January 22
```
Generated itinerary:
- Day 6 (Jan 21): Activities end at 21:00
- Day 7 (Jan 22): "Departure Day - Early morning flight, no activities scheduled"

### Example 3: Both Times Set
```
Arrival: 16:00 on January 15
Departure: 18:00 on January 22
```
- Day 1 starts at 17:30 (post-arrival)
- Day 8 ends at 15:00 (3 hours before departure)

## Testing Checklist

- [ ] New trip creation with arrival time only
- [ ] New trip creation with departure time only
- [ ] New trip creation with both times
- [ ] Early morning departure (04:00-06:00) skips last day
- [ ] Existing trips without times still work
- [ ] Time picker works on iOS
- [ ] Time picker works on Android
- [ ] Clear time buttons work correctly
- [ ] Helper text updates based on selections
