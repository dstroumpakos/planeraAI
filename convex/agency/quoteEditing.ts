/**
 * Planera for Travel Agencies — editing a quote (Convex adapter).
 *
 * Thin by design: every rule lives in the pure `quoteEdit.ts`; this file
 * authorises, loads, calls it, and writes. Each edit is one small mutation so
 * the UI can apply a change the moment the agent makes it, and the audit log
 * reads as a list of the decisions the agent actually took.
 *
 * What an edit invalidates, on purpose:
 *  - the last revalidation verdict (it was about different lines),
 *  - the AI copy, which is re-written a few seconds after the LAST edit in a
 *    burst — not once per click, see `copyRevision`.
 * What it does NOT touch: the quote's expiry. Swapping in an alternative the
 * agent already holds does not make any price fresher.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { NormalizedOffer, PackageTier, TravelPackage } from "./model/types";
import {
  copyTier,
  findCandidate,
  mergePool,
  moveLine,
  putLine,
  removeLine,
  setLineNote,
  setLinePrice,
  updateTier,
  buildManualLine,
  type AlternativesPool,
} from "./quoteEdit";
import { priceLines, type PricingRuleRow } from "./quote";
import { syncFulfilment, type Fulfilment } from "./fulfilment";
import { searchForQuote, type ConnectorRunResult } from "./orchestrator";
import { buildBindings, type StoredConnectionRow } from "./runtime";
import { autoResolveMissing } from "./destinationMap";
import { scrubOffer } from "./quoteView";
import { AgencyError, conflict, guard, invalid, notFound } from "./errors";
import { newToken } from "./crypto";
import {
  assertTenant,
  audit,
  consumeLimit,
  requireAccessRW,
  vaultMasterKey,
  type AgencyAccess,
} from "./store";
import { normalizeIata, validateDateRange } from "./validation";

const tierArg = v.union(v.literal("basic"), v.literal("comfort"), v.literal("premium"));

/** Quiet period before the copy is re-written, so a burst of edits costs one call. */
const COPY_DEBOUNCE_MS = 8_000;

const generateCopyRef = makeFunctionReference<
  "action",
  { quoteId: string; agencyId: Id<"agencies">; revision?: number },
  null
>("agency/packageCopy:generate");

// ── Shared load / commit ────────────────────────────────────────────────────

async function loadEditable(
  ctx: MutationCtx,
  token: string,
  quoteId: string,
): Promise<{ access: AgencyAccess; row: Doc<"quotes"> }> {
  const access = await requireAccessRW(ctx, token, "agent");
  await consumeLimit(ctx, "quoteEdit", access.agencyId);
  const row = await ctx.db
    .query("quotes")
    .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
    .unique();
  assertTenant(access, row);
  if (row!.status === "revalidating") {
    throw conflict("the suppliers are being re-checked — try again in a moment");
  }
  const f = row!.fulfilment as Fulfilment | undefined;
  if (f?.lines.some((l) => l.status === "booking")) {
    throw conflict("a booking is being made for this quote — wait for it to finish");
  }
  return { access, row: row! };
}

async function commit(
  ctx: MutationCtx,
  access: AgencyAccess,
  row: Doc<"quotes">,
  packages: TravelPackage[],
  action: string,
  meta: Record<string, unknown>,
  extra: Partial<Doc<"quotes">> = {},
): Promise<void> {
  const now = Date.now();
  const revision = (row.copyRevision ?? 0) + 1;
  const fulfilment = row.fulfilment
    ? syncFulfilment(row.fulfilment as Fulfilment, packages, now)
    : undefined;

  await ctx.db.patch(row._id, {
    packages,
    // The verdict was about different lines. Showing it next to the new ones
    // would tell the agent something unchecked had been checked.
    revalidation: undefined,
    copyRevision: revision,
    ...(fulfilment ? { fulfilment } : {}),
    ...extra,
    updatedAt: now,
  });
  await audit(ctx, {
    agencyId: access.agencyId,
    actorUserId: access.userId,
    action,
    targetType: "quote",
    targetId: row.quoteId,
    meta,
  });
  await ctx.scheduler.runAfter(COPY_DEBOUNCE_MS, generateCopyRef, {
    quoteId: row.quoteId,
    agencyId: access.agencyId,
    revision,
  });
}

const packagesOf = (row: Doc<"quotes">) => (row.packages ?? []) as TravelPackage[];
const poolOf = (row: Doc<"quotes">) => (row.alternatives ?? {}) as AlternativesPool;

