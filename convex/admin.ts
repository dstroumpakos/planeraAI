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
        
        // Get all trips
        const allTrips = await ctx.db.query("trips").collect();
        
        // Get all user plans for premium count
        const allPlans = await ctx.db.query("userPlans").collect();
        const premiumUsersCount = allPlans.filter((p: any) => p.plan === "premium").length;
        
        // Get active sessions (not expired)
        const allSessions = await ctx.db.query("sessions").collect();
        const activeSessions = allSessions.filter((s: any) => s.expiresAt > Date.now());
        
        // Completed trips
        const completedTrips = allTrips.filter((t: any) => t.status === "completed");
        
        // Top destinations by insights
        const destinationCounts: Record<string, number> = {};
        allInsights.forEach((insight: any) => {
            if (insight.destination) {
                destinationCounts[insight.destination] = (destinationCounts[insight.destination] || 0) + 1;
            }
        });
        
        // Top destinations by trips
        const tripDestinationCounts: Record<string, number> = {};
        allTrips.forEach((trip: any) => {
            if (trip.destination) {
                tripDestinationCounts[trip.destination] = (tripDestinationCounts[trip.destination] || 0) + 1;
            }
        });
        
        const topTripDestinations = Object.entries(tripDestinationCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([destination, count]) => ({ destination, count }));
        
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
        
        // Most active users (by insights count)
        const userInsightCounts: Record<string, number> = {};
        allInsights.forEach((insight: any) => {
            userInsightCounts[insight.userId] = (userInsightCounts[insight.userId] || 0) + 1;
        });
        
        const topUserIds = Object.entries(userInsightCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
        
        const mostActiveUsers = await Promise.all(
            topUserIds.map(async ([uId, count]) => {
                const settings = await ctx.db
                    .query("userSettings")
                    .withIndex("by_user", (q: any) => q.eq("userId", uId))
                    .first();
                return {
                    userId: uId,
                    name: settings?.name || "Unknown",
                    email: settings?.email || "Unknown",
                    insightsCount: count,
                };
            })
        );
        
        return {
            pendingInsightsCount: pendingInsights.length,
            flaggedInsightsCount: flaggedInsights.length,
            totalInsightsCount: allInsights.length,
            approvedInsightsCount: allInsights.filter((i: any) => i.moderationStatus === "approved").length,
            totalUsersCount: allUserSettings.length,
            premiumUsersCount,
            activeSessionsCount: activeSessions.length,
            totalTripsCount: allTrips.length,
            completedTripsCount: completedTrips.length,
            topDestinations,
            topTripDestinations,
            mostLikedInsights,
            mostActiveUsers,
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
        
        // Get all userSettings
        const allSettings = await ctx.db.query("userSettings").take(args.limit || 50);
        
        // Filter by search if provided
        let filteredSettings = allSettings;
        if (args.search) {
            const searchLower = args.search.toLowerCase();
            filteredSettings = allSettings.filter((s: any) => 
                s.name?.toLowerCase().includes(searchLower) ||
                s.email?.toLowerCase().includes(searchLower)
            );
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
        
        return {
            _id: user?._id,
            settingsId: settings._id,
            userId: args.targetUserId,
            name: settings.name || "Unknown",
            email: settings.email || "Unknown",
            isAdmin: user?.isAdmin || false,
            isBanned: user?.isBanned || false,
            isShadowBanned: user?.isShadowBanned || false,
            tripsCount: trips.length,
            completedTripsCount: trips.filter((t: any) => t.status === "completed").length,
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
            subscriptionType: userPlan?.subscriptionType,
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
