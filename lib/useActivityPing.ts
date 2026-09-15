import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";

/**
 * Activity ping behind the retention KPIs (DAU/WAU/MAU, D1/D7/D30 cohorts).
 *
 * Fires `retention.touchActive` + an `app_open` marketing event on mount and
 * whenever the app returns to the foreground, throttled to once per 30 min
 * on the client (the server enforces the same gap). Fire-and-forget: a
 * failed ping must never affect the session.
 */
const MIN_GAP_MS = 30 * 60 * 1000;

export function useActivityPing() {
    const convex = useConvex();
    const { token } = useToken();
    const lastPing = useRef(0);

    useEffect(() => {
        if (!token) return;

        // Device zone → server quiet hours for pushes. Hermes ships Intl; the
        // try/catch is for anything that doesn't.
        let timezone: string | undefined;
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch {}

        const ping = () => {
            const now = Date.now();
            if (now - lastPing.current < MIN_GAP_MS) return;
            lastPing.current = now;
            // `as any`: retention.ts postdates the generated api types.
            convex
                .mutation((api as any).retention.touchActive, { token, platform: Platform.OS, timezone })
                .catch(() => {});
            convex
                .mutation((api as any).marketingEvents.track, { event: "app_open", surface: `app-${Platform.OS}` })
                .catch(() => {});
        };

        ping();
        const sub = AppState.addEventListener("change", (state) => {
            if (state === "active") ping();
        });
        return () => sub.remove();
    }, [token, convex]);
}
