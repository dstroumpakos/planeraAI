/**
 * searchapi.io Google Flights — request param mappers & cache-key helpers.
 *
 * Pure functions only — no side effects, no network, no env access. The
 * network layer lives in the "use node" action files that import these.
 *
 * searchapi.io and SerpApi both wrap Google Flights, so the RESPONSE shapes
 * are near-identical (normalized via `serpApiFlights.ts`, which is tolerant of
 * both field spellings). The REQUEST params differ, though:
 *   - trip type:    searchapi `flight_type` = "round_trip" | "one_way"
 *                   (SerpApi uses `type` = 1 | 2)
 *   - travel class: searchapi string enum, "first" → "first_class"
 *   - stops:        searchapi string enum — identical to our internal type
 *   - sort:         searchapi string enum, "top" → "top_flights"
 *   - bags:         searchapi splits into `carry_on_bags` + `checked_bags`
 *                   (SerpApi has a single `bags`)
 * Docs: https://www.searchapi.io/docs/google-flights-api
 */

import type {
  FlightSearchInput,
  SortBy,
  TravelClass,
} from "../../types/flights";
import { createFlightSearchCacheKey } from "./serpApiFlights";

export const SEARCHAPI_FLIGHTS_ENDPOINT =
  "https://www.searchapi.io/api/v1/search";

/** searchapi.io accepts the same strings as our internal type, bar "first". */
export function mapSearchApiTravelClass(travelClass?: TravelClass): string {
  return travelClass === "first" ? "first_class" : travelClass ?? "economy";
}

/** searchapi.io calls the default sort "top_flights"; the rest are identical. */
export function mapSearchApiSortBy(sortBy?: SortBy): string {
  return !sortBy || sortBy === "top" ? "top_flights" : sortBy;
}

export function mapSearchApiFlightType(
  type?: "one_way" | "round_trip"
): "one_way" | "round_trip" {
  return type === "one_way" ? "one_way" : "round_trip";
}

function saAppend(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  params.append(key, String(value));
}

/** Build the searchapi.io params for a flight search (mirrors buildSearchParams). */
export function buildSearchApiSearchParams(
  input: FlightSearchInput
): URLSearchParams {
  const params = new URLSearchParams();
  params.append("engine", "google_flights");
  params.append("departure_id", input.departureId.trim().toUpperCase());
  params.append("arrival_id", input.arrivalId.trim().toUpperCase());
  params.append("outbound_date", input.outboundDate);

  const flightType = mapSearchApiFlightType(input.type);
  params.append("flight_type", flightType);
  if (flightType === "round_trip" && input.returnDate) {
    params.append("return_date", input.returnDate);
  }

  params.append("currency", (input.currency ?? "EUR").toUpperCase());
  params.append("hl", "en");
  params.append("travel_class", mapSearchApiTravelClass(input.travelClass));
  params.append("stops", input.stops ?? "any");
  params.append("sort_by", mapSearchApiSortBy(input.sortBy));

  saAppend(params, "adults", input.adults);
  saAppend(params, "children", input.children);
  // The app's single `bags` count historically meant carry-on bags (it mapped
  // to SerpApi's `bags`), so carry it through as `carry_on_bags`.
  saAppend(params, "carry_on_bags", input.bags);
  saAppend(params, "max_price", input.maxPrice);
  saAppend(params, "outbound_times", input.outboundTimes);
  saAppend(params, "return_times", input.returnTimes);
  // Round-trip leg 2: fetch return options for a chosen outbound.
  saAppend(params, "departure_token", input.departureToken);

  return params;
}

/**
 * Build the searchapi.io params for a booking-options lookup. Like SerpApi,
 * the endpoint needs the full route + dates alongside the `booking_token`;
 * `adults` is intentionally omitted (the token already encodes passengers).
 */
export function buildSearchApiBookingParams(o: {
  bookingToken: string;
  currency?: string;
  hl?: string;
  gl?: string;
  departureId?: string;
  arrivalId?: string;
  outboundDate?: string;
  returnDate?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.append("engine", "google_flights");
  if (o.departureId) params.append("departure_id", o.departureId.toUpperCase());
  if (o.arrivalId) params.append("arrival_id", o.arrivalId.toUpperCase());
  if (o.outboundDate) params.append("outbound_date", o.outboundDate);
  if (o.returnDate) {
    params.append("return_date", o.returnDate);
    params.append("flight_type", "round_trip");
  } else if (o.outboundDate) {
    params.append("flight_type", "one_way");
  }
  params.append("booking_token", o.bookingToken);
  params.append("currency", (o.currency ?? "EUR").toUpperCase());
  params.append("hl", o.hl ?? "en");
  if (o.gl) params.append("gl", o.gl);
  return params;
}

/**
 * Cache key for a searchapi.io search. Prefixed so it can NEVER collide with a
 * SerpApi-cached result: the two providers mint mutually-incompatible
 * `booking_token`s, and serving a SerpApi token to searchapi's booking
 * endpoint (or vice-versa) would fail at booking time.
 */
export function createSearchApiCacheKey(input: FlightSearchInput): string {
  return `sa|${createFlightSearchCacheKey(input)}`;
}
