/**
 * Planera for Travel Agencies — BYOK supplier connections.
 *
 * An agency pastes its OWN supplier credentials; we seal them with the vault
 * and use them only to search on that agency's behalf. Planera never holds a
 * supplier contract on the agency's behalf and never becomes the seller.
 *
 * Secret discipline:
 *  - plaintext credentials exist only inside `create`/`rotate` (long enough to
 *    seal) and inside the health-check action (long enough for one call),
 *  - `encryptedCredentials` is stripped from EVERY client-facing response by
 *    `redactConnection`,
 *  - the only thing the UI ever sees is a last-4 style `displayHint`.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { sealConnection, redactConnection, validateConnectionInput } from "./connectionService";
import { getConnector, isConnectable, isImplemented, isSearchable, pendingReason } from "./connectors/factory";
import { CONNECTOR_REGISTRY, getRegistryEntry } from "./connectors/registry";
import type { CredentialScheme, SupplierCredentials } from "./connectors/types";
import { AgencyError, conflict, guard, invalid, notFound } from "./errors";
import {
  assertTenant,
  audit,
  consumeLimit,
  requireAccess,
  requireAccessRW,
  vaultMasterKey,
} from "./store";
import { normalizeCredentialFields } from "./validation";
import { openJson } from "./vault";

const credentialScheme = v.union(
  v.literal("api_key"),
  v.literal("oauth2_client_credentials"),
  v.literal("pcc_office_id"),
  v.literal("affiliate_id"),
);

const environment = v.union(v.literal("sandbox"), v.literal("production"));

// ── Catalogue ───────────────────────────────────────────────────────────────

/**
 * The providers this agency can connect, with the honest state of each. A
 * provider that is commercially approved but not yet coded shows as
 * `connectable: false` rather than being hidden — the agency can see what is
 * coming.
 */
export const available = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("connections.available", async () => {
      const access = await requireAccess(ctx, args.token);
      const existing = await ctx.db
        .query("supplierConnections")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .collect();
      const connected = new Set(existing.filter((c) => !c.revokedAt).map((c) => c.connectorId));

      return CONNECTOR_REGISTRY.filter((e) => e.enabled).map((e) => ({
        connectorId: e.id,
        displayName: e.displayName,
        category: e.category,
        kinds: e.kinds,
        credentialScheme: e.credentialScheme,
        // The form is driven by this, so a provider needing a key AND a secret
        // cannot be half-connected.
        credentialFields: e.credentialFields,
        status: e.status,
        requiresCertification: e.requiresCertification,
        docsUrl: e.docsUrl ?? null,
        notes: e.notes ?? null,
        implemented: isImplemented(e.id),
        connectable: isConnectable(e.id),
        // Connecting a provider that only authenticates is still useful — it
        // proves the credentials — but the UI must not imply searches will
        // include it.
        searchable: isSearchable(e.id),
        pendingReason: pendingReason(e.id),
        alreadyConnected: connected.has(e.id),
      }));
    }),
});

// ── Read ────────────────────────────────────────────────────────────────────

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("connections.list", async () => {
      const access = await requireAccess(ctx, args.token);
      const rows = await ctx.db
        .query("supplierConnections")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .collect();
      return rows
        .filter((r) => !r.revokedAt)
        .map((r) => ({
          ...redactConnection(r),
          displayName: getRegistryEntry(r.connectorId)?.displayName ?? r.connectorId,
          implemented: isImplemented(r.connectorId),
          searchable: isSearchable(r.connectorId),
          pendingReason: pendingReason(r.connectorId),
        }));
    }),
});

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Store a supplier credential.
 *
 * NOTE: the raw credential travels as a mutation argument. That is the only way
 * it can reach the server, and it is sealed before anything is persisted — but
 * it does mean this function's arguments must never be echoed into a log line.
 * Nothing here logs `args`.
 */
