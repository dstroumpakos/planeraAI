import { v } from "convex/values";
import { authQuery, authMutation } from "./functions";
import { internalMutation, internalQuery } from "./_generated/server";
import { ALIAS_LENGTH } from "./helpers/inboundEmail";

/**
 * Reservation Inbox — the DB surface.
 *
 * Users forward booking confirmations to a personal inbound address; the
 * webhook in http.ts hands the message to `reservationsInbound.parseInboundEmail`
 * (Node action, OpenAI), which calls back into the internal mutations here.
 *
 * Trust model: the inbound alias is the ONLY identity signal we accept. The
 * From header is attacker-controlled free text, so a parse is never trusted to
 * modify a trip on its own — everything lands in "needs_review" and the user
 * confirms. DKIM/SPF results are recorded for display and ranking, not for
 * auto-approval.
 */

// A reservation this far outside the trip window still counts as a match
// (red-eyes, late check-outs, a train the evening before departure).
const TRIP_MATCH_SLACK_MS = 36 * 60 * 60 * 1000;

// Domain the inbound MX record points at. Kept in one place so the client, the
// emails and the webhook agree. Override per-deployment with
// RESERVATION_INBOUND_DOMAIN (e.g. a staging subdomain).
//
// Must stay a subdomain of the apex used everywhere else (planeraai.app — see
// emailHelpers BASE_URL). Pointing an MX record at a domain you don't control
// means every address shown to users silently black-holes.
export const INBOUND_DOMAIN = process.env.RESERVATION_INBOUND_DOMAIN || "in.planeraai.app";

const RESERVATION_TYPE = v.union(
    v.literal("flight"),
    v.literal("hotel"),
    v.literal("car"),
    v.literal("rail"),
    v.literal("ferry"),
    v.literal("activity"),
    v.literal("restaurant"),
    v.literal("other")
);

/**
 * Stable key so re-forwarding the same confirmation updates the existing row
 * instead of creating a duplicate. Not a secret, so no hashing needed — a
 * deterministic string keeps this synchronous in the V8 runtime.
 */
function buildDedupeKey(
    userId: string,
    type: string,
    confirmationCode: string | undefined,
    title: string,
    startAt: number | undefined
): string {
    const identity = (confirmationCode || title || "").trim().toLowerCase();
    // Bucket to the day: the same booking re-sent often differs by seconds.
    const day = startAt ? Math.floor(startAt / 86_400_000) : "";
    return `${userId}|${type}|${identity}|${day}`;
}

/**
 * Normalize a place string for loose comparison ("Barcelona, Spain" → "barcelona spain").
 */
