/**
 * Unit checks for inbound reservation -> trip matching.
 *
 * The regression these exist for: a one-way ATH -> SKG flight was filed under a
 * Madeira trip because it was the only trip whose dates overlapped, and the
 * single-candidate path returned before the destination was ever compared.
 *
 *   npx tsx scripts/test-trip-match.ts
 */

import {
    buildMatchHaystack,
    extractDestination,
    journeyDestination,
    splitJourney,
    groupJourneyLegs,
    pickMatchingTrip,
    TRIP_MATCH_SLACK_MS,
} from "../convex/helpers/tripMatch";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(expected === actual ? actual : actual)}`); }
}

const day = (iso: string) => Date.parse(iso);

// The actual trip the reservation was wrongly attached to.
const MADEIRA = {
    id: "madeira",
    destination: "Madeira, Portugal",
    startDate: day("2026-08-20T00:00:00Z"),
    endDate: day("2026-08-27T00:00:00Z"),
    status: "completed",
};
const THESSALONIKI = {
    id: "skg",
    destination: "Thessaloniki, Greece",
    startDate: day("2026-08-24T00:00:00Z"),
    endDate: day("2026-08-30T00:00:00Z"),
    status: "planned",
};
// Same dates as MADEIRA, to prove origin no longer votes.
const ATHENS = {
    id: "ath",
    destination: "Athens, Greece",
    startDate: day("2026-08-20T00:00:00Z"),
    endDate: day("2026-08-27T00:00:00Z"),
    status: "planned",
};

// The real reservation, verbatim from the row the pipeline wrote.
const FLIGHT_START = day("2026-08-25T09:30:00Z");
const FLIGHT_TITLE = "Athens (ATH) → Thessaloniki (SKG)";
const FLIGHT_LOCATION = "Athens International Airport";
const FLIGHT_DETAILS = { flightNumber: "HN 742", cabin: "economy", passengers: 1 };

const flightHaystack = buildMatchHaystack("flight", FLIGHT_LOCATION, FLIGHT_TITLE, FLIGHT_DETAILS);

console.log("\nbuildMatchHaystack - only the arrival end may vote");
check("origin airport excluded for flights", /Athens International/.test(flightHaystack), false);
check("origin city excluded for flights", /Athens/.test(flightHaystack), false);
check("destination retained", /Thessaloniki/.test(flightHaystack), true);
check("destination code retained", /SKG/.test(flightHaystack), true);
check(
    "hotel keeps its address (that IS the destination)",
    buildMatchHaystack("hotel", "Rua das Pretas 12, Funchal", "Hotel Madeira", null).includes("Funchal"),
    true
);
check(
    "arrivalCity preferred when present",
    buildMatchHaystack("flight", undefined, "ATH → SKG", { arrivalCity: "Thessaloniki" }).includes("Thessaloniki"),
    true
);
check(
    "title without an arrow is used whole",
    buildMatchHaystack("flight", undefined, "Flight to Thessaloniki", null),
    "Flight to Thessaloniki"
);

console.log("\npickMatchingTrip - THE REGRESSION");
check(
    "lone overlapping trip with wrong destination is NOT matched",
    pickMatchingTrip([MADEIRA], FLIGHT_START, flightHaystack),
    null
);
check(
    "correct trip is matched when present",
    pickMatchingTrip([MADEIRA, THESSALONIKI], FLIGHT_START, flightHaystack)?.id,
    "skg"
);
check(
    "origin city does not attract the booking",
    pickMatchingTrip([ATHENS], FLIGHT_START, flightHaystack),
    null
);
check(
    "correct trip wins over an origin-named trip",
    pickMatchingTrip([ATHENS, THESSALONIKI], FLIGHT_START, flightHaystack)?.id,
    "skg"
);

console.log("\npickMatchingTrip - general behaviour");
check("no startAt means no match", pickMatchingTrip([THESSALONIKI], undefined, flightHaystack), null);
check(
    "no overlapping window means no match",
    pickMatchingTrip([THESSALONIKI], day("2026-12-01T00:00:00Z"), flightHaystack),
    null
);
check(
    "archived trips are ignored",
    pickMatchingTrip([{ ...THESSALONIKI, status: "archived" }], FLIGHT_START, flightHaystack),
    null
);
check(
    "slack window still admits a red-eye the night before",
    pickMatchingTrip(
        [THESSALONIKI],
        THESSALONIKI.startDate - TRIP_MATCH_SLACK_MS + 60_000,
        flightHaystack
    )?.id,
    "skg"
);
check(
    "matches by IATA code when the trip carries one",
    pickMatchingTrip(
        [{ id: "code", destination: "SKG", startDate: THESSALONIKI.startDate, endDate: THESSALONIKI.endDate }],
        FLIGHT_START,
        flightHaystack
    )?.id,
    "code"
);
check(
    "empty haystack falls back to nearest date",
    pickMatchingTrip([MADEIRA, THESSALONIKI], FLIGHT_START, "")?.id,
    "skg"
);
check(
    "ties broken by nearest start, not array order",
    pickMatchingTrip(
        [
            { id: "far", destination: "Thessaloniki", startDate: day("2026-08-20T00:00:00Z"), endDate: day("2026-08-27T00:00:00Z") },
            { id: "near", destination: "Thessaloniki", startDate: day("2026-08-25T00:00:00Z"), endDate: day("2026-08-30T00:00:00Z") },
        ],
        FLIGHT_START,
        flightHaystack
    )?.id,
    "near"
);

console.log("\nextractDestination - feeds the 'plan a trip here' prompt");
check(
    "flight arrival, code stripped",
    extractDestination("flight", FLIGHT_LOCATION, FLIGHT_TITLE, FLIGHT_DETAILS),
    "Thessaloniki"
);
check(
    "explicit arrivalCity wins",
    extractDestination("flight", FLIGHT_LOCATION, FLIGHT_TITLE, { arrivalCity: "Thessaloniki, Greece" }),
    "Thessaloniki, Greece"
);
check(
    "one-sided flight title yields nothing (never guess the origin)",
    extractDestination("flight", "Athens International Airport", "Aegean flight A3 700", null),
    undefined
);
check(
    "hotel city from address tail",
    extractDestination("hotel", "Rua das Pretas 12, Funchal", "Hotel Madeira", null),
    "Funchal"
);
check(
    "hotel with explicit city beats the address",
    extractDestination("hotel", "Rua das Pretas 12, Funchal", "Hotel Madeira", { city: "Funchal, Madeira" }),
    "Funchal, Madeira"
);
check("nothing to go on", extractDestination("other", undefined, "Booking", null), undefined);
check(
    "ascii arrow handled",
    extractDestination("rail", undefined, "Athens -> Thessaloniki", null),
    "Thessaloniki"
);

console.log("\njourneyDestination - a round trip is ONE trip");
const OUTBOUND = {
    type: "flight",
    title: "Athens (ATH) → Thessaloniki (SKG)",
    location: "Athens International Airport",
    details: null,
    startAt: day("2026-08-25T09:30:00Z"),
};
const RETURN = {
    type: "flight",
    title: "Thessaloniki (SKG) → Athens (ATH)",
    location: "Thessaloniki Airport",
    details: null,
    startAt: day("2026-08-29T18:20:00Z"),
};

check("round trip resolves to the outbound destination", journeyDestination([OUTBOUND, RETURN]), "Thessaloniki");
check("leg order does not matter (sorted by time)", journeyDestination([RETURN, OUTBOUND]), "Thessaloniki");
check("one-way keeps its only arrival", journeyDestination([OUTBOUND]), "Thessaloniki");
check(
    "open-jaw takes the final arrival, not the first",
    journeyDestination([
        OUTBOUND,
        { ...RETURN, title: "Thessaloniki (SKG) → Rome (FCO)" },
    ]),
    "Rome"
);
check(
    "loop closed by IATA code alone still pairs",
    journeyDestination([
        { ...OUTBOUND, title: "ATH → SKG" },
        { ...RETURN, title: "SKG → ATH" },
    ]),
    "SKG"
);
check("hotels alone yield no journey destination", journeyDestination([
    { type: "hotel", title: "Hotel Bristol", location: "Nikis 12, Thessaloniki", details: null, startAt: day("2026-08-25T14:00:00Z") },
]), undefined);

console.log("\nsplitJourney - arrow forms seen in the wild");
const ends = (title: string) => {
    const j = splitJourney(title);
    return j ? `${j.from}|${j.to}` : null;
};
check("plain arrow", ends("Athens (ATH) → Vienna (VIE)"), "Athens (ATH)|Vienna (VIE)");
// The one that shipped broken: the model writes a round trip with a double head.
check("double-headed arrow", ends("Athens (ATH) ↔ Vienna (VIE)"), "Athens (ATH)|Vienna (VIE)");
check("ascii double head", ends("Athens <-> Vienna"), "Athens|Vienna");
check("ascii arrow", ends("Athens -> Vienna"), "Athens|Vienna");
check("fat arrow", ends("Athens => Vienna"), "Athens|Vienna");
check("reversed arrow flips the ends", ends("Athens ← Vienna"), "Vienna|Athens");
check("reversed ascii flips the ends", ends("Athens <- Vienna"), "Vienna|Athens");
check("no arrow is not a journey", ends("Aegean flight A3 700"), null);
check("dangling arrow is not a journey", ends("Athens →"), null);

console.log("\nthe exact booking from the screenshot (V3NA7P)");
const VIE_OUT = {
    type: "flight",
    title: "Athens (ATH) ↔ Vienna (VIE)",
    location: "Athens International Airport",
    details: null,
    startAt: day("2026-12-12T09:20:00Z"),
};
const VIE_RET = {
    type: "flight",
    title: "Vienna (VIE) → Athens (ATH)",
    location: "Vienna International Airport",
    details: null,
    startAt: day("2026-12-16T17:30:00Z"),
};
check("round trip reads as Vienna, not Athens", journeyDestination([VIE_OUT, VIE_RET]), "Vienna");
check(
    "outbound leg alone still reads as Vienna",
    extractDestination(VIE_OUT.type, VIE_OUT.location, VIE_OUT.title, VIE_OUT.details),
    "Vienna"
);

console.log("\npickMatchingTrip - the return leg must not spawn a second trip");
// Inheriting the journey destination, the return leg matches the same trip.
check(
    "return leg carrying the journey destination joins the outbound trip",
    pickMatchingTrip([THESSALONIKI], day("2026-08-29T18:20:00Z"), {
        destination: "Thessaloniki",
        origin: "Thessaloniki",
    })?.id,
    "skg"
);
// Forwarded on its own, with no sibling leg to pair against.
check(
    "lone return leg attaches by origin in the back half of the trip",
    pickMatchingTrip([THESSALONIKI], day("2026-08-29T18:20:00Z"), {
        destination: "Athens",
        origin: "Thessaloniki",
    })?.id,
    "skg"
);
check(
    "an OUTBOUND flight early in the window is not treated as a return",
    pickMatchingTrip([THESSALONIKI], day("2026-08-24T08:00:00Z"), {
        destination: "Athens",
        origin: "Thessaloniki",
    }),
    null
);
check(
    "origin never outranks a real destination match",
    pickMatchingTrip([ATHENS, THESSALONIKI], day("2026-08-25T09:30:00Z"), {
        destination: "Thessaloniki",
        origin: "Athens",
    })?.id,
    "skg"
);
check(
    "origin alone cannot invent a match for an unrelated trip",
    pickMatchingTrip([MADEIRA], day("2026-08-26T18:20:00Z"), {
        destination: "Athens",
        origin: "Thessaloniki",
    }),
    null
);

console.log("\ngroupJourneyLegs - two boarding passes, one booking");
// Exactly what the inbox showed: two cards, one purchase, price on both legs.
const V3NA7P_OUT = { _id: "a", type: "flight", title: "Athens (ATH) ↔ Vienna (VIE)", confirmationCode: "V3NA7P", startAt: day("2026-12-12T09:20:00Z"), endAt: day("2026-12-12T10:40:00Z"), price: 354.2, currency: "EUR" };
const V3NA7P_RET = { _id: "b", type: "flight", title: "Vienna (VIE) → Athens (ATH)", confirmationCode: "V3NA7P", startAt: day("2026-12-16T17:30:00Z"), endAt: day("2026-12-16T20:45:00Z"), price: 354.2, currency: "EUR" };

const grouped = groupJourneyLegs([V3NA7P_RET, V3NA7P_OUT]);
check("two legs collapse to one item", grouped.length, 1);
check("legs ordered chronologically", grouped[0].legs.map((l: any) => l._id), ["a", "b"]);
check("recognised as a round trip", grouped[0].isRoundTrip, true);
check("destination is Vienna, not Athens", grouped[0].destination, "Vienna");
check("label reads as a round trip", grouped[0].label, "Athens (ATH) ↔ Vienna (VIE)");
check("spans outbound departure to return arrival", [grouped[0].startAt, grouped[0].endAt], [V3NA7P_OUT.startAt, V3NA7P_RET.endAt]);
// The visible symptom: EUR 354.2 twice reads as a EUR 708 booking.
check("repeated booking total is not doubled", grouped[0].price, 354.2);

check(
    "genuinely different leg prices are summed",
    groupJourneyLegs([
        { ...V3NA7P_OUT, price: 120 },
        { ...V3NA7P_RET, price: 90 },
    ])[0].price,
    210
);
check(
    "different bookings stay separate",
    groupJourneyLegs([V3NA7P_OUT, { ...V3NA7P_RET, confirmationCode: "OTHER1" }]).length,
    2
);
check(
    "legs with no confirmation code are never merged",
    groupJourneyLegs([
        { ...V3NA7P_OUT, confirmationCode: undefined },
        { ...V3NA7P_RET, confirmationCode: undefined },
    ]).length,
    2
);
check(
    "two hotel stays on one reference remain two stays",
    groupJourneyLegs([
        { _id: "h1", type: "hotel", title: "Hotel A", confirmationCode: "SAME", startAt: day("2026-12-12T14:00:00Z") },
        { _id: "h2", type: "hotel", title: "Hotel B", confirmationCode: "SAME", startAt: day("2026-12-14T14:00:00Z") },
    ]).length,
    2
);
check(
    "open-jaw is one booking but not a round trip",
    (() => {
        const g = groupJourneyLegs([V3NA7P_OUT, { ...V3NA7P_RET, title: "Vienna (VIE) → Rome (FCO)" }])[0];
        return [g.isRoundTrip, g.label, g.destination];
    })(),
    [false, "Athens (ATH) → Rome (FCO)", "Rome"]
);
check("a lone booking still yields one group", groupJourneyLegs([V3NA7P_OUT]).length, 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
