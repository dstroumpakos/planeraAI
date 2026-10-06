/**
 * Supplier connector registry — the single source of truth for which providers
 * exist, whether they are enabled, and exactly which credential fields each one
 * needs. Removing a provider that declines multi-tenant third-party status is a
 * DATA change (`enabled: false`), never a code change.
 *
 * `credentialFields` matters more than it looks. The credential SCHEME alone is
 * not enough to know what to ask for: Hotelbeds and Expedia are both "api_key"
 * providers, but each needs a key AND a secret to sign a request, and Sabre
 * needs a client pair plus a PCC. Driving the form and the validator from this
 * list is what stops an agency saving a half-credential that only fails later,
 * at search time, with a confusing error.
 */

import type { NormalizedOffer } from "../model/types";
import type { Capability, CredentialScheme } from "./types";

export interface CredentialField {
  /** Key inside `SupplierCredentials.fields`. */
  key: string;
  /** English label; the UI shows this verbatim (provider terminology). */
  label: string;
  /** Masked in the form and never echoed back. */
  secret: boolean;
  /** Where the agency finds this value. */
  hint?: string;
}

export interface RegistryEntry {
  id: string;
  displayName: string;
  category: "air" | "hotel" | "ground" | "ferry" | "activity" | "aggregator";
  kinds: Array<NormalizedOffer["kind"]>;
  credentialScheme: CredentialScheme;
  /** Exactly what this provider needs. Drives both the form and validation. */
  credentialFields: CredentialField[];
  /** Master switch. Providers that decline are flipped to false. */
  enabled: boolean;
  /** Integration maturity — drives the onboarding matrix, not runtime behaviour. */
  status: "planned" | "sandbox" | "certifying" | "live";
  /** Capabilities we intend to expose once live. */
  capabilities: Partial<Record<Capability, boolean>>;
  /** Whether a provider certification step is known to be required. */
  requiresCertification: boolean;
  /**
   * Test doubles. Real, `enabled` providers in every other sense, but never
   * offered to a tenant unless the deployment explicitly asks for them — an
   * agency seeing "Mock Air (sandbox)" in its supplier catalogue reads as an
   * unfinished product. Kept as DATA rather than deleted so the demo workspace
   * and the test suite still have something deterministic to run against.
   */
  internalOnly?: boolean;
  /**
   * Whether this provider's SEARCH has been run against a live account.
   *
   * Only meaningful where the connector can search at all. False means the
   * request was built from public documentation and is correct as far as the
   * docs go, but has never round-tripped with real credentials — so its first
   * real search may need a correction. Agencies see this: telling them a
   * supplier is wired when nobody has ever run it is the kind of half-truth
   * that costs a quote.
   */
  searchVerified?: boolean;
  docsUrl?: string;
  notes?: string;
}

const apiKeyOnly = (hint?: string): CredentialField[] => [
  { key: "apiKey", label: "API key", secret: true, hint },
];

const keyAndSecret = (hint?: string): CredentialField[] => [
  { key: "apiKey", label: "API key", secret: true, hint },
  { key: "secret", label: "Shared secret", secret: true },
];

const oauthPair = (hint?: string): CredentialField[] => [
  { key: "clientId", label: "Client ID", secret: false, hint },
  { key: "clientSecret", label: "Client secret", secret: true },
];

