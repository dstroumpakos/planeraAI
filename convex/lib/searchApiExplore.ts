/**
 * searchapi.io Google Travel Explore search + normalization.
 *
 * Docs: https://www.searchapi.io/docs/google-travel-explore-api
 *
 * Powers the "Where can I go?" discovery screen: given a single departure
 * airport, `google_travel_explore` returns a whole array of destinations the
 * traveller can reach — each with an *indicative* flight price, sample dates,
 * an average nightly hotel cost, coordinates and a thumbnail — in ONE call.
 * This is destination-first discovery, the inverse of the route-first Low-Fare
 * Radar (which must already know the destination).
 *
 * IMPORTANT: the prices here are discovery signals, NOT bookable fares. The
 * real, bookable price is confirmed later by the existing SerpApi flight-search
 * path when the user drills into a destination.
 *
 * All network calls happen server-side (Convex actions); the API key never
 * crosses the frontend boundary and is never logged.
 *
 * Same provider as `searchApiFlights.ts` / `searchApiAccommodations.ts` (shared
 * SEARCHAPI_API_KEY + endpoint), just a different `engine`. Kept self-contained
 * — the tiny key/fetch helpers are replicated rather than shared, matching the
 * sibling lib files.
 *
 * Failure philosophy: any error (missing key, network, HTTP, empty results,
 * malformed JSON) resolves to `null` so the caller degrades to an empty screen
 * rather than blowing up.
 */

import type { ExploreDestination, ExploreQuery } from "../../types/flights";

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

// Values accepted by the Explore engine — mirror what we expose to the client.
const TRAVEL_MODES = new Set(["all", "flights_only"]);
const INTERESTS = new Set([
  "popular",
  "outdoors",
  "beaches",
  "museums",
  "history",
  "skiing",
]);
const STOPS = new Set([
  "any",
  "nonstop",
  "one_stop_or_fewer",
  "two_stops_or_fewer",
]);

// The Google Travel `hl` param does NOT accept bare "en" — it wants
// region-qualified codes. Full supported set per searchapi.io docs
// (https://www.searchapi.io/docs/parameters/google-travel/hl). We normalize
// the app's language onto this set so a "en" (or any unsupported code) can't
// 400 the whole request.
const SUPPORTED_HL = new Set([
  "af", "bs", "ca", "cs", "da", "de", "et", "en-GB", "en-US", "es", "es-419",
  "eu", "fil", "fr", "gl", "hr", "id", "is", "it", "sw", "lv", "lt", "hu", "ms",
  "nl", "no", "pl", "pt-BR", "pt-PT", "ro", "sq", "sk", "sl", "sr-Latn", "fi",
  "sv", "vi", "tr", "el", "bg", "mk", "mn", "ru", "sr", "uk", "ka", "iw", "ur",
  "ar", "fa", "am", "ne", "mr", "hi", "bn", "pa", "gu", "ta", "te", "kn", "ml",
  "si", "th", "lo", "km", "ko", "ja", "zh-CN", "zh-TW",
]);

// Bare base codes that have no exact entry but a well-known regional default.
const HL_ALIAS: Record<string, string> = {
  en: "en-US",
  pt: "pt-PT",
  zh: "zh-CN",
  he: "iw", // Google uses the legacy "iw" for Hebrew
  nb: "no",
  nn: "no",
};

/**
 * Map any incoming UI language onto a `hl` value the Google Travel engines
 * accept. Exported for reuse by the sibling `google_travel_explore_destination`
 * lib — this table is large enough that duplicating it would just invite drift.
 */
export function normalizeHl(raw?: string): string {
  const fallback = "en-US";
  if (!raw) return fallback;
  const v = raw.trim().replace("_", "-");
  if (SUPPORTED_HL.has(v)) return v; // exact (e.g. "en-GB", "pt-BR", "el")
  const base = v.split("-")[0].toLowerCase();
  if (SUPPORTED_HL.has(base)) return base; // "es-ES" -> "es", "de-DE" -> "de"
  if (HL_ALIAS[base]) return HL_ALIAS[base];
  return fallback;
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
    console.error("[searchapi-explore] Network error");
    return null;
  }

  if (!res.ok) {
    // Surface the API's own error body (truncated) — a bare status code makes
    // a 400 impossible to diagnose. SearchApi returns a JSON `{ error: ... }`
    // explaining exactly which parameter it rejected.
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    console.error(`[searchapi-explore] HTTP ${res.status} ${detail}`);
    return null;
  }

  try {
    const json = await res.json();
    if (json?.error) {
      console.error("[searchapi-explore] API error:", String(json.error));
      return null;
    }
    return json;
  } catch {
    console.error("[searchapi-explore] Invalid JSON response");
    return null;
  }
}

