import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Result type for upsertUserAndCreateSession
interface UpsertResult {
  userId: string;
  sessionId: string;
  token: string;
  isNewUser: boolean;
  user: {
    id: string;
    email?: string;
    name?: string;
    image?: string;
  };
}

// Internal mutation to upsert user and create session
// This runs in the V8 runtime (not Node.js) so it can access ctx.db
export const upsertUserAndCreateSession = internalMutation({
  args: {
    provider: v.string(),
    providerUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    picture: v.optional(v.string()),
    sessionToken: v.string(),
  },
  returns: v.object({
    userId: v.string(),
    sessionId: v.string(),
    token: v.string(),
    isNewUser: v.boolean(),
    user: v.object({
      id: v.string(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, args): Promise<UpsertResult> => {
    console.log("[AuthNativeDb] upsertUserAndCreateSession called:", {
      provider: args.provider,
      providerUserId: args.providerUserId,
      hasEmail: !!args.email,
      hasName: !!args.name,
      hasPicture: !!args.picture,
      sessionTokenLength: args.sessionToken?.length || 0,
    });
    
    // Create a unique user ID based on provider and provider user ID
    const uniqueUserId = `${args.provider}:${args.providerUserId}`;
    console.log("[AuthNativeDb] Generated uniqueUserId:", uniqueUserId);
    
    // Check if user already exists in userSettings (our app's user table)
    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", uniqueUserId))
      .unique();
    
    const isNewUser = !existingSettings;
    console.log("[AuthNativeDb] Existing user settings:", existingSettings ? "found" : "not found", "isNewUser:", isNewUser);
    
    if (!existingSettings) {
      // Create new user settings
      const newSettingsId = await ctx.db.insert("userSettings", {
        userId: uniqueUserId,
        email: args.email,
        name: args.name,
        profilePicture: undefined,
        onboardingCompleted: false,
        darkMode: false,
        pushNotifications: true,
        emailNotifications: true,
        language: "en",
        currency: "USD",
      });
      console.log("[AuthNativeDb] Created new user settings:", newSettingsId);
    } else if (args.email || args.name) {
      // Update existing user with any new info from provider (only if fields are empty)
      const updates: Record<string, string> = {};
      if (args.email && !existingSettings.email) {
        updates.email = args.email;
      }
      if (args.name && !existingSettings.name) {
        updates.name = args.name;
      }
      
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingSettings._id, updates);
        console.log("[AuthNativeDb] Updated user settings with:", Object.keys(updates));
      }
    }
    
    // Also check/create userPlans for subscription tracking
    const existingPlan = await ctx.db
      .query("userPlans")
      .withIndex("by_user", (q) => q.eq("userId", uniqueUserId))
      .unique();
    
    console.log("[AuthNativeDb] Existing user plan:", existingPlan ? "found" : "not found");
    
    if (!existingPlan) {
      const newPlanId = await ctx.db.insert("userPlans", {
        userId: uniqueUserId,
        plan: "free",
        tripsGenerated: 0,
        tripCredits: 1, // Free tier gets 1 trip
      });
      console.log("[AuthNativeDb] Created user plan:", newPlanId);
    }
    
    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log("[AuthNativeDb] Generated sessionId:", sessionId);
    
    // Save session to database
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    await ctx.db.insert("sessions", {
      userId: uniqueUserId,
      token: args.sessionToken,
      sessionId,
      createdAt: Date.now(),
      expiresAt,
    });
    console.log("[AuthNativeDb] Saved session to database with token");
    
    // Construct the result object
    const result: UpsertResult = {
      userId: uniqueUserId,
      sessionId,
      token: args.sessionToken,
      isNewUser,
      user: {
        id: uniqueUserId,
        email: args.email,
        name: args.name,
        image: args.picture,
      },
    };
    
    console.log("[AuthNativeDb] Returning result:", {
      userId: result.userId,
      sessionId: result.sessionId,
      tokenLength: result.token?.length || 0,
      hasUser: !!result.user,
      userHasId: !!result.user?.id,
    });
    
    return result;
  },
});

// Internal query to look up a session by its token
export const getSessionByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    return session;
  },
});

// Internal query to look up user settings by userId
export const getUserSettings = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return settings;
  },
});
