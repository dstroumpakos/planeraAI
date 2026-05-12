/**
 * Admin: OTA partners & packages management.
 * Reuses the same admin check pattern as convex/admin.ts.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertAdmin } from "./admin";

// Helper to get userId from token (mirrors admin.ts pattern)
async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
    const session = await ctx.db
        .query("sessions")
        .withIndex("by_token", (q: any) => q.eq("token", token))
        .first();
    if (!session || session.expiresAt < Date.now()) return null;
    return session.userId;
}

async function requireAdmin(ctx: any, token: string): Promise<string> {
    const userId = await getUserIdFromToken(ctx, token);
    if (!userId) throw new Error("Unauthorized");
    await assertAdmin(ctx, userId);
    return userId;
}

// ─────────────────────────────────────────────────────────
// Partners
// ─────────────────────────────────────────────────────────

export const listPartners = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        const partners = await ctx.db.query("otaPartners").order("desc").collect();
        return partners;
    },
});

export const createPartner = mutation({
    args: {
        token: v.string(),
        name: v.string(),
        slug: v.string(),
        description: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        contactEmail: v.string(),
        ccEmails: v.optional(v.array(v.string())),
        phone: v.optional(v.string()),
        disclaimer: v.optional(v.string()),
        active: v.boolean(),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        if (!args.name.trim()) throw new Error("Name required");
        if (!args.slug.trim()) throw new Error("Slug required");
        if (!args.contactEmail.trim()) throw new Error("Contact email required");

        const existing = await ctx.db
            .query("otaPartners")
            .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
            .first();
        if (existing) throw new Error("Slug already in use");

        const id = await ctx.db.insert("otaPartners", {
            name: args.name.trim(),
            slug: args.slug.trim(),
            description: args.description?.trim() || undefined,
            logoUrl: args.logoUrl?.trim() || undefined,
            websiteUrl: args.websiteUrl?.trim() || undefined,
            contactEmail: args.contactEmail.trim(),
            ccEmails: args.ccEmails?.filter(e => e.trim()).map(e => e.trim()),
            phone: args.phone?.trim() || undefined,
            disclaimer: args.disclaimer?.trim() || undefined,
            active: args.active,
            createdAt: Date.now(),
        });
        return id;
    },
});

export const updatePartner = mutation({
    args: {
        token: v.string(),
        partnerId: v.id("otaPartners"),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
        websiteUrl: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        ccEmails: v.optional(v.array(v.string())),
        phone: v.optional(v.string()),
        disclaimer: v.optional(v.string()),
        active: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        const partner = await ctx.db.get(args.partnerId);
        if (!partner) throw new Error("Partner not found");

        const patch: any = { updatedAt: Date.now() };
        const fields = ["name","description","logoUrl","websiteUrl","contactEmail","phone","disclaimer","active","ccEmails"];
        for (const f of fields) {
            if ((args as any)[f] !== undefined) patch[f] = (args as any)[f];
        }
        await ctx.db.patch(args.partnerId, patch);
        return null;
    },
});

export const deletePartner = mutation({
    args: { token: v.string(), partnerId: v.id("otaPartners") },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        // Soft-deactivate (safer than hard delete because of leads FK)
        await ctx.db.patch(args.partnerId, { active: false, updatedAt: Date.now() });
        // Also deactivate all packages
        const pkgs = await ctx.db
            .query("otaPackages")
            .withIndex("by_partner", (q: any) => q.eq("partnerId", args.partnerId))
            .collect();
        for (const p of pkgs) {
            await ctx.db.patch(p._id, { active: false, updatedAt: Date.now() });
        }
        return null;
    },
});

// ─────────────────────────────────────────────────────────
// Packages
// ─────────────────────────────────────────────────────────

export const listAllPackages = query({
    args: { token: v.string(), partnerId: v.optional(v.id("otaPartners")) },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        let pkgs;
        if (args.partnerId) {
            pkgs = await ctx.db
                .query("otaPackages")
                .withIndex("by_partner", (q: any) => q.eq("partnerId", args.partnerId))
                .order("desc")
                .collect();
        } else {
            pkgs = await ctx.db.query("otaPackages").order("desc").collect();
        }
        const partners = await ctx.db.query("otaPartners").collect();
        const partnerMap = new Map(partners.map(p => [p._id, p]));
        return pkgs.map(p => ({
            ...p,
            partner: partnerMap.get(p.partnerId) || null,
        }));
    },
});

export const createPackage = mutation({
    args: {
        token: v.string(),
        partnerId: v.id("otaPartners"),
        title: v.string(),
        subtitle: v.optional(v.string()),
        description: v.string(),
        destinationCity: v.optional(v.string()),
        destinationCountry: v.string(),
        destinationCountryCode: v.optional(v.string()),
        destinationLat: v.optional(v.float64()),
        destinationLng: v.optional(v.float64()),
        durationDays: v.float64(),
        minDurationDays: v.optional(v.float64()),
        maxDurationDays: v.optional(v.float64()),
        priceFrom: v.float64(),
        priceCurrency: v.string(),
        priceUnit: v.optional(v.union(
            v.literal("per_person"),
            v.literal("per_couple"),
            v.literal("total"),
        )),
        includes: v.array(v.string()),
        highlights: v.optional(v.array(v.string())),
        imageUrls: v.array(v.string()),
        heroImageUrl: v.optional(v.string()),
        availableFrom: v.optional(v.float64()),
        availableTo: v.optional(v.float64()),
        externalRef: v.optional(v.string()),
        externalUrl: v.optional(v.string()),
        badge: v.optional(v.string()),
        sortPriority: v.optional(v.float64()),
        active: v.boolean(),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        const partner = await ctx.db.get(args.partnerId);
        if (!partner) throw new Error("Partner not found");

        const now = Date.now();
        const { token, ...data } = args;
        const id = await ctx.db.insert("otaPackages", {
            ...data,
            destinationCountryCode: args.destinationCountryCode?.toLowerCase(),
            viewCount: 0,
            leadCount: 0,
            createdAt: now,
        });
        return id;
    },
});

export const updatePackage = mutation({
    args: {
        token: v.string(),
        packageId: v.id("otaPackages"),
        title: v.optional(v.string()),
        subtitle: v.optional(v.string()),
        description: v.optional(v.string()),
        destinationCity: v.optional(v.string()),
        destinationCountry: v.optional(v.string()),
        destinationCountryCode: v.optional(v.string()),
        destinationLat: v.optional(v.float64()),
        destinationLng: v.optional(v.float64()),
        durationDays: v.optional(v.float64()),
        minDurationDays: v.optional(v.float64()),
        maxDurationDays: v.optional(v.float64()),
        priceFrom: v.optional(v.float64()),
        priceCurrency: v.optional(v.string()),
        priceUnit: v.optional(v.union(
            v.literal("per_person"),
            v.literal("per_couple"),
            v.literal("total"),
        )),
        includes: v.optional(v.array(v.string())),
        highlights: v.optional(v.array(v.string())),
        imageUrls: v.optional(v.array(v.string())),
        heroImageUrl: v.optional(v.string()),
        availableFrom: v.optional(v.float64()),
        availableTo: v.optional(v.float64()),
        externalRef: v.optional(v.string()),
        externalUrl: v.optional(v.string()),
        badge: v.optional(v.string()),
        sortPriority: v.optional(v.float64()),
        active: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        const pkg = await ctx.db.get(args.packageId);
        if (!pkg) throw new Error("Package not found");
        const { token, packageId, ...rest } = args as any;
        const patch: any = { updatedAt: Date.now() };
        for (const [k, v] of Object.entries(rest)) {
            if (v !== undefined) patch[k] = v;
        }
        if (typeof patch.destinationCountryCode === "string") {
            patch.destinationCountryCode = patch.destinationCountryCode.toLowerCase();
        }
        await ctx.db.patch(args.packageId, patch);
        return null;
    },
});

export const deletePackage = mutation({
    args: { token: v.string(), packageId: v.id("otaPackages") },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        await ctx.db.patch(args.packageId, { active: false, updatedAt: Date.now() });
        return null;
    },
});

// ─────────────────────────────────────────────────────────
// Leads (admin view + status updates)
// ─────────────────────────────────────────────────────────

export const listAllLeads = query({
    args: {
        token: v.string(),
        status: v.optional(v.union(
            v.literal("pending"),
            v.literal("sent"),
            v.literal("contacted"),
            v.literal("converted"),
            v.literal("closed"),
            v.literal("failed"),
        )),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        let leads;
        if (args.status) {
            leads = await ctx.db
                .query("otaLeads")
                .withIndex("by_status", (q: any) => q.eq("status", args.status))
                .order("desc")
                .take(200);
        } else {
            leads = await ctx.db.query("otaLeads").order("desc").take(200);
        }
        const partners = await ctx.db.query("otaPartners").collect();
        const partnerMap = new Map(partners.map(p => [p._id, p]));
        const result = [];
        for (const lead of leads) {
            const pkg = await ctx.db.get(lead.packageId);
            result.push({
                ...lead,
                package: pkg ? { _id: pkg._id, title: pkg.title } : null,
                partner: partnerMap.get(lead.partnerId) || null,
            });
        }
        return result;
    },
});

export const updateLeadStatus = mutation({
    args: {
        token: v.string(),
        leadId: v.id("otaLeads"),
        status: v.union(
            v.literal("pending"),
            v.literal("sent"),
            v.literal("contacted"),
            v.literal("converted"),
            v.literal("closed"),
            v.literal("failed"),
        ),
        partnerNotes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireAdmin(ctx, args.token);
        const patch: any = { status: args.status, updatedAt: Date.now() };
        if (args.partnerNotes !== undefined) patch.partnerNotes = args.partnerNotes;
        await ctx.db.patch(args.leadId, patch);
        return null;
    },
});
