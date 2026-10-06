/**
 * Planera for Travel Agencies — from acceptance to confirmation (Convex adapter).
 *
 *   client accepts → client (or agent) enters travellers → agent opens the
 *   booking record → each service is booked, by API where the supplier allows
 *   it or by hand in the agency's own system → references recorded → agent
 *   releases the confirmation to the client's link.
 *
 * MONEY: Planera never takes payment from a traveller. The agency is the seller
 * and collects from its client itself; `payment` below is the agency's own note
 * of what it has received. An API booking is paid from the AGENCY's supplier
 * account (Duffel balance, Hotelbeds credit), on the agency's own credentials.
 *
 * Rules the code enforces, not just documents:
 *  - an API booking runs mutation (lock) → action (supplier) → mutation
 *    (record), and the lock refuses a second attempt while one is in flight;
 *  - a lost response is recorded as "unknown", and "unknown" cannot be retried
 *    from here — only resolved by hand after checking the supplier — because a
 *    retry after a timeout is how a client ends up with two tickets;
 *  - travellers are personal data: readable by the agency's own members only,
 *    never returned through the customer link.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation, mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { NormalizedOffer, PackageTier, TravelPackage } from "./model/types";
import {
  applyManualUpdate,
  fulfilmentStage,
  lockForBooking,
  recordBookingOutcome,
  setPayment as applyPayment,
  startFulfilment as openRecord,
  validateTravellers,
  type BookingOutcome,
  type Fulfilment,
  type TravellerDetails,
} from "./fulfilment";
import { bindingsById, buildBindings, type StoredConnectionRow } from "./runtime";
import { SupplierHttpError } from "./connectors/http";
import { AgencyError, conflict, guard, invalid, notFound } from "./errors";
import { sha256Hex } from "./crypto";
import { assertTenant, audit, consumeLimit, requireAccessRW, vaultMasterKey } from "./store";

const tierArg = v.union(v.literal("basic"), v.literal("comfort"), v.literal("premium"));

const travellerArg = v.object({
  type: v.optional(v.union(v.literal("adult"), v.literal("child"), v.literal("infant"))),
  title: v.union(v.literal("mr"), v.literal("ms"), v.literal("mrs"), v.literal("miss")),
  givenName: v.string(),
  familyName: v.string(),
  bornOn: v.string(),
  gender: v.union(v.literal("m"), v.literal("f")),
});
const contactArg = v.object({ email: v.string(), phone: v.string() });

const bookingStatusArg = v.union(
  v.literal("pending"),
  v.literal("requested"),
  v.literal("confirmed"),
  v.literal("ticketed"),
  v.literal("failed"),
  v.literal("unknown"),
  v.literal("cancelled"),
);

const notifyRef = makeFunctionReference<
  "action",
  {
    agencyId: Id<"agencies">;
    quoteId: string;
    event: "viewed" | "accepted" | "travellers";
    tier?: string;
    note?: string;
  },
  null
>("agency/notify:quoteEvent");

type Party = {
  adults: number;
  childrenAges: number[];
  departDate: string;
  travelers: number;
  rooms?: number;
};

const today = () => new Date().toISOString().slice(0, 10);

/** Once a service is booked, the names on it are the airline's, not ours to change. */
function assertTravellersEditable(f: Fulfilment | undefined) {
  if (f?.lines.some((l) => ["booking", "confirmed", "ticketed", "unknown"].includes(l.status))) {
    throw conflict("services are already booked on these names — change them with the supplier");
  }
}

// ── Travellers ──────────────────────────────────────────────────────────────

/** The agent entering (or correcting) passenger details. */
export const setTravellers = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    travellers: v.array(travellerArg),
    contact: contactArg,
  },
  handler: async (ctx, args) =>
    guard("bookings.setTravellers", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      assertTravellersEditable(row!.fulfilment as Fulfilment | undefined);

      const clean = validateTravellers(
        { travellers: args.travellers.map((t) => ({ ...t, type: t.type ?? "adult" })), contact: args.contact },
        row!.searchParams as Party,
        today(),
      );
      const details: TravellerDetails = { ...clean, submittedAt: Date.now(), submittedBy: "agent" };
      await ctx.db.patch(row!._id, { travellers: details, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "quote.setTravellers",
        targetType: "quote",
        targetId: row!.quoteId,
        meta: { count: clean.travellers.length },
      });
      return { ok: true };
    }),
});

