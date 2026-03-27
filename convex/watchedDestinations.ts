import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { api } from "./_generated/api";
import { authQuery, authMutation } from "./functions";

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
    handler: async (ctx, args) => {
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
    },
});

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

        // 2. Find users watching this destination
        const watchers = await ctx.runQuery(
            internal.watchedDestinations.getUsersWatching,
            {
                destinationCity: deal.destinationCity,
                destinationIata: deal.destination, // IATA code
            }
        );

        if (watchers.length === 0) {
            console.log(`📭 No users watching ${deal.destinationCity} (${deal.destination})`);
            return;
        }

        console.log(`🔔 Found ${watchers.length} user(s) watching ${deal.destinationCity} — sending deal alerts`);

        // 3. Get notification text in each user's language and send
        for (const watcher of watchers) {
            const settings = await ctx.runQuery(
                internal.notifications.getUserNotificationSettings,
                { userId: watcher.userId }
            );

            const lang = settings?.language || "en";
            const title = getDealNotifText(lang, "deal_watch_title", {
                dest: deal.destinationCity,
            });
            const body = getDealNotifText(lang, "deal_watch_body", {
                origin: deal.originCity,
                dest: deal.destinationCity,
                price: `${deal.price}`,
                currency: deal.currency,
            });

            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: watcher.userId,
                title,
                body,
                type: "deal_alert_watched",
                data: {
                    screen: "deal-trip",
                    dealId: args.dealId,
                    origin: deal.origin,
                    originCity: deal.originCity,
                    destination: deal.destination,
                    destinationCity: deal.destinationCity,
                },
            });
        }

        console.log(`✅ Deal alert notifications sent for ${deal.originCity} → ${deal.destinationCity}`);
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
        const deal = await ctx.runQuery(api.lowFareRadar.get, { id: args.dealId });
        if (!deal || !deal.active) return;

        const watchers = await ctx.runQuery(
            internal.watchedDestinations.getUsersWatching,
            {
                destinationCity: deal.destinationCity,
                destinationIata: deal.destination,
            }
        );

        if (watchers.length === 0) return;

        console.log(`📉 Price drop ${args.oldPrice} → ${args.newPrice} for ${deal.destinationCity} — notifying ${watchers.length} user(s)`);

        for (const watcher of watchers) {
            const settings = await ctx.runQuery(
                internal.notifications.getUserNotificationSettings,
                { userId: watcher.userId }
            );

            const lang = settings?.language || "en";
            const title = getDealNotifText(lang, "price_drop_title", {
                dest: deal.destinationCity,
            });
            const body = getDealNotifText(lang, "price_drop_body", {
                origin: deal.originCity,
                dest: deal.destinationCity,
                oldPrice: `${args.oldPrice}`,
                newPrice: `${args.newPrice}`,
                currency: deal.currency,
            });

            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: watcher.userId,
                title,
                body,
                type: "deal_price_drop",
                data: {
                    screen: "deal-trip",
                    dealId: args.dealId,
                    origin: deal.origin,
                    originCity: deal.originCity,
                    destination: deal.destination,
                    destinationCity: deal.destinationCity,
                },
            });
        }
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
