import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

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
        
        // Get userSettings, newest first. Without an explicit order, `.take()`
        // returns the OLDEST rows, so new signups never appear once there are
        // more than `limit` users. When searching we scan a wider window so
        // recent-but-not-newest matches are still found.
        const settingsQuery = ctx.db.query("userSettings").order("desc");
        const allSettings = args.search
            ? await settingsQuery.take(1000)
            : await settingsQuery.take(args.limit || 50);

        // Filter by search if provided
        let filteredSettings = allSettings;
        if (args.search) {
            const searchLower = args.search.toLowerCase();
            filteredSettings = allSettings
                .filter((s: any) =>
                    s.name?.toLowerCase().includes(searchLower) ||
                    s.email?.toLowerCase().includes(searchLower)
                )
                .slice(0, args.limit || 50);
        }
        
        // Enrich with user flags and stats
        const enrichedUsers = await Promise.all(
            filteredSettings.map(async (settings: any) => {
                // Get user record for admin flags
                const user = settings.email 
                    ? await ctx.db
                        .query("users")
                        .withIndex("by_email", (q: any) => q.eq("email", settings.email.toLowerCase()))
                        .first()
                    : null;
                
                // Get trip count
                const trips = await ctx.db
                    .query("trips")
                    .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
                    .collect();
                
                // Get insights count
                const insights = await ctx.db
                    .query("insights")
                    .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
                    .collect();
                
                // Get user plan
                const userPlan = await ctx.db
                    .query("userPlans")
                    .withIndex("by_user", (q: any) => q.eq("userId", settings.userId))
                    .first();
                
                return {
                    _id: user?._id,
                    settingsId: settings._id,
                    userId: settings.userId,
                    name: settings.name || "Unknown",
                    email: settings.email || "Unknown",
                    isAdmin: user?.isAdmin || false,
                    isBanned: user?.isBanned || false,
                    isShadowBanned: user?.isShadowBanned || false,
                    tripsCount: trips.length,
                    insightsCount: insights.length,
                    approvedInsightsCount: insights.filter((i: any) => i.moderationStatus === "approved").length,
                    totalLikes: insights.reduce((sum: number, i: any) => sum + (i.likes || 0), 0),
                    plan: userPlan?.plan || "free",
                    createdAt: settings._creationTime,
                };
            })
        );
        
        return enrichedUsers;
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
        
        // Get trips
        const trips = await ctx.db
            .query("trips")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .collect();
        
        // Get insights
        const insights = await ctx.db
            .query("insights")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .collect();
        
        // Get userPlan
        const userPlan = await ctx.db
            .query("userPlans")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .first();
        
        // Get last active session
        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_user", (q: any) => q.eq("userId", args.targetUserId))
            .collect();
        const activeSessions = sessions.filter((s: any) => s.expiresAt > Date.now());
        const lastSession = sessions.sort((a: any, b: any) => (b._creationTime || 0) - (a._creationTime || 0))[0];
        
        // Get trip destinations
        const tripDestinations = trips.map((t: any) => ({
            destination: t.destination,
            startDate: t.startDate,
            endDate: t.endDate,
            status: t.status,
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
            authProvider: settings.authProvider || "unknown",
            isAdmin: user?.isAdmin || false,
            isBanned: user?.isBanned || false,
            isShadowBanned: user?.isShadowBanned || false,
            tripsCount: trips.length,
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