function normalizePlace(value: string | undefined): string {
    if (!value) return "";
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Pick the best trip for a reservation: the window must overlap, then prefer a
 * destination that actually appears in the reservation's location/title.
 * Returns null when nothing overlaps — an unmatched reservation is a valid
 * (and product-relevant) outcome, not a failure.
 */
function pickMatchingTrip(trips: any[], startAt: number | undefined, haystack: string): any | null {
    if (!startAt) return null;

    const overlapping = trips.filter((trip) => {
        if (trip.status === "archived") return false;
        const from = trip.startDate - TRIP_MATCH_SLACK_MS;
        const to = trip.endDate + TRIP_MATCH_SLACK_MS;
        return startAt >= from && startAt <= to;
    });

    if (overlapping.length === 0) return null;
    if (overlapping.length === 1) return overlapping[0];

    const normalizedHaystack = normalizePlace(haystack);
    const byDestination = overlapping.filter((trip) => {
        const tokens = normalizePlace(trip.destination).split(" ").filter((t: string) => t.length > 3);
        return tokens.some((token: string) => normalizedHaystack.includes(token));
    });
    if (byDestination.length > 0) return byDestination[0];

    // Ambiguous on dates alone — take the trip whose start is nearest.
    return overlapping.sort(
        (a, b) => Math.abs(a.startDate - startAt) - Math.abs(b.startDate - startAt)
    )[0];
}

// ---------------------------------------------------------------------------
// Internal — called by the inbound pipeline
// ---------------------------------------------------------------------------

/**
 * Resolve an inbound alias to its owner. Returns null for unknown aliases so
 * the webhook can 200-and-drop (never leak which aliases exist).
 */
export const getUserByAlias = internalQuery({
    args: { alias: v.string() },
    handler: async (ctx, args) => {
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_reservationAlias", (q) => q.eq("reservationAlias", args.alias))
            .unique();
        if (!settings) return null;
        return { userId: settings.userId, language: settings.language ?? "en" };
    },
});

/**
 * Insert (or update, on re-forward) a parsed reservation and attach it to a
 * trip when the dates line up.
 */
export const upsertFromEmail = internalMutation({
    args: {
        userId: v.string(),
        type: RESERVATION_TYPE,
        title: v.string(),
        provider: v.optional(v.string()),
        confirmationCode: v.optional(v.string()),
        startAt: v.optional(v.float64()),
        endAt: v.optional(v.float64()),
        location: v.optional(v.string()),
        price: v.optional(v.float64()),
        currency: v.optional(v.string()),
        details: v.optional(v.any()),
        senderVerified: v.optional(v.boolean()),
        sourceFrom: v.optional(v.string()),
        sourceSubject: v.optional(v.string()),
        parseConfidence: v.optional(v.float64()),
        parseModel: v.optional(v.string()),
        isCancellation: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const dedupeKey = buildDedupeKey(
            args.userId,
            args.type,
            args.confirmationCode,
            args.title,
            args.startAt
        );

        const existing = await ctx.db
            .query("tripReservations")
            .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
            .first();

        // A cancellation email for a booking we know about flips it rather than
        // adding a second row.
        if (existing && args.isCancellation) {
            await ctx.db.patch(existing._id, { status: "cancelled", updatedAt: now });
            return { reservationId: existing._id, action: "cancelled" as const, tripId: existing.tripId ?? null };
        }

        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect();

        const haystack = [args.location, args.title, args.details?.arrivalCity, args.details?.city]
            .filter(Boolean)
            .join(" ");
        const matched = pickMatchingTrip(trips, args.startAt, haystack);

        if (existing) {
            await ctx.db.patch(existing._id, {
                // Re-forwarded confirmations are usually more complete than the
                // first one (e-tickets follow reservations), so we take the new
                // values but never downgrade a user decision back to review.
                title: args.title,
                provider: args.provider ?? existing.provider,
                confirmationCode: args.confirmationCode ?? existing.confirmationCode,
                startAt: args.startAt ?? existing.startAt,
                endAt: args.endAt ?? existing.endAt,
                location: args.location ?? existing.location,
                price: args.price ?? existing.price,
                currency: args.currency ?? existing.currency,
                details: args.details ?? existing.details,
                tripId: existing.tripId ?? (matched?._id as any),
                senderVerified: args.senderVerified ?? existing.senderVerified,
                parseConfidence: args.parseConfidence ?? existing.parseConfidence,
                updatedAt: now,
            });
            return { reservationId: existing._id, action: "updated" as const, tripId: (existing.tripId ?? matched?._id ?? null) as any };
        }

        const reservationId = await ctx.db.insert("tripReservations", {
            userId: args.userId,
            tripId: matched?._id,
            type: args.type,
            title: args.title,
            provider: args.provider,
            confirmationCode: args.confirmationCode,
            startAt: args.startAt,
            endAt: args.endAt,
            location: args.location,
            price: args.price,
            currency: args.currency,
            details: args.details,
            source: "email",
            senderVerified: args.senderVerified,
            sourceFrom: args.sourceFrom,
            sourceSubject: args.sourceSubject,
            parseConfidence: args.parseConfidence,
            parseModel: args.parseModel,
            status: args.isCancellation ? "cancelled" : "needs_review",
            dedupeKey,
            createdAt: now,
            updatedAt: now,
        });

        return { reservationId, action: "created" as const, tripId: (matched?._id ?? null) as any };
    },
});

// ---------------------------------------------------------------------------
// Client surface
// ---------------------------------------------------------------------------

/**
 * Return (creating on first call) this user's personal forwarding address.
 * A mutation because the alias is minted lazily.
 */
export const ensureInboundAddress = authMutation({
    args: {},
    handler: async (ctx: any) => {
        const userId = ctx.user.userId;
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .unique();

        if (!settings) throw new Error("User settings not found");

        if (settings.reservationAlias) {
            return { alias: settings.reservationAlias, domain: INBOUND_DOMAIN };
        }

        // 16 hex chars = 64 bits from crypto.randomUUID. Knowing this alias is
        // enough to post reservations into the account, so it is sized to
        // survive guessing (ALIAS_LENGTH / the matching pattern live in
        // helpers/inboundEmail.ts — keep them in step).
        const alias = crypto.randomUUID().replace(/-/g, "").slice(0, ALIAS_LENGTH);
        await ctx.db.patch(settings._id, { reservationAlias: alias });
        return { alias, domain: INBOUND_DOMAIN };
    },
});

/**
 * All reservations for the signed-in user, newest first, with the matched trip
 * summarized inline so the inbox can render without a second round trip.
 */
export const listMine = authQuery({
    args: { includeRejected: v.optional(v.boolean()) },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const rows = await ctx.db
            .query("tripReservations")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();

        const visible = rows.filter((r: any) =>
            args.includeRejected ? true : r.status !== "rejected"
        );

        const tripCache = new Map<string, any>();
        const items = [];
        for (const row of visible) {
            let trip = null;
            if (row.tripId) {
                const key = String(row.tripId);
                if (!tripCache.has(key)) {
                    const doc = await ctx.db.get(row.tripId);
                    tripCache.set(
                        key,
                        doc ? { _id: doc._id, destination: doc.destination, startDate: doc.startDate, endDate: doc.endDate } : null
                    );
                }
                trip = tripCache.get(key);
            }
            items.push({ ...row, trip });
        }

        items.sort((a: any, b: any) => (b.startAt ?? b.createdAt) - (a.startAt ?? a.createdAt));

        return {
            items,
            needsReviewCount: items.filter((i: any) => i.status === "needs_review").length,
            unmatchedCount: items.filter((i: any) => !i.tripId && i.status !== "rejected").length,
        };
    },
});

