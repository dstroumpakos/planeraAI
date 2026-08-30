/**
 * Planera for Travel Agencies — tenant data model (Convex tables).
 *
 * Exported as a plain map of table definitions and SPREAD into the root
 * `defineSchema(...)` in `convex/schema.ts` (one additive line). Every table is
 * agency-scoped and prefixed to avoid any collision with existing tables.
 *
 * Multi-tenancy invariant: every row carries `agencyId`, and every query/mutation
 * resolves `agencyId` from the caller's session — NEVER from client input.
 *
 * Secrets: `supplierConnections.encryptedCredentials` holds ONLY a vault envelope
 * (see `vault.ts`). Plaintext credentials are never stored, logged, or returned.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agencyRole = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("agent"),
  v.literal("viewer"),
);

export const agencyTables = {
  // The tenant.
  agencies: defineTable({
    name: v.string(),
    slug: v.string(), // unique, url-safe
    status: v.union(v.literal("active"), v.literal("suspended")),
    defaultCurrency: v.string(), // ISO 4217, e.g. "EUR"
    // White-label branding for customer-facing quotes (proposals to approve, not final).
    branding: v.optional(v.object({
      logoStorageId: v.optional(v.id("_storage")),
      primaryColor: v.optional(v.string()),
      legalName: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
    })),
    /** Tenant override for how long a new quote stays valid (ms). */
    quoteTtlMs: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.optional(v.float64()),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  // Auth identity for an agency staff user (separate from consumer `users`).
  // PBKDF2-hashed password, same scheme as the partner portal.
  agencyUsers: defineTable({
    email: v.string(), // lowercased, unique login
    passwordHash: v.optional(v.string()),
    passwordSalt: v.optional(v.string()),
    status: v.union(
      v.literal("invited"),
      v.literal("active"),
      v.literal("disabled"),
    ),
    inviteTokenHash: v.optional(v.string()),
    inviteExpiresAt: v.optional(v.float64()),
    // MFA (TOTP) — ready but optional in MVP.
    mfaSecretEnvelope: v.optional(v.string()), // vault-sealed TOTP secret
    mfaEnabled: v.optional(v.boolean()),
    /** Last accepted TOTP counter step — blocks replay of the same code. */
    mfaLastUsedStep: v.optional(v.float64()),
    /** SHA-256 hashes of single-use recovery codes (raw codes shown once). */
    mfaRecoveryHashes: v.optional(v.array(v.string())),
    lastLoginAt: v.optional(v.float64()),
    passwordUpdatedAt: v.optional(v.float64()),
    /**
     * Global session cut-off: every session issued before this instant is dead.
     * Bumped on password change, MFA change, and "sign out everywhere".
     */
    sessionsValidFrom: v.optional(v.float64()),
    createdAt: v.float64(),
  })
    .index("by_email", ["email"])
    .index("by_inviteTokenHash", ["inviteTokenHash"]),

  // Membership: which user belongs to which agency, with what role.
  agencyMembers: defineTable({
    agencyId: v.id("agencies"),
    userId: v.id("agencyUsers"),
    role: agencyRole,
    displayName: v.optional(v.string()),
    createdAt: v.float64(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_user", ["userId"])
    .index("by_agency_user", ["agencyId", "userId"]),

  // Hashed session tokens (raw token lives only in the browser).
  agencySessions: defineTable({
    userId: v.id("agencyUsers"),
    agencyId: v.id("agencies"),
    tokenHash: v.string(),
    createdAt: v.float64(),
    expiresAt: v.float64(),
    // True only after a second factor is satisfied (when MFA is enabled).
    mfaSatisfied: v.optional(v.boolean()),
    /** Touched on use; drives the idle timeout independently of the hard expiry. */
    lastSeenAt: v.optional(v.float64()),
    revokedAt: v.optional(v.float64()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // BYOK supplier connection. Credentials are stored ONLY as a vault envelope.
  supplierConnections: defineTable({
    agencyId: v.id("agencies"),
    connectorId: v.string(), // must exist & be enabled in the connector registry
    environment: v.union(v.literal("sandbox"), v.literal("production")),
    credentialScheme: v.union(
      v.literal("api_key"),
      v.literal("oauth2_client_credentials"),
      v.literal("pcc_office_id"),
      v.literal("affiliate_id"),
    ),
    encryptedCredentials: v.string(), // vault envelope — NEVER plaintext
    // Non-secret display hint (e.g. "pk_live_AbC1…", "PCC 1A2B"). Never the secret.
    displayHint: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("disabled"),
      v.literal("error"),
    ),
    lastHealthCheckAt: v.optional(v.float64()),
    lastHealthOk: v.optional(v.boolean()),
    createdByUserId: v.id("agencyUsers"),
    createdAt: v.float64(),
    updatedAt: v.optional(v.float64()),
    revokedAt: v.optional(v.float64()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_connector", ["agencyId", "connectorId"]),

  // Pricing rules, scoped. Resolution order (most specific wins): package >
  // product > destination > supplier > agency-default.
  agencyPricingRules: defineTable({
    agencyId: v.id("agencies"),
    scope: v.union(
      v.literal("agency"),
      v.literal("supplier"),
      v.literal("destination"),
      v.literal("product"),
      v.literal("package"),
    ),
    // Scope selector (null for agency-default). e.g. connectorId / IATA / tier.
    selector: v.optional(v.string()),
    // Serialized `PricingRule` (see pricing.ts). `any` — evolves faster than schema.
    rule: v.any(),
    active: v.boolean(),
    createdAt: v.float64(),
    updatedAt: v.optional(v.float64()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_scope", ["agencyId", "scope"]),

  // The quote resource. Doubles as the record revalidation + expiry act on.
  quotes: defineTable({
    quoteId: v.string(), // public id, e.g. "qte_..."
    agencyId: v.id("agencies"),
    createdByUserId: v.id("agencyUsers"),
    currency: v.string(),
    // Snapshot of the search inputs (origin/destination/dates/pax/prefs).
    searchParams: v.any(),
    // The three built packages (Basic/Comfort/Premium) — shape from model/types.ts.
    packages: v.any(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revalidating"),
    ),
    searchedAt: v.float64(),
    lastRevalidatedAt: v.optional(v.float64()),
    expiresAt: v.float64(),
    // Customer-facing secure link: only the HASH is stored.
    customerLinkTokenHash: v.optional(v.string()),
    customerLinkExpiresAt: v.optional(v.float64()),
    /** Per-connector search outcome (ok/skipped/error) — agent-facing diagnostics. */
    diagnostics: v.optional(v.any()),
    /** Result of the most recent revalidation pass. */
    revalidation: v.optional(v.any()),
    /** Hash of the search inputs — makes a repeated search idempotent. */
    searchHash: v.optional(v.string()),
    sentAt: v.optional(v.float64()),
    acceptedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.optional(v.float64()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_quoteId", ["quoteId"])
    .index("by_customerLinkTokenHash", ["customerLinkTokenHash"])
    .index("by_agency_status", ["agencyId", "status"])
    .index("by_agency_searchHash", ["agencyId", "searchHash"]),

  // Resolved destination ids, per tenant.
  //
  // Hotel/activity/ferry suppliers key off their own destination taxonomies, so
  // an IATA code has to be translated into each provider's id before a search
  // can be built. Resolving means pulling that provider's locations feed, which
  // is slow and large, so the ANSWER is cached here and the feed is fetched at
  // most once per destination.
  //
  // Deliberately scoped per agency, even though the mapping itself contains no
  // tenant data. A shared cache would let one agency's bad resolution silently
  // redirect another agency's searches, and it would spend one agency's API
  // quota on everyone else's lookups. Per-tenant costs a little more and cannot
  // do either.
  //
  // Failures are cached too (`status: "unresolved"`), so a destination the
  // provider simply does not cover stops re-fetching a 10k-row feed on every
  // single search.
  agencyDestinationMappings: defineTable({
    agencyId: v.id("agencies"),
    connectorId: v.string(),
    /** Uppercase IATA — the canonical key we resolve from. */
    iata: v.string(),
    status: v.union(v.literal("resolved"), v.literal("unresolved")),
    /** The provider's own id. Empty when unresolved. */
    destinationId: v.string(),
    destinationName: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    /** "feed" = matched from the provider; "manual" = pinned by a human. */
    source: v.union(v.literal("feed"), v.literal("manual")),
    /** 0..1 from the matcher. Absent for manual pins, which are certain. */
    confidence: v.optional(v.float64()),
    /** Why this won, or why nothing did — shown to whoever fixes it. */
    reason: v.optional(v.string()),
    /** Runners-up, so a human can pin the right one without re-running a feed. */
    alternatives: v.optional(v.any()),
    resolvedAt: v.float64(),
    updatedAt: v.optional(v.float64()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_connector_iata", ["agencyId", "connectorId", "iata"]),

  // Fixed-window rate-limit + login-lockout counters. One row per key
  // ("login:<email>", "search:<agencyId>", "publicQuote:<tokenPrefix>"…). Keys
  // that embed an identity are HASHED so this table never becomes a user list.
  agencyRateLimits: defineTable({
    key: v.string(),
    windowStartAt: v.float64(),
    count: v.float64(),
    blockedUntil: v.optional(v.float64()),
    failures: v.optional(v.float64()),
    updatedAt: v.float64(),
  }).index("by_key", ["key"]),

  // Append-only audit trail. Metadata is redacted (never secrets/credentials).
  agencyAuditLog: defineTable({
    agencyId: v.id("agencies"),
    actorUserId: v.optional(v.id("agencyUsers")),
    action: v.string(), // e.g. "connection.create", "quote.send", "auth.login"
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    meta: v.optional(v.any()), // redacted, non-secret context
    ip: v.optional(v.string()),
    at: v.float64(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_action", ["agencyId", "action"]),
};