export const create = mutation({
  args: {
    token: v.string(),
    connectorId: v.string(),
    environment,
    credentialScheme,
    fields: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) =>
    guard("connections.create", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      await consumeLimit(ctx, "connectionWrite", access.agencyId);

      if (!isConnectable(args.connectorId)) {
        throw invalid("this supplier cannot be connected yet");
      }
      const fields = normalizeCredentialFields(args.fields);
      const input = {
        connectorId: args.connectorId,
        environment: args.environment,
        credentialScheme: args.credentialScheme as CredentialScheme,
        fields,
      };
      validateConnectionInput(input);

      const duplicate = await ctx.db
        .query("supplierConnections")
        .withIndex("by_agency_connector", (q) =>
          q.eq("agencyId", access.agencyId).eq("connectorId", args.connectorId),
        )
        .filter((q) => q.eq(q.field("revokedAt"), undefined))
        .first();
      if (duplicate) throw conflict("this supplier is already connected — rotate its key instead");

      const sealed = await sealConnection(vaultMasterKey(), input);
      const now = Date.now();
      const connectionId = await ctx.db.insert("supplierConnections", {
        agencyId: access.agencyId,
        connectorId: sealed.connectorId,
        environment: sealed.environment,
        credentialScheme: sealed.credentialScheme,
        encryptedCredentials: sealed.encryptedCredentials,
        displayHint: sealed.displayHint,
        status: "active",
        createdByUserId: access.userId,
        createdAt: now,
      });

      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "connection.create",
        targetType: "supplierConnection",
        targetId: connectionId,
        meta: { connectorId: args.connectorId, environment: args.environment },
      });

      const row = await ctx.db.get(connectionId);
      return redactConnection(row!);
    }),
});

/** Replace the stored credential in place, keeping the connection's identity. */
export const rotate = mutation({
  args: {
    token: v.string(),
    connectionId: v.id("supplierConnections"),
    fields: v.record(v.string(), v.string()),
    environment: v.optional(environment),
  },
  handler: async (ctx, args) =>
    guard("connections.rotate", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      await consumeLimit(ctx, "connectionWrite", access.agencyId);

      const row = await ctx.db.get(args.connectionId);
      assertTenant(access, row);
      if (row!.revokedAt) throw notFound("connection");

      const input = {
        connectorId: row!.connectorId,
        environment: args.environment ?? row!.environment,
        credentialScheme: row!.credentialScheme as CredentialScheme,
        fields: normalizeCredentialFields(args.fields),
      };
      const sealed = await sealConnection(vaultMasterKey(), input);

      await ctx.db.patch(args.connectionId, {
        encryptedCredentials: sealed.encryptedCredentials,
        displayHint: sealed.displayHint,
        environment: sealed.environment,
        status: "active",
        // The previous health verdict describes the OLD key — discard it.
        lastHealthOk: undefined,
        lastHealthCheckAt: undefined,
        updatedAt: Date.now(),
      });

      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "connection.rotate",
        targetType: "supplierConnection",
        targetId: args.connectionId,
        meta: { connectorId: row!.connectorId },
      });
      return redactConnection((await ctx.db.get(args.connectionId))!);
    }),
});

export const setEnabled = mutation({
  args: {
    token: v.string(),
    connectionId: v.id("supplierConnections"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) =>
    guard("connections.setEnabled", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.connectionId);
      assertTenant(access, row);
      if (row!.revokedAt) throw notFound("connection");

      await ctx.db.patch(args.connectionId, {
        status: args.enabled ? "active" : "disabled",
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: args.enabled ? "connection.enable" : "connection.disable",
        targetType: "supplierConnection",
        targetId: args.connectionId,
      });
      return { ok: true };
    }),
});

/**
 * Revoke a connection. The row is kept (the audit trail references it) but the
 * ciphertext is destroyed, so the credential is unrecoverable from this point.
 */
export const revoke = mutation({
  args: { token: v.string(), connectionId: v.id("supplierConnections") },
  handler: async (ctx, args) =>
    guard("connections.revoke", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.connectionId);
      assertTenant(access, row);

      await ctx.db.patch(args.connectionId, {
        status: "disabled",
        revokedAt: Date.now(),
        updatedAt: Date.now(),
        encryptedCredentials: "",
        displayHint: undefined,
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "connection.revoke",
        targetType: "supplierConnection",
        targetId: args.connectionId,
        meta: { connectorId: row!.connectorId },
      });
      return { ok: true };
    }),
});