/**
 * Confirmed reservations for one trip — what the trip detail screen renders
 * alongside the AI itinerary.
 */
export const listForTrip = authQuery({
    args: { tripId: v.id("trips") },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return { items: [] };

        // Owner or an accepted collaborator may read.
        let allowed = trip.userId === userId;
        if (!allowed) {
            const collab = await ctx.db
                .query("tripCollaborators")
                .withIndex("by_trip_user", (q: any) => q.eq("tripId", args.tripId).eq("userId", userId))
                .unique();
            allowed = !!collab;
        }
        if (!allowed) return { items: [] };

        const rows = await ctx.db
            .query("tripReservations")
            .withIndex("by_trip", (q: any) => q.eq("tripId", args.tripId))
            .collect();

        const items = rows
            .filter((r: any) => r.status === "confirmed")
            .sort((a: any, b: any) => (a.startAt ?? 0) - (b.startAt ?? 0));

        return { items };
    },
});

async function requireOwnedReservation(ctx: any, reservationId: any) {
    const row = await ctx.db.get(reservationId);
    if (!row) throw new Error("Reservation not found");
    if (row.userId !== ctx.user.userId) throw new Error("Not authorized");
    return row;
}

export const confirmReservation = authMutation({
    args: { reservationId: v.id("tripReservations"), tripId: v.optional(v.id("trips")) },
    handler: async (ctx: any, args: any) => {
        const row = await requireOwnedReservation(ctx, args.reservationId);

        let tripId = args.tripId ?? row.tripId;
        if (args.tripId) {
            const trip = await ctx.db.get(args.tripId);
            if (!trip || trip.userId !== ctx.user.userId) throw new Error("Trip not found");
            tripId = args.tripId;
        }

        await ctx.db.patch(row._id, {
            status: "confirmed",
            tripId,
            reviewedAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { success: true, tripId: tripId ?? null };
    },
});

export const rejectReservation = authMutation({
    args: { reservationId: v.id("tripReservations") },
    handler: async (ctx: any, args: any) => {
        const row = await requireOwnedReservation(ctx, args.reservationId);
        await ctx.db.patch(row._id, {
            status: "rejected",
            reviewedAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { success: true };
    },
});

/** Move a reservation to a different trip (or detach it with tripId omitted). */
export const assignToTrip = authMutation({
    args: { reservationId: v.id("tripReservations"), tripId: v.optional(v.id("trips")) },
    handler: async (ctx: any, args: any) => {
        const row = await requireOwnedReservation(ctx, args.reservationId);
        if (args.tripId) {
            const trip = await ctx.db.get(args.tripId);
            if (!trip || trip.userId !== ctx.user.userId) throw new Error("Trip not found");
        }
        await ctx.db.patch(row._id, { tripId: args.tripId, updatedAt: Date.now() });
        return { success: true };
    },
});

export const deleteReservation = authMutation({
    args: { reservationId: v.id("tripReservations") },
    handler: async (ctx: any, args: any) => {
        const row = await requireOwnedReservation(ctx, args.reservationId);
        await ctx.db.delete(row._id);
        return { success: true };
    },
});

/**
 * Manually add a reservation (the escape hatch when an email won't parse, and
 * the path used by the "add booking" sheet).
 */
export const addManual = authMutation({
    args: {
        type: RESERVATION_TYPE,
        title: v.string(),
        provider: v.optional(v.string()),
        confirmationCode: v.optional(v.string()),
        startAt: v.optional(v.float64()),
        endAt: v.optional(v.float64()),
        location: v.optional(v.string()),
        price: v.optional(v.float64()),
        currency: v.optional(v.string()),
        tripId: v.optional(v.id("trips")),
    },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const now = Date.now();

        if (args.tripId) {
            const trip = await ctx.db.get(args.tripId);
            if (!trip || trip.userId !== userId) throw new Error("Trip not found");
        }

        const reservationId = await ctx.db.insert("tripReservations", {
            userId,
            tripId: args.tripId,
            type: args.type,
            title: args.title,
            provider: args.provider,
            confirmationCode: args.confirmationCode,
            startAt: args.startAt,
            endAt: args.endAt,
            location: args.location,
            price: args.price,
            currency: args.currency,
            source: "manual",
            // Typed by the user themselves — no review step needed.
            status: "confirmed",
            dedupeKey: buildDedupeKey(userId, args.type, args.confirmationCode, args.title, args.startAt),
            createdAt: now,
            updatedAt: now,
            reviewedAt: now,
        });

        return { success: true, reservationId };
    },
});
