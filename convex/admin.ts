import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { canonicalHomeAirport, resolveHomeIata } from "../lib/homeAirport";

// Admin identifiers from environment variable (comma-separated)
// Can be emails OR userIds (e.g., "apple:001386...")
function getAdminIdentifiers(): string[] {
    const adminEnv = process.env.ADMIN_EMAILS || "";
    return adminEnv
        .split(",")
        .map(id => id.trim().toLowerCase())
        .filter(id => id.length > 0);
}

// Helper to check if a user is admin
async function checkIsAdmin(ctx: any, userId: string): Promise<boolean> {
    const adminIdentifiers = getAdminIdentifiers();
    
    // Check if userId directly matches (for Apple/OAuth users)
    if (adminIdentifiers.includes(userId.toLowerCase())) {
        return true;
    }
    
    // Get user from userSettings (has email)
    const userSettings = await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .first();
    
    // Also check users table for isAdmin flag
    const user = userSettings?.email 
        ? await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", userSettings.email.toLowerCase()))
            .first()
        : null;
    
    // Check if user has isAdmin flag
    if (user?.isAdmin === true) {
        return true;
    }
    
    // Check if email matches ADMIN_EMAILS
    if (userSettings?.email) {
        const userEmail = userSettings.email.toLowerCase();
        if (adminIdentifiers.includes(userEmail)) {
            return true;
        }
    }
    
    return false;
}

// Assert admin access - throws if not admin
export async function assertAdmin(ctx: any, userId: string): Promise<void> {
    const isAdmin = await checkIsAdmin(ctx, userId);
    if (!isAdmin) {
        throw new Error("Unauthorized: Admin access required");
    }
}

// Helper to get userId from token
async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
    const session = await ctx.db
        .query("sessions")
        .withIndex("by_token", (q: any) => q.eq("token", token))
        .first();
    
    if (!session || session.expiresAt < Date.now()) {
        return null;
    }
    
    return session.userId;
}

// ===========================================
// ADMIN STATUS QUERY
// ===========================================

export const isAdmin = query({
    args: { token: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) return false;
        
        return await checkIsAdmin(ctx, userId);
    },
});

// ===========================================
// ADMIN STATS / DASHBOARD
// ===========================================

