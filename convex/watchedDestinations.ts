import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { api } from "./_generated/api";
import { authQuery, authMutation } from "./functions";
import { PRICE_DROP_COOLDOWN_MS, homeAirportMatchesOrigin, isNotablePriceDrop } from "./lib/notificationInbox";

// Type assertion: internal references won't exist until `npx convex dev` regenerates types
const internal = _internal as any;

// ─── Client-facing: Get all watched destinations for the current user ───
export const getWatchedDestinations = authQuery({
    args: {
        token: v.string(),
    },
    handler: async (ctx: any) => {
        const userId = ctx.user.userId;
        return await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();
    },
});

// ─── Client-facing: Check if user is watching a specific destination ───
export const isWatching = authQuery({
    args: {
        token: v.string(),
        destination: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const normalized = args.destination.toLowerCase().trim();
        const existing = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user_destination", (q: any) =>
                q.eq("userId", userId).eq("destination", normalized)
            )
            .unique();
        return !!existing;
    },
});

// ─── Client-facing: Watch a destination (idempotent) ───
export const watch = authMutation({
    args: {
        token: v.string(),
        destination: v.string(),
        destinationIata: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const normalized = args.destination.toLowerCase().trim();

        // Check if already watching (idempotent)
        const existing = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user_destination", (q: any) =>
                q.eq("userId", userId).eq("destination", normalized)
            )
            .unique();

        if (existing) return existing._id;

        // Cap at 20 watched destinations per user
        const allWatched = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();

        if (allWatched.length >= 20) {
            throw new Error("Maximum of 20 watched destinations reached. Please remove one first.");
        }

        return await ctx.db.insert("watchedDestinations", {
            userId,
            destination: normalized,
            destinationIata: args.destinationIata?.toUpperCase() || undefined,
            createdAt: Date.now(),
        });
    },
});

// ─── Client-facing: Unwatch a destination ───
export const unwatch = authMutation({
    args: {
        token: v.string(),
        destination: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const normalized = args.destination.toLowerCase().trim();

        const existing = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user_destination", (q: any) =>
                q.eq("userId", userId).eq("destination", normalized)
            )
            .unique();

        if (existing) {
            await ctx.db.delete(existing._id);
        }

        return null;
    },
});

// ─── Internal: Find all users watching a destination (by city name or IATA) ───
export const getUsersWatching = internalQuery({
    args: {
        destinationCity: v.string(),
        destinationIata: v.optional(v.string()),
    },
    handler: async (ctx, args) => findWatchers(ctx, args),
});

async function findWatchers(
    ctx: QueryCtx,
    args: { destinationCity: string; destinationIata?: string }
): Promise<any[]> {
    const normalizedCity = args.destinationCity.toLowerCase().trim();

    // Query by normalized city name
    const byCity = await ctx.db
        .query("watchedDestinations")
        .withIndex("by_destination", (q) => q.eq("destination", normalizedCity))
        .collect();

    // Also query by IATA code if provided
    let byIata: any[] = [];
    if (args.destinationIata) {
        // IATA matches need a full scan filtered — watchedDestinations index is on city name
        // We cross-check IATA from the byCity results + scan for IATA-only watchers
        const allWatched = await ctx.db.query("watchedDestinations").collect();
        byIata = allWatched.filter(
            (w) =>
                w.destinationIata === args.destinationIata!.toUpperCase() &&
                w.destination !== normalizedCity // avoid duplicates with byCity
        );
    }

    // Deduplicate by userId
    const seen = new Set<string>();
    const results: any[] = [];
    for (const entry of [...byCity, ...byIata]) {
        if (!seen.has(entry.userId)) {
            seen.add(entry.userId);
            results.push(entry);
        }
    }

    return results;
}

// ─── Internal: who gets an automatic alert for a deal ───
//
// Watching a destination means "tell me about fares to it FROM MY airport".
// These alerts used to go to every watcher of the destination, so an ATH user
// watching Paris was pinged about a Berlin → Paris fare every time the radar
// refresh lowered its price — a deal that never even appears in their own
// radar. Now only watchers whose home airport resolves to the deal's origin
// (the same rule as `lowFareRadar.getDealsForUser`) are alerted; watchers with
// no home airport are skipped, as in the saved-route seeder.
const DEAL_ALERT_TYPES = ["deal_alert_watched", "deal_price_drop"] as const;

