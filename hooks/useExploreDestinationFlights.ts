import { useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type {
  ExploreDestinationFlights,
  ExploreDestinationFlightsQuery,
} from "@/types/flights";

/**
 * Resolve the viewer's origin IATA from their saved home airport. `homeAirport`
 * is free text (e.g. "London (LHR)") so we pull the last bare 3-letter code out
 * of it — same extraction the Explore screen uses. Returns undefined when no
 * usable code is present, which is the signal for the preview module to hide
 * its flights section rather than guess an origin.
 */
export function useResolvedHomeIata(token?: string | null): string | undefined {
  const settings = useQuery(
    api.users.getSettings as any,
    token ? { token } : "skip"
  );
  return useMemo(() => {
    const raw = (settings as any)?.homeAirport as string | undefined;
    if (!raw) return undefined;
    const matches = raw.toUpperCase().match(/\b([A-Z]{3})\b/g);
    return matches ? matches[matches.length - 1] : undefined;
  }, [settings]);
}

/**
 * "Flights from your city, from €X" teaser for a destination preview page.
 *
 * Fetches indicative flight options for a resolved origin → destination pair
 * via the searchapi.io `google_travel_explore_destination` Convex action. Auth
 * + rate limit + cache live in the action. Prices are teasers, NOT bookable —
 * the "See flights" CTA should route into the real flight search.
 *
 * Stateful wrapper (mirrors `useExploreDestinations`) so the preview page
 * doesn't manage its own loading/error flags.
 */
export function useExploreDestinationFlights(token?: string | null) {
  const run = useAuthenticatedAction(
    api.exploreDestination.exploreDestinationFlights,
    token
  );

  const [data, setData] = useState<ExploreDestinationFlights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFlights = useCallback(
    async (input: ExploreDestinationFlightsQuery) => {
      // No resolvable origin → nothing to show; skip the round-trip entirely.
      if (!input.departureId?.trim() || !input.arrivalId?.trim()) {
        setData(null);
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const result = (await run({
          input,
        })) as ExploreDestinationFlights | null;
        setData(result);
        return result;
      } catch (err: any) {
        const message =
          err?.data?.message ||
          err?.message ||
          "Could not load flights for this destination.";
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

  return { data, loading, error, fetchFlights, reset };
}