export const getStats = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        // Get pending insights count
        const pendingInsights = await ctx.db
            .query("insights")
            .withIndex("by_moderation_status", (q: any) => q.eq("moderationStatus", "pending"))
            .collect();
        
        // Get flagged/reported insights count
        const flaggedInsights = await ctx.db
            .query("insights")
            .withIndex("by_moderation_status", (q: any) => q.eq("moderationStatus", "flagged"))
            .collect();
        
        // Get all insights for stats
        const allInsights = await ctx.db.query("insights").collect();
        
        // Get all REAL users from userSettings (this is where sign-ups are stored)
        const allUserSettings = await ctx.db.query("userSettings").collect();
        
        // Trip aggregates come from the cached singleton (recomputed by cron) so
        // we never scan the large trips table here. Recent trips are a cheap
        // indexed take(10).
        const cachedTripStats = await ctx.db.query("landingStats").first();
        const recentTripDocs = await ctx.db.query("trips").order("desc").take(10);

        // Get all user plans for premium count
        const allPlans = await ctx.db.query("userPlans").collect();
        const premiumUsersCount = allPlans.filter((p: any) => p.plan === "premium").length;
        
        // Get active sessions (not expired)
        const allSessions = await ctx.db.query("sessions").collect();
        const activeSessions = allSessions.filter((s: any) => s.expiresAt > Date.now());

        // Top destinations by insights
        const destinationCounts: Record<string, number> = {};
        allInsights.forEach((insight: any) => {
            if (insight.destination) {
                destinationCounts[insight.destination] = (destinationCounts[insight.destination] || 0) + 1;
            }
        });
        
        // Top destinations by trips — from the cached aggregate.
        const topTripDestinations = cachedTripStats?.topTripDestinations ?? [];

        const topDestinations = Object.entries(destinationCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([destination, count]) => ({ destination, count }));
        
        // Most liked insights
        const mostLikedInsights = [...allInsights]
            .filter((i: any) => i.moderationStatus === "approved")
            .sort((a: any, b: any) => (b.likes || 0) - (a.likes || 0))
            .slice(0, 5)
            .map((i: any) => ({
                _id: i._id,
                destination: i.destination,
                content: i.content?.substring(0, 100) + (i.content?.length > 100 ? "..." : ""),
                likes: i.likes || 0,
                category: i.category,
            }));
        
        // Most active users (by daily check-in streak)
        const allStreaks = await ctx.db.query("userStreaks").collect();

        const topStreaks = [...allStreaks]
            .sort((a: any, b: any) => {
                const curDiff = (b.currentStreak || 0) - (a.currentStreak || 0);
                if (curDiff !== 0) return curDiff;
                return (b.totalCheckIns || 0) - (a.totalCheckIns || 0);
            })
            .filter((s: any) => (s.currentStreak || 0) > 0 || (s.totalCheckIns || 0) > 0)
            .slice(0, 5);

        const mostActiveUsers = await Promise.all(
            topStreaks.map(async (s: any) => {
                const settings = await ctx.db
                    .query("userSettings")
                    .withIndex("by_user", (q: any) => q.eq("userId", s.userId))
                    .first();
                return {
                    userId: s.userId,
                    name: settings?.name || "Unknown",
                    email: settings?.email || "Unknown",
                    currentStreak: s.currentStreak || 0,
                    longestStreak: s.longestStreak || 0,
                    totalCheckIns: s.totalCheckIns || 0,
                };
            })
        );

        // Last 10 newly registered users
        const recentUsers = await Promise.all(
            [...allUserSettings]
                .sort((a: any, b: any) => (b._creationTime || 0) - (a._creationTime || 0))
                .slice(0, 10)
                .map(async (u: any) => {
                    // Platform the user signed up from. New signups store this directly;
                    // older users predate the field, so fall back to the platform of any
                    // push token they've registered (mobile devices record ios/android).
                    let platform = u.platform;
                    if (!platform) {
                        const pushToken = await ctx.db
                            .query("pushTokens")
                            .withIndex("by_user", (q: any) => q.eq("userId", u.userId))
                            .first();
                        platform = pushToken?.platform;
                    }
                    return {
                        userId: u.userId,
                        name: u.name || "Unknown",
                        email: u.email || "Unknown",
                        image: u.image,
                        platform: platform || "unknown",
                        createdAt: u._creationTime,
                    };
                })
        );

        // Build a quick lookup of userSettings by userId
        const userSettingsByUserId: Record<string, any> = {};
        for (const s of allUserSettings) {
            if ((s as any).userId) {
                userSettingsByUserId[(s as any).userId] = s;
            }
        }

        // Last 10 generated trips (most recent first)
        const recentTrips = recentTripDocs
            .map((t: any) => {
                const owner = userSettingsByUserId[t.userId];
                return {
                    tripId: t._id,
                    destination: t.destination || "Unknown",
                    origin: t.origin,
                    startDate: t.startDate,
                    endDate: t.endDate,
                    status: t.status,
                    platform: t.platform || "unknown",
                    createdAt: t._creationTime,
                    userId: t.userId,
                    userName: owner?.name || "Unknown",
                    userEmail: owner?.email || "Unknown",
                    userImage: owner?.image,
                };
            });

        return {
            pendingInsightsCount: pendingInsights.length,
            flaggedInsightsCount: flaggedInsights.length,
            totalInsightsCount: allInsights.length,
            approvedInsightsCount: allInsights.filter((i: any) => i.moderationStatus === "approved").length,
            totalUsersCount: allUserSettings.length,
            premiumUsersCount,
            activeSessionsCount: activeSessions.length,
            totalTripsCount: cachedTripStats?.tripsCount ?? 0,
            completedTripsCount: cachedTripStats?.completedTripsCount ?? 0,
            topDestinations,
            topTripDestinations,
            mostLikedInsights,
            mostActiveUsers,
            recentUsers,
            recentTrips,
        };
    },
});

// ===========================================
// INSIGHTS MODERATION
// ===========================================

export const listInsights = query({
    args: { 
        token: v.string(),
        status: v.optional(v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("flagged")
        )),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        let insights;
        if (args.status) {
            insights = await ctx.db
                .query("insights")
                .withIndex("by_moderation_status", (q: any) => q.eq("moderationStatus", args.status))
                .order("desc")
                .take(args.limit || 50);
        } else {
            insights = await ctx.db
                .query("insights")
                .order("desc")
                .take(args.limit || 50);
        }
        
        // Enrich with user info
        const enrichedInsights = await Promise.all(
            insights.map(async (insight: any) => {
                const userSettings = await ctx.db
                    .query("userSettings")
                    .withIndex("by_user", (q: any) => q.eq("userId", insight.userId))
                    .first();
                
                return {
                    ...insight,
                    userName: userSettings?.name || "Unknown",
                    userEmail: userSettings?.email || "Unknown",
                };
            })
        );
        
        return enrichedInsights;
    },
});

export const getInsight = query({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const insight = await ctx.db.get(args.insightId);
        if (!insight) throw new Error("Insight not found");
        
        const userSettings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", insight.userId))
            .first();
        
        return {
            ...insight,
            userName: userSettings?.name || "Unknown",
            userEmail: userSettings?.email || "Unknown",
        };
    },
});

export const approveInsight = mutation({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        await ctx.db.patch(args.insightId, {
            moderationStatus: "approved",
            approvedAt: Date.now(),
            approvedBy: userId,
            updatedAt: Date.now(),
        });
    },
});

export const rejectInsight = mutation({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
        rejectReason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        await ctx.db.patch(args.insightId, {
            moderationStatus: "rejected",
            rejectReason: args.rejectReason,
            rejectedAt: Date.now(),
            rejectedBy: userId,
            updatedAt: Date.now(),
        });
    },
});

