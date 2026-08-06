/**
 * Supplier connector registry — the single source of truth for which providers
 * exist and whether they are enabled. Removing a provider that declines
 * multi-tenant third-party status is a DATA change (`enabled: false`), never a
 * code change. Capabilities here reflect what we will implement once each
 * provider's OFFICIAL docs/certification are confirmed — they are declarations,
 * not promises of live endpoints (no endpoints are invented in this file).
 */

import type { NormalizedOffer } from "../model/types";
import type { Capability } from "./types";

export interface RegistryEntry {
  id: string;
  displayName: string;
  category: "air" | "hotel" | "ground" | "ferry" | "activity" | "aggregator";
  kinds: Array<NormalizedOffer["kind"]>;
  credentialScheme: "api_key" | "oauth2_client_credentials" | "pcc_office_id" | "affiliate_id";
  /** Master switch. Providers that decline are flipped to false. */
  enabled: boolean;
  /** Integration maturity — drives the onboarding matrix, not runtime behaviour. */
  status: "planned" | "sandbox" | "certifying" | "live";
  /** Capabilities we intend to expose once live. */
  capabilities: Partial<Record<Capability, boolean>>;
  /** Whether a provider certification step is known to be required. */
  requiresCertification: boolean;
  docsUrl?: string;
  notes?: string;
}

/**
 * Targeting ALL officially-available providers (per product direction). Each
 * stays `planned`/`sandbox` until its official spec + multi-tenant approval are
 * confirmed. Order is roughly by expected MVP priority.
 */
export const CONNECTOR_REGISTRY: RegistryEntry[] = [
  // ── Air / GDS ──
  { id: "amadeus", displayName: "Amadeus", category: "air", kinds: ["flight"], credentialScheme: "oauth2_client_credentials", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true }, requiresCertification: true },
  { id: "travelport", displayName: "Travelport TripServices", category: "air", kinds: ["flight"], credentialScheme: "pcc_office_id", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },
  { id: "sabre", displayName: "Sabre", category: "air", kinds: ["flight"], credentialScheme: "pcc_office_id", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },
  { id: "duffel", displayName: "Duffel", category: "air", kinds: ["flight"], credentialScheme: "api_key", enabled: true, status: "sandbox", capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true }, requiresCertification: false, notes: "Booking capability intentionally OFF in MVP." },

  // ── Hotels / ground ──
  { id: "hotelbeds", displayName: "HBX Group / Hotelbeds", category: "hotel", kinds: ["hotel", "transfer", "activity"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, getCancellationTerms: true, healthCheck: true }, requiresCertification: true },
  { id: "webbeds", displayName: "WebBeds", category: "hotel", kinds: ["hotel"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },
  { id: "expedia_rapid", displayName: "Expedia Rapid", category: "hotel", kinds: ["hotel"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },
  { id: "booking_demand", displayName: "Booking.com Demand API", category: "hotel", kinds: ["hotel"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },
  { id: "travelgate", displayName: "Travelgate Hotel-X", category: "aggregator", kinds: ["hotel"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: true },

  // ── Ferries ──
  { id: "liknoss", displayName: "Liknoss", category: "ferry", kinds: ["transfer"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, healthCheck: true }, requiresCertification: true },
  { id: "ferryhopper", displayName: "Ferryhopper Partner API", category: "ferry", kinds: ["transfer"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, healthCheck: true }, requiresCertification: true },

  // ── Activities ──
  { id: "viator", displayName: "Viator Partner API", category: "activity", kinds: ["activity"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, healthCheck: true }, requiresCertification: false },
  { id: "tiqets", displayName: "Tiqets Distributor API", category: "activity", kinds: ["activity"], credentialScheme: "api_key", enabled: true, status: "planned", capabilities: { search: true, healthCheck: true }, requiresCertification: false },

  // ── Test double ──
  { id: "mock-air", displayName: "Mock Air (sandbox)", category: "air", kinds: ["flight"], credentialScheme: "api_key", enabled: true, status: "sandbox", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: false },
  { id: "mock-hotel", displayName: "Mock Hotel (sandbox)", category: "hotel", kinds: ["hotel"], credentialScheme: "api_key", enabled: true, status: "sandbox", capabilities: { search: true, revalidate: true, healthCheck: true }, requiresCertification: false },
];

export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return CONNECTOR_REGISTRY.find((e) => e.id === id);
}

export function enabledConnectors(): RegistryEntry[] {
  return CONNECTOR_REGISTRY.filter((e) => e.enabled);
}
