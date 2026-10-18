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
import { cityForIata } from "../../lib/radarDestinations";
import type {
  BookingRequest,
  BookingResult,
  HealthStatus,
  RevalidateResult,
  SearchQuery,
  SupplierConnector,
  SupplierCredentials,
} from "./types";

/** A deterministic six-letter reference, so a demo shows something PNR-shaped. */
function mockReference(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += A[h % A.length];
    h = Math.floor(h / A.length) + 7 * (i + 1);
  }
  return out;
}

async function mockBook(req: BookingRequest, kind: "flight" | "hotel"): Promise<BookingResult> {
  const ref = mockReference(`${req.revalidationToken}:${req.clientReference}`);
  return kind === "flight"
    ? {
        status: "ticketed",
        supplierReference: ref,
        supplierBookingId: `mock-ord-${ref}`,
        documents: req.passengers.map((_, i) => `999-${String(1234567890 + i)}`),
        message: "mock order (sandbox — nothing was really booked)",
      }
    : {
        status: "confirmed",
        supplierReference: `MH-${ref}`,
        message: "mock booking (sandbox — nothing was really booked)",
      };
}

/** Nights between two YYYY-MM-DD dates; 4 when the stay has no end date. */
function stayNights(depart?: string, ret?: string): number {
  if (!depart || !ret) return 4;
  const n = Math.round((Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${depart}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function addDaysISO(dateYMD: string, days: number): string {
  return new Date(Date.parse(`${dateYMD}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function isoAt(dateYMD: string, hour: number): string {
  return `${dateYMD}T${String(hour).padStart(2, "0")}:00:00`;
}

export const mockAirConnector: SupplierConnector = {
  id: "mock-air",
  displayName: "Mock Air (sandbox)",
  capabilities: {
    kinds: ["flight"],
    supports: { search: true, retrieveOffer: false, revalidate: true, createBooking: true, retrieveBooking: false, cancelBooking: false, getCancellationTerms: false, healthCheck: true },
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
  createBooking: (_creds, req) => mockBook(req, "flight"),
};

export const mockHotelConnector: SupplierConnector = {
  id: "mock-hotel",
  displayName: "Sandbox hotels",
  capabilities: {
    kinds: ["hotel"],
    supports: { search: true, retrieveOffer: false, revalidate: true, createBooking: true, retrieveBooking: false, cancelBooking: false, getCancellationTerms: false, healthCheck: true },
  },
  async healthCheck(creds: SupplierCredentials): Promise<HealthStatus> {
    return { healthy: true, environment: creds.environment, latencyMs: 15 };
  },
  async search(_creds, q: SearchQuery): Promise<NormalizedOffer[]> {
    const cur = q.sellCurrency;
    // The stay the agent actually asked for. This used to be a hardcoded 4, so
    // a 5-night Barcelona quote showed a 4-night hotel at a 4-night price.
    const nights = stayNights(q.departDate, q.returnDate);
    const rooms = Math.max(1, q.rooms ?? 1);
    const city = q.destinationCity || cityForIata(q.destinationIata ?? "") || "City";
    // Free cancellation until three days before check-in — a date that is
    // always ahead of the stay, unlike the fixed one it replaces.
    const freeUntil = q.departDate ? addDaysISO(q.departDate, -3) : undefined;
    const mk = (
      i: number, perNightMinor: number, stars: number, review: number, dist: number,
      board: NormalizedHotelOffer["boardType"], freeCancel: boolean, name: string, room: string,
    ): NormalizedHotelOffer => {
      const priceMinor = perNightMinor * nights * rooms;
      return {
        kind: "hotel",
        offerId: `mock-hotel:H${i}`,
        connectorId: "mock-hotel",
        supplierOfferId: `H${i}`,
        cost: { rateType: "net", base: money(priceMinor, cur), taxes: money(Math.round(priceMinor * 0.12), cur) },
        conditions: {
          refundable: freeCancel,
          changeable: freeCancel,
          summary: freeCancel ? "Free cancellation" : "Non-refundable",
        },
        revalidationToken: `tok-H${i}`,
        quotedAt: Date.now(),
        name,
        starRating: stars,
        reviewScore: review,
        distanceFromCentreM: dist,
        boardType: board,
        roomCategory: room,
        nights,
        freeCancellationUntilISO: freeCancel && freeUntil ? `${freeUntil}T00:00:00` : undefined,
      };
    };
    // Sandbox inventory with a believable shape: names carry the destination
    // so a demo reads like the trip being quoted, and the five options span the
    // range an agent actually chooses between. H1..H3 are the budget / central /
    // flagship archetypes the scoring tests are written against.
    return [
      mk(1, 6000, 2, 6.8, 3200, "room_only", false, `Hotel ${city} Station`, "Standard Double"),
      mk(2, 11500, 4, 8.1, 900, "breakfast", true, `${city} Central Hotel`, "Superior Double"),
      mk(3, 20500, 5, 9.0, 300, "breakfast", true, `The ${city} Grand`, "Deluxe Double"),
      mk(4, 9800, 3, 7.6, 1800, "breakfast", false, `${city} Old Town Rooms`, "Standard Double"),
      mk(5, 14500, 4, 8.7, 600, "breakfast", true, `Boutique ${city} Garden`, "Junior Suite"),
    ];
  },
  async revalidate(_creds, token: string): Promise<RevalidateResult> {
    return { stillAvailable: true, message: `mock revalidate ok for ${token}`, priceChanged: false };
  },
  createBooking: (_creds, req) => mockBook(req, "hotel"),
};