// ── Line edits ──────────────────────────────────────────────────────────────

/**
 * Put a candidate into an option: replace line `lineIndex`, or add it when no
 * index is given. The candidate comes from the quote's own alternatives pool
 * or another option — never from the client, which could otherwise post any
 * price it liked.
 */
export const swapLine = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    lineIndex: v.optional(v.float64()),
    offerId: v.string(),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.swapLine", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const candidate = findCandidate(poolOf(row), packagesOf(row), args.offerId);
      if (!candidate) throw notFound("option");
      const packages = putLine(packagesOf(row), args.tier, candidate, row.currency, args.lineIndex);
      await commit(ctx, access, row, packages, args.lineIndex === undefined ? "quote.addLine" : "quote.swapLine", {
        tier: args.tier,
        offerId: args.offerId,
      });
      return { ok: true };
    }),
});

export const removeQuoteLine = mutation({
  args: { token: v.string(), quoteId: v.string(), tier: tierArg, lineIndex: v.float64() },
  handler: async (ctx, args) =>
    guard("quoteEditing.removeLine", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = removeLine(packagesOf(row), args.tier, args.lineIndex, row.currency);
      await commit(ctx, access, row, packages, "quote.removeLine", { tier: args.tier });
      return { ok: true };
    }),
});

export const moveQuoteLine = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    lineIndex: v.float64(),
    direction: v.union(v.literal(-1), v.literal(1)),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.moveLine", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = moveLine(packagesOf(row), args.tier, args.lineIndex, args.direction, row.currency);
      await commit(ctx, access, row, packages, "quote.moveLine", { tier: args.tier });
      return { ok: true };
    }),
});

export const addManualLine = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    category: v.union(
      v.literal("flight"),
      v.literal("hotel"),
      v.literal("transfer"),
      v.literal("activity"),
      v.literal("ferry"),
      v.literal("car"),
      v.literal("insurance"),
      v.literal("guide"),
      v.literal("other"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    supplierName: v.optional(v.string()),
    supplierCostMinor: v.float64(),
    customerPriceMinor: v.float64(),
    refundable: v.boolean(),
    clientNote: v.optional(v.string()),
    /** Replace this line instead of adding. */
    lineIndex: v.optional(v.float64()),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.addManualLine", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const id = newToken().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
      const line = buildManualLine(
        {
          category: args.category,
          title: args.title,
          description: args.description,
          supplierName: args.supplierName,
          supplierCostMinor: Math.round(args.supplierCostMinor),
          customerPriceMinor: Math.round(args.customerPriceMinor),
          refundable: args.refundable,
          clientNote: args.clientNote,
        },
        row.currency,
        Date.now(),
        id,
      );
      const packages = putLine(packagesOf(row), args.tier, line, row.currency, args.lineIndex);
      await commit(ctx, access, row, packages, "quote.addManualLine", {
        tier: args.tier,
        category: args.category,
      });
      return { ok: true, offerId: line.offer.offerId };
    }),
});

export const setQuoteLinePrice = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    lineIndex: v.float64(),
    customerPriceMinor: v.float64(),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.setLinePrice", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = setLinePrice(
        packagesOf(row),
        args.tier,
        args.lineIndex,
        Math.round(args.customerPriceMinor),
        row.currency,
      );
      await commit(ctx, access, row, packages, "quote.setLinePrice", { tier: args.tier });
      return { ok: true };
    }),
});

export const setQuoteLineNote = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    lineIndex: v.float64(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.setLineNote", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = setLineNote(packagesOf(row), args.tier, args.lineIndex, args.note, row.currency);
      await commit(ctx, access, row, packages, "quote.setLineNote", { tier: args.tier });
      return { ok: true };
    }),
});

// ── Tier edits ──────────────────────────────────────────────────────────────

export const updateQuoteTier = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    tier: tierArg,
    customTitle: v.optional(v.union(v.string(), v.null())),
    hidden: v.optional(v.boolean()),
  },
  handler: async (ctx, args) =>
    guard("quoteEditing.updateTier", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = updateTier(packagesOf(row), args.tier, {
        customTitle: args.customTitle,
        hidden: args.hidden,
      });
      await commit(ctx, access, row, packages, "quote.updateTier", {
        tier: args.tier,
        hidden: args.hidden,
      });
      return { ok: true };
    }),
});

