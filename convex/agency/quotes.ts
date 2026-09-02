/**
 * Planera for Travel Agencies — quotes: search, assemble, revalidate, share.
 *
 * The shape of every supplier-touching flow here is the same three steps, and
 * it is deliberate:
 *
 *   1. an internal MUTATION authorises the caller, spends rate-limit budget and
 *      hands back the sealed credentials + pricing rules,
 *   2. the ACTION decrypts, fans out to the suppliers, and assembles the result,
 *   3. an internal MUTATION re-checks the tenant and persists.
 *
 * Actions cannot touch the database and cannot be trusted with a tenant id, so
 * step 3 never takes the agency id on faith — it re-derives it from the quote
 * row it is about to write.
 *
 * PRICES ARE NOT GUARANTEED. A search result is an indication; only
 * `revalidate` produces a price the agency can act on, and an expired quote
 * must be revalidated before it is sent or accepted.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { NormalizedOffer, TravelPackage } from "./model/types";
import { buildQuote, revalidatedExpiry, type PricingRuleRow } from "./quote";
import { searchForQuote, revalidateSelected, type ConnectorRunResult } from "./orchestrator";
import { bindingsById, buildBindings, type StoredConnectionRow } from "./runtime";
import { scrubForStorage, selectedOffers, toAgentPackages, toCustomerPackages } from "./quoteView";
import { AgencyError, guard, invalid, notFound } from "./errors";
import { newToken, sha256Hex } from "./crypto";
import {
  assertTenant,
  audit,
  consumeLimit,
  quotePublicBaseUrl,
  requireAccess,
  requireAccessRW,
  vaultMasterKey,
} from "./store";
import {
  normalizeCurrency,
  normalizeIata,
  normalizeMaxStops,
  normalizeRooms,
  validateDateRange,
  validateParty,
} from "./validation";

/** Default validity of a freshly built quote; agencies can shorten or extend it. */
const DEFAULT_QUOTE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a customer link stays live once sent. */
const DEFAULT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const quoteStatus = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("accepted"),
  v.literal("expired"),
  v.literal("revalidating"),
);

// ── Search ──────────────────────────────────────────────────────────────────

interface NormalizedSearchParams {
  originIata: string;
  destinationIata: string;
  departDate: string;
  returnDate?: string;
  adults: number;
  childrenAges: number[];
  /** Hotel rooms. Suppliers price per room, so 2 rooms is not 2x one room. */
  rooms: number;
  cabinClass?: string;
  currency: string;
  nights: number;
  travelers: number;
  /** 0 = direct only. Absent means the agent did not care. */
  maxStops?: number;
  /** Which kinds to search. An agency quoting a hotel-only stay says so here. */
  kinds: Array<"flight" | "hotel" | "activity" | "transfer">;
  /** Whose trip this is — an agency runs many searches a day. */
  clientName?: string;
  clientReference?: string;
}

const SEARCHABLE_KINDS = ["flight", "hotel", "activity", "transfer"] as const;
type SearchableKind = (typeof SEARCHABLE_KINDS)[number];

const searchKind = v.union(
  v.literal("flight"),
  v.literal("hotel"),
  v.literal("activity"),
  v.literal("transfer"),
);

interface SearchContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  params: NormalizedSearchParams;
  rules: PricingRuleRow[];
  connections: StoredConnectionRow[];
  ttlMs: number;
  searchHash: string;
  /** Resolved provider destination ids, keyed by connector id. */
  destinationIds: Record<string, string>;
}

/**
 * Authorise + validate + budget, then hand the action everything it needs in
 * one round trip. Internal: the response carries sealed supplier credentials.
 */
