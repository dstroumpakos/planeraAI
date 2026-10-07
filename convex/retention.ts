import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./functions";
import { internal as _internal } from "./_generated/api";
import { resolveHomeIata, airportCityName } from "../lib/homeAirport";
import { resolveIATA } from "../lib/destinationAirports";

// `as any`: new module — `internal.retention.*` isn't in _generated/api until
// the next codegen/deploy (see convex-codegen-deploys). Runtime resolves by path.
const internal = _internal as any;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention plumbing (see the Planera Retention Playbook, Sept 2026).
 *
 * Four pieces live here because they share one idea — give the app a job
 * BETWEEN trips and know whether it worked:
 *
 *  1. `touchActive`        — the activity ping behind DAU/WAU/MAU + D1/D7/D30
 *  2. `getWatchedFares`    — "your watched fares" for the home tab (the radar
 *                            pipeline already pushes drops; this is the pull side)
 *  3. `getTripRecap`       — numbers for the post-trip recap screen
 *  4. `grantMonthlyCredits` / `dormancyTick` — the two crons that give a
 *                            silent user a concrete reason to come back
 */

function utcDay(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Activity ping
// ───────────────────────────────────────────────────────────────────────────

// The client also throttles (lib/useActivityPing.ts); this is the server-side
// backstop so a misbehaving client can't turn every query into a write.
const ACTIVITY_PING_MIN_GAP = 30 * 60 * 1000;

/**
 * Called on app open / foreground. Stamps `lastActiveAt` and records the
 * (user, day) row that cohort retention is computed from. Cheap by design:
 * one settings read, one tiny upsert, and the trips scan only on the FIRST
 * ping of a day.
 */
export const touchActive = authMutation({
    args: {
        token: v.string(),
        platform: v.optional(v.string()),
        // IANA zone from the device; drives push quiet hours (lib/quietHours.ts).
        timezone: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const now = Date.now();

        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .first();
        if (!settings) return { ok: false as const, reason: "no_settings" };

        if (settings.lastActiveAt && now - settings.lastActiveAt < ACTIVITY_PING_MIN_GAP) {
            return { ok: true as const, skipped: true };
        }

        const platform = args.platform ? String(args.platform).slice(0, 12) : undefined;
        const timezone =
            args.timezone && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(String(args.timezone))
                ? String(args.timezone).slice(0, 64)
                : undefined;
        // Android builds before the auth fix never sent a signup platform, so
        // backfill it from the first device we see the user on.
        const backfillPlatform =
            !settings.platform && platform && ["ios", "android", "web"].includes(platform);
        await ctx.db.patch(settings._id, {
            lastActiveAt: now,
            ...(platform ? { lastActivePlatform: platform } : {}),
            ...(backfillPlatform ? { platform } : {}),
            ...(timezone && timezone !== settings.timezone ? { timezone } : {}),
        });

        const day = utcDay(now);
        const existing = await ctx.db
            .query("userActivityDays")
            .withIndex("by_user_day", (q: any) => q.eq("userId", userId).eq("day", day))
            .first();
        if (existing) return { ok: true as const, skipped: false };

        // First ping today: decide whether this is a "trip-active" day. A trip
        // in progress, or starting inside 30 days, counts — that is the window
        // in which the countdown/briefing pushes run and the app has an
        // obvious job. Everything else is "browsing".
        const horizon = now + 30 * DAY_MS;
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();
        const tripActive = trips.some(
            (t: any) =>
                t.status === "completed" &&
                typeof t.startDate === "number" &&
                typeof t.endDate === "number" &&
                t.endDate >= now - DAY_MS &&
                t.startDate <= horizon,
        );

        await ctx.db.insert("userActivityDays", { userId, day, platform, tripActive });
        return { ok: true as const, skipped: false };
    },
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Watched fares (home tab)
// ───────────────────────────────────────────────────────────────────────────

/**
 * For each destination the user watches, the cheapest live radar deal from
 * their home airport plus how it compares to the route's typical fare. One
 * radar query (by origin) serves every watch, so cost is bounded by the
 * radar's per-origin size, not by the number of watches.
 */
export const getWatchedFares = authQuery({
    args: { token: v.string() },
    handler: async (ctx: any) => {
        const userId = ctx.user.userId;

        const watched = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .collect();

        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .first();
        const homeIata = resolveHomeIata(settings?.homeAirport) || null;
        const homeCity = homeIata ? airportCityName(homeIata) || homeIata : null;

        if (watched.length === 0) {
            return { homeIata, homeCity, watches: [], hasHomeAirport: !!homeIata };
        }

        const now = Date.now();
        let deals: any[] = [];
        if (homeIata) {
            deals = await ctx.db
                .query("lowFareRadar")
                .withIndex("by_origin", (q: any) => q.eq("origin", homeIata))
                .filter((q: any) => q.eq(q.field("active"), true))
                .collect();
            deals = deals.filter(
                (d) => !d.deletedAt && (!d.expiresAt || d.expiresAt > now),
            );
        }

        const watches = watched.map((w: any) => {
            const iata = (w.destinationIata || resolveIATA(w.destination) || "").toUpperCase();
            const matches = deals.filter(
                (d) =>
                    (iata && d.destination === iata) ||
                    (d.destinationCity || "").toLowerCase() === w.destination,
            );
            let best: any = null;
            for (const d of matches) if (!best || d.price < best.price) best = d;

            const typical = best?.typicalPrice ?? null;
            const pctVsTypical =
                best && typical && typical > 0
                    ? Math.round(((best.price - typical) / typical) * 100)
                    : null;

            return {
                destination: w.destination,
                label: w.destination.replace(/\b\w/g, (c: string) => c.toUpperCase()),
                destinationIata: iata || null,
                watchedAt: w.createdAt,
                dealCount: matches.length,
                best: best
                    ? {
                          dealId: best._id,
                          price: best.price,
                          currency: best.currency,
                          typicalPrice: typical,
                          pctVsTypical,
                          outboundDate: best.outboundDate,
                          returnDate: best.returnDate || null,
                          airline: best.airline,
                          destinationCity: best.destinationCity,
                          origin: best.origin,
                          originCity: best.originCity,
                      }
                    : null,
            };
        });

        // Cheapest-vs-typical first, then destinations with no fare yet.
        watches.sort((a: any, b: any) => {
            if (a.best && !b.best) return -1;
            if (!a.best && b.best) return 1;
            return (a.best?.pctVsTypical ?? 0) - (b.best?.pctVsTypical ?? 0);
        });

        return { homeIata, homeCity, watches, hasHomeAirport: !!homeIata };
    },
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Trip recap
// ───────────────────────────────────────────────────────────────────────────

/**
 * Numbers and highlights for the recap screen shown 2 days after a trip ends.
 * Everything is derived from data the trip already carries (the itinerary,
 * the per-day map stats written by convex/lib/geocoding.ts, the share-card
 * photo), so no extra generation is needed.
 */
export const getTripRecap = authQuery({
    args: { token: v.string(), tripId: v.id("trips") },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const trip = await ctx.db.get(args.tripId);
        if (!trip) return null;

        if (trip.userId !== userId) {
            const collab = await ctx.db
                .query("tripCollaborators")
                .withIndex("by_trip_user", (q: any) => q.eq("tripId", args.tripId).eq("userId", userId))
                .first();
            if (!collab) return null;
        }

        const days: any[] = trip.itinerary?.dayByDayItinerary || [];
        let stops = 0;
        let totalKm = 0;
        let walkMinutes = 0;
        const highlights: { title: string; day: number; imageUrl?: string }[] = [];
        for (const d of days) {
            const acts: any[] = d.activities || [];
            stops += acts.length;
            if (typeof d.mapTotalKm === "number") totalKm += d.mapTotalKm;
            if (typeof d.mapWalkMinutes === "number") walkMinutes += d.mapWalkMinutes;
            for (const a of acts) {
                if (highlights.length >= 6) break;
                if (!a?.title) continue;
                highlights.push({
                    title: String(a.title),
                    day: Number(d.day) || highlights.length + 1,
                    imageUrl: a.image?.url || a.imageUrl || undefined,
                });
            }
        }

        const countries = new Set<string>();
        const parts = String(trip.destination || "").split(",").map((s) => s.trim());
        if (parts.length >= 2) countries.add(parts[parts.length - 1]);
        for (const d of trip.destinations || []) if (d.country) countries.add(d.country);

        const insight = await ctx.db
            .query("insights")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .filter((q: any) => q.eq(q.field("tripId"), args.tripId))
            .first();

        const dayCount = Math.max(
            days.length,
            Math.round((trip.endDate - trip.startDate) / DAY_MS) + 1,
        );

        return {
            tripId: trip._id,
            destination: trip.destination,
            startDate: trip.startDate,
            endDate: trip.endDate,
            dayCount,
            stops,
            totalKm: Math.round(totalKm * 10) / 10,
            walkMinutes: Math.round(walkMinutes),
            countries: Array.from(countries),
            highlights,
            coverUrl: trip.shareCardPhoto?.url || trip.destinationImage?.url || null,
            hasInsight: !!insight,
            locationVerified: trip.locationVerified === true,
            isOwner: trip.userId === userId,
        };
    },
});

// ───────────────────────────────────────────────────────────────────────────
// 4a. Monthly free credit
// ───────────────────────────────────────────────────────────────────────────

// A free user can hold at most this many credits from the monthly grant, so
// nobody stockpiles a year of generations by never opening the app.
const MONTHLY_CREDIT_CAP = 2;

const CREDIT_MONTHLY_TEXT: Record<string, { title: string; body: string }> = {
    en: { title: "A new trip credit is waiting 🎁", body: "Your free credit for this month just landed. Where would you go if the price was right?" },
    el: { title: "Μια νέα πίστωση ταξιδιού σε περιμένει 🎁", body: "Η δωρεάν πίστωση αυτού του μήνα μόλις ήρθε. Πού θα πήγαινες αν η τιμή ήταν σωστή;" },
    es: { title: "Te espera un nuevo crédito de viaje 🎁", body: "Tu crédito gratis de este mes acaba de llegar. ¿A dónde irías si el precio fuera el adecuado?" },
    fr: { title: "Un nouveau crédit voyage vous attend 🎁", body: "Votre crédit gratuit du mois vient d'arriver. Où iriez-vous si le prix était le bon ?" },
    de: { title: "Ein neues Reise-Guthaben wartet 🎁", body: "Dein kostenloses Guthaben für diesen Monat ist da. Wohin würdest du reisen, wenn der Preis stimmt?" },
    ar: { title: "رصيد رحلة جديد بانتظارك 🎁", body: "وصل رصيدك المجاني لهذا الشهر. إلى أين ستسافر لو كان السعر مناسبًا؟" },
};

export const _plansPage = internalQuery({
    args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
    handler: async (ctx, { cursor, numItems }) => {
        const res = await ctx.db.query("userPlans").paginate({ cursor, numItems });
        return {
            rows: res.page.map((p: any) => ({
                planId: p._id,
                userId: p.userId,
                plan: p.plan,
                tripCredits: p.tripCredits ?? 0,
                tripsGenerated: p.tripsGenerated ?? 0,
                subscriptionExpiresAt: p.subscriptionExpiresAt,
            })),
            isDone: res.isDone,
            continueCursor: res.continueCursor,
        };
    },
});

export const _grantCredit = internalMutation({
    args: { planId: v.id("userPlans"), cap: v.number() },
    handler: async (ctx, { planId, cap }) => {
        const plan = await ctx.db.get(planId);
        if (!plan) return { granted: false };
        const current = plan.tripCredits ?? 0;
        if (current >= cap) return { granted: false };
        await ctx.db.patch(planId, { tripCredits: current + 1 });
        return { granted: true, credits: current + 1 };
    },
});

export const _sentSince = internalQuery({
    args: { userId: v.string(), type: v.string(), since: v.number() },
    handler: async (ctx, { userId, type, since }) => {
        const row = await ctx.db
            .query("notificationLog")
            .withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", type))
            .order("desc")
            .first();
        return !!row && row.sentAt >= since;
    },
});

/**
 * Cron, 1st of the month: +1 trip credit to every free user who has already
 * used the product (tripsGenerated >= 1) and holds fewer than the cap, then a
 * localized push. Premium users are skipped (unlimited anyway). `dryRun`
 * counts without writing.
 */
export const grantMonthlyCredits = internalAction({
    args: { dryRun: v.optional(v.boolean()) },
    handler: async (ctx, args): Promise<{ targeted: number; granted: number; sent: number; dryRun: boolean }> => {
        const now = Date.now();
        let cursor: string | null = null;
        let targeted = 0, granted = 0, sent = 0;

        for (let page = 0; page < 500; page++) {
            const res: any = await ctx.runQuery(internal.retention._plansPage, { cursor, numItems: 500 });
            for (const p of res.rows) {
                const premiumActive =
                    p.plan === "premium" && !!p.subscriptionExpiresAt && p.subscriptionExpiresAt > now;
                if (premiumActive) continue;
                if (p.tripsGenerated < 1) continue;          // hasn't tried the product yet — still has the signup credits
                if (p.tripCredits >= MONTHLY_CREDIT_CAP) continue;
                targeted++;
                if (args.dryRun) continue;

                // Guard against a re-run inside the same month.
                const already = await ctx.runQuery(internal.retention._sentSince, {
                    userId: p.userId, type: "credit_monthly", since: now - 25 * DAY_MS,
                });
                if (already) continue;

                const r: any = await ctx.runMutation(internal.retention._grantCredit, {
                    planId: p.planId, cap: MONTHLY_CREDIT_CAP,
                });
                if (!r.granted) continue;
                granted++;

                const settings: any = await ctx.runQuery(internal.notifications.getUserNotificationSettings, { userId: p.userId });
                const text = CREDIT_MONTHLY_TEXT[settings?.language || "en"] || CREDIT_MONTHLY_TEXT.en;
                try {
                    await ctx.runAction(internal.notifications.sendPushNotification, {
                        userId: p.userId,
                        title: text.title,
                        body: text.body,
                        type: "credit_monthly",
                        data: { screen: "create-trip" },
                    });
                    sent++;
                } catch (e) {
                    console.error("[retention] monthly credit push failed", p.userId, e);
                }
            }
            if (res.isDone) break;
            cursor = res.continueCursor;
        }

        console.log(`🎁 monthly credits — targeted ${targeted}, granted ${granted}, notified ${sent}${args.dryRun ? " (dry run)" : ""}`);
        return { targeted, granted, sent, dryRun: !!args.dryRun };
    },
});

// ───────────────────────────────────────────────────────────────────────────
// 4b. Dormancy ladder
// ───────────────────────────────────────────────────────────────────────────

// Rung → inclusive day range since last activity. Ranges (not exact days)
// so a skipped cron tick doesn't silently drop a user off the ladder.
const RUNGS: { type: string; from: number; to: number }[] = [
    { type: "dormant_d3", from: 3, to: 4 },
    { type: "deal_dormant_d7", from: 7, to: 9 },   // "deal_" prefix → honours the dealAlerts preference
    { type: "dormant_d21", from: 21, to: 24 },
];
const LADDER_END_DAYS = 45; // after this, only the newsletter talks to them

const DORMANT_TEXT: Record<string, Record<string, string>> = {
    en: {
        d3_title: "Your first itinerary takes 60 seconds ✈️",
        d3_body: "Tell us where and when — Planera builds the whole trip, day by day.",
        d7_title: "{{dest}} from {{currency}}{{price}} 📉",
        d7_body: "{{pct}}% below the usual fare from {{origin}}. Tap to see the deal.",
        d7_generic_title: "Fares from {{origin}} this week ✈️",
        d7_generic_body: "The Low-Fare Radar has new deals from your home airport.",
        d21_title: "New itineraries for {{dest}} 🗺️",
        d21_body: "Fresh ready-made plans for a place you're watching. Take a look.",
        d21_generic_title: "New ready-made itineraries 🗺️",
        d21_generic_body: "Explore has new day-by-day plans. Find your next one.",
    },
    el: {
        d3_title: "Το πρώτο σου πρόγραμμα θέλει 60 δευτερόλεπτα ✈️",
        d3_body: "Πες μας πού και πότε — η Planera φτιάχνει όλο το ταξίδι, μέρα με τη μέρα.",
        d7_title: "{{dest}} από {{currency}}{{price}} 📉",
        d7_body: "{{pct}}% κάτω από τη συνηθισμένη τιμή από {{origin}}. Πάτησε για την προσφορά.",
        d7_generic_title: "Ναύλοι από {{origin}} αυτή την εβδομάδα ✈️",
        d7_generic_body: "Το Low-Fare Radar έχει νέες προσφορές από το αεροδρόμιό σου.",
        d21_title: "Νέα προγράμματα για {{dest}} 🗺️",
        d21_body: "Φρέσκα έτοιμα πλάνα για έναν προορισμό που παρακολουθείς. Ρίξε μια ματιά.",
        d21_generic_title: "Νέα έτοιμα προγράμματα 🗺️",
        d21_generic_body: "Το Explore έχει νέα πλάνα μέρα με τη μέρα. Βρες το επόμενό σου.",
    },
    es: {
        d3_title: "Tu primer itinerario en 60 segundos ✈️",
        d3_body: "Dinos dónde y cuándo — Planera arma todo el viaje, día a día.",
        d7_title: "{{dest}} desde {{currency}}{{price}} 📉",
        d7_body: "{{pct}}% por debajo de la tarifa habitual desde {{origin}}. Toca para ver la oferta.",
        d7_generic_title: "Tarifas desde {{origin}} esta semana ✈️",
        d7_generic_body: "El Low-Fare Radar tiene nuevas ofertas desde tu aeropuerto.",
        d21_title: "Nuevos itinerarios para {{dest}} 🗺️",
        d21_body: "Planes listos y frescos para un lugar que sigues. Échales un vistazo.",
        d21_generic_title: "Nuevos itinerarios listos 🗺️",
        d21_generic_body: "Explore tiene nuevos planes día a día. Encuentra el próximo.",
    },
    fr: {
        d3_title: "Votre premier itinéraire en 60 secondes ✈️",
        d3_body: "Dites-nous où et quand — Planera construit tout le voyage, jour par jour.",
        d7_title: "{{dest}} dès {{currency}}{{price}} 📉",
        d7_body: "{{pct}}% sous le tarif habituel depuis {{origin}}. Appuyez pour voir l'offre.",
        d7_generic_title: "Tarifs depuis {{origin}} cette semaine ✈️",
        d7_generic_body: "Le Low-Fare Radar a de nouvelles offres depuis votre aéroport.",
        d21_title: "Nouveaux itinéraires pour {{dest}} 🗺️",
        d21_body: "De nouveaux plans prêts à l'emploi pour un lieu que vous suivez.",
        d21_generic_title: "Nouveaux itinéraires prêts 🗺️",
        d21_generic_body: "Explore a de nouveaux plans jour par jour. Trouvez le prochain.",
    },
    de: {
        d3_title: "Deine erste Reiseroute in 60 Sekunden ✈️",
        d3_body: "Sag uns wohin und wann — Planera plant die ganze Reise, Tag für Tag.",
        d7_title: "{{dest}} ab {{currency}}{{price}} 📉",
        d7_body: "{{pct}}% unter dem üblichen Preis ab {{origin}}. Tippe für das Angebot.",
        d7_generic_title: "Flüge ab {{origin}} diese Woche ✈️",
        d7_generic_body: "Der Low-Fare Radar hat neue Angebote von deinem Heimatflughafen.",
        d21_title: "Neue Reisepläne für {{dest}} 🗺️",
        d21_body: "Frische fertige Pläne für einen Ort, den du beobachtest. Schau rein.",
        d21_generic_title: "Neue fertige Reisepläne 🗺️",
        d21_generic_body: "Explore hat neue Tag-für-Tag-Pläne. Finde deinen nächsten.",
    },
    ar: {
        d3_title: "خطة رحلتك الأولى في 60 ثانية ✈️",
        d3_body: "أخبرنا أين ومتى — وستبني Planera الرحلة كاملة يومًا بيوم.",
        d7_title: "{{dest}} من {{currency}}{{price}} 📉",
        d7_body: "أقل بنسبة {{pct}}% من السعر المعتاد من {{origin}}. اضغط لرؤية العرض.",
        d7_generic_title: "أسعار من {{origin}} هذا الأسبوع ✈️",
        d7_generic_body: "لدى رادار الأسعار المنخفضة عروض جديدة من مطارك.",
        d21_title: "خطط جديدة لـ {{dest}} 🗺️",
        d21_body: "خطط جاهزة وجديدة لوجهة تتابعها. ألقِ نظرة.",
        d21_generic_title: "خطط رحلات جاهزة جديدة 🗺️",
        d21_generic_body: "لدى Explore خطط جديدة يومًا بيوم. اعثر على رحلتك القادمة.",
    },
};

function dormantText(lang: string | undefined, key: string, vars?: Record<string, string | number>): string {
    const t = DORMANT_TEXT[lang || "en"] || DORMANT_TEXT.en;
    let text = t[key] || DORMANT_TEXT.en[key] || "";
    for (const [k, val] of Object.entries(vars || {})) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(val));
    }
    return text;
}

export const _dormantUsersPage = internalQuery({
    args: {
        cursor: v.union(v.string(), v.null()),
        numItems: v.number(),
        // Pinned by the caller so every page sees the same index range.
        from: v.number(),
        to: v.number(),
    },
    handler: async (ctx, { cursor, numItems, from, to }) => {
        const res = await ctx.db
            .query("userSettings")
            .withIndex("by_lastActiveAt", (q) => q.gte("lastActiveAt", from).lte("lastActiveAt", to))
            .paginate({ cursor, numItems });
        return {
            rows: res.page.map((u: any) => ({
                userId: u.userId,
                lastActiveAt: u.lastActiveAt as number,
                language: u.language || "en",
                homeAirport: u.homeAirport || null,
                pushNotifications: u.pushNotifications,
            })),
            isDone: res.isDone,
            continueCursor: res.continueCursor,
        };
    },
});

/** Cheap per-user facts the ladder needs to pick a rung's content. */
export const _dormantContext = internalQuery({
    args: { userId: v.string(), homeIata: v.union(v.string(), v.null()) },
    handler: async (ctx, { userId, homeIata }) => {
        // userActivityStats is cron-maintained (≤1h stale) and ~200 bytes; a
        // trips read would cost ~57 KB per row.
        const stats = await ctx.db
            .query("userActivityStats")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first();
        let hasTrips = !!stats && stats.tripsCount > 0;
        if (!stats) {
            const anyTrip = await ctx.db
                .query("trips")
                .withIndex("by_user", (q) => q.eq("userId", userId))
                .first();
            hasTrips = !!anyTrip;
        }

        const watched = await ctx.db
            .query("watchedDestinations")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();

        let bestDeal: any = null;
        if (homeIata) {
            const now = Date.now();
            const deals = await ctx.db
                .query("lowFareRadar")
                .withIndex("by_origin", (q) => q.eq("origin", homeIata))
                .filter((q) => q.eq(q.field("active"), true))
                .collect();
            for (const d of deals) {
                if (d.deletedAt || (d.expiresAt && d.expiresAt < now)) continue;
                if (!d.typicalPrice || d.typicalPrice <= d.price) continue;
                const pct = (d.typicalPrice - d.price) / d.typicalPrice;
                if (!bestDeal || pct > bestDeal.pct) {
                    bestDeal = {
                        dealId: d._id, pct, price: d.price, currency: d.currency,
                        destinationCity: d.destinationCity, originCity: d.originCity,
                    };
                }
            }
        }

        // A watched destination with a published itinerary → the d21 rung
        // can name it. Bounded: at most 20 watches, first hit wins.
        let watchedWithItinerary: string | null = null;
        for (const w of watched) {
            const hit = await ctx.db
                .query("publishedItineraries")
                .withIndex("by_destination", (q) => q.eq("destination", w.destination))
                .filter((q) => q.eq(q.field("status"), "published"))
                .first();
            if (hit) {
                watchedWithItinerary = w.destination.replace(/\b\w/g, (c: string) => c.toUpperCase());
                break;
            }
        }

        return { hasTrips, bestDeal, watchedWithItinerary };
    },
});

/**
 * Daily cron. Walks users whose last activity falls on a ladder rung and
 * sends that rung's push once per dormancy spell — a user who comes back
 * resets (`lastActiveAt` moves), so the ladder can run again the next time
 * they go quiet. Users past LADDER_END_DAYS are left to the newsletter.
 *
 * Quiet hours: there is no per-user timezone (see radar-notification-system),
 * so the cron is scheduled at 09:00 UTC — late morning across Europe, where
 * nearly all users are.
 */
export const dormancyTick = internalAction({
    args: { dryRun: v.optional(v.boolean()) },
    handler: async (ctx, args): Promise<{ scanned: number; sent: Record<string, number>; dryRun: boolean }> => {
        const now = Date.now();
        let scanned = 0;
        const sent: Record<string, number> = {};

        for (const rung of RUNGS) {
            // lastActiveAt between (now - to days) and (now - from days)
            const from = now - (rung.to + 1) * DAY_MS;
            const to = now - rung.from * DAY_MS;
            let cursor: string | null = null;

            for (let page = 0; page < 200; page++) {
                const res: any = await ctx.runQuery(internal.retention._dormantUsersPage, {
                    cursor, numItems: 200, from, to,
                });
                for (const u of res.rows) {
                    scanned++;
                    if (u.pushNotifications === false) continue;
                    const daysQuiet = Math.floor((now - u.lastActiveAt) / DAY_MS);
                    if (daysQuiet > LADDER_END_DAYS) continue;

                    const already: boolean = await ctx.runQuery(internal.retention._sentSince, {
                        userId: u.userId, type: rung.type, since: u.lastActiveAt,
                    });
                    if (already) continue;

                    const homeIata = resolveHomeIata(u.homeAirport) || null;
                    const cx: any = await ctx.runQuery(internal.retention._dormantContext, {
                        userId: u.userId, homeIata,
                    });

                    let title = "", body = "", data: any = { screen: "home" };
                    if (rung.type === "dormant_d3") {
                        if (cx.hasTrips) continue; // the d3 rung is only for users who never generated
                        title = dormantText(u.language, "d3_title");
                        body = dormantText(u.language, "d3_body");
                        data = { screen: "create-trip" };
                    } else if (rung.type === "deal_dormant_d7") {
                        const origin = homeIata ? airportCityName(homeIata) || homeIata : "";
                        if (cx.bestDeal) {
                            title = dormantText(u.language, "d7_title", {
                                dest: cx.bestDeal.destinationCity, currency: cx.bestDeal.currency, price: Math.round(cx.bestDeal.price),
                            });
                            body = dormantText(u.language, "d7_body", {
                                pct: Math.round(cx.bestDeal.pct * 100), origin: cx.bestDeal.originCity || origin,
                            });
                            data = { screen: "deal-trip", dealId: cx.bestDeal.dealId };
                        } else if (homeIata) {
                            title = dormantText(u.language, "d7_generic_title", { origin });
                            body = dormantText(u.language, "d7_generic_body");
                            data = { screen: "home" };
                        } else {
                            continue; // no home airport → nothing personal to say
                        }
                    } else {
                        if (cx.watchedWithItinerary) {
                            title = dormantText(u.language, "d21_title", { dest: cx.watchedWithItinerary });
                            body = dormantText(u.language, "d21_body");
                        } else {
                            title = dormantText(u.language, "d21_generic_title");
                            body = dormantText(u.language, "d21_generic_body");
                        }
                        data = { screen: "destinations" };
                    }

                    if (args.dryRun) { sent[rung.type] = (sent[rung.type] || 0) + 1; continue; }
                    try {
                        await ctx.runAction(internal.notifications.sendPushNotification, {
                            userId: u.userId, title, body, type: rung.type, data,
                        });
                        sent[rung.type] = (sent[rung.type] || 0) + 1;
                    } catch (e) {
                        console.error("[retention] dormancy push failed", u.userId, rung.type, e);
                    }
                }
                if (res.isDone) break;
                cursor = res.continueCursor;
            }
        }

        console.log(`💤 dormancy tick — scanned ${scanned}, sent ${JSON.stringify(sent)}${args.dryRun ? " (dry run)" : ""}`);
        return { scanned, sent, dryRun: !!args.dryRun };
    },
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Collaborator joined → tell the owner
// ───────────────────────────────────────────────────────────────────────────

const COLLAB_JOIN_TEXT: Record<string, { title: string; body: string }> = {
    en: { title: "{{name}} joined your {{dest}} trip 🎉", body: "You're planning together now. Open the trip to see it with fresh eyes." },
    el: { title: "Ο/Η {{name}} μπήκε στο ταξίδι σου για {{dest}} 🎉", body: "Τώρα σχεδιάζετε μαζί. Άνοιξε το ταξίδι." },
    es: { title: "{{name}} se unió a tu viaje a {{dest}} 🎉", body: "Ahora planean juntos. Abre el viaje." },
    fr: { title: "{{name}} a rejoint votre voyage à {{dest}} 🎉", body: "Vous planifiez ensemble maintenant. Ouvrez le voyage." },
    de: { title: "{{name}} ist deiner Reise nach {{dest}} beigetreten 🎉", body: "Ihr plant jetzt gemeinsam. Öffne die Reise." },
    ar: { title: "انضم {{name}} إلى رحلتك إلى {{dest}} 🎉", body: "أنتم تخططون معًا الآن. افتح الرحلة." },
};

export const _collabJoinContext = internalQuery({
    args: { tripId: v.id("trips"), joinerId: v.string() },
    handler: async (ctx, { tripId, joinerId }) => {
        const trip = await ctx.db.get(tripId);
        if (!trip) return null;
        const joiner = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", joinerId))
            .first();
        return {
            ownerId: trip.userId,
            destination: trip.destination,
            joinerName: joiner?.name?.split(" ")[0] || null,
        };
    },
});

/** Scheduled from tripCollaborators.acceptInvite. */
export const notifyCollaboratorJoined = internalAction({
    args: { tripId: v.id("trips"), joinerId: v.string() },
    handler: async (ctx, args) => {
        const cx: any = await ctx.runQuery(internal.retention._collabJoinContext, args);
        if (!cx || cx.ownerId === args.joinerId) return;
        const settings: any = await ctx.runQuery(internal.notifications.getUserNotificationSettings, { userId: cx.ownerId });
        const text = COLLAB_JOIN_TEXT[settings?.language || "en"] || COLLAB_JOIN_TEXT.en;
        const vars = { name: cx.joinerName || "A friend", dest: cx.destination };
        const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars as any)[k] ?? "");
        await ctx.runAction(internal.notifications.sendPushNotification, {
            userId: cx.ownerId,
            title: fill(text.title),
            body: fill(text.body),
            type: `collab_joined_${args.joinerId}`,
            tripId: args.tripId,
            data: { screen: "trip", tripId: args.tripId },
        });
    },
});
