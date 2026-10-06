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
 * query as `providerDestinationId`. Hotelbeds, Expedia Rapid, Booking.com,
 * Viator and Tiqets all search on it.
 *
 * ── What is verified, and what is not ───────────────────────────────────────
 *
 * Every host, auth scheme and health endpoint here has been probed for real.
 * The SEARCH payloads differ in provenance, and the registry notes say which is
 * which per provider:
 *   - Duffel, Amadeus and Hotelbeds are wired against contracts we have run.
 *   - Expedia Rapid, Booking.com, Viator and Tiqets are built from each
 *     provider's public documentation but have never been run against a live
 *     account, so their first real search may need a correction. They are
 *     read-only and fail loudly, which is the whole reason it is safe to ship
 *     them ahead of a test account.
 *   - Travelport, Sabre, WebBeds, Travelgate, Liknoss and Ferryhopper have no
 *     public search contract at all. They authenticate and refuse to search.
 */

import type {
  NormalizedActivityOffer,
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedOffer,
  PayAtPropertyCharge,
} from "../model/types";
import { money } from "../model/types";
import { currencyExponent, decimalToMinor, isoDurationToMinutes } from "./http";
import type { ConnectorSpec } from "./generic";

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
  pricingOptions?: {
    fareType?: string[];
    /**
     * Amadeus only emits these when they are TRUE, so `=== true` is the whole
     * test and an absent flag correctly reads as "not known to be flexible".
     */
    refundableFare?: boolean;
    noPenaltyFare?: boolean;
    noRestrictionFare?: boolean;
    includedCheckedBagsOnly?: boolean;
  };
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
      // Amadeus states flexibility only as positive flags. Absent means "not
      // declared", which must read as inflexible: quoting a fare as refundable
      // when it is not is the expensive direction of this error.
      refundable: offer.pricingOptions?.refundableFare === true,
      changeable:
        offer.pricingOptions?.noPenaltyFare === true ||
        offer.pricingOptions?.noRestrictionFare === true,
      summary: offer.pricingOptions?.fareType?.join(", "),
    },
    // Amadeus re-prices via Flight Offers Price, which takes the WHOLE offer
    // object back rather than an id — so the offer itself is the token. It is
    // opaque to everything above this line, which is exactly the contract
    // `revalidationToken` describes.
    revalidationToken: JSON.stringify(offer),
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
  pendingReason:
    "Travelgate authenticates, but Hotel-X prices a LIST OF HOTEL CODES rather than a destination, and every search needs the access context and client code issued per supplier in your TravelgateX account — none of which can be derived from a city",
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Tiqets — activities.
// ─────────────────────────────────────────────────────────────────────────────

const tiqets: ConnectorSpec = {
  id: "tiqets",
  displayName: "Tiqets Distributor API",
  kinds: ["activity"],
  // Test host per developers.tiqets.dev "Environments and Testing" (renamed
  // with an `api.` prefix on 2026-03-05); its keys come from the account manager.
  hosts: { sandbox: "https://api.api-tiqt-test.steq.it", production: "https://api.tiqets.com" },
  auth: { kind: "apiKeyHeader", header: "Authorization", prefix: "Token " },
  health: { method: "GET", path: "/v2/products?page_size=1" },
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

/**
 * Viator: a flat destination tree with numeric ids. Shapes checked against
 * Viator's own OpenAPI spec (Partner API 2.0): `iataCodes` is an ARRAY — the
 * mapper used to read a singular `iataCode`, which does not exist, so no
 * destination ever matched on its airport code.
 */
interface ViatorDestination {
  destinationId?: number | string;
  name?: string;
  type?: string;
  iataCodes?: string[];
  countryCallingCode?: string;
  center?: { latitude?: number; longitude?: number };
}

/** Every type the spec lists; unknown future values fall back to "city". */
const VIATOR_TYPE: Record<string, "city" | "region" | "poi"> = {
  CITY: "city",
  TOWN: "city",
  VILLAGE: "city",
  HAMLET: "city",
  ISLAND: "city",
  REGION: "region",
  COUNTRY: "region",
  STATE: "region",
  PROVINCE: "region",
  COUNTY: "region",
  PENINSULA: "region",
  "UNION TERRITORY": "region",
  "NATIONAL PARK": "poi",
  AREA: "poi",
  DISTRICT: "poi",
  NEIGHBORHOOD: "poi",
  WARD: "poi",
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
        iataCodes: d.iataCodes?.length ? d.iataCodes.map((c) => String(c).toUpperCase()) : undefined,
        type: VIATOR_TYPE[String(d.type ?? "").toUpperCase()] ?? "city",
        lat: d.center?.latitude,
        lon: d.center?.longitude,
      }));
  },
};

/**
 * Tiqets: cities. The feed carries only Tiqets' own country id and name, no
 * ISO code, so matching is on the city name alone.
 */
interface TiqetsCity {
  id?: number | string;
  name?: string;
}

/** The documented maximum for /v2/cities; larger values are not accepted. */
const TIQETS_CITY_PAGE_SIZE = 100;