export const beginSearch = internalMutation({
  args: {
    token: v.string(),
    originIata: v.string(),
    destinationIata: v.string(),
    departDate: v.string(),
    returnDate: v.optional(v.string()),
    adults: v.float64(),
    childrenAges: v.optional(v.array(v.float64())),
    rooms: v.optional(v.float64()),
    cabinClass: v.optional(v.string()),
    currency: v.optional(v.string()),
    maxStops: v.optional(v.float64()),
    kinds: v.optional(v.array(searchKind)),
    clientName: v.optional(v.string()),
    clientReference: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchContext> => {
    return guard("beginSearch", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");

      const originIata = normalizeIata(args.originIata, "origin");
      const destinationIata = normalizeIata(args.destinationIata, "destination");
      if (originIata === destinationIata) throw invalid("origin and destination must differ");
      const dates = validateDateRange(args.departDate, args.returnDate, Date.now());
      const party = validateParty(args.adults, args.childrenAges);

      const agency = await ctx.db.get(access.agencyId);
      if (!agency) throw notFound("agency");
      const currency = normalizeCurrency(args.currency ?? agency.defaultCurrency);

      // Charged before the suppliers are called, so a failing search still costs
      // budget — otherwise an error loop is a free way to hammer providers.
      await consumeLimit(ctx, "search", access.agencyId);

      const rules = (
        await ctx.db
          .query("agencyPricingRules")
          .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
          .collect()
      ).map((r) => ({
        scope: r.scope,
        selector: r.selector,
        rule: r.rule,
        active: r.active,
      })) as PricingRuleRow[];

      const connections = (
        await ctx.db
          .query("supplierConnections")
          .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
          .collect()
      )
        .filter((r) => !r.revokedAt && r.encryptedCredentials)
        .map((r) => ({
          connectorId: r.connectorId,
          environment: r.environment,
          credentialScheme: r.credentialScheme,
          encryptedCredentials: r.encryptedCredentials,
          status: r.status,
        }));

      if (connections.length === 0) {
        throw new AgencyError(
          "connector_unavailable",
          "connect at least one supplier before searching",
        );
      }

      // An empty selection means "everything" rather than "nothing": a caller
      // that sends no kinds wants a normal search, not an empty quote.
      const requested = (args.kinds ?? []).filter((k): k is SearchableKind =>
        (SEARCHABLE_KINDS as readonly string[]).includes(k),
      );
      const kinds = requested.length ? [...new Set(requested)] : [...SEARCHABLE_KINDS];

      const params: NormalizedSearchParams = {
        originIata,
        destinationIata,
        departDate: dates.departDate,
        returnDate: dates.returnDate,
        adults: party.adults,
        childrenAges: party.childrenAges,
        rooms: normalizeRooms(args.rooms, party.adults),
        cabinClass: args.cabinClass,
        currency,
        nights: dates.nights,
        travelers: party.travelers,
        maxStops: normalizeMaxStops(args.maxStops),
        kinds,
        clientName: args.clientName?.trim().slice(0, 120) || undefined,
        clientReference: args.clientReference?.trim().slice(0, 60) || undefined,
      };

      // Hotel and activity suppliers key off their own destination taxonomy, so
      // each needs its own id for this trip. Only ALREADY-RESOLVED mappings are
      // read here: resolving pulls a locations feed, which is a network call
      // and cannot happen inside a mutation. An unmapped supplier is skipped by
      // the orchestrator with `no_destination_mapping`, and the agent resolves
      // it from Settings — which is far better than silently dropping it.
      const destinationIds: Record<string, string> = {};
      for (const c of connections) {
        const mapping = await ctx.db
          .query("agencyDestinationMappings")
          .withIndex("by_agency_connector_iata", (q) =>
            q
              .eq("agencyId", access.agencyId)
              .eq("connectorId", c.connectorId)
              .eq("iata", destinationIata),
          )
          .unique();
        if (mapping?.status === "resolved" && mapping.destinationId) {
          destinationIds[c.connectorId] = mapping.destinationId;
        }
      }

      return {
        agencyId: access.agencyId,
        userId: access.userId,
        params,
        rules,
        connections,
        ttlMs: agency.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS,
        searchHash: await sha256Hex(JSON.stringify(params)),
        destinationIds,
      };
    });
  },
});