export const copyQuoteTier = mutation({
  args: { token: v.string(), quoteId: v.string(), from: tierArg, to: tierArg },
  handler: async (ctx, args) =>
    guard("quoteEditing.copyTier", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const packages = copyTier(packagesOf(row), args.from, args.to, row.currency);
      await commit(ctx, access, row, packages, "quote.copyTier", { from: args.from, to: args.to });
      return { ok: true };
    }),
});

export const setRequestText = mutation({
  args: { token: v.string(), quoteId: v.string(), requestText: v.string() },
  handler: async (ctx, args) =>
    guard("quoteEditing.setRequestText", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      await ctx.db.patch(row._id, {
        requestText: args.requestText.trim().slice(0, 8000) || undefined,
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "quote.setRequestText",
        targetType: "quote",
        targetId: row.quoteId,
      });
      return { ok: true };
    }),
});

/** Re-write the client-facing copy now, e.g. after the agent finished editing. */
export const regenerateCopy = mutation({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("quoteEditing.regenerateCopy", async () => {
      const { access, row } = await loadEditable(ctx, args.token, args.quoteId);
      const revision = (row.copyRevision ?? 0) + 1;
      await ctx.db.patch(row._id, { copyRevision: revision, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, generateCopyRef, {
        quoteId: row.quoteId,
        agencyId: access.agencyId,
        revision,
      });
      return { ok: true };
    }),
});

// ── Add-on search ───────────────────────────────────────────────────────────
//
// The first search prices ONE trip shape. Tailor-made trips rarely are one:
// two nights in Rome then three in Florence, an extra night before the
// cruise, a return from a different airport. An add-on search prices one more
// kind, for any place and dates, and drops the results into the quote's
// alternatives — from there the agent adds them to whichever option.

const addOnKind = v.union(
  v.literal("flight"),
  v.literal("hotel"),
  v.literal("activity"),
  v.literal("transfer"),
);

interface AddOnContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  quoteRowId: Id<"quotes">;
  currency: string;
  query: {
    originIata: string;
    destinationIata: string;
    departDate: string;
    returnDate?: string;
    adults: number;
    childrenAges: number[];
    rooms: number;
    cabinClass?: string;
  };
  travelers: number;
  rules: PricingRuleRow[];
  connections: StoredConnectionRow[];
  destinationIds: Record<string, string>;
  /** Connectors with any mapping row for the destination, resolved or not. */
  mappedConnectorIds: string[];
}

export const beginAddOnSearch = internalMutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    kind: addOnKind,
    originIata: v.optional(v.string()),
    destinationIata: v.optional(v.string()),
    departDate: v.optional(v.string()),
    returnDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AddOnContext> =>
    guard("beginAddOnSearch", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      await consumeLimit(ctx, "addOnSearch", access.agencyId);

      const sp = row!.searchParams as {
        originIata: string;
        destinationIata: string;
        departDate: string;
        returnDate?: string;
        adults: number;
        childrenAges: number[];
        rooms?: number;
        cabinClass?: string;
        travelers: number;
      };
      const originIata = normalizeIata(args.originIata || sp.originIata, "origin");
      const destinationIata = normalizeIata(args.destinationIata || sp.destinationIata, "destination");
      if (args.kind === "flight" && originIata === destinationIata) {
        throw invalid("origin and destination must differ");
      }
      const departDate = args.departDate || sp.departDate;
      // An explicit one-way add-on (a departure but no return) stays one-way.
      const returnDate = args.departDate ? args.returnDate || undefined : sp.returnDate;
      const dates = validateDateRange(departDate, returnDate, Date.now());
      if (args.kind === "hotel" && !dates.returnDate) {
        throw invalid("a hotel search needs a check-out date");
      }

      const rules = (
        await ctx.db
          .query("agencyPricingRules")
          .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
          .collect()
      ).map((r) => ({ scope: r.scope, selector: r.selector, rule: r.rule, active: r.active })) as PricingRuleRow[];

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
        throw new AgencyError("connector_unavailable", "connect at least one supplier before searching");
      }

      const destinationIds: Record<string, string> = {};
      const mappedConnectorIds: string[] = [];
      for (const c of connections) {
        const mapping = await ctx.db
          .query("agencyDestinationMappings")
          .withIndex("by_agency_connector_iata", (q) =>
            q.eq("agencyId", access.agencyId).eq("connectorId", c.connectorId).eq("iata", destinationIata),
          )
          .unique();
        if (mapping) mappedConnectorIds.push(c.connectorId);
        if (mapping?.status === "resolved" && mapping.destinationId) {
          destinationIds[c.connectorId] = mapping.destinationId;
        }
      }

      return {
        agencyId: access.agencyId,
        userId: access.userId,
        quoteRowId: row!._id,
        currency: row!.currency,
        query: {
          originIata,
          destinationIata,
          departDate: dates.departDate,
          returnDate: dates.returnDate,
          adults: sp.adults,
          childrenAges: sp.childrenAges ?? [],
          rooms: sp.rooms ?? 1,
          cabinClass: sp.cabinClass,
        },
        travelers: sp.travelers,
        rules,
        connections,
        destinationIds,
        mappedConnectorIds,
      };
    }),
});

