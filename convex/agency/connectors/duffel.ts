/**
 * Duffel connector — the first REAL supplier integration.
 *
 * Chosen first because it is the only provider on the matrix whose BYOK story
 * is self-serve: the agency creates its own Duffel account, generates a token,
 * and pastes it in. No certification, no per-tenant contract with us. See
 * `planeraai-web/docs/agency-portal/provider-onboarding-matrix.md`.
 *
 * Scope: search + revalidate + health check. Booking is deliberately NOT
 * implemented — the MVP is quote-first and the agency remains the seller and
 * ticketer, so nothing here can create an order.
 *
 * Token handling: the agency's key arrives decrypted from the vault, is used
 * for one request, and is never logged. `fetchJson` errors never include
 * request headers.
 */

import type {
  NormalizedFlightOffer,
  NormalizedOffer,
  FlightSegment,
} from "../model/types";
import { money } from "../model/types";
import type {
  HealthStatus,
  RevalidateResult,
  SearchQuery,
  SupplierConnector,
  SupplierCredentials,
} from "./types";
import { decimalToMinor, fetchJson, isoDurationToMinutes, SupplierHttpError } from "./http";

const BASE_URL = "https://api.duffel.com";
const DUFFEL_VERSION = "v2";
const CONNECTOR_ID = "duffel";

const CABIN_CLASSES = new Set(["economy", "premium_economy", "business", "first"]);

