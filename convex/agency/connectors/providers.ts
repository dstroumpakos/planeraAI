/**
 * The supplier catalogue, as executable specs.
 *
 * Each entry carries a provider's REAL hosts, auth scheme and endpoints, taken
 * from its official public documentation. Nothing here is invented: where a
 * contract is not public, the entry says exactly what is missing instead of
 * guessing, and `generic.ts` turns that into an honest failure at call time.
 *
 * ── Why most of these authenticate but do not yet search ────────────────────
 *
 * Flight suppliers key their searches off IATA codes, which are universal — so
 * a search we can already express (ATH → CDG) maps straight onto their API.
 * Hotel, activity and ferry suppliers key off their OWN destination taxonomies
 * (Hotelbeds destination codes, Expedia region ids, Viator destination ids,
 * Tiqets city ids, port codes). Those ids cannot be derived from an IATA code;
 * they come from each provider's own locations feed, which has to be fetched
 * and cached before a search can be built at all.
 *
 * That destination-mapping layer NOW EXISTS (`destinations.ts` for the matching,
 * `destinationMap.ts` for fetching and caching), so a resolved id arrives on the
 * query as `providerDestinationId`. Hotelbeds searches on it today. What still
 * blocks the others is their own availability payload, not the destination.
 */

import type { NormalizedFlightOffer, NormalizedHotelOffer, NormalizedOffer } from "../model/types";
import { money } from "../model/types";
import { decimalToMinor, isoDurationToMinutes } from "./http";
import type { ConnectorSpec } from "./generic";

const AVAILABILITY_PAYLOAD_PENDING =
  "destination ids now resolve automatically, but its availability request has to be confirmed against your contract before searches can run";

// ─────────────────────────────────────────────────────────────────────────────
// Amadeus — flights. Fully wired: OAuth2 + Flight Offers Search.
// ─────────────────────────────────────────────────────────────────────────────

interface AmadeusSegment {
  departure?: { iataCode?: string; at?: string };
  arrival?: { iataCode?: string; at?: string };
  carrierCode?: string;
  number?: string;
  duration?: string;
  numberOfStops?: number;
}

interface AmadeusItinerary {
  duration?: string;
  segments?: AmadeusSegment[];
}

interface AmadeusOffer {
  id?: string;
  itineraries?: AmadeusItinerary[];
  price?: { currency?: string; total?: string; base?: string; grandTotal?: string };
  travelerPricings?: Array<{
    fareDetailsBySegment?: Array<{
      cabin?: string;
      includedCheckedBags?: { quantity?: number };
    }>;
  }>;
  pricingOptions?: { fareType?: string[] };
}

const CABIN_TO_AMADEUS: Record<string, string> = {
  economy: "ECONOMY",
  premium_economy: "PREMIUM_ECONOMY",
  business: "BUSINESS",
  first: "FIRST",
};

function amadeusSegments(itinerary: AmadeusItinerary | undefined) {
  return (itinerary?.segments ?? []).map((s) => ({
    fromIata: s.departure?.iataCode ?? "",
    toIata: s.arrival?.iataCode ?? "",
    departISO: s.departure?.at ?? "",
    arriveISO: s.arrival?.at ?? "",
    carrier: s.carrierCode ?? "",
    flightNumber: s.number,
    durationMinutes: isoDurationToMinutes(s.duration),
  }));
}