export const CONNECTOR_REGISTRY: RegistryEntry[] = [
  // ── Air / GDS ──
  {
    id: "amadeus",
    displayName: "Amadeus",
    category: "air",
    kinds: ["flight"],
    credentialScheme: "oauth2_client_credentials",
    credentialFields: [
      ...oauthPair("From your Amadeus Enterprise contract"),
      {
        key: "apiHost",
        label: "API host",
        secret: false,
        hint: "The https origin Amadeus issued you, e.g. https://api.yourorg.amadeus.com",
      },
    ],
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true },
    searchVerified: true,
    requiresCertification: true,
    docsUrl: "https://developers.amadeus.com",
    notes:
      "OAuth2 client_credentials. SEARCH IS LIVE — Flight Offers Search v2 — and RE-PRICING IS LIVE via Flight Offers Price, which takes the whole offer back, so the offer itself is the revalidation token. The public Self-Service hosts (api/test.api.amadeus.com) were retired on 17 Jul 2026 and no longer resolve; Amadeus is Enterprise-only and issues an endpoint with the contract, so the host is a per-connection field. ToS: keep the API User Identity confidential and prevent third parties from using it.",
  },
  {
    id: "travelport",
    displayName: "Travelport TripServices",
    category: "air",
    kinds: ["flight"],
    credentialScheme: "oauth2_client_credentials",
    credentialFields: [
      ...oauthPair("Issued during Travelport developer certification"),
      { key: "targetBranch", label: "Target Branch", secret: false, hint: "Your agency's branch code" },
    ],
    enabled: true,
    status: "planned",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    requiresCertification: true,
    docsUrl: "https://developer.travelport.com",
    notes: "Authenticates. Search contract + Target Branch are issued at certification; not public.",
  },
  {
    id: "sabre",
    displayName: "Sabre",
    category: "air",
    kinds: ["flight"],
    credentialScheme: "oauth2_client_credentials",
    credentialFields: [
      ...oauthPair("From your certified Sabre Red App"),
      { key: "pcc", label: "PCC", secret: false, hint: "Your agency's pseudo city code" },
    ],
    enabled: true,
    status: "planned",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    requiresCertification: true,
    docsUrl: "https://developer.sabre.com/guides/travel-agency/how-to/rest-apis",
    notes:
      "OAuth2 v2 token (Basic-style). BYOK confirmed: EPR username formatted EPR-PCC-AA embeds the agency's own PCC. Bargain Finder Max payload pending Red App certification.",
  },
  {
    id: "duffel",
    displayName: "Duffel",
    category: "air",
    kinds: ["flight", "hotel"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Starts duffel_test_ or duffel_live_"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true },
    searchVerified: true,
    requiresCertification: false,
    docsUrl: "https://duffel.com/docs/api/overview/making-requests",
    notes:
      "Bearer token; self-serve test tokens (verified). Server-side only. Flights: search + revalidate + orders, verified. Hotels via Duffel Stays on the same token: search + quote + booking built from Duffel's docs, not yet run live — and Stays must be enabled for the account by Duffel (request access).",
  },

  // ── Hotels / ground ──
  {
    id: "hotelbeds",
    displayName: "HBX Group / Hotelbeds",
    category: "hotel",
    kinds: ["hotel", "transfer", "activity"],
    credentialScheme: "api_key",
    credentialFields: keyAndSecret("From the HBX / Hotelbeds developer portal"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true },
    searchVerified: true,
    requiresCertification: true,
    docsUrl: "https://developer.hotelbeds.com/documentation/getting-started/",
    notes:
      "Api-key header + X-Signature (SHA-256 of apiKey+secret+unixSeconds), recomputed per request (verified). Health check hits the real /status endpoint. SEARCH IS LIVE — hotel availability, keyed off the destination code resolved by destinationMap.ts. The mapper scans every room and rate for the cheapest bookable one, reads real cancellation deadlines (NRF plus policy start dates) and routes non-included taxes to payAtProperty.",
  },
  {
    id: "webbeds",
    displayName: "WebBeds",
    category: "hotel",
    kinds: ["hotel"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Issued under a WebBeds distribution agreement"),
    enabled: true,
    status: "planned",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    requiresCertification: true,
    notes: "No open API contract — endpoints are issued with the distribution agreement.",
  },
  {
    id: "expedia_rapid",
    displayName: "Expedia Rapid",
    category: "hotel",
    kinds: ["hotel"],
    credentialScheme: "api_key",
    credentialFields: [
      ...keyAndSecret("From your Expedia Rapid partner account"),
      {
        key: "pointOfSaleCountry",
        label: "Point-of-sale country",
        secret: false,
        hint: "ISO code Rapid prices and taxes against, e.g. GR",
      },
      {
        key: "customerIp",
        label: "Originating IP address",
        secret: false,
        hint: "Rapid requires the IP shopping requests come from — use a public IP your agency owns",
      },
    ],
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: false, healthCheck: true },
    searchVerified: false,
    requiresCertification: true,
    docsUrl: "https://developers.expediagroup.com/docs/products/rapid",
    notes:
      "EAN signature auth: SHA-512 of key+secret+unixSeconds, sent as Authorization: EAN APIKey=..,Signature=..,timestamp=.. (verified). SEARCH IS BUILT from the public Rapid docs in three calls — region property_ids, availability, then content for names — and is UNVERIFIED against a live account. Re-pricing needs the shopping context this connector does not keep, so the price_check link is stored but revalidate is not declared.",
  },
  {
    id: "booking_demand",
    displayName: "Booking.com Demand API",
    category: "hotel",
    kinds: ["hotel"],
    credentialScheme: "api_key",
    credentialFields: [
      { key: "apiKey", label: "Bearer token", secret: true, hint: "From the Booking.com Demand API console" },
      { key: "affiliateId", label: "Affiliate ID", secret: false },
      {
        key: "pointOfSaleCountry",
        label: "Booker country",
        secret: false,
        hint: "ISO code Booking prices against, e.g. gr",
      },
    ],
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: false, healthCheck: true },
    searchVerified: false,
    requiresCertification: true,
    docsUrl: "https://developers.booking.com/demand/docs",
    notes:
      "Bearer + X-Affiliate-Id. SEARCH IS BUILT from the public Demand API docs (accommodations/search, then accommodations/details for names) and is UNVERIFIED against a live account. Rates are commissionable gross prices, so markup is forbidden and the margin is the affiliate commission.",
  },
  {
    id: "travelgate",
    displayName: "Travelgate Hotel-X",
    category: "aggregator",
    kinds: ["hotel"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Your TravelgateX API key"),
    enabled: true,
    status: "planned",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    requiresCertification: true,
    docsUrl: "https://docs.travelgatex.com",
    notes: "GraphQL, Authorization: Apikey <key>. Search pending per-supplier access config; destinations resolve through destinationMap.ts.",
  },

  // ── Ferries ──
  {
    id: "liknoss",
    displayName: "Liknoss",
    category: "ferry",
    kinds: ["transfer"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Issued by Liknoss to licensed agencies"),
    enabled: true,
    status: "planned",
    capabilities: { search: true, healthCheck: true },
    requiresCertification: true,
    notes: "Ferry API contract is issued directly to licensed agencies; not public.",
  },
  {
    id: "ferryhopper",
    displayName: "Ferryhopper Partner API",
    category: "ferry",
    kinds: ["transfer"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("From your Ferryhopper partnership"),
    enabled: true,
    status: "planned",
    capabilities: { search: true, healthCheck: true },
    requiresCertification: true,
    notes: "Partner API shared under NDA after a partnership agreement.",
  },

  // ── Activities ──
  {
    id: "viator",
    displayName: "Viator Partner API",
    category: "activity",
    kinds: ["activity"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Your Viator partner API key"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    searchVerified: false,
    requiresCertification: false,
    docsUrl: "https://docs.viator.com/partner-api/technical/",
    notes:
      "exp-api-key header, pinned to Accept: application/json;version=2.0 — the response schema is version-dependent. Destination ids resolve through destinationMap.ts. Request/response shapes CHECKED against Viator's OpenAPI spec (Partner API 2.0, 2026-09-30) — which caught `iataCodes` being an array — but still never run against a live account. Search: products/search, per person × travellers; a merchant account's partnerNetFromPrice is bought NET (markup allowed), otherwise the retail price is commissionable (markup forbidden). Re-pricing: availability/check for one date inside the trip. Booking is NOT through Planera (it needs per-product booking questions): the agency books in Viator and records the reference.",
  },
  {
    id: "tiqets",
    displayName: "Tiqets Distributor API",
    category: "activity",
    kinds: ["activity"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Your Tiqets distributor token"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, healthCheck: true },
    searchVerified: false,
    requiresCertification: false,
    docsUrl: "https://developers.tiqets.dev",
    notes:
      "Authorization: Token <key>. City ids resolve through destinationMap.ts. SEARCH is CHECKED against developers.tiqets.dev (2026-10-01: city_id filter, sale_status available|unavailable, test host api.api-tiqt-test.steq.it) but still UNVERIFIED against a live account; the price mapper accepts all three shapes Tiqets has used. Per-ticket and commissionable, so it is multiplied by traveller count and markup is forbidden.",
  },

  // ── Test doubles ──
  {
    id: "mock-air",
    displayName: "Mock Air (sandbox)",
    category: "air",
    kinds: ["flight"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Any value — this is a test double"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    searchVerified: true,
    internalOnly: true,
    requiresCertification: false,
    notes: "Deterministic test double. No network calls.",
  },
  {
    id: "mock-hotel",
    displayName: "Mock Hotel (sandbox)",
    category: "hotel",
    kinds: ["hotel"],
    credentialScheme: "api_key",
    credentialFields: apiKeyOnly("Any value — this is a test double"),
    enabled: true,
    status: "sandbox",
    capabilities: { search: true, revalidate: true, healthCheck: true },
    searchVerified: true,
    internalOnly: true,
    requiresCertification: false,
    notes: "Deterministic test double. No network calls.",
  },
];

export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return CONNECTOR_REGISTRY.find((e) => e.id === id);
}

/**
 * Whether this deployment offers the test doubles. Off unless asked for, so
 * production never shows them; the demo workspace sets it.
 */
export const mocksEnabled = (): boolean => process.env.AGENCY_ENABLE_MOCKS === "1";

/**
 * What a tenant may connect right now. Note this filters the CATALOGUE only —
 * an existing connection to a mock keeps working and keeps being listed, so
 * turning the flag off never silently breaks a workspace that already has one.
 */
export function enabledConnectors(): RegistryEntry[] {
  const allowMocks = mocksEnabled();
  return CONNECTOR_REGISTRY.filter((e) => e.enabled && (allowMocks || !e.internalOnly));
}

/** The credential fields a given provider requires. */
export function requiredFieldsFor(id: string): string[] {
  return getRegistryEntry(id)?.credentialFields.map((f) => f.key) ?? [];
}
