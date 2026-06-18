/**
 * Pure itinerary helpers — shared by trips.ts (mutations) and tripsActions.ts (actions).
 * Non-node, no Convex context, no I/O: safe to import anywhere.
 *
 * The itinerary is stored loosely (schema `itinerary: v.any()`), so these helpers
 * operate on a tolerant shape and never throw on malformed days/activities.
 */

export interface ItineraryActivityLike {
    id?: string;
    time?: string;
    startTime?: string;
    title?: string;
    [key: string]: unknown;
}

export interface ItineraryDayLike {
    day?: number;
    title?: string;
    activities?: ItineraryActivityLike[];
    [key: string]: unknown;
}

/**
 * Normalize a venue/activity title for equality comparison.
 * Mirrors `normalizeKey` in convex/lowFareRadar.ts so behaviour matches the
 * rest of the codebase: trim, lowercase, strip diacritics, collapse whitespace.
 */
export function normalizeVenueKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ");
}

// Generic time-slot / filler labels that are not real venues and must NOT be
// treated as duplicates (e.g. two days can both have a generic "Free time").
const PLACEHOLDER_TITLES = new Set([
    "",
    "free time",
    "lunch",
    "dinner",
    "breakfast",
    "rest",
    "explore",
    "check-in",
    "check in",
    "checkout",
    "check-out",
    "transfer",
    "departure",
    "arrival",
]);

function isDedupableTitle(title: unknown): title is string {
    if (typeof title !== "string") return false;
    const key = normalizeVenueKey(title);
    return key.length > 0 && !PLACEHOLDER_TITLES.has(key);
}

/**
 * The de-dup guardrail. Walk every activity in trip order and drop any whose
 * normalized title already appeared earlier in the trip. Blank/placeholder
 * titles (free time, meals, transfers) are never deduped.
 *
 * Returns a NEW days array (inputs are not mutated) plus how many activities
 * were removed so callers can log it.
 */
export function dedupeVenues(
    days: ItineraryDayLike[] | undefined | null
): { days: ItineraryDayLike[]; removedCount: number } {
    if (!Array.isArray(days)) return { days: days ?? [], removedCount: 0 };

    const seen = new Set<string>();
    let removedCount = 0;

    const result = days.map((day) => {
        if (!day || !Array.isArray(day.activities)) return day;
        const kept: ItineraryActivityLike[] = [];
        for (const activity of day.activities) {
            const title = activity?.title;
            if (isDedupableTitle(title)) {
                const key = normalizeVenueKey(title);
                if (seen.has(key)) {
                    removedCount++;
                    continue; // drop the later duplicate
                }
                seen.add(key);
            }
            kept.push(activity);
        }
        return { ...day, activities: kept };
    });

    return { days: result, removedCount };
}

// Short, collision-unlikely id for DnD list keys and stable activity references.
function makeActivityId(): string {
    return (
        "act_" +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 6)
    );
}

/**
 * Backfill a stable `id` on every activity missing one, so the drag-and-drop
 * list has stable React/reanimated keys and move/reorder is robust.
 * Idempotent: activities that already have an `id` keep it. Returns a NEW days
 * array only when something changed (to avoid needless trip patches is the
 * caller's concern — this always returns a usable array).
 */
export function assignActivityIds(
    days: ItineraryDayLike[] | undefined | null
): ItineraryDayLike[] {
    if (!Array.isArray(days)) return days ?? [];

    return days.map((day) => {
        if (!day || !Array.isArray(day.activities)) return day;
        const activities = day.activities.map((activity) => {
            if (activity && typeof activity.id === "string" && activity.id.length > 0) {
                return activity;
            }
            return { ...activity, id: makeActivityId() };
        });
        return { ...day, activities };
    });
}

/**
 * Parse an activity time string to minutes-since-midnight for sorting.
 * Handles both 24h ("09:00", "14:30") and 12h ("8:30 AM", "1:00 PM") formats
 * that appear in generated/fallback itineraries. Unparseable times sort last.
 */
export function timeToMinutes(value: string | undefined): number {
    if (!value || typeof value !== "string") return Number.MAX_SAFE_INTEGER;
    const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!m) return Number.MAX_SAFE_INTEGER;
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const meridiem = m[3]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.MAX_SAFE_INTEGER;
    return hours * 60 + minutes;
}

// Time/position fields that belong to a day SLOT rather than to the activity
// itself. When activities are reordered within a day, the slots stay put (so the
// time column stays chronological) and the activities move between them.
const SLOT_FIELDS = ["time", "startTime", "endTime", "duration", "durationMinutes", "travelFromPrevious"] as const;

/**
 * Reassign the day's time slots by position. `orderedActivities` is the day in
 * its original (chronological) order — its slot fields are the canonical slots.
 * `newOrder` is the same activities permuted; each lands in a slot by index, so
 * position 0 always keeps the earliest time, etc. Lengths should match (use for
 * within-day reorder). Returns a NEW array; inputs are not mutated.
 */
export function reassignTimeSlots(
    orderedActivities: ItineraryActivityLike[],
    newOrder: ItineraryActivityLike[]
): ItineraryActivityLike[] {
    const slots = orderedActivities.map((a) => {
        const slot: Record<string, unknown> = {};
        for (const f of SLOT_FIELDS) {
            if (a && f in a) slot[f] = (a as any)[f];
        }
        return slot;
    });
    return newOrder.map((a, i) => ({ ...a, ...(slots[i] || {}) }));
}

/**
 * Re-sort a single day's activities by start time (stable for equal/unknown
 * times) so the day stays chronologically ordered after a time edit. Returns a
 * NEW day object; input is not mutated.
 */
export function resequenceDayTimes(day: ItineraryDayLike): ItineraryDayLike {
    if (!day || !Array.isArray(day.activities)) return day;
    const indexed = day.activities.map((activity, index) => ({ activity, index }));
    indexed.sort((a, b) => {
        const ta = timeToMinutes(a.activity?.startTime || a.activity?.time);
        const tb = timeToMinutes(b.activity?.startTime || b.activity?.time);
        if (ta !== tb) return ta - tb;
        return a.index - b.index; // stable
    });
    return { ...day, activities: indexed.map((x) => x.activity) };
}
