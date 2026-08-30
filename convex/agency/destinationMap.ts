/**
 * Planera for Travel Agencies — destination-id resolution.
 *
 * The bridge between a search we can express (ATH → CDG) and a search a hotel,
 * activity or ferry supplier will accept (Hotelbeds `PAR`, Viator `479`,
 * Tiqets `266`). Flight suppliers need none of this; everyone else does.
 *
 * Shape, and why:
 *   - cached answers first, always. A locations feed is thousands of rows and
 *     several seconds; a search cannot afford it, and a destination resolves
 *     the same way every time.
 *   - the CHOICE lives in `destinations.ts`, which is pure and tested. This
 *     module only fetches, caches and authorises.
 *   - failures are cached too. A destination the provider does not cover would
 *     otherwise re-pull the whole feed on every search forever.
 *   - a human can always pin a mapping by hand, for every provider — including
 *     the ones with no public feed at all. That is what makes this layer useful
 *     immediately rather than only for the three providers we can query.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getConnector } from "./connectors/factory";
import { getRegistryEntry } from "./connectors/registry";
import type { SupplierCredentials } from "./connectors/types";
import {
  pickBestDestination,
  type DestinationCandidate,
  type DestinationTarget,
} from "./destinations";
import { guard, invalid } from "./errors";
import { buildBindings, type StoredConnectionRow } from "./runtime";
import {
  assertTenant,
  audit,
  consumeLimit,
  requireAccess,
  requireAccessRW,
  vaultMasterKey,
} from "./store";
import { normalizeIata } from "./validation";

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/** Every mapping this agency holds, newest first — the ops screen. */
export const list = query({
  args: { token: v.string(), iata: v.optional(v.string()) },
  handler: async (ctx, args) =>
    guard("destinationMap.list", async () => {
      const access = await requireAccess(ctx, args.token);
      const rows = await ctx.db
        .query("agencyDestinationMappings")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .order("desc")
        .take(500);

      const wanted = args.iata ? normalizeIata(args.iata, "destination") : null;
      return rows
        .filter((r) => !wanted || r.iata === wanted)
        .map((r) => ({
          _id: r._id,
          connectorId: r.connectorId,
          displayName: getRegistryEntry(r.connectorId)?.displayName ?? r.connectorId,
          iata: r.iata,
          status: r.status,
          destinationId: r.destinationId,
          destinationName: r.destinationName ?? null,
          countryCode: r.countryCode ?? null,
          source: r.source,
          confidence: r.confidence ?? null,
          reason: r.reason ?? null,
          alternatives: r.alternatives ?? [],
          resolvedAt: r.resolvedAt,
        }));
    }),
});

/**
 * The cached mappings a search needs. Internal: called by the search action
 * before it fans out, and it returns only what that tenant owns.
 */
