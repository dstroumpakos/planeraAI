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

async function validateToken(ctx: any, token: string): Promise<any> {
  const res: any = await ctx.runAction(api.authNative.validateSession, { token });
  if (!res?.success || !res?.user) throw new ConvexError("Authentication required");
  return res.user as any;
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
// Usage: authQuery({ args: { token: v.string(), ... }, handler: async (ctx, args) => { ctx.user ... } })
export const authQuery: any = customQuery(
  query,
  customCtx(async (ctx: any, args: any) => {
    const token = args?.token;
    if (!token || typeof token !== "string") throw new ConvexError("Authentication required");
    const user: any = await validateToken(ctx, token);
    return { user };
  })
);

// ---- AUTH MUTATION ----
// Usage: authMutation({ args: { token: v.string(), ... }, handler: async (ctx, args) => { ctx.user ... } })
export const authMutation: any = customMutation(
  mutation,
  customCtx(async (ctx: any, args: any) => {
    const token = args?.token;
    if (!token || typeof token !== "string") throw new ConvexError("Authentication required");
    const user: any = await validateToken(ctx, token);
    return { user };
  })
);

// ---- AUTH ACTION ----
// For actions you can pass token OR rely on Authorization header.
export const authAction: any = customAction(
  action,
  customCtx(async (ctx: any, args: any) => {
    const token = (typeof args?.token === "string" && args.token) || getBearerTokenFromHeaders(ctx);
    if (!token) throw new ConvexError("Authentication required");
    const user: any = await validateToken(ctx, token);
    return { user };
  })
);
