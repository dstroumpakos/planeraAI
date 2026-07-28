/**
 * Database layer for the Atlas assistant.
 *
 * Split out from `atlas.ts` because that file is an action module: actions have
 * no `ctx.db`, so every read/write Atlas needs has to hop through an internal
 * query/mutation defined here.
 *
 * Three concerns live here:
 *  - `checkRateLimit` — the spend guard on the OpenAI calls.
 *  - conversation persistence (`atlasConversations` / `atlasMessages`).
 *  - `readToolCache` / `writeToolCache` — short-TTL memo for tool results.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, query, mutation } from "./_generated/server";

// ─────────────────────────────── Rate limiting ──────────────────────────────

/**
 * Fixed-window limiter, one row per user, reset lazily on first call after the
 * window lapses. Same shape as `flightSearchCache.checkRateLimit` but on its
 * own table so the two budgets stay independent.
 *
 * Returns the remaining allowance so the caller can surface "you have N left"
 * rather than only failing at the boundary.
 */
export const checkRateLimit = internalMutation({
    args: {
        userId: v.string(),
        limit: v.float64(),
        windowMs: v.float64(),
    },
    returns: v.object({
        allowed: v.boolean(),
        remaining: v.float64(),
        resetAt: v.float64(),
    }),
    handler: async (ctx, { userId, limit, windowMs }) => {
        const now = Date.now();
        const row = await ctx.db
            .query("atlasRateLimits")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first();

        if (!row || now - row.windowStart >= windowMs) {
            if (row) {
                await ctx.db.patch(row._id, { windowStart: now, count: 1 });
            } else {
                await ctx.db.insert("atlasRateLimits", {
                    userId,
                    windowStart: now,
                    count: 1,
                });
            }
            return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
        }

        if (row.count >= limit) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: row.windowStart + windowMs,
            };
        }

        await ctx.db.patch(row._id, { count: row.count + 1 });
        return {
            allowed: true,
            remaining: limit - (row.count + 1),
            resetAt: row.windowStart + windowMs,
        };
    },
});

// ────────────────────────────── Tool result cache ───────────────────────────

export const readToolCache = internalQuery({
    args: { key: v.string() },
    returns: v.union(v.null(), v.any()),
    handler: async (ctx, { key }) => {
        const row = await ctx.db
            .query("atlasToolCache")
            .withIndex("by_key", (q) => q.eq("key", key))
            .first();
        if (!row) return null;
        if (row.expiresAt <= Date.now()) return null;
        return row.payload;
    },
});

export const writeToolCache = internalMutation({
    args: {
        key: v.string(),
        payload: v.any(),
        ttlMs: v.float64(),
    },
    returns: v.null(),
    handler: async (ctx, { key, payload, ttlMs }) => {
        const existing = await ctx.db
            .query("atlasToolCache")
            .withIndex("by_key", (q) => q.eq("key", key))
            .first();
        const expiresAt = Date.now() + ttlMs;
        if (existing) {
            await ctx.db.patch(existing._id, { payload, expiresAt });
        } else {
            await ctx.db.insert("atlasToolCache", { key, payload, expiresAt });
        }
        return null;
    },
});

/** Cron target: drop expired tool-cache rows so the table doesn't grow forever. */
export const purgeExpiredToolCache = internalMutation({
    args: {},
    returns: v.float64(),
    handler: async (ctx) => {
        const stale = await ctx.db
            .query("atlasToolCache")
            .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
            .take(500);
        for (const row of stale) {
            await ctx.db.delete(row._id);
        }
        return stale.length;
    },
});

// ───────────────────────────── Conversation store ───────────────────────────

/** Build a thread title from the opening question. */
function deriveTitle(firstMessage: string): string {
    const cleaned = firstMessage.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 60) return cleaned || "New chat";
    return cleaned.slice(0, 57) + "…";
}

/**
 * Append one user turn + one assistant turn, creating the conversation on the
 * first call. Written as a single mutation so a thread can never end up with a
 * user message and no reply (or vice versa) if the action dies midway.
 */
