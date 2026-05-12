/**
 * OTA Packages — Partner travel packages.
 *
 * Public flows:
 *  - listForTrip: returns matching packages for an existing trip (used in trip view).
 *  - submitLead: user submits an inquiry for a package; emails partner + user.
 *  - listMyLeads: user views their submitted inquiries.
 *
 * Partner data is currently entered manually via admin tools. An ingestion
 * action (ingestFromJsonFeed) is provided as a future hook for partner feeds.
 */

import { v, ConvexError } from "convex/values";
import { authMutation, authQuery } from "./functions";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function normalize(s: string | undefined | null): string {
    return (s ?? "").toLowerCase().trim();
}

function tripMatchesPackage(
    pkg: any,
    tripDestination: string,
    tripDurationDays: number,
    tripStartDate: number | undefined,
): boolean {
    if (!pkg.active) return false;

    const dest = normalize(tripDestination);
    const city = normalize(pkg.destinationCity);
    const country = normalize(pkg.destinationCountry);

    // Destination must overlap by city OR country
    const cityMatch = city.length > 0 && dest.includes(city);
    const countryMatch = country.length > 0 && dest.includes(country);
    if (!cityMatch && !countryMatch) return false;

    // Duration window
    const minD = typeof pkg.minDurationDays === "number"
        ? pkg.minDurationDays
        : Math.max(1, pkg.durationDays - 2);
    const maxD = typeof pkg.maxDurationDays === "number"
        ? pkg.maxDurationDays
        : pkg.durationDays + 2;
    if (tripDurationDays < minD || tripDurationDays > maxD) return false;

    // Availability window
    if (typeof tripStartDate === "number") {
        if (typeof pkg.availableFrom === "number" && tripStartDate < pkg.availableFrom) return false;
        if (typeof pkg.availableTo === "number" && tripStartDate > pkg.availableTo) return false;
    }

    return true;
}

// ─────────────────────────────────────────────────────────
// Public: list packages for a trip
// ─────────────────────────────────────────────────────────

export const listForTrip = authQuery({
    args: { tripId: v.id("trips") },
    handler: async (ctx: any, args: any) => {
        const trip = await ctx.db.get(args.tripId);
        if (!trip || trip.userId !== ctx.user.userId) return [];

        const durationDays = Math.max(
            1,
            Math.round((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24)) + 1,
        );

        const packages = await ctx.db
            .query("otaPackages")
            .withIndex("by_active", (q: any) => q.eq("active", true))
            .collect();

        const matches = packages.filter((p: any) =>
            tripMatchesPackage(p, trip.destination, durationDays, trip.startDate),
        );

        // Sort by sortPriority desc, then priceFrom asc
        matches.sort((a: any, b: any) => {
            const pa = a.sortPriority ?? 0;
            const pb = b.sortPriority ?? 0;
            if (pa !== pb) return pb - pa;
            return a.priceFrom - b.priceFrom;
        });

        const top = matches.slice(0, 12);

        // Hydrate partner info
        const partnerCache = new Map<string, any>();
        const result: any[] = [];
        for (const pkg of top) {
            let partner = partnerCache.get(pkg.partnerId);
            if (!partner) {
                partner = await ctx.db.get(pkg.partnerId);
                partnerCache.set(pkg.partnerId, partner);
            }
            if (!partner || !partner.active) continue;
            result.push({
                _id: pkg._id,
                title: pkg.title,
                subtitle: pkg.subtitle,
                description: pkg.description,
                destinationCity: pkg.destinationCity,
                destinationCountry: pkg.destinationCountry,
                durationDays: pkg.durationDays,
                priceFrom: pkg.priceFrom,
                priceCurrency: pkg.priceCurrency,
                priceUnit: pkg.priceUnit ?? "per_person",
                includes: pkg.includes ?? [],
                highlights: pkg.highlights ?? [],
                imageUrls: pkg.imageUrls ?? [],
                heroImageUrl: pkg.heroImageUrl ?? (pkg.imageUrls?.[0] ?? null),
                badge: pkg.badge,
                externalUrl: pkg.externalUrl,
                partner: {
                    _id: partner._id,
                    name: partner.name,
                    slug: partner.slug,
                    logoUrl: partner.logoUrl,
                    websiteUrl: partner.websiteUrl,
                    disclaimer: partner.disclaimer,
                },
            });
        }

        return result;
    },
});

// ─────────────────────────────────────────────────────────
// Public: get single package
// ─────────────────────────────────────────────────────────

export const getPackage = authQuery({
    args: { packageId: v.id("otaPackages") },
    handler: async (ctx: any, args: any) => {
        const pkg = await ctx.db.get(args.packageId);
        if (!pkg || !pkg.active) return null;
        const partner = await ctx.db.get(pkg.partnerId);
        if (!partner || !partner.active) return null;
        return {
            ...pkg,
            partner: {
                _id: partner._id,
                name: partner.name,
                slug: partner.slug,
                logoUrl: partner.logoUrl,
                websiteUrl: partner.websiteUrl,
                disclaimer: partner.disclaimer,
            },
        };
    },
});

// ─────────────────────────────────────────────────────────
// Public: increment view counter (best-effort)
// ─────────────────────────────────────────────────────────

export const trackView = authMutation({
    args: { packageId: v.id("otaPackages") },
    handler: async (ctx: any, args: any) => {
        const pkg = await ctx.db.get(args.packageId);
        if (!pkg) return null;
        await ctx.db.patch(pkg._id, {
            viewCount: (pkg.viewCount ?? 0) + 1,
        });
        return null;
    },
});