export const updateInsight = mutation({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
        content: v.optional(v.string()),
        destination: v.optional(v.string()),
        category: v.optional(v.union(
            v.literal("food"),
            v.literal("transport"),
            v.literal("neighborhoods"),
            v.literal("timing"),
            v.literal("hidden_gem"),
            v.literal("avoid"),
            v.literal("other")
        )),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const updates: any = { updatedAt: Date.now() };
        if (args.content !== undefined) updates.content = args.content;
        if (args.destination !== undefined) updates.destination = args.destination;
        if (args.category !== undefined) updates.category = args.category;
        
        await ctx.db.patch(args.insightId, updates);
    },
});

export const toggleFeatureInsight = mutation({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const insight = await ctx.db.get(args.insightId);
        if (!insight) throw new Error("Insight not found");
        
        await ctx.db.patch(args.insightId, {
            featured: !insight.featured,
            updatedAt: Date.now(),
        });
    },
});

export const deleteInsight = mutation({
    args: { 
        token: v.string(),
        insightId: v.id("insights"),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        await ctx.db.delete(args.insightId);
    },
});

// ===========================================
// USERS MANAGEMENT
// ===========================================

// The saved base airport is a free-text label ("Athens, Greece (ATH)"), so pull
// the IATA code out for the compact list row. Also resolves labels written in
// another language ("Αθήνα" → ATH). Null when nothing can be resolved.
function extractIata(homeAirport?: string | null): string | null {
    return resolveHomeIata(homeAirport) ?? null;
}

/**
 * One-off backfill: rewrite base airports saved in another language to their
 * canonical English label ("Αθήνα" → "Athens, Greece ATH").
 *
 * Every read path resolves these on the fly now, so this isn't required for
 * flights to work — it exists so the stored data, the admin user list and the
 * airport aggregation all agree, and so a user who opens their preferences
 * sees a value they can edit rather than one we're silently reinterpreting.
 *
 * Defaults to a dry run; pass `apply: true` to actually write. Rows we can't
 * resolve are reported and left untouched.
 */
export const normalizeHomeAirports = mutation({
    args: {
        token: v.string(),
        apply: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const allSettings = await ctx.db.query("userSettings").collect();
        const changed: Array<{ userId: string; from: string; to: string }> = [];
        const unresolved: Array<{ userId: string; value: string }> = [];

        for (const s of allSettings) {
            const raw = s.homeAirport?.trim();
            if (!raw) continue;

            const canonical = canonicalHomeAirport(raw);
            if (!canonical) {
                unresolved.push({ userId: s.userId, value: raw });
                continue;
            }
            if (canonical.label === raw) continue;

            changed.push({ userId: s.userId, from: raw, to: canonical.label });
            if (args.apply) {
                await ctx.db.patch(s._id, { homeAirport: canonical.label });
            }
        }

        return {
            applied: args.apply === true,
            scanned: allSettings.length,
            changed,
            unresolved,
        };
    },
});

// Newsletter membership is keyed off the account email (see newsletter.myStatus),
// not userId — web signups predate any account. `.first()` rather than `.unique()`
// so a stale duplicate row can't break the whole admin page.
async function getNewsletterSub(ctx: any, email?: string | null) {
    if (!email) return null;
    return await ctx.db
        .query("newsletterSubscribers")
        .withIndex("by_email", (q: any) => q.eq("email", email.trim().toLowerCase()))
        .first();
}

/**
 * Flat (cursorless) user list kept for the mobile admin screen, which expects a
 * plain array back. The website uses `listUsersPage` instead — same rows, plus
 * a cursor, server-side filters and a much higher ceiling.
 *
 * Shares the scan below, so it no longer collects trips/insights per user: the
 * counts come from the cron-maintained `userActivityStats` rows. That is what
 * keeps a large `limit` under the per-transaction read limit.
 */
export const listUsers = query({
    args: {
        token: v.string(),
        search: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const res = await scanUsers(ctx, {
            search: args.search,
            limit: args.limit ?? 50,
        });
        return res.users;
    },
});

// ===========================================================================
// USERS LIST — cursor-paginated, server-side search + filter.
//
// Replaces the "take(limit) and enrich everything" shape `listUsers` still has
// for the mobile admin screen. Two things made that one fall over:
//
//   1. `take(limit)` has no cursor, so the list could only ever show the newest
//      N accounts. There was no way to reach user N+1.
//   2. It `.collect()`ed every trip for every row. `trips` documents average
//      ~57 KB (they carry the whole generated itinerary), so ~280 of them
//      exhaust the 16 MB per-transaction read limit — which is why picking
//      "500 users" threw instead of loading.
//
// So this query reads nothing fat. Identity, plan, newsletter and session state
// are all small indexed point lookups, and the trips/insights/likes counts come
// from `userActivityStats`, a ~200-byte row per user maintained hourly by the
// admin-KPI cron (see adminKpis.ts). A 500-row page costs a few MB instead of
// hundreds.
// ===========================================================================

