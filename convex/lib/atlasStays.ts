/**
 * Maia's stay tools: live Booking.com hotels and Airbnb homes for given dates.
 *
 * The searching itself is the same searchapi.io code trip generation uses
 * (`searchBooking` / `searchAirbnb` in ./searchApiAccommodations). This module
 * owns what Maia needs on top: argument checks, the compact text the model
 * reads, and the `stays` card the apps render. It has no Convex dependencies
 * so the formatting can be exercised against real API output offline.
 *
 * Prices: every option is quoted as the TOTAL for the stay (what the traveller
 * pays) plus the effective nightly figure derived from it. Booking.com totals
 * include its listed taxes & charges; Airbnb totals are after Airbnb's own
 * discounts but before any local taxes the host adds.
 */

import type { Accommodation, AccommodationSearchInput } from "./searchApiAccommodations";

export type StayProvider = "booking" | "airbnb";

export interface StayArgs {
    destination: string;
    checkInDate: string;
    checkOutDate: string;
    adults?: number;
    maxPricePerNight?: number;
}

export const STAYS_MAX_OPTIONS = 5;
const MAX_NIGHTS = 30;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const PROVIDER_LABEL: Record<StayProvider, string> = {
    booking: "Booking.com",
    airbnb: "Airbnb",
};

export function nightsBetween(checkIn: string, checkOut: string): number {
    const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
    return Math.round(ms / 86_400_000);
}

/**
 * Validates the model's arguments. Returns either the search input or a
 * message for the model explaining what to ask the user.
 */
export function prepareStaySearch(
    args: StayArgs,
    currency: string,
    todayIso: string = new Date().toISOString().slice(0, 10)
): { input: AccommodationSearchInput } | { error: string } {
    const destination = (args.destination || "").trim();
    if (!destination) return { error: "No destination was given. Ask the user which city or area they want to stay in." };
    if (!ISO_DAY.test(args.checkInDate) || !ISO_DAY.test(args.checkOutDate)) {
        return {
            error: "Check-in and check-out dates are needed as YYYY-MM-DD. Ask the user for their dates (or use their trip dates from get_my_trips).",
        };
    }
    if (args.checkInDate < todayIso) {
        return { error: `${args.checkInDate} is in the past. Ask the user for future dates.` };
    }
    const nights = nightsBetween(args.checkInDate, args.checkOutDate);
    if (!(nights >= 1)) return { error: "Check-out must be after check-in." };
    if (nights > MAX_NIGHTS) return { error: `That is ${nights} nights; ask the user for a stay of ${MAX_NIGHTS} nights or fewer.` };

    const adults =
        typeof args.adults === "number" && Number.isFinite(args.adults) && args.adults >= 1
            ? Math.min(Math.round(args.adults), 16)
            : 2;

    return {
        input: {
            destination,
            checkInDate: args.checkInDate,
            checkOutDate: args.checkOutDate,
            adults,
            currency: (currency || "EUR").toUpperCase(),
            nights,
        },
    };
}

interface StayListing {
    name: string;
    image: string | null;
    /** Score on the provider's own scale (Booking /10, Airbnb /5). */
    score: number | null;
    scoreMax: number;
    reviews: number | null;
    stars: number | null;
    badge: string | null;
    total: number | null;
    perNight: number;
    originalPerNight: number | null;
    freeCancellation: boolean | null;
    url: string | null;
}

