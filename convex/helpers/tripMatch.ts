/**
 * Pure helpers deciding which trip an inbound reservation belongs to.
 *
 * Kept free of Convex imports (same reasoning as helpers/inboundEmail.ts) so
 * the matching rules can be exercised directly — see
 * scripts/test-trip-match.ts. Used by reservations.upsertFromEmail.
 */

// A reservation this far outside the trip window still counts as a match
// (red-eyes, late check-outs, a train the evening before departure).
export const TRIP_MATCH_SLACK_MS = 36 * 60 * 60 * 1000;

/**
 * What we compare a reservation against a trip with.
 *
 * `origin` exists only to recognise a flight home; it must never be allowed to
 * pick a destination, or a booking out of Athens attaches itself to an Athens
 * trip.
 */
export type MatchSignals = {
    destination?: string;
    origin?: string;
};

/** Minimal shape this module needs; the real rows carry far more. */
export type MatchableTrip = {
    destination?: string;
    startDate: number;
    endDate: number;
    status?: string;
};

/**
 * Normalize a place string for loose comparison ("Barcelona, Spain" → "barcelona spain").
 */
export function normalizePlace(value: string | undefined): string {
    if (!value) return "";
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Arrows the extractor puts between the two ends of a journey title.
 *
 * Longest forms first — "<->" must be tried before the "<-" inside it. The
 * double-headed forms are how the model writes a round trip in a single row
 * ("Athens (ATH) ↔ Vienna (VIE)"); the left side is still where you start.
 */
const JOURNEY_ARROW_ALTERNATIVES = "↔|⇄|⇌|<->|<=>|<-|<=|←|⇐|→|➔|➜|⇒|—>|–>|->|=>";
const JOURNEY_ARROW_CAPTURE = new RegExp(`\\s*(${JOURNEY_ARROW_ALTERNATIVES})\\s*`);
/** Arrows that point back the way they came: "Athens ← Vienna" starts in Vienna. */
const REVERSED_ARROW = /^(?:<-|<=|←|⇐)$/;

const JOURNEY_TYPES = new Set(["flight", "rail", "ferry"]);

/** Strip the "(SKG)" code and tidy whitespace off one end of a journey title. */
function cleanPlace(value: string): string {
    return value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split "Athens (ATH) → Vienna (VIE)" into where it starts and where it ends,
 * honouring arrows that read right-to-left. Returns null when the title names
 * no journey at all.
 *
 * Ends come back verbatim, airport codes intact, because matching wants "VIE".
 * Callers showing this to a human run it through cleanPlace first.
 */
export function splitJourney(title: string): { from: string; to: string } | null {
    const match = title.match(JOURNEY_ARROW_CAPTURE);
    if (!match || match.index === undefined) return null;

    const left = title.slice(0, match.index).trim();
    const right = title.slice(match.index + match[0].length).trim();
    if (!left || !right) return null;

    return REVERSED_ARROW.test(match[1]) ? { from: right, to: left } : { from: left, to: right };
}

/**
 * Build the text that decides WHICH trip a reservation belongs to.
 *
 * Only the arrival end counts. A journey title is "Origin → Destination", and
 * for flights/rail/ferry `location` is the DEPARTURE terminal — feeding either
 * of those in whole means the origin city votes on the match, so a flight out
 * of Athens would attach itself to a trip to Athens.
 *
 * Non-journey types are the opposite: a hotel's `location` is the property
 * address, which is the single best destination signal we have.
 */
export function buildMatchHaystack(
    type: string,
    location: string | undefined,
    title: string,
    details?: Record<string, any> | null
): string {
    const parts: Array<string | undefined> = [details?.arrivalCity, details?.city];

    if (JOURNEY_TYPES.has(type)) {
        // Keep the raw arrival text (codes included) — matching can use "VIE".
        const journey = splitJourney(title);
        parts.push(journey ? journey.to : title);
    } else {
        parts.push(location, title);
    }

    return parts.filter(Boolean).join(" ");
}

/**
 * The destination this booking implies, as a name a human would type into the
 * create-trip field ("Thessaloniki", not "Thessaloniki (SKG)").
 *
 * Returns undefined rather than guessing. A wrong name here is offered to the
 * user as "Plan your X trip", so a bad guess is worse than no offer at all —
 * the caller falls back to a generic prompt.
 */
export function extractDestination(
    type: string,
    location: string | undefined,
    title: string,
    details?: Record<string, any> | null
): string | undefined {
    const stated = details?.arrivalCity ?? details?.city;
    if (typeof stated === "string" && stated.trim()) return stated.trim().slice(0, 120);

    if (JOURNEY_TYPES.has(type)) {
        // Only an actual "A → B" title tells us where this journey ends.
        const to = splitJourney(title)?.to;
        return to ? cleanPlace(to) || undefined : undefined;
    }

    // Hotels and the rest: `location` is the property/venue address. Its last
    // comma-separated part is usually the city, but not reliably enough to
    // prefer over an explicit field.
    const tail = location?.split(",").pop()?.trim();
    return tail && tail.length > 1 ? tail.slice(0, 120) : undefined;
}

/**
 * Where this leg departs from. The mirror of extractDestination — used only to
 * recognise a return leg, never to choose a trip destination.
 */
export function extractOrigin(
    type: string,
    title: string,
    details?: Record<string, any> | null
): string | undefined {
    const stated = details?.departureCity ?? details?.originCity;
    if (typeof stated === "string" && stated.trim()) return stated.trim().slice(0, 120);
    if (!JOURNEY_TYPES.has(type)) return undefined;
    const from = splitJourney(title)?.from;
    return from ? cleanPlace(from) || undefined : undefined;
}

/** Three-letter uppercase codes (IATA) carried in a string, e.g. "SKG". */
export function iataCodes(value: string | undefined): string[] {
    return value ? (value.match(/\b[A-Z]{3}\b/g) ?? []) : [];
}

/** Loose "these name the same place" test, for pairing legs of one journey. */
export function samePlace(a: string | undefined, b: string | undefined): boolean {
    const na = normalizePlace(a);
    const nb = normalizePlace(b);
    if (!na || !nb) return false;
    if (na === nb || na.includes(nb) || nb.includes(na)) return true;
    const ca = iataCodes(a);
    return ca.length > 0 && ca.some((code) => iataCodes(b).includes(code));
}

/** One parsed leg, as the inbound action has it before writing rows. */
export type JourneyLeg = {
    type: string;
    title: string;
    location?: string;
    details?: Record<string, any> | null;
    startAt?: number;
};

/**
 * The destination of a JOURNEY, given every leg found in one confirmation.
 *
 * A round trip is one trip. Read leg by leg, the return flight looks like a
 * booking to your home city — it would match no trip and then cheerfully offer
 * to plan you a holiday in the town you live in. So the legs are read together:
 * when the last one lands where the first took off, the destination is where
 * the FIRST leg went, and every leg inherits it.
 *
 * Open-jaw and multi-city bookings don't close the loop, so they take the final
 * arrival instead — the furthest point is the one worth planning around.
 */
export function journeyDestination(legs: JourneyLeg[]): string | undefined {
    const journeys = legs
        .filter((leg) => JOURNEY_TYPES.has(leg.type))
        .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));

    if (journeys.length === 0) return undefined;

    const first = journeys[0];
    const firstDestination = extractDestination(first.type, first.location, first.title, first.details);
    if (journeys.length === 1) return firstDestination;

    const last = journeys[journeys.length - 1];
    const lastDestination = extractDestination(last.type, last.location, last.title, last.details);
    const firstOrigin = extractOrigin(first.type, first.title, first.details);

    // Closed loop → the outbound destination is the trip.
    if (samePlace(lastDestination, firstOrigin)) return firstDestination;

    return lastDestination ?? firstDestination;
}