export const getDealAlertAudience = internalQuery({
    args: {
        dealId: v.id("lowFareRadar"),
        origin: v.string(),
        destinationCity: v.string(),
        destinationIata: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const watchers: any[] = await findWatchers(ctx, {
            destinationCity: args.destinationCity,
            destinationIata: args.destinationIata,
        });

        const recipients: Array<{
            userId: string;
            language: string;
            /** Fare in the last alert this user got about THIS deal, if any. */
            lastNotifiedPrice: number | null;
            lastNotifiedAt: number | null;
        }> = [];
        let otherAirport = 0;
        let noHomeAirport = 0;

        for (const w of watchers) {
            const settings = await ctx.db
                .query("userSettings")
                .withIndex("by_user", (q) => q.eq("userId", w.userId))
                .unique();
            if (!settings?.homeAirport) { noHomeAirport++; continue; }
            if (!homeAirportMatchesOrigin(settings.homeAirport, args.origin)) { otherAirport++; continue; }

            // Most recent alert about this same deal (new-deal or price-drop).
            let last: { sentAt: number; price: number | null } | null = null;
            for (const type of DEAL_ALERT_TYPES) {
                const rows = await ctx.db
                    .query("notificationLog")
                    .withIndex("by_user_type", (q) => q.eq("userId", w.userId).eq("type", type))
                    .order("desc")
                    .take(20);
                const hit = rows.find((r: any) => r.data?.dealId === args.dealId);
                if (hit && (!last || hit.sentAt > last.sentAt)) {
                    const p = Number(hit.data?.price);
                    last = { sentAt: hit.sentAt, price: Number.isFinite(p) && p > 0 ? p : null };
                }
            }

            recipients.push({
                userId: w.userId,
                language: settings.language || "en",
                lastNotifiedPrice: last?.price ?? null,
                lastNotifiedAt: last?.sentAt ?? null,
            });
        }

        return { recipients, watchers: watchers.length, otherAirport, noHomeAirport };
    },
});

function dealPushData(dealId: string, deal: any, price: number) {
    return {
        screen: "deal-trip",
        dealId,
        origin: deal.origin,
        originCity: deal.originCity,
        destination: deal.destination,
        destinationCity: deal.destinationCity,
        price: String(price),
    };
}

// ─── Internal action: Notify users watching a destination when a new deal is created ───
export const notifyMatchingUsers = internalAction({
    args: {
        dealId: v.id("lowFareRadar"),
    },
    handler: async (ctx, args) => {
        // 1. Fetch the deal
        const deal = await ctx.runQuery(api.lowFareRadar.get, { id: args.dealId });
        if (!deal || !deal.active) {
            console.log(`🔕 Deal ${args.dealId} not found or inactive, skipping notifications`);
            return;
        }

        // 2. Watchers of this destination who fly from this deal's origin
        const audience = await ctx.runQuery(internal.watchedDestinations.getDealAlertAudience, {
            dealId: args.dealId,
            origin: deal.origin,
            destinationCity: deal.destinationCity,
            destinationIata: deal.destination,
        });

        console.log(
            `🔔 ${deal.origin} → ${deal.destinationCity}: ${audience.watchers} watcher(s), ` +
            `${audience.recipients.length} at ${deal.origin}, skipped ${audience.otherAirport} other-airport + ` +
            `${audience.noHomeAirport} without a home airport`
        );

        // 3. Send in each user's language
        for (const r of audience.recipients) {
            // Already told about this exact deal (e.g. the deal was re-created).
            if (r.lastNotifiedAt !== null) continue;

            const title = getDealNotifText(r.language, "deal_watch_title", {
                dest: deal.destinationCity,
            });
            const body = getDealNotifText(r.language, "deal_watch_body", {
                origin: deal.originCity,
                dest: deal.destinationCity,
                price: `${deal.price}`,
                currency: deal.currency,
            });

            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: r.userId,
                title,
                body,
                type: "deal_alert_watched",
                data: dealPushData(args.dealId, deal, deal.price),
            });
        }
    },
});