/** Hard ceiling on one page, regardless of what the client asks for. */
const USER_PAGE_MAX = 500;
/** Rows of `userSettings` one call will walk looking for filter/search hits. */
const USER_SCAN_MAX = 4000;
/** Rows pulled per underlying index read while scanning. */
const USER_SCAN_CHUNK = 200;
/**
 * How many rows one call will run the joins on. This is the real read budget:
 * `buildUserRow` costs ~15 documents, so a rare filter (say "admins" on a big
 * table) would otherwise enrich every row it walks and blow past the 16384
 * document per-transaction limit long before the scan cap saved it. Stopping
 * here instead returns a short page with a cursor, and the caller pages on.
 */
const USER_ENRICH_MAX = 600;
/** Newest sessions sampled per user for "last sign-in" + active-session count. */
const SESSION_SAMPLE = 10;
/** Push-token rows sampled per user to infer the device platform. */
const DEVICE_SAMPLE = 10;
/**
 * Caps for the single-user detail read (`getUser`). Trips are the fat ones:
 * 150 x ~57 KB stays comfortably under the 16 MB per-transaction read limit,
 * which an unbounded `.collect()` on a prolific account would blow.
 */
const USER_DETAIL_TRIP_CAP = 150;
const USER_DETAIL_INSIGHT_CAP = 300;
const USER_DETAIL_SESSION_CAP = 200;

const ZERO_ACTIVITY = {
    tripsCount: 0,
    upcomingTripsCount: 0,
    pastTripsCount: 0,
    completedTripsCount: 0,
    lastTripAt: null as number | null,
    insightsCount: 0,
    approvedInsightsCount: 0,
    totalLikes: 0,
};

/**
 * Everything one row of the admin user list needs, using only small documents.
 * Deliberately does NOT touch `trips` or `insights` — see the header comment.
 */
async function buildUserRow(ctx: any, settings: any, now: number, adminIds: string[]) {
    const email = settings.email ? settings.email.trim().toLowerCase() : null;

    // Admin rights come from two places (see checkIsAdmin): the `users.isAdmin`
    // flag, and the ADMIN_EMAILS env var matched on either userId or email.
    // The list used to read only the flag, so env-granted admins — which is how
    // the founder account itself is an admin — showed as ordinary users and the
    // Admins filter came back empty.
    const isEnvAdmin =
        adminIds.includes(settings.userId.toLowerCase()) ||
        (!!email && adminIds.includes(email));

    const user = email
        ? await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", email))
            .first()
        : null;

    const userPlan = await ctx.db
        .query("userPlans")
        .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
        .first();

    const newsletter = await getNewsletterSub(ctx, settings.email);

    // by_user is (userId, _creationTime), so ordering desc gives the newest
    // sessions first — sampling the top few is enough for "last sign-in" and
    // avoids collecting a long-lived account's whole session history.
    const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
        .order("desc")
        .take(SESSION_SAMPLE);

    // Push tokens double as the device record. Users who signed up before
    // `settings.platform` existed only have this to go on.
    const pushTokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
        .take(DEVICE_SAMPLE);
    const devicePlatforms = Array.from(
        new Set(pushTokens.map((t: any) => t.platform).filter(Boolean))
    );

    const stats = await ctx.db
        .query("userActivityStats")
        .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
        .first();
    const activity = stats
        ? {
            tripsCount: stats.tripsCount,
            upcomingTripsCount: stats.upcomingTripsCount,
            pastTripsCount: stats.pastTripsCount,
            completedTripsCount: stats.completedTripsCount,
            lastTripAt: stats.lastTripAt ?? null,
            insightsCount: stats.insightsCount,
            approvedInsightsCount: stats.approvedInsightsCount,
            totalLikes: stats.totalLikes,
        }
        : ZERO_ACTIVITY;

    return {
        _id: user?._id,
        settingsId: settings._id,
        userId: settings.userId,
        name: settings.name || "Unknown",
        email: settings.email || "Unknown",
        phone: settings.phone || null,
        dateOfBirth: settings.dateOfBirth || null,
        hasProfilePicture: !!settings.profilePicture,
        authProvider: settings.authProvider || "unknown",
        platform: settings.platform || devicePlatforms[0] || null,
        devicePlatforms,
        devicesCount: pushTokens.length,
        language: settings.language || null,
        currency: settings.currency || null,
        onboardingCompleted: settings.onboardingCompleted ?? null,
        isAdmin: user?.isAdmin === true || isEnvAdmin,
        // Env-granted admin rights can't be revoked from this UI — only
        // ADMIN_EMAILS can — so the row says which kind it is.
        isEnvAdmin,
        isBanned: user?.isBanned || false,
        isShadowBanned: user?.isShadowBanned || false,
        ...activity,
        // When the counters above were last recomputed — null means this user
        // has no activity row at all (no trips, no insights).
        activityAsOf: stats?.generation ?? null,
        plan: userPlan?.plan || "free",
        subscriptionType: userPlan?.subscriptionType || null,
        subscriptionExpiresAt: userPlan?.subscriptionExpiresAt || null,
        tripCredits: userPlan?.tripCredits ?? 0,
        tripsGenerated: userPlan?.tripsGenerated ?? 0,
        homeAirport: settings.homeAirport || null,
        homeIata: extractIata(settings.homeAirport),
        defaultTravelers: settings.defaultTravelers ?? null,
        defaultInterests: settings.defaultInterests || [],
        travelStyle: settings.travelStyle || null,
        budgetRange: settings.budgetRange || null,
        pushNotifications: settings.pushNotifications ?? null,
        emailNotifications: settings.emailNotifications ?? null,
        dealAlerts: settings.dealAlerts ?? null,
        tripReminders: settings.tripReminders ?? null,
        aiDataConsent: settings.aiDataConsent ?? null,
        referralCode: settings.referralCode || null,
        activeSessionsCount: sessions.filter((s: any) => s.expiresAt > now).length,
        // Capped by SESSION_SAMPLE, so the UI can say "10+" rather than imply
        // the sample is the true total.
        activeSessionsCapped: sessions.length >= SESSION_SAMPLE,
        lastActiveAt: sessions[0]?._creationTime ?? null,
        newsletterStatus: newsletter?.status || "none",
        createdAt: settings._creationTime,
    };
}

