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
 *  - Booking is optional and gated by the `createBooking` capability — only
 *    connectors whose order API is implemented declare it.
 */

import type { NormalizedOffer } from "../model/types";
import type { DestinationCandidate, DestinationTarget } from "../destinations";

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
  /**
   * True when a search is impossible without `providerDestinationId`. The
   * orchestrator skips such a connector with a clear reason rather than calling
   * it with a destination it cannot understand.
   */
  requiresDestinationId?: boolean;
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
  /**
   * The destination in THIS provider's own taxonomy, resolved and cached by
   * `destinationMap.ts`. Injected per connector by the orchestrator, because
   * the same trip is a different id at every supplier.
   */
  providerDestinationId?: string;
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

  /**
   * Ask the provider's own locations feed which destinations could match a
   * target, so `destinations.ts` can pick one. Present only where the provider
   * publishes such a feed; without it a destination has to be mapped by hand.
   *
   * Returns CANDIDATES, never a decision — choosing is matching logic, and it
   * lives in one tested place rather than in each connector.
   */
  listDestinations?(
    creds: SupplierCredentials,
    target: DestinationTarget,
  ): Promise<DestinationCandidate[]>;

  /** Re-fetch one offer by its provider-locked token — the only guaranteed price. */
  revalidate(creds: SupplierCredentials, revalidationToken: string): Promise<RevalidateResult>;

  getCancellationTerms?(creds: SupplierCredentials, revalidationToken: string): Promise<string>;

  /**
   * Create a REAL order with the supplier, on the agency's own account. Present
   * only where `supports.createBooking` is true. Called once per explicit agent
   * action, never retried automatically: a retry after a lost response is how
   * a client gets two tickets.
   */
  createBooking?(creds: SupplierCredentials, req: BookingRequest): Promise<BookingResult>;
}

export interface BookingPassenger {
  type: "adult" | "child" | "infant";
  title: "mr" | "ms" | "mrs" | "miss";
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: "m" | "f";
}

export interface BookingRequest {
  /** The provider-locked handle, freshest one we hold. */
  revalidationToken: string;
  offer: NormalizedOffer;
  passengers: BookingPassenger[];
  contact: { email: string; phone: string };
  /** The agency's own file reference, carried to the supplier where it has a field. */
  clientReference: string;
  /** Rooms the hotel was priced for. */
  rooms?: number;
  /** Trip start (YYYY-MM-DD) — hotels want each child's age on arrival. */
  travelDate?: string;
  /**
   * The supplier total the quote was sold on (base + taxes, minor units). A
   * connector that learns the price ROSE refuses to book: the agency would pay
   * more than it charged, and the client was never told.
   */
  expectedTotal?: import("../model/types").Money;
}

export interface BookingResult {
  /**
   * "unknown" is reserved for the caller (a timeout after sending). A connector
   * that got an answer says what the answer was.
   */
  status: "confirmed" | "ticketed" | "requested" | "failed";
  supplierReference?: string;
  supplierBookingId?: string;
  documents?: string[];
  deadlineISO?: string;
  amountCharged?: import("../model/types").Money;
  message?: string;
}

/** Guard used by the orchestrator before invoking any method. */
export function assertCapability(c: SupplierConnector, cap: Capability): void {
  if (!c.capabilities.supports[cap]) {
    throw new Error(`connector ${c.id} does not support capability "${cap}"`);
  }
}
