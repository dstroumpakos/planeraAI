/**
 * The invariant: a flight time shown in the Bookings inbox must show the SAME
 * clock time on the create-trip screen, in every timezone.
 *
 * The two screens use opposite conventions — the inbox renders the absolute
 * instant in device-local time, while create-trip stores local wall-clock hours
 * on a UTC instant and reads them back with timeZone:'UTC'. Encoding across that
 * boundary is easy to get off by the device's offset, which would silently move
 * a 20:45 landing.
 *
 *   npx tsx scripts/test-flight-time-prefill.ts
 */

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`); }
}

/** Verbatim from app/settings/reservations.tsx. */
function toWallClockIso(ms?: number): string | undefined {
    if (!ms) return undefined;
    const d = new Date(ms);
    return new Date(Date.UTC(
        d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0
    )).toISOString();
}

/** Verbatim from app/create-trip.tsx (formatTime). */
function formatTimeOnCreateTrip(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC",
    });
}

/** How the Bookings inbox renders the same instant (formatWhen). */
function formatTimeInInbox(ms: number): string {
    return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

console.log(`\nTZ=${process.env.TZ ?? "(system default)"}`);

// The screenshot's booking: outbound lands 10:40, return departs 17:30.
const LANDING = Date.parse("2026-12-12T10:40:00+01:00");
const TAKEOFF = Date.parse("2026-12-16T17:30:00+01:00");

for (const [label, instant] of [["landing", LANDING], ["take-off", TAKEOFF]] as const) {
    const iso = toWallClockIso(instant)!;
    check(
        `${label}: create-trip shows what the inbox showed`,
        formatTimeOnCreateTrip(iso),
        formatTimeInInbox(instant)
    );
}

// A red-eye: the instant most likely to slip a day across the date line.
const REDEYE = Date.parse("2026-12-12T23:50:00+01:00");
check(
    "red-eye keeps its clock time",
    formatTimeOnCreateTrip(toWallClockIso(REDEYE)!),
    formatTimeInInbox(REDEYE)
);

check("missing instant yields nothing to prefill", toWallClockIso(undefined), undefined);
check("zero is treated as absent, not as 1970", toWallClockIso(0), undefined);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
