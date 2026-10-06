/**
 * Duffel Stays — hotels through the SAME Duffel account and token as flights.
 *
 * Built from Duffel's public documentation (search, fetch_all_rates, quotes,
 * bookings, places) and not yet run against a live Stays-enabled account.
 * Stays is NOT on by default: the agency has to request access from Duffel.
 * Until it does, every call answers 401/403 and `staysError` turns that into a
 * sentence the agent can act on.
 *
 * The flow, and how each step maps onto ours:
 *
 *   search  POST /stays/search                 → one hotel offer per result,
 *                                                 priced at its cheapest rate;
 *                                                 token "stays_sr:<search_result_id>"
 *   revalidate  fetch_all_rates → cheapest rate → POST /stays/quotes
 *                                               → the authoritative price, the
 *                                                 real cancellation terms and
 *                                                 board; token "stays_rate:<rate_id>"
 *   book    fresh quote from the rate → price check → POST /stays/bookings
 *
 * A quote is short-lived, so we never store one: the token carries the RATE
 * and every booking re-quotes it. That is also where the "price rose" guard
 * sits — the agency never pays more than it sold without being told.
 */

import type { NormalizedHotelOffer, PayAtPropertyCharge } from "../model/types";
import { money } from "../model/types";
import type {
  BookingRequest,
  BookingResult,
  RevalidateResult,
  SearchQuery,
  SupplierCredentials,
} from "./types";
import { decimalToMinor, fetchJson, SupplierHttpError } from "./http";

const BASE_URL = "https://api.duffel.com";
const CONNECTOR_ID = "duffel";

export const STAYS_SEARCH_PREFIX = "stays_sr:";
export const STAYS_RATE_PREFIX = "stays_rate:";
export const isStaysToken = (token: string) =>
  token.startsWith(STAYS_SEARCH_PREFIX) || token.startsWith(STAYS_RATE_PREFIX);

type Headers = Record<string, string>;

// ── Response shapes (only the fields we read) ───────────────────────────────

interface StaysAccommodation {
  id?: string;
  name?: string;
  rating?: number | null;
  review_score?: number | null;
  location?: {
    address?: { city_name?: string; line_one?: string };
    geographic_coordinates?: { latitude?: number; longitude?: number };
  };
  rooms?: StaysRoom[];
}

interface StaysRoom {
  name?: string;
  rates?: StaysRate[];
}

export interface StaysRate {
  id: string;
  total_amount?: string;
  total_currency?: string;
  base_amount?: string | null;
  tax_amount?: string | null;
  fee_amount?: string | null;
  due_at_accommodation_amount?: string | null;
  due_at_accommodation_currency?: string | null;
  board_type?: string | null;
  cancellation_timeline?: Array<{ refund_amount?: string; currency?: string; before?: string }>;
  expires_at?: string | null;
}

interface StaysSearchResult {
  id: string;
  cheapest_rate_total_amount?: string;
  cheapest_rate_currency?: string;
  accommodation?: StaysAccommodation;
}

