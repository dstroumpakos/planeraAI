import { v, ConvexError } from "convex/values";
import { mutation, query, action, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authMutation, authQuery } from "./functions";
import { quietHoursDelayMs, resolveUserTimezone } from "./lib/quietHours";
import { INBOX_UNREAD_CAP, INBOX_UNREAD_WINDOW_MS, inboxCategory, inboxData, statsDay, statsKey } from "./lib/notificationInbox";
import { describeWeatherCode } from "./weather";

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

// ─── Client-facing: Notification inbox ───
// The inbox IS notificationLog: every push sendPushNotification / sendExpoBatch
// sends writes one row per user, so whatever we pushed shows up here.

const INBOX_DEFAULT_LIMIT = 30;
const INBOX_MAX_LIMIT = 200;

/** Newest-first inbox for the signed-in user. "Load more" = a bigger `limit`. */
export const listMine = authQuery({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx: any, args: any) => {
        const userId = ctx.user.userId;
        const limit = Math.max(1, Math.min(INBOX_MAX_LIMIT, Math.floor(args.limit ?? INBOX_DEFAULT_LIMIT)));
        // `by_user` is ordered by _creationTime within a user, which tracks sentAt.
        const rows = await ctx.db
            .query("notificationLog")
            .withIndex("by_user", (q: any) => q.eq("userId", userId))
            .order("desc")
            .take(limit + 1);
        const unreadSince = Date.now() - INBOX_UNREAD_WINDOW_MS;
        return {
            items: rows.slice(0, limit).map((r: any) => {
                // Rows written before the inbox existed have no `data`; trip
                // reminders can still deep-link through their tripId.
                const data = r.data ?? (r.tripId ? { screen: "trip", tripId: r.tripId } : undefined);
                return {
                    _id: r._id,
                    type: r.type,
                    category: inboxCategory(r.type),
                    title: r.title,
                    body: r.body,
                    sentAt: r.sentAt,
                    // Anything older than the badge window counts as seen, so
                    // pre-inbox history doesn't render as a wall of unread dots.
                    read: !!r.readAt || r.sentAt < unreadSince,
                    data: data ?? null,
                };
            }),
            hasMore: rows.length > limit,
            unread: await countUnread(ctx, userId),
        };
    },
});

/** Unread count for the bell / profile badge. Capped at INBOX_UNREAD_CAP + 1. */
export const getUnreadCount = authQuery({
    args: {},
    handler: async (ctx: any) => countUnread(ctx, ctx.user.userId),
});

/**
 * The user opened a notification — tapped the push (`via: "push"`) or the
 * inbox row (`via: "inbox"`). Marks it read and, the first time only, records
 * the open for the admin open-rate.
 */
export const markRead = authMutation({
    args: { notificationId: v.string(), via: v.optional(v.string()) },
    returns: v.null(),
    handler: async (ctx: any, args: any) => {
        const id = ctx.db.normalizeId("notificationLog", args.notificationId);
        if (!id) return null;
        const row = await ctx.db.get(id);
        // Silently ignore someone else's row rather than confirming it exists.
        if (!row || row.userId !== ctx.user.userId) return null;
        if (row.openedAt) {
            if (!row.readAt) await ctx.db.patch(id, { readAt: Date.now() });
            return null;
        }
        const now = Date.now();
        const via = args.via === "inbox" ? "inbox" : "push";
        await ctx.db.patch(id, { readAt: row.readAt ?? now, openedAt: now, openedVia: via });
        await bumpStats(ctx, statsKey(row.type, row.sentAt, row.data), {
            opened: 1,
            openedPush: via === "push" ? 1 : 0,
            openedInbox: via === "inbox" ? 1 : 0,
        });
        return null;
    },
});

export const markAllRead = authMutation({
    args: {},
    handler: async (ctx: any) => {
        const userId = ctx.user.userId;
        const now = Date.now();
        // Bounded per call; the badge only counts the last 30 days, which is far
        // below this for any real user.
        const rows = await ctx.db
            .query("notificationLog")
            .withIndex("by_user_readAt_sentAt", (q: any) => q.eq("userId", userId).eq("readAt", undefined))
            .order("desc")
            .take(500);
        for (const r of rows) await ctx.db.patch(r._id, { readAt: now });
        return { marked: rows.length };
    },
});