tiqets.destinations = {
  request: (_creds, _target, host) => ({
    method: "GET",
    url: `${host}/v2/cities?page_size=${TIQETS_CITY_PAGE_SIZE}&page=1`,
  }),
  map: (payload) => {
    const raw = payload as { cities?: TiqetsCity[]; data?: TiqetsCity[] };
    const list = raw?.cities ?? raw?.data ?? [];
    return list
      .filter((c) => c.id !== undefined && c.name)
      .map((c) => ({
        id: String(c.id),
        name: String(c.name),
        type: "city" as const,
      }));
  },
  nextPage: (payload, url) => {
    const p = (payload as { pagination?: { total?: number; page?: number; page_size?: number } })
      ?.pagination;
    const page = Number(p?.page);
    const size = Number(p?.page_size) || TIQETS_CITY_PAGE_SIZE;
    const total = Number(p?.total);
    if (!Number.isFinite(page) || !Number.isFinite(total) || page * size >= total) return null;
    const next = new URL(url);
    next.searchParams.set("page", String(page + 1));
    return next.toString();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hotelbeds availability — unblocked by the destination-mapping layer.
//
// This is what the mapping layer was for. The request keys off `destination.code`
// (Hotelbeds' own taxonomy), which now arrives as `providerDestinationId`
// instead of being an unusable IATA code.
// ─────────────────────────────────────────────────────────────────────────────

interface HotelbedsTax {
  included?: boolean;
  amount?: string;
  currency?: string;
  clientAmount?: string;
  clientCurrency?: string;
  type?: string;
}

interface HotelbedsRate {
  net?: string;
  sellingRate?: string;
  rateKey?: string;
  /** "NOR" (normal) or "NRF" (non-refundable) — a definitive signal. */
  rateClass?: string;
  boardCode?: string;
  boardName?: string;
  cancellationPolicies?: Array<{ amount?: string; from?: string }>;
  taxes?: { allIncluded?: boolean; taxes?: HotelbedsTax[] };
  rooms?: number;
  adults?: number;
}

interface HotelbedsRoom {
  name?: string;
  code?: string;
  rates?: HotelbedsRate[];
}

interface HotelbedsHotel {
  code?: number | string;
  name?: string;
  categoryCode?: string;
  categoryName?: string;
  destinationName?: string;
  currency?: string;
  minRate?: string;
  reviews?: Array<{ rate?: number; reviewCount?: number; type?: string }>;
  rooms?: HotelbedsRoom[];
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

/**
 * Read Hotelbeds' cancellation terms.
 *
 * `cancellationPolicies` lists PENALTIES and when each starts applying, so an
 * empty array means no penalty exists at all — fully refundable — while a
 * policy starting in the future means free cancellation until that moment.
 * Reading "no policies" as non-refundable (the obvious misreading) understates
 * every flexible rate in the catalogue and loses agencies the one thing that
 * justifies a higher price to a client.
 */
function hotelbedsCancellation(
  rate: HotelbedsRate,
  currency: string,
  now: number,
): { refundable: boolean; freeUntilISO?: string; penalty?: number; summary: string } {
  // NRF is Hotelbeds saying so outright; it outranks any policy arithmetic.
  if (String(rate.rateClass ?? "").toUpperCase() === "NRF") {
    return { refundable: false, summary: "Non-refundable rate" };
  }

  const policies = (rate.cancellationPolicies ?? []).filter((p) => p.from);
  if (policies.length === 0) {
    return { refundable: true, summary: "Free cancellation" };
  }

  // The earliest `from` is the moment flexibility ends.
  const sorted = [...policies].sort(
    (a, b) => Date.parse(a.from!) - Date.parse(b.from!),
  );
  const first = sorted[0];
  const startsAt = Date.parse(first.from!);
  const penalty = first.amount ? safeMinor(first.amount, currency) : undefined;

  if (Number.isFinite(startsAt) && startsAt > now) {
    return {
      refundable: true,
      freeUntilISO: first.from,
      penalty,
      summary: `Free cancellation until ${first.from!.slice(0, 10)}`,
    };
  }
  return { refundable: false, penalty, summary: "Cancellation charges apply" };
}

/** Amounts inside optional detail must never sink an otherwise-good offer. */
function safeMinor(value: string | number, currency: string): number | undefined {
  try {
    return decimalToMinor(value, currency);
  } catch {
    return undefined;
  }
}

/**
 * Taxes Hotelbeds flags as NOT included are collected by the hotel on arrival
 * (city tax, resort fees). They are the traveller's cost but never the agency's,
 * so they belong in `payAtProperty` — inside the supplier cost they would be
 * marked up and invoiced by an agency that never receives them.
 */
function hotelbedsPayAtProperty(
  rate: HotelbedsRate,
  fallbackCurrency: string,
): PayAtPropertyCharge[] {
  const out: PayAtPropertyCharge[] = [];
  for (const tax of rate.taxes?.taxes ?? []) {
    if (tax.included !== false || !tax.amount) continue;
    const currency = tax.currency ?? fallbackCurrency;
    const minor = safeMinor(tax.amount, currency);
    if (minor === undefined || minor <= 0) continue;
    out.push({
      label: tax.type ? `Tax: ${tax.type}` : "Payable at the property",
      amount: money(minor, currency),
      mandatory: true,
    });
  }
  return out;
}

/**
 * Hotelbeds mixes review scales: TripAdvisor scores are out of 5, its own are
 * out of 10, and the canonical model is out of 10. Keying off the declared
 * `type` beats guessing from the value, which would misread a genuine 4.6/10.
 */
function hotelbedsReviewScore(
  reviews: HotelbedsHotel["reviews"],
): number | undefined {
  const review = (reviews ?? []).find((r) => typeof r.rate === "number");
  if (!review || typeof review.rate !== "number") return undefined;
  const outOfFive = String(review.type ?? "").toUpperCase() === "TRIPADVISOR";
  return outOfFive ? Math.min(10, review.rate * 2) : review.rate;
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
        const currency = hotel.currency ?? query.sellCurrency;
        if (!hotel.code || !hotel.name) continue;

        // Hotelbeds returns every room type with every rate plan, unordered.
        // Taking the first one quotes an arbitrary room — often a suite when a
        // double was asked for. Scan them all and quote the cheapest bookable
        // rate, which is the one an agent would have picked by hand.
        let best: { room: HotelbedsRoom; rate: HotelbedsRate; minor: number } | null = null;
        for (const room of hotel.rooms ?? []) {
          for (const rate of room.rates ?? []) {
            const amount = rate.net ?? rate.sellingRate;
            if (!amount) continue;
            const minor = safeMinor(amount, currency);
            if (minor === undefined) continue;
            if (!best || minor < best.minor) best = { room, rate, minor };
          }
        }

        // `minRate` is the hotel-level fallback: a price with no rate plan
        // behind it, so it can be quoted but never re-checked or booked.
        const fallbackMinor = hotel.minRate ? safeMinor(hotel.minRate, currency) : undefined;
        if (!best && fallbackMinor === undefined) continue;

        const rate = best?.rate;
        const baseMinor = best ? best.minor : fallbackMinor!;
        const cancel = rate
          ? hotelbedsCancellation(rate, currency, now)
          : { refundable: false, summary: "Conditions confirmed on re-pricing" };
        const payAtProperty = rate ? hotelbedsPayAtProperty(rate, currency) : [];

        out.push({
          kind: "hotel",
          offerId: `hotelbeds:${hotel.code}`,
          connectorId: "hotelbeds",
          supplierOfferId: String(hotel.code),
          cost: {
            // Hotelbeds net rates are what the agency pays, taxes included in
            // the net figure — so taxes must be ZERO here, not re-added.
            rateType: "net",
            base: money(baseMinor, currency),
            taxes: money(0, currency),
            ...(payAtProperty.length ? { payAtProperty } : {}),
          },
          conditions: {
            refundable: cancel.refundable,
            // Hotelbeds has no separate change concept: a stay is altered by
            // cancelling and rebooking, so flexibility is one and the same.
            changeable: cancel.refundable,
            ...(cancel.penalty !== undefined
              ? { cancellationPenalty: money(cancel.penalty, currency) }
              : {}),
            summary: cancel.summary,
          },
          // rateKey is Hotelbeds' provider-locked handle for re-checking a rate.
          revalidationToken: rate?.rateKey,
          quotedAt: now,
          name: String(hotel.name),
          starRating: hotelbedsStars(hotel.categoryCode),
          reviewScore: hotelbedsReviewScore(hotel.reviews),
          boardType: HOTELBEDS_BOARD[String(rate?.boardCode ?? "").toUpperCase()] ?? "room_only",
          roomCategory: best?.room.name,
          freeCancellationUntilISO: cancel.freeUntilISO,
          nights,
        });
      } catch (e) {
        console.error("[agency:hotelbeds] skipped a hotel:", (e as Error).message);
      }
    }
    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Amadeus re-pricing — Flight Offers Price.
//
// A search price is an estimate; this is the only call that turns it into a
// figure Amadeus stands behind. It takes the entire offer object back rather
// than an id, which is why `mapAmadeusOffer` stores the offer as the token.
// ─────────────────────────────────────────────────────────────────────────────

/** Human-readable money for a re-pricing message. Respects zero/three-decimal currencies. */
function formatAmount(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return `${(minor / 10 ** exp).toFixed(exp)} ${currency}`;
}

/** What the offer cost when we quoted it, read back out of its own token. */
function quotedTotalMinor(token: string): { minor: number; currency: string } | null {
  try {
    const offer = JSON.parse(token) as AmadeusOffer;
    const currency = offer.price?.currency;
    const total = offer.price?.grandTotal ?? offer.price?.total;
    if (!currency || !total) return null;
    return { minor: decimalToMinor(total, currency), currency };
  } catch {
    return null;
  }
}

amadeus.revalidate = {
  request: (_creds, token, host) => ({
    method: "POST",
    url: `${host}/v1/shopping/flight-offers/pricing`,
    body: {
      data: {
        type: "flight-offers-pricing",
        // Amadeus requires the offer verbatim, including fields we never read.
        // Reconstructing it from our normalised model would drop them.
        flightOffers: [JSON.parse(token)],
      },
    },
  }),
  map: (payload, token) => {
    const priced = (payload as { data?: { flightOffers?: AmadeusOffer[] } })?.data
      ?.flightOffers?.[0];
    if (!priced) {
      // Amadeus answers 200 with no offer when the fare has gone.
      return {
        stillAvailable: false,
        message: "Amadeus no longer sells this itinerary at any price",
      };
    }

    const offer = mapAmadeusOffer(priced, Date.now());
    if (!offer) {
      return { stillAvailable: false, message: "Amadeus returned a price we could not read" };
    }

    const before = quotedTotalMinor(token);
    const after = offer.cost.base.amountMinor + offer.cost.taxes.amountMinor;
    // Only a price we can actually compare counts as "changed"; an unreadable
    // original must not be reported as a move in either direction.
    const priceChanged = before !== null && before.minor !== after;

    return {
      stillAvailable: true,
      offer,
      priceChanged,
      message: priceChanged
        ? `price moved from ${formatAmount(before!.minor, before!.currency)} to ${formatAmount(
            after,
            offer.cost.base.currency,
          )}`
        : "price confirmed by Amadeus",
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hotelbeds re-pricing — checkrates.
//
// This matters more than it looks. `quoteStillValid` requires EVERY selected
// line to re-price, and a connector that cannot re-price marks its line
// unverifiable — so before this existed, any quote containing a hotel could
// never be revalidated back into a sendable state. A three-line package was
// permanently stuck the moment it expired.
// ─────────────────────────────────────────────────────────────────────────────

hotelbeds.revalidate = {
  request: (_creds, rateKey, host) => ({
    method: "POST",
    url: `${host}/hotel-api/1.0/checkrates`,
    // `rateKey` is Hotelbeds' own handle for one rate of one room of one hotel.
    body: { rooms: [{ rateKey }] },
  }),
  map: (payload) => {
    const hotel = (payload as { hotel?: HotelbedsHotel })?.hotel;
    const rate = hotel?.rooms?.[0]?.rates?.[0];
    const amount = rate?.net ?? rate?.sellingRate;
    if (!hotel || !rate || !amount) {
      // Hotelbeds answers 200 with no rate when the room has gone.
      return { stillAvailable: false, message: "this rate is no longer available" };
    }

    const currency = hotel.currency ?? "EUR";
    const minor = safeMinor(amount, currency);
    if (minor === undefined) {
      return { stillAvailable: false, message: "Hotelbeds returned a price we could not read" };
    }

    const now = Date.now();
    const cancel = hotelbedsCancellation(rate, currency, now);
    const payAtProperty = hotelbedsPayAtProperty(rate, currency);

    return {
      stillAvailable: true,
      // checkrates is authoritative, so whatever it says IS the price now. We
      // cannot tell whether it moved without the original, which the caller
      // holds — so this never claims a change it has not verified.
      priceChanged: false,
      message: `confirmed at ${formatAmount(minor, currency)}`,
      offer: {
        kind: "hotel",
        offerId: `hotelbeds:${hotel.code ?? "checked"}`,
        connectorId: "hotelbeds",
        supplierOfferId: String(hotel.code ?? ""),
        cost: {
          rateType: "net",
          base: money(minor, currency),
          taxes: money(0, currency),
          ...(payAtProperty.length ? { payAtProperty } : {}),
        },
        conditions: {
          refundable: cancel.refundable,
          changeable: cancel.refundable,
          ...(cancel.penalty !== undefined
            ? { cancellationPenalty: money(cancel.penalty, currency) }
            : {}),
          summary: cancel.summary,
        },
        // checkrates MINTS A NEW rateKey; the old one is spent. Booking with a
        // stale key fails, so the fresh one has to replace it.
        revalidationToken: rate.rateKey,
        quotedAt: now,
        name: String(hotel.name ?? ""),
        starRating: hotelbedsStars(hotel.categoryCode),
        reviewScore: hotelbedsReviewScore(hotel.reviews),
        boardType: HOTELBEDS_BOARD[String(rate.boardCode ?? "").toUpperCase()] ?? "room_only",
        freeCancellationUntilISO: cancel.freeUntilISO,
        nights: 1,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hotelbeds booking — POST /bookings.
//
// Books the rateKey the quote holds. That key must be the FRESHEST one: a
// checkrates call spends the old key and mints a new one, which is why the
// revalidation pass writes the new token back onto the quote.
// ─────────────────────────────────────────────────────────────────────────────

/** Age in whole years on a given date. */
function ageOnDate(bornOn: string, onDate: string): number {
  const [by, bm, bd] = bornOn.split("-").map(Number);
  const [ty, tm, td] = onDate.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

hotelbeds.book = {
  request: (_creds, req, host) => {
    const rooms = Math.max(1, Math.min(9, req.rooms ?? 1));
    const onDate = req.travelDate ?? new Date().toISOString().slice(0, 10);
    const adults = req.passengers.filter((p) => p.type === "adult");
    const others = req.passengers.filter((p) => p.type !== "adult");
    // Spread adults across rooms first so no room is booked with only
    // children in it, then the children round-robin.
    const paxes = [
      ...adults.map((p, i) => ({
        roomId: (i % rooms) + 1,
        type: "AD",
        name: p.givenName,
        surname: p.familyName,
      })),
      ...others.map((p, i) => ({
        roomId: (i % rooms) + 1,
        type: "CH",
        age: Math.max(0, ageOnDate(p.bornOn, onDate)),
        name: p.givenName,
        surname: p.familyName,
      })),
    ];
    const lead = adults[0] ?? req.passengers[0];
    return {
      method: "POST",
      url: `${host}/hotel-api/1.0/bookings`,
      body: {
        holder: { name: lead.givenName, surname: lead.familyName },
        rooms: [{ rateKey: req.revalidationToken, paxes }],
        // Hotelbeds caps this at 20 characters.
        clientReference: req.clientReference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20) || "PLANERA",
        remark: `Contact ${req.contact.phone}`,
      },
    };
  },
  map: (payload) => {
    const booking = (payload as {
      booking?: {
        reference?: string;
        status?: string;
        totalNet?: number | string;
        currency?: string;
      };
    })?.booking;
    if (!booking?.reference) {
      return { status: "failed", message: "Hotelbeds did not return a booking reference" };
    }
    const status = String(booking.status ?? "").toUpperCase();
    const currency = booking.currency ?? "EUR";
    const minor = booking.totalNet !== undefined ? safeMinor(booking.totalNet, currency) : undefined;
    return {
      status: status === "CONFIRMED" ? "confirmed" : status === "CANCELLED" ? "failed" : "requested",
      supplierReference: booking.reference,
      supplierBookingId: booking.reference,
      amountCharged: minor !== undefined ? money(minor, currency) : undefined,
      message: `Hotelbeds ${status || "booking"} ${booking.reference}`,
    };
  },
  timeoutMs: 45_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Activities — Viator and Tiqets
//
// Both sell PER TICKET, while the canonical model costs a whole package, so
// each offer is multiplied by the traveller count. Both also pay their partners
// a COMMISSION on a retail price rather than selling net, which is why they set
// `markupForbidden`: adding a markup on top of a price the traveller can look
// up on the provider's own site is both visible and, under these partner
// agreements, not allowed. The agency's margin on these lines is the commission.
// ─────────────────────────────────────────────────────────────────────────────

/** Everyone the activity has to be bought for. */
const travellerCount = (query: { adults: number; childrenAges: number[] }): number =>
  Math.max(1, query.adults + query.childrenAges.length);

interface ViatorProduct {
  productCode?: string;
  title?: string;
  description?: string;
  pricing?: {
    summary?: { fromPrice?: number; fromPriceBeforeDiscount?: number };
    currency?: string;
    /**
     * Merchant partners on the markup/booking-fee model only: the lowest
     * per-person amount Viator would INVOICE the agency (booking fee
     * excluded). When present, the agency is buying net and may mark up.
     */
    partnerNetFromPrice?: number;
  };
  reviews?: { combinedAverageRating?: number; totalReviews?: number };
  duration?: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
  /** e.g. "FREE_CANCELLATION", "LIKELY_TO_SELL_OUT". */
  flags?: string[];
}

/** How many products to ask for. Enough to score against, small enough to be fast. */
const ACTIVITY_PAGE_SIZE = 20;

viator.search = {
  kinds: ["activity"],
  requiresDestinationId: true,
  request: (_creds, query, host) => {
    // Viator searches a destination id and a date window, both required.
    if (!query.providerDestinationId || !query.departDate) return null;
    return {
      method: "POST",
      url: `${host}/partner/products/search`,
      body: {
        filtering: {
          destination: query.providerDestinationId,
          startDate: query.departDate,
          ...(query.returnDate ? { endDate: query.returnDate } : {}),
        },
        // Rating-first: the scoring engine re-ranks on price, so bringing back
        // the best-reviewed products gives it something worth ranking.
        sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
        pagination: { start: 1, count: ACTIVITY_PAGE_SIZE },
        currency: query.sellCurrency,
      },
    };
  },
  map: (payload, query) => {
    const products = (payload as { products?: ViatorProduct[] })?.products ?? [];
    const travellers = travellerCount(query);
    const now = Date.now();
    const out: NormalizedOffer[] = [];

    for (const product of products) {
      try {
        const net = product.pricing?.partnerNetFromPrice;
        const perPerson = net ?? product.pricing?.summary?.fromPrice;
        const currency = product.pricing?.currency ?? query.sellCurrency;
        if (!product.productCode || !product.title || perPerson === undefined) continue;

        const perPersonMinor = safeMinor(perPerson, currency);
        if (perPersonMinor === undefined || perPersonMinor <= 0) continue;
        const isNet = net !== undefined;

        const freeCancellation = (product.flags ?? []).includes("FREE_CANCELLATION");
        const rating = product.reviews?.combinedAverageRating;

        const offer: NormalizedActivityOffer = {
          kind: "activity",
          offerId: `viator:${product.productCode}`,
          connectorId: "viator",
          supplierOfferId: product.productCode,
          // Two Viator pricing models, and the response says which one this
          // account is on: a NET price (merchant, markup/booking-fee model —
          // the agency sets its own price) or only the RETAIL "from" price
          // (commission model / affiliate — no markup on a price the client
          // can look up on viator.com).
          cost: isNet
            ? {
                rateType: "net",
                base: money(perPersonMinor * travellers, currency),
                taxes: money(0, currency),
              }
            : {
                rateType: "commissionable",
                base: money(perPersonMinor * travellers, currency),
                taxes: money(0, currency),
                markupForbidden: true,
              },
          conditions: {
            refundable: freeCancellation,
            changeable: freeCancellation,
            summary: freeCancellation
              ? "Free cancellation up to 24 hours before"
              : "Cancellation terms set by the operator",
          },
          // What /availability/check needs to price this for real: the
          // product, one travel date inside the trip, and the party by age band.
          revalidationToken: viatorToken({
            productCode: product.productCode,
            travelDate: activityDate(query),
            paxMix: viatorPaxMix(query),
            net: isNet,
            currency,
            refundable: freeCancellation,
          }),
          quotedAt: now,
          title: product.title,
          durationMinutes:
            product.duration?.fixedDurationInMinutes ??
            product.duration?.variableDurationFromMinutes,
          // Viator rates out of 5; the model wants 0..1.
          qualityScore: typeof rating === "number" ? Math.min(1, rating / 5) : undefined,
        };
        out.push(offer);
      } catch (e) {
        console.error("[agency:viator] skipped a product:", (e as Error).message);
      }
    }
    return out;
  },
};

/** What a Viator re-pricing call needs, carried in the offer's token. */
export interface ViatorToken {
  productCode: string;
  travelDate: string;
  paxMix: Array<{ ageBand: string; numberOfTravelers: number }>;
  net: boolean;
  currency: string;
  /** From the search's FREE_CANCELLATION flag — availability/check does not restate it. */
  refundable: boolean;
  productOptionCode?: string;
  startTime?: string;
}

const VIATOR_TOKEN_PREFIX = "viator:";
const viatorToken = (t: ViatorToken) => `${VIATOR_TOKEN_PREFIX}${JSON.stringify(t)}`;
export function readViatorToken(token: string): ViatorToken {
  if (!token.startsWith(VIATOR_TOKEN_PREFIX)) throw new Error("not a Viator offer token");
  return JSON.parse(token.slice(VIATOR_TOKEN_PREFIX.length)) as ViatorToken;
}

/**
 * The day an activity is priced for. A search spans the whole stay but a
 * price check needs one date: the first FULL day (the day after arrival) when
 * the trip has one, otherwise the arrival day itself.
 */
export function activityDate(query: { departDate?: string; returnDate?: string }): string {
  const start = query.departDate ?? new Date().toISOString().slice(0, 10);
  if (!query.returnDate) return start;
  const next = new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return next < query.returnDate ? next : start;
}

/**
 * The party in Viator's age bands. Bands are product-specific (a product may
 * price only TRAVELER, or ADULT+CHILD); ADULT/CHILD/INFANT is the common case,
 * and a product that rejects it answers with an error the agent sees as
 * "could not verify", never as a wrong price.
 */
export function viatorPaxMix(query: { adults: number; childrenAges: number[] }) {
  const infants = query.childrenAges.filter((a) => a < 3).length;
  const children = query.childrenAges.length - infants;
  return [
    { ageBand: "ADULT", numberOfTravelers: Math.max(1, query.adults) },
    ...(children ? [{ ageBand: "CHILD", numberOfTravelers: children }] : []),
    ...(infants ? [{ ageBand: "INFANT", numberOfTravelers: infants }] : []),
  ];
}

interface ViatorPrice {
  recommendedRetailPrice?: number;
  partnerNetPrice?: number;
  bookingFee?: number;
  commission?: number;
  partnerTotalPrice?: number;
}

interface ViatorBookableItem {
  productOptionCode?: string;
  startTime?: string;
  available?: boolean;
  unavailableReason?: string;
  totalPrice?: { price?: ViatorPrice };
}

/**
 * Viator re-pricing — POST /availability/check, the live price and
 * availability for one date and party. Checked against Viator's OpenAPI spec.
 * The cheapest AVAILABLE option/start time wins, and its option code and time
 * go back into the token so a later check (or booking in Viator) prices the
 * exact same thing.
 */
viator.revalidate = {
  request: (_creds, token, host) => {
    const t = readViatorToken(token);
    return {
      method: "POST",
      url: `${host}/partner/availability/check`,
      body: {
        productCode: t.productCode,
        ...(t.productOptionCode ? { productOptionCode: t.productOptionCode } : {}),
        ...(t.startTime ? { startTime: t.startTime } : {}),
        travelDate: t.travelDate,
        currency: t.currency,
        paxMix: t.paxMix,
      },
    };
  },
  map: (payload, token) => {
    const t = readViatorToken(token);
    const body = payload as { currency?: string; bookableItems?: ViatorBookableItem[] };
    const currency = body.currency ?? t.currency;
    const options = (body.bookableItems ?? [])
      .filter((b) => b.available && b.totalPrice?.price)
      .map((b) => {
        const p = b.totalPrice!.price!;
        // What the agency pays on the net model; the retail price otherwise.
        const amount = t.net ? (p.partnerTotalPrice ?? p.partnerNetPrice) : p.recommendedRetailPrice;
        return { b, p, amount };
      })
      .filter((o): o is { b: ViatorBookableItem; p: ViatorPrice; amount: number } => typeof o.amount === "number")
      .sort((a, b) => a.amount - b.amount);

    const best = options[0];
    if (!best) {
      const reason = body.bookableItems?.find((b) => !b.available)?.unavailableReason;
      return {
        stillAvailable: false,
        message: `not available on ${t.travelDate}${reason ? ` (${reason})` : ""}`,
      };
    }

    const minor = safeMinor(best.amount, currency);
    if (minor === undefined) {
      return { stillAvailable: false, message: "Viator returned a price we could not read" };
    }
    const rrp = best.p.recommendedRetailPrice;
    const commissionRate =
      !t.net && typeof best.p.commission === "number" && rrp ? best.p.commission / rrp : undefined;

    return {
      stillAvailable: true,
      message: `available on ${t.travelDate}${best.b.startTime ? ` at ${best.b.startTime}` : ""}`,
      offer: {
        kind: "activity",
        offerId: `viator:${t.productCode}`,
        connectorId: "viator",
        supplierOfferId: t.productCode,
        cost: t.net
          ? { rateType: "net", base: money(minor, currency), taxes: money(0, currency) }
          : {
              rateType: "commissionable",
              base: money(minor, currency),
              taxes: money(0, currency),
              markupForbidden: true,
              ...(commissionRate ? { commissionRate } : {}),
            },
        conditions: {
          refundable: t.refundable,
          changeable: t.refundable,
          summary: t.refundable
            ? "Free cancellation up to 24 hours before"
            : "Cancellation terms set by the operator",
        },
        revalidationToken: viatorToken({
          ...t,
          productOptionCode: best.b.productOptionCode,
          startTime: best.b.startTime,
        }),
        quotedAt: Date.now(),
        title: "",
      },
    };
  },
};

interface TiqetsProduct {
  id?: number | string;
  title?: string;
  /** Tiqets has moved this between shapes; all three are handled. */
  price?: number | string | { amount?: number | string; currency?: string };
  min_price?: number | string;
  currency?: string;
  sale_status?: string;
  ratings?: { average?: number; count?: number };
  venue?: { name?: string };
  tagline?: string;
}

/**
 * Read a Tiqets price whatever shape it arrives in.
 *
 * Deliberately tolerant: Tiqets has expressed product prices as a bare number,
 * a decimal string and a nested object across versions of its distributor API,
 * and an agency's search should not fail because their account is pinned to a
 * different one than ours.
 */
function tiqetsPrice(
  product: TiqetsProduct,
  fallbackCurrency: string,
): { minor: number; currency: string } | null {
  const nested = typeof product.price === "object" && product.price !== null ? product.price : null;
  const raw = nested ? nested.amount : (product.price ?? product.min_price);
  if (raw === undefined || raw === null) return null;

  const currency = nested?.currency ?? product.currency ?? fallbackCurrency;
  const minor = safeMinor(raw as string | number, currency);
  if (minor === undefined || minor <= 0) return null;
  return { minor, currency };
}

tiqets.search = {
  kinds: ["activity"],
  requiresDestinationId: true,
  request: (_creds, query, host) => {
    if (!query.providerDestinationId) return null;
    const params = new URLSearchParams({
      city_id: query.providerDestinationId,
      page_size: String(ACTIVITY_PAGE_SIZE),
      lang: "en",
      currency: query.sellCurrency,
    });
    return { method: "GET", url: `${host}/v2/products?${params.toString()}` };
  },
  map: (payload, query) => {
    const raw = payload as { products?: TiqetsProduct[]; data?: TiqetsProduct[] };
    const products = raw?.products ?? raw?.data ?? [];
    const travellers = travellerCount(query);
    const now = Date.now();
    const out: NormalizedOffer[] = [];

    for (const product of products) {
      try {
        if (product.id === undefined || !product.title) continue;
        // Tiqets keeps unsellable products in the catalogue (sale_status is
        // "available" | "unavailable"); quoting one would send an agent to a
        // checkout that cannot complete.
        if (product.sale_status && product.sale_status.toLowerCase() !== "available") continue;

        const price = tiqetsPrice(product, query.sellCurrency);
        if (!price) continue;

        const rating = product.ratings?.average;
        const offer: NormalizedActivityOffer = {
          kind: "activity",
          offerId: `tiqets:${product.id}`,
          connectorId: "tiqets",
          supplierOfferId: String(product.id),
          cost: {
            rateType: "commissionable",
            base: money(price.minor * travellers, price.currency),
            taxes: money(0, price.currency),
            markupForbidden: true,
          },
          conditions: {
            // Tiqets tickets are overwhelmingly dated and non-refundable, and
            // the product list does not say otherwise per product.
            refundable: false,
            changeable: false,
            summary: "Dated ticket — cancellation terms set by the venue",
          },
          quotedAt: now,
          title: product.title,
          category: product.venue?.name,
          // Tiqets rates out of 10; the model wants 0..1.
          qualityScore: typeof rating === "number" ? Math.min(1, rating / 10) : undefined,
        };
        out.push(offer);
      } catch (e) {
        console.error("[agency:tiqets] skipped a product:", (e as Error).message);
      }
    }
    return out;
  },
};

/**
 * Viator serves a DIFFERENT response schema per Accept version, so pinning it
 * is not politeness — it is what makes the mapper above correct.
 */
viator.headers = () => ({
  Accept: "application/json;version=2.0",
  "Accept-Language": "en-US",
});

// ─────────────────────────────────────────────────────────────────────────────
// Expedia Rapid — hotels, in three round trips.
//
// Rapid has no "what is available in this city" call at all: availability takes
// a LIST OF PROPERTY IDS. So a region is expanded into properties first, priced
// second, and named third — the availability response carries no hotel names,
// only ids. That is why this connector uses `prepare` and `enrich`.
// ─────────────────────────────────────────────────────────────────────────────

/** Rapid accepts up to 250 property ids; 100 keeps the URL and the latency sane. */
const EAN_MAX_PROPERTIES = 100;

interface EanAmount {
  value?: string | number;
  currency?: string;
}

interface EanTotals {
  /** Price INCLUDING taxes — what the agency is billed. */
  inclusive?: { billable_currency?: EanAmount };
  /** Price EXCLUDING taxes. */
  exclusive?: { billable_currency?: EanAmount };
  /** Mandatory fees the property collects on arrival. */
  property_fees?: { billable_currency?: EanAmount };
}

interface EanRate {
  id?: string;
  status?: string;
  available_rooms?: number;
  refundable?: boolean;
  cancel_penalties?: Array<{ start?: string; end?: string; amount?: string; currency?: string }>;
  /** Keyed by the occupancy string we sent, so read the value, not the key. */
  occupancy_pricing?: Record<string, { totals?: EanTotals }>;
  links?: { price_check?: { href?: string; method?: string } };
}

interface EanProperty {
  property_id?: string;
  status?: string;
  rooms?: Array<{ id?: string; room_name?: string; rates?: EanRate[] }>;
}

interface EanContent {
  property_id?: string;
  name?: string;
  ratings?: {
    property?: { rating?: string; type?: string };
    guest?: { overall?: string; count?: string };
  };
}

/** `2` for two adults; `2-9,4` for two adults with children aged 9 and 4. */
function eanOccupancy(query: { adults: number; childrenAges: number[] }): string {
  return query.childrenAges.length
    ? `${query.adults}-${query.childrenAges.join(",")}`
    : String(query.adults);
}

function eanAmount(amount: EanAmount | undefined, fallbackCurrency: string) {
  if (amount?.value === undefined) return null;
  const currency = amount.currency ?? fallbackCurrency;
  const minor = safeMinor(amount.value, currency);
  return minor === undefined ? null : { minor, currency };
}

expediaRapid.search = {
  kinds: ["hotel"],
  requiresDestinationId: true,

  // ── 1. Region → property ids ──
  prepare: {
    request: (_creds, query, host) => {
      if (!query.providerDestinationId) return null;
      return {
        method: "GET",
        url: `${host}/v3/regions/${encodeURIComponent(
          query.providerDestinationId,
        )}?language=en-US&include=property_ids&supply_source=expedia`,
      };
    },
    map: (payload) => {
      const ids = (payload as { property_ids?: string[] })?.property_ids ?? [];
      // A region Rapid has no properties for is not an error — it is an empty
      // result, and returning null says exactly that.
      return ids.length ? ids.slice(0, EAN_MAX_PROPERTIES) : null;
    },
  },

  // ── 2. Availability for those properties ──
  request: (creds, query, host, prepared) => {
    const propertyIds = prepared as string[] | null;
    if (!propertyIds?.length || !query.departDate || !query.returnDate) return null;

    const params = new URLSearchParams({
      checkin: query.departDate,
      checkout: query.returnDate,
      currency: query.sellCurrency,
      language: "en-US",
      // The point of sale, which Rapid prices and taxes against.
      country_code: (creds.fields.pointOfSaleCountry ?? "GR").toUpperCase(),
      sales_channel: "website",
      sales_environment: "hotel_only",
      rate_plan_count: "1",
    });

    const occupancy = eanOccupancy(query);
    for (let room = 0; room < (query.rooms ?? 1); room++) params.append("occupancy", occupancy);
    for (const id of propertyIds) params.append("property_id", id);

    return { method: "GET", url: `${host}/v3/properties/availability?${params.toString()}` };
  },

  map: (payload, query) => {
    // Rapid answers with a bare array, not an envelope.
    const properties = Array.isArray(payload) ? (payload as EanProperty[]) : [];
    const nights = nightsBetween(query.departDate, query.returnDate);
    const now = Date.now();
    const out: NormalizedOffer[] = [];

    for (const property of properties) {
      try {
        if (!property.property_id) continue;
        if (property.status && property.status !== "available") continue;

        let best: { roomName?: string; rate: EanRate; totals: EanTotals; minor: number } | null =
          null;

        for (const room of property.rooms ?? []) {
          for (const rate of room.rates ?? []) {
            if (rate.status && rate.status !== "available") continue;
            const totals = Object.values(rate.occupancy_pricing ?? {})[0]?.totals;
            const inclusive = eanAmount(totals?.inclusive?.billable_currency, query.sellCurrency);
            if (!totals || !inclusive) continue;
            if (!best || inclusive.minor < best.minor) {
              best = { roomName: room.room_name, rate, totals, minor: inclusive.minor };
            }
          }
        }
        if (!best) continue;

        const inclusive = eanAmount(
          best.totals.inclusive?.billable_currency,
          query.sellCurrency,
        )!;
        const exclusive = eanAmount(best.totals.exclusive?.billable_currency, inclusive.currency);
        // Base must exclude the taxes carried in `taxes`, or the pricing engine
        // would add them a second time.
        const baseMinor = exclusive?.minor ?? inclusive.minor;
        const taxesMinor = Math.max(0, inclusive.minor - baseMinor);

        const fees = eanAmount(best.totals.property_fees?.billable_currency, inclusive.currency);
        const firstPenalty = best.rate.cancel_penalties?.[0];

        out.push({
          kind: "hotel",
          offerId: `expedia_rapid:${property.property_id}`,
          connectorId: "expedia_rapid",
          supplierOfferId: property.property_id,
          cost: {
            // Rapid is a wholesale net contract: this is what the agency pays.
            rateType: "net",
            base: money(baseMinor, inclusive.currency),
            taxes: money(taxesMinor, inclusive.currency),
            ...(fees && fees.minor > 0
              ? {
                  payAtProperty: [
                    {
                      label: "Property fees",
                      amount: money(fees.minor, fees.currency),
                      mandatory: true,
                    },
                  ],
                }
              : {}),
          },
          conditions: {
            refundable: best.rate.refundable === true,
            changeable: best.rate.refundable === true,
            summary:
              best.rate.refundable === true
                ? firstPenalty?.start
                  ? `Free cancellation until ${firstPenalty.start.slice(0, 10)}`
                  : "Refundable rate"
                : "Non-refundable rate",
          },
          // Rapid's price_check link is the handle for confirming this exact
          // rate. Stored for the booking phase; re-pricing needs the shopping
          // context this connector no longer holds, so it is not declared.
          revalidationToken: best.rate.links?.price_check?.href,
          quotedAt: now,
          // Availability carries no name at all — `enrich` fills this in, and
          // the id stands in if that lookup fails.
          name: `Property ${property.property_id}`,
          boardType: "room_only",
          roomCategory: best.roomName,
          freeCancellationUntilISO:
            best.rate.refundable === true ? firstPenalty?.start : undefined,
          nights,
        });
      } catch (e) {
        console.error("[agency:expedia_rapid] skipped a property:", (e as Error).message);
      }
    }
    return out;
  },

  // ── 3. Names and ratings for whatever came back priced ──
  enrich: {
    request: (_creds, _query, host, offers) => {
      const ids = offers.map((o) => o.supplierOfferId).slice(0, EAN_MAX_PROPERTIES);
      if (!ids.length) return null;
      const params = new URLSearchParams({ language: "en-US", supply_source: "expedia" });
      for (const id of ids) params.append("property_id", id);
      return { method: "GET", url: `${host}/v3/properties/content?${params.toString()}` };
    },
    apply: (payload, offers) => {
      const content = (payload ?? {}) as Record<string, EanContent>;
      return offers.map((offer) => {
        if (offer.kind !== "hotel") return offer;
        const entry = content[offer.supplierOfferId];
        if (!entry?.name) return offer;

        const star = Number(entry.ratings?.property?.rating);
        const guest = Number(entry.ratings?.guest?.overall);
        return {
          ...offer,
          name: entry.name,
          starRating: Number.isFinite(star) ? star : offer.starRating,
          // Rapid's guest score is out of 5; the model is out of 10.
          reviewScore: Number.isFinite(guest) ? Math.min(10, guest * 2) : offer.reviewScore,
        };
      });
    },
  },
};

/**
 * Rapid requires the IP its shopping requests originate from, for the fraud and
 * geolocation signals it prices against. Our searches run on Convex, not on the
 * agency's network, so there is no IP we can honestly discover at runtime — the
 * agency supplies one it actually owns, and that value is used verbatim. A
 * fabricated address would be both a lie to Expedia and a silent mispricing.
 */
expediaRapid.headers = (creds) => ({
  "Customer-Ip": creds.fields.customerIp ?? "",
  "User-Agent": "PlaneraAgencies/1.0",
});

// ─────────────────────────────────────────────────────────────────────────────
// Booking.com Demand API — hotels, in two round trips.
//
// The search answers with accommodation ids and prices but no names; those come
// from the details endpoint, so this connector enriches the same way Rapid does.
// ─────────────────────────────────────────────────────────────────────────────

interface BookingAmount {
  value?: number | string;
  currency?: string;
}

interface BookingProduct {
  id?: string;
  name?: string;
  price?: BookingAmount | number | string;
  price_breakdown?: { gross_amount?: BookingAmount; all_inclusive_amount?: BookingAmount };
  /** Booking marks a product refundable via its policies block. */
  policies?: { cancellation?: { type?: string; free_cancellation_until?: string } };
}

interface BookingAccommodation {
  id?: number | string;
  name?: string;
  available?: boolean;
  products?: BookingProduct[];
  cheapest_product?: BookingProduct;
}

/**
 * Booking has expressed product prices as a bare number, a `{value, currency}`
 * object and a `price_breakdown` block depending on the endpoint and account.
 * All three are read here rather than assuming one, for the same reason as
 * Tiqets: an agency's search should not fail on a shape difference.
 */
function bookingPrice(
  product: BookingProduct | undefined,
  fallbackCurrency: string,
): { minor: number; currency: string } | null {
  if (!product) return null;
  const candidates: Array<BookingAmount | number | string | undefined> = [
    product.price_breakdown?.all_inclusive_amount,
    product.price_breakdown?.gross_amount,
    product.price,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const isObject = typeof candidate === "object";
    const raw = isObject ? (candidate as BookingAmount).value : candidate;
    if (raw === undefined || raw === null) continue;
    const currency = (isObject ? (candidate as BookingAmount).currency : undefined) ?? fallbackCurrency;
    const minor = safeMinor(raw as string | number, currency);
    if (minor !== undefined && minor > 0) return { minor, currency };
  }
  return null;
}

bookingDemand.search = {
  kinds: ["hotel"],
  requiresDestinationId: true,

  request: (creds, query, host) => {
    const cityId = Number(query.providerDestinationId);
    // Booking city ids are integers; a non-numeric mapping is not one.
    if (!Number.isFinite(cityId) || !query.departDate || !query.returnDate) return null;

    return {
      method: "POST",
      url: `${host}/3.1/accommodations/search`,
      body: {
        booker: {
          country: (creds.fields.pointOfSaleCountry ?? "gr").toLowerCase(),
          platform: "desktop",
        },
        checkin: query.departDate,
        checkout: query.returnDate,
        city: cityId,
        guests: {
          number_of_adults: query.adults,
          ...(query.childrenAges.length ? { children: query.childrenAges } : {}),
        },
        currency: query.sellCurrency,
        rows: 25,
      },
    };
  },

  map: (payload, query) => {
    const list = (payload as { data?: BookingAccommodation[] })?.data ?? [];
    const nights = nightsBetween(query.departDate, query.returnDate);
    const now = Date.now();
    const out: NormalizedOffer[] = [];

    for (const accommodation of list) {
      try {
        if (accommodation.id === undefined) continue;
        if (accommodation.available === false) continue;

        // Prefer whatever Booking itself calls cheapest, then scan the rest.
        let best = bookingPrice(accommodation.cheapest_product, query.sellCurrency);
        let bestProduct = accommodation.cheapest_product;
        for (const product of accommodation.products ?? []) {
          const price = bookingPrice(product, query.sellCurrency);
          if (price && (!best || price.minor < best.minor)) {
            best = price;
            bestProduct = product;
          }
        }
        if (!best) continue;

        const freeUntil = bestProduct?.policies?.cancellation?.free_cancellation_until;
        const refundable =
          !!freeUntil ||
          String(bestProduct?.policies?.cancellation?.type ?? "").toLowerCase() ===
            "free_cancellation";

        out.push({
          kind: "hotel",
          offerId: `booking_demand:${accommodation.id}`,
          connectorId: "booking_demand",
          supplierOfferId: String(accommodation.id),
          cost: {
            // Demand API returns a gross, traveller-facing price on which the
            // affiliate earns commission — it is not a net rate to mark up.
            rateType: "commissionable",
            base: money(best.minor, best.currency),
            taxes: money(0, best.currency),
            markupForbidden: true,
          },
          conditions: {
            refundable,
            changeable: refundable,
            summary: freeUntil
              ? `Free cancellation until ${freeUntil.slice(0, 10)}`
              : refundable
                ? "Free cancellation"
                : "Cancellation charges apply",
          },
          quotedAt: now,
          name: accommodation.name ?? `Accommodation ${accommodation.id}`,
          boardType: "room_only",
          roomCategory: bestProduct?.name,
          freeCancellationUntilISO: freeUntil,
          nights,
        });
      } catch (e) {
        console.error("[agency:booking_demand] skipped an accommodation:", (e as Error).message);
      }
    }
    return out;
  },

  enrich: {
    request: (_creds, _query, host, offers) => {
      // Only ask for the ones the search could not name itself.
      const ids = offers
        .filter((o) => o.kind === "hotel" && o.name.startsWith("Accommodation "))
        .map((o) => Number(o.supplierOfferId))
        .filter((id) => Number.isFinite(id));
      if (!ids.length) return null;
      return {
        method: "POST",
        url: `${host}/3.1/accommodations/details`,
        body: { accommodations: ids, languages: ["en-gb"] },
      };
    },
    apply: (payload, offers) => {
      const list = (payload as { data?: BookingAccommodation[] })?.data ?? [];
      const names = new Map<string, string>();
      for (const entry of list) {
        if (entry.id !== undefined && entry.name) names.set(String(entry.id), entry.name);
      }
      return offers.map((offer) => {
        if (offer.kind !== "hotel") return offer;
        const name = names.get(offer.supplierOfferId);
        return name ? { ...offer, name } : offer;
      });
    },
  },
};

