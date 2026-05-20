import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type {
  FlightBookingOptionsInput,
  NormalizedBookingOptionsResponse,
} from "@/types/flights";

/**
 * Fetches the provider booking options for a SerpApi `booking_token`.
 */
export function useFlightBookingOptions() {
  const fetchOptions = useAuthenticatedAction(
    api.flightsSerpApi.getBookingOptions
  );

  const [bookingOptions, setBookingOptions] =
    useState<NormalizedBookingOptionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getBookingOptions = useCallback(
    async (input: FlightBookingOptionsInput) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchOptions({ input });
        setBookingOptions(result);
        return result;
      } catch (err: any) {
        const message =
          err?.data?.message || err?.message || "Could not load booking options.";
        setError(message);
        setBookingOptions(null);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchOptions]
  );

  const reset = useCallback(() => {
    setBookingOptions(null);
    setError(null);
    setLoading(false);
  }, []);

  return { bookingOptions, loading, error, getBookingOptions, reset };
}