/**
 * Search runs against the raw settings row, BEFORE the joins in buildUserRow,
 * so a non-matching account costs exactly one document. That is what lets a
 * single call sweep thousands of rows looking for one email.
 */
function userMatchesSearch(settings: any, needle: string): boolean {
    if (!needle) return true;
    return (
        (settings.name || "").toLowerCase().includes(needle) ||
        (settings.email || "").toLowerCase().includes(needle) ||
        (settings.phone || "").toLowerCase().includes(needle) ||
        (settings.userId || "").toLowerCase().includes(needle) ||
        (settings.referralCode || "").toLowerCase().includes(needle)
    );
}

/**
 * Filter checks that can be answered from the raw settings row alone, before
 * paying for the joins. Returning false here skips a row for one document
 * instead of fifteen; returning true only means "cannot rule it out yet".
 */
function settingsCouldMatchFilter(settings: any, filter: string): boolean {
    switch (filter) {
        case "incomplete":
            return settings.onboardingCompleted === false;
        case "ios":
        case "android":
        case "web":
            // An unset platform still has to be enriched — it gets backfilled
            // from the user's push tokens in buildUserRow.
            return !settings.platform || settings.platform === filter;
        default:
            return true;
    }
}

function userMatchesFilter(row: any, filter: string): boolean {
    switch (filter) {
        case "premium": return row.plan === "premium";
        case "free": return row.plan !== "premium";
        case "admins": return row.isAdmin === true;
        case "banned": return row.isBanned === true || row.isShadowBanned === true;
        // newsletterSubscribers.status uses "active" for a confirmed opt-in;
        // there is no "subscribed" literal in the schema.
        case "newsletter": return row.newsletterStatus === "active";
        case "ios":
        case "android":
        case "web": return row.platform === filter;
        case "incomplete": return row.onboardingCompleted === false;
        case "inactive": return row.tripsCount === 0;
        case "all":
        default: return true;
    }
}

/**
 * The scan itself, shared by `listUsersPage` and the legacy `listUsers`.
 * Callers are responsible for the admin check before getting here.
 */
async function scanUsers(
    ctx: any,
    args: { search?: string; filter?: string; limit?: number; cursor?: string | null },
) {
    const wanted = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), USER_PAGE_MAX);
    const needle = (args.search || "").trim().toLowerCase();
    const filter = args.filter || "all";
    const now = Date.now();

    let before: number | null = args.cursor != null ? Number(args.cursor) : null;
    if (before !== null && !Number.isFinite(before)) before = null;

    // Read once per call, not per row — it only parses an env var.
    const adminIds = getAdminIdentifiers();

    const rows: any[] = [];
    let scanned = 0;
    let enriched = 0;
    let reachedEnd = false;
    let stopped = false;

    while (!stopped && rows.length < wanted && scanned < USER_SCAN_MAX) {
        const cursorAt = before;
        const base = ctx.db.query("userSettings");
        // `by_creation_time` is the built-in index; with no range it walks the
        // whole table, and `lt` resumes just past the previous call's last row.
        const scan = cursorAt === null
            ? base.withIndex("by_creation_time")
            : base.withIndex("by_creation_time", (ix: any) => ix.lt("_creationTime", cursorAt));
        const chunk = await scan.order("desc").take(USER_SCAN_CHUNK);

        if (chunk.length === 0) { reachedEnd = true; break; }

        for (const settings of chunk) {
            // Both of these run on the settings row alone — a miss costs one
            // document, which is what lets a single call sweep thousands.
            const candidate =
                userMatchesSearch(settings, needle) &&
                settingsCouldMatchFilter(settings, filter);

            // Out of read budget: stop BEFORE consuming this row, so the cursor
            // still points at it and the next call picks it up.
            if (candidate && enriched >= USER_ENRICH_MAX) { stopped = true; break; }

            scanned++;
            // Advance the cursor per row, not per chunk, so breaking out
            // mid-chunk can never skip rows we did not reach.
            before = settings._creationTime;
            if (!candidate) continue;

            enriched++;
            const row = await buildUserRow(ctx, settings, now, adminIds);
            if (!userMatchesFilter(row, filter)) continue;

            rows.push(row);
            if (rows.length >= wanted) { stopped = true; break; }
        }

        if (!stopped && chunk.length < USER_SCAN_CHUNK) { reachedEnd = true; break; }
    }

    return {
        users: rows,
        // null once there is nothing left to walk.
        cursor: reachedEnd || before === null ? null : String(before),
        isDone: reachedEnd,
        scanned,
        // True when a budget ran out before `wanted` matches were found: there
        // may well be more hits further back, so keep paging.
        scanCapped: !reachedEnd && rows.length < wanted,
    };
}

