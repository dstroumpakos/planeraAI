/**
 * Throttle helpers for the Convex error reporter. Lives in a non-node file
 * so it can run as a regular mutation/query alongside the rest of the
 * schema.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Tries to claim the right to send an email for this error key.
 * Returns `{ shouldSend: true, count }` if the key hasn't been emailed
 * within the throttle window. Otherwise just increments the counter and
 * returns `{ shouldSend: false }`.
 */
export const tryClaimErrorReport = internalMutation({
  args: {
    key: v.string(),
    source: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("errorReports")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!existing) {
      await ctx.db.insert("errorReports", {
        key: args.key,
        source: args.source,
        message: args.message.slice(0, 500),
        count: 1,
        firstSeenAt: now,
        lastSentAt: now,
      });
      return { shouldSend: true, count: 1 };
    }

    const sinceLast = now - existing.lastSentAt;
    if (sinceLast < THROTTLE_WINDOW_MS) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
      return { shouldSend: false, count: existing.count + 1 };
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      lastSentAt: now,
    });
    return { shouldSend: true, count: existing.count + 1 };
  },
});

export const recentErrorReports = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("errorReports").collect();
    return rows
      .sort((a, b) => b.lastSentAt - a.lastSentAt)
      .slice(0, 100);
  },
});
