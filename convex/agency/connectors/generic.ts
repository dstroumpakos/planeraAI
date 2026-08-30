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

export interface SearchSpec {
  kinds: Array<NormalizedOffer["kind"]>;
  /** Set when the provider keys off its own destination taxonomy. */
  requiresDestinationId?: boolean;
  /** Build the HTTP call for a search, or return null to decline this query. */
  request: (
    creds: SupplierCredentials,
    query: SearchQuery,
    host: string,
  ) => { method: "GET" | "POST"; url: string; body?: unknown } | null;
  /** Map the provider payload onto the canonical model. */
  map: (payload: unknown, query: SearchQuery) => NormalizedOffer[];
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
  const base: Record<string, string> = { Accept: "application/json" };

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
        revalidate: false,
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
      if (!spec.search) return notReady();
      if (!spec.search.kinds.includes(query.kind)) return [];

      const host = resolveHost(spec, creds);
      const built = spec.search.request(creds, query, host);
      // A connector may decline a query it cannot express (e.g. no IATA code).
      if (!built) return [];

      const headers = await authHeaders(spec, creds, host);
      if (built.body !== undefined) headers["Content-Type"] = "application/json";

      const payload = await fetchJson<unknown>(
        built.url,
        {
          method: built.method,
          headers,
          ...(built.body !== undefined ? { body: JSON.stringify(built.body) } : {}),
        },
        { connectorId: spec.id, timeoutMs: spec.timeoutMs ?? 11_000, retries: 1 },
      );

      try {
        return spec.search.map(payload, query);
      } catch (e) {
        throw new SupplierHttpError(
          0,
          spec.id,
          `could not read ${spec.displayName}'s response: ${(e as Error).message}`.slice(0, 300),
        );
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

    async revalidate(): Promise<RevalidateResult> {
      // Never claim a price is still good on a provider we cannot re-price.
      // The orchestrator treats this as "unverifiable", which is the truth.
      throw new SupplierHttpError(
        0,
        spec.id,
        `${spec.displayName} cannot re-price an offer yet — confirm it manually before booking`,
      );
    },
  };
}
