/**
 * One source of truth for how long a trip is.
 *
 * Trip dates are stored as midnight of the outbound and the return day, so their
 * difference is the number of NIGHTS. The itinerary generator plans the departure
 * day too (see `countTripDays` in convex/tripsActions.ts), which makes the day
 * count nights + 1. Anything that shows or caps a trip length has to count it the
 * same way, or the UI advertises a different number of days than it renders.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest trip we plan, in calendar days (so 15 days = 14 nights). */
export const MAX_TRIP_DAYS = 15;

/** Calendar days a trip covers, inclusive of both the outbound and return day. */
export function countTripDays(startDate: number, endDate: number): number {
    const nights = Math.round((endDate - startDate) / DAY_MS);
    return Math.max(1, nights + 1);
}

/** Latest return date allowed for a given outbound date. */
export function maxEndDate(startDate: number): number {
    return startDate + (MAX_TRIP_DAYS - 1) * DAY_MS;
}