// ─── Internal action: Notify users when a watched deal has a price drop ───
export const notifyPriceDrop = internalAction({
    args: {
        dealId: v.id("lowFareRadar"),
        oldPrice: v.float64(),
        newPrice: v.float64(),
    },
    handler: async (ctx, args) => {
        // Refreshes nudge fares by a euro or two all the time — not news.
        if (!isNotablePriceDrop(args.oldPrice, args.newPrice)) {
            console.log(`📉 Price ${args.oldPrice} → ${args.newPrice} for deal ${args.dealId} below alert threshold`);
            return;
        }

        const deal = await ctx.runQuery(api.lowFareRadar.get, { id: args.dealId });
        if (!deal || !deal.active) return;

        const audience = await ctx.runQuery(internal.watchedDestinations.getDealAlertAudience, {
            dealId: args.dealId,
            origin: deal.origin,
            destinationCity: deal.destinationCity,
            destinationIata: deal.destination,
        });

        const now = Date.now();
        let sent = 0;
        let cooledDown = 0;

        for (const r of audience.recipients) {
            // One alert per deal per cooldown window, unless the fare has
            // dropped notably again since the price we last quoted them.
            if (r.lastNotifiedAt !== null && now - r.lastNotifiedAt < PRICE_DROP_COOLDOWN_MS) {
                if (r.lastNotifiedPrice === null || !isNotablePriceDrop(r.lastNotifiedPrice, args.newPrice)) {
                    cooledDown++;
                    continue;
                }
            }
            // The "was" price is what THIS user last saw, when we know it.
            const wasPrice = r.lastNotifiedPrice ?? args.oldPrice;

            const title = getDealNotifText(r.language, "price_drop_title", {
                dest: deal.destinationCity,
            });
            const body = getDealNotifText(r.language, "price_drop_body", {
                origin: deal.originCity,
                dest: deal.destinationCity,
                oldPrice: `${wasPrice}`,
                newPrice: `${args.newPrice}`,
                currency: deal.currency,
            });

            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: r.userId,
                title,
                body,
                type: "deal_price_drop",
                data: dealPushData(args.dealId, deal, args.newPrice),
            });
            sent++;
        }

        console.log(
            `📉 ${deal.origin} → ${deal.destinationCity} ${args.oldPrice} → ${args.newPrice}: ` +
            `${sent} notified, ${cooledDown} in cooldown, skipped ${audience.otherAirport} other-airport + ` +
            `${audience.noHomeAirport} without a home airport (of ${audience.watchers} watchers)`
        );
    },
});

// ─── Deal notification translations ───
const DEAL_NOTIF_TRANSLATIONS: Record<string, Record<string, string>> = {
    en: {
        deal_watch_title: "Deal found for {{dest}}! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} from {{currency}}{{price}}. Tap to view the deal!",
        price_drop_title: "Price dropped for {{dest}}! 📉",
        price_drop_body: "{{origin}} → {{dest}} now {{currency}}{{newPrice}} (was {{currency}}{{oldPrice}}). Grab it!",
    },
    el: {
        deal_watch_title: "Βρέθηκε προσφορά για {{dest}}! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} από {{currency}}{{price}}. Πατήστε για να δείτε!",
        price_drop_title: "Πτώση τιμής για {{dest}}! 📉",
        price_drop_body: "{{origin}} → {{dest}} τώρα {{currency}}{{newPrice}} (ήταν {{currency}}{{oldPrice}}). Κλείστε το!",
    },
    es: {
        deal_watch_title: "¡Oferta para {{dest}}! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} desde {{currency}}{{price}}. ¡Toca para ver la oferta!",
        price_drop_title: "¡Bajó el precio para {{dest}}! 📉",
        price_drop_body: "{{origin}} → {{dest}} ahora {{currency}}{{newPrice}} (era {{currency}}{{oldPrice}}). ¡Aprovecha!",
    },
    fr: {
        deal_watch_title: "Offre pour {{dest}} ! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} à partir de {{currency}}{{price}}. Appuyez pour voir !",
        price_drop_title: "Prix en baisse pour {{dest}} ! 📉",
        price_drop_body: "{{origin}} → {{dest}} maintenant {{currency}}{{newPrice}} (était {{currency}}{{oldPrice}}). Foncez !",
    },
    de: {
        deal_watch_title: "Angebot für {{dest}} gefunden! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} ab {{currency}}{{price}}. Tippen Sie, um das Angebot zu sehen!",
        price_drop_title: "Preissenkung für {{dest}}! 📉",
        price_drop_body: "{{origin}} → {{dest}} jetzt {{currency}}{{newPrice}} (war {{currency}}{{oldPrice}}). Zugreifen!",
    },
    ar: {
        deal_watch_title: "عرض لـ {{dest}}! ✈️",
        deal_watch_body: "{{origin}} → {{dest}} من {{currency}}{{price}}. اضغط لعرض العرض!",
        price_drop_title: "انخفض السعر لـ {{dest}}! 📉",
        price_drop_body: "{{origin}} → {{dest}} الآن {{currency}}{{newPrice}} (كان {{currency}}{{oldPrice}}). احجز الآن!",
    },
};

function getDealNotifText(lang: string, key: string, vars?: Record<string, string | number>): string {
    const translations = DEAL_NOTIF_TRANSLATIONS[lang] || DEAL_NOTIF_TRANSLATIONS["en"];
    let text = translations[key] || DEAL_NOTIF_TRANSLATIONS["en"][key] || "";
    if (vars) {
        for (const [k, val] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(val));
        }
    }
    return text;
}