// ── Health check (action + its internal halves) ─────────────────────────────

interface HealthCheckContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  connectorId: string;
  environment: "sandbox" | "production";
  encryptedCredentials: string;
}

/**
 * Authorise, throttle, and hand the sealed envelope to the action. Internal —
 * it returns ciphertext, which must never be reachable from a client.
 */
export const beginHealthCheck = internalMutation({
  args: { token: v.string(), connectionId: v.id("supplierConnections") },
  handler: async (ctx, args): Promise<HealthCheckContext> => {
    return guard("beginHealthCheck", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      await consumeLimit(ctx, "healthCheck", access.agencyId);
      const row = await ctx.db.get(args.connectionId);
      assertTenant(access, row);
      if (row!.revokedAt || !row!.encryptedCredentials) throw notFound("connection");
      return {
        agencyId: access.agencyId,
        userId: access.userId,
        connectorId: row!.connectorId,
        environment: row!.environment,
        encryptedCredentials: row!.encryptedCredentials,
      };
    });
  },
});

export const recordHealthCheck = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    actorUserId: v.id("agencyUsers"),
    connectionId: v.id("supplierConnections"),
    ok: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return guard("recordHealthCheck", async () => {
      const row = await ctx.db.get(args.connectionId);
      // Re-assert the tenant: the action could have been given any id.
      if (!row || row.agencyId !== args.agencyId) throw notFound("connection");
      await ctx.db.patch(args.connectionId, {
        lastHealthCheckAt: Date.now(),
        lastHealthOk: args.ok,
        // A failing key should stop being used for searches until it is fixed.
        status: args.ok ? "active" : "error",
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.actorUserId,
        action: "connection.healthCheck",
        targetType: "supplierConnection",
        targetId: args.connectionId,
        meta: { ok: args.ok, message: args.message },
      });
      return null;
    });
  },
});

const beginHealthCheckRef = makeFunctionReference<
  "mutation",
  { token: string; connectionId: Id<"supplierConnections"> },
  HealthCheckContext
>("agency/connections:beginHealthCheck");

const recordHealthCheckRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    actorUserId: Id<"agencyUsers">;
    connectionId: Id<"supplierConnections">;
    ok: boolean;
    message?: string;
  },
  null
>("agency/connections:recordHealthCheck");

/**
 * Verify a stored credential against the live supplier. Read-only at the
 * supplier: a health check never creates, holds, or books anything.
 */
export const healthCheck = action({
  args: { token: v.string(), connectionId: v.id("supplierConnections") },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string; latencyMs?: number }> =>
    guard("connections.healthCheck", async () => {
      const context = await ctx.runMutation(beginHealthCheckRef, {
        token: args.token,
        connectionId: args.connectionId,
      });

      const connector = getConnector(context.connectorId);
      if (!connector) {
        throw new AgencyError("connector_unavailable", "this supplier is not available yet");
      }

      let ok = false;
      let message: string | undefined;
      let latencyMs: number | undefined;
      try {
        const creds = await openJson<SupplierCredentials>(
          vaultMasterKey(),
          context.encryptedCredentials,
        );
        const status = await connector.healthCheck(creds);
        ok = status.healthy;
        message = status.message;
        latencyMs = status.latencyMs;
      } catch (e) {
        ok = false;
        // Connector messages are provider text, not internals — safe to surface,
        // but truncate so a verbose provider cannot flood the UI.
        message = String((e as Error)?.message ?? "the supplier could not be reached").slice(0, 300);
      }

      await ctx.runMutation(recordHealthCheckRef, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        connectionId: args.connectionId,
        ok,
        message,
      });
      return { ok, message, latencyMs };
    }),
});

/** Load a tenant's usable connections for a search. Internal: returns ciphertext. */
export const listForSearch = internalQuery({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("supplierConnections")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();
    return rows
      .filter((r) => !r.revokedAt && r.encryptedCredentials)
      .map((r) => ({
        connectorId: r.connectorId,
        environment: r.environment,
        credentialScheme: r.credentialScheme,
        encryptedCredentials: r.encryptedCredentials,
        status: r.status,
      }));
  },
});
