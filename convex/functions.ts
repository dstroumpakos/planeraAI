import { action, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  customQuery,
  customCtx,
  customMutation,
  customAction,
} from "convex-helpers/server/customFunctions";
import { api } from "./_generated/api";

/**
 * Native-auth based auth wrappers.
 *
 * These replace Better Auth's `authComponent.getAuthUser(ctx)` and instead:
 * - read a session token (recommended: pass `token` as an argument for queries/mutations)
 * - validate it via authNative.validateSession
 * - attach `user` into ctx for downstream usage
 *
 * NOTE:
 * - Convex queries/mutations do not reliably expose HTTP headers.
 *   So we require `token` argument for authQuery/authMutation.
 * - Actions can access request headers; we implement both patterns.
 */

// ---- Helpers ----

async function validateTokenDirect(ctx: any, token: string): Promise<any> {
  // Look up the session in the database using the index
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .unique();
  
  if (!session) {
    console.log("[validateTokenDirect] Session not found for token");
    throw new ConvexError("Invalid session token");
  }
  
  // Check if session is expired
  if (session.expiresAt && session.expiresAt < Date.now()) {
    console.log("[validateTokenDirect] Session expired");
    throw new ConvexError("Session expired");
  }
  
  // Get the user from userSettings using the string userId (not a Convex doc ID)
  const userSettings = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q: any) => q.eq("userId", session.userId))
    .unique();
  
  if (!userSettings) {
    console.log("[validateTokenDirect] User not found for userId:", session.userId);
    throw new ConvexError("User not found");
  }
  
  return userSettings;
}


function getBearerTokenFromHeaders(ctx: any): string | null {
  const h =
    ctx?.request?.headers?.get?.("authorization") ??
    ctx?.request?.headers?.get?.("Authorization");

  if (typeof h !== "string") return null;
  if (!h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length);
}

// ---- AUTH QUERY ----
// Simple wrapper that validates token before calling the actual query handler
export const authQuery: any = (config: any) => {
  // Merge token into args validator
  const argsWithToken = {
    ...config.args,
    token: v.string(),
  };
  
  return query({
    args: argsWithToken,
    handler: async (ctx: any, args: any) => {
      const token = args?.token;
      console.log("[authQuery] Called with token:", token ? "PRESENT" : "MISSING");
      
      // Skip if token is the skip marker
      if (token === "skip") {
        console.log("[authQuery] Query skipped (skip marker)");
        return null;
      }
      
      // Validate token exists
      if (!token || typeof token !== "string") {
        console.log("[authQuery] Authentication failed - no token");
        throw new ConvexError("Authentication required");
      }
      
      // Validate token directly from database
      const user: any = await validateTokenDirect(ctx, token);
      console.log("[authQuery] User authenticated:", user?.userId || user?._id);
      
      // Inject user into context for the handler
      ctx.user = user;
      
      // Call the original handler with user in context
      return await config.handler(ctx, args);
    }
  });
};

// ---- AUTH MUTATION ----
// Simple wrapper that validates token before calling the actual mutation handler
export const authMutation: any = (config: any) => {
  // Merge token into args validator
  const argsWithToken = {
    ...config.args,
    token: v.string(),
  };
  
  return mutation({
    args: argsWithToken,
    handler: async (ctx: any, args: any) => {
      const token = args?.token;
      console.log("[authMutation] Called with token:", token ? "PRESENT" : "MISSING");
      
      // Skip if token is the skip marker
      if (token === "skip") {
        console.log("[authMutation] Mutation skipped (skip marker)");
        return null;
      }
      
      // Validate token exists
      if (!token || typeof token !== "string") {
        console.log("[authMutation] Authentication failed - no token");
        throw new ConvexError("Authentication required");
      }
      
      // Validate token directly from database
      const user: any = await validateTokenDirect(ctx, token);
      console.log("[authMutation] User authenticated:", user?.userId || user?._id);
      
      // Inject user into context for the handler
      ctx.user = user;
      
      // Call the original handler with user in context
      return await config.handler(ctx, args);
    }
  });
};

// ---- AUTH ACTION ----
// For actions you can pass token OR rely on Authorization header.
export const authAction: any = customAction(
  action,
  customCtx(async (ctx: any, args: any) => {
    const token = (typeof args?.token === "string" && args.token) || getBearerTokenFromHeaders(ctx);
    if (!token) throw new ConvexError("Authentication required");
    const user: any = await validateTokenDirect(ctx, token);
    return { user };
  })
);
