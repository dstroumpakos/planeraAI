import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { buildTripWidgetTimeline, pickWidgetTrip, tripWidgetPropsAt, type TripWidgetProps, type WeatherLookup } from "@/lib/tripWidgetModel";
import { useTripWeather, forecastForDay, weatherGlyph } from "@/lib/weather";

/**
 * Keeps the iOS home-screen widget and the trip Live Activity in sync with
 * the user's next trip (see widgets/*.tsx).
 *
 *  - Widget: a full timeline (one entry per midnight, hourly on trip days) so
 *    the countdown and "next stop" advance with the app closed.
 *  - Live Activity: started fresh each time the app comes to the foreground
 *    during a live trip (the system retires activities after ~8 h anyway),
 *    ended once the trip is over.
 *
 * The native module only exists in a dev/production build made after
 * expo-widgets was added — in Expo Go or an older binary the lazy require
 * throws and the hook becomes a no-op rather than crashing the app.
 */
type Mods = {
    widget: { updateTimeline: (entries: { date: Date; props: TripWidgetProps }[]) => void };
    activity: {
        start: (props: TripWidgetProps, url?: string) => any;
        getInstances: () => { end: (policy?: any, props?: TripWidgetProps) => Promise<void>; update: (p: TripWidgetProps) => Promise<void> }[];
    };
};
let mods: Mods | null | undefined;
function loadWidgets(): Mods | null {
    if (Platform.OS !== "ios") return null;
    if (mods === undefined) {
        try {
            mods = {
                widget: require("@/widgets/TripCountdownWidget").default,
                activity: require("@/widgets/TripLiveActivity").default,
            };
        } catch (e) {
            console.log("[widgets] expo-widgets unavailable in this binary — skipping", String(e).slice(0, 120));
            mods = null;
        }
    }
    return mods;
}

export function useTripWidgets() {
    const { token } = useToken();
    const trips = useQuery(api.trips.list as any, token ? { token } : "skip") as any[] | undefined;
    const trip = useMemo(() => pickWidgetTrip(trips), [trips]);
    const forecast = useTripWeather(trip);
    const lastSync = useRef("");

    useEffect(() => {
        if (Platform.OS !== "ios" || trips === undefined) return;
        const m = loadWidgets();
        if (!m) return;

        const weatherAt: WeatherLookup = (ts) => {
            const d = forecastForDay(forecast, ts);
            return d ? { text: `${weatherGlyph(d.code).emoji} ${Math.round(d.tMax)}°`, icon: weatherGlyph(d.code).icon } : { text: "", icon: "" };
        };

        const sync = () => {
            try {
                const now = Date.now();
                const entries = buildTripWidgetTimeline(trips, weatherAt, now);
                // Avoid re-writing an identical timeline on every foreground.
                const sig = `${trip?._id || "-"}:${entries.length}:${entries[0]?.props.mode}:${entries[0]?.props.day}:${entries[0]?.props.nextTitle}:${entries[0]?.props.weather}`;
                if (sig !== lastSync.current) {
                    m.widget.updateTimeline(entries);
                    lastSync.current = sig;
                }

                const props = trip ? tripWidgetPropsAt(trip, now, weatherAt) : null;
                const instances = m.activity.getInstances();
                if (props && props.mode === "live") {
                    // One activity at a time; restart so the 8-hour clock resets.
                    for (const inst of instances) inst.end("immediate").catch(() => {});
                    m.activity.start(props, `planeraai://trip/${props.tripId}`);
                } else {
                    for (const inst of instances) inst.end("immediate", props || undefined).catch(() => {});
                }
            } catch (e) {
                console.warn("[widgets] sync failed", e);
            }
        };

        sync();
        const sub = AppState.addEventListener("change", (s) => { if (s === "active") sync(); });
        return () => sub.remove();
    }, [trips, trip?._id, forecast]);
}
