/**
 * AI Writer — internal admin tool (website: /admin/ai-writer).
 *
 * Database side of the feature: the generation history and the auth checks
 * that the OpenAI actions in `aiWriterActions.ts` run through. Every public
 * function takes the session `token` and requires an admin (same
 * `assertAdmin` gate as the rest of the admin panel), and every row is
 * additionally scoped to the admin who created it, so one admin never sees
 * another's prompts.
 *
 * No function here talks to OpenAI and nothing here ever handles the API key.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { assertAdmin } from "./admin";
import { AI_WRITER_MODELS } from "./lib/aiWriterModels";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

/** Throws a client-visible ConvexError unless the token belongs to an admin. */
async function requireAdmin(ctx: any, token: string): Promise<string> {
  const userId = await getUserIdFromToken(ctx, token);
  if (!userId) throw new ConvexError("Your session has expired. Sign in again.");
  try {
    await assertAdmin(ctx, userId);
  } catch {
    throw new ConvexError("Unauthorized: this tool is admin-only.");
  }
  return userId;
}

/**
 * Auth check for the actions (which have no ctx.db). Returns the admin's
 * userId so the action can stamp the history row.
 */
export const resolveAdmin = internalQuery({
  args: { token: v.string() },
  returns: v.object({ userId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    return { userId };
  },
});

// ---------------------------------------------------------------------------
// Validators shared with the actions
// ---------------------------------------------------------------------------

export const usageValidator = v.object({
  inputTokens: v.float64(),
  outputTokens: v.float64(),
  totalTokens: v.float64(),
  reasoningTokens: v.optional(v.float64()),
  cachedInputTokens: v.optional(v.float64()),
});

export const citationValidator = v.object({
  url: v.string(),
  title: v.string(),
  startIndex: v.float64(),
  endIndex: v.float64(),
});

const statusValidator = v.union(
  v.literal("researching"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const kindValidator = v.union(v.literal("standard"), v.literal("deep_research"));

// ---------------------------------------------------------------------------
// Internal writes (called by aiWriterActions.ts)
// ---------------------------------------------------------------------------

export const _insertGeneration = internalMutation({
  args: {
    userId: v.string(),
    kind: kindValidator,
    model: v.string(),
    prompt: v.string(),
    systemInstructions: v.optional(v.string()),
    reasoningEffort: v.optional(v.string()),
    temperature: v.optional(v.float64()),
    status: statusValidator,
    responseId: v.optional(v.string()),
    output: v.optional(v.string()),
    citations: v.optional(v.array(citationValidator)),
    usage: v.optional(usageValidator),
    error: v.optional(v.string()),
    completedAt: v.optional(v.float64()),
  },
  returns: v.id("aiWriterGenerations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiWriterGenerations", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const _patchGeneration = internalMutation({
  args: {
    id: v.id("aiWriterGenerations"),
    status: v.optional(statusValidator),
    output: v.optional(v.string()),
    citations: v.optional(v.array(citationValidator)),
    usage: v.optional(usageValidator),
    error: v.optional(v.string()),
    completedAt: v.optional(v.float64()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) clean[k] = val;
    }
    await ctx.db.patch(id, clean);
    return null;
  },
});

/**
 * Loads a generation for the poll/cancel actions and re-checks that the caller
 * is the admin who owns it. Returned fields are the minimum the action needs.
 */
export const _getForOwner = internalQuery({
  args: { token: v.string(), id: v.id("aiWriterGenerations") },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("aiWriterGenerations"),
      userId: v.string(),
      kind: kindValidator,
      model: v.string(),
      status: statusValidator,
      responseId: v.optional(v.string()),
      output: v.optional(v.string()),
      citations: v.optional(v.array(citationValidator)),
      usage: v.optional(usageValidator),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) return null;
    return {
      id: row._id,
      userId: row.userId,
      kind: row.kind,
      model: row.model,
      status: row.status,
      responseId: row.responseId,
      output: row.output,
      citations: row.citations,
      usage: row.usage,
      error: row.error,
    };
  },
});

// ---------------------------------------------------------------------------
// Public (admin-gated) reads / writes used by the page
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;

/** Recent generations for the signed-in admin, newest first. */
export const listRecent = query({
  args: { token: v.string(), limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    const limit = Math.max(1, Math.min(MAX_HISTORY, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("aiWriterGenerations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    // Keep the list light: the full output only travels when a row is opened.
    return rows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      model: r.model,
      status: r.status,
      promptPreview: r.prompt.length > 160 ? `${r.prompt.slice(0, 160)}…` : r.prompt,
      outputChars: r.output?.length ?? 0,
      hasInstructions: Boolean(r.systemInstructions),
      error: r.error,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
  },
});

/** Full row (prompt, instructions, output, usage) for the "reopen" action. */
export const getGeneration = query({
  args: { token: v.string(), id: v.id("aiWriterGenerations") },
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) return null;
    return {
      _id: row._id,
      kind: row.kind,
      model: row.model,
      status: row.status,
      prompt: row.prompt,
      systemInstructions: row.systemInstructions,
      reasoningEffort: row.reasoningEffort,
      temperature: row.temperature,
      output: row.output,
      citations: row.citations,
      usage: row.usage,
      error: row.error,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    };
  },
});

export const deleteGeneration = mutation({
  args: { token: v.string(), id: v.id("aiWriterGenerations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) throw new ConvexError("Generation not found.");
    // The row is the only handle on a background OpenAI job — cancel first.
    if (row.status === "researching") {
      throw new ConvexError("This Deep Research run is still in progress. Cancel it before deleting.");
    }
    await ctx.db.delete(args.id as Id<"aiWriterGenerations">);
    return null;
  },
});

/**
 * The static allowlist, for the UI to render immediately while the action
 * that verifies availability against OpenAI is still in flight.
 */
export const listAllowedModels = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return AI_WRITER_MODELS.map((m) => ({ ...m, efforts: m.efforts ? [...m.efforts] : undefined }));
  },
});
