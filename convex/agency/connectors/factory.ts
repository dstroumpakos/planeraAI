/**
 * Connector factory — maps a registry id to the object that actually talks to
 * the supplier.
 *
 * The registry says which providers EXIST and are commercially enabled; this
 * factory says which ones we have working CODE for. The two are deliberately
 * separate: a provider can be commercially approved months before its
 * integration lands, and an integration can exist while the provider is
 * switched off.
 *
 * Every provider is built and callable. What differs is depth, which
 * `searchable()` reports honestly:
 *   - Duffel and Amadeus search for real.
 *   - The rest authenticate and health-check against their real endpoints, and
 *     refuse to search rather than posting a guessed payload.
 */

import { duffelConnector } from "./duffel";
import { makeConnector } from "./generic";
import { mockAirConnector, mockHotelConnector } from "./mock";
import { CONNECTOR_SPECS } from "./providers";
import { getRegistryEntry } from "./registry";
import type { SupplierConnector } from "./types";

const SPEC_CONNECTORS: Record<string, SupplierConnector> = Object.fromEntries(
  CONNECTOR_SPECS.map((spec) => [spec.id, makeConnector(spec)]),
);

const IMPLEMENTED: Record<string, SupplierConnector> = {
  // Hand-written: these two have full search + revalidation.
  duffel: duffelConnector,
  "mock-air": mockAirConnector,
  "mock-hotel": mockHotelConnector,
  // Spec-driven: the twelve real providers.
  ...SPEC_CONNECTORS,
};

/** The live connector for an id, or null when we have not built it yet. */
export function getConnector(connectorId: string): SupplierConnector | null {
  return IMPLEMENTED[connectorId] ?? null;
}

export const isImplemented = (connectorId: string): boolean => connectorId in IMPLEMENTED;

export const implementedConnectorIds = (): string[] => Object.keys(IMPLEMENTED).sort();

/**
 * A provider an agency may connect right now: present in the registry, enabled
 * there, and backed by real code here.
 */
export function isConnectable(connectorId: string): boolean {
  const entry = getRegistryEntry(connectorId);
  return !!entry?.enabled && isImplemented(connectorId);
}

/**
 * Whether this connector can actually return offers. A connection to a
 * provider that only authenticates is still worth making — it proves the
 * agency's credentials before the integration lands — but the UI must not imply
 * that searches will include it.
 */
export function isSearchable(connectorId: string): boolean {
  return !!getConnector(connectorId)?.capabilities.supports.search;
}

/** The reason a connected provider cannot search yet, if any. */
export function pendingReason(connectorId: string): string | null {
  if (isSearchable(connectorId)) return null;
  return CONNECTOR_SPECS.find((s) => s.id === connectorId)?.pendingReason ?? null;
}

/** True when Planera can create a real order with this supplier. */
export function isBookable(connectorId: string): boolean {
  return !!getConnector(connectorId)?.capabilities.supports.createBooking;
}
