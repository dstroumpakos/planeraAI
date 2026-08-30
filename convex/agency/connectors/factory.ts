/**
 * Connector factory — maps a registry id to the object that actually talks to
 * the supplier.
 *
 * The registry says which providers EXIST and are commercially enabled; this
 * factory says which ones we have WRITTEN CODE for. The two are deliberately
 * separate: a provider can be commercially approved months before its
 * integration lands, and an integration can exist while the provider is
 * switched off. A connection may only be created for a provider that is both
 * enabled and implemented, and the orchestrator skips anything unimplemented
 * instead of failing the whole search.
 */

import { duffelConnector } from "./duffel";
import { mockAirConnector, mockHotelConnector } from "./mock";
import { getRegistryEntry } from "./registry";
import type { SupplierConnector } from "./types";

const IMPLEMENTED: Record<string, SupplierConnector> = {
  duffel: duffelConnector,
  "mock-air": mockAirConnector,
  "mock-hotel": mockHotelConnector,
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