export const appendTurn = internalMutation({
    args: {
        userId: v.string(),
        conversationId: v.optional(v.id("atlasConversations")),
        userContent: v.string(),
        assistantContent: v.string(),
        cards: v.optional(v.any()),
        suggestions: v.optional(v.array(v.string())),
        toolsUsed: v.optional(v.array(v.string())),
    },
    returns: v.id("atlasConversations"),
    handler: async (ctx, args) => {
        const now = Date.now();

        let conversationId = args.conversationId ?? null;

        // Verify ownership of an existing thread — the id arrives from the
        // client, so it is not trusted.
        if (conversationId) {
            const existing = await ctx.db.get(conversationId);
            if (!existing || existing.userId !== args.userId) {
                conversationId = null;
            }
        }

        if (!conversationId) {
            conversationId = await ctx.db.insert("atlasConversations", {
                userId: args.userId,
                title: deriveTitle(args.userContent),
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
            });
        }

        await ctx.db.insert("atlasMessages", {
            conversationId,
            userId: args.userId,
            role: "user",
            content: args.userContent,
            createdAt: now,
        });

        await ctx.db.insert("atlasMessages", {
            conversationId,
            userId: args.userId,
            role: "assistant",
            content: args.assistantContent,
            cards: args.cards,
            suggestions: args.suggestions,
            toolsUsed: args.toolsUsed,
            // +1 so the assistant reply always sorts after its prompt even when
            // both land in the same millisecond.
            createdAt: now + 1,
        });

        const convo = await ctx.db.get(conversationId);
        await ctx.db.patch(conversationId, {
            updatedAt: now,
            messageCount: (convo?.messageCount ?? 0) + 2,
        });

        return conversationId;
    },
});

/** Threads for the history drawer, newest first. */
export const listConversations = query({
    args: { token: v.string(), limit: v.optional(v.float64()) },
    returns: v.array(
        v.object({
            _id: v.id("atlasConversations"),
            title: v.string(),
            updatedAt: v.float64(),
            messageCount: v.float64(),
        })
    ),
    handler: async (ctx, { token, limit }) => {
        const session = await ctx.db
            .query("sessions")
            .withIndex("by_token", (q) => q.eq("token", token))
            .first();
        if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
            return [];
        }

        const rows = await ctx.db
            .query("atlasConversations")
            .withIndex("by_user_updated", (q) => q.eq("userId", session.userId))
            .order("desc")
            .take(Math.min(limit ?? 30, 100));

        return rows.map((r) => ({
            _id: r._id,
            title: r.title,
            updatedAt: r.updatedAt,
            messageCount: r.messageCount,
        }));
    },
});

/** Full transcript of one thread, oldest first. */
export const getConversation = query({
    args: { token: v.string(), conversationId: v.id("atlasConversations") },
    returns: v.union(
        v.null(),
        v.object({
            _id: v.id("atlasConversations"),
            title: v.string(),
            messages: v.array(
                v.object({
                    _id: v.id("atlasMessages"),
                    role: v.union(v.literal("user"), v.literal("assistant")),
                    content: v.string(),
                    cards: v.optional(v.any()),
                    suggestions: v.optional(v.array(v.string())),
                    createdAt: v.float64(),
                })
            ),
        })
    ),
    handler: async (ctx, { token, conversationId }) => {
        const session = await ctx.db
            .query("sessions")
            .withIndex("by_token", (q) => q.eq("token", token))
            .first();
        if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
            return null;
        }

        const convo = await ctx.db.get(conversationId);
        if (!convo || convo.userId !== session.userId) return null;

        const messages = await ctx.db
            .query("atlasMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("asc")
            .take(200);

        return {
            _id: convo._id,
            title: convo.title,
            messages: messages.map((m) => ({
                _id: m._id,
                role: m.role,
                content: m.content,
                cards: m.cards,
                suggestions: m.suggestions,
                createdAt: m.createdAt,
            })),
        };
    },
});

/** Recent turns for an existing thread, used to rebuild model context. */
export const getRecentTurns = internalQuery({
    args: { conversationId: v.id("atlasConversations"), limit: v.float64() },
    returns: v.array(
        v.object({
            role: v.union(v.literal("user"), v.literal("assistant")),
            content: v.string(),
        })
    ),
    handler: async (ctx, { conversationId, limit }) => {
        const rows = await ctx.db
            .query("atlasMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .take(limit);
        return rows
            .reverse()
            .map((r) => ({ role: r.role, content: r.content }));
    },
});

export const deleteConversation = mutation({
    args: { token: v.string(), conversationId: v.id("atlasConversations") },
    returns: v.null(),
    handler: async (ctx, { token, conversationId }) => {
        const session = await ctx.db
            .query("sessions")
            .withIndex("by_token", (q) => q.eq("token", token))
            .first();
        if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
            throw new Error("Authentication required");
        }

        const convo = await ctx.db.get(conversationId);
        if (!convo || convo.userId !== session.userId) {
            throw new Error("Conversation not found");
        }

        const messages = await ctx.db
            .query("atlasMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .collect();
        for (const m of messages) {
            await ctx.db.delete(m._id);
        }
        await ctx.db.delete(conversationId);
        return null;
    },
});