function mapAmadeusOffer(offer: AmadeusOffer, now: number): NormalizedFlightOffer | null {
  const currency = offer.price?.currency;
  const total = offer.price?.grandTotal ?? offer.price?.total;
  if (!offer.id || !currency || !total) return null;

  const totalMinor = decimalToMinor(total, currency);
  // Amadeus `base` excludes taxes; the difference is the tax component. The
  // pricing engine adds taxes back, so base must NOT already include them.
  const baseMinor = offer.price?.base ? decimalToMinor(offer.price.base, currency) : totalMinor;
  const taxesMinor = Math.max(0, totalMinor - baseMinor);

  const outboundItin = offer.itineraries?.[0];
  const inboundItin = offer.itineraries?.[1];
  const outbound = amadeusSegments(outboundItin);
  if (outbound.length === 0) return null;
  const inbound = inboundItin ? amadeusSegments(inboundItin) : undefined;

  const fareDetails = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0];
  const checked = fareDetails?.includedCheckedBags?.quantity ?? 0;

  const minutes = (itin: AmadeusItinerary | undefined, segs: typeof outbound) =>
    isoDurationToMinutes(itin?.duration) || segs.reduce((n, s) => n + s.durationMinutes, 0);

  return {
    kind: "flight",
    offerId: `amadeus:${offer.id}`,
    connectorId: "amadeus",
    supplierOfferId: offer.id,
    cost: {
      rateType: "net",
      base: money(baseMinor, currency),
      taxes: money(taxesMinor, currency),
    },
    conditions: {
      // Amadeus only reveals penalties on a priced/confirmed offer, so the
      // search result must not claim either way.
      refundable: false,
      changeable: false,
      summary: offer.pricingOptions?.fareType?.join(", "),
    },
    // Amadeus re-prices via Flight Offers Price, which posts the whole offer
    // object back. Until that call exists there is no token to hand out, and
    // claiming one would let the quote look re-priceable when it is not.
    revalidationToken: undefined,
    quotedAt: now,
    outbound,
    inbound,
    outboundStops: Math.max(0, outbound.length - 1),
    inboundStops: inbound ? Math.max(0, inbound.length - 1) : undefined,
    totalDurationMinutes:
      minutes(outboundItin, outbound) + (inbound ? minutes(inboundItin, inbound) : 0),
    cabinClass: (fareDetails?.cabin ?? "ECONOMY").toLowerCase(),
    baggage: { cabin: 1, checked },
  };
}