export const listUsersPage = query({
    args: {
        token: v.string(),
        search: v.optional(v.string()),
        filter: v.optional(v.string()),
        limit: v.optional(v.number()),
        // `_creationTime` of the last row the previous call walked past. Opaque
        // to the client; pass `cursor` straight back to continue.
        cursor: v.optional(v.union(v.string(), v.null())),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        return await scanUsers(ctx, args);
    },
});

export const getUser = query({
    args: { 
        token: v.string(),
        targetUserId: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        if (!settings) throw new Error("User not found");
        
        const userEmail = settings.email;
        
        // Get user record
        const user = userEmail 
            ? await ctx.db
                .query("users")
                .withIndex("by_email", (q: any) => q.eq("email", userEmail.toLowerCase()))
                .first()
            : null;
        
        // Trips are the one fat read here (~57 KB a row, they carry the whole
        // itinerary), so the newest USER_DETAIL_TRIP_CAP are enough — a
        // prolific account would otherwise exhaust the 16 MB per-transaction
        // read limit on its own and the whole detail panel would just error.
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .order("desc")
            .take(USER_DETAIL_TRIP_CAP);
        const tripsCapped = trips.length >= USER_DETAIL_TRIP_CAP;

        const insights = await ctx.db
            .query("insights")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .order("desc")
            .take(USER_DETAIL_INSIGHT_CAP);
        const insightsCapped = insights.length >= USER_DETAIL_INSIGHT_CAP;
        
        // Get userPlan
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        // Get last active session. Bounded: a long-lived account accumulates a
        // session row per sign-in and none of them are needed beyond the count.
        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .order("desc")
            .take(USER_DETAIL_SESSION_CAP);
        const activeSessions = sessions.filter((s: any) => s.expiresAt > Date.now());
        const lastSession = sessions.sort((a: any, b: any) => (b._creationTime || 0) - (a._creationTime || 0))[0];

        // Newsletter opt-in state
        const newsletter = await getNewsletterSub(ctx, userEmail);

        // Same two-source admin check the list does — see buildUserRow.
        const adminIdsDetail = getAdminIdentifiers();
        const isEnvAdminDetail =
            adminIdsDetail.includes(args.targetUserId.toLowerCase()) ||
            (!!userEmail && adminIdsDetail.includes(userEmail.toLowerCase()));

        // Registered devices (push tokens double as the device record)
        const pushTokens = await ctx.db
            .query("pushTokens")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .collect();
        const devicePlatforms = Array.from(
            new Set(pushTokens.map((t: any) => t.platform).filter(Boolean))
        );

        // Get trip destinations
        const tripDestinations = trips.map((t: any) => ({
            _id: t._id,
            destination: t.destination,
            startDate: t.startDate,
            endDate: t.endDate,
            status: t.status,
            createdAt: t._creationTime,
        }));
        
        // Past vs upcoming trips
        const now = Date.now();
        const pastTripsCount = trips.filter((t: any) => t.endDate < now).length;
        const upcomingTripsCount = trips.length - pastTripsCount;
        
        return {
            _id: user?._id,
            settingsId: settings._id,
            userId: args.targetUserId,
            name: settings.name || "Unknown",
            email: settings.email || "Unknown",
            phone: settings.phone || null,
            dateOfBirth: settings.dateOfBirth || null,
            hasProfilePicture: !!settings.profilePicture,
            authProvider: settings.authProvider || "unknown",
            platform: settings.platform || devicePlatforms[0] || null,
            devicePlatforms,
            devices: pushTokens.map((t: any) => ({
                platform: t.platform,
                deviceName: t.deviceName || null,
                createdAt: t.createdAt || t._creationTime,
                updatedAt: t.updatedAt || null,
            })),
            language: settings.language || null,
            currency: settings.currency || null,
            darkMode: settings.darkMode ?? null,
            onboardingCompleted: settings.onboardingCompleted ?? null,
            isAdmin: user?.isAdmin === true || isEnvAdminDetail,
            isEnvAdmin: isEnvAdminDetail,
            isBanned: user?.isBanned || false,
            isShadowBanned: user?.isShadowBanned || false,
            tripsCount: trips.length,
            tripsCapped,
            insightsCapped,
            pastTripsCount,
            upcomingTripsCount,
            completedTripsCount: trips.filter((t: any) => t.status === "completed").length,
            tripDestinations,
            insights: insights.map((i: any) => ({
                _id: i._id,
                destination: i.destination,
                content: i.content?.substring(0, 100),
                moderationStatus: i.moderationStatus,
                likes: i.likes,
                createdAt: i.createdAt,
            })),
            insightsCount: insights.length,
            approvedInsightsCount: insights.filter((i: any) => i.moderationStatus === "approved").length,
            rejectedInsightsCount: insights.filter((i: any) => i.moderationStatus === "rejected").length,
            approvalRate: insights.length > 0 
                ? Math.round((insights.filter((i: any) => i.moderationStatus === "approved").length / insights.length) * 100) 
                : 0,
            totalLikes: insights.reduce((sum: number, i: any) => sum + (i.likes || 0), 0),
            plan: userPlan?.plan || "free",
            subscriptionType: userPlan?.subscriptionType || null,
            subscriptionExpiresAt: userPlan?.subscriptionExpiresAt || null,
            tripCredits: userPlan?.tripCredits || 0,
            tripsGenerated: userPlan?.tripsGenerated || 0,
            activeSessionsCount: activeSessions.length,
            lastActiveAt: lastSession?._creationTime || null,
            homeAirport: settings.homeAirport || null,
            homeIata: extractIata(settings.homeAirport),
            defaultTravelers: settings.defaultTravelers ?? null,
            defaultInterests: settings.defaultInterests || [],
            defaultSkipFlights: settings.defaultSkipFlights ?? null,
            defaultSkipHotel: settings.defaultSkipHotel ?? null,
            defaultPreferredFlightTime: settings.defaultPreferredFlightTime || null,
            preferredAirlines: settings.preferredAirlines || [],
            seatPreference: settings.seatPreference || null,
            mealPreference: settings.mealPreference || null,
            hotelStarRating: settings.hotelStarRating ?? null,
            budgetRange: settings.budgetRange || null,
            travelStyle: settings.travelStyle || null,
            pushNotifications: settings.pushNotifications ?? null,
            emailNotifications: settings.emailNotifications ?? null,
            dealAlerts: settings.dealAlerts ?? null,
            tripReminders: settings.tripReminders ?? null,
            aiDataConsent: settings.aiDataConsent ?? null,
            aiDataConsentDate: settings.aiDataConsentDate || null,
            referralCode: settings.referralCode || null,
            newsletterStatus: newsletter?.status || "none",
            newsletterSource: newsletter?.source || null,
            newsletterCountry: newsletter?.country || null,
            newsletterSubscribedAt: newsletter?.confirmedAt || newsletter?.createdAt || null,
            newsletterUnsubscribedAt: newsletter?.unsubscribedAt || null,
            newsletterLastEmailAt: newsletter?.lastEmailSentAt || null,
            createdAt: settings._creationTime,
        };
    },
});