export const getForSearch = internalQuery({
  args: {
    agencyId: v.id("agencies"),
    iata: v.string(),
    connectorIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const out: Record<string, { status: "resolved" | "unresolved"; destinationId: string }> = {};
    for (const connectorId of args.connectorIds) {
      const row = await ctx.db
        .query("agencyDestinationMappings")
        .withIndex("by_agency_connector_iata", (q) =>
          q.eq("agencyId", args.agencyId).eq("connectorId", connectorId).eq("iata", args.iata),
        )
        .unique();
      if (row) out[connectorId] = { status: row.status, destinationId: row.destinationId };
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

/** Upsert one mapping. Internal — the resolver's only way to persist. */
export const save = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    connectorId: v.string(),
    iata: v.string(),
    status: v.union(v.literal("resolved"), v.literal("unresolved")),
    destinationId: v.string(),
    destinationName: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    source: v.union(v.literal("feed"), v.literal("manual")),
    confidence: v.optional(v.float64()),
    reason: v.optional(v.string()),
    alternatives: v.optional(v.any()),
  },
  handler: async (ctx, args) =>
    guard("destinationMap.save", async () => {
      const existing = await ctx.db
        .query("agencyDestinationMappings")
        .withIndex("by_agency_connector_iata", (q) =>
          q
            .eq("agencyId", args.agencyId)
            .eq("connectorId", args.connectorId)
            .eq("iata", args.iata),
        )
        .unique();

      const now = Date.now();
      const fields = {
        status: args.status,
        destinationId: args.destinationId,
        destinationName: args.destinationName,
        countryCode: args.countryCode,
        source: args.source,
        confidence: args.confidence,
        reason: args.reason,
        alternatives: args.alternatives,
        resolvedAt: now,
        updatedAt: now,
      };

      if (existing) {
        // A hand-pinned mapping is a decision someone made; an automatic pass
        // must never quietly overwrite it.
        if (existing.source === "manual" && args.source === "feed") return existing._id;
        await ctx.db.patch(existing._id, fields);
        return existing._id;
      }
      return await ctx.db.insert("agencyDestinationMappings", {
        agencyId: args.agencyId,
        connectorId: args.connectorId,
        iata: args.iata,
        ...fields,
      });
    }),
});

/** Pin a mapping by hand. Works for every provider, feed or no feed. */
export const setManual = mutation({
  args: {
    token: v.string(),
    connectorId: v.string(),
    iata: v.string(),
    destinationId: v.string(),
    destinationName: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("destinationMap.setManual", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      if (!getRegistryEntry(args.connectorId)) throw invalid("unknown supplier");

      const iata = normalizeIata(args.iata, "destination");
      const destinationId = args.destinationId.trim();
      if (!destinationId) throw invalid("a destination id is required");
      if (destinationId.length > 64) throw invalid("that destination id is too long");

      const existing = await ctx.db
        .query("agencyDestinationMappings")
        .withIndex("by_agency_connector_iata", (q) =>
          q.eq("agencyId", access.agencyId).eq("connectorId", args.connectorId).eq("iata", iata),
        )
        .unique();

      const now = Date.now();
      const fields = {
        status: "resolved" as const,
        destinationId,
        destinationName: args.destinationName?.trim().slice(0, 120) || undefined,
        source: "manual" as const,
        confidence: undefined,
        reason: "pinned by hand",
        alternatives: undefined,
        resolvedAt: now,
        updatedAt: now,
      };

      if (existing) await ctx.db.patch(existing._id, fields);
      else
        await ctx.db.insert("agencyDestinationMappings", {
          agencyId: access.agencyId,
          connectorId: args.connectorId,
          iata,
          ...fields,
        });

      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "destination.pin",
        targetType: "destinationMapping",
        targetId: `${args.connectorId}:${iata}`,
        meta: { connectorId: args.connectorId, iata, destinationId },
      });
      return { ok: true };
    }),
});

/** Forget a mapping so the next search resolves it again. */
export const remove = mutation({
  args: { token: v.string(), mappingId: v.id("agencyDestinationMappings") },
  handler: async (ctx, args) =>
    guard("destinationMap.remove", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.mappingId);
      assertTenant(access, row);
      await ctx.db.delete(args.mappingId);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "destination.clear",
        targetType: "destinationMapping",
        targetId: `${row!.connectorId}:${row!.iata}`,
      });
      return { ok: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolution (action: it calls suppliers)
// ─────────────────────────────────────────────────────────────────────────────

interface ResolveContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  connections: StoredConnectionRow[];
  cached: Record<string, { status: "resolved" | "unresolved"; destinationId: string }>;
}

export const beginResolve = internalMutation({
  args: { token: v.string(), iata: v.string() },
  handler: async (ctx, args): Promise<ResolveContext> =>
    guard("destinationMap.beginResolve", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      // Pulling supplier locations feeds is expensive for them and for us.
      await consumeLimit(ctx, "destinationLookup", access.agencyId);

      const connections = (
        await ctx.db
          .query("supplierConnections")
          .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
          .collect()
      )
        .filter((r) => !r.revokedAt && r.encryptedCredentials && r.status === "active")
        .map((r) => ({
          connectorId: r.connectorId,
          environment: r.environment,
          credentialScheme: r.credentialScheme,
          encryptedCredentials: r.encryptedCredentials,
          status: r.status,
        }));

      const cached: ResolveContext["cached"] = {};
      for (const c of connections) {
        const row = await ctx.db
          .query("agencyDestinationMappings")
          .withIndex("by_agency_connector_iata", (q) =>
            q
              .eq("agencyId", access.agencyId)
              .eq("connectorId", c.connectorId)
              .eq("iata", args.iata),
          )
          .unique();
        if (row) cached[c.connectorId] = { status: row.status, destinationId: row.destinationId };
      }

      return { agencyId: access.agencyId, userId: access.userId, connections, cached };
    }),
});

const beginResolveRef = makeFunctionReference<
  "mutation",
  { token: string; iata: string },
  ResolveContext
>("agency/destinationMap:beginResolve");

const saveRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    connectorId: string;
    iata: string;
    status: "resolved" | "unresolved";
    destinationId: string;
    destinationName?: string;
    countryCode?: string;
    source: "feed" | "manual";
    confidence?: number;
    reason?: string;
    alternatives?: unknown;
  },
  Id<"agencyDestinationMappings">
>("agency/destinationMap:save");

export interface ResolveOutcome {
  iata: string;
  results: Array<{
    connectorId: string;
    status: "resolved" | "unresolved" | "cached" | "no_feed" | "error";
    destinationId?: string;
    destinationName?: string;
    confidence?: number;
    reason?: string;
  }>;
}

