/**
 * Clock-time extraction for flight segment timestamps.
 *
 * The Google Flights providers are inconsistent about what they put in
 * `departure_airport.time` / `arrival_airport.time`: sometimes a full
 * `"2026-10-08 06:15"`, sometimes a bare `"06:15"`, occasionally an ISO
 * `"2026-10-08T06:15"`. Splitting on a space and taking `[1]` therefore works
 * on some responses and silently yields nothing on others — which is how a
 * flight reached the trip screen with empty departure/arrival times and a
 * return leg that collapsed to a bare date.
 *
 * Mirrors `convex/lib/searchApiFlights.ts:extractHm` (server side).
 */

/**
 * Pull a zero-padded `"HH:MM"` out of any of the shapes above.
 * Returns `""` when the input holds no recognizable clock time, so callers can
 * treat "no time" as falsy — never as a bogus timestamp.
 */
export function extractClockTime(value?: string | null): string {
    if (!value) return "";
    const m = String(value).match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    return `${m[1].padStart(2, "0")}:${m[2]}`;
}