function authHeaders(creds: SupplierCredentials): Record<string, string> {
  const token = creds.fields.apiKey?.trim();
  if (!token) throw new Error("Duffel access token is missing");
  // A live token in a sandbox connection (or the reverse) would quietly hit the
  // wrong inventory — and in the live case, real money. Refuse the mismatch.
  const isTest = token.startsWith("duffel_test_");
  const isLive = token.startsWith("duffel_live_");
  if (isTest && creds.environment === "production") {
    throw new Error("this is a Duffel TEST token but the connection is set to production");
  }
  if (isLive && creds.environment === "sandbox") {
    throw new Error("this is a Duffel LIVE token but the connection is set to sandbox");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Duffel-Version": DUFFEL_VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// ── Response shapes (only the fields we consume) ─────────────────────────────

interface DuffelSegment {
  origin?: { iata_code?: string };
  destination?: { iata_code?: string };
  departing_at?: string;
  arriving_at?: string;
  duration?: string;
  marketing_carrier?: { iata_code?: string; name?: string };
  marketing_carrier_flight_number?: string;
  passengers?: Array<{
    cabin_class?: string;
    baggages?: Array<{ type?: string; quantity?: number }>;
  }>;
}

interface DuffelSlice {
  origin?: { iata_code?: string };
  destination?: { iata_code?: string };
  duration?: string;
  segments?: DuffelSegment[];
}

interface DuffelConditionsLeg {
  allowed?: boolean;
  penalty_amount?: string | null;
  penalty_currency?: string | null;
}

interface DuffelOffer {
  id: string;
  total_amount?: string;
  total_currency?: string;
  base_amount?: string;
  tax_amount?: string | null;
  expires_at?: string;
  owner?: { iata_code?: string; name?: string };
  slices?: DuffelSlice[];
  conditions?: {
    refund_before_departure?: DuffelConditionsLeg | null;
    change_before_departure?: DuffelConditionsLeg | null;
  };
}

// ── Normalisation ───────────────────────────────────────────────────────────

function toSegments(slice: DuffelSlice | undefined): FlightSegment[] {
  return (slice?.segments ?? []).map((s) => ({
    fromIata: s.origin?.iata_code ?? "",
    toIata: s.destination?.iata_code ?? "",
    departISO: s.departing_at ?? "",
    arriveISO: s.arriving_at ?? "",
    carrier: s.marketing_carrier?.iata_code ?? "",
    flightNumber: s.marketing_carrier_flight_number,
    durationMinutes: isoDurationToMinutes(s.duration),
  }));
}

function baggageFrom(slice: DuffelSlice | undefined) {
  // Duffel reports allowances per passenger per segment; the quote needs one
  // number, so take the WORST segment — that is what the traveller can rely on.
  let cabin = Number.POSITIVE_INFINITY;
  let checked = Number.POSITIVE_INFINITY;
  for (const seg of slice?.segments ?? []) {
    const bags = seg.passengers?.[0]?.baggages ?? [];
    const c = bags.filter((b) => b.type === "carry_on").reduce((n, b) => n + (b.quantity ?? 0), 0);
    const k = bags.filter((b) => b.type === "checked").reduce((n, b) => n + (b.quantity ?? 0), 0);
    cabin = Math.min(cabin, c);
    checked = Math.min(checked, k);
  }
  return {
    cabin: Number.isFinite(cabin) ? cabin : 0,
    checked: Number.isFinite(checked) ? checked : 0,
  };
}

function penalty(leg: DuffelConditionsLeg | null | undefined, fallbackCurrency: string) {
  if (!leg?.penalty_amount) return undefined;
  const currency = leg.penalty_currency ?? fallbackCurrency;
  return money(decimalToMinor(leg.penalty_amount, currency), currency);
}

function normaliseOffer(offer: DuffelOffer, now: number): NormalizedFlightOffer | null {
  const currency = offer.total_currency;
  if (!offer.id || !offer.total_amount || !currency) return null;

  const total = decimalToMinor(offer.total_amount, currency);
  const taxes = offer.tax_amount ? decimalToMinor(offer.tax_amount, currency) : 0;
  // `base` must exclude taxes: the pricing engine adds them back and would
  // otherwise double-count. Derive rather than trusting base_amount, which is
  // absent on some offers.
  const base = total - taxes;

  const outboundSlice = offer.slices?.[0];
  const inboundSlice = offer.slices?.[1];
  const outbound = toSegments(outboundSlice);
  if (outbound.length === 0) return null;
  const inbound = inboundSlice ? toSegments(inboundSlice) : undefined;

  const refund = offer.conditions?.refund_before_departure;
  const change = offer.conditions?.change_before_departure;

  const sliceMinutes = (s: DuffelSlice | undefined, segs: FlightSegment[]) =>
    isoDurationToMinutes(s?.duration) || segs.reduce((n, x) => n + x.durationMinutes, 0);

  return {
    kind: "flight",
    offerId: `${CONNECTOR_ID}:${offer.id}`,
    connectorId: CONNECTOR_ID,
    supplierOfferId: offer.id,
    cost: {
      rateType: "net",
      base: money(base, currency),
      taxes: money(taxes, currency),
    },
    conditions: {
      refundable: !!refund?.allowed,
      changeable: !!change?.allowed,
      cancellationPenalty: penalty(refund, currency),
      changePenalty: penalty(change, currency),
      summary: offer.owner?.name,
    },
    // Duffel offers are revalidated (and would be booked) by their own id.
    revalidationToken: offer.id,
    quotedAt: now,
    expiresAt: offer.expires_at ? Date.parse(offer.expires_at) : undefined,
    outbound,
    inbound,
    outboundStops: Math.max(0, outbound.length - 1),
    inboundStops: inbound ? Math.max(0, inbound.length - 1) : undefined,
    totalDurationMinutes:
      sliceMinutes(outboundSlice, outbound) +
      (inbound ? sliceMinutes(inboundSlice, inbound) : 0),
    cabinClass: outboundSlice?.segments?.[0]?.passengers?.[0]?.cabin_class ?? "economy",
    baggage: baggageFrom(outboundSlice),
  };
}

// ── Connector ───────────────────────────────────────────────────────────────

export const duffelConnector: SupplierConnector = {
  id: CONNECTOR_ID,
  displayName: "Duffel",
  capabilities: {
    kinds: ["flight"],
    supports: {
      search: true,
      retrieveOffer: true,
      revalidate: true,
      // Quote-first MVP: the agency books and ticks in its own Duffel account.
      createBooking: false,
      retrieveBooking: false,
      cancelBooking: false,
      getCancellationTerms: false,
      healthCheck: true,
    },
  },

  async healthCheck(creds: SupplierCredentials): Promise<HealthStatus> {
    const t0 = Date.now();
    try {
      await fetchJson<unknown>(
        `${BASE_URL}/air/airlines?limit=1`,
        { method: "GET", headers: authHeaders(creds) },
        { connectorId: CONNECTOR_ID, timeoutMs: 8000, retries: 1 },
      );
      return { healthy: true, environment: creds.environment, latencyMs: Date.now() - t0 };
    } catch (e) {
      const err = e as SupplierHttpError;
      return {
        healthy: false,
        environment: creds.environment,
        latencyMs: Date.now() - t0,
        message:
          err.status === 401 || err.status === 403
            ? "Duffel rejected this access token"
            : (err.message ?? "Duffel is unreachable"),
      };
    }
  },

  async search(creds: SupplierCredentials, q: SearchQuery): Promise<NormalizedOffer[]> {
    if (q.kind !== "flight") return [];
    if (!q.originIata || !q.destinationIata || !q.departDate) {
      throw new Error("Duffel needs an origin, a destination and a departure date");
    }

    const slices: Array<Record<string, string>> = [
      { origin: q.originIata, destination: q.destinationIata, departure_date: q.departDate },
    ];
    if (q.returnDate) {
      slices.push({
        origin: q.destinationIata,
        destination: q.originIata,
        departure_date: q.returnDate,
      });
    }

    const passengers: Array<Record<string, string | number>> = [
      ...Array.from({ length: q.adults }, () => ({ type: "adult" })),
      ...q.childrenAges.map((age) => ({ age })),
    ];

    const cabin = q.cabinClass && CABIN_CLASSES.has(q.cabinClass) ? q.cabinClass : "economy";

    const body = {
      data: {
        slices,
        passengers,
        cabin_class: cabin,
      },
    };

    const res = await fetchJson<{ data?: { offers?: DuffelOffer[] } }>(
      // `supplier_timeout` caps how long Duffel waits on the airlines themselves,
      // keeping this call inside our own per-connector deadline.
      `${BASE_URL}/air/offer_requests?return_offers=true&supplier_timeout=9000`,
      { method: "POST", headers: authHeaders(creds), body: JSON.stringify(body) },
      { connectorId: CONNECTOR_ID, timeoutMs: 11_000, retries: 1 },
    );

    const now = Date.now();
    const offers = res.data?.offers ?? [];
    const normalised: NormalizedFlightOffer[] = [];
    for (const offer of offers) {
      try {
        const n = normaliseOffer(offer, now);
        if (n) normalised.push(n);
      } catch (e) {
        // One malformed offer must not lose the whole result set.
        console.error("[agency:duffel] skipped an unparseable offer:", (e as Error).message);
      }
    }
    return normalised;
  },

  async revalidate(creds: SupplierCredentials, revalidationToken: string): Promise<RevalidateResult> {
    try {
      const res = await fetchJson<{ data?: DuffelOffer }>(
        `${BASE_URL}/air/offers/${encodeURIComponent(revalidationToken)}?return_available_services=false`,
        { method: "GET", headers: authHeaders(creds) },
        { connectorId: CONNECTOR_ID, timeoutMs: 9000, retries: 1 },
      );
      const offer = res.data ? normaliseOffer(res.data, Date.now()) : null;
      if (!offer) {
        return { stillAvailable: false, message: "Duffel no longer holds this offer" };
      }
      if (offer.expiresAt && offer.expiresAt <= Date.now()) {
        return { stillAvailable: false, offer, message: "this fare has expired" };
      }
      return { stillAvailable: true, offer, priceChanged: false };
    } catch (e) {
      const err = e as SupplierHttpError;
      // A 404 is a definite answer: the offer is gone. Anything else is a
      // failure to verify, which the orchestrator must treat as unverifiable
      // rather than as "unavailable".
      if (err.status === 404 || err.status === 410) {
        return { stillAvailable: false, message: "this fare is no longer available" };
      }
      throw err;
    }
  },
};
