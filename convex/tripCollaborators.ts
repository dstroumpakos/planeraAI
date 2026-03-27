import { query } from "./_generated/server";
import { v } from "convex/values";
import { authQuery, authMutation } from "./functions";

function generateInviteToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 24; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

/** List collaborators for a trip */
export const list = authQuery({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
    },
    handler: async (ctx: any, args: any) => {
        return await ctx.db
            .query("tripCollaborators")
            .withIndex("by_trip", (q: any) => q.eq("tripId", args.tripId))
            .collect();
    },
});

/** Create an invite link for a trip (owner only) */
export const createInvite = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        role: v.union(v.literal("editor"), v.literal("viewer")),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Only the trip owner can invite");

        const inviteToken = generateInviteToken();

        await ctx.db.insert("tripCollaborators", {
            tripId: args.tripId,
            userId: "", // placeholder until someone accepts
            role: args.role,
            inviteToken,
            joinedAt: Date.now(),
        });

        return { inviteToken };
    },
});

/** Accept an invite and join a trip */
export const acceptInvite = authMutation({
    args: {
        token: v.string(),
        inviteToken: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        const invite = await ctx.db
            .query("tripCollaborators")
            .withIndex("by_invite_token", (q: any) => q.eq("inviteToken", args.inviteToken))
            .unique();

        if (!invite) throw new Error("Invalid invite");
        if (invite.userId && invite.userId !== "") throw new Error("Invite already used");

        // Check they aren't already a collaborator
        const existing = await ctx.db
            .query("tripCollaborators")
            .withIndex("by_trip_user", (q: any) =>
                q.eq("tripId", invite.tripId).eq("userId", ctx.user.userId)
            )
            .unique();

        if (existing) throw new Error("Already a collaborator");

        // Claim the invite
        await ctx.db.patch(invite._id, {
            userId: ctx.user.userId,
            inviteToken: undefined,
            joinedAt: Date.now(),
        });

        return { tripId: invite.tripId, role: invite.role };
    },
});

/** Remove a collaborator (owner only) */
export const remove = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
        collaboratorId: v.id("tripCollaborators"),
    },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip) throw new Error("Trip not found");
        if (trip.userId !== ctx.user.userId) throw new Error("Only the trip owner can remove collaborators");

        const collab = await ctx.db.get(args.collaboratorId);
        if (!collab || collab.tripId !== args.tripId) throw new Error("Collaborator not found");

        await ctx.db.delete(args.collaboratorId);
    },
});

/** Leave a trip (non-owner collaborator) */
export const leave = authMutation({
    args: {
        token: v.string(),
        tripId: v.id("trips"),
    },
    handler: async (ctx: any, args: any) => {
        const collab = await ctx.db
            .query("tripCollaborators")
            .withIndex("by_trip_user", (q: any) =>
                q.eq("tripId", args.tripId).eq("userId", ctx.user.userId)
            )
            .unique();

        if (!collab) throw new Error("Not a collaborator");
        if (collab.role === "owner") throw new Error("Owner cannot leave");

        await ctx.db.delete(collab._id);
    },
});

/** Get trips where user is a collaborator (for listing on home screen) */
export const getMyCollaborations = authQuery({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        const collabs = await ctx.db
            .query("tripCollaborators")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .collect();

        const trips = [];
        for (const c of collabs) {
            const trip = await ctx.db.get(c.tripId);
            if (trip) {
                trips.push({ ...trip, collaboratorRole: c.role });
            }
        }
        return trips;
    },
});

/** Get invite info by token (public — for preview before accepting) */
export const getInviteInfo = query({
    args: { inviteToken: v.string() },
    handler: async (ctx, args) => {
        const invite = await ctx.db
            .query("tripCollaborators")
            .withIndex("by_invite_token", (q) => q.eq("inviteToken", args.inviteToken))
            .unique();

        if (!invite || (invite.userId && invite.userId !== "")) return null;

        const trip = await ctx.db.get(invite.tripId);
        if (!trip) return null;

        return {
            destination: trip.destination,
            startDate: trip.startDate,
            endDate: trip.endDate,
            role: invite.role,
            tripId: invite.tripId,
        };
    },
});