export const saveQuote = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    createdByUserId: v.id("agencyUsers"),
    quoteId: v.string(),
    currency: v.string(),
    searchParams: v.any(),
    packages: v.any(),
    diagnostics: v.any(),
    clientName: v.optional(v.string()),
    clientReference: v.optional(v.string()),
    searchHash: v.string(),
    searchedAt: v.float64(),
    expiresAt: v.float64(),
  },
  handler: async (ctx, args) => {
    return guard("saveQuote", async () => {
      const id = await ctx.db.insert("quotes", {
        quoteId: args.quoteId,
        agencyId: args.agencyId,
        createdByUserId: args.createdByUserId,
        currency: args.currency,
        searchParams: args.searchParams,
        packages: args.packages,
        diagnostics: args.diagnostics,
        clientName: args.clientName,
        clientReference: args.clientReference,
        searchHash: args.searchHash,
        status: "draft",
        searchedAt: args.searchedAt,
        expiresAt: args.expiresAt,
        createdAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.createdByUserId,
        action: "quote.create",
        targetType: "quote",
        targetId: args.quoteId,
        meta: { currency: args.currency },
      });

      // Client-facing copy is written after the fact, never inline: a search
      // must not wait on OpenAI, and a quote with no copy is complete and
      // sendable. It appears on the document a few seconds later.
      await ctx.scheduler.runAfter(0, generateCopyRef, {
        quoteId: args.quoteId,
        agencyId: args.agencyId,
      });
      return id;
    });
  },
});

const notifyQuoteEventRef = makeFunctionReference<
  "action",
  {
    agencyId: Id<"agencies">;
    quoteId: string;
    event: "viewed" | "accepted";
    tier?: string;
    note?: string;
  },
  null
>("agency/notify:quoteEvent");

const generateCopyRef = makeFunctionReference<
  "action",
  { quoteId: string; agencyId: Id<"agencies"> },
  null
>("agency/packageCopy:generate");

const beginSearchRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    originIata: string;
    destinationIata: string;
    departDate: string;
    returnDate?: string;
    adults: number;
    childrenAges?: number[];
    rooms?: number;
    cabinClass?: string;
    currency?: string;
    maxStops?: number;
    kinds?: SearchableKind[];
    clientName?: string;
    clientReference?: string;
  },
  SearchContext
>("agency/quotes:beginSearch");

const saveQuoteRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    createdByUserId: Id<"agencyUsers">;
    quoteId: string;
    currency: string;
    searchParams: unknown;
    packages: unknown;
    diagnostics: unknown;
    clientName?: string;
    clientReference?: string;
    searchHash: string;
    searchedAt: number;
    expiresAt: number;
  },
  Id<"quotes">
>("agency/quotes:saveQuote");

export interface SearchResult {
  quoteId: string;
  currency: string;
  expiresAt: number;
  packages: TravelPackage[];
  diagnostics: ConnectorRunResult[];
  /** True when no supplier returned anything usable. */
  empty: boolean;
}

/**
 * Run a live multi-supplier search and assemble the three-tier quote.
 * Partial failure is normal: connectors that error or time out appear in
 * `diagnostics` and the quote is built from whatever did return.
 */
