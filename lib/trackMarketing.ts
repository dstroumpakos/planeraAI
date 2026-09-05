import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Marketing funnel counters (see convex/marketingEvents.ts).
 *
 * These feed the "Marketing funnel" panel in the website admin dashboard, so a
 * copy or layout change can be judged against a number instead of a hunch. The
 * website has its own copy of this hook (src/lib/track.ts) hitting the same
 * mutation, which is what makes app and web counts comparable.
 *
 * Nothing identifying is sent: an event name, a surface label, and — when the
 * surface is under A/B test — a variant string. Fire-and-forget: a failed
 * counter must never block a navigation.
 */
export type MarketingEvent =
  | "destination_click"
  | "destination_view"
  | "trip_start"
  | "trip_created"
  | "onboarding_start"
  | "onboarding_complete"
  | "upgrade_view"
  | "signup_start";

export function useTrackMarketing() {
  // `as any`: the generated api types lag a `npx convex codegen`. The runtime
  // reference resolves by path, so the call works regardless.
  const track = useMutation((api as any).marketingEvents.track);

  return useCallback(
    (event: MarketingEvent, surface: string, variant?: string) => {
      void track({ event, surface, ...(variant ? { variant } : {}) }).catch(() => {});
    },
    [track],
  );
}
