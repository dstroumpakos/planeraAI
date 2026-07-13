import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type { FlightCalendar, FlightCalendarQuery } from "@/types/flights";

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
    async (input: FlightCalendarQuery) => {
      if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
        setData(null);
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const result = (await run({ input })) as FlightCalendar | null;
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