/**
 * Does this trip's destination actually appear in the reservation text?
 *
 * Words shorter than four characters are too collision-prone to match on
 * ("Rio", "Nis"), so city codes are compared separately as codes.
 */
function destinationMatches(
    trip: MatchableTrip,
    normalizedHaystack: string,
    codes: string[]
): boolean {
    const tokens = normalizePlace(trip.destination)
        .split(" ")
        .filter((t) => t.length > 3);
    if (tokens.some((token) => normalizedHaystack.includes(token))) return true;
    return iataCodes(trip.destination).some((code) => codes.includes(code));
}

/**
 * Pick the best trip for a reservation: the window must overlap AND the trip's
 * destination must show up in the reservation.
 *
 * Dates alone are never enough. Overlap says "you were travelling then", not
 * "this booking belongs to that trip" — a flight to Thessaloniki during a
 * Madeira week is its own thing. When the destination disagrees we return null
 * and let the user assign it; an unmatched reservation is a valid (and
 * product-relevant) outcome, and a visibly unassigned booking is far cheaper to
 * fix than one silently filed under the wrong trip.
 */
export function pickMatchingTrip<T extends MatchableTrip>(
    trips: T[],
    startAt: number | undefined,
    signals: MatchSignals | string
): T | null {
    if (!startAt) return null;

    // Callers used to pass a bare haystack string; keep that meaning.
    const { destination, origin } =
        typeof signals === "string" ? { destination: signals, origin: undefined } : signals;

    const overlapping = trips.filter((trip) => {
        if (trip.status === "archived") return false;
        return (
            startAt >= trip.startDate - TRIP_MATCH_SLACK_MS &&
            startAt <= trip.endDate + TRIP_MATCH_SLACK_MS
        );
    });

    if (overlapping.length === 0) return null;

    const nearestFirst = (a: T, b: T) =>
        Math.abs(a.startDate - startAt) - Math.abs(b.startDate - startAt);

    const normalizedDestination = normalizePlace(destination);
    const destinationCodes = iataCodes(destination);

    const byDestination = overlapping.filter((trip) =>
        destinationMatches(trip, normalizedDestination, destinationCodes)
    );
    if (byDestination.length > 0) return byDestination.sort(nearestFirst)[0];

    // Nothing matched on arrival. A return leg forwarded on its own looks like a
    // booking to your home city, so it never will — but it DEPARTS the trip's
    // destination, in the back half of the window. That shape is a flight home,
    // and it belongs to the trip it is leaving, not to a new one.
    const normalizedOrigin = normalizePlace(origin);
    if (normalizedOrigin) {
        const originCodes = iataCodes(origin);
        const returningFrom = overlapping.filter((trip) => {
            if (!destinationMatches(trip, normalizedOrigin, originCodes)) return false;
            const midpoint = trip.startDate + (trip.endDate - trip.startDate) / 2;
            return startAt >= midpoint;
        });
        if (returningFrom.length > 0) return returningFrom.sort(nearestFirst)[0];
    }

    // We had something to compare on and none of it agreed — leave it unmatched
    // rather than guessing from the calendar.
    if (normalizedDestination || normalizedOrigin) return null;

    // No usable place text at all (the parse found none). Dates are all we have.
    return overlapping.sort(nearestFirst)[0];
}

