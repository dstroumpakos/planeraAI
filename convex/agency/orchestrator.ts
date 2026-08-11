/**
 * Planera for Travel Agencies — Search Orchestrator (pure).
 *
 * Fans a search out across a tenant's connected suppliers IN PARALLEL, then
 * aggregates the normalised offers. Design rules honoured:
 *  - capability-gated: only calls a connector that declares `search` for the
 *    requested kind (never pretends a capability exists),
 *  - partial-failure tolerant: one connector failing/timing-out does NOT fail
 *    the whole search — it's recorded per-connector and the rest still return,
 *  - provider-locked: each offer keeps its `connectorId` so revalidation later
 *    hits the SAME connector that produced it.
 *
 * Connector instances + decrypted creds are supplied by the caller (a trusted
 * Convex action that decrypted the vault). This module never sees the vault.
 */

import type {
  NormalizedFlightOffer,
  NormalizedHotelOffer,
  NormalizedOffer,
} from "./model/types";
import type { SearchQuery, SupplierConnector, SupplierCredentials } from "./connectors/types";

export interface ConnectorBinding {
  connector: SupplierConnector;
  creds: SupplierCredentials;
}

export interface ConnectorRunResult {
  connectorId: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
  skippedReason?: "no_search_capability" | "kind_unsupported";
}

export interface OrchestratorResult {
  offers: NormalizedOffer[];
  byConnector: ConnectorRunResult[];
}

/** Run one search kind across all eligible connectors, in parallel. */
export async function runSearch(
  bindings: ConnectorBinding[],
  query: SearchQuery,
  now: () => number = Date.now,
): Promise<OrchestratorResult> {
  const byConnector: ConnectorRunResult[] = [];
  const runnable: ConnectorBinding[] = [];

  for (const b of bindings) {
    const caps = b.connector.capabilities;
    if (!caps.supports.search) {
      byConnector.push({ connectorId: b.connector.id, ok: false, count: 0, ms: 0, skippedReason: "no_search_capability" });
      continue;
    }
    if (!caps.kinds.includes(query.kind)) {
      byConnector.push({ connectorId: b.connector.id, ok: false, count: 0, ms: 0, skippedReason: "kind_unsupported" });
      continue;
    }
    runnable.push(b);
  }

  const settled = await Promise.allSettled(
    runnable.map(async (b) => {
      const t0 = now();
      const offers = await b.connector.search(b.creds, query);
      return { id: b.connector.id, offers, ms: now() - t0 };
    }),
  );

  const offers: NormalizedOffer[] = [];
  settled.forEach((r, i) => {
    const id = runnable[i].connector.id;
    if (r.status === "fulfilled") {
      offers.push(...r.value.offers);
      byConnector.push({ connectorId: id, ok: true, count: r.value.offers.length, ms: r.value.ms });
    } else {
      byConnector.push({ connectorId: id, ok: false, count: 0, ms: 0, error: String(r.reason?.message ?? r.reason) });
    }
  });

  return { offers, byConnector };
}

export interface MultiKindSearch {
  flights: NormalizedFlightOffer[];
  hotels: NormalizedHotelOffer[];
  diagnostics: ConnectorRunResult[];
}

/**
 * Run the flight + hotel searches a quote needs, in parallel. `baseQuery` holds
 * the shared trip params; `kind` is overridden per search.
 */
export async function searchForQuote(
  bindings: ConnectorBinding[],
  baseQuery: Omit<SearchQuery, "kind">,
): Promise<MultiKindSearch> {
  const [flightRes, hotelRes] = await Promise.all([
    runSearch(bindings, { ...baseQuery, kind: "flight" }),
    runSearch(bindings, { ...baseQuery, kind: "hotel" }),
  ]);
  return {
    flights: flightRes.offers.filter((o): o is NormalizedFlightOffer => o.kind === "flight"),
    hotels: hotelRes.offers.filter((o): o is NormalizedHotelOffer => o.kind === "hotel"),
    diagnostics: [...flightRes.byConnector, ...hotelRes.byConnector],
  };
}

// ── Revalidation ─────────────────────────────────────────────────────────────

export interface RevalidationLine {
  offerId: string;
  connectorId: string;
  stillAvailable: boolean;
  priceChanged: boolean;
  unverifiable?: boolean; // connector can't revalidate → agent must confirm manually
  message?: string;
}

export interface RevalidationOutcome {
  /** A quote is bookable-safe only if every selected offer is still available. */
  quoteStillValid: boolean;
  anyPriceChanged: boolean;
  lines: RevalidationLine[];
  revalidatedAt: number;
}

/**
 * Re-check each selected offer against the SAME connector that produced it.
 * Never auto-retries a non-idempotent booking; this is a read-only price/avail
 * check. Missing revalidation capability marks the line `unverifiable` (surfaced
 * to the agent), and — being unverifiable — makes the quote not auto-valid.
 */
export async function revalidateSelected(
  bindingsById: Map<string, ConnectorBinding>,
  selectedOffers: NormalizedOffer[],
  now: number = Date.now(),
): Promise<RevalidationOutcome> {
  const lines: RevalidationLine[] = [];

  for (const offer of selectedOffers) {
    const b = bindingsById.get(offer.connectorId);
    if (!b || !b.connector.capabilities.supports.revalidate || !offer.revalidationToken) {
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: false, priceChanged: false, unverifiable: true, message: "connector cannot revalidate this offer" });
      continue;
    }
    try {
      const r = await b.connector.revalidate(b.creds, offer.revalidationToken);
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: r.stillAvailable, priceChanged: !!r.priceChanged, message: r.message });
    } catch (e) {
      // A timeout/error is NOT treated as "unavailable" data — it's unverifiable.
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: false, priceChanged: false, unverifiable: true, message: String((e as Error)?.message ?? e) });
    }
  }

  const quoteStillValid = lines.length > 0 && lines.every((l) => l.stillAvailable && !l.unverifiable);
  return { quoteStillValid, anyPriceChanged: lines.some((l) => l.priceChanged), lines, revalidatedAt: now };
}
