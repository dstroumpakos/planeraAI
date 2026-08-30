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
  skippedReason?:
    | "no_search_capability"
    | "kind_unsupported"
    | "not_implemented"
    | "no_destination_mapping";
  /** True when the connector was cut off by the per-connector deadline. */
  timedOut?: boolean;
}

export interface OrchestratorResult {
  offers: NormalizedOffer[];
  byConnector: ConnectorRunResult[];
}

/**
 * Per-connector deadline. Without it one hung supplier holds the whole search
 * open until the platform kills the action, and the agent sees nothing at all
 * instead of the results the other suppliers already returned.
 */
export const DEFAULT_CONNECTOR_TIMEOUT_MS = 12_000;

export class ConnectorTimeoutError extends Error {
  constructor(connectorId: string, ms: number) {
    super(`connector ${connectorId} did not respond within ${ms}ms`);
    this.name = "ConnectorTimeoutError";
  }
}

/** Reject with ConnectorTimeoutError if `work` outlives the deadline. */
export function withTimeout<T>(work: Promise<T>, ms: number, connectorId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectorTimeoutError(connectorId, ms)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Run one search kind across all eligible connectors, in parallel. */
export async function runSearch(
  bindings: ConnectorBinding[],
  query: SearchQuery,
  now: () => number = Date.now,
  timeoutMs: number = DEFAULT_CONNECTOR_TIMEOUT_MS,
  /** Resolved destination ids, keyed by connector id. */
  destinationIds: Record<string, string> = {},
): Promise<OrchestratorResult> {
  const byConnector: ConnectorRunResult[] = [];
  const runnable: Array<{ binding: ConnectorBinding; query: SearchQuery }> = [];

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

    // Hotel/activity/ferry suppliers key off their own taxonomy. Calling one
    // with an IATA code it does not recognise returns nothing useful, so skip
    // it with a reason an agent can act on instead.
    const providerDestinationId = destinationIds[b.connector.id];
    if (caps.requiresDestinationId && !providerDestinationId) {
      byConnector.push({
        connectorId: b.connector.id,
        ok: false,
        count: 0,
        ms: 0,
        skippedReason: "no_destination_mapping",
      });
      continue;
    }

    runnable.push({ binding: b, query: { ...query, providerDestinationId } });
  }

  const settled = await Promise.allSettled(
    runnable.map(async ({ binding, query: perConnectorQuery }) => {
      const t0 = now();
      const offers = await withTimeout(
        Promise.resolve(binding.connector.search(binding.creds, perConnectorQuery)),
        timeoutMs,
        binding.connector.id,
      );
      return { id: binding.connector.id, offers, ms: now() - t0 };
    }),
  );

  const offers: NormalizedOffer[] = [];
  settled.forEach((r, i) => {
    const id = runnable[i].binding.connector.id;
    if (r.status === "fulfilled") {
      offers.push(...r.value.offers);
      byConnector.push({ connectorId: id, ok: true, count: r.value.offers.length, ms: r.value.ms });
    } else {
      byConnector.push({
        connectorId: id,
        ok: false,
        count: 0,
        ms: 0,
        timedOut: r.reason instanceof ConnectorTimeoutError,
        error: String(r.reason?.message ?? r.reason),
      });
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
  timeoutMs: number = DEFAULT_CONNECTOR_TIMEOUT_MS,
  /** Resolved destination ids, keyed by connector id. */
  destinationIds: Record<string, string> = {},
): Promise<MultiKindSearch> {
  const [flightRes, hotelRes] = await Promise.all([
    runSearch(bindings, { ...baseQuery, kind: "flight" }, Date.now, timeoutMs, destinationIds),
    runSearch(bindings, { ...baseQuery, kind: "hotel" }, Date.now, timeoutMs, destinationIds),
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
  timeoutMs: number = DEFAULT_CONNECTOR_TIMEOUT_MS,
): Promise<RevalidationOutcome> {
  const lines: RevalidationLine[] = [];

  for (const offer of selectedOffers) {
    const b = bindingsById.get(offer.connectorId);
    if (!b || !b.connector.capabilities.supports.revalidate || !offer.revalidationToken) {
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: false, priceChanged: false, unverifiable: true, message: "connector cannot revalidate this offer" });
      continue;
    }
    try {
      const r = await withTimeout(
        Promise.resolve(b.connector.revalidate(b.creds, offer.revalidationToken)),
        timeoutMs,
        b.connector.id,
      );
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: r.stillAvailable, priceChanged: !!r.priceChanged, message: r.message });
    } catch (e) {
      // A timeout/error is NOT treated as "unavailable" data — it's unverifiable.
      lines.push({ offerId: offer.offerId, connectorId: offer.connectorId, stillAvailable: false, priceChanged: false, unverifiable: true, message: String((e as Error)?.message ?? e) });
    }
  }

  const quoteStillValid = lines.length > 0 && lines.every((l) => l.stillAvailable && !l.unverifiable);
  return { quoteStillValid, anyPriceChanged: lines.some((l) => l.priceChanged), lines, revalidatedAt: now };
}
