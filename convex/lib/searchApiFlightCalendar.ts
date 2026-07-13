/**
 * searchapi.io Google Flights Calendar — "cheapest days to fly".
 *
 * Docs: https://www.searchapi.io/docs/google-flights-calendar-api
 *
 * Given an origin + destination, `google_flights_calendar` returns the cheapest
 * fare for a grid of departure/return dates. We query ROUND-TRIP so the prices
 * stay consistent with the explore-destination teaser, then reduce the grid to
 * the cheapest fare PER departure date and pick a spread of the lowest ones for
 * a compact "cheapest days" strip.
 *
 * THE 200-COMBINATION CAP (verified live): the engine rejects any request whose
 * (#outbound dates) × (#return dates) exceeds 200. A ~13-day outbound window
 * paired with a ~15-day return window (~195 combos) is the widest that fits, so
 * this teaser covers roughly the next two weeks of departures — not months out.
 *
 * Other verified quirks: the calendar engine wants a plain `hl` (it rejects
 * region-qualified `en-GB`, unlike the google_travel engines), so we omit `hl`
 * entirely — the response is only dates + prices, which `hl` doesn't affect.
 *
 * IMPORTANT: prices are indicative discovery signals, NOT bookable fares. Each
 * returned date keeps the return that produced its cheapest fare so a tap can
 * prefill both legs of the real `google_flights` search.
 *
 * All network calls happen server-side; the API key never crosses the frontend
 * boundary and is never logged. Failure philosophy: any error resolves to
 * `null` so the caller hides the strip rather than blowing up.
 */

import type { FlightCalendar, FlightCalendarQuery } from "../../types/flights";

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

// Window (offsets from today, in days). Kept under the 200-combination cap:
// 14 outbound days × 14 return days = 196 combos → up to ~14 departure dates.
const OUT_START = 8;
const OUT_END = 21; // inclusive → 14 days
const RET_START = 13;
const RET_END = 26; // inclusive → 14 days
// Surface up to 12 cheapest departure dates (a 4-per-row grid). Spacing 1 =
// no thinning; we just take the cheapest distinct dates and sort by date.
const MAX_DATES = 12;
const MIN_SPACING_DAYS = 1;

function isoOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
  );
}

function getSearchApiKey(): string | null {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || key.trim().length === 0) return null;
  return key.trim();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
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
    console.error("[searchapi-calendar] Network error");
    return null;
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    console.error(`[searchapi-calendar] HTTP ${res.status} ${detail}`);
    return null;
  }
  try {
    const json = await res.json();
    if (json?.error) {
      const msg = String(json.error);
      // A no-data response for this route is an EXPECTED empty outcome, not an
      // operational failure — the caller just hides the "cheapest days" strip.
      // Keep it out of the error logs (mirrors searchApiExploreDestination).
      if (/didn't return any results|no results/i.test(msg)) {
        console.log("[searchapi-calendar] no results for route");
      } else {
        console.error("[searchapi-calendar] API error:", msg);
      }
      return null;
    }
    return json;
  } catch {
    console.error("[searchapi-calendar] Invalid JSON response");
    return null;
  }
}

/**
 * Query the round-trip price calendar and return the cheapest, date-spread
 * departure dates. Returns `null` when the key is missing, the API fails, or
 * nothing usable comes back.
 */
export async function fetchFlightCalendar(
  q: FlightCalendarQuery
): Promise<FlightCalendar | null> {
  const key = getSearchApiKey();
  if (!key) return null;
  if (!q.departureId?.trim() || !q.arrivalId?.trim()) return null;

  const departureId = q.departureId.trim().toUpperCase();
  const rawArrival = q.arrivalId.trim();
  const arrivalId = /^[a-z]{3}$/i.test(rawArrival)
    ? rawArrival.toUpperCase()
    : rawArrival;
  const currency = (q.currency || "EUR").toUpperCase();

  const params = new URLSearchParams();
  params.append("engine", "google_flights_calendar");
  params.append("departure_id", departureId);
  params.append("arrival_id", arrivalId);
  params.append("flight_type", "round_trip");
  // Base dates are required; keep them inside the window.
  params.append("outbound_date", isoOffset(OUT_START));
  params.append("return_date", isoOffset(RET_START));
  params.append("outbound_date_start", isoOffset(OUT_START));
  params.append("outbound_date_end", isoOffset(OUT_END));
  params.append("return_date_start", isoOffset(RET_START));
  params.append("return_date_end", isoOffset(RET_END));
  params.append("currency", currency);
  // NOTE: `hl` intentionally omitted — the calendar engine rejects region codes
  // (e.g. "en-GB") and the response carries no localizable text anyway.

  const json = await callSearchApi(params, key);
  if (!json) return null;

  const raw: any[] = Array.isArray(json.calendar) ? json.calendar : [];

  // Reduce the grid to the cheapest fare per departure date, keeping the return
  // that produced it.
  const perDeparture = new Map<
    string,
    { price: number; returnDate?: string; isLowest: boolean }
  >();
  for (const c of raw) {
    if (c?.has_no_flights) continue;
    const date = typeof c?.departure === "string" ? c.departure : "";
    const price = toNumber(c?.price);
    if (!date || price === undefined) continue;
    const returnDate = typeof c?.return === "string" ? c.return : undefined;
    const isLowest = Boolean(c?.is_lowest_price);
    const existing = perDeparture.get(date);
    if (!existing || price < existing.price) {
      perDeparture.set(date, { price, returnDate, isLowest });
    }
  }

  if (perDeparture.size === 0) return null;

  // Cheapest first, then greedily keep dates that are at least MIN_SPACING_DAYS
  // apart so the strip shows a spread of options rather than a cluster.
  const byPrice = [...perDeparture.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.price - b.price);

  const picked: typeof byPrice = [];
  for (const cand of byPrice) {
    if (picked.length >= MAX_DATES) break;
    if (picked.every((p) => daysBetween(p.date, cand.date) >= MIN_SPACING_DAYS)) {
      picked.push(cand);
    }
  }

  // Soonest first for display.
  picked.sort((a, b) => a.date.localeCompare(b.date));

  return {
    departureId,
    arrivalId,
    currency,
    dates: picked.map((p) => ({
      date: p.date,
      returnDate: p.returnDate,
      price: p.price,
      isLowest: p.isLowest,
    })),
  };
}