/** The client entering passenger details on their quote link, after accepting. */
export const submitTravellersFromLink = internalMutation({
  args: { linkToken: v.string(), travellers: v.array(travellerArg), contact: contactArg },
  handler: async (ctx, args) =>
    guard("bookings.submitTravellersFromLink", async () => {
      await consumeLimit(ctx, "travellers", args.linkToken.slice(0, 8));
      const hash = await sha256Hex(args.linkToken);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_customerLinkTokenHash", (q) => q.eq("customerLinkTokenHash", hash))
        .unique();
      if (!row || !row.customerLinkExpiresAt || row.customerLinkExpiresAt <= Date.now()) {
        throw notFound("quote");
      }
      if (row.status !== "accepted") {
        throw invalid("choose an option before entering traveller details");
      }
      assertTravellersEditable(row.fulfilment as Fulfilment | undefined);

      const clean = validateTravellers(
        { travellers: args.travellers.map((t) => ({ ...t, type: t.type ?? "adult" })), contact: args.contact },
        row.searchParams as Party,
        today(),
      );
      const first = !row.travellers;
      await ctx.db.patch(row._id, {
        travellers: { ...clean, submittedAt: Date.now(), submittedBy: "client" } satisfies TravellerDetails,
        updatedAt: Date.now(),
      });
      if (first) {
        await ctx.scheduler.runAfter(0, notifyRef, {
          agencyId: row.agencyId,
          quoteId: row.quoteId,
          event: "travellers",
        });
      }
      return { ok: true as const };
    }),
});

const submitTravellersRef = makeFunctionReference<
  "mutation",
  {
    linkToken: string;
    travellers: Array<{
      type?: "adult" | "child" | "infant";
      title: "mr" | "ms" | "mrs" | "miss";
      givenName: string;
      familyName: string;
      bornOn: string;
      gender: "m" | "f";
    }>;
    contact: { email: string; phone: string };
  },
  { ok: true }
>("agency/bookings:submitTravellersFromLink");

/** Public: the link token is the credential, exactly as for reading the quote. */
export const submitTravellers = action({
  args: { linkToken: v.string(), travellers: v.array(travellerArg), contact: contactArg },
  handler: async (ctx, args): Promise<{ ok: true }> =>
    guard("bookings.submitTravellers", async () => {
      if (!args.linkToken || args.linkToken.length < 16 || args.linkToken.length > 200) {
        throw notFound("quote");
      }
      return await ctx.runMutation(submitTravellersRef, args);
    }),
});

// ── The booking record ──────────────────────────────────────────────────────

async function loadForBooking(ctx: Parameters<typeof requireAccessRW>[0], token: string, quoteId: string) {
  const access = await requireAccessRW(ctx, token, "agent");
  const row = await ctx.db
    .query("quotes")
    .withIndex("by_quoteId", (q) => q.eq("quoteId", quoteId))
    .unique();
  assertTenant(access, row);
  return { access, row: row! };
}

/** Open the booking checklist for the accepted option. */
export const startFulfilment = mutation({
  args: { token: v.string(), quoteId: v.string(), tier: v.optional(tierArg) },
  handler: async (ctx, args) =>
    guard("bookings.startFulfilment", async () => {
      const { access, row } = await loadForBooking(ctx, args.token, args.quoteId);
      if (row.status !== "accepted") {
        throw invalid("mark the quote as accepted first — booking starts from the client's yes");
      }
      if (row.fulfilment) throw conflict("booking has already started for this quote");
      const tier = (args.tier ?? row.acceptedTier) as PackageTier | undefined;
      if (!tier) throw invalid("which option did the client choose?");
      const f = openRecord((row.packages ?? []) as TravelPackage[], tier, Date.now(), access.userId);
      await ctx.db.patch(row._id, { fulfilment: f, acceptedTier: tier, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "booking.start",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { tier },
      });
      return { ok: true };
    }),
});

/** Record, by hand, what happened to a service booked in the agency's own system. */
export const updateBookingLine = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    offerId: v.string(),
    status: bookingStatusArg,
    supplierReference: v.optional(v.string()),
    documents: v.optional(v.array(v.string())),
    deadlineISO: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("bookings.updateBookingLine", async () => {
      const { access, row } = await loadForBooking(ctx, args.token, args.quoteId);
      if (!row.fulfilment) throw invalid("start the booking first");
      const f = applyManualUpdate(
        row.fulfilment as Fulfilment,
        args.offerId,
        {
          status: args.status,
          supplierReference: args.supplierReference,
          documents: args.documents,
          deadlineISO: args.deadlineISO,
          note: args.note,
        },
        Date.now(),
        access.userId,
      );
      await ctx.db.patch(row._id, { fulfilment: f, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "booking.updateLine",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { offerId: args.offerId, status: args.status },
      });
      return { ok: true };
    }),
});

