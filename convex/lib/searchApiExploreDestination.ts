/**
 * searchapi.io Google Travel Explore — single-destination drill-down.
 *
 * Docs: https://www.searchapi.io/docs/google-travel-explore-destination-api
 *
 * Companion to `searchApiExplore.ts` (`google_travel_explore`, the "where can I
 * go?" grid). This engine (`google_travel_explore_destination`) is the inverse:
 * given an origin AND one destination, it returns indicative flight options for
 * that route — the data behind a "Flights from your city, from €X" module on a
 * destination preview page.
 *
 * IMPORTANT: prices here are discovery signals, NOT bookable fares. The real,
 * bookable price + provider-locked `booking_token` is confirmed later by the
 * existing `google_flights` search path when the user taps "See flights".
 *
 * Requires a known origin, so it is only meaningful for a logged-in user whose
 * home airport we can resolve — with no origin there is nothing to show.
 *
 * All network calls happen server-side (Convex actions); the API key never
 * crosses the frontend boundary and is never logged. Same provider + endpoint
 * as the sibling lib files, just a different `engine`.
 *
 * Failure philosophy: any error (missing key, network, HTTP, empty results,
 * malformed JSON) resolves to `null` so the caller degrades to a hidden module
 * rather than blowing up.
 *
 * RESPONSE SHAPE (verified against a live LHR->BCN call): top-level `flights[]`,
 * each `{ position, price, airline, airline_code, stops, departure_date,
 * departure_airport:{id,name}, arrival_airport:{id,name}, flight_duration,
 * duration }`; the route-level `departure_date`/`return_date` sit at the TOP of
 * the response, not on each flight. Normalization stays tolerant of alternate
 * spellings so a provider tweak degrades gracefully rather than dropping data.
 */

import type {
  ExploreDestinationFlight,
  ExploreDestinationFlights,
  ExploreDestinationFlightsQuery,
  StopsFilter,
  TravelClass,
} from "../../types/flights";
import { normalizeHl } from "./searchApiExplore";

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

const STOPS = new Set<StopsFilter>([
  "any",
  "nonstop",
  "one_stop_or_fewer",
  "two_stops_or_fewer",
]);

/** searchapi.io accepts our internal class strings bar "first". */
function mapTravelClass(travelClass?: TravelClass): string | undefined {
  if (!travelClass) return undefined;
  return travelClass === "first" ? "first_class" : travelClass;
}

function getSearchApiKey(): string | null {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return null;
  }
  return key.trim();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** Pull an IATA-ish code out of either a bare string or a `{ id }` object. */
function toAirportCode(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim().toUpperCase();
  if (raw && typeof raw === "object") {
    const id = (raw as any).id ?? (raw as any).airport_code ?? (raw as any).code;
    if (typeof id === "string" && id.trim()) return id.trim().toUpperCase();
  }
  return undefined;
}

