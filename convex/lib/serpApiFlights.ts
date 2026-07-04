/**
 * SerpApi Google Flights mapping & normalization helpers.
 *
 * Pure functions only — no side effects, no network calls, no env access.
 * Safe to import from any Convex function file (queries, mutations, actions)
 * and from the frontend if needed.
 */

import type {
  DealScore,
  FlightSearchInput,
  NormalizedAirport,
  NormalizedAirportGroup,
  NormalizedBookingOption,
  NormalizedCarbonEmissions,
  NormalizedFlightOption,
  NormalizedFlightSegment,
  NormalizedLayover,
  PriceInsights,
  SortBy,
  StopsFilter,
  TravelClass,
} from "../../types/flights";

// ---------------------------- Parameter mappers -----------------------------

export function mapFlightType(type?: "one_way" | "round_trip"): number {
  // SerpApi: 1 = Round trip, 2 = One way, 3 = Multi-city
  return type === "one_way" ? 2 : 1;
}

export function mapTravelClass(travelClass?: TravelClass): number {
  switch (travelClass) {
    case "premium_economy":
      return 2;
    case "business":
      return 3;
    case "first":
      return 4;
    case "economy":
    default:
      return 1;
  }
}

export function mapStops(stops?: StopsFilter): number {
  switch (stops) {
    case "nonstop":
      return 1;
    case "one_stop_or_fewer":
      return 2;
    case "two_stops_or_fewer":
      return 3;
    case "any":
    default:
      return 0;
  }
}

export function mapSortBy(sortBy?: SortBy): number {
  switch (sortBy) {
    case "price":
      return 2;
    case "departure_time":
      return 3;
    case "arrival_time":
      return 4;
    case "duration":
      return 5;
    case "emissions":
      return 6;
    case "top":
    default:
      return 1;
  }
}

// --------------------------- Normalization helpers --------------------------

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCarbonEmissions(
  raw: any
): NormalizedCarbonEmissions | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    thisFlight: toNumberOrNull(raw.this_flight) ?? undefined,
    typicalForRoute: toNumberOrNull(raw.typical_for_this_route) ?? undefined,
    differencePercent: toNumberOrNull(raw.difference_percent) ?? undefined,
  };
}

export function normalizeLayover(raw: any): NormalizedLayover {
  return {
    id: raw?.id ?? null,
    name: raw?.name ?? null,
    durationMinutes: toNumberOrNull(raw?.duration),
    overnight: Boolean(raw?.overnight),
  };
}

export function normalizeFlightSegment(raw: any): NormalizedFlightSegment {
  return {
    airline: raw?.airline ?? null,
    airlineLogo: raw?.airline_logo ?? null,
    flightNumber: raw?.flight_number ?? null,
    airplane: raw?.airplane ?? null,
    travelClass: raw?.travel_class ?? null,
    durationMinutes: toNumberOrNull(raw?.duration),
    legroom: raw?.legroom ?? null,
    overnight: Boolean(raw?.overnight),
    oftenDelayedByOver30Min: Boolean(raw?.often_delayed_by_over_30_min),
    planeAndCrewBy: raw?.plane_and_crew_by ?? null,
    ticketAlsoSoldBy: Array.isArray(raw?.ticket_also_sold_by)
      ? raw.ticket_also_sold_by
      : undefined,
    departureAirport: {
      id: raw?.departure_airport?.id ?? null,
      name: raw?.departure_airport?.name ?? null,
      time: raw?.departure_airport?.time ?? null,
    },
    arrivalAirport: {
      id: raw?.arrival_airport?.id ?? null,
      name: raw?.arrival_airport?.name ?? null,
      time: raw?.arrival_airport?.time ?? null,
    },
    extensions: Array.isArray(raw?.extensions) ? raw.extensions : undefined,
  };
}

export function normalizePriceInsights(raw: any): PriceInsights | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    lowestPrice: toNumberOrNull(raw.lowest_price),
    priceLevel: raw.price_level ?? null,
    typicalPriceRange: Array.isArray(raw.typical_price_range)
      ? raw.typical_price_range
      : undefined,
    priceHistory: Array.isArray(raw.price_history) ? raw.price_history : undefined,
  };
}

function computeDealScore(priceLevel?: string | null): DealScore {
  switch ((priceLevel || "").toLowerCase()) {
    case "low":
      return "strong_deal";
    case "typical":
      return "normal";
    case "high":
      return "expensive";
    default:
      return "unknown";
  }
}

