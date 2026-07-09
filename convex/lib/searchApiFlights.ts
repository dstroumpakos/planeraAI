/**
 * searchapi.io Google Flights search — used to re-price specific Low-Fare
 * Radar deals.
 *
 * Docs: https://www.searchapi.io/docs/google-flights-api
 *
 * The Low-Fare Radar price-refresh cron uses this to re-price manually-added
 * (curated) deals. Crucially, it does NOT just grab the cheapest fare on the
 * route — it matches the returned options back to the *specific* flight stored
 * on the deal (by flight number, or airline + departure time) so we only ever
 * update the price of the same flight the admin curated.
 *
 * All network calls happen server-side (Convex actions); the API key never
 * crosses the frontend boundary and is never logged.
 *
 * NOTE: this is a DIFFERENT provider from the user-facing flight search, which
 * uses SerpApi (`convex/lib/serpApiFlights.ts`). Both mimic Google Flights so
 * the response shapes are near-identical, but the request params differ:
 *   - searchapi.io uses `flight_type` = "round_trip" | "one_way" (string)
 *   - SerpApi uses `type` = 1 | 2 (integer)
 *
 * Failure philosophy: this powers a best-effort background refresh, NOT a
 * critical path. Any error (missing key, network, HTTP, empty results,
 * malformed JSON) resolves to `null` so the cron simply leaves the deal's
 * existing price untouched.
 */

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

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

/** Normalize a flight number for comparison: "IB 212" / "ib212" → "IB212". */
export function normalizeFlightNumber(s?: string | null): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Pull "HH:MM" out of a searchapi time like "08:00" or "2024-06-10 08:00". */
export function extractHm(s?: string | null): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
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
    console.error("[searchapi-flights] Network error");
    return null;
  }

  if (!res.ok) {
    console.error(`[searchapi-flights] HTTP ${res.status}`);
    return null;
  }

  try {
    const json = await res.json();
    if (json?.error) {
      console.error("[searchapi-flights] API error:", String(json.error));
      return null;
    }
    return json;
  } catch {
    console.error("[searchapi-flights] Invalid JSON response");
    return null;
  }
}

export interface RadarFareQuery {
  origin: string;        // IATA e.g. "ATH"
  destination: string;   // IATA e.g. "CDG"
  outboundDate: string;  // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD — round-trip when present
  currency: string;      // e.g. "EUR"
  adults?: number;       // default 1 → returned price is per-person
}

/** A single normalized flight option returned by searchapi.io. */
export interface RadarFlightOption {
  /** Total price for this option (round-trip total when it's a round trip). */
  price: number;
  /** Outbound-leg flight numbers in order, normalized (e.g. ["A3601"]). */
  outboundFlightNumbers: string[];
  /** First outbound segment's airline name. */
  airline: string | null;
  /** First outbound segment departure time, "HH:MM". */
  outboundDepartureTime: string | null;
  /** Outbound stop count (segments - 1). */
  outboundStops: number;
}

export interface RadarFlightOptionsResult {
  options: RadarFlightOption[];
  priceLevel: string | null; // "low" | "typical" | "high"
  /**
   * Google's historical typical price range for this route+dates, [low, high],
   * from `price_insights.typical_price_range`. Null when Google doesn't provide
   * it. Same basis as an option's `price` (round-trip total for round trips).
   */
  typicalPriceRange: [number, number] | null;
}

/**
 * Query searchapi.io Google Flights for one route + date(s) and return ALL
 * priced options (best + other), normalized for matching. Returns `null` when
 * the key is missing, the API fails, or no priced option comes back.
 *
 * For round trips the initial search returns outbound options only (the return
 * leg is chosen via a follow-up token) and each option's `price` is the
 * round-trip total — which is exactly the figure a radar deal represents.
 */