async function callSearchApi(
  params: URLSearchParams,
  key: string
): Promise<any | null> {
  params.append("api_key", key);
  let res: Response;
  try {
    res = await fetch(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    console.error("[searchapi-explore-dest] Network error");
    return null;
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    console.error(`[searchapi-explore-dest] HTTP ${res.status} ${detail}`);
    return null;
  }

  try {
    const json = await res.json();
    if (json?.error) {
      const msg = String(json.error);
      // "…didn't return any results" is the engine's way of saying this
      // origin→destination pair has no Explore flight cards — an EXPECTED empty
      // outcome (the sibling google_travel_explore engine signals the same thing
      // with an empty array, which we degrade silently). Treat it as no-data,
      // not an operational error, so it doesn't pollute error logs. The caller
      // degrades to a hidden teaser either way.
      if (/didn't return any results|no results/i.test(msg)) {
        console.log("[searchapi-explore-dest] no results for route");
      } else {
        console.error("[searchapi-explore-dest] API error:", msg);
      }
      return null;
    }
    return json;
  } catch {
    console.error("[searchapi-explore-dest] Invalid JSON response");
    return null;
  }
}

/**
 * Normalize one raw flight row. Verified against a live response: the engine
 * returns `departure_date` (NOT `outbound_date`) per flight, and `return_date`
 * lives at the TOP level, so the caller passes it in as a fallback.
 */
function normalizeFlight(
  raw: any,
  fallback: { departureDate?: string; returnDate?: string }
): ExploreDestinationFlight | null {
  if (!raw || typeof raw !== "object") return null;
  const flight: ExploreDestinationFlight = {
    price: toNumber(raw.price),
    airline:
      (typeof raw.airline_name === "string" && raw.airline_name) ||
      (typeof raw.airline === "string" && raw.airline) ||
      undefined,
    stops: toNumber(raw.stops),
    departureAirport: toAirportCode(
      raw.departure_airport ?? raw.departure_id ?? raw.departure
    ),
    arrivalAirport: toAirportCode(
      raw.arrival_airport ?? raw.arrival_id ?? raw.arrival
    ),
    outboundDate:
      (typeof raw.departure_date === "string" && raw.departure_date) ||
      (typeof raw.outbound_date === "string" && raw.outbound_date) ||
      fallback.departureDate ||
      undefined,
    returnDate:
      (typeof raw.return_date === "string" && raw.return_date) ||
      fallback.returnDate ||
      undefined,
    flightDuration:
      typeof raw.flight_duration === "string"
        ? raw.flight_duration
        : typeof raw.total_duration === "string"
          ? raw.total_duration
          : undefined,
  };
  // A row with neither a price nor an airline is noise — drop it.
  if (flight.price === undefined && !flight.airline) return null;
  return flight;
}

/**
 * Query searchapi.io Google Travel Explore Destination for one origin →
 * destination pair and return normalized, cheapest-first flight options.
 * Returns `null` when the key is missing, the API fails, or nothing usable
 * comes back.
 */
export async function fetchExploreDestinationFlights(
  q: ExploreDestinationFlightsQuery
): Promise<ExploreDestinationFlights | null> {
  const key = getSearchApiKey();
  if (!key) return null;
  if (!q.departureId?.trim() || !q.arrivalId?.trim()) return null;

  const departureId = q.departureId.trim().toUpperCase();
  // Destination may be an IATA or a `/m/...` location id — don't uppercase the
  // latter. Only uppercase a bare 3-letter code.
  const rawArrival = q.arrivalId.trim();
  const arrivalId = /^[a-z]{3}$/i.test(rawArrival)
    ? rawArrival.toUpperCase()
    : rawArrival;
  const currency = (q.currency || "EUR").toUpperCase();

  const params = new URLSearchParams();
  params.append("engine", "google_travel_explore_destination");
  params.append("departure_id", departureId);
  params.append("arrival_id", arrivalId);
  params.append("currency", currency);
  params.append("hl", normalizeHl(q.hl));

  const travelClass = mapTravelClass(q.travelClass);
  if (travelClass) params.append("travel_class", travelClass);

  const stops = (q.stops || "").trim() as StopsFilter;
  if (STOPS.has(stops) && stops !== "any") params.append("stops", stops);

  if (q.timePeriod?.trim()) params.append("time_period", q.timePeriod.trim());

  const maxPrice = toNumber(q.maxPrice);
  if (maxPrice !== undefined) params.append("max_price", String(maxPrice));

  // Only send `adults` above the engine default of 1 — keeps the base request
  // minimal, matching the sibling explore lib.
  const adults = Math.min(Math.max(Math.round(q.adults ?? 1), 1), 9);
  if (adults > 1) params.append("adults", String(adults));

  const json = await callSearchApi(params, key);
  if (!json) return null;

  // Tolerate the likely array locations for the option list.
  const rawFlights: any[] = Array.isArray(json.flights)
    ? json.flights
    : Array.isArray(json.best_flights)
      ? json.best_flights
      : Array.isArray(json.destination?.flights)
        ? json.destination.flights
        : [];

  // The route-level dates sit at the top of the response, not on each flight.
  const topFallback = {
    departureDate:
      typeof json.departure_date === "string" ? json.departure_date : undefined,
    returnDate:
      typeof json.return_date === "string" ? json.return_date : undefined,
  };

  const flights: ExploreDestinationFlight[] = [];
  for (const f of rawFlights) {
    const norm = normalizeFlight(f, topFallback);
    if (norm) flights.push(norm);
  }

  if (flights.length === 0) return null;

  // Cheapest-first — the module leads with the lowest teaser price.
  flights.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  const cheapestPrice = flights.find((f) => f.price !== undefined)?.price;

  return {
    departureId,
    arrivalId,
    currency,
    cheapestPrice,
    flights,
  };
}
