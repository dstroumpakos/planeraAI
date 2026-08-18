import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type { FlightCalendar, FlightCalendarQuery } from "@/types/flights";

/**
 * Optional scan window for a calendar lookup. Omit entirely for the default
 * near-term teaser (one ~14-day window starting 8 days out); pass it to target
 * a specific month, e.g. "flights in November".
 */
export interface FlightCalendarScan {
  /** Days from today where the scan starts (clamped to 8 server-side). */
  startOffsetDays?: number;
  /** Stacked ~14-day windows to scan. Each is one API call on a cache miss. */
  windows?: number;
  /** Max departure dates to return. */
  maxDates?: number;
}

/**
 * "Cheapest days to fly" — round-trip price calendar for an origin→destination
 * pair via the searchapi.io `google_flights_calendar` Convex action. Auth +
 * rate limit + cache live in the action. Prices are indicative teasers; a
 * tapped date opens the real flight search prefilled with both legs.
 *
 * Stateful wrapper (mirrors `useExploreDestinationFlights`).
 */
export function useFlightCalendar(token?: string | null) {
  const run = useAuthenticatedAction(api.flightCalendar.flightCalendar, token);

  const [data, setData] = useState<FlightCalendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendar = useCallback(
    async (input: FlightCalendarQuery, scan?: FlightCalendarScan) => {
      if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
        setData(null);
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const result = (await run({
          input,
          ...(scan ?? {}),
        })) as FlightCalendar | null;
        setData(result);
        return result;
      } catch (err: any) {
        const message =
          err?.data?.message || err?.message || "Could not load flight dates.";
        setError(message);
        setData(null);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [run]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, fetchCalendar, reset };
}