// ─────────────────────────────────────────────────────────
// Public: submit lead
// ─────────────────────────────────────────────────────────

export const submitLead = authMutation({
    args: {
        packageId: v.id("otaPackages"),
        tripId: v.optional(v.id("trips")),
        contactName: v.string(),
        contactEmail: v.string(),
        contactPhone: v.optional(v.string()),
        preferredContactMethod: v.optional(v.union(
            v.literal("email"),
            v.literal("phone"),
            v.literal("any"),
        )),
        message: v.optional(v.string()),
        consentGiven: v.boolean(),
    },
    handler: async (ctx: any, args: any) => {
        if (!args.consentGiven) {
            throw new ConvexError("Consent required to share contact details with partner");
        }
        if (!args.contactName.trim() || !args.contactEmail.trim()) {
            throw new ConvexError("Name and email are required");
        }

        const pkg = await ctx.db.get(args.packageId);
        if (!pkg || !pkg.active) {
            throw new ConvexError("Package is not available");
        }
        const partner = await ctx.db.get(pkg.partnerId);
        if (!partner || !partner.active) {
            throw new ConvexError("Partner is not available");
        }

        // Snapshot trip context if provided
        let destination = `${pkg.destinationCity ?? ""}${pkg.destinationCity ? ", " : ""}${pkg.destinationCountry}`;
        let startDate: number | undefined;
        let endDate: number | undefined;
        let travelers = 2;
        let budget: number | undefined;
        if (args.tripId) {
            const trip = await ctx.db.get(args.tripId);
            if (trip && trip.userId === ctx.user.userId) {
                destination = trip.destination ?? destination;
                startDate = trip.startDate;
                endDate = trip.endDate;
                travelers = trip.travelerCount ?? trip.travelers ?? 2;
                budget = trip.budgetTotal ?? (typeof trip.budget === "number" ? trip.budget : undefined);
            }
        }

        const now = Date.now();
        const leadId = await ctx.db.insert("otaLeads", {
            userId: ctx.user.userId,
            packageId: pkg._id,
            partnerId: partner._id,
            tripId: args.tripId,
            destination,
            startDate,
            endDate,
            travelers,
            budget,
            contactName: args.contactName.trim(),
            contactEmail: args.contactEmail.trim(),
            contactPhone: args.contactPhone?.trim() || undefined,
            preferredContactMethod: args.preferredContactMethod ?? "any",
            message: args.message?.trim() || undefined,
            consentGiven: true,
            status: "pending",
            createdAt: now,
        });

        // Bump lead counter on package
        await ctx.db.patch(pkg._id, { leadCount: (pkg.leadCount ?? 0) + 1 });

        // Schedule email dispatch
        await ctx.scheduler.runAfter(0, internal.otaPackagesEmail.dispatchLeadEmails, {
            leadId,
        });

        return { leadId };
    },
});

// ─────────────────────────────────────────────────────────
// Public: list my leads
// ─────────────────────────────────────────────────────────

export const listMyLeads = authQuery({
    args: {},
    handler: async (ctx: any) => {
        const leads = await ctx.db
            .query("otaLeads")
            .withIndex("by_user", (q: any) => q.eq("userId", ctx.user.userId))
            .order("desc")
            .take(50);

        const result: any[] = [];
        for (const lead of leads) {
            const pkg = await ctx.db.get(lead.packageId);
            const partner = await ctx.db.get(lead.partnerId);
            result.push({
                _id: lead._id,
                status: lead.status,
                destination: lead.destination,
                travelers: lead.travelers,
                startDate: lead.startDate,
                endDate: lead.endDate,
                createdAt: lead.createdAt,
                sentToPartnerAt: lead.sentToPartnerAt,
                package: pkg ? {
                    _id: pkg._id,
                    title: pkg.title,
                    heroImageUrl: pkg.heroImageUrl ?? pkg.imageUrls?.[0] ?? null,
                    priceFrom: pkg.priceFrom,
                    priceCurrency: pkg.priceCurrency,
                } : null,
                partner: partner ? {
                    _id: partner._id,
                    name: partner.name,
                    logoUrl: partner.logoUrl,
                } : null,
            });
        }
        return result;
    },
});

// ─────────────────────────────────────────────────────────
// Internal helpers for email action
// ─────────────────────────────────────────────────────────

export const getLeadForEmail = internalQuery({
    args: { leadId: v.id("otaLeads") },
    handler: async (ctx: any, args: any) => {
        const lead = await ctx.db.get(args.leadId);
        if (!lead) return null;
        const pkg = await ctx.db.get(lead.packageId);
        const partner = await ctx.db.get(lead.partnerId);
        return { lead, package: pkg, partner };
    },
});

export const markLeadStatus = internalMutation({
    args: {
        leadId: v.id("otaLeads"),
        status: v.union(
            v.literal("pending"),
            v.literal("sent"),
            v.literal("contacted"),
            v.literal("converted"),
            v.literal("closed"),
            v.literal("failed"),
        ),
        sendError: v.optional(v.string()),
        sentAt: v.optional(v.float64()),
    },
    handler: async (ctx: any, args: any) => {
        const patch: any = { status: args.status, updatedAt: Date.now() };
        if (args.sendError !== undefined) patch.sendError = args.sendError;
        if (args.sentAt !== undefined) patch.sentToPartnerAt = args.sentAt;
        await ctx.db.patch(args.leadId, patch);
        return null;
    },
});
