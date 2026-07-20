/**
 * Shared cache-key builders for the searchapi.io-backed lookups that more than
 * one entry point reads. A cache key built in two places is a cache that
 * silently stops being shared (and doubles the paid quota) the day the copies
 * drift — this module is the single source of truth.
 *
 * Used by:
 *  - `flightCalendar.ts` (authed teaser strip + campaign fetch)
 *  - `exploreDestination.ts` / `exploreDestinationPublic.ts` (teaser card)
 *  - `newsletterCampaigns.ts` (campaign preview reads the cache directly,
 *    since a query context cannot call the fetch actions)
 *
 * No "use node" here: this must stay importable from both node actions and
 * default-runtime queries.
 */

import { normalizeHl } from "./searchApiExplore";
import type {
  ExploreDestinationFlightsQuery,
  FlightCalendarQuery,
} from "../../types/flights";

/** `google_flights_calendar` single-window key (kind: "calendar"). */
export function calendarCacheKey(q: FlightCalendarQuery): string {
  const today = new Date().toISOString().split("T")[0];
  return [
    "calendar:v1",
    today, // rolling window → refresh daily
    q.departureId.trim().toUpperCase(),
    q.arrivalId.trim().toUpperCase(),
    (q.currency || "EUR").toUpperCase(),
  ].join("|");
}

/** `google_travel_explore_destination` key (kind: "explore_destination"). */
export function exploreDestCacheKey(q: ExploreDestinationFlightsQuery): string {
  return [
    // Version tag — bump to invalidate stale entries / evolve the request shape.
    "exploreDest:v2",
    q.departureId.trim().toUpperCase(),
    q.arrivalId.trim().toUpperCase(),
    (q.currency || "EUR").toUpperCase(),
    normalizeHl(q.hl),
    q.travelClass || "economy",
    q.stops || "any",
    q.maxPrice != null ? String(q.maxPrice) : "nomax",
    q.adults != null ? String(q.adults) : "1",
    q.timePeriod || "default",
  ].join("|");
}