export const finishAddOnSearch = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    actorUserId: v.id("agencyUsers"),
    quoteRowId: v.id("quotes"),
    kind: addOnKind,
    lines: v.any(),
    label: v.string(),
  },
  handler: async (ctx, args) =>
    guard("finishAddOnSearch", async () => {
      const row = await ctx.db.get(args.quoteRowId);
      if (!row || row.agencyId !== args.agencyId) throw notFound("quote");
      const pool = mergePool((row.alternatives ?? {}) as AlternativesPool, {
        [args.kind]: args.lines,
      });
      await ctx.db.patch(row._id, { alternatives: pool, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.actorUserId,
        action: "quote.addOnSearch",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { kind: args.kind, found: (args.lines as unknown[]).length, search: args.label },
      });
      return null;
    }),
});

const beginAddOnRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    quoteId: string;
    kind: "flight" | "hotel" | "activity" | "transfer";
    originIata?: string;
    destinationIata?: string;
    departDate?: string;
    returnDate?: string;
  },
  AddOnContext
>("agency/quoteEditing:beginAddOnSearch");

const finishAddOnRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    actorUserId: Id<"agencyUsers">;
    quoteRowId: Id<"quotes">;
    kind: "flight" | "hotel" | "activity" | "transfer";
    lines: unknown;
    label: string;
  },
  null
>("agency/quoteEditing:finishAddOnSearch");

export const addOnSearch = action({
  args: {
    token: v.string(),
    quoteId: v.string(),
    kind: addOnKind,
    originIata: v.optional(v.string()),
    destinationIata: v.optional(v.string()),
    departDate: v.optional(v.string()),
    returnDate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ found: number; offerIds: string[]; diagnostics: ConnectorRunResult[] }> =>
    guard("quoteEditing.addOnSearch", async () => {
      const c = await ctx.runMutation(beginAddOnRef, args);
      const { bindings, skipped } = await buildBindings(vaultMasterKey(), c.connections);
      const destinationIds = await autoResolveMissing(ctx, {
        agencyId: c.agencyId,
        iata: c.query.destinationIata,
        bindings,
        mappedConnectorIds: c.mappedConnectorIds,
        kinds: [args.kind],
        destinationIds: c.destinationIds,
      });
      const found = bindings.length
        ? await searchForQuote(
            bindings,
            { ...c.query, sellCurrency: c.currency },
            undefined,
            destinationIds,
            [args.kind],
          )
        : { flights: [], hotels: [], activities: [], transfers: [], diagnostics: [] };

      const offers: NormalizedOffer[] =
        args.kind === "flight"
          ? found.flights
          : args.kind === "hotel"
            ? found.hotels
            : args.kind === "activity"
              ? found.activities
              : found.transfers;

      const lines = priceLines(offers, c.rules, {
        travelers: c.travelers,
        currency: c.currency,
        destinationIata: c.query.destinationIata,
      })
        .sort((a, b) => a.financials.customerPrice.amountMinor - b.financials.customerPrice.amountMinor)
        .slice(0, 25)
        .map((l) => ({ ...l, offer: scrubOffer(l.offer, true) }));

      const q = c.query;
      await ctx.runMutation(finishAddOnRef, {
        agencyId: c.agencyId,
        actorUserId: c.userId,
        quoteRowId: c.quoteRowId,
        kind: args.kind,
        lines,
        label: `${q.originIata}-${q.destinationIata} ${q.departDate}${q.returnDate ? `/${q.returnDate}` : ""}`,
      });

      return {
        found: lines.length,
        offerIds: lines.map((l) => l.offer.offerId),
        diagnostics: [...skipped, ...found.diagnostics],
      };
    }),
});


