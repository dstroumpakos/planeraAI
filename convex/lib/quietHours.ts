import { iataToCountry } from "./airportCountry";
import { resolveHomeIata } from "../../lib/homeAirport";

/**
 * Quiet hours for pushes that aren't time-critical (dormancy ladder, deals,
 * credits, recap, anniversary...). A push is allowed between
 * QUIET_END_HOUR and QUIET_START_HOUR in the user's LOCAL time; anything
 * outside is rescheduled for the next QUIET_END_HOUR.
 *
 * Timezone sources, in order: the IANA zone the device reports with the
 * activity ping (`userSettings.timezone`), the home airport's country, and
 * finally Europe/Athens (where most users are).
 */
export const QUIET_START_HOUR = 21; // no pushes from 21:00…
export const QUIET_END_HOUR = 9;    // …until 09:00 local

// Capital-city zone per ISO-2 country. Countries spanning several zones get
// their most populous one; that is still far closer than UTC for everyone.
const COUNTRY_TZ: Record<string, string> = {
    gr: "Europe/Athens", cy: "Asia/Nicosia", fr: "Europe/Paris", de: "Europe/Berlin", it: "Europe/Rome",
    es: "Europe/Madrid", pt: "Europe/Lisbon", gb: "Europe/London", ie: "Europe/Dublin", nl: "Europe/Amsterdam",
    be: "Europe/Brussels", ch: "Europe/Zurich", at: "Europe/Vienna", cz: "Europe/Prague", pl: "Europe/Warsaw",
    hu: "Europe/Budapest", ro: "Europe/Bucharest", bg: "Europe/Sofia", hr: "Europe/Zagreb", rs: "Europe/Belgrade",
    si: "Europe/Ljubljana", sk: "Europe/Bratislava", dk: "Europe/Copenhagen", se: "Europe/Stockholm", no: "Europe/Oslo",
    fi: "Europe/Helsinki", ee: "Europe/Tallinn", lv: "Europe/Riga", lt: "Europe/Vilnius", mt: "Europe/Malta",
    tr: "Europe/Istanbul", ua: "Europe/Kyiv", ge: "Asia/Tbilisi", il: "Asia/Jerusalem", ae: "Asia/Dubai",
    qa: "Asia/Qatar", sa: "Asia/Riyadh", eg: "Africa/Cairo", ma: "Africa/Casablanca", za: "Africa/Johannesburg",
    us: "America/New_York", ca: "America/Toronto", mx: "America/Mexico_City", br: "America/Sao_Paulo",
    ar: "America/Argentina/Buenos_Aires", jp: "Asia/Tokyo", kr: "Asia/Seoul", cn: "Asia/Shanghai",
    hk: "Asia/Hong_Kong", sg: "Asia/Singapore", th: "Asia/Bangkok", vn: "Asia/Ho_Chi_Minh", id: "Asia/Jakarta",
    in: "Asia/Kolkata", au: "Australia/Sydney", nz: "Pacific/Auckland",
};

// Fallback offsets (hours, standard time) for when the runtime's Intl can't
// resolve a zone. Off by one during DST, which is acceptable for a 12-hour
// window.
const TZ_OFFSET_FALLBACK: Record<string, number> = {
    "Europe/Athens": 2, "Europe/Paris": 1, "Europe/Berlin": 1, "Europe/Rome": 1, "Europe/Madrid": 1,
    "Europe/Lisbon": 0, "Europe/London": 0, "Europe/Istanbul": 3, "Asia/Dubai": 4, "America/New_York": -5,
    "America/Los_Angeles": -8, "Asia/Tokyo": 9, "Australia/Sydney": 10, "Asia/Kolkata": 5.5,
};

export function resolveUserTimezone(settings: { timezone?: string | null; homeAirport?: string | null } | null | undefined): string {
    if (settings?.timezone && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(settings.timezone)) return settings.timezone;
    const iata = resolveHomeIata(settings?.homeAirport);
    const cc = iataToCountry(iata);
    return (cc && COUNTRY_TZ[cc]) || "Europe/Athens";
}

/** Local hour (0–23) in `timeZone` at `now`. */
export function localHour(timeZone: string, now: number = Date.now()): number {
    try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(new Date(now));
        const h = Number(parts.find((p) => p.type === "hour")?.value);
        if (Number.isFinite(h)) return h % 24;
    } catch {
        // Fall through to the fixed-offset table.
    }
    const offset = TZ_OFFSET_FALLBACK[timeZone] ?? 2;
    return ((Math.floor((now / 3_600_000) + offset) % 24) + 24) % 24;
}

/**
 * Milliseconds to wait before sending, or 0 when it's fine to send now.
 * Deferred sends land at QUIET_END_HOUR local (plus up to 20 min of jitter,
 * so a whole timezone doesn't get hit in the same second).
 */
export function quietHoursDelayMs(timeZone: string, now: number = Date.now()): number {
    const h = localHour(timeZone, now);
    if (h >= QUIET_END_HOUR && h < QUIET_START_HOUR) return 0;
    const hoursUntilOk = h >= QUIET_START_HOUR ? 24 - h + QUIET_END_HOUR : QUIET_END_HOUR - h;
    // Snap to the top of the hour, then add jitter.
    const msIntoHour = now % 3_600_000;
    const jitter = Math.floor(Math.random() * 20 * 60 * 1000);
    return hoursUntilOk * 3_600_000 - msIntoHour + jitter;
}