/**
 * `coordinates` comes back as a [latitude, longitude] pair. Guard against
 * anything else and return undefined so the UI can skip it.
 */
function parseCoordinates(
  raw: unknown
): { lat: number; lng: number } | undefined {
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = toNumber(raw[0]);
    const lng = toNumber(raw[1]);
    if (lat !== undefined && lng !== undefined) return { lat, lng };
  }
  return undefined;
}

/**
 * Query searchapi.io Google Travel Explore for one departure airport and
 * return the normalized list of reachable destinations. Returns `null` when
 * the key is missing, the API fails, or no usable destination comes back.
 */
export async function fetchExploreDestinations(
  q: ExploreQuery
): Promise<ExploreDestination[] | null> {
  const key = getSearchApiKey();
  if (!key) return null;
  if (!q.departureId?.trim()) return null;

  const params = new URLSearchParams();
  params.append("engine", "google_travel_explore");
  params.append("departure_id", q.departureId.trim().toUpperCase());
  params.append("currency", (q.currency || "EUR").toUpperCase());
  params.append("hl", normalizeHl(q.hl));
  // NOTE: `gl` is intentionally NOT sent. It's the one param our proven
  // google_flights integration (searchApiFlights.ts) doesn't use, and it's
  // non-essential for a discovery grid (hl + currency already localize). It
  // was the prime suspect for the observed HTTP 400 on this engine. If the
  // body log below shows a different offending param, revisit.

  // `interests` is documented as incompatible with `travel_mode=flights_only`,
  // so never send both. travel_mode wins only when explicitly flights_only.
  const travelMode = (q.travelMode || "").trim();
  const wantsFlightsOnly = travelMode === "flights_only";
  if (TRAVEL_MODES.has(travelMode)) params.append("travel_mode", travelMode);

  const interests = (q.interests || "").trim();
  if (!wantsFlightsOnly && INTERESTS.has(interests)) {
    params.append("interests", interests);
  }

  const stops = (q.stops || "").trim();
  if (STOPS.has(stops)) params.append("stops", stops);

  if (q.timePeriod?.trim()) params.append("time_period", q.timePeriod.trim());

  const maxPrice = toNumber(q.maxPrice);
  if (maxPrice !== undefined) params.append("max_price", String(maxPrice));

  // Only send `adults` when above the engine default of 1 — keeps the default
  // request minimal (the documented example sends departure_id + engine only).
  const adults = Math.min(Math.max(Math.round(q.adults ?? 1), 1), 9);
  if (adults > 1) params.append("adults", String(adults));

  const json = await callSearchApi(params, key);
  if (!json) return null;

  const raw: any[] = Array.isArray(json.destinations) ? json.destinations : [];

  const destinations: ExploreDestination[] = [];
  for (const d of raw) {
    const name = typeof d?.name === "string" ? d.name.trim() : "";
    if (!name) continue;
    const flight = d?.flight ?? {};
    destinations.push({
      name,
      country: typeof d?.country === "string" ? d.country : undefined,
      kgmid: typeof d?.kgmid === "string" ? d.kgmid : undefined,
      // Prefer the destination's primary airport; fall back to the flight's
      // arrival airport code. Either is a usable IATA for a follow-up search.
      iata:
        (typeof d?.primary_airport === "string" && d.primary_airport) ||
        (typeof flight?.airport_code === "string" && flight.airport_code) ||
        undefined,
      coordinates: parseCoordinates(d?.coordinates),
      price: toNumber(flight?.price),
      stops: toNumber(flight?.stops),
      airline:
        typeof flight?.airline_name === "string"
          ? flight.airline_name
          : undefined,
      flightDuration:
        typeof flight?.flight_duration === "string"
          ? flight.flight_duration
          : undefined,
      avgHotelPerNight: toNumber(d?.avg_cost_per_night),
      outboundDate:
        typeof d?.outbound_date === "string" ? d.outbound_date : undefined,
      returnDate:
        typeof d?.return_date === "string" ? d.return_date : undefined,
      // The engine's own image, kept only as a fallback for when the Unsplash
      // lookup on the client returns nothing.
      thumbnail: typeof d?.image === "string" ? d.image : undefined,
    });
  }

  if (destinations.length === 0) return null;

  // Cheapest-first: the whole point of the screen is affordable discovery.
  destinations.sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
  );

  return destinations;
}