export function normalizeFlightOption(
  raw: any,
  source: "best_flights" | "other_flights",
  index: number,
  priceInsights?: PriceInsights | null
): NormalizedFlightOption {
  const flights = Array.isArray(raw?.flights)
    ? raw.flights.map(normalizeFlightSegment)
    : [];
  const layovers = Array.isArray(raw?.layovers)
    ? raw.layovers.map(normalizeLayover)
    : [];

  return {
    id: `${source}_${index}`,
    source,
    price: toNumberOrNull(raw?.price),
    type: raw?.type ?? null,
    totalDurationMinutes: toNumberOrNull(raw?.total_duration),
    airlineLogo: raw?.airline_logo ?? flights[0]?.airlineLogo ?? null,
    departureToken: raw?.departure_token ?? null,
    bookingToken: raw?.booking_token ?? null,
    flights,
    layovers,
    carbonEmissions: normalizeCarbonEmissions(raw?.carbon_emissions),
    extensions: Array.isArray(raw?.extensions) ? raw.extensions : undefined,
    dealScore: computeDealScore(priceInsights?.priceLevel as string | undefined),
  };
}

function normalizeAirport(raw: any): NormalizedAirport {
  return {
    airport: {
      id: raw?.airport?.id ?? null,
      name: raw?.airport?.name ?? null,
    },
    city: raw?.city ?? null,
    country: raw?.country ?? null,
    countryCode: raw?.country_code ?? null,
    image: raw?.image ?? null,
    thumbnail: raw?.thumbnail ?? null,
  };
}

export function normalizeAirports(raw: any): NormalizedAirportGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((group) => ({
    departure: Array.isArray(group?.departure)
      ? group.departure.map(normalizeAirport)
      : [],
    arrival: Array.isArray(group?.arrival)
      ? group.arrival.map(normalizeAirport)
      : [],
  }));
}

export function normalizeBookingOption(
  raw: any,
  index: number
): NormalizedBookingOption {
  const togetherOrSeparate = raw?.together ?? raw?.departing ?? raw?.returning ?? raw;
  // Booking options API nests the actual option under `together` (or
  // departing/returning for split-itinerary cases). Fall back to the raw
  // object if SerpApi flattens the shape in the future.

  return {
    id: `booking_${index}`,
    bookWith: togetherOrSeparate?.book_with ?? null,
    airline: Boolean(togetherOrSeparate?.airline),
    airlineLogos: Array.isArray(togetherOrSeparate?.airline_logos)
      ? togetherOrSeparate.airline_logos
      : undefined,
    marketedAs: Array.isArray(togetherOrSeparate?.marketed_as)
      ? togetherOrSeparate.marketed_as
      : undefined,
    price: toNumberOrNull(togetherOrSeparate?.price),
    localPrices: Array.isArray(togetherOrSeparate?.local_prices)
      ? togetherOrSeparate.local_prices.map((p: any) => ({
          currency: p?.currency ?? "",
          price: Number(p?.price) || 0,
        }))
      : undefined,
    optionTitle: togetherOrSeparate?.option_title ?? null,
    extensions: Array.isArray(togetherOrSeparate?.extensions)
      ? togetherOrSeparate.extensions
      : undefined,
    baggagePrices: Array.isArray(togetherOrSeparate?.baggage_prices)
      ? togetherOrSeparate.baggage_prices
      : undefined,
    bookingRequest: togetherOrSeparate?.booking_request
      ? {
          url: togetherOrSeparate.booking_request.url ?? null,
          postData: togetherOrSeparate.booking_request.post_data ?? null,
        }
      : undefined,
  };
}

// ----------------------------- Cache key helper -----------------------------

export function createFlightSearchCacheKey(input: FlightSearchInput): string {
  const parts = [
    input.departureId.trim().toUpperCase(),
    input.arrivalId.trim().toUpperCase(),
    input.outboundDate,
    input.returnDate ?? "",
    input.type ?? "round_trip",
    (input.currency ?? "EUR").toUpperCase(),
    String(input.adults ?? 1),
    String(input.children ?? 0),
    input.travelClass ?? "economy",
    input.stops ?? "any",
    String(input.bags ?? 0),
    input.maxPrice != null ? String(input.maxPrice) : "",
    input.departureToken ?? "",
  ];
  return parts.join("|");
}
