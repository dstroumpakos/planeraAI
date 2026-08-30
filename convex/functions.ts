import { action, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  customQuery,
  customMutation,
  customAction,
} from "convex-helpers/server/customFunctions";
import { api, internal } from "./_generated/api";

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
export const authQuery = (config: any) => {
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
      // Return null gracefully if session is invalid (e.g. after logout/account deletion)
      let user: any;
      try {
        user = await validateTokenDirect(ctx, token);
      } catch (e) {
        console.log("[authQuery] Token validation failed, returning null");
        return null;
      }
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
export const authMutation = (config: any) => {
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
// For actions you can pass `token` OR rely on the Authorization header.
//
// NOTE ON THE SHAPE OF THIS — it is not interchangeable with authQuery/
// authMutation above, and two earlier attempts to write it the obvious way
// were silently broken:
//
//  • It must use the `{ args, input }` customization form, NOT `customCtx`.
//    `customCtx`'s callback is called as `(ctx, extra)` — the second argument
//    is convex-helpers' internal `extra` object, never the caller's args — so
//    reading `args.token` there always yielded undefined and every call threw
//    "Authentication required". Only fields declared in `args` below are
//    handed to `input` (see `customFnBuilder`: it calls
//    `customInput(ctx, pick(allArgs, Object.keys(inputArgs)), extra)`).
//
//  • It must validate via `ctx.runQuery`, NOT `ctx.db`. Actions have no
//    database handle, so the `validateTokenDirect` helper used by the query
//    and mutation wrappers throws inside an action.
//
// `token` is declared OPTIONAL on purpose. convex-helpers merges these fields
// into each function's own args with `intersectValidators`, which prefers the
// REQUIRED side on a mismatch — so optional here preserves every existing
// signature exactly (homeAirportAi.resolveBaseAirport keeps its optional
// token; the trips.ts actions keep theirs required). Declaring it required
// here would silently make it mandatory for all of them.
//
// Convex strips these declared fields from the args the handler receives, so a
// handler must not expect `args.token`; read the identity off `ctx.user`.
export const authAction = customAction(action, {
  args: { token: v.optional(v.string()) },
  input: async (ctx: any, args: any) => {
    const token =
      (typeof args?.token === "string" && args.token) ||
      getBearerTokenFromHeaders(ctx);
    if (!token) throw new ConvexError("Authentication required");

    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token }
    );
    if (!session) throw new ConvexError("Invalid session token");
    if (session.expiresAt && session.expiresAt < Date.now()) {
      throw new ConvexError("Session expired");
    }

    const user: any = await ctx.runQuery(
      internal.authNativeDb.getUserSettings,
      { userId: session.userId }
    );
    if (!user) throw new ConvexError("User not found");

    return { ctx: { user }, args: {} };
  },
});