/** The agency's own note of what its client has paid it. Not a charge. */
export const setPayment = mutation({
  args: {
    token: v.string(),
    quoteId: v.string(),
    status: v.union(v.literal("unpaid"), v.literal("deposit"), v.literal("paid"), v.literal("refunded")),
    receivedMinor: v.float64(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("bookings.setPayment", async () => {
      const { access, row } = await loadForBooking(ctx, args.token, args.quoteId);
      if (!row.fulfilment) throw invalid("start the booking first");
      const f = applyPayment(
        row.fulfilment as Fulfilment,
        { status: args.status, receivedMinor: Math.round(args.receivedMinor), note: args.note },
        Date.now(),
      );
      await ctx.db.patch(row._id, { fulfilment: f, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "booking.payment",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { status: args.status },
      });
      return { ok: true };
    }),
});

/**
 * Release the confirmation to the client's link: references for every service
 * the agency has confirmed. Deliberate, not automatic — a reference the agent
 * has not checked yet is not something to hand a client.
 */
export const shareConfirmation = mutation({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("bookings.shareConfirmation", async () => {
      const { access, row } = await loadForBooking(ctx, args.token, args.quoteId);
      const f = row.fulfilment as Fulfilment | undefined;
      if (!f) throw invalid("start the booking first");
      if (!f.lines.some((l) => l.status === "confirmed" || l.status === "ticketed")) {
        throw invalid("confirm at least one service before sharing the confirmation");
      }
      const now = Date.now();
      await ctx.db.patch(row._id, { fulfilment: { ...f, confirmationSharedAt: now }, updatedAt: now });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "booking.shareConfirmation",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { stage: fulfilmentStage(f) },
      });
      return { ok: true, linkActive: !!row.customerLinkTokenHash && (row.customerLinkExpiresAt ?? 0) > now };
    }),
});

// ── Booking through the supplier's API ──────────────────────────────────────

interface BookContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  quoteRowId: Id<"quotes">;
  offer: NormalizedOffer;
  travellers: TravellerDetails;
  clientReference: string;
  party: Party;
  connection: StoredConnectionRow;
}

export const beginBooking = internalMutation({
  args: { token: v.string(), quoteId: v.string(), offerId: v.string() },
  handler: async (ctx, args): Promise<BookContext> =>
    guard("bookings.beginBooking", async () => {
      const { access, row } = await loadForBooking(ctx, args.token, args.quoteId);
      await consumeLimit(ctx, "book", access.agencyId);
      const f = row.fulfilment as Fulfilment | undefined;
      if (!f) throw invalid("start the booking first");
      const travellers = row.travellers as TravellerDetails | undefined;
      if (!travellers) throw invalid("enter the travellers' details before booking");
      if (Date.now() >= row.expiresAt) {
        throw new AgencyError(
          "quote_expired",
          "the prices on this quote have expired — revalidate before booking",
        );
      }

      const pkg = ((row.packages ?? []) as TravelPackage[]).find((p) => p.tier === f.tier);
      const line = pkg?.lines.find((l) => l.offer.offerId === args.offerId);
      if (!line) throw notFound("service");
      if (!line.offer.revalidationToken) {
        throw invalid("this supplier gave no booking handle for the offer — book it in your own system");
      }

      const conn = await ctx.db
        .query("supplierConnections")
        .withIndex("by_agency_connector", (q) =>
          q.eq("agencyId", access.agencyId).eq("connectorId", line.offer.connectorId),
        )
        .filter((q) => q.eq(q.field("revokedAt"), undefined))
        .first();
      if (!conn || conn.status !== "active") {
        throw new AgencyError("connector_unavailable", "this supplier is no longer connected");
      }

      // Taken LAST, after every check that can fail: a lock left behind by a
      // refused request would block the line for no reason.
      const locked = lockForBooking(f, args.offerId, Date.now(), access.userId);
      await ctx.db.patch(row._id, { fulfilment: locked, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "booking.apiStart",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { offerId: args.offerId, connectorId: line.offer.connectorId, environment: conn.environment },
      });

      return {
        agencyId: access.agencyId,
        userId: access.userId,
        quoteRowId: row._id,
        offer: line.offer,
        travellers,
        clientReference: row.clientReference || row.quoteId,
        party: row.searchParams as Party,
        connection: {
          connectorId: conn.connectorId,
          environment: conn.environment,
          credentialScheme: conn.credentialScheme,
          encryptedCredentials: conn.encryptedCredentials,
          status: conn.status,
        },
      };
    }),
});