interface StaysQuote {
  id: string;
  total_amount?: string;
  total_currency?: string;
  base_amount?: string | null;
  tax_amount?: string | null;
  fee_amount?: string | null;
  due_at_accommodation_amount?: string | null;
  due_at_accommodation_currency?: string | null;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * 401/403 on a Stays path with a token that works for flights means one thing
 * in practice: Stays was never switched on for this Duffel account.
 */
export function staysError(e: unknown): Error {
  const err = e as SupplierHttpError;
  if (err instanceof SupplierHttpError && (err.status === 401 || err.status === 403)) {
    return new SupplierHttpError(
      err.status,
      CONNECTOR_ID,
      "Duffel Stays is not enabled on this Duffel account — request access from Duffel, then search again",
    );
  }
  return err instanceof Error ? err : new Error(String(e));
}

// ── Where to search ─────────────────────────────────────────────────────────

interface Place {
  type?: string;
  iata_code?: string | null;
  iata_city_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Stays searches by coordinates, our trips key off an airport. Prefer the
 * CITY the airport serves: Rome Fiumicino sits 25 km from the centre, and a
 * 5 km radius around the runway finds airport hotels, not the Rome the client
 * asked for. Fall back to the airport itself with a wider radius.
 */
export function pickSearchPoint(
  iata: string,
  places: Place[],
): { latitude: number; longitude: number; radiusKm: number } | null {
  const code = iata.toUpperCase();
  const ok = (p: Place | undefined) =>
    !!p && typeof p.latitude === "number" && typeof p.longitude === "number";

  const airport = places.find((p) => p.type === "airport" && p.iata_code === code);
  const cityCode = airport?.iata_city_code ?? code;
  const city = places.find((p) => p.type === "city" && p.iata_code === cityCode);
  if (ok(city)) return { latitude: city!.latitude!, longitude: city!.longitude!, radiusKm: 5 };
  // The code itself may BE a city code (LON, PAR, ROM).
  const cityByCode = places.find((p) => p.type === "city" && p.iata_code === code);
  if (ok(cityByCode)) return { latitude: cityByCode!.latitude!, longitude: cityByCode!.longitude!, radiusKm: 5 };
  if (ok(airport)) return { latitude: airport!.latitude!, longitude: airport!.longitude!, radiusKm: 15 };
  return null;
}

async function resolvePoint(headers: Headers, iata: string) {
  const find = (q: string) =>
    fetchJson<{ data?: Place[] }>(
      `${BASE_URL}/places/suggestions?query=${encodeURIComponent(q)}`,
      { method: "GET", headers },
      { connectorId: CONNECTOR_ID, timeoutMs: 6000, retries: 1 },
    ).then((r) => r.data ?? []);

  let places = await find(iata);
  let point = pickSearchPoint(iata, places);
  // The airport answer names its city code but may not include the city row.
  const airport = places.find((p) => p.type === "airport" && p.iata_code === iata.toUpperCase());
  if (point && point.radiusKm > 5 && airport?.iata_city_code && airport.iata_city_code !== iata) {
    places = [...places, ...(await find(airport.iata_city_code))];
    point = pickSearchPoint(iata, places) ?? point;
  }
  return point;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

const BOARD: Record<string, NormalizedHotelOffer["boardType"]> = {
  room_only: "room_only",
  breakfast: "breakfast",
  half_board: "half_board",
  full_board: "full_board",
  all_inclusive: "all_inclusive",
};

const nightsBetween = (a?: string, b?: string) => {
  if (!a || !b) return 1;
  const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const minor = (value: string | null | undefined, currency: string) =>
  value ? decimalToMinor(value, currency) : 0;

/** One search result → one hotel offer at its cheapest rate. */
export function mapSearchResult(
  r: StaysSearchResult,
  q: Pick<SearchQuery, "departDate" | "returnDate">,
  now: number,
): NormalizedHotelOffer | null {
  const currency = r.cheapest_rate_currency;
  const acc = r.accommodation;
  if (!r.id || !r.cheapest_rate_total_amount || !currency || !acc?.name) return null;
  const total = decimalToMinor(r.cheapest_rate_total_amount, currency);
  return {
    kind: "hotel",
    offerId: `${CONNECTOR_ID}:stays:${acc.id ?? r.id}`,
    connectorId: CONNECTOR_ID,
    supplierOfferId: r.id,
    // Search gives only the cheapest total. Taxes are inside it, so they are
    // not itemised here (itemising a guess would be worse); re-pricing reads
    // the real split from the quote.
    cost: { rateType: "net", base: money(total, currency), taxes: money(0, currency) },
    // Unknown until the rate is fetched — say so rather than promise a refund.
    conditions: {
      refundable: false,
      changeable: false,
      summary: "Οι όροι ακύρωσης επιβεβαιώνονται στην επαναεπιβεβαίωση",
    },
    revalidationToken: `${STAYS_SEARCH_PREFIX}${r.id}`,
    quotedAt: now,
    name: acc.name,
    starRating: acc.rating ?? undefined,
    // Duffel's review_score is already out of 10.
    reviewScore: acc.review_score ?? undefined,
    boardType: "room_only",
    nights: nightsBetween(q.departDate, q.returnDate),
  };
}

/** The cheapest bookable rate across every room of a search result. */
export function cheapestRate(rooms: StaysRoom[]): { rate: StaysRate; roomName?: string } | null {
  let best: { rate: StaysRate; roomName?: string; amount: number } | null = null;
  for (const room of rooms) {
    for (const rate of room.rates ?? []) {
      if (!rate.id || !rate.total_amount || !rate.total_currency) continue;
      const amount = Number(rate.total_amount);
      if (!Number.isFinite(amount)) continue;
      if (!best || amount < best.amount) best = { rate, roomName: room.name, amount };
    }
  }
  return best ? { rate: best.rate, roomName: best.roomName } : null;
}

/**
 * Cancellation terms from the rate's timeline. An entry refunding the whole
 * total `before` a date means free cancellation until then; no entry at all
 * means no refund.
 */
export function staysConditions(rate: StaysRate): NormalizedHotelOffer["conditions"] & {
  freeUntilISO?: string;
} {
  const total = Number(rate.total_amount ?? NaN);
  const full = (rate.cancellation_timeline ?? [])
    .filter((c) => c.before && Number(c.refund_amount) >= total)
    .sort((a, b) => Date.parse(b.before!) - Date.parse(a.before!))[0];
  if (full?.before && Date.parse(full.before) > Date.now()) {
    return {
      refundable: true,
      changeable: true,
      freeUntilISO: full.before,
      summary: `Δωρεάν ακύρωση έως ${full.before.slice(0, 10)}`,
    };
  }
  const partial = (rate.cancellation_timeline ?? []).some((c) => Number(c.refund_amount) > 0);
  return {
    refundable: false,
    changeable: false,
    summary: partial ? "Μερική επιστροφή σε ακύρωση" : "Μη επιστρέψιμο",
  };
}

/** The price split from a quote: base, taxes+fees, and what is paid at the hotel. */
export function quoteCost(q: StaysQuote): NormalizedHotelOffer["cost"] | null {
  const currency = q.total_currency;
  if (!q.total_amount || !currency) return null;
  const total = decimalToMinor(q.total_amount, currency);
  const taxes = minor(q.tax_amount, currency) + minor(q.fee_amount, currency);
  const base = Math.max(0, total - taxes);
  const payAtProperty: PayAtPropertyCharge[] = [];
  const dueCur = q.due_at_accommodation_currency ?? currency;
  const due = minor(q.due_at_accommodation_amount, dueCur);
  if (due > 0) {
    payAtProperty.push({ label: "Πληρωτέο στο κατάλυμα", amount: money(due, dueCur), mandatory: true });
  }
  return {
    rateType: "net",
    base: money(base, currency),
    taxes: money(taxes, currency),
    ...(payAtProperty.length ? { payAtProperty } : {}),
  };
}

// ── Calls ───────────────────────────────────────────────────────────────────

export async function searchStays(
  headers: Headers,
  q: SearchQuery,
): Promise<NormalizedHotelOffer[]> {
  if (!q.destinationIata || !q.departDate || !q.returnDate) {
    // A hotel needs a check-out date; a one-way trip is not a hotel search.
    return [];
  }
  try {
    const point = await resolvePoint(headers, q.destinationIata);
    if (!point) throw new Error(`Duffel could not place ${q.destinationIata} on a map`);

    const guests = [
      ...Array.from({ length: q.adults }, () => ({ type: "adult" })),
      ...q.childrenAges.map((age) => ({ type: "child", age })),
    ];
    const res = await fetchJson<{ data?: { results?: StaysSearchResult[] } }>(
      `${BASE_URL}/stays/search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            rooms: Math.max(1, q.rooms ?? 1),
            location: {
              radius: point.radiusKm,
              geographic_coordinates: { latitude: point.latitude, longitude: point.longitude },
            },
            check_in_date: q.departDate,
            check_out_date: q.returnDate,
            guests,
          },
        }),
      },
      // A search is read-only, so one retry on a dropped connection is safe.
      { connectorId: CONNECTOR_ID, timeoutMs: 11_000, retries: 1 },
    );
    const now = Date.now();
    const out: NormalizedHotelOffer[] = [];
    for (const r of res.data?.results ?? []) {
      try {
        const o = mapSearchResult(r, q, now);
        if (o) out.push(o);
      } catch (e) {
        console.error("[agency:duffel-stays] skipped a result:", (e as Error).message);
      }
    }
    return out;
  } catch (e) {
    throw staysError(e);
  }
}

/** Resolve a stays token to a concrete rate id (fetching rates when needed). */
async function rateFor(
  headers: Headers,
  token: string,
): Promise<{ rateId: string; rate?: StaysRate; roomName?: string } | null> {
  if (token.startsWith(STAYS_RATE_PREFIX)) return { rateId: token.slice(STAYS_RATE_PREFIX.length) };
  const searchResultId = token.slice(STAYS_SEARCH_PREFIX.length);
  const res = await fetchJson<{ data?: { accommodation?: StaysAccommodation } }>(
    `${BASE_URL}/stays/search_results/${encodeURIComponent(searchResultId)}/actions/fetch_all_rates`,
    { method: "POST", headers },
    { connectorId: CONNECTOR_ID, timeoutMs: 11_000, retries: 0 },
  );
  const best = cheapestRate(res.data?.accommodation?.rooms ?? []);
  return best ? { rateId: best.rate.id, rate: best.rate, roomName: best.roomName } : null;
}

async function createQuote(headers: Headers, rateId: string): Promise<StaysQuote | null> {
  const res = await fetchJson<{ data?: StaysQuote }>(
    `${BASE_URL}/stays/quotes`,
    { method: "POST", headers, body: JSON.stringify({ data: { rate_id: rateId } }) },
    // A quote holds nothing, so a retry cannot double-book.
    { connectorId: CONNECTOR_ID, timeoutMs: 11_000, retries: 1 },
  );
  return res.data?.id ? res.data : null;
}

export async function revalidateStay(
  headers: Headers,
  token: string,
): Promise<RevalidateResult> {
  try {
    const found = await rateFor(headers, token);
    if (!found) return { stillAvailable: false, message: "this hotel has no rooms left for these dates" };
    const quote = await createQuote(headers, found.rateId);
    const cost = quote ? quoteCost(quote) : null;
    if (!quote || !cost) return { stillAvailable: false, message: "Duffel could not price this room" };

    const cond = found.rate ? staysConditions(found.rate) : undefined;
    return {
      stillAvailable: true,
      priceChanged: false, // the orchestrator compares against what we quoted
      message: "confirmed by a Duffel Stays quote",
      offer: {
        kind: "hotel",
        offerId: "duffel:stays:revalidated",
        connectorId: CONNECTOR_ID,
        supplierOfferId: found.rateId,
        cost,
        conditions: cond
          ? { refundable: cond.refundable, changeable: cond.changeable, summary: cond.summary }
          : { refundable: false, changeable: false },
        // From here on the token names the RATE, so booking re-quotes it.
        revalidationToken: `${STAYS_RATE_PREFIX}${found.rateId}`,
        quotedAt: Date.now(),
        name: "",
        boardType: BOARD[found.rate?.board_type ?? ""] ?? "room_only",
        roomCategory: found.roomName,
        freeCancellationUntilISO: cond?.freeUntilISO,
        nights: 1,
      },
    };
  } catch (e) {
    const err = staysError(e);
    if (err instanceof SupplierHttpError && (err.status === 404 || err.status === 410)) {
      return { stillAvailable: false, message: "this hotel search has expired — search again" };
    }
    throw err;
  }
}

export async function bookStay(headers: Headers, req: BookingRequest): Promise<BookingResult> {
  let quote: StaysQuote | null;
  try {
    const found = await rateFor(headers, req.revalidationToken);
    if (!found) return { status: "failed", message: "this hotel has no rooms left for these dates" };
    quote = await createQuote(headers, found.rateId);
  } catch (e) {
    const err = staysError(e);
    // Nothing is booked before the booking call, so any failure here is safe.
    return { status: "failed", message: err.message };
  }
  if (!quote?.total_amount || !quote.total_currency) {
    return { status: "failed", message: "Duffel could not price this room" };
  }

  const nowTotal = decimalToMinor(quote.total_amount, quote.total_currency);
  if (
    req.expectedTotal &&
    req.expectedTotal.currency === quote.total_currency &&
    nowTotal > req.expectedTotal.amountMinor
  ) {
    return {
      status: "failed",
      message: `the room rose from ${(req.expectedTotal.amountMinor / 100).toFixed(2)} to ${quote.total_amount} ${quote.total_currency} — revalidate the quote and agree the new price with the client first`,
    };
  }

  const guests = req.passengers.map((p) => ({
    given_name: p.givenName,
    family_name: p.familyName,
    born_on: p.bornOn,
  }));

  // retries: 0 — a booking POST that timed out may have gone through.
  const res = await fetchJson<{
    data?: { id?: string; reference?: string | null; status?: string };
  }>(
    `${BASE_URL}/stays/bookings`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          quote_id: quote.id,
          guests,
          email: req.contact.email,
          phone_number: req.contact.phone,
          metadata: { agency_reference: req.clientReference.slice(0, 500) },
        },
      }),
    },
    { connectorId: CONNECTOR_ID, timeoutMs: 30_000, retries: 0 },
  ).catch((e) => {
    throw staysError(e);
  });

  const b = res.data;
  if (!b?.id) return { status: "failed", message: "Duffel did not return a booking" };
  return {
    status: b.status === "cancelled" ? "failed" : "confirmed",
    supplierReference: b.reference ?? b.id,
    supplierBookingId: b.id,
    amountCharged: money(nowTotal, quote.total_currency),
    message: `Duffel Stays booking ${b.id}`,
  };
}