function toListing(provider: StayProvider, a: Accommodation, nights: number): StayListing {
    const total = typeof a.totalPrice === "number" ? Math.round(a.totalPrice) : null;
    // Effective nightly price: the total spread over the stay where we have it.
    const perNight = total != null ? Math.round(total / nights) : Math.round(a.pricePerNight);
    // Accommodation stores every rating on a /5 scale; Booking.com guests know it /10.
    const score =
        typeof a.rating === "number"
            ? provider === "booking"
                ? Math.round(a.rating * 20) / 10
                : Math.round(a.rating * 100) / 100
            : null;
    // Booking.com's struck-through rate excludes taxes while our total includes
    // them; add the same per-night taxes so the discount isn't overstated.
    const taxPerNight =
        provider === "booking" && total != null ? Math.max(0, perNight - Math.round(a.pricePerNight)) : 0;
    const original = typeof a.originalPrice === "number" ? Math.round(a.originalPrice + taxPerNight) : null;
    return {
        name: a.name,
        image: a.image ?? null,
        score,
        scoreMax: provider === "booking" ? 10 : 5,
        reviews: typeof a.reviews === "number" ? a.reviews : null,
        stars: typeof a.stars === "number" ? a.stars : null,
        badge: a.badges?.[0] ?? null,
        total,
        perNight,
        originalPerNight: original != null && original > perNight ? original : null,
        freeCancellation: typeof a.freeCancellation === "boolean" ? a.freeCancellation : null,
        url: a.bookingLink ?? a.link ?? null,
    };
}

function describe(provider: StayProvider, l: StayListing, currency: string): string {
    const parts: string[] = [l.name];
    if (l.stars) parts.push(`${l.stars}★`);
    if (l.score != null) {
        parts.push(
            `${l.score}/${l.scoreMax}` +
                (l.reviews != null ? ` from ${l.reviews} reviews` : "") +
                (l.badge ? ` (${l.badge})` : "")
        );
    } else if (l.badge) {
        parts.push(l.badge);
    }
    const priceNote = provider === "booking" ? "incl. taxes" : "before any local taxes";
    parts.push(
        l.total != null
            ? `${currency} ${l.total} total ${priceNote} (~${l.perNight}/night)`
            : `~${currency} ${l.perNight}/night`
    );
    if (l.originalPerNight) parts.push(`discounted from ~${l.originalPerNight}/night`);
    if (l.freeCancellation) parts.push("free cancellation");
    return parts.join(" — ");
}

/** Turns normalized search results into Maia's tool outcome (text + card). */
export function buildStaysOutcome(
    provider: StayProvider,
    input: AccommodationSearchInput,
    results: Accommodation[],
    maxPricePerNight?: number
): { result: string; card?: { type: string; data: any } } {
    const label = PROVIDER_LABEL[provider];
    const currency = (input.currency || "EUR").toUpperCase();
    const when = `${input.checkInDate} → ${input.checkOutDate} (${input.nights} night${input.nights > 1 ? "s" : ""}), ${input.adults} adult${input.adults > 1 ? "s" : ""}`;

    let listings = results.map((a) => toListing(provider, a, input.nights));
    const budget =
        typeof maxPricePerNight === "number" && Number.isFinite(maxPricePerNight) && maxPricePerNight > 0
            ? maxPricePerNight
            : undefined;
    const beforeBudget = listings.length;
    if (budget) listings = listings.filter((l) => l.perNight <= budget);
    listings = listings.slice(0, STAYS_MAX_OPTIONS);

    if (listings.length === 0) {
        return {
            result:
                beforeBudget > 0 && budget
                    ? `None of the ${beforeBudget} ${label} options in ${input.destination} for ${when} are under ${currency} ${budget}/night. Say so and offer the cheapest instead, or other dates.`
                    : `No ${label} results for ${input.destination}, ${when}. Say so plainly and suggest other dates or a nearby area.`,
        };
    }

    const lines = [
        `Live ${label} results for ${input.destination}, ${when}, prices in ${currency}${budget ? `, filtered to ≤ ${budget}/night` : ""}:`,
        ...listings.map((l, i) => `${i + 1}) ${describe(provider, l, currency)}`),
        `Prices are live and can change. Booking happens on ${label} through the links in the card — Planera does not take the booking or the payment.`,
    ];

    return {
        result: lines.join("\n"),
        card: {
            type: "stays",
            data: {
                provider,
                destination: input.destination,
                checkInDate: input.checkInDate,
                checkOutDate: input.checkOutDate,
                nights: input.nights,
                adults: input.adults,
                currency,
                listings,
            },
        },
    };
}