export const finishBooking = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    actorUserId: v.id("agencyUsers"),
    quoteRowId: v.id("quotes"),
    offerId: v.string(),
    outcome: v.any(),
  },
  handler: async (ctx, args) =>
    guard("bookings.finishBooking", async () => {
      const row = await ctx.db.get(args.quoteRowId);
      if (!row || row.agencyId !== args.agencyId) throw notFound("quote");
      const outcome = args.outcome as BookingOutcome;
      const f = recordBookingOutcome(row.fulfilment as Fulfilment, args.offerId, outcome, Date.now());
      await ctx.db.patch(row._id, { fulfilment: f, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.actorUserId,
        action: "booking.apiResult",
        targetType: "quote",
        targetId: row.quoteId,
        meta: { offerId: args.offerId, status: outcome.status, reference: outcome.supplierReference },
      });
      return null;
    }),
});

const beginBookingRef = makeFunctionReference<
  "mutation",
  { token: string; quoteId: string; offerId: string },
  BookContext
>("agency/bookings:beginBooking");

const finishBookingRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    actorUserId: Id<"agencyUsers">;
    quoteRowId: Id<"quotes">;
    offerId: string;
    outcome: BookingOutcome;
  },
  null
>("agency/bookings:finishBooking");

/**
 * What a failed call means for the NEXT attempt. A clear refusal (4xx) is safe
 * to retry after fixing it; no answer, or a server error, may hide an order
 * that was created — that is "unknown", and it blocks retries.
 */
export function classifyBookingError(e: unknown): BookingOutcome {
  const message = (e as Error)?.message ?? String(e);
  if (e instanceof SupplierHttpError) {
    if (e.status >= 400 && e.status < 500 && e.status !== 408) {
      return { status: "failed", message };
    }
    return {
      status: "unknown",
      message: `${message} — the order may have been created; check the supplier before trying again`,
    };
  }
  // Thrown before any request left (bad passenger mapping, missing field).
  return { status: "failed", message };
}

/** Book one service with its supplier, on the agency's own account. */
export const bookLine = action({
  args: { token: v.string(), quoteId: v.string(), offerId: v.string() },
  handler: async (ctx, args): Promise<BookingOutcome> =>
    guard("bookings.bookLine", async () => {
      const c = await ctx.runMutation(beginBookingRef, args);

      let outcome: BookingOutcome;
      try {
        const { bindings, skipped } = await buildBindings(vaultMasterKey(), [c.connection]);
        const binding = bindingsById(bindings).get(c.offer.connectorId);
        if (!binding?.connector.createBooking || !binding.connector.capabilities.supports.createBooking) {
          outcome = {
            status: "failed",
            message:
              skipped[0]?.error ??
              "this supplier cannot take bookings through Planera — book it in your own system and record the reference",
          };
        } else {
          const r = await binding.connector.createBooking(binding.creds, {
            revalidationToken: c.offer.revalidationToken!,
            offer: c.offer,
            passengers: c.travellers.travellers,
            contact: c.travellers.contact,
            clientReference: c.clientReference,
            rooms: c.party.rooms,
            travelDate: c.party.departDate,
            expectedTotal: {
              amountMinor: c.offer.cost.base.amountMinor + c.offer.cost.taxes.amountMinor,
              currency: c.offer.cost.base.currency,
            },
          });
          outcome = r;
        }
      } catch (e) {
        outcome = classifyBookingError(e);
      }

      // Always release the lock with SOME answer, even an ugly one; a line left
      // at "booking" forever would block the agent from recording anything.
      await ctx.runMutation(finishBookingRef, {
        agencyId: c.agencyId,
        actorUserId: c.userId,
        quoteRowId: c.quoteRowId,
        offerId: args.offerId,
        outcome,
      });
      return outcome;
    }),
});
