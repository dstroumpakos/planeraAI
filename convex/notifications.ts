import { v } from "convex/values";
import { mutation, query, action, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { authMutation, authQuery } from "./functions";

// Type assertion: `internal.notifications` won't exist until `npx convex dev` regenerates types
const internal = _internal as any;

// ─── Client-facing: Register push token ───
export const registerPushToken = authMutation({
    args: {
        token: v.string(), // auth token (injected by authMutation)
        pushToken: v.string(), // Expo push token
        platform: v.string(),
        deviceName: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;

        // Check if this exact token already exists
        const existing = await ctx.db
            .query("pushTokens")
            .withIndex("by_token", (q: any) => q.eq("token", args.pushToken))
            .unique();

        if (existing) {
            // Update ownership (device may have changed user)
            await ctx.db.patch(existing._id, {
                userId,
                platform: args.platform,
                deviceName: args.deviceName,
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("pushTokens", {
                userId,
                token: args.pushToken,
                platform: args.platform,
                deviceName: args.deviceName,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        return null;
    },
});

// ─── Client-facing: Remove push token (on logout) ───
export const removePushToken = authMutation({
    args: {
        token: v.string(),
        pushToken: v.string(),
    },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const existing = await ctx.db
            .query("pushTokens")
            .withIndex("by_token", (q: any) => q.eq("token", args.pushToken))
            .unique();

        if (existing) {
            await ctx.db.delete(existing._id);
        }

        return null;
    },
});

// ─── Internal: Get all push tokens for a user ───
export const getUserPushTokens = internalQuery({
    args: { userId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("pushTokens")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect();
    },
});

// ─── Internal: Get user settings for notification preferences ───
export const getUserNotificationSettings = internalQuery({
    args: { userId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .unique();
    },
});

// ─── Internal: Check if notification was already sent ───
export const wasNotificationSent = internalQuery({
    args: {
        tripId: v.optional(v.id("trips")),
        type: v.string(),
    },
    handler: async (ctx, args) => {
        if (args.tripId) {
            const existing = await ctx.db
                .query("notificationLog")
                .withIndex("by_trip_type", (q) =>
                    q.eq("tripId", args.tripId).eq("type", args.type)
                )
                .first();
            return !!existing;
        }
        return false;
    },
});

// ─── Internal: Log that a notification was sent ───
export const logNotification = internalMutation({
    args: {
        userId: v.string(),
        tripId: v.optional(v.id("trips")),
        type: v.string(),
        title: v.string(),
        body: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("notificationLog", {
            userId: args.userId,
            tripId: args.tripId,
            type: args.type,
            sentAt: Date.now(),
            title: args.title,
            body: args.body,
        });
    },
});

// ─── Internal: Get all trips that need notifications ───
export const getTripsForNotifications = internalQuery({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const oneYearMs = 365 * 24 * 60 * 60 * 1000;

        // Get all completed trips
        const allTrips = await ctx.db
            .query("trips")
            .withIndex("by_status", (q) => q.eq("status", "completed"))
            .collect();

        const results: {
            upcoming: any[];
            active: any[];
            recentlyEnded: any[];
            anniversary: any[];
        } = {
            upcoming: [],
            active: [],
            recentlyEnded: [],
            anniversary: [],
        };

        for (const trip of allTrips) {
            const startDate = trip.startDate;
            const endDate = trip.endDate;
            const daysUntilStart = Math.ceil((startDate - now) / (24 * 60 * 60 * 1000));
            const daysSinceEnd = Math.ceil((now - endDate) / (24 * 60 * 60 * 1000));

            // Upcoming: 7, 3, or 1 day(s) before start
            if (daysUntilStart >= 0 && daysUntilStart <= 7) {
                results.upcoming.push({ ...trip, daysUntilStart });
            }

            // Currently active (between start and end date)
            if (now >= startDate && now <= endDate) {
                const currentDay = Math.ceil((now - startDate) / (24 * 60 * 60 * 1000)) + 1;
                results.active.push({ ...trip, currentDay });
            }

            // Post-trip: ended 1-30 days ago
            if (daysSinceEnd >= 1 && daysSinceEnd <= 30) {
                results.recentlyEnded.push({ ...trip, daysSinceEnd });
            }

            // Anniversary: ended roughly 1 year ago (±2 days tolerance)
            if (daysSinceEnd >= 363 && daysSinceEnd <= 367) {
                results.anniversary.push({ ...trip, daysSinceEnd });
            }
        }

        return results;
    },
});

// ─── Internal action: Send push notification via Expo Push API ───
export const sendPushNotification = internalAction({
    args: {
        userId: v.string(),
        title: v.string(),
        body: v.string(),
        data: v.optional(v.any()),
        tripId: v.optional(v.id("trips")),
        type: v.string(),
    },
    handler: async (ctx, args) => {
        // 1. Check user preferences
        const settings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
            userId: args.userId,
        });

        if (!settings) return;

        // Respect notification preferences
        if (settings.pushNotifications === false) {
            console.log(`🔕 Push notifications disabled for user ${args.userId}`);
            return;
        }

        // Check specific preference types
        if (args.type.startsWith("countdown") || args.type === "morning_briefing") {
            if (settings.tripReminders === false) {
                console.log(`🔕 Trip reminders disabled for user ${args.userId}`);
                return;
            }
        }

        if (args.type.startsWith("deal")) {
            if (settings.dealAlerts === false) {
                console.log(`🔕 Deal alerts disabled for user ${args.userId}`);
                return;
            }
        }

        // 2. Check if already sent
        if (args.tripId) {
            const alreadySent = await ctx.runQuery(internal.notifications.wasNotificationSent, {
                tripId: args.tripId,
                type: args.type,
            });
            if (alreadySent) {
                console.log(`📋 Notification ${args.type} already sent for trip ${args.tripId}`);
                return;
            }
        }

        // 3. Get push tokens
        const tokens = await ctx.runQuery(internal.notifications.getUserPushTokens, {
            userId: args.userId,
        });

        if (!tokens || tokens.length === 0) {
            console.log(`📱 No push tokens for user ${args.userId}`);
            return;
        }

        // 4. Send via Expo Push API
        const messages = tokens.map((t: any) => ({
            to: t.token,
            sound: "default",
            title: args.title,
            body: args.body,
            data: args.data || {},
        }));

        try {
            const response = await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(messages),
            });

            const result = await response.json();
            console.log(`📬 Push sent to ${tokens.length} device(s) for user ${args.userId}:`, JSON.stringify(result).substring(0, 200));

            // Handle invalid tokens - clean up
            if (result.data) {
                for (let i = 0; i < result.data.length; i++) {
                    if (result.data[i].status === "error") {
                        const errorType = result.data[i].details?.error;
                        if (errorType === "DeviceNotRegistered") {
                            // Token is invalid, remove it
                            const badToken = tokens[i];
                            if (badToken) {
                                await ctx.runMutation(internal.notifications.removeInvalidToken, {
                                    tokenId: badToken._id,
                                });
                                console.log(`🗑️ Removed invalid push token for user ${args.userId}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Failed to send push notification:`, error);
            return;
        }

        // 5. Log the notification
        await ctx.runMutation(internal.notifications.logNotification, {
            userId: args.userId,
            tripId: args.tripId,
            type: args.type,
            title: args.title,
            body: args.body,
        });
    },
});

// ─── Internal: Remove invalid token ───
export const removeInvalidToken = internalMutation({
    args: { tokenId: v.id("pushTokens") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.tokenId);
    },
});

// ─── Notification translations per language ───
const NOTIF_TRANSLATIONS: Record<string, Record<string, string>> = {
    en: {
        countdown_1d_title: "Tomorrow is the day! ✈️",
        countdown_1d_body: "Your trip to {{dest}} starts tomorrow! Make sure your passport and essentials are packed.",
        countdown_3d_title: "{{dest}} in 3 days! 🌴",
        countdown_3d_body: "Almost time! Your adventure to {{dest}} is just around the corner. Check your itinerary one more time.",
        countdown_7d_title: "{{dest}} is coming up! 🗺️",
        countdown_7d_body: "One week until your trip to {{dest}}! Time to start packing and get excited.",
        morning_title: "Good morning! Day {{day}} in {{dest}} ☀️",
        morning_body_activities: "{{count}} stops today — starting with {{first}} at {{time}}. Have an amazing day!",
        morning_body_free: "Enjoy a free day exploring {{dest}}!",
        post_trip_title: "How was {{dest}}? 🌊",
        post_trip_body: "It's been a week since your trip! We'd love to hear how it went. Share a travel insight to help other travelers.",
        plan_next_title: "Where to next? 🗺️",
        plan_next_body: "Missing {{dest}}? Start planning your next adventure — it only takes 30 seconds!",
        anniversary_title: "1 year since {{dest}}! 🎉",
        anniversary_body: "Remember your trip? Relive the memories or plan a return visit!",
    },
    el: {
        countdown_1d_title: "Αύριο είναι η μέρα! ✈️",
        countdown_1d_body: "Το ταξίδι σας στο {{dest}} ξεκινά αύριο! Βεβαιωθείτε ότι το διαβατήριο και τα απαραίτητα είναι έτοιμα.",
        countdown_3d_title: "{{dest}} σε 3 μέρες! 🌴",
        countdown_3d_body: "Σχεδόν ώρα! Η περιπέτειά σας στο {{dest}} είναι κοντά. Ελέγξτε το πρόγραμμά σας μία ακόμα φορά.",
        countdown_7d_title: "Το {{dest}} πλησιάζει! 🗺️",
        countdown_7d_body: "Μία εβδομάδα μέχρι το ταξίδι σας στο {{dest}}! Ώρα να ξεκινήσετε το πακετάρισμα.",
        morning_title: "Καλημέρα! Μέρα {{day}} στο {{dest}} ☀️",
        morning_body_activities: "{{count}} στάσεις σήμερα — ξεκινώντας με {{first}} στις {{time}}. Καλή μέρα!",
        morning_body_free: "Απολαύστε μια ελεύθερη μέρα εξερευνώντας το {{dest}}!",
        post_trip_title: "Πώς ήταν το {{dest}}; 🌊",
        post_trip_body: "Πέρασε μία εβδομάδα από το ταξίδι σας! Μοιραστείτε τις εμπειρίες σας για να βοηθήσετε άλλους ταξιδιώτες.",
        plan_next_title: "Πού θα πάτε μετά; 🗺️",
        plan_next_body: "Σας λείπει το {{dest}}; Ξεκινήστε να σχεδιάζετε την επόμενη περιπέτειά σας — χρειάζεται μόνο 30 δευτερόλεπτα!",
        anniversary_title: "1 χρόνος από το {{dest}}! 🎉",
        anniversary_body: "Θυμάστε το ταξίδι σας; Ξαναζήστε τις αναμνήσεις ή σχεδιάστε μια επιστροφή!",
    },
    es: {
        countdown_1d_title: "¡Mañana es el día! ✈️",
        countdown_1d_body: "Tu viaje a {{dest}} comienza mañana. ¡Asegúrate de tener el pasaporte y lo esencial listo!",
        countdown_3d_title: "¡{{dest}} en 3 días! 🌴",
        countdown_3d_body: "¡Casi es hora! Tu aventura a {{dest}} está a la vuelta de la esquina. Revisa tu itinerario una vez más.",
        countdown_7d_title: "¡{{dest}} se acerca! 🗺️",
        countdown_7d_body: "¡Una semana para tu viaje a {{dest}}! Es hora de empezar a hacer las maletas.",
        morning_title: "¡Buenos días! Día {{day}} en {{dest}} ☀️",
        morning_body_activities: "{{count}} paradas hoy — empezando con {{first}} a las {{time}}. ¡Que tengas un gran día!",
        morning_body_free: "¡Disfruta un día libre explorando {{dest}}!",
        post_trip_title: "¿Qué tal {{dest}}? 🌊",
        post_trip_body: "¡Ha pasado una semana desde tu viaje! Comparte tus experiencias para ayudar a otros viajeros.",
        plan_next_title: "¿A dónde ahora? 🗺️",
        plan_next_body: "¿Extrañas {{dest}}? Empieza a planificar tu próxima aventura — ¡solo toma 30 segundos!",
        anniversary_title: "¡1 año desde {{dest}}! 🎉",
        anniversary_body: "¿Recuerdas tu viaje? ¡Revive los recuerdos o planifica una visita de regreso!",
    },
    fr: {
        countdown_1d_title: "C'est demain ! ✈️",
        countdown_1d_body: "Votre voyage à {{dest}} commence demain ! Vérifiez que votre passeport et vos essentiels sont prêts.",
        countdown_3d_title: "{{dest}} dans 3 jours ! 🌴",
        countdown_3d_body: "C'est bientôt l'heure ! Votre aventure à {{dest}} approche. Revérifiez votre itinéraire.",
        countdown_7d_title: "{{dest}} approche ! 🗺️",
        countdown_7d_body: "Une semaine avant votre voyage à {{dest}} ! Il est temps de commencer à faire vos valises.",
        morning_title: "Bonjour ! Jour {{day}} à {{dest}} ☀️",
        morning_body_activities: "{{count}} arrêts aujourd'hui — en commençant par {{first}} à {{time}}. Bonne journée !",
        morning_body_free: "Profitez d'une journée libre pour explorer {{dest}} !",
        post_trip_title: "Comment était {{dest}} ? 🌊",
        post_trip_body: "Cela fait une semaine depuis votre voyage ! Partagez vos impressions pour aider d'autres voyageurs.",
        plan_next_title: "Quelle est la prochaine destination ? 🗺️",
        plan_next_body: "{{dest}} vous manque ? Commencez à planifier votre prochaine aventure — ça ne prend que 30 secondes !",
        anniversary_title: "1 an depuis {{dest}} ! 🎉",
        anniversary_body: "Vous vous souvenez de votre voyage ? Revivez les souvenirs ou planifiez un retour !",
    },
    de: {
        countdown_1d_title: "Morgen geht's los! ✈️",
        countdown_1d_body: "Ihre Reise nach {{dest}} beginnt morgen! Stellen Sie sicher, dass Reisepass und alles Wichtige gepackt sind.",
        countdown_3d_title: "{{dest}} in 3 Tagen! 🌴",
        countdown_3d_body: "Fast soweit! Ihr Abenteuer nach {{dest}} steht vor der Tür. Prüfen Sie Ihren Reiseplan noch einmal.",
        countdown_7d_title: "{{dest}} rückt näher! 🗺️",
        countdown_7d_body: "Noch eine Woche bis zu Ihrer Reise nach {{dest}}! Zeit, mit dem Packen zu beginnen.",
        morning_title: "Guten Morgen! Tag {{day}} in {{dest}} ☀️",
        morning_body_activities: "{{count}} Stopps heute — beginnend mit {{first}} um {{time}}. Einen wunderbaren Tag!",
        morning_body_free: "Genießen Sie einen freien Tag und erkunden Sie {{dest}}!",
        post_trip_title: "Wie war {{dest}}? 🌊",
        post_trip_body: "Es ist eine Woche seit Ihrer Reise! Teilen Sie Ihre Erfahrungen, um anderen Reisenden zu helfen.",
        plan_next_title: "Wohin als Nächstes? 🗺️",
        plan_next_body: "Vermissen Sie {{dest}}? Planen Sie Ihr nächstes Abenteuer — es dauert nur 30 Sekunden!",
        anniversary_title: "1 Jahr seit {{dest}}! 🎉",
        anniversary_body: "Erinnern Sie sich an Ihre Reise? Erleben Sie die Erinnerungen noch einmal oder planen Sie eine Rückkehr!",
    },
    ar: {
        countdown_1d_title: "غداً هو اليوم! ✈️",
        countdown_1d_body: "رحلتك إلى {{dest}} تبدأ غداً! تأكد من أن جواز السفر والأساسيات جاهزة.",
        countdown_3d_title: "{{dest}} بعد 3 أيام! 🌴",
        countdown_3d_body: "أوشك الوقت! مغامرتك إلى {{dest}} على الأبواب. راجع برنامج رحلتك مرة أخرى.",
        countdown_7d_title: "{{dest}} يقترب! 🗺️",
        countdown_7d_body: "أسبوع واحد حتى رحلتك إلى {{dest}}! حان وقت التحضير.",
        morning_title: "صباح الخير! اليوم {{day}} في {{dest}} ☀️",
        morning_body_activities: "{{count}} محطات اليوم — بدءاً من {{first}} في {{time}}. يوماً رائعاً!",
        morning_body_free: "استمتع بيوم حر في استكشاف {{dest}}!",
        post_trip_title: "كيف كانت {{dest}}؟ 🌊",
        post_trip_body: "مر أسبوع على رحلتك! شارك تجربتك لمساعدة المسافرين الآخرين.",
        plan_next_title: "إلى أين بعد ذلك؟ 🗺️",
        plan_next_body: "تفتقد {{dest}}؟ ابدأ بالتخطيط لمغامرتك القادمة — لا يستغرق الأمر سوى 30 ثانية!",
        anniversary_title: "مر عام على {{dest}}! 🎉",
        anniversary_body: "هل تتذكر رحلتك؟ أعد عيش الذكريات أو خطط لزيارة العودة!",
    },
};

// Helper to get translated notification text
function getNotifText(lang: string | undefined, key: string, vars?: Record<string, string | number>): string {
    const translations = NOTIF_TRANSLATIONS[lang || 'en'] || NOTIF_TRANSLATIONS['en'];
    let text = translations[key] || NOTIF_TRANSLATIONS['en'][key] || '';
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
    }
    return text;
}

// ─── Internal action: Process all notification checks (called by cron) ───
export const processScheduledNotifications = internalAction({
    args: {},
    handler: async (ctx) => {
        console.log("🔔 Running scheduled notification check...");

        const trips = await ctx.runQuery(internal.notifications.getTripsForNotifications, {});

        // ── Phase 1: Countdown reminders (7d, 3d, 1d before trip) ──
        for (const trip of trips.upcoming) {
            const { daysUntilStart } = trip;
            let type: string | null = null;

            // Get user language for translations
            const userSettings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
                userId: trip.userId,
            });
            const lang = userSettings?.language || 'en';

            if (daysUntilStart <= 1) {
                type = "countdown_1d";
            } else if (daysUntilStart <= 3) {
                type = "countdown_3d";
            } else if (daysUntilStart <= 7) {
                type = "countdown_7d";
            }

            if (type) {
                const title = getNotifText(lang, `${type}_title`, { dest: trip.destination });
                const body = getNotifText(lang, `${type}_body`, { dest: trip.destination });

                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title,
                    body,
                    tripId: trip._id,
                    type,
                    data: { screen: "trip", tripId: trip._id },
                });
            }
        }

        // ── Phase 1: Morning daily briefing (for active trips) ──
        // Only send if user has been confirmed at the destination via client-side location check.
        // This prevents notifications when the user has a trip scheduled but isn't physically there.
        const now = new Date();
        const currentHour = now.getUTCHours();
        // Only send morning briefings between 6-9 UTC (covers most timezones morning)
        if (currentHour >= 6 && currentHour <= 9) {
            for (const trip of trips.active) {
                // Skip if user has not been confirmed at the destination
                if (trip.userAtDestination !== true) {
                    console.log(`📍 Skipping morning briefing for ${trip.destination} — user not confirmed at destination`);
                    continue;
                }

                // If the location check is stale (>24h old), skip to be safe
                if (trip.lastLocationCheckAt && (Date.now() - trip.lastLocationCheckAt) > 24 * 60 * 60 * 1000) {
                    console.log(`📍 Skipping morning briefing for ${trip.destination} — location check is stale`);
                    continue;
                }

                const { currentDay } = trip;
                const dayData = trip.itinerary?.dayByDayItinerary?.find((d: any) => d.day === currentDay);

                if (!dayData) continue;

                const activityCount = dayData.activities?.length || 0;
                const firstActivity = dayData.activities?.[0];
                const firstTime = firstActivity?.startTime || firstActivity?.time || "morning";
                const firstTitle = firstActivity?.title || "your first stop";

                // Get user language for translations
                const userSettings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
                    userId: trip.userId,
                });
                const lang = userSettings?.language || 'en';

                const title = getNotifText(lang, 'morning_title', { day: currentDay, dest: trip.destination });
                const body = activityCount > 0
                    ? getNotifText(lang, 'morning_body_activities', { count: activityCount, first: firstTitle, time: firstTime })
                    : getNotifText(lang, 'morning_body_free', { dest: trip.destination });

                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title,
                    body,
                    tripId: trip._id,
                    type: `morning_briefing_day${currentDay}`,
                    data: { screen: "trip", tripId: trip._id },
                });
            }
        }

        // ── Phase 2: Post-trip review (7 days after trip ends) ──
        for (const trip of trips.recentlyEnded) {
            // Get user language for translations
            const userSettings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
                userId: trip.userId,
            });
            const lang = userSettings?.language || 'en';

            if (trip.daysSinceEnd >= 6 && trip.daysSinceEnd <= 8) {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title: getNotifText(lang, 'post_trip_title', { dest: trip.destination }),
                    body: getNotifText(lang, 'post_trip_body', { dest: trip.destination }),
                    tripId: trip._id,
                    type: "post_trip_review",
                    data: { screen: "trip", tripId: trip._id },
                });
            }

            // Plan next trip nudge (21-23 days after)
            if (trip.daysSinceEnd >= 21 && trip.daysSinceEnd <= 23) {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title: getNotifText(lang, 'plan_next_title', { dest: trip.destination }),
                    body: getNotifText(lang, 'plan_next_body', { dest: trip.destination }),
                    tripId: trip._id,
                    type: "plan_next",
                    data: { screen: "create-trip" },
                });
            }
        }

        // ── Phase 2: Anniversary ──
        for (const trip of trips.anniversary) {
            // Get user language for translations
            const userSettings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
                userId: trip.userId,
            });
            const lang = userSettings?.language || 'en';

            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: trip.userId,
                title: getNotifText(lang, 'anniversary_title', { dest: trip.destination }),
                body: getNotifText(lang, 'anniversary_body', { dest: trip.destination }),
                tripId: trip._id,
                type: "anniversary",
                data: { screen: "trip", tripId: trip._id },
            });
        }

        console.log(`🔔 Notification check complete — ${trips.upcoming.length} upcoming, ${trips.active.length} active, ${trips.recentlyEnded.length} recently ended, ${trips.anniversary.length} anniversaries`);
    },
});