/**
 * Resolve one destination across every connected supplier that needs an id.
 *
 * Runs per connector and tolerates partial failure: one provider's feed being
 * down must not stop the others from mapping. Providers with no public feed are
 * reported as `no_feed` — they are mapped by hand, not by guesswork.
 */
export const resolve = action({
  args: { token: v.string(), iata: v.string(), cityName: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<ResolveOutcome> =>
    guard("destinationMap.resolve", async () => {
      const iata = normalizeIata(args.iata, "destination");
      const context = await ctx.runMutation(beginResolveRef, { token: args.token, iata });

      const { bindings } = await buildBindings(vaultMasterKey(), context.connections);
      const target: DestinationTarget = { iata, cityName: args.cityName };
      const results: ResolveOutcome["results"] = [];

      await Promise.all(
        bindings.map(async ({ connector, creds }) => {
          const connectorId = connector.id;

          const cached = context.cached[connectorId];
          if (cached && !args.force) {
            results.push({
              connectorId,
              status: "cached",
              destinationId: cached.destinationId || undefined,
            });
            return;
          }

          if (!connector.listDestinations) {
            results.push({
              connectorId,
              status: "no_feed",
              reason: "this supplier publishes no locations feed — pin the destination by hand",
            });
            return;
          }

          try {
            const candidates: DestinationCandidate[] = await connector.listDestinations(
              creds as SupplierCredentials,
              target,
            );
            const picked = pickBestDestination(candidates, target);

            if (picked.match) {
              await ctx.runMutation(saveRef, {
                agencyId: context.agencyId,
                connectorId,
                iata,
                status: "resolved",
                destinationId: picked.match.candidate.id,
                destinationName: picked.match.candidate.name,
                countryCode: picked.match.candidate.countryCode,
                source: "feed",
                confidence: picked.match.confidence,
                reason: picked.match.reason,
                alternatives: picked.alternatives.map((a) => ({
                  id: a.candidate.id,
                  name: a.candidate.name,
                  countryCode: a.candidate.countryCode,
                  confidence: a.confidence,
                })),
              });
              results.push({
                connectorId,
                status: "resolved",
                destinationId: picked.match.candidate.id,
                destinationName: picked.match.candidate.name,
                confidence: picked.match.confidence,
                reason: picked.match.reason,
              });
              return;
            }

            // Cache the failure so the next search does not re-pull the feed,
            // and keep the runners-up so a human can pin one in a click.
            const reason =
              picked.problem === "ambiguous"
                ? "several destinations matched equally well — pin the right one"
                : picked.problem === "below_threshold"
                  ? "no destination matched closely enough to be safe"
                  : "this supplier lists no matching destination";

            await ctx.runMutation(saveRef, {
              agencyId: context.agencyId,
              connectorId,
              iata,
              status: "unresolved",
              destinationId: "",
              source: "feed",
              reason,
              alternatives: picked.alternatives.map((a) => ({
                id: a.candidate.id,
                name: a.candidate.name,
                countryCode: a.candidate.countryCode,
                confidence: a.confidence,
              })),
            });
            results.push({ connectorId, status: "unresolved", reason });
          } catch (e) {
            // A feed being down is transient — do NOT cache it as unresolved,
            // or a five-minute outage becomes a permanent missing supplier.
            results.push({
              connectorId,
              status: "error",
              reason: String((e as Error)?.message ?? "the locations feed could not be read").slice(
                0,
                300,
              ),
            });
          }
        }),
      );

      return { iata, results };
    }),
});

/** Providers that need an id, for the ops screen. */
export const needsMapping = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("destinationMap.needsMapping", async () => {
      const access = await requireAccess(ctx, args.token);
      const rows = await ctx.db
        .query("supplierConnections")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .collect();

      return rows
        .filter((r) => !r.revokedAt)
        .map((r) => {
          const connector = getConnector(r.connectorId);
          return {
            connectorId: r.connectorId,
            displayName: getRegistryEntry(r.connectorId)?.displayName ?? r.connectorId,
            // Flights key off IATA directly and need no mapping at all.
            needsDestinationId: !(connector?.capabilities.kinds ?? []).every((k) => k === "flight"),
            hasFeed: !!connector?.listDestinations,
          };
        })
        .filter((r) => r.needsDestinationId);
    }),
});

/** Resolve a mapping id for a connector, or null. Used by the search action. */
export const lookupRef = makeFunctionReference<
  "query",
  { agencyId: Id<"agencies">; iata: string; connectorIds: string[] },
  Record<string, { status: "resolved" | "unresolved"; destinationId: string }>
>("agency/destinationMap:getForSearch");

