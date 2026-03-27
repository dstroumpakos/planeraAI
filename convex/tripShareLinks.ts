import { query } from "./_generated/server";
import { v } from "convex/values";
import { authMutation } from "./functions";

function generateShareToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

/** Create a shareable link for a trip (30-day expiry) */
export const createShareLink = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Unauthorized");

        // Reuse existing non-expired link if one exists
        const existing = await ctx.db
            .query("tripShareLinks")
            .withIndex("by_trip", (q: any) => q.eq("tripId", args.tripId))
            .collect();

        const now = Date.now();
        const valid = existing.find((l: any) => l.expiresAt > now);
        if (valid) {
            return { token: valid.token, expiresAt: valid.expiresAt };
        }

        const shareToken = generateShareToken();
        const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

        await ctx.db.insert("tripShareLinks", {
            tripId: args.tripId,
            userId: ctx.user.userId,
            token: shareToken,
            expiresAt,
            createdAt: now,
        });

        return { token: shareToken, expiresAt };
    },
});

/** Get a shared trip by its token (public — no auth required) */
export const getByToken = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        const link = await ctx.db
            .query("tripShareLinks")
            .withIndex("by_token", (q) => q.eq("token", args.token))
            .unique();

        if (!link) return null;
        if (link.expiresAt < Date.now()) return null;

        const trip = await ctx.db.get(link.tripId);
        if (!trip) return null;

        // Return a sanitized read-only view (no userId or sensitive data)
        return {
            destination: trip.destination,
            origin: trip.origin,
            startDate: trip.startDate,
            endDate: trip.endDate,
            itinerary: trip.itinerary,
            tripType: trip.tripType,
            status: trip.status,
        };
    },
});