export const banUser = mutation({
    args: { 
        token: v.string(),
        targetUserId: v.string(),
        ban: v.boolean(),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        // Get user settings to find email
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        if (!settings?.email) throw new Error("User not found");
        
        const userEmail = settings.email;
        
        // Get or create user record
        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", userEmail.toLowerCase()))
            .first();
        
        if (user) {
            await ctx.db.patch(user._id, { isBanned: args.ban });
        } else {
            await ctx.db.insert("users", {
                email: userEmail.toLowerCase(),
                name: settings.name,
                isBanned: args.ban,
            });
        }
    },
});

export const shadowBanUser = mutation({
    args: { 
        token: v.string(),
        targetUserId: v.string(),
        shadowBan: v.boolean(),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        if (!settings?.email) throw new Error("User not found");
        
        const userEmail = settings.email;
        
        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", userEmail.toLowerCase()))
            .first();
        
        if (user) {
            await ctx.db.patch(user._id, { isShadowBanned: args.shadowBan });
        } else {
            await ctx.db.insert("users", {
                email: userEmail.toLowerCase(),
                name: settings.name,
                isShadowBanned: args.shadowBan,
            });
        }
    },
});

export const setUserAdmin = mutation({
    args: { 
        token: v.string(),
        targetUserId: v.string(),
        isAdmin: v.boolean(),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);
        
        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        if (!settings?.email) throw new Error("User not found");
        
        const userEmail = settings.email;
        
        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q: any) => q.eq("email", userEmail.toLowerCase()))
            .first();
        
        if (user) {
            await ctx.db.patch(user._id, { isAdmin: args.isAdmin });
        } else {
            await ctx.db.insert("users", {
                email: userEmail.toLowerCase(),
                name: settings.name,
                isAdmin: args.isAdmin,
            });
        }
    },
});

// ===========================================
// USER DETAILS MANAGEMENT
// ===========================================