// ─── Admin: open rates for every notification type (Low-Fare Radar widget) ───
//
// Covers everything that goes through sendPushNotification / sendExpoBatch —
// automatic deal + price-drop alerts, trip reminders, retention pushes AND
// admin broadcasts — from notificationStats counters. Opens only exist from
// the inbox release on (older app builds never report them), which is why the
// response says when tracking started.
export const getNotificationStats = query({
    args: { adminKey: v.string(), days: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
        if (!expected || args.adminKey !== expected) throw new ConvexError("Unauthorized: invalid admin key");

        const days = Math.max(1, Math.min(90, Math.floor(args.days ?? 30)));
        const sinceDay = statsDay(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
        const rows = await ctx.db
            .query("notificationStats")
            .withIndex("by_day", (q) => q.gte("day", sinceDay))
            .collect();
        const first = await ctx.db.query("notificationStats").withIndex("by_day").order("asc").first();

        type Counts = { sent: number; pushed: number; opened: number; openedPush: number; openedInbox: number };
        const zero = (): Counts => ({ sent: 0, pushed: 0, opened: 0, openedPush: 0, openedInbox: 0 });
        const add = (into: Counts, r: Counts) => {
            into.sent += r.sent;
            into.pushed += r.pushed;
            into.opened += r.opened;
            into.openedPush += r.openedPush;
            into.openedInbox += r.openedInbox;
        };

        const totals = zero();
        const byType = new Map<string, Counts & { type: string }>();
        const byDeal = new Map<string, Counts & { dealId: string; type: string; route: string | null; lastDay: string }>();
        const byDay = new Map<string, Counts & { day: string }>();

        for (const r of rows) {
            add(totals, r);
            const t = byType.get(r.type) ?? { type: r.type, ...zero() };
            add(t, r);
            byType.set(r.type, t);
            const d = byDay.get(r.day) ?? { day: r.day, ...zero() };
            add(d, r);
            byDay.set(r.day, d);
            if (r.dealId) {
                const k = `${r.dealId}|${r.type}`;
                const g = byDeal.get(k) ?? { dealId: r.dealId, type: r.type, route: r.route ?? null, lastDay: r.day, ...zero() };
                add(g, r);
                if (r.day > g.lastDay) g.lastDay = r.day;
                if (!g.route && r.route) g.route = r.route;
                byDeal.set(k, g);
            }
        }

        return {
            days,
            sinceDay,
            trackingSince: first?.day ?? null,
            totals,
            byType: Array.from(byType.values()).sort((a, b) => b.sent - a.sent),
            byDeal: Array.from(byDeal.values())
                .sort((a, b) => (b.lastDay > a.lastDay ? 1 : b.lastDay < a.lastDay ? -1 : b.sent - a.sent))
                .slice(0, 100),
            byDay: Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? -1 : 1)),
        };
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

type StatsDelta = { sent?: number; pushed?: number; opened?: number; openedPush?: number; openedInbox?: number };

/** Add to the per-day admin counters (notificationStats) for one key. */
async function bumpStats(
    ctx: any,
    key: { day: string; type: string; dealId?: string; route?: string },
    delta: StatsDelta
): Promise<void> {
    const existing = await ctx.db
        .query("notificationStats")
        .withIndex("by_day_type_deal", (q: any) =>
            q.eq("day", key.day).eq("type", key.type).eq("dealId", key.dealId)
        )
        .first();
    if (existing) {
        await ctx.db.patch(existing._id, {
            sent: existing.sent + (delta.sent || 0),
            pushed: existing.pushed + (delta.pushed || 0),
            opened: existing.opened + (delta.opened || 0),
            openedPush: existing.openedPush + (delta.openedPush || 0),
            openedInbox: existing.openedInbox + (delta.openedInbox || 0),
            ...(key.route && !existing.route ? { route: key.route } : {}),
        });
        return;
    }
    await ctx.db.insert("notificationStats", {
        day: key.day,
        type: key.type,
        dealId: key.dealId,
        route: key.route,
        sent: delta.sent || 0,
        pushed: delta.pushed || 0,
        opened: delta.opened || 0,
        openedPush: delta.openedPush || 0,
        openedInbox: delta.openedInbox || 0,
    });
}

/** Group rows by counter key and bump each key once (batch writes). */
async function bumpStatsGrouped(
    ctx: any,
    rows: Array<{ type: string; sentAt: number; data?: unknown }>,
    field: "sent" | "pushed"
): Promise<void> {
    const groups = new Map<string, { key: ReturnType<typeof statsKey>; n: number }>();
    for (const r of rows) {
        const key = statsKey(r.type, r.sentAt, r.data);
        const k = `${key.day}|${key.type}|${key.dealId ?? ""}`;
        const g = groups.get(k);
        if (g) g.n++;
        else groups.set(k, { key, n: 1 });
    }
    for (const { key, n } of groups.values()) await bumpStats(ctx, key, { [field]: n });
}

/** Flag inbox rows whose push reached at least one device. */
export const markPushed = internalMutation({
    args: { ids: v.array(v.string()) },
    handler: async (ctx, args) => {
        const rows: any[] = [];
        for (const raw of args.ids) {
            const id = ctx.db.normalizeId("notificationLog", raw);
            if (!id) continue;
            const row = await ctx.db.get(id);
            if (!row || row.pushed) continue;
            await ctx.db.patch(id, { pushed: true });
            rows.push(row);
        }
        await bumpStatsGrouped(ctx, rows, "pushed");
    },
});

/** Unread inbox rows inside the badge window, capped (the badge shows "99+"). */
async function countUnread(ctx: any, userId: string): Promise<number> {
    const rows = await ctx.db
        .query("notificationLog")
        .withIndex("by_user_readAt_sentAt", (q: any) =>
            q.eq("userId", userId).eq("readAt", undefined).gte("sentAt", Date.now() - INBOX_UNREAD_WINDOW_MS)
        )
        .take(INBOX_UNREAD_CAP + 1);
    return rows.length;
}

// ─── Internal: Log a notification (= write it to the user's inbox) ───
// Written BEFORE the push goes out so the payload can carry the row id (a push
// tap marks the inbox row read) and the user's new unread count (the app-icon
// badge). Returns both.
export const logNotification = internalMutation({
    args: {
        userId: v.string(),
        tripId: v.optional(v.id("trips")),
        type: v.string(),
        title: v.string(),
        body: v.string(),
        data: v.optional(v.any()),
    },
    handler: async (ctx, args): Promise<{ id: Id<"notificationLog">; unread: number }> => {
        const sentAt = Date.now();
        const data = inboxData(args.data);
        const id = await ctx.db.insert("notificationLog", {
            userId: args.userId,
            tripId: args.tripId,
            type: args.type,
            sentAt,
            title: args.title,
            body: args.body,
            data,
        });
        await bumpStats(ctx, statsKey(args.type, sentAt, data), { sent: 1 });
        return { id, unread: await countUnread(ctx, args.userId) };
    },
});

// ─── Internal: Get all trips that need notifications ───
/**
 * ONE PAGE of the trips a notification pass cares about.
 *
 * Why paginated, and why thin rows: this used to `.collect()` three bounded
 * date windows and return the matching trips whole. Trip documents embed the
 * entire generated `itinerary`, so they average ~57 KB — the collect read
 * 9.94 MB in a single transaction (62% of the 16 MB limit) and shipped 4.86 MB
 * back to the action, all to send a handful of push notifications that need a
 * destination name and an id. Convex has no column projection, so the only way
 * to bound the read is to bound the ROWS per transaction: the caller walks
 * pages, and `maximumBytesRead` caps each one at the database layer.
 *
 * `window` selects which bounded index range to walk:
 *   - "start"       → startDate in [now - maxTrip, now + 7d]: feeds both the
 *                     countdown reminders and the currently-active briefings
 *   - "ended"       → endDate in [now - 30d, now - 1d]: post-trip review
 *   - "anniversary" → endDate ~1 year ago (±2d)
 */
const NOTIF_PAGE_MAX_BYTES = 2 * 1024 * 1024;

export const _notifTripsWindowPage = internalQuery({
    args: {
        window: v.union(v.literal("start"), v.literal("ended"), v.literal("anniversary")),
        cursor: v.union(v.string(), v.null()),
        numItems: v.number(),
        // Pinned by the caller for the whole walk. Every page has to produce the
        // exact same index range or Convex rejects the cursor with
        // `InvalidCursor` — and `Date.now()` advances between transactions, so
        // it cannot be read inside this handler.
        now: v.number(),
    },
    handler: async (ctx, { window, cursor, numItems, now }) => {
        const dayMs = 24 * 60 * 60 * 1000;
        const sevenDaysMs = 7 * dayMs;
        const thirtyDaysMs = 30 * dayMs;
        // Longest trip we'll detect as "currently active" via the startDate
        // window. Covers essentially all real trips; trips longer than this that
        // started before the window aren't flagged active — an acceptable edge
        // case that keeps reads bounded. Tunable if reads grow.
        const maxTripMs = 60 * dayMs;

        const q =
            window === "start"
                ? ctx.db
                      .query("trips")
                      .withIndex("by_status_startDate", (ix) =>
                          ix
                              .eq("status", "completed")
                              .gte("startDate", now - maxTripMs)
                              .lte("startDate", now + sevenDaysMs),
                      )
                : window === "ended"
                  ? ctx.db
                        .query("trips")
                        .withIndex("by_status_endDate", (ix) =>
                            ix
                                .eq("status", "completed")
                                .gte("endDate", now - thirtyDaysMs)
                                .lte("endDate", now - dayMs),
                        )
                  : ctx.db
                        .query("trips")
                        .withIndex("by_status_endDate", (ix) =>
                            ix
                                .eq("status", "completed")
                                .gte("endDate", now - 367 * dayMs)
                                .lte("endDate", now - 363 * dayMs),
                        );

        const res = await q.paginate({
            cursor,
            numItems,
            maximumBytesRead: NOTIF_PAGE_MAX_BYTES,
        });

        // Project to just what the notification loop uses. `today` replaces the
        // whole itinerary blob for active trips: the briefing only ever needed
        // the current day's activity count and its first entry.
        const rows = res.page.map((trip: any) => {
            const daysUntilStart = Math.ceil((trip.startDate - now) / dayMs);
            const isActive = now >= trip.startDate && now <= trip.endDate;
            const currentDay = isActive
                ? Math.ceil((now - trip.startDate) / dayMs) + 1
                : null;

            let today: { activityCount: number; firstTime: string; firstTitle: string } | null = null;
            // First geocoded stop of the day (else of the trip) — the point the
            // morning briefing's weather line is fetched for.
            let coords: { lat: number; lng: number } | null = null;
            if (currentDay !== null) {
                const days: any[] = trip.itinerary?.dayByDayItinerary || [];
                const dayData = days.find((d: any) => d.day === currentDay);
                if (dayData) {
                    const first = dayData.activities?.[0];
                    today = {
                        activityCount: dayData.activities?.length || 0,
                        firstTime: first?.startTime || first?.time || "morning",
                        firstTitle: first?.title || "your first stop",
                    };
                }
                for (const d of dayData ? [dayData, ...days] : days) {
                    const a = (d.activities || []).find((x: any) => typeof x?.lat === "number" && typeof x?.lng === "number");
                    if (a) { coords = { lat: a.lat, lng: a.lng }; break; }
                }
            }

            return {
                _id: trip._id,
                userId: trip.userId,
                destination: trip.destination,
                startDate: trip.startDate,
                endDate: trip.endDate,
                userAtDestination: trip.userAtDestination,
                lastLocationCheckAt: trip.lastLocationCheckAt,
                daysUntilStart,
                daysSinceEnd: Math.ceil((now - trip.endDate) / dayMs),
                currentDay,
                today,
                coords,
            };
        });

        return { rows, isDone: res.isDone, continueCursor: res.continueCursor };
    },
});

// ─── Internal action: Send push notification via Expo Push API ───
// Pushes whose moment is the point (a countdown, a morning briefing, an
// admin test) are sent as-is. Everything else respects the user's local quiet
// hours and is rescheduled for the morning instead of buzzing at 3 am.
function isTimeCritical(type: string): boolean {
    return (
        type.startsWith("countdown") ||
        type.startsWith("morning_briefing") ||
        type === "admin_test_push" ||
        type.startsWith("location_")
    );
}

export const sendPushNotification = internalAction({
    args: {
        userId: v.string(),
        title: v.string(),
        body: v.string(),
        data: v.optional(v.any()),
        tripId: v.optional(v.id("trips")),
        type: v.string(),
        // Set when this call was rescheduled by the quiet-hours gate, so a
        // user whose clock never leaves the window can't loop forever.
        deferred: v.optional(v.boolean()),
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

        // Quiet hours (see lib/quietHours.ts)
        if (!args.deferred && !isTimeCritical(args.type)) {
            const tz = resolveUserTimezone(settings);
            const delay = quietHoursDelayMs(tz);
            if (delay > 0) {
                console.log(`🌙 Deferring ${args.type} for ${args.userId} by ${Math.round(delay / 60000)} min (${tz})`);
                await ctx.scheduler.runAfter(delay, internal.notifications.sendPushNotification, {
                    ...args,
                    deferred: true,
                });
                return;
            }
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

        // 3. Write it to the inbox first. Every notification that clears the
        // preference gates lands in the in-app list — including for users with
        // no registered device (web-only, revoked permission, reinstalled app),
        // who previously got nothing at all.
        const logged: { id: string; unread: number } = await ctx.runMutation(
            internal.notifications.logNotification,
            {
                userId: args.userId,
                tripId: args.tripId,
                type: args.type,
                title: args.title,
                body: args.body,
                data: args.data,
            }
        );

        // 4. Get push tokens
        const tokens = await ctx.runQuery(internal.notifications.getUserPushTokens, {
            userId: args.userId,
        });

        if (!tokens || tokens.length === 0) {
            console.log(`📱 No push tokens for user ${args.userId} — inbox only`);
            return;
        }

        // 5. Send via Expo Push API
        // `type` rides along in the payload so the client can log a
        // `notification_open` marketing event per push type (retention KPIs);
        // `notificationId` lets a tap mark the inbox row read; `badge` keeps the
        // app-icon count equal to the inbox's unread count.
        const messages = tokens.map((t: any) => ({
            to: t.token,
            sound: "default",
            title: args.title,
            body: args.body,
            badge: logged.unread,
            data: { ...(args.data || {}), type: args.type, notificationId: logged.id },
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
                if (result.data.some((ticket: any) => ticket?.status === "ok")) {
                    await ctx.runMutation(internal.notifications.markPushed, { ids: [logged.id] });
                }
            }
        } catch (error) {
            // The inbox row stays: the user still sees it in-app.
            console.error(`❌ Failed to send push notification:`, error);
        }
    },
});

// ─── Internal: Remove invalid token ───
export const removeInvalidToken = internalMutation({
    args: { tokenId: v.id("pushTokens") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.tokenId);
    },
});

// ─── Batched push sending (used by admin broadcasts) ───
//
// `sendPushNotification` above is the per-user path: it re-checks preferences,
// re-reads tokens and POSTs to Expo once per user. That is fine for a single
// trip reminder, but a broadcast to a few thousand users would mean a few
// thousand sequential HTTP round-trips inside one action — slow enough to risk
// a partial send with no way to resume.
//
// Expo accepts up to 100 messages per request, so broadcasts resolve their
// audience (and preference checks) up front and then push through here in
// chunks. See `lowFareRadar.executeBroadcast`.

/** Max messages Expo accepts in a single /push/send call. */
export const EXPO_PUSH_CHUNK_SIZE = 100;

export const removeInvalidTokensBatch = internalMutation({
    args: { tokenIds: v.array(v.id("pushTokens")) },
    handler: async (ctx, args) => {
        for (const id of args.tokenIds) {
            try {
                await ctx.db.delete(id);
            } catch {
                // Already gone (another send cleaned it up) — ignore.
            }
        }
    },
});

export const logNotificationsBatch = internalMutation({
    args: {
        rows: v.array(v.object({
            userId: v.string(),
            type: v.string(),
            title: v.string(),
            body: v.string(),
            data: v.optional(v.any()),
        })),
    },
    handler: async (ctx, args): Promise<Array<{ userId: string; id: Id<"notificationLog">; unread: number }>> => {
        const sentAt = Date.now();
        const out: Array<{ userId: string; id: Id<"notificationLog">; unread: number }> = [];
        const written: Array<{ type: string; sentAt: number; data?: unknown }> = [];
        for (const r of args.rows) {
            const data = inboxData(r.data);
            const id = await ctx.db.insert("notificationLog", {
                userId: r.userId,
                type: r.type,
                sentAt,
                title: r.title,
                body: r.body,
                data,
            });
            written.push({ type: r.type, sentAt, data });
            out.push({ userId: r.userId, id, unread: await countUnread(ctx, r.userId) });
        }
        await bumpStatsGrouped(ctx, written, "sent");
        return out;
    },
});

/**
 * Send one chunk of already-resolved push messages via the Expo Push API.
 *
 * Callers are responsible for preference checks — this does NOT re-read
 * userSettings. Pass at most EXPO_PUSH_CHUNK_SIZE messages.
 *
 * Returns per-user delivery so the caller can count users (not devices):
 * a user counts as delivered if at least one of their devices accepted.
 */
export const sendExpoBatch = internalAction({
    args: {
        messages: v.array(v.object({
            userId: v.string(),
            tokenId: v.id("pushTokens"),
            token: v.string(),
            title: v.string(),
            body: v.string(),
            data: v.optional(v.any()),
        })),
        type: v.string(),
        // When false, skip writing notificationLog rows (used by dry sends).
        log: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<{ deliveredUserIds: string[]; failedUserIds: string[]; invalidTokens: number }> => {
        if (args.messages.length === 0) {
            return { deliveredUserIds: [], failedUserIds: [], invalidTokens: 0 };
        }

        // Inbox rows first (one per user, not per device), so each push can
        // carry its row id + the user's unread badge — same as the per-user path.
        const inbox = new Map<string, { id: string; unread: number }>();
        if (args.log !== false) {
            const seen = new Set<string>();
            const rows: Array<{ userId: string; type: string; title: string; body: string; data?: any }> = [];
            for (const m of args.messages) {
                if (seen.has(m.userId)) continue;
                seen.add(m.userId);
                rows.push({ userId: m.userId, type: args.type, title: m.title, body: m.body, data: m.data });
            }
            const logged: Array<{ userId: string; id: string; unread: number }> = await ctx.runMutation(
                internal.notifications.logNotificationsBatch,
                { rows }
            );
            for (const l of logged) inbox.set(l.userId, { id: l.id, unread: l.unread });
        }

        const payload = args.messages.map((m) => {
            const row = inbox.get(m.userId);
            return {
                to: m.token,
                sound: "default",
                title: m.title,
                body: m.body,
                ...(row ? { badge: row.unread } : {}),
                data: { ...(m.data || {}), type: args.type, ...(row ? { notificationId: row.id } : {}) },
            };
        });

        let tickets: any[] = [];
        try {
            const response = await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            tickets = Array.isArray(result?.data) ? result.data : [];
            if (!response.ok && tickets.length === 0) {
                console.error("❌ Expo push batch rejected:", JSON.stringify(result).substring(0, 300));
            }
        } catch (error) {
            console.error("❌ Expo push batch failed:", error);
            // Whole chunk failed — every user in it is a failure.
            return {
                deliveredUserIds: [],
                failedUserIds: Array.from(new Set(args.messages.map((m) => m.userId))),
                invalidTokens: 0,
            };
        }

        // Expo returns one ticket per message, in order.
        const okByUser = new Map<string, boolean>();
        const badTokenIds: Id<"pushTokens">[] = [];

        args.messages.forEach((m, i) => {
            const ticket = tickets[i];
            // No ticket at all → treat as a failure for that device.
            const ok = !!ticket && ticket.status === "ok";
            okByUser.set(m.userId, (okByUser.get(m.userId) || false) || ok);
            if (ticket && ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
                badTokenIds.push(m.tokenId);
            }
        });

        if (badTokenIds.length > 0) {
            await ctx.runMutation(internal.notifications.removeInvalidTokensBatch, {
                tokenIds: badTokenIds,
            });
        }

        const deliveredUserIds: string[] = [];
        const failedUserIds: string[] = [];
        for (const [userId, ok] of okByUser.entries()) {
            (ok ? deliveredUserIds : failedUserIds).push(userId);
        }

        const pushedIds = deliveredUserIds
            .map((userId) => inbox.get(userId)?.id)
            .filter((id): id is string => !!id);
        if (pushedIds.length > 0) {
            await ctx.runMutation(internal.notifications.markPushed, { ids: pushedIds });
        }

        return { deliveredUserIds, failedUserIds, invalidTokens: badTokenIds.length };
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
        recap_title: "Your {{dest}} recap is ready 📸",
        recap_body: "{{dest}}, day by day: every stop, the distance you covered, and a card to share. Take a look.",
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
        recap_title: "Η ανασκόπηση του ταξιδιού σας στο {{dest}} είναι έτοιμη 📸",
        recap_body: "{{dest}}, μέρα με τη μέρα: κάθε στάση, η απόσταση που καλύψατε και μια κάρτα για να μοιραστείτε.",
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
        recap_title: "Tu resumen de {{dest}} está listo 📸",
        recap_body: "{{dest}}, día a día: cada parada, la distancia recorrida y una tarjeta para compartir.",
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
        recap_title: "Votre récap de {{dest}} est prêt 📸",
        recap_body: "{{dest}}, jour par jour : chaque étape, la distance parcourue et une carte à partager.",
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
        recap_title: "Dein {{dest}}-Rückblick ist fertig 📸",
        recap_body: "{{dest}}, Tag für Tag: jeder Stopp, die zurückgelegte Strecke und eine Karte zum Teilen.",
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
        recap_title: "ملخص رحلتك إلى {{dest}} جاهز 📸",
        recap_body: "{{dest}} يومًا بيوم: كل محطة، والمسافة التي قطعتها، وبطاقة للمشاركة.",
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

        // Walk each bounded window a page at a time — trip documents are fat
        // (~57 KB, they embed the itinerary), so the read has to be spread
        // across transactions rather than collected in one. See
        // `_notifTripsWindowPage`.
        type NotifTripRow = {
            _id: Id<"trips">;
            userId: string;
            destination: string;
            startDate: number;
            endDate: number;
            userAtDestination?: boolean;
            lastLocationCheckAt?: number;
            daysUntilStart: number;
            daysSinceEnd: number;
            currentDay: number | null;
            today: { activityCount: number; firstTime: string; firstTitle: string } | null;
            coords: { lat: number; lng: number } | null;
        };

        // Pinned once so every page of every window walks an identical index
        // range; a drifting `now` invalidates the pagination cursor.
        const windowNow = Date.now();

        const collectWindow = async (
            window: "start" | "ended" | "anniversary",
        ): Promise<NotifTripRow[]> => {
            const out: NotifTripRow[] = [];
            let cursor: string | null = null;
            // Page budget: a byte-capped page can come back short, so never
            // trust `isDone` alone to end the loop.
            for (let page = 0; page < 500; page++) {
                const res: {
                    rows: NotifTripRow[];
                    isDone: boolean;
                    continueCursor: string;
                } = await ctx.runQuery(internal.notifications._notifTripsWindowPage, {
                    window,
                    cursor,
                    numItems: 15,
                    now: windowNow,
                });
                out.push(...res.rows);
                if (res.isDone || res.continueCursor === cursor) break;
                cursor = res.continueCursor;
            }
            return out;
        };

        // The startDate window feeds two buckets: trips about to start
        // (countdowns) and trips happening right now (morning briefings).
        const startWindow = await collectWindow("start");
        const trips = {
            upcoming: startWindow.filter(
                (t) => t.daysUntilStart >= 0 && t.daysUntilStart <= 7,
            ),
            active: startWindow.filter((t) => t.currentDay !== null),
            recentlyEnded: (await collectWindow("ended")).filter(
                (t) => t.daysSinceEnd >= 1 && t.daysSinceEnd <= 30,
            ),
            anniversary: (await collectWindow("anniversary")).filter(
                (t) => t.daysSinceEnd >= 363 && t.daysSinceEnd <= 367,
            ),
        };

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

                // `today` is the current day's summary, extracted from the
                // itinerary inside the page query so the blob never travels.
                const { currentDay, today } = trip;
                // currentDay is always set for the active bucket; the explicit
                // check is what narrows it out of `number | null`.
                if (!today || currentDay === null) continue;

                const { activityCount, firstTime, firstTitle } = today;

                // Get user language for translations
                const userSettings = await ctx.runQuery(internal.notifications.getUserNotificationSettings, {
                    userId: trip.userId,
                });
                const lang = userSettings?.language || 'en';

                const title = getNotifText(lang, 'morning_title', { day: currentDay, dest: trip.destination });
                let body = activityCount > 0
                    ? getNotifText(lang, 'morning_body_activities', { count: activityCount, first: firstTitle, time: firstTime })
                    : getNotifText(lang, 'morning_body_free', { dest: trip.destination });

                // Weather line — language-neutral (emoji + temperatures), so no
                // extra translations. Skipped silently when there's no
                // geocoded stop or the provider is down.
                if (trip.coords) {
                    try {
                        const wx: any = await ctx.runAction(internal.weather.forecastForPoint, trip.coords);
                        const todayLocal = wx?.timezone
                            ? new Intl.DateTimeFormat("en-CA", { timeZone: wx.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
                            : new Date().toISOString().slice(0, 10);
                        const day = wx?.days?.find((d: any) => d.date === todayLocal) || wx?.days?.[0];
                        if (day) {
                            const w = describeWeatherCode(day.code);
                            body += ` ${w.emoji} ${Math.round(day.tMax)}°/${Math.round(day.tMin)}°`;
                        }
                    } catch (e) {
                        console.warn("[notifications] weather line skipped", e);
                    }
                }

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

            // Trip recap, 2-4 days after the end. Replaces the older generic
            // "how was it?" push: the recap screen (app/trip-recap.tsx) carries
            // the share card and the "leave one tip" CTA, so the same tap does
            // both jobs. Type stays distinct from post_trip_review so trips that
            // already received the old push don't get a second one.
            if (trip.daysSinceEnd >= 2 && trip.daysSinceEnd <= 4) {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: trip.userId,
                    title: getNotifText(lang, 'recap_title', { dest: trip.destination }),
                    body: getNotifText(lang, 'recap_body', { dest: trip.destination }),
                    tripId: trip._id,
                    type: "trip_recap",
                    data: { screen: "trip-recap", tripId: trip._id },
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

// ─── Streak rewards announcement (free users only) ───
const STREAK_PROMO: Record<string, { title: string; body: string }> = {
    en: {
        title: "🔥 Daily streaks = free trips!",
        body: "Check in 7 days in a row for a FREE AI trip. Start today! ✈️",
    },
    el: {
        title: "🔥 Τα σερί φέρνουν δωρεάν ταξίδια!",
        body: "Check-in 7 μέρες στη σειρά για ένα ΔΩΡΕΑΝ ταξίδι AI. Ξεκίνα σήμερα! ✈️",
    },
    es: {
        title: "🔥 ¡Las rachas dan viajes gratis!",
        body: "Haz check-in 7 días seguidos y gana un viaje con IA GRATIS. ¡Empieza hoy! ✈️",
    },
    fr: {
        title: "🔥 Les séries = voyages gratuits !",
        body: "Connectez-vous 7 jours d'affilée pour un voyage IA GRATUIT. Commencez aujourd'hui ! ✈️",
    },
    de: {
        title: "🔥 Serien = kostenlose Reisen!",
        body: "Checke 7 Tage in Folge ein für eine GRATIS KI-Reise. Starte heute! ✈️",
    },
    ar: {
        title: "🔥 السلاسل تعني رحلات مجانية!",
        body: "سجّل دخولك 7 أيام متتالية واكسب رحلة مجانية بالذكاء الاصطناعي. ابدأ اليوم! ✈️",
    },
};

/** Internal: list all FREE users (no active premium subscription) with their language. */
export const getFreeUsersForBroadcast = internalQuery({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();
        const allSettings = await ctx.db.query("userSettings").collect();
        const result: Array<{ userId: string; language: string | undefined }> = [];
        for (const s of allSettings) {
            const plan = await ctx.db
                .query("userPlans")
                .withIndex("by_user", (q) => q.eq("userId", s.userId))
                .unique();
            const isPremium =
                plan?.plan === "premium" &&
                !!plan?.subscriptionExpiresAt &&
                plan.subscriptionExpiresAt > now;
            if (!isPremium) {
                result.push({ userId: s.userId, language: s.language });
            }
        }
        return result;
    },
});

/**
 * Admin action: announce the streak-rewards feature to every FREE user, in their
 * own app language. Respects each user's master push-notification preference.
 * Pass `dryRun: true` to only count recipients without sending.
 */
export const broadcastStreakRewards = internalAction({
    args: { dryRun: v.optional(v.boolean()) },
    handler: async (ctx, args): Promise<{ targeted: number; sent: number; skipped: number; dryRun: boolean }> => {
        const users: Array<{ userId: string; language?: string }> = await ctx.runQuery(
            internal.notifications.getFreeUsersForBroadcast,
            {}
        );

        if (args.dryRun) {
            console.log(`📣 [dryRun] streak-rewards broadcast would target ${users.length} free user(s)`);
            return { targeted: users.length, sent: 0, skipped: 0, dryRun: true };
        }

        let sent = 0;
        let skipped = 0;
        for (const u of users) {
            const lang = u.language && STREAK_PROMO[u.language] ? u.language : "en";
            const copy = STREAK_PROMO[lang];
            try {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: u.userId,
                    title: copy.title,
                    body: copy.body,
                    // "streak_promo" is filtered only by the master pushNotifications toggle
                    type: "streak_promo",
                    data: { screen: "home" },
                });
                sent++;
            } catch (err) {
                console.error(`broadcastStreakRewards: failed for user ${u.userId}`, err);
                skipped++;
            }
        }

        console.log(`📣 streak-rewards broadcast complete — targeted ${users.length}, sent ${sent}, skipped ${skipped}`);
        return { targeted: users.length, sent, skipped, dryRun: false };
    },
});

// ─── One-off backfill: top up free users who used their original credit ───

/**
 * Free, non-subscribed users who have generated at least one trip AND have no
 * credits left — i.e. they used up their original single free credit before the
 * new "5 free credits" policy. Returns enough to grant credits + notify.
 */
export const getUsedUpFreeUsers = internalQuery({
    args: {},
    handler: async (ctx): Promise<Array<{ userId: string; planId: any }>> => {
        const now = Date.now();
        const plans = await ctx.db.query("userPlans").collect();
        const result: Array<{ userId: string; planId: any }> = [];
        for (const p of plans) {
            const isPremiumActive =
                p.plan === "premium" && !!p.subscriptionExpiresAt && p.subscriptionExpiresAt > now;
            const credits = p.tripCredits ?? 0;
            const generated = p.tripsGenerated ?? 0;
            if (!isPremiumActive && credits <= 0 && generated >= 1) {
                result.push({ userId: p.userId, planId: p._id });
            }
        }
        return result;
    },
});

/** Set a plan's trip credits to an exact amount (used by the backfill). */
export const setTripCredits = internalMutation({
    args: { planId: v.id("userPlans"), credits: v.number() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.planId, { tripCredits: args.credits });
        return null;
    },
});

// Marketing copy for the credit gift (master push-notification toggle still respected).
const CREDIT_GIFT = {
    title: "🎁 5 free trips, on us!",
    body: "Good news — we've added 5 free AI trip plans to your account. Your next adventure is one tap away. Where to? ✈️",
};

/**
 * Admin one-off: grant 5 trip credits to every free user who used up their
 * original credit, and notify them with the marketing message. Pass
 * `dryRun: true` to only count recipients without writing or sending.
 */
export const backfillFreeCreditsAndNotify = internalAction({
    args: { dryRun: v.optional(v.boolean()), credits: v.optional(v.number()) },
    handler: async (
        ctx,
        args,
    ): Promise<{ targeted: number; granted: number; sent: number; skipped: number; dryRun: boolean }> => {
        const grant = args.credits ?? 5;
        const users: Array<{ userId: string; planId: any }> = await ctx.runQuery(
            internal.notifications.getUsedUpFreeUsers,
            {},
        );

        if (args.dryRun) {
            console.log(`🎁 [dryRun] credit backfill would grant ${grant} credits to ${users.length} user(s)`);
            return { targeted: users.length, granted: 0, sent: 0, skipped: 0, dryRun: true };
        }

        let granted = 0;
        let sent = 0;
        let skipped = 0;
        for (const u of users) {
            try {
                await ctx.runMutation(internal.notifications.setTripCredits, {
                    planId: u.planId,
                    credits: grant,
                });
                granted++;
            } catch (err) {
                console.error(`backfill: failed to grant credits to ${u.userId}`, err);
                skipped++;
                continue;
            }
            try {
                await ctx.runAction(internal.notifications.sendPushNotification, {
                    userId: u.userId,
                    title: CREDIT_GIFT.title,
                    body: CREDIT_GIFT.body,
                    type: "credit_gift",
                    data: { screen: "create-trip" },
                });
                sent++;
            } catch (err) {
                console.error(`backfill: failed to notify ${u.userId}`, err);
            }
        }

        console.log(`🎁 credit backfill complete — targeted ${users.length}, granted ${granted}, notified ${sent}, skipped ${skipped}`);
        return { targeted: users.length, granted, sent, skipped, dryRun: false };
    },
});
