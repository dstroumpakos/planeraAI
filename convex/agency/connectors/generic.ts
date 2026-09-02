/**
 * Spec-driven REST connector.
 *
 * Every supplier here speaks HTTP with one of a handful of auth schemes; what
 * genuinely differs is the host, the paths, and the shape of the search
 * response. Declaring that as data and generating the connector keeps twelve
 * integrations honest and comparable, instead of twelve hand-rolled files that
 * drift apart.
 *
 * The important design decision is what happens when a provider's SEARCH
 * contract is not publicly documented. Such a connector still gets built, still
 * authenticates, and its health check still calls the provider for real — but
 * `search` throws a precise "spec not confirmed" error rather than posting an
 * invented payload. A guessed request shape sent to a live endpoint with an
 * agency's real credentials is worse than an honest failure: it looks like it
 * works right up until it quietly returns nothing, or books the wrong thing.
 */

import type { NormalizedOffer } from "../model/types";
import type { DestinationCandidate, DestinationTarget } from "../destinations";
import {
  expediaEanAuthHeader,
  getOAuth2Token,
  hostFor,
  hotelbedsSignature,
  invalidateOAuth2Token,
  requireField,
  type OAuth2Config,
} from "./auth";
import { fetchJson, SupplierHttpError } from "./http";
import type {
  HealthStatus,
  RevalidateResult,
  SearchQuery,
  SupplierConnector,
  SupplierCredentials,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Spec
// ─────────────────────────────────────────────────────────────────────────────

export type AuthSpec =
  /** `Authorization: Bearer <apiKey>` (+ optional extra static headers). */
  | { kind: "bearer"; field?: string; extraHeaders?: (c: SupplierCredentials) => Record<string, string> }
  /** A provider-named header carrying the key verbatim, e.g. Viator's exp-api-key. */
  | { kind: "apiKeyHeader"; header: string; field?: string; prefix?: string }
  /**
   * OAuth2 client_credentials; token is fetched and cached by `auth.ts`.
   * `tokenHosts` exists because a provider's token service is not always on its
   * API host — Travelport issues tokens from oauth.travelport.com while its
   * APIs live elsewhere, and building the token URL from the API host gets a
   * 404 that looks like a credential problem.
   */
  | {
      kind: "oauth2";
      tokenPath: string;
      style: "body" | "basic";
      extraForm?: Record<string, string>;
      tokenHosts?: { sandbox: string; production: string };
    }
  /** HBX / Hotelbeds: Api-key header + per-request SHA-256 X-Signature. */
  | { kind: "hotelbedsSignature" }
  /** Expedia Rapid: `Authorization: EAN APIKey=..,Signature=..,timestamp=..`. */
  | { kind: "expediaEan" };

export interface HealthSpec {
  method: "GET" | "POST";
  /**
   * Empty string means "the auth handshake is the probe". For an OAuth2
   * provider that is a genuine, complete round-trip to their token endpoint —
   * the credentials are proven — and it avoids inventing a read-only endpoint
   * just to have something to call. For a static-header provider it proves
   * nothing, and `healthCheck` says so rather than reporting a false pass.
   */
  path: string;
  /** Body for POST health probes (e.g. a trivial GraphQL query). */
  body?: unknown;
}

export interface HttpCall {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}

/**
 * A call made BEFORE the search, because some providers cannot be asked "what
 * is available in this city" at all.
 *
 * Expedia Rapid is the clearest case: its availability endpoint takes a list of
 * PROPERTY ids and has no notion of a region, so the region has to be expanded
 * into properties first. Modelling that as a declared first step keeps it in
 * the same tested engine as every other connector, rather than forcing a
 * hand-written file for each provider whose contract needs two round trips.
 */
export interface PrepareSpec {
  request: (creds: SupplierCredentials, query: SearchQuery, host: string) => HttpCall | null;
  /** Whatever `request`/`map` need downstream; return null to decline the search. */
  map: (payload: unknown, query: SearchQuery) => unknown | null;
  timeoutMs?: number;
}

/**
 * A call made AFTER the search, for fields the availability response omits.
 *
 * Expedia Rapid and Booking.com both answer a price query with ids and rates
 * and no human-readable name — the name lives in a separate content endpoint.
 * A quote needs the name, so it is fetched here.
 *
 * Enrichment is best-effort BY DESIGN: if it fails, the offers still stand with
 * whatever the search itself returned. Losing a whole set of real prices
 * because a cosmetic lookup timed out would be the worse outcome.
 */
export interface EnrichSpec {
  request: (
    creds: SupplierCredentials,
    query: SearchQuery,
    host: string,
    offers: NormalizedOffer[],
  ) => HttpCall | null;
  apply: (payload: unknown, offers: NormalizedOffer[]) => NormalizedOffer[];
  timeoutMs?: number;
}

export interface SearchSpec {
  kinds: Array<NormalizedOffer["kind"]>;
  /** Set when the provider keys off its own destination taxonomy. */
  requiresDestinationId?: boolean;
  /** Optional first round trip; its result is passed to `request` and `map`. */
  prepare?: PrepareSpec;
  /** Build the HTTP call for a search, or return null to decline this query. */
  request: (
    creds: SupplierCredentials,
    query: SearchQuery,
    host: string,
    prepared: unknown,
  ) => HttpCall | null;
  /** Map the provider payload onto the canonical model. */
  map: (payload: unknown, query: SearchQuery, prepared: unknown) => NormalizedOffer[];
  /** Optional follow-up round trip that fills in what the search left out. */
  enrich?: EnrichSpec;
}

/**
 * How to re-price one offer by its provider-locked token.
 *
 * This is the ONLY source of a bookable price, so a connector declares it only
 * when the provider's re-price contract is confirmed. Everything else keeps
 * `makeConnector`'s default, which refuses rather than implying a search price
 * is guaranteed.
 */
export interface RevalidateSpec {
  request: (creds: SupplierCredentials, token: string, host: string) => HttpCall;
  map: (payload: unknown, token: string) => RevalidateResult;
  timeoutMs?: number;
}

/**
 * How to ask a provider's locations feed for destination candidates. Present
 * only where that feed is publicly documented; everything else is mapped by
 * hand, which the resolution layer supports for every provider.
 */
export interface DestinationSpec {
  request: (
    creds: SupplierCredentials,
    target: DestinationTarget,
    host: string,
  ) => { method: "GET" | "POST"; url: string; body?: unknown };
  map: (payload: unknown, target: DestinationTarget) => DestinationCandidate[];
  /** Feeds are large; give them longer than a search. */
  timeoutMs?: number;
}

export interface ConnectorSpec {
  id: string;
  displayName: string;
  kinds: Array<NormalizedOffer["kind"]>;
  hosts: { sandbox: string; production: string };
  auth: AuthSpec;
  health: HealthSpec;
  destinations?: DestinationSpec;
  /** Absent when the provider's search contract is not publicly documented. */
  search?: SearchSpec;
  /** Absent unless the provider's re-price contract is confirmed. */
  revalidate?: RevalidateSpec;
  /**
   * Static headers this provider requires on every call beyond authentication —
   * an API version it pins behaviour to, or a caller identity it mandates.
   * Getting these wrong is not a subtle failure: Viator serves a different
   * response schema per `Accept` version, so omitting it silently changes the
   * shape we parse.
   */
  headers?: (creds: SupplierCredentials) => Record<string, string>;
  /**
   * What still has to be confirmed with the provider before `search` can be
   * written. Required whenever `search` is absent — it is the message an agency
   * and the ops team actually see.
   */
  pendingReason?: string;
  /**
   * Credential field holding a per-tenant API host, replacing `hosts` entirely.
   * Needed where a provider issues endpoints per contract rather than running
   * one public host — Amadeus since its Self-Service platform was retired.
   */
  hostField?: string;
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth application
// ─────────────────────────────────────────────────────────────────────────────

async function authHeaders(
  spec: ConnectorSpec,
  creds: SupplierCredentials,
  host: string,
): Promise<Record<string, string>> {
  // Spec headers are applied UNDER the auth headers so a provider can pin its
  // own Accept version, but can never overwrite the Authorization we computed.
  const base: Record<string, string> = {
    Accept: "application/json",
    ...(spec.headers?.(creds) ?? {}),
  };

  switch (spec.auth.kind) {
    case "bearer": {
      const key = requireField(creds, spec.auth.field ?? "apiKey", spec.id);
      return {
        ...base,
        Authorization: `Bearer ${key}`,
        ...(spec.auth.extraHeaders?.(creds) ?? {}),
      };
    }
    case "apiKeyHeader": {
      const key = requireField(creds, spec.auth.field ?? "apiKey", spec.id);
      return { ...base, [spec.auth.header]: `${spec.auth.prefix ?? ""}${key}` };
    }
    case "oauth2": {
      const token = await getOAuth2Token(oauthConfig(spec, creds, host));
      return { ...base, Authorization: `Bearer ${token}` };
    }
    case "hotelbedsSignature": {
      const apiKey = requireField(creds, "apiKey", spec.id);
      const secret = requireField(creds, "secret", spec.id);
      return {
        ...base,
        "Api-key": apiKey,
        "X-Signature": await hotelbedsSignature(apiKey, secret),
      };
    }
    case "expediaEan": {
      const apiKey = requireField(creds, "apiKey", spec.id);
      const secret = requireField(creds, "secret", spec.id);
      return { ...base, Authorization: await expediaEanAuthHeader(apiKey, secret) };
    }
  }
}

/** A plain https origin: scheme, host, optional port, optional trailing slash. */
const HOST_RE = /^https:\/\/[a-zA-Z0-9.-]+(:\d+)?\/?$/;

/**
 * The host to call. A per-tenant `hostField` wins over the built-in pair: some
 * providers issue an endpoint per contract rather than running one public host,
 * so there is nothing sensible to default to. The value is validated here
 * rather than trusted — it arrives as an agency-entered credential field, and
 * an unchecked one would let a connection point our requests, carrying that
 * agency's own supplier credentials, at any host at all.
 */
function resolveHost(spec: ConnectorSpec, creds: SupplierCredentials): string {
  if (!spec.hostField) return hostFor(creds, spec.hosts);

  const raw = creds.fields?.[spec.hostField]?.trim();
  if (!raw) {
    throw new SupplierHttpError(
      0,
      spec.id,
      `this connection is missing its "${spec.hostField}" — ${spec.displayName} issues an API host with your contract`,
    );
  }
  if (!HOST_RE.test(raw)) {
    throw new SupplierHttpError(
      0,
      spec.id,
      "the API host must be a plain https origin, e.g. https://api.example.com",
    );
  }
  return raw.replace(/\/+$/, "");
}

function oauthConfig(
  spec: ConnectorSpec,
  creds: SupplierCredentials,
  host: string,
): OAuth2Config {
  if (spec.auth.kind !== "oauth2") throw new Error("not an oauth2 connector");
  // The token service is not always on the API host.
  const tokenHost = spec.auth.tokenHosts ? hostFor(creds, spec.auth.tokenHosts) : host;
  return {
    connectorId: spec.id,
    tokenUrl: `${tokenHost}${spec.auth.tokenPath}`,
    clientId: requireField(creds, "clientId", spec.id),
    clientSecret: requireField(creds, "clientSecret", spec.id),
    style: spec.auth.style,
    extraForm: spec.auth.extraForm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health interpretation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate an HTTP status on the health probe into a verdict.
 *
 * The subtle case is 400/422: the provider parsed and ACCEPTED our credentials
 * and then rejected our parameters. For a health check — whose only question is
 * "do these credentials work" — that is a pass, and reporting it as a failure
 * would send agencies chasing a key that is perfectly fine. A 404 is different:
 * it means the path is wrong, which is our bug, not theirs.
 */
function verdictFor(status: number, connectorId: string): HealthStatus["message"] | null {
  if (status === 401 || status === 403) return "the supplier rejected these credentials";
  if (status === 404) return `${connectorId}: endpoint not found — the integration path needs confirming`;
  if (status === 429) return "the supplier is rate-limiting this account right now";
  if (status >= 500) return "the supplier is currently unavailable";
  return null;
}

const AUTH_OK_BUT_BAD_PARAMS = new Set([400, 422]);

// ─────────────────────────────────────────────────────────────────────────────
// Calling
// ─────────────────────────────────────────────────────────────────────────────

/** One authenticated round trip to a provider, as described by an `HttpCall`. */
async function callProvider(
  spec: ConnectorSpec,
  creds: SupplierCredentials,
  host: string,
  call: HttpCall,
  timeoutMs: number,
  maxBytes?: number,
): Promise<unknown> {
  const headers = await authHeaders(spec, creds, host);
  if (call.body !== undefined) headers["Content-Type"] = "application/json";

  return fetchJson<unknown>(
    call.url,
    {
      method: call.method,
      headers,
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
    },
    { connectorId: spec.id, timeoutMs, retries: 1, ...(maxBytes ? { maxBytes } : {}) },
  );
}

/**
 * Run a mapper, turning any parse failure into a connector-attributed error.
 * Without this a provider changing its response shape surfaces as an opaque
 * "cannot read property of undefined" with no hint of which supplier broke.
 */
function readPayload<T>(spec: ConnectorSpec, map: () => T): T {
  try {
    return map();
  } catch (e) {
    throw new SupplierHttpError(
      0,
      spec.id,
      `could not read ${spec.displayName}'s response: ${(e as Error).message}`.slice(0, 300),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function makeConnector(spec: ConnectorSpec): SupplierConnector {
  const canSearch = !!spec.search;

  const notReady = (): never => {
    throw new SupplierHttpError(
      0,
      spec.id,
      `${spec.displayName} is connected but not yet searchable — ${
        spec.pendingReason ?? "its search contract has not been confirmed"
      }`,
    );
  };

  return {
    id: spec.id,
    displayName: spec.displayName,
    capabilities: {
      kinds: spec.kinds,
      requiresDestinationId: !!spec.search?.requiresDestinationId,
      supports: {
        search: canSearch,
        retrieveOffer: false,
        // Revalidation is per-provider work that has to follow a working
        // search; declaring it before it exists would let the orchestrator
        // present unverified prices as confirmed.
        revalidate: !!spec.revalidate,
        createBooking: false,
        retrieveBooking: false,
        cancelBooking: false,
        getCancellationTerms: false,
        healthCheck: true,
      },
    },

    async healthCheck(creds: SupplierCredentials): Promise<HealthStatus> {
      const started = Date.now();
      // `host` is resolved INSIDE the try: a connection missing or malforming
      // its per-contract host must come back as an unhealthy verdict the agent
      // can read, not as a thrown error. A health check that throws is the one
      // thing this method must never do.
      let host: string | null = null;
      try {
        host = resolveHost(spec, creds);
        const headers = await authHeaders(spec, creds, host);

        if (spec.health.path === "") {
          // Handshake-only probe.
          if (spec.auth.kind === "oauth2") {
            // `authHeaders` just completed a real token exchange against the
            // provider — the credentials are proven end to end.
            return {
              healthy: true,
              environment: creds.environment,
              latencyMs: Date.now() - started,
              message: canSearch ? "credentials accepted" : spec.pendingReason,
            };
          }
          // A static header proves nothing without a call. Say so plainly.
          return {
            healthy: false,
            environment: creds.environment,
            message:
              spec.pendingReason ??
              `${spec.displayName} has no confirmed endpoint to verify against yet`,
          };
        }

        if (spec.health.body !== undefined) headers["Content-Type"] = "application/json";

        await fetchJson<unknown>(
          `${host}${spec.health.path}`,
          {
            method: spec.health.method,
            headers,
            ...(spec.health.body !== undefined
              ? { body: JSON.stringify(spec.health.body) }
              : {}),
          },
          { connectorId: spec.id, timeoutMs: spec.timeoutMs ?? 9000, retries: 1 },
        );

        return {
          healthy: true,
          environment: creds.environment,
          latencyMs: Date.now() - started,
          message: canSearch ? undefined : spec.pendingReason,
        };
      } catch (e) {
        const err = e as SupplierHttpError;

        if (AUTH_OK_BUT_BAD_PARAMS.has(err.status)) {
          return {
            healthy: true,
            environment: creds.environment,
            latencyMs: Date.now() - started,
            message: "credentials accepted",
          };
        }

        if ((err.status === 401 || err.status === 403) && host !== null) {
          // Force a fresh token next time — a cached one may simply have gone stale.
          if (spec.auth.kind === "oauth2") {
            try {
              await invalidateOAuth2Token(oauthConfig(spec, creds, host));
            } catch {
              /* the credentials were incomplete; the message below still applies */
            }
          }
        }

        return {
          healthy: false,
          environment: creds.environment,
          latencyMs: Date.now() - started,
          message:
            verdictFor(err.status, spec.id) ??
            String(err.message ?? "the supplier could not be reached").slice(0, 300),
        };
      }
    },

    async search(creds: SupplierCredentials, query: SearchQuery): Promise<NormalizedOffer[]> {
      const searchSpec = spec.search;
      if (!searchSpec) return notReady();
      if (!searchSpec.kinds.includes(query.kind)) return [];

      const host = resolveHost(spec, creds);

      // ── Step 1 (optional): expand the query into whatever the search needs ──
      let prepared: unknown = undefined;
      if (searchSpec.prepare) {
        const preCall = searchSpec.prepare.request(creds, query, host);
        if (!preCall) return [];
        const prePayload = await callProvider(
          spec,
          creds,
          host,
          preCall,
          searchSpec.prepare.timeoutMs ?? spec.timeoutMs ?? 11_000,
        );
        prepared = readPayload(spec, () => searchSpec.prepare!.map(prePayload, query));
        // A provider that knows nothing about this destination is not an error.
        if (prepared === null || prepared === undefined) return [];
      }

      // ── Step 2: the search itself ──
      const built = searchSpec.request(creds, query, host, prepared);
      // A connector may decline a query it cannot express (e.g. no IATA code).
      if (!built) return [];

      const payload = await callProvider(
        spec,
        creds,
        host,
        built,
        spec.timeoutMs ?? 11_000,
      );
      const offers = readPayload(spec, () => searchSpec.map(payload, query, prepared));

      // ── Step 3 (optional): fill in what the availability response omits ──
      if (!searchSpec.enrich || offers.length === 0) return offers;
      try {
        const enrichCall = searchSpec.enrich.request(creds, query, host, offers);
        if (!enrichCall) return offers;
        const enrichPayload = await callProvider(
          spec,
          creds,
          host,
          enrichCall,
          searchSpec.enrich.timeoutMs ?? spec.timeoutMs ?? 11_000,
        );
        return searchSpec.enrich.apply(enrichPayload, offers);
      } catch (e) {
        // Best-effort by design: real prices survive a failed cosmetic lookup.
        console.error(`[agency:${spec.id}] enrichment failed:`, (e as Error).message);
        return offers;
      }
    },

    // Only present when the provider publishes a locations feed. The optional
    // method is what the resolver checks to decide between asking the provider
    // and requiring a hand-made mapping.
    ...(spec.destinations
      ? {
          async listDestinations(
            creds: SupplierCredentials,
            target: DestinationTarget,
          ): Promise<DestinationCandidate[]> {
            const host = resolveHost(spec, creds);
            const built = spec.destinations!.request(creds, target, host);
            const headers = await authHeaders(spec, creds, host);
            if (built.body !== undefined) headers["Content-Type"] = "application/json";

            const payload = await fetchJson<unknown>(
              built.url,
              {
                method: built.method,
                headers,
                ...(built.body !== undefined ? { body: JSON.stringify(built.body) } : {}),
              },
              {
                connectorId: spec.id,
                // Locations feeds are big, and this runs once per destination
                // and is then cached, so it can afford to be patient.
                timeoutMs: spec.destinations!.timeoutMs ?? 20_000,
                retries: 1,
                maxBytes: 24 * 1024 * 1024,
              },
            );

            try {
              return spec.destinations!.map(payload, target);
            } catch (e) {
              throw new SupplierHttpError(
                0,
                spec.id,
                `could not read ${spec.displayName}'s destination feed: ${(e as Error).message}`.slice(
                  0,
                  300,
                ),
              );
            }
          },
        }
      : {}),

    async revalidate(
      creds: SupplierCredentials,
      revalidationToken: string,
    ): Promise<RevalidateResult> {
      if (!spec.revalidate) {
        // Never claim a price is still good on a provider we cannot re-price.
        // The orchestrator treats this as "unverifiable", which is the truth.
        throw new SupplierHttpError(
          0,
          spec.id,
          `${spec.displayName} cannot re-price an offer yet — confirm it manually before booking`,
        );
      }

      const host = resolveHost(spec, creds);
      // Building the call can itself fail — Amadeus parses the offer back out
      // of the token — and a corrupt token must read as a connector error, not
      // as an unhandled SyntaxError from deep inside a quote refresh.
      const call = readPayload(spec, () => spec.revalidate!.request(creds, revalidationToken, host));
      const payload = await callProvider(
        spec,
        creds,
        host,
        call,
        spec.revalidate.timeoutMs ?? spec.timeoutMs ?? 11_000,
      );
      return readPayload(spec, () => spec.revalidate!.map(payload, revalidationToken));
    },
  };
}
