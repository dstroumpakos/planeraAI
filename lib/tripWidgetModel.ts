/**
 * The data a home-screen widget / Live Activity shows for the user's next
 * trip. Platform-agnostic: iOS (expo-widgets, `widgets/*.tsx`) and Android
 * (react-native-android-widget) both render from this shape, and the same
 * timeline builder feeds both, so the two platforms never disagree on what
 * "day 3 of 5" means.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export type TripWidgetMode = "idle" | "countdown" | "live" | "done";

export interface TripWidgetProps {
    mode: TripWidgetMode;
    tripId: string;
    destination: string;   // "Lisbon"
    country: string;       // "Portugal" or ""
    dateRange: string;     // "12–17 Oct"
    daysUntil: number;     // countdown mode
    day: number;           // live mode, 1-based
    total: number;         // live mode
    nextTitle: string;     // live/countdown: first or next stop
    nextTime: string;      // "09:30" or ""
    stops: number;         // stops that day
    weather: string;       // "☀️ 24°" or ""
    weatherIcon: string;   // SF symbol / ionicon-ish name or ""
}

export interface TripWidgetTimelineEntry {
    date: Date;
    props: TripWidgetProps;
}

export const IDLE_PROPS: TripWidgetProps = {
    mode: "idle", tripId: "", destination: "", country: "", dateRange: "",
    daysUntil: 0, day: 0, total: 0, nextTitle: "", nextTime: "", stops: 0, weather: "", weatherIcon: "",
};

function startOfLocalDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function fmtRange(start: number, end: number): string {
    const s = new Date(start), e = new Date(end);
    const m = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
    if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${m(e)}`;
    return `${s.getDate()} ${m(s)} – ${e.getDate()} ${m(e)}`;
}

/** The trip the widget should follow: live now, else the soonest upcoming (≤ 90 days). */
export function pickWidgetTrip(trips: any[] | null | undefined, now = Date.now()): any | null {
    if (!trips) return null;
    let live: any = null, next: any = null;
    for (const t of trips) {
        if (t.status !== "completed" || typeof t.startDate !== "number" || typeof t.endDate !== "number") continue;
        if (now >= startOfLocalDay(t.startDate) && now < startOfLocalDay(t.endDate) + DAY_MS) {
            if (!live || t.startDate > live.startDate) live = t;
        } else if (t.startDate > now && t.startDate - now <= 90 * DAY_MS) {
            if (!next || t.startDate < next.startDate) next = t;
        }
    }
    return live || next;
}

export interface WeatherLookup {
    /** Weather string for a calendar timestamp, e.g. "☀️ 24°", or "". */
    (ts: number): { text: string; icon: string };
}

/** Props for one specific moment of one trip. */
export function tripWidgetPropsAt(trip: any, at: number, weatherAt?: WeatherLookup): TripWidgetProps {
    const [destination, ...rest] = String(trip.destination || "").split(",").map((s: string) => s.trim());
    const country = rest[rest.length - 1] || "";
    const start = startOfLocalDay(trip.startDate);
    const end = startOfLocalDay(trip.endDate);
    const days: any[] = trip.itinerary?.dayByDayItinerary || [];
    const total = Math.max(days.length, Math.round((end - start) / DAY_MS) + 1);
    const base = {
        tripId: String(trip._id), destination, country, dateRange: fmtRange(trip.startDate, trip.endDate),
        daysUntil: 0, day: 0, total, nextTitle: "", nextTime: "", stops: 0, weather: "", weatherIcon: "",
    };
    const wx = weatherAt ? weatherAt(at) : { text: "", icon: "" };

    if (at < start) {
        const first = days[0]?.activities?.[0];
        return {
            ...base, mode: "countdown",
            daysUntil: Math.max(1, Math.round((start - startOfLocalDay(at)) / DAY_MS)),
            nextTitle: first?.title || "", nextTime: first?.startTime || first?.time || "",
            stops: days[0]?.activities?.length || 0,
            weather: wx.text, weatherIcon: wx.icon,
        };
    }
    if (at >= end + DAY_MS) return { ...base, mode: "done" };

    const dayIndex = Math.min(Math.floor((startOfLocalDay(at) - start) / DAY_MS), total - 1);
    const dayData = days[Math.min(dayIndex, days.length - 1)];
    const acts: any[] = dayData?.activities || [];
    // Next stop relative to `at`, else the day's first stop.
    const minutes = new Date(at).getHours() * 60 + new Date(at).getMinutes();
    let next = acts[0];
    for (const a of acts) {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(a.startTime || a.time || ""));
        if (m && parseInt(m[1], 10) * 60 + parseInt(m[2], 10) >= minutes - 30) { next = a; break; }
    }
    return {
        ...base, mode: "live", day: dayIndex + 1,
        nextTitle: next?.title || "", nextTime: next?.startTime || next?.time || "",
        stops: acts.length, weather: wx.text, weatherIcon: wx.icon,
    };
}

/**
 * A timeline the OS can play back without the app: one entry now, then one
 * per local midnight through the trip (plus an hourly one during trip days
 * so "next stop" advances), then a final idle/done entry.
 */
export function buildTripWidgetTimeline(trips: any[] | null | undefined, weatherAt?: WeatherLookup, now = Date.now()): TripWidgetTimelineEntry[] {
    const trip = pickWidgetTrip(trips, now);
    if (!trip) return [{ date: new Date(now), props: IDLE_PROPS }];

    const entries: TripWidgetTimelineEntry[] = [{ date: new Date(now), props: tripWidgetPropsAt(trip, now, weatherAt) }];
    const start = startOfLocalDay(trip.startDate);
    const endExclusive = startOfLocalDay(trip.endDate) + DAY_MS;

    // Countdown: a tick at every midnight until the trip starts (cap 90).
    for (let d = startOfLocalDay(now) + DAY_MS, n = 0; d < start && n < 90; d += DAY_MS, n++) {
        entries.push({ date: new Date(d), props: tripWidgetPropsAt(trip, d, weatherAt) });
    }
    // Trip days: hourly 07:00–22:00 so the next stop rolls forward.
    for (let d = Math.max(start, startOfLocalDay(now)); d < endExclusive; d += DAY_MS) {
        for (let h = 0; h <= 22; h++) {
            const at = d + h * 3_600_000;
            if (at <= now) continue;
            if (h !== 0 && h < 7) continue;
            entries.push({ date: new Date(at), props: tripWidgetPropsAt(trip, at, weatherAt) });
        }
    }
    entries.push({ date: new Date(endExclusive), props: { ...tripWidgetPropsAt(trip, endExclusive), mode: "done" } });
    // The day after "done", go idle (the app will refresh with the next trip on open).
    entries.push({ date: new Date(endExclusive + DAY_MS), props: IDLE_PROPS });
    return entries;
}
