import { useCallback, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import type { ExploreDestination, ExploreQuery } from "@/types/flights";

/**
 * Discover reachable destinations from a departure airport via the
 * searchapi.io Google Travel Explore Convex action ("Where can I go?").
 *
 * Stateful wrapper (mirrors `useFlightSearch`) so screens don't manage their
 * own loading/error flags. Auth + rate limit + cache live in the action.
 */
export function useExploreDestinations() {
  const explore = useAuthenticatedAction(api.explore.exploreDestinations);

  const [data, setData] = useState<ExploreDestination[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exploreDestinations = useCallback(
    async (input: ExploreQuery) => {
      setLoading(true);
      setError(null);
      try {
        const result = (await explore({ input })) as ExploreDestination[];
        setData(result);
        return result;
      } catch (err: any) {
        const message =
          err?.data?.message ||
          err?.message ||
          "Could not load destinations.";
        setError(message);
        setData(null);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [explore]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, exploreDestinations, reset };
}
