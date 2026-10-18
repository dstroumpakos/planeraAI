import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { assertAdmin } from "./admin";

// Default-runtime half of externalAnalytics.ts (that file is "use node", which
// can't hold queries or mutations). Same `any` cast as adminKpis.ts.
const internal = _internal as any;

// A manual refresh is ignored when the last attempt is younger than this, so a
// double click can't burn the GA4 / Meta API quota.
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;

const PATCHABLE = new Set([
  "ga4",
  "ga4FetchedAt",
  "ga4Error",
  "meta",
  "metaFetchedAt",
  "metaError",
  "attemptedAt",
]);

async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

async function requireAdmin(ctx: any, token: string) {
  const userId = await getUserIdFromToken(ctx, token);
  if (!userId) throw new Error("Unauthorized");
  await assertAdmin(ctx, userId);
}

export const _write = internalMutation({
  args: { patch: v.any(), clear: v.array(v.string()) },
  handler: async (ctx, { patch, clear }) => {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch ?? {})) {
      if (PATCHABLE.has(k)) fields[k] = val;
    }
    // db.patch removes a field that is set to undefined.
    for (const k of clear) if (PATCHABLE.has(k)) fields[k] = undefined;

    const existing = await ctx.db.query("externalAnalytics").first();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("externalAnalytics", fields as any);
  },
});

export const getExternalAnalytics = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireAdmin(ctx, token);
    const doc = await ctx.db.query("externalAnalytics").first();
    return {
      ...(doc ?? {}),
      ga4Configured: !!(process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_JSON),
      metaConfigured: !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
    };
  },
});

export const refreshNow = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireAdmin(ctx, token);
    const doc = await ctx.db.query("externalAnalytics").first();
    if (doc?.attemptedAt && Date.now() - doc.attemptedAt < MANUAL_REFRESH_COOLDOWN_MS) {
      return { scheduled: false };
    }
    await ctx.scheduler.runAfter(0, internal.externalAnalytics.refreshExternalAnalytics, {});
    return { scheduled: true };
  },
});