const amadeus: ConnectorSpec = {
  id: "amadeus",
  displayName: "Amadeus",
  kinds: ["flight"],
  // VERIFIED 2026-08 by DNS: neither api.amadeus.com nor test.api.amadeus.com
  // resolves any more, while amadeus.com and developers.amadeus.com do. The
  // Self-Service platform was retired on 17 Jul 2026 and Amadeus is
  // Enterprise-only, issuing an endpoint with the contract — so the host comes
  // from the connection (`apiHost`) and these are documentation, not defaults.
  hosts: { sandbox: "https://test.api.amadeus.com", production: "https://api.amadeus.com" },
  hostField: "apiHost",
  auth: { kind: "oauth2", tokenPath: "/v1/security/oauth2/token", style: "body" },
  // A real, cheap, read-only reference call — proves the token works on the API
  // itself, not just on the token endpoint.
  health: { method: "GET", path: "/v1/reference-data/locations?subType=CITY&keyword=PAR&page%5Blimit%5D=1" },
  search: {
    kinds: ["flight"],
    request: (_creds, query, host) => {
      if (!query.originIata || !query.destinationIata || !query.departDate) return null;
      const params = new URLSearchParams({
        originLocationCode: query.originIata,
        destinationLocationCode: query.destinationIata,
        departureDate: query.departDate,
        adults: String(query.adults),
        currencyCode: query.sellCurrency,
        max: "20",
      });
      if (query.returnDate) params.set("returnDate", query.returnDate);
      if (query.childrenAges.length) params.set("children", String(query.childrenAges.length));
      const cabin = query.cabinClass ? CABIN_TO_AMADEUS[query.cabinClass] : undefined;
      if (cabin) params.set("travelClass", cabin);
      return { method: "GET", url: `${host}/v2/shopping/flight-offers?${params.toString()}` };
    },
    map: (payload) => {
      const offers = (payload as { data?: AmadeusOffer[] })?.data ?? [];
      const now = Date.now();
      const out: NormalizedOffer[] = [];
      for (const offer of offers) {
        try {
          const mapped = mapAmadeusOffer(offer, now);
          if (mapped) out.push(mapped);
        } catch (e) {
          // One unparseable offer must not lose the rest of the result set.
          console.error("[agency:amadeus] skipped an offer:", (e as Error).message);
        }
      }
      return out;
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sabre — flights. OAuth2 proven; Bargain Finder Max payload still to confirm.
// ─────────────────────────────────────────────────────────────────────────────

const sabre: ConnectorSpec = {
  id: "sabre",
  displayName: "Sabre",
  kinds: ["flight"],
  hosts: {
    sandbox: "https://api.cert.platform.sabre.com",
    production: "https://api.platform.sabre.com",
  },
  // Sabre's v2 token endpoint takes the client pair as a Basic header.
  auth: { kind: "oauth2", tokenPath: "/v2/auth/token", style: "basic" },
  health: { method: "GET", path: "" },
  pendingReason:
    "Sabre authenticates, but its Bargain Finder Max request must be built against your certified PCC and Red App agreement before searches can run",
};

// ─────────────────────────────────────────────────────────────────────────────
// Travelport — flights. Certification-gated.
// ─────────────────────────────────────────────────────────────────────────────

const travelport: ConnectorSpec = {
  id: "travelport",
  displayName: "Travelport TripServices",
  kinds: ["flight"],
  hosts: {
    sandbox: "https://api.pp.travelport.com",
    production: "https://api.travelport.com",
  },
  auth: {
    kind: "oauth2",
    tokenPath: "/oauth/oauth20/token",
    style: "body",
    // VERIFIED 2026-08: tokens come from oauth[.pp].travelport.com — both
    // answer 401 to bad credentials — while the same path on the API host is a
    // 404 that reads like a credential failure.
    tokenHosts: {
      sandbox: "https://oauth.pp.travelport.com",
      production: "https://oauth.travelport.com",
    },
  },
  health: { method: "GET", path: "" },
  pendingReason:
    "Travelport authenticates, but its search contract and your Target Branch are issued during developer certification — they are not public",
};

// ─────────────────────────────────────────────────────────────────────────────
// HBX / Hotelbeds — hotels. Signature auth verified; status endpoint is real.
// ─────────────────────────────────────────────────────────────────────────────

const hotelbeds: ConnectorSpec = {
  id: "hotelbeds",
  displayName: "HBX Group / Hotelbeds",
  kinds: ["hotel", "transfer", "activity"],
  hosts: { sandbox: "https://api.test.hotelbeds.com", production: "https://api.hotelbeds.com" },
  auth: { kind: "hotelbedsSignature" },
  // APItude exposes a documented status endpoint — a genuine credential check.
  health: { method: "GET", path: "/hotel-api/1.0/status" },
  pendingReason: `Hotelbeds authenticates and ${AVAILABILITY_PAYLOAD_PENDING}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Expedia Rapid — hotels. EAN signature verified.
// ─────────────────────────────────────────────────────────────────────────────

const expediaRapid: ConnectorSpec = {
  id: "expedia_rapid",
  displayName: "Expedia Rapid",
  kinds: ["hotel"],
  hosts: { sandbox: "https://test.ean.com", production: "https://api.ean.com" },
  auth: { kind: "expediaEan" },
  // Availability without parameters answers 400 when the signature is good and
  // 401 when it is not — which is exactly the question a health check asks.
  health: { method: "GET", path: "/v3/properties/availability" },
  pendingReason: `Expedia Rapid authenticates and ${AVAILABILITY_PAYLOAD_PENDING}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Booking.com Demand API — hotels.
// ─────────────────────────────────────────────────────────────────────────────

const bookingDemand: ConnectorSpec = {
  id: "booking_demand",
  displayName: "Booking.com Demand API",
  kinds: ["hotel"],
  hosts: {
    sandbox: "https://demandapi-sandbox.booking.com",
    production: "https://demandapi.booking.com",
  },
  auth: {
    kind: "bearer",
    extraHeaders: (c): Record<string, string> =>
      c.fields.affiliateId ? { "X-Affiliate-Id": c.fields.affiliateId } : {},
  },
  // A documented reference endpoint that takes no search parameters.
  health: { method: "POST", path: "/3.1/common/locations/countries", body: { languages: ["en-gb"] } },
  pendingReason: `Booking.com authenticates and ${AVAILABILITY_PAYLOAD_PENDING}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Travelgate Hotel-X — hotel aggregator, GraphQL.
// ─────────────────────────────────────────────────────────────────────────────

const travelgate: ConnectorSpec = {
  id: "travelgate",
  displayName: "Travelgate Hotel-X",
  kinds: ["hotel"],
  hosts: { sandbox: "https://api.travelgatex.com", production: "https://api.travelgatex.com" },
  auth: { kind: "apiKeyHeader", header: "Authorization", prefix: "Apikey " },
  // `__typename` is valid against any GraphQL server, so this probes the
  // credential without depending on their schema staying still.
  health: { method: "POST", path: "/", body: { query: "{__typename}" } },
  pendingReason: `Travelgate authenticates and ${AVAILABILITY_PAYLOAD_PENDING}, plus a per-supplier access configuration`,
};

// ─────────────────────────────────────────────────────────────────────────────
// WebBeds — hotels. No public contract.
// ─────────────────────────────────────────────────────────────────────────────

const webbeds: ConnectorSpec = {
  id: "webbeds",
  displayName: "WebBeds",
  kinds: ["hotel"],
  hosts: { sandbox: "https://api.webbeds.com", production: "https://api.webbeds.com" },
  auth: { kind: "bearer" },
  health: { method: "GET", path: "" },
  pendingReason:
    "WebBeds publishes no open API contract — its endpoints and credentials are issued under a distribution agreement, so nothing can be called until that is in place",
};

// ─────────────────────────────────────────────────────────────────────────────
// Viator — activities.
// ─────────────────────────────────────────────────────────────────────────────

const viator: ConnectorSpec = {
  id: "viator",
  displayName: "Viator Partner API",
  kinds: ["activity"],
  hosts: { sandbox: "https://api.sandbox.viator.com", production: "https://api.viator.com" },
  auth: { kind: "apiKeyHeader", header: "exp-api-key" },
  health: { method: "GET", path: "/partner/products/tags" },
  pendingReason: `Viator authenticates and ${AVAILABILITY_PAYLOAD_PENDING}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tiqets — activities.
// ─────────────────────────────────────────────────────────────────────────────

const tiqets: ConnectorSpec = {
  id: "tiqets",
  displayName: "Tiqets Distributor API",
  kinds: ["activity"],
  hosts: { sandbox: "https://api.tiqets.com", production: "https://api.tiqets.com" },
  auth: { kind: "apiKeyHeader", header: "Authorization", prefix: "Token " },
  health: { method: "GET", path: "/v2/products?page_size=1" },
  pendingReason: `Tiqets authenticates and ${AVAILABILITY_PAYLOAD_PENDING}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ferries — Greek market. Neither publishes an open partner API.
// ─────────────────────────────────────────────────────────────────────────────

const liknoss: ConnectorSpec = {
  id: "liknoss",
  displayName: "Liknoss",
  kinds: ["transfer"],
  hosts: { sandbox: "https://api.liknoss.com", production: "https://api.liknoss.com" },
  auth: { kind: "bearer" },
  health: { method: "GET", path: "" },
  pendingReason:
    "Liknoss issues its ferry API contract directly to licensed agencies — request the integration pack from them and the endpoints can be filled in here",
};

const ferryhopper: ConnectorSpec = {
  id: "ferryhopper",
  displayName: "Ferryhopper Partner API",
  kinds: ["transfer"],
  hosts: { sandbox: "https://api.ferryhopper.com", production: "https://api.ferryhopper.com" },
  auth: { kind: "bearer" },
  health: { method: "GET", path: "" },
  pendingReason:
    "Ferryhopper's partner API is shared under NDA after a partnership agreement — its endpoints are not public",
};

/** Every spec-driven provider, in registry order. */
export const CONNECTOR_SPECS: ConnectorSpec[] = [
  amadeus,
  travelport,
  sabre,
  hotelbeds,
  webbeds,
  expediaRapid,
  bookingDemand,
  travelgate,
  liknoss,
  ferryhopper,
  viator,
  tiqets,
];

// ─────────────────────────────────────────────────────────────────────────────
// Destination feeds
//
// Attached below rather than inline so the provider specs above stay readable.
// Only providers whose locations feed is publicly documented get one; the rest
// are mapped by hand, which the resolution layer supports for every provider.
// ─────────────────────────────────────────────────────────────────────────────

/** Hotelbeds content API: destinations, paged, with an ISO country code. */
interface HotelbedsDestination {
  code?: string;
  name?: { content?: string };
  countryCode?: string;
  isoCode?: string;
}

hotelbeds.destinations = {
  request: (_creds, _target, host) => ({
    method: "GET",
    // The feed is a catalogue, not a search: fetch a page and match locally.
    // Hotelbeds destination codes are frequently the IATA city code (PAR, ATH),
    // which the matcher scores as a near-certain hit.
    url: `${host}/hotel-content-api/1.0/locations/destinations?fields=all&language=ENG&from=1&to=1000&useSecondaryLanguage=false`,
  }),
  map: (payload) => {
    const list = (payload as { destinations?: HotelbedsDestination[] })?.destinations ?? [];
    return list
      .filter((d) => d.code && d.name?.content)
      .map((d) => ({
        id: String(d.code),
        name: String(d.name!.content),
        countryCode: d.countryCode ?? d.isoCode,
        type: "city" as const,
      }));
  },
};

/** Viator: a flat destination tree with numeric ids. */
interface ViatorDestination {
  destinationId?: number | string;
  name?: string;
  type?: string;
  iataCode?: string;
  countryCallingCode?: string;
  center?: { latitude?: number; longitude?: number };
}

const VIATOR_TYPE: Record<string, "city" | "region" | "poi"> = {
  CITY: "city",
  REGION: "region",
  COUNTRY: "region",
  STATE: "region",
  NEIGHBORHOOD: "poi",
};

viator.destinations = {
  request: (_creds, _target, host) => ({
    method: "GET",
    url: `${host}/partner/destinations`,
  }),
  map: (payload) => {
    const list = (payload as { destinations?: ViatorDestination[] })?.destinations ?? [];
    return list
      .filter((d) => d.destinationId !== undefined && d.name)
      .map((d) => ({
        id: String(d.destinationId),
        name: String(d.name),
        // Viator publishes an IATA code on airport-adjacent destinations; when
        // present it is by far the most reliable thing to match on.
        iataCodes: d.iataCode ? [d.iataCode] : undefined,
        type: VIATOR_TYPE[String(d.type ?? "").toUpperCase()] ?? "city",
        lat: d.center?.latitude,
        lon: d.center?.longitude,
      }));
  },
};

/** Tiqets: cities, with an ISO country code. */
interface TiqetsCity {
  id?: number | string;
  name?: string;
  country_code?: string;
  country?: { code?: string };
}

tiqets.destinations = {
  request: (_creds, _target, host) => ({
    method: "GET",
    url: `${host}/v2/cities?page_size=1000`,
  }),
  map: (payload) => {
    const raw = payload as { cities?: TiqetsCity[]; data?: TiqetsCity[] };
    const list = raw?.cities ?? raw?.data ?? [];
    return list
      .filter((c) => c.id !== undefined && c.name)
      .map((c) => ({
        id: String(c.id),
        name: String(c.name),
        countryCode: c.country_code ?? c.country?.code,
        type: "city" as const,
      }));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hotelbeds availability — unblocked by the destination-mapping layer.
//
// This is what the mapping layer was for. The request keys off `destination.code`
// (Hotelbeds' own taxonomy), which now arrives as `providerDestinationId`
// instead of being an unusable IATA code.
// ─────────────────────────────────────────────────────────────────────────────

interface HotelbedsRate {
  net?: string;
  sellingRate?: string;
  rateKey?: string;
  boardCode?: string;
  boardName?: string;
  cancellationPolicies?: Array<{ amount?: string; from?: string }>;
  rooms?: number;
  adults?: number;
}

interface HotelbedsHotel {
  code?: number | string;
  name?: string;
  categoryCode?: string;
  categoryName?: string;
  destinationName?: string;
  currency?: string;
  minRate?: string;
  reviews?: Array<{ rate?: number; reviewCount?: number }>;
  rooms?: Array<{ rates?: HotelbedsRate[] }>;
}

const HOTELBEDS_BOARD: Record<string, NormalizedHotelOffer["boardType"]> = {
  RO: "room_only",
  BB: "breakfast",
  HB: "half_board",
  FB: "full_board",
  AI: "all_inclusive",
};

/** "4 EST" / "5 LL" → 4. Hotelbeds encodes stars in the category code. */
function hotelbedsStars(categoryCode: string | undefined): number | undefined {
  const m = /^(\d)/.exec(String(categoryCode ?? ""));
  return m ? Number(m[1]) : undefined;
}

function nightsBetween(from: string | undefined, to: string | undefined): number {
  if (!from || !to) return 1;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000)) : 1;
}

hotelbeds.search = {
  kinds: ["hotel"],
  requiresDestinationId: true,
  request: (_creds, query, host) => {
    // The mapping layer supplies the destination code; without it there is
    // nothing to search and the orchestrator has already skipped us.
    if (!query.providerDestinationId || !query.departDate || !query.returnDate) return null;

    const children = query.childrenAges.length;
    return {
      method: "POST",
      url: `${host}/hotel-api/1.0/hotels`,
      body: {
        stay: { checkIn: query.departDate, checkOut: query.returnDate },
        occupancies: [
          {
            rooms: query.rooms ?? 1,
            adults: query.adults,
            children,
            ...(children
              ? { paxes: query.childrenAges.map((age) => ({ type: "CH", age })) }
              : {}),
          },
        ],
        destination: { code: query.providerDestinationId },
      },
    };
  },
  map: (payload, query) => {
    const hotels =
      (payload as { hotels?: { hotels?: HotelbedsHotel[] } })?.hotels?.hotels ?? [];
    const nights = nightsBetween(query.departDate, query.returnDate);
    const now = Date.now();
    const out: NormalizedOffer[] = [];

    for (const hotel of hotels) {
      try {
        const rate = hotel.rooms?.[0]?.rates?.[0];
        const currency = hotel.currency ?? query.sellCurrency;
        const amount = rate?.net ?? hotel.minRate;
        if (!hotel.code || !hotel.name || !amount) continue;

        const freeCancel = (rate?.cancellationPolicies ?? []).length === 0;

        out.push({
          kind: "hotel",
          offerId: `hotelbeds:${hotel.code}`,
          connectorId: "hotelbeds",
          supplierOfferId: String(hotel.code),
          cost: {
            // Hotelbeds net rates are what the agency pays, taxes included in
            // the net figure — so taxes must be ZERO here, not re-added.
            rateType: "net",
            base: money(decimalToMinor(amount, currency), currency),
            taxes: money(0, currency),
          },
          conditions: {
            refundable: freeCancel,
            changeable: freeCancel,
            summary: freeCancel ? "Free cancellation" : "Cancellation charges apply",
          },
          // rateKey is Hotelbeds' provider-locked handle for re-checking a rate.
          revalidationToken: rate?.rateKey,
          quotedAt: now,
          name: String(hotel.name),
          starRating: hotelbedsStars(hotel.categoryCode),
          reviewScore: hotel.reviews?.[0]?.rate,
          boardType: HOTELBEDS_BOARD[String(rate?.boardCode ?? "").toUpperCase()] ?? "room_only",
          nights,
        });
      } catch (e) {
        console.error("[agency:hotelbeds] skipped a hotel:", (e as Error).message);
      }
    }
    return out;
  },
};

hotelbeds.pendingReason = undefined;