// ---------------------------------------------------------------------------
// Presentation grouping
// ---------------------------------------------------------------------------

/** The reservation fields grouping needs. Real rows carry far more. */
export type GroupableLeg = {
    _id?: unknown;
    type: string;
    title: string;
    confirmationCode?: string;
    startAt?: number;
    endAt?: number;
    price?: number;
    currency?: string;
    destinationHint?: string;
    location?: string;
    details?: Record<string, any> | null;
};

export type JourneyGroup<T> = {
    key: string;
    legs: T[];              // chronological
    isRoundTrip: boolean;
    /** Where the journey goes — the outbound arrival for a round trip. */
    destination?: string;
    /** "Athens (ATH) ↔ Vienna (VIE)" for a pair, the lone title otherwise. */
    label: string;
    startAt?: number;
    endAt?: number;
    /**
     * When you land at the destination, and when you leave it — the outbound
     * leg's arrival and the return leg's departure. These are the hours a trip
     * actually starts and stops being usable, which is what create-trip wants:
     * landing at 22:45 means day one is not a sightseeing day.
     *
     * Journey types only; a hotel booking has no such thing.
     */
    arrivalAt?: number;
    departureAt?: number;
    /** The booking total, de-duplicated. See below. */
    price?: number;
    currency?: string;
};

/**
 * Collapse the legs of one booking into a single item.
 *
 * An outbound and a return are two boarding passes but ONE purchase, and
 * showing them as two unrelated cards — each offering to plan its own trip —
 * misreads the booking. Legs are grouped by confirmation code, which is what
 * actually identifies a purchase.
 *
 * Only journey types group. Two hotel stays under one booking reference are
 * genuinely two stays.
 */
export function groupJourneyLegs<T extends GroupableLeg>(rows: T[]): JourneyGroup<T>[] {
    const groups = new Map<string, T[]>();
    const order: string[] = [];

    rows.forEach((row, index) => {
        const code = row.confirmationCode?.trim();
        const key =
            code && JOURNEY_TYPES.has(row.type) ? `code:${row.type}:${code.toLowerCase()}` : `row:${index}`;
        if (!groups.has(key)) { groups.set(key, []); order.push(key); }
        groups.get(key)!.push(row);
    });

    return order.map((key) => {
        const legs = groups.get(key)!.slice().sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
        const first = legs[0];
        const last = legs[legs.length - 1];

        const firstEnds = splitJourney(first.title);
        const lastEnds = splitJourney(last.title);
        const isRoundTrip =
            legs.length > 1 && samePlace(lastEnds?.to, firstEnds?.from);

        let label = first.title;
        if (legs.length > 1 && firstEnds && lastEnds) {
            label = isRoundTrip
                ? `${firstEnds.from} ↔ ${firstEnds.to}`
                : `${firstEnds.from} → ${lastEnds.to}`;
        }

        // Airlines quote the WHOLE booking on each leg, so summing double-counts
        // a return. Identical amounts across legs means one total repeated; a
        // genuine per-leg breakdown differs, and is summed.
        const priced = legs.filter((l) => typeof l.price === "number");
        const allSame =
            priced.length > 1 && priced.every((l) => l.price === priced[0].price);
        const price = priced.length === 0
            ? undefined
            : allSame
                ? priced[0].price
                : priced.reduce((sum, l) => sum + (l.price ?? 0), 0);

        // Only a journey lands and takes off again.
        const isJourney = JOURNEY_TYPES.has(first.type);

        return {
            key,
            legs,
            isRoundTrip,
            destination: journeyDestination(legs) ?? first.destinationHint,
            label,
            startAt: first.startAt,
            endAt: last.endAt ?? last.startAt ?? first.endAt,
            arrivalAt: isJourney ? first.endAt : undefined,
            // The last leg departs the destination — only meaningful once there
            // IS a last leg distinct from the outbound.
            departureAt: isJourney && legs.length > 1 ? last.startAt : undefined,
            price,
            currency: priced[0]?.currency ?? first.currency,
        };
    });
}
