import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type {
  FlightSearchInput,
  NormalizedFlightSearchResponse,
} from "@/types/flights";

/**
 * Search Google Flights via the searchapi.io-backed Convex action.
 *
 * Returns a stateful wrapper so screens don't have to manage their own
 * loading/error flags. The underlying action does its own auth/cache logic.
 */
export function useFlightSearch() {
  const search = useAuthenticatedAction(api.flightsSearchApi.searchFlights);

  const [data, setData] = useState<NormalizedFlightSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchFlights = useCallback(
    async (input: FlightSearchInput) => {
      setLoading(true);
      setError(null);
      try {
        const result = (await search({ input })) as NormalizedFlightSearchResponse;
        setData(result);
        return result;
      } catch (err: any) {
        const message =
          err?.data?.message || err?.message || "Could not search flights.";
        setError(message);
        setData(null);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [search]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, searchFlights, reset };
}