export const search = action({
  args: {
    token: v.string(),
    originIata: v.string(),
    destinationIata: v.string(),
    departDate: v.string(),
    returnDate: v.optional(v.string()),
    adults: v.float64(),
    childrenAges: v.optional(v.array(v.float64())),
    rooms: v.optional(v.float64()),
    cabinClass: v.optional(v.string()),
    currency: v.optional(v.string()),
    maxStops: v.optional(v.float64()),
    kinds: v.optional(v.array(searchKind)),
    clientName: v.optional(v.string()),
    clientReference: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchResult> =>
    guard("quotes.search", async () => {
      const context = await ctx.runMutation(beginSearchRef, {
        token: args.token,
        originIata: args.originIata,
        destinationIata: args.destinationIata,
        departDate: args.departDate,
        returnDate: args.returnDate,
        adults: args.adults,
        childrenAges: args.childrenAges,
        rooms: args.rooms,
        cabinClass: args.cabinClass,
        currency: args.currency,
        maxStops: args.maxStops,
        kinds: args.kinds,
        clientName: args.clientName,
        clientReference: args.clientReference,
      });

      const { bindings, skipped } = await buildBindings(vaultMasterKey(), context.connections);
      const p = context.params;

      const found = bindings.length
        ? await searchForQuote(bindings, {
            originIata: p.originIata,
            destinationIata: p.destinationIata,
            departDate: p.departDate,
            returnDate: p.returnDate,
            adults: p.adults,
            childrenAges: p.childrenAges,
            rooms: p.rooms,
            cabinClass: p.cabinClass,
            sellCurrency: p.currency,
          },
          undefined,
          context.destinationIds,
          p.kinds)
        : { flights: [], hotels: [], activities: [], transfers: [], diagnostics: [] };

      const diagnostics = [...skipped, ...found.diagnostics];

      // Applied AFTER the search rather than sent to each supplier: not every
      // connector exposes a stops filter, and filtering here means the rule is
      // one rule instead of thirteen. Falls back to the unfiltered pool when
      // nothing clears the bar — an empty quote helps nobody, and the agent can
      // see the stops on every line anyway.
      const flights =
        p.maxStops === undefined
          ? found.flights
          : (() => {
              const within = found.flights.filter(
                (f) =>
                  f.outboundStops <= p.maxStops! &&
                  (f.inboundStops ?? 0) <= p.maxStops!,
              );
              return within.length > 0 ? within : found.flights;
            })();

      const searchedAt = Date.now();
      const quoteId = `qte_${newToken().replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;

      const built = buildQuote({
        quoteId,
        agencyId: context.agencyId,
        createdByUserId: context.userId,
        currency: p.currency,
        searchParams: p,
        // A one-way search still spans at least one day of food budget.
        days: Math.max(1, p.nights),
        travelers: p.travelers,
        destinationIata: p.destinationIata,
        flights,
        hotels: found.hotels,
        activities: found.activities,
        transfers: found.transfers,
        rules: context.rules,
        now: searchedAt,
        ttlMs: context.ttlMs,
      });

      const empty = built.packages.every((pkg) => pkg.lines.length === 0);
      if (empty) {
        // Nothing to quote: record the attempt in diagnostics, save nothing.
        return {
          quoteId,
          currency: p.currency,
          expiresAt: built.expiresAt,
          packages: [],
          diagnostics,
          empty: true,
        };
      }

      const packages = scrubForStorage(built.packages);
      await ctx.runMutation(saveQuoteRef, {
        agencyId: context.agencyId,
        createdByUserId: context.userId,
        quoteId,
        currency: p.currency,
        searchParams: p,
        packages,
        diagnostics,
        clientName: p.clientName,
        clientReference: p.clientReference,
        searchHash: context.searchHash,
        searchedAt,
        expiresAt: built.expiresAt,
      });

      return {
        quoteId,
        currency: p.currency,
        expiresAt: built.expiresAt,
        packages: toAgentPackages(packages),
        diagnostics,
        empty: false,
      };
    }),
});

// ── Read ────────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    token: v.string(),
    status: v.optional(quoteStatus),
    limit: v.optional(v.float64()),
  },
  handler: async (ctx, args) =>
    guard("quotes.list", async () => {
      const access = await requireAccess(ctx, args.token);
      const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 100);
      const rows = args.status
        ? await ctx.db
            .query("quotes")
            .withIndex("by_agency_status", (q) =>
              q.eq("agencyId", access.agencyId).eq("status", args.status!),
            )
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("quotes")
            .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
            .order("desc")
            .take(limit);

      const now = Date.now();
      // Summary only — the full package payload is large and the list does not
      // need it.
      return rows.map((r) => {
        const packages = (r.packages ?? []) as TravelPackage[];
        return {
          quoteId: r.quoteId,
          status: r.status,
          currency: r.currency,
          // What makes a list of 40 quotes searchable by a human.
          clientName: r.clientName ?? null,
          clientReference: r.clientReference ?? null,
          searchParams: r.searchParams,
          searchedAt: r.searchedAt,
          expiresAt: r.expiresAt,
          expired: now >= r.expiresAt,
          lastRevalidatedAt: r.lastRevalidatedAt ?? null,
          sentAt: r.sentAt ?? null,
          acceptedAt: r.acceptedAt ?? null,
          tiers: packages.map((p) => ({
            tier: p.tier,
            total: p.totals?.internal?.customerPrice ?? null,
            lines: p.lines?.length ?? 0,
          })),
        };
      });
    }),
});

export const get = query({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("quotes.get", async () => {
      const access = await requireAccess(ctx, args.token);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);

      const packages = toAgentPackages((row!.packages ?? []) as TravelPackage[]);
      return {
        quoteId: row!.quoteId,
        status: row!.status,
        currency: row!.currency,
        searchParams: row!.searchParams,
        packages,
        diagnostics: row!.diagnostics ?? [],
        revalidation: row!.revalidation ?? null,
        searchedAt: row!.searchedAt,
        clientName: row!.clientName ?? null,
        clientReference: row!.clientReference ?? null,
        aiCopy: row!.aiCopy ?? null,
        expiresAt: row!.expiresAt,
        expired: Date.now() >= row!.expiresAt,
        lastRevalidatedAt: row!.lastRevalidatedAt ?? null,
        sentAt: row!.sentAt ?? null,
        acceptedAt: row!.acceptedAt ?? null,
        acceptedTier: row!.acceptedTier ?? null,
        acceptedNote: row!.acceptedNote ?? null,
        // "They read it twice and did not reply" is a different sales call
        // from "they never opened it", and the agent had no way to tell.
        firstViewedAt: row!.firstViewedAt ?? null,
        lastViewedAt: row!.lastViewedAt ?? null,
        viewCount: row!.viewCount ?? 0,
        customerLinkActive:
          !!row!.customerLinkTokenHash &&
          (row!.customerLinkExpiresAt ?? 0) > Date.now(),
      };
    }),
});

// ── Revalidation ────────────────────────────────────────────────────────────

interface RevalidationContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  quoteRowId: Id<"quotes">;
  offers: NormalizedOffer[];
  connections: StoredConnectionRow[];
}

export const beginRevalidate = internalMutation({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args): Promise<RevalidationContext> => {
    return guard("beginRevalidate", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      await consumeLimit(ctx, "revalidate", access.agencyId);

      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);

      const offers = selectedOffers((row!.packages ?? []) as TravelPackage[]);
      if (offers.length === 0) throw invalid("this quote has nothing to revalidate");

      await ctx.db.patch(row!._id, { status: "revalidating", updatedAt: Date.now() });

      const connections = (
        await ctx.db
          .query("supplierConnections")
          .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
          .collect()
      )
        .filter((r) => !r.revokedAt && r.encryptedCredentials)
        .map((r) => ({
          connectorId: r.connectorId,
          environment: r.environment,
          credentialScheme: r.credentialScheme,
          encryptedCredentials: r.encryptedCredentials,
          status: r.status,
        }));

      return {
        agencyId: access.agencyId,
        userId: access.userId,
        quoteRowId: row!._id,
        offers,
        connections,
      };
    });
  },
});

export const recordRevalidation = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    actorUserId: v.id("agencyUsers"),
    quoteRowId: v.id("quotes"),
    outcome: v.any(),
    stillValid: v.boolean(),
  },
  handler: async (ctx, args) => {
    return guard("recordRevalidation", async () => {
      const row = await ctx.db.get(args.quoteRowId);
      // The action could pass any id — re-derive the tenant from the row itself.
      if (!row || row.agencyId !== args.agencyId) throw notFound("quote");

      const now = Date.now();
      // A quote that failed revalidation must not go back to looking live.
      const status = args.stillValid
        ? row.sentAt
          ? ("sent" as const)
          : ("draft" as const)
        : ("expired" as const);

      // A successful revalidation IS a fresh confirmation from every supplier
      // behind the quote — that is the entire point of the call — so it has to
      // restart the validity window. Leaving `expiresAt` at its original value
      // left a just-confirmed quote still reading as expired, and `send`
      // refuses an expired quote with "revalidate it before sending", so an
      // expired quote could never be recovered by the one action that exists
      // to recover it.
      //
      // Only on success: a quote whose offers are gone or unverifiable keeps
      // its old expiry and stays expired.
      const agency = await ctx.db.get(args.agencyId);

      await ctx.db.patch(args.quoteRowId, {
        revalidation: args.outcome,
        lastRevalidatedAt: now,
        status,
        expiresAt: revalidatedExpiry({
          stillValid: args.stillValid,
          now,
          ttlMs: agency?.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS,
          currentExpiresAt: row.expiresAt,
        }),
        updatedAt: now,
      });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.actorUserId,
        action: "quote.revalidate",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { stillValid: args.stillValid },
      });
      return null;
    });
  },
});

const beginRevalidateRef = makeFunctionReference<
  "mutation",
  { token: string; quoteId: string },
  RevalidationContext
>("agency/quotes:beginRevalidate");

const recordRevalidationRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    actorUserId: Id<"agencyUsers">;
    quoteRowId: Id<"quotes">;
    outcome: unknown;
    stillValid: boolean;
  },
  null
>("agency/quotes:recordRevalidation");

/**
 * Re-check every selected offer against the connector that produced it. This is
 * the only call that yields a price the agency can commit to — and a connector
 * that cannot answer marks its line `unverifiable`, which is NOT the same as
 * "unavailable" and blocks automatic validity either way.
 */
export const revalidate = action({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("quotes.revalidate", async () => {
      const context = await ctx.runMutation(beginRevalidateRef, {
        token: args.token,
        quoteId: args.quoteId,
      });

      const { bindings } = await buildBindings(vaultMasterKey(), context.connections);
      const outcome = await revalidateSelected(
        bindingsById(bindings),
        context.offers,
        Date.now(),
      );

      await ctx.runMutation(recordRevalidationRef, {
        agencyId: context.agencyId,
        actorUserId: context.userId,
        quoteRowId: context.quoteRowId,
        outcome,
        stillValid: outcome.quoteStillValid,
      });
      return outcome;
    }),
});

// ── Sharing ─────────────────────────────────────────────────────────────────

/**
 * Mint a customer link. The raw token is returned once, in the URL; only its
 * hash is stored, so a database read cannot reconstruct a working link.
 */
export const send = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    linkTtlHours: v.optional(v.float64()),
  },
  handler: async (ctx, args) =>
    guard("quotes.send", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);

      // Sending an already-stale quote would put a price we cannot honour in
      // front of a traveller.
      if (Date.now() >= row!.expiresAt) {
        throw new AgencyError(
          "quote_expired",
          "this quote has expired — revalidate it before sending",
        );
      }
      if (args.linkTtlHours !== undefined && !(args.linkTtlHours >= 1 && args.linkTtlHours <= 720)) {
        throw invalid("link validity must be between 1 and 720 hours");
      }

      const raw = newToken();
      const now = Date.now();
      const linkExpiresAt = args.linkTtlHours
        ? now + Math.round(args.linkTtlHours * 3600_000)
        : now + DEFAULT_LINK_TTL_MS;

      await ctx.db.patch(row!._id, {
        customerLinkTokenHash: await sha256Hex(raw),
        customerLinkExpiresAt: linkExpiresAt,
        status: "sent",
        sentAt: row!.sentAt ?? now,
        updatedAt: now,
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "quote.send",
        targetType: "quote",
        targetId: row!.quoteId,
      });

      return {
        url: `${quotePublicBaseUrl()}/q/${raw}`,
        expiresAt: linkExpiresAt,
      };
    }),
});

/** Kill a customer link without touching the quote. */
export const revokeLink = mutation({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("quotes.revokeLink", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      await ctx.db.patch(row!._id, {
        customerLinkTokenHash: undefined,
        customerLinkExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "quote.revokeLink",
        targetType: "quote",
        targetId: row!.quoteId,
      });
      return { ok: true };
    }),
});

/** Record that the traveller accepted a tier. The agency then books it itself. */
export const markAccepted = mutation({
  args: { token: v.string(), quoteId: v.string(), tier: v.string() },
  handler: async (ctx, args) =>
    guard("quotes.markAccepted", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      if (!["basic", "comfort", "premium"].includes(args.tier)) throw invalid("unknown package tier");
      // Acceptance is a commercial commitment — it needs a price we just checked.
      if (Date.now() >= row!.expiresAt) {
        throw new AgencyError(
          "quote_expired",
          "this quote has expired — revalidate before accepting",
        );
      }

      const now = Date.now();
      await ctx.db.patch(row!._id, { status: "accepted", acceptedAt: now, updatedAt: now });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "quote.accept",
        targetType: "quote",
        targetId: row!.quoteId,
        meta: { tier: args.tier },
      });
      return { ok: true };
    }),
});

// ── Customer-facing view ────────────────────────────────────────────────────

/**
 * Resolve a customer link. An internal MUTATION rather than a query because it
 * spends rate-limit budget: the link token is the only credential here, so
 * guessing must be throttled as well as astronomically unlikely.
 */
export const resolveCustomerLink = internalMutation({
  args: { linkToken: v.string() },
  handler: async (ctx, args) => {
    return guard("resolveCustomerLink", async () => {
      // Throttle on a prefix of the presented token: enough to bound one attacker
      // without letting them dodge the counter by varying the whole token.
      await consumeLimit(ctx, "publicQuote", args.linkToken.slice(0, 8));

      const hash = await sha256Hex(args.linkToken);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_customerLinkTokenHash", (q) => q.eq("customerLinkTokenHash", hash))
        .unique();
      // One uniform answer for "wrong token", "revoked" and "expired link".
      if (!row || !row.customerLinkExpiresAt || row.customerLinkExpiresAt <= Date.now()) {
        throw notFound("quote");
      }

      const agency = await ctx.db.get(row.agencyId);
      if (!agency || agency.status !== "active") throw notFound("quote");

      // An agency has no other way to know whether a quote was ever opened,
      // and "they read it twice and did not reply" is a different sales call
      // from "they never saw it". Recorded here because this is already the
      // mutation every open goes through.
      const viewedAt = Date.now();
      const firstView = !row.firstViewedAt;
      await ctx.db.patch(row._id, {
        firstViewedAt: row.firstViewedAt ?? viewedAt,
        lastViewedAt: viewedAt,
        viewCount: (row.viewCount ?? 0) + 1,
      });
      // Only the FIRST open is worth an email. A client re-reading a quote four
      // times should not put four messages in an agent's inbox.
      if (firstView) {
        await ctx.scheduler.runAfter(0, notifyQuoteEventRef, {
          agencyId: row.agencyId,
          quoteId: row.quoteId,
          event: "viewed",
        });
      }

      return {
        quoteId: row.quoteId,
        currency: row.currency,
        status: row.status,
        searchParams: row.searchParams,
        packages: toCustomerPackages((row.packages ?? []) as TravelPackage[]),
        aiCopy: row.aiCopy ?? null,
        expiresAt: row.expiresAt,
        expired: Date.now() >= row.expiresAt,
        agency: {
          name: agency.branding?.legalName ?? agency.name,
          primaryColor: agency.branding?.primaryColor ?? null,
          contactEmail: agency.branding?.contactEmail ?? null,
          contactPhone: agency.branding?.contactPhone ?? null,
          // Resolved here rather than handed out as a storage id, which means
          // nothing to a browser. Public on purpose: this is the agency's own
          // mark on a document it chose to send.
          logoUrl: agency.branding?.logoStorageId
            ? await ctx.storage.getUrl(agency.branding.logoStorageId)
            : null,
        },
      };
    });
  },
});

const resolveCustomerLinkRef = makeFunctionReference<
  "mutation",
  { linkToken: string },
  unknown
>("agency/quotes:resolveCustomerLink");

/**
 * Accept a quote from the customer link.
 *
 * The traveller could always READ the quote and never act on it, so every "yes"
 * arrived by email or phone and had to be typed back in by an agent. This is
 * the same capability URL doing the same job it already does for reading.
 *
 * It records intent, NOT a booking: the agency still confirms, re-prices and
 * tickets — the quote page says so, and nothing here touches a supplier.
 */
export const acceptFromLink = mutation({
  args: {
    linkToken: v.string(),
    tier: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("acceptFromLink", async () => {
      await consumeLimit(ctx, "acceptQuote", args.linkToken.slice(0, 8));

      const hash = await sha256Hex(args.linkToken);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_customerLinkTokenHash", (q) => q.eq("customerLinkTokenHash", hash))
        .unique();
      if (!row || !row.customerLinkExpiresAt || row.customerLinkExpiresAt <= Date.now()) {
        throw notFound("quote");
      }

      const agency = await ctx.db.get(row.agencyId);
      if (!agency || agency.status !== "active") throw notFound("quote");

      // An expired quote holds prices nobody can honour. Accepting one would
      // set a client's expectation at a number the agency may have to walk
      // back, which is worse than asking them to request fresh prices.
      if (Date.now() >= row.expiresAt) {
        throw new AgencyError(
          "quote_expired",
          "this quote has expired — ask your agent for updated prices",
        );
      }

      const tier = String(args.tier);
      const packages = (row.packages ?? []) as TravelPackage[];
      if (!packages.some((p) => p.tier === tier)) throw invalid("unknown package");

      // Already accepted: answer success rather than an error. A traveller who
      // double-taps has done nothing wrong, and the agent already has the
      // first answer.
      if (row.status !== "accepted") {
        await ctx.db.patch(row._id, {
          status: "accepted",
          acceptedAt: Date.now(),
          acceptedTier: tier,
          acceptedNote: args.note?.trim().slice(0, 1000) || undefined,
          updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, notifyQuoteEventRef, {
          agencyId: row.agencyId,
          quoteId: row.quoteId,
          event: "accepted",
          tier,
          note: args.note?.trim().slice(0, 1000),
        });
      }

      return { ok: true as const, tier };
    }),
});

const acceptFromLinkRef = makeFunctionReference<
  "mutation",
  { linkToken: string; tier: string; note?: string },
  { ok: true; tier: string }
>("agency/quotes:acceptFromLink");

/** Public wrapper, mirroring `publicQuote` — the link token is the credential. */
export const acceptQuote = action({
  args: { linkToken: v.string(), tier: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<unknown> =>
    guard("quotes.acceptQuote", async () => {
      if (!args.linkToken || args.linkToken.length < 16 || args.linkToken.length > 200) {
        throw notFound("quote");
      }
      return await ctx.runMutation(acceptFromLinkRef, {
        linkToken: args.linkToken,
        tier: args.tier,
        note: args.note,
      });
    }),
});

/**
 * The traveller's view of a quote. Public by design — the link token IS the
 * credential — and it returns a document that never held the agency's cost,
 * markup or margin.
 */
export const publicQuote = action({
  args: { linkToken: v.string() },
  handler: async (ctx, args): Promise<unknown> =>
    guard("quotes.publicQuote", async () => {
      if (!args.linkToken || args.linkToken.length < 16 || args.linkToken.length > 200) {
        throw notFound("quote");
      }
      return await ctx.runMutation(resolveCustomerLinkRef, { linkToken: args.linkToken });
    }),
});