export const updateUserDetails = mutation({
    args: {
        token: v.string(),
        targetUserId: v.string(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const settings = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();

        if (!settings) throw new Error("User not found");

        const updates: any = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.email !== undefined) updates.email = args.email;

        if (Object.keys(updates).length > 0) {
            await ctx.db.patch(settings._id, updates);
        }

        // Also update users table if it exists
        if (args.email !== undefined || args.name !== undefined) {
            const oldEmail = settings.email;
            if (oldEmail) {
                const user = await ctx.db
                    .query("users")
                    .withIndex("by_email", (q: any) => q.eq("email", oldEmail.toLowerCase()))
                    .first();
                if (user) {
                    const userUpdates: any = {};
                    if (args.name !== undefined) userUpdates.name = args.name;
                    if (args.email !== undefined) userUpdates.email = args.email.toLowerCase();
                    await ctx.db.patch(user._id, userUpdates);
                }
            }
        }
    },
});

export const updateUserPlan = mutation({
    args: {
        token: v.string(),
        targetUserId: v.string(),
        plan: v.union(v.literal("free"), v.literal("premium")),
        subscriptionType: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
        subscriptionExpiresAt: v.optional(v.float64()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();

        const planData: any = {
            plan: args.plan,
        };
        if (args.subscriptionType !== undefined) planData.subscriptionType = args.subscriptionType;
        if (args.subscriptionExpiresAt !== undefined) planData.subscriptionExpiresAt = args.subscriptionExpiresAt;

        if (userPlan) {
            await ctx.db.patch(userPlan._id, planData);
        } else {
            await ctx.db.insert("userPlans", {
                userId: args.targetUserId,
                plan: args.plan,
                tripsGenerated: 0,
                tripCredits: args.plan === "premium" ? 999 : 3,
                ...planData,
            });
        }
    },
});

export const adjustTripCredits = mutation({
    args: {
        token: v.string(),
        targetUserId: v.string(),
        credits: v.float64(),
        resetGenerated: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();

        if (userPlan) {
            const updates: any = { tripCredits: args.credits };
            if (args.resetGenerated) updates.tripsGenerated = 0;
            await ctx.db.patch(userPlan._id, updates);
        } else {
            await ctx.db.insert("userPlans", {
                userId: args.targetUserId,
                plan: "free",
                tripsGenerated: 0,
                tripCredits: args.credits,
            });
        }
    },
});

export const deleteUserSessions = mutation({
    args: {
        token: v.string(),
        targetUserId: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .collect();

        for (const session of sessions) {
            await ctx.db.delete(session._id);
        }

        return { deleted: sessions.length };
    },
});

// ===========================================
// PUBLISHED ITINERARY REVIEW (SEO /explore drafts)
// ===========================================

/** List draft itineraries awaiting admin approval (web admin review page). */
export const listItineraryDrafts = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const drafts = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_status", (q: any) => q.eq("status", "draft"))
            .collect();

        // Return a trimmed, serializable shape for the review UI.
        return drafts
            .map((d: any) => ({
                _id: d._id,
                slug: d.slug,
                destination: d.destination,
                country: d.country,
                continent: d.continent,
                durationDays: d.durationDays,
                title: d.title,
                metaDescription: d.metaDescription,
                intro: d.intro,
                budgetLevel: d.budgetLevel,
                budgetPerDayEur: d.budgetPerDayEur,
                bestSeason: d.bestSeason,
                bestFor: d.bestFor || [],
                sourceTripCount: d.sourceTripCount || 0,
                dayCount: Array.isArray(d.days) ? d.days.length : 0,
                faqCount: Array.isArray(d.faqs) ? d.faqs.length : 0,
                translationCount: d.translations ? Object.keys(d.translations).length : 0,
                lastAggregated: d.lastAggregated,
            }))
            .sort((a: any, b: any) => a.slug.localeCompare(b.slug));
    },
});

/** Approve a draft itinerary → make it live on the website. */
export const approvePublishedItinerary = mutation({
    args: { token: v.string(), slug: v.string() },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
            .unique();
        if (!row) throw new Error("Itinerary not found");

        await ctx.db.patch(row._id, { status: "published" });
        return { ok: true };
    },
});

/**
 * Reject a draft itinerary. Marks it "rejected" (sticky) rather than deleting,
 * so the daily aggregation cron won't just regenerate it on the next run.
 */
export const rejectPublishedItinerary = mutation({
    args: { token: v.string(), slug: v.string() },
    handler: async (ctx, args) => {
        const userId = await getUserIdFromToken(ctx, args.token);
        if (!userId) throw new Error("Unauthorized");
        await assertAdmin(ctx, userId);

        const row = await ctx.db
            .query("publishedItineraries")
            .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
            .unique();
        if (!row) throw new Error("Itinerary not found");
        // Only drafts are rejectable from here — never hide a live page by mistake.
        if (row.status !== "draft") throw new Error("Only drafts can be rejected");

        await ctx.db.patch(row._id, { status: "rejected" });
        return { ok: true };
    },
});
