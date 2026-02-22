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
        const userId = ctx.user._id;

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
            let title = "";
            let body = "";

            if (daysUntilStart <= 1) {
                type = "countdown_1d";
                title = "Tomorrow is the day! ✈️";
                body = `Your trip to ${trip.destination} starts tomorrow! Make sure your passport and essentials are packed.`;
            } else if (daysUntilStart <= 3) {
                type = "countdown_3d";
                title = `${trip.destination} in 3 days! 🌴`;
                body = `Almost time! Your adventure to ${trip.destination} is just around the corner. Check your itinerary one more time.`;
            } else if (daysUntilStart <= 7) {
                type = "countdown_7d";
                title = `${trip.destination} is coming up! 🗺️`;
                body = `One week until your trip to ${trip.destination}! Time to start packing and get excited.`;
            }

            if (type) {
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

                const title = `Good morning! Day ${currentDay} in ${trip.destination} ☀️`;
                const body = activityCount > 0
                    ? `${activityCount} stops today — starting with ${firstTitle} at ${firstTime}. Have an amazing day!`
                    : `Enjoy a free day exploring ${trip.destination}!`;

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
            if (trip.daysSinceEnd >= 6 && trip.daysSinceEnd <= 8) {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title: `How was ${trip.destination}? 🌊`,
                    body: `It's been a week since your trip! We'd love to hear how it went. Share a travel insight to help other travelers.`,
                    tripId: trip._id,
                    type: "post_trip_review",
                    data: { screen: "trip", tripId: trip._id },
                });
            }

            // Plan next trip nudge (21-23 days after)
            if (trip.daysSinceEnd >= 21 && trip.daysSinceEnd <= 23) {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title: `Where to next? 🗺️`,
                    body: `Missing ${trip.destination}? Start planning your next adventure — it only takes 30 seconds!`,
                    tripId: trip._id,
                    type: "plan_next",
                    data: { screen: "create-trip" },
                });
            }
        }

        // ── Phase 2: Anniversary ──
        for (const trip of trips.anniversary) {
            await ctx.runAction(internal.notifications.sendPushNotification, {
                userId: trip.userId,
                title: `1 year since ${trip.destination}! 🎉`,
                body: `Remember your trip? Relive the memories or plan a return visit!`,
                tripId: trip._id,
                type: "anniversary",
                data: { screen: "trip", tripId: trip._id },
            });
        }

        console.log(`🔔 Notification check complete — ${trips.upcoming.length} upcoming, ${trips.active.length} active, ${trips.recentlyEnded.length} recently ended, ${trips.anniversary.length} anniversaries`);
    },
});
