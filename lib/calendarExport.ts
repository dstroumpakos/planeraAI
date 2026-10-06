import { Linking, Platform } from "react-native";
import * as Calendar from "expo-calendar";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/**
 * Export a trip's itinerary as an .ics file and hand it to the system share
 * sheet — Apple Calendar, Google Calendar and Outlook all import it. Keeps
 * the trip present outside the app (the calendar, the lock screen) without a
 * calendar permission prompt.
 *
 * One all-day event per trip day whose description lists the day's stops,
 * plus one all-day "trip" event spanning the whole range. Timed stops use
 * the day's `startTime` / `time` when it parses as HH:MM.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number) { return String(n).padStart(2, "0"); }
function icsDate(ts: number) {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function icsDateTime(ts: number) {
    const d = new Date(ts);
    return `${icsDate(ts)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function esc(s: string) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string) {
    // RFC 5545: lines longer than 75 octets are folded with CRLF + space.
    const out: string[] = [];
    let s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
    out.push(s);
    return out.join("\r\n");
}

export function buildTripIcs(trip: {
    _id: string; destination: string; startDate: number; endDate: number; itinerary?: any;
}): string {
    const stamp = icsDateTime(Date.now());
    const dest = String(trip.destination || "Trip");
    const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Planera AI//Trip//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ];

    // Whole-trip banner event (all-day, DTEND exclusive).
    lines.push(
        "BEGIN:VEVENT",
        `UID:trip-${trip._id}@planeraai.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(trip.startDate)}`,
        `DTEND;VALUE=DATE:${icsDate(trip.endDate + DAY_MS)}`,
        fold(`SUMMARY:${esc(`✈️ ${dest}`)}`),
        fold(`DESCRIPTION:${esc("Planned with Planera AI")}`),
        "END:VEVENT",
    );

    const days: any[] = trip.itinerary?.dayByDayItinerary || [];
    days.forEach((day, i) => {
        const dayStart = trip.startDate + i * DAY_MS;
        const acts: any[] = day.activities || [];
        if (acts.length === 0) return;
        const summary = `${dest} — Day ${day.day || i + 1}`;
        const desc = acts
            .map((a) => [a.startTime || a.time, a.title].filter(Boolean).join(" "))
            .join("\n");
        lines.push(
            "BEGIN:VEVENT",
            `UID:trip-${trip._id}-day-${i + 1}@planeraai.app`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${icsDate(dayStart)}`,
            `DTEND;VALUE=DATE:${icsDate(dayStart + DAY_MS)}`,
            fold(`SUMMARY:${esc(summary)}`),
            fold(`DESCRIPTION:${esc(desc)}`),
            "END:VEVENT",
        );
        // Timed stops as their own events so they show at the right hour.
        acts.forEach((a, j) => {
            const m = /^(\d{1,2}):(\d{2})/.exec(String(a.startTime || a.time || ""));
            if (!m || !a.title) return;
            const local = new Date(dayStart);
            local.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
            const start = local.getTime();
            const end = start + 90 * 60 * 1000;
            lines.push(
                "BEGIN:VEVENT",
                `UID:trip-${trip._id}-d${i + 1}-a${j}@planeraai.app`,
                `DTSTAMP:${stamp}`,
                `DTSTART:${icsDateTime(start)}`,
                `DTEND:${icsDateTime(end)}`,
                fold(`SUMMARY:${esc(a.title)}`),
                ...(a.address || a.location ? [fold(`LOCATION:${esc(a.address || a.location)}`)] : []),
                "END:VEVENT",
            );
        });
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
}

export async function shareTripCalendar(trip: {
    _id: string; destination: string; startDate: number; endDate: number; itinerary?: any;
}): Promise<boolean> {
    if (!(await Sharing.isAvailableAsync())) return false;
    const ics = buildTripIcs(trip);
    const safeName = String(trip.destination || "trip").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const file = new File(Paths.cache, `planera-${safeName}.ics`);
    file.write(ics);
    await Sharing.shareAsync(file.uri, {
        mimeType: "text/calendar",
        UTI: "com.apple.ical.ics",
        dialogTitle: trip.destination,
    });
    return true;
}

type CalendarTrip = {
    _id: string; destination: string; startDate: number; endDate: number; itinerary?: any;
};

/** The day-by-day plan as plain text, for the calendar event's notes. */
function tripNotes(trip: CalendarTrip): string {
    const days: any[] = trip.itinerary?.dayByDayItinerary || [];
    const blocks = days.map((day, i) => {
        const date = new Date(trip.startDate + i * DAY_MS)
            .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        const stops = (day.activities || [])
            .filter((a: any) => a?.title)
            .map((a: any) => `• ${[a.startTime || a.time, a.title].filter(Boolean).join(" ")}`)
            .join("\n");
        return `Day ${day.day || i + 1} · ${date}${day.title ? ` — ${day.title}` : ""}${stops ? `\n${stops}` : ""}`;
    });
    return [...blocks, "Planned with Planera AI · https://planeraai.app"].join("\n\n");
}

/** Midnight (device-local) on the trip's calendar day — the stored dates are UTC midnight. */
function localDay(ts: number): Date {
    const d = new Date(ts);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Jump to the trip's first day in the system calendar app. */
async function openCalendarAt(date: Date) {
    try {
        if (Platform.OS === "ios") {
            // calshow: takes seconds since 2001-01-01 (Apple reference date).
            const secs = Math.floor((date.getTime() - Date.UTC(2001, 0, 1)) / 1000);
            await Linking.openURL(`calshow:${secs}`);
        } else if (Platform.OS === "android") {
            await Linking.openURL(`content://com.android.calendar/time/${date.getTime()}`);
        }
    } catch {}
}

export type AddTripToCalendarResult = "saved" | "canceled" | "shared" | "unavailable";

/**
 * Add the trip to the phone's calendar the native way: opens the system
 * "New Event" editor (Apple Calendar on iOS, the calendar app on Android)
 * pre-filled with an all-day event spanning the trip and the full day-by-day
 * plan in its notes. No calendar permission is needed — the user confirms in
 * the OS UI. On iOS, once saved, it opens Calendar on the trip's first day.
 * Falls back to the .ics share sheet where the native editor isn't available.
 */
export async function addTripToCalendar(trip: CalendarTrip): Promise<AddTripToCalendarResult> {
    // EventKit all-day events take the last day itself as the end (not the next
    // midnight, which shows an extra day). Android's insert intent reads the
    // times through UTC, so use local noon there to keep east-of-UTC zones
    // from slipping back a day.
    const start = localDay(trip.startDate);
    const end = localDay(trip.endDate);
    if (Platform.OS === "android") {
        start.setHours(12);
        end.setHours(12);
    }

    if (Platform.OS === "ios" || Platform.OS === "android") {
        try {
            const result = await Calendar.createEventInCalendarAsync({
                title: `✈️ ${trip.destination || "Trip"}`,
                startDate: start,
                endDate: end,
                allDay: true,
                location: trip.destination,
                notes: tripNotes(trip),
                url: "https://planeraai.app",
            });
            if (result.action === "canceled") return "canceled";
            if (Platform.OS === "ios" && result.action === "saved") await openCalendarAt(start);
            return "saved";
        } catch (e) {
            console.warn("[calendar] native editor failed, falling back to .ics", e);
        }
    }
    return (await shareTripCalendar(trip)) ? "shared" : "unavailable";
}