export async function fetchRadarFlightOptions(
  q: RadarFareQuery
): Promise<RadarFlightOptionsResult | null> {
  const key = getSearchApiKey();
  if (!key) return null;
  if (!q.origin?.trim() || !q.destination?.trim() || !q.outboundDate) return null;

  const currency = (q.currency || "EUR").toUpperCase();
  const params = new URLSearchParams();
  params.append("engine", "google_flights");
  params.append("departure_id", q.origin.trim().toUpperCase());
  params.append("arrival_id", q.destination.trim().toUpperCase());
  params.append("outbound_date", q.outboundDate);
  if (q.returnDate) {
    params.append("flight_type", "round_trip");
    params.append("return_date", q.returnDate);
  } else {
    params.append("flight_type", "one_way");
  }
  params.append("currency", currency);
  params.append("adults", String(Math.min(Math.max(q.adults ?? 1, 1), 9)));
  params.append("hl", "en");

  const json = await callSearchApi(params, key);
  if (!json) return null;

  const raw: any[] = [
    ...(Array.isArray(json.best_flights) ? json.best_flights : []),
    ...(Array.isArray(json.other_flights) ? json.other_flights : []),
  ];

  const options: RadarFlightOption[] = [];
  for (const opt of raw) {
    const price = toNumber(opt?.price);
    if (price === undefined) continue;
    const segs: any[] = Array.isArray(opt?.flights) ? opt.flights : [];
    options.push({
      price,
      outboundFlightNumbers: segs
        .map((s) => normalizeFlightNumber(s?.flight_number))
        .filter(Boolean),
      airline: segs[0]?.airline ?? null,
      outboundDepartureTime: extractHm(segs[0]?.departure_airport?.time),
      outboundStops: Math.max(0, segs.length - 1),
    });
  }

  if (options.length === 0) return null;

  const priceLevel =
    typeof json?.price_insights?.price_level === "string"
      ? json.price_insights.price_level
      : null;

  // Google's historical typical price range, e.g. [180, 320]. Guard against
  // malformed shapes so a bad response can't produce a nonsense benchmark.
  let typicalPriceRange: [number, number] | null = null;
  const rawRange = json?.price_insights?.typical_price_range;
  if (Array.isArray(rawRange) && rawRange.length === 2) {
    const lo = toNumber(rawRange[0]);
    const hi = toNumber(rawRange[1]);
    if (lo !== undefined && hi !== undefined && lo > 0 && hi >= lo) {
      typicalPriceRange = [lo, hi];
    }
  }

  return { options, priceLevel, typicalPriceRange };
}

/** What we know about the deal's specific flight, used to match a fresh option. */
export interface RadarDealCriteria {
  /** Normalized outbound flight numbers from the deal (may be empty). */
  flightNumbers: string[];
  /** Deal airline name (first outbound segment). */
  airline?: string | null;
  /** Deal outbound departure time, "HH:MM". */
  departureTime?: string | null;
}

export interface RadarMatch {
  option: RadarFlightOption;
  matchType: "flight_number" | "airline_time";
}

/**
 * Find the fresh option that corresponds to the deal's specific flight.
 *
 * Priority:
 *   1. flight_number — the option's outbound flight numbers match the deal's
 *      (exact set, else the deal's numbers are all present in the option).
 *   2. airline_time — same airline + same outbound departure time.
 *
 * Returns `null` when no confident match exists (the curated flight is no
 * longer offered) — the caller should then leave the deal's price untouched
 * rather than substitute a different flight.
 */
export function matchRadarOption(
  options: RadarFlightOption[],
  criteria: RadarDealCriteria
): RadarMatch | null {
  const dealNums = criteria.flightNumbers.filter(Boolean);

  if (dealNums.length > 0) {
    const dealKey = [...dealNums].sort().join(",");
    // Prefer an exact flight-sequence match.
    const exact = options.find(
      (o) => [...o.outboundFlightNumbers].sort().join(",") === dealKey
    );
    if (exact) return { option: exact, matchType: "flight_number" };
    // Otherwise accept an option that contains all the deal's flight numbers.
    const subset = options.find((o) =>
      dealNums.every((n) => o.outboundFlightNumbers.includes(n))
    );
    if (subset) return { option: subset, matchType: "flight_number" };
  }

  // Fallback: airline + departure time (for deals with no stored flight no.).
  const airline = (criteria.airline || "").trim().toLowerCase();
  const time = criteria.departureTime || null;
  if (airline && time) {
    const byAirlineTime = options.find(
      (o) =>
        (o.airline || "").trim().toLowerCase() === airline &&
        o.outboundDepartureTime === time
    );
    if (byAirlineTime) return { option: byAirlineTime, matchType: "airline_time" };
  }

  return null;
}
