/**
 * Deterministic mock connectors (air + hotel) for unit tests and sandbox demos.
 * No network. Prices are seeded from the query so tests are reproducible.
 * These implement the real `SupplierConnector` interface exactly.
 */

import type {
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedOffer,
} from "../model/types";
import { money } from "../model/types";
import type {
  HealthStatus,
  RevalidateResult,
  SearchQuery,
  SupplierConnector,
  SupplierCredentials,
} from "./types";

function isoAt(dateYMD: string, hour: number): string {
  return `${dateYMD}T${String(hour).padStart(2, "0")}:00:00`;
}

export const mockAirConnector: SupplierConnector = {
  id: "mock-air",
  displayName: "Mock Air (sandbox)",
  capabilities: {
    kinds: ["flight"],
    supports: { search: true, retrieveOffer: false, revalidate: true, createBooking: false, retrieveBooking: false, cancelBooking: false, getCancellationTerms: false, healthCheck: true },
  },
  async healthCheck(creds: SupplierCredentials): Promise<HealthStatus> {
    return { healthy: true, environment: creds.environment, latencyMs: 12 };
  },
  async search(_creds, q: SearchQuery): Promise<NormalizedOffer[]> {
    const cur = q.sellCurrency;
    const dep = q.departDate ?? "2026-09-01";
    const from = q.originIata ?? "ATH";
    const to = q.destinationIata ?? "CDG";
    // Three archetypes: cheap-basic, direct-comfort, flexible-premium.
    const mk = (
      i: number, priceMinor: number, stops: number, dur: number, hour: number,
      cabinBags: number, checkedBags: number, refundable: boolean, changeable: boolean,
    ): NormalizedFlightOffer => ({
      kind: "flight",
      offerId: `mock-air:F${i}`,
      connectorId: "mock-air",
      supplierOfferId: `F${i}`,
      cost: { rateType: "net", base: money(priceMinor, cur), taxes: money(Math.round(priceMinor * 0.18), cur) },
      conditions: { refundable, changeable, cancellationPenalty: refundable ? money(0, cur) : money(Math.round(priceMinor * 0.5), cur) },
      revalidationToken: `tok-F${i}`,
      quotedAt: Date.now(),
      outbound: [{ fromIata: from, toIata: to, departISO: isoAt(dep, hour), arriveISO: isoAt(dep, hour + Math.ceil(dur / 60)), carrier: "MK", durationMinutes: dur }],
      outboundStops: stops,
      totalDurationMinutes: dur,
      cabinClass: "economy",
      baggage: { cabin: cabinBags, checked: checkedBags },
    });
    return [
      mk(1, 9900, 1, 260, 6, 1, 0, false, false), // cheap, 1 stop, early, no bags
      mk(2, 15900, 0, 195, 9, 1, 1, false, true), // direct, good time, checked bag
      mk(3, 27900, 0, 190, 11, 1, 2, true, true), // direct, flexible, refundable
    ];
  },
  async revalidate(_creds, token: string): Promise<RevalidateResult> {
    return { stillAvailable: true, message: `mock revalidate ok for ${token}`, priceChanged: false };
  },
};

export const mockHotelConnector: SupplierConnector = {
  id: "mock-hotel",
  displayName: "Mock Hotel (sandbox)",
  capabilities: {
    kinds: ["hotel"],
    supports: { search: true, retrieveOffer: false, revalidate: true, createBooking: false, retrieveBooking: false, cancelBooking: false, getCancellationTerms: false, healthCheck: true },
  },
  async healthCheck(creds: SupplierCredentials): Promise<HealthStatus> {
    return { healthy: true, environment: creds.environment, latencyMs: 15 };
  },
  async search(_creds, q: SearchQuery): Promise<NormalizedOffer[]> {
    const cur = q.sellCurrency;
    const nights = 4;
    const mk = (
      i: number, priceMinor: number, stars: number, review: number, dist: number,
      board: NormalizedHotelOffer["boardType"], freeCancel: boolean,
    ): NormalizedHotelOffer => ({
      kind: "hotel",
      offerId: `mock-hotel:H${i}`,
      connectorId: "mock-hotel",
      supplierOfferId: `H${i}`,
      cost: { rateType: "net", base: money(priceMinor, cur), taxes: money(Math.round(priceMinor * 0.12), cur) },
      conditions: { refundable: freeCancel, changeable: freeCancel, summary: freeCancel ? "Free cancellation" : "Non-refundable" },
      revalidationToken: `tok-H${i}`,
      quotedAt: Date.now(),
      name: `Mock Hotel ${i}`,
      starRating: stars,
      reviewScore: review,
      distanceFromCentreM: dist,
      boardType: board,
      nights,
      freeCancellationUntilISO: freeCancel ? "2026-08-25T00:00:00" : undefined,
    });
    return [
      mk(1, 24000, 2, 6.8, 3200, "room_only", false), // budget, far, basic
      mk(2, 46000, 4, 8.1, 900, "breakfast", true), // 4*, central, breakfast
      mk(3, 82000, 5, 9.0, 300, "breakfast", true), // 5*, very central, flexible
    ];
  },
  async revalidate(_creds, token: string): Promise<RevalidateResult> {
    return { stillAvailable: true, message: `mock revalidate ok for ${token}`, priceChanged: false };
  },
};
