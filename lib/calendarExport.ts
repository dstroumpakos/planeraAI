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
