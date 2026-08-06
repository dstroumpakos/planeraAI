/**
 * Planera for Travel Agencies — Supplier Connector interface.
 *
 * Every provider (Amadeus, Travelport, Sabre, Duffel, Hotelbeds/HBX, WebBeds,
 * Expedia Rapid, Booking.com Demand, Travelgate, Liknoss, Ferryhopper, Viator,
 * Tiqets, …) implements this SAME interface. A connector DECLARES its
 * capabilities; the orchestrator must never call a method a connector doesn't
 * declare, and must never present an undeclared capability to the agent.
 *
 * Rules honoured here:
 *  - BYOK only: credentials are opaque `SupplierCredentials` resolved per-tenant
 *    from the encrypted vault. Connectors NEVER receive raw supplier passwords,
 *    and the interface has no field for one.
 *  - Search results are NOT guaranteed prices → `revalidate()` exists and is the
 *    only source of a bookable price.
 *  - Booking is out of MVP scope: `createBooking` etc. are optional and gated by
 *    capability flags (all false in MVP connectors).
 */

import type { NormalizedOffer } from "../model/types";

// ─────────────────────────────────────────────────────────────────────────────
// Credentials (BYOK) — opaque to the engine; only the connector interprets them.
// ─────────────────────────────────────────────────────────────────────────────

export type CredentialScheme =
  | "api_key"
  | "oauth2_client_credentials"
  | "pcc_office_id" // GDS: PCC / Office ID / access group
  | "affiliate_id";

/**
 * Decrypted, per-tenant supplier credentials. Produced ONLY inside a trusted
 * server action after vault decryption. Never logged, never returned to a query,
 * never sent to the frontend. There is deliberately NO `password` field.
 */
export interface SupplierCredentials {
  scheme: CredentialScheme;
  environment: "sandbox" | "production";
  /** Scheme-specific fields, e.g. { apiKey } | { clientId, clientSecret } | { pcc, officeId }. */
  fields: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────────────

export type Capability =
  | "search"
  | "retrieveOffer"
  | "revalidate"
  | "createBooking"
  | "retrieveBooking"
  | "cancelBooking"
  | "getCancellationTerms"
  | "healthCheck";

export interface ConnectorCapabilities {
  kinds: Array<NormalizedOffer["kind"]>; // what this provider sells
  supports: Record<Capability, boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Method payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchQuery {
  kind: NormalizedOffer["kind"];
  originIata?: string;
  destinationIata?: string;
  destinationCity?: string;
  departDate?: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  childrenAges: number[];
  rooms?: number;
  cabinClass?: string;
  sellCurrency: string;
}

export interface RevalidateResult {
  /** True if the exact offer is still available at (<=) the quoted price. */
  stillAvailable: boolean;
  /** The authoritative current offer (may carry a new price/token). */
  offer?: NormalizedOffer;
  /** Set when price moved; the agent must be shown the delta. */
  priceChanged?: boolean;
  message?: string;
}

export interface HealthStatus {
  healthy: boolean;
  environment: "sandbox" | "production";
  latencyMs?: number;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SupplierConnector {
  readonly id: string; // stable, e.g. "amadeus", "hotelbeds", "duffel", "mock-air"
  readonly displayName: string;
  readonly capabilities: ConnectorCapabilities;

  /** Verify credentials without side effects. */
  healthCheck(creds: SupplierCredentials): Promise<HealthStatus>;

  /** Search — returns UNGUARANTEED offers. Must be normalised to `NormalizedOffer`. */
  search(creds: SupplierCredentials, query: SearchQuery): Promise<NormalizedOffer[]>;

  /** Re-fetch one offer by its provider-locked token — the only guaranteed price. */
  revalidate(creds: SupplierCredentials, revalidationToken: string): Promise<RevalidateResult>;

  getCancellationTerms?(creds: SupplierCredentials, revalidationToken: string): Promise<string>;

  // ── Booking phase (post-MVP). Present only if capability is declared true. ──
  createBooking?(...args: unknown[]): Promise<never>;
  retrieveBooking?(...args: unknown[]): Promise<never>;
  cancelBooking?(...args: unknown[]): Promise<never>;
}

/** Guard used by the orchestrator before invoking any method. */
export function assertCapability(c: SupplierConnector, cap: Capability): void {
  if (!c.capabilities.supports[cap]) {
    throw new Error(`connector ${c.id} does not support capability "${cap}"`);
  }
}
