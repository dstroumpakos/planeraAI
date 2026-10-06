"use node";

/**
 * AI Writer — the OpenAI side of the internal admin tool (/admin/ai-writer).
 *
 * Every action here:
 *   1. resolves the session token to an admin via `internal.aiWriter.resolveAdmin`
 *      (throws a ConvexError otherwise — the check is server-side, the page
 *      hiding itself is only cosmetic);
 *   2. validates the requested model against `AI_WRITER_MODELS` — a model id
 *      that is not on the allowlist never reaches OpenAI;
 *   3. talks to the OpenAI **Responses API** with `OPENAI_API_KEY` from the
 *      deployment environment. The key is never returned, logged or stored.
 *
 * Two execution flows, because they genuinely differ at the API:
 *
 *   - `generate` — synchronous `responses.create` for the reasoning / chat
 *     families. Reasoning models get `reasoning.effort`, chat models get
 *     `temperature`; a parameter the family doesn't support is never sent.
 *
 *   - `startDeepResearch` / `pollDeepResearch` / `cancelDeepResearch` — Deep
 *     Research runs on `gpt-5.6-sol` (OpenAI's named successor to the retired
 *     `o3-deep-research`, see lib/aiWriterModels.ts) with a data-source tool
 *     (`web_search`), a tool-call cap and high reasoning effort. Such runs can
 *     take many minutes, so per OpenAI's guidance they are created with
 *     `background: true` and polled with `responses.retrieve`. The history row is the durable handle: it holds
 *     the OpenAI response id and is completed by whichever poll sees
 *     `status: "completed"`.
 *
 * Errors from OpenAI are mapped to short, user-facing ConvexError messages
 * (bad key, model not available, quota, timeout) — never the raw payload.
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import {
  AI_WRITER_LIMITS,
  AI_WRITER_MODELS,
  findAiWriterModel,
  type AiWriterModelSpec,
} from "./lib/aiWriterModels";
import { usageValidator, citationValidator } from "./aiWriter";

// Convex node actions are capped at 10 minutes; leave headroom for the
// history write after OpenAI answers.
const STANDARD_TIMEOUT_MS = 8 * 60 * 1000;
const MODELS_TIMEOUT_MS = 15 * 1000;
const POLL_TIMEOUT_MS = 30 * 1000;

type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

type Citation = { url: string; title: string; startIndex: number; endIndex: number };

/** What `_getForOwner` returns — typed by hand to keep the actions' inferred
 *  types from looping back through the generated `internal` map. */
type OwnerRow = {
  id: Id<"aiWriterGenerations">;
  userId: string;
  kind: "standard" | "deep_research";
  model: string;
  status: "researching" | "completed" | "failed" | "cancelled";
  responseId?: string;
  output?: string;
  citations?: Citation[];
  usage?: Usage;
  error?: string;
};

/**
 * `max_tool_calls` is a documented Responses API parameter (it caps how many
 * web searches a Deep Research run may perform) that the installed SDK's
 * types don't list yet. The SDK forwards the body verbatim, so widening the
 * type is all that's needed.
 */
type DeepResearchCreateParams = ResponseCreateParamsNonStreaming & { max_tool_calls?: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConvexError(
      "OPENAI_API_KEY is not set on the Convex deployment. Add it in the Convex dashboard → Settings → Environment Variables.",
    );
  }
  // maxRetries: 0 — a retried generation is a second bill and, for a
  // background run, a second job. The page handles retries explicitly.
  return new OpenAI({ apiKey, maxRetries: 0 });
}

/** Model must be on the allowlist AND (optionally) of the family the caller supports. */
function requireModel(
  id: string,
  allowed: ReadonlyArray<AiWriterModelSpec["family"]>,
): AiWriterModelSpec {
  const spec = findAiWriterModel(id);
  if (!spec) {
    throw new ConvexError(`"${id}" is not on the AI Writer allowlist.`);
  }
  if (!allowed.includes(spec.family)) {
    if (spec.family === "deep_research") {
      throw new ConvexError(
        "Deep Research models run asynchronously — use the Deep Research flow instead of a standard generation.",
      );
    }
    throw new ConvexError(`Model "${id}" is not a Deep Research model.`);
  }
  return spec;
}

function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new ConvexError("Enter a prompt first.");
  if (trimmed.length > AI_WRITER_LIMITS.maxPromptChars) {
    throw new ConvexError(
      `Prompt is too long (${trimmed.length.toLocaleString()} characters, max ${AI_WRITER_LIMITS.maxPromptChars.toLocaleString()}).`,
    );
  }
  return trimmed;
}

function cleanInstructions(instructions: string | undefined): string | undefined {
  const trimmed = instructions?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > AI_WRITER_LIMITS.maxInstructionChars) {
    throw new ConvexError(
      `System instructions are too long (max ${AI_WRITER_LIMITS.maxInstructionChars.toLocaleString()} characters).`,
    );
  }
  return trimmed;
}

function readUsage(resp: OpenAIResponse): Usage | undefined {
  const u = resp.usage;
  if (!u) return undefined;
  const usage: Usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  const reasoning = u.output_tokens_details?.reasoning_tokens;
  if (typeof reasoning === "number") usage.reasoningTokens = reasoning;
  const cached = u.input_tokens_details?.cached_tokens;
  if (typeof cached === "number") usage.cachedInputTokens = cached;
  return usage;
}

/**
 * `output_text` is the SDK's convenience join of every message's text parts;
 * fall back to walking `output` in case a future SDK drops the getter.
 */
function readText(resp: OpenAIResponse): string {
  if (typeof resp.output_text === "string" && resp.output_text.length > 0) {
    return resp.output_text;
  }
  const parts: string[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}

/** url_citation annotations on the final message(s), in document order. */
function readCitations(resp: OpenAIResponse): Citation[] {
  const out: Citation[] = [];
  for (const item of resp.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      for (const a of c.annotations ?? []) {
        if (a.type !== "url_citation") continue;
        out.push({
          url: a.url,
          title: a.title || a.url,
          startIndex: a.start_index,
          endIndex: a.end_index,
        });
      }
    }
  }
  return out;
}

/** Why a finished response carries no usable text. */
function describeTerminalFailure(resp: OpenAIResponse): string {
  if (resp.status === "cancelled") return "The run was cancelled.";
  if (resp.status === "incomplete") {
    const reason = resp.incomplete_details?.reason;
    return reason === "max_output_tokens"
      ? "OpenAI stopped early: the output hit the token limit."
      : reason === "content_filter"
        ? "OpenAI stopped early: the content filter intervened."
        : "OpenAI returned an incomplete response.";
  }
  if (resp.error?.message) return `OpenAI error: ${resp.error.message}`;
  return "OpenAI returned no text.";
}

/**
 * Maps an SDK failure to something an admin can act on. The message never
 * includes request bodies or headers.
 */
function toUserError(err: unknown, model: string): ConvexError<string> {
  if (err instanceof ConvexError) return err;
  const anyErr = err as { status?: number; code?: string; name?: string; message?: string };
  const status = anyErr?.status;
  const code = anyErr?.code;
  const name = anyErr?.name ?? "";
  const rawMessage = anyErr?.message ?? "";

  if (name === "APIConnectionTimeoutError" || /timed out/i.test(rawMessage)) {
    return new ConvexError(
      "The request timed out before OpenAI answered. Try a shorter prompt, a lower reasoning effort, or Deep Research for long jobs.",
    );
  }
  if (status === 401) {
    return new ConvexError("OpenAI rejected the API key (401). Check OPENAI_API_KEY on the Convex deployment.");
  }
  if (status === 403) {
    return new ConvexError(`OpenAI refused access to "${model}" (403). The project may not have this model enabled.`);
  }
  if (status === 404 || code === "model_not_found") {
    // Retired ids stay listed in GET /v1/models but 404 on create (this is
    // how o3-deep-research looked after its 2026-07-23 shutdown), so point at
    // the deprecations page rather than at account settings.
    return new ConvexError(
      `Model "${model}" is not available to this OpenAI project (404 model_not_found). ` +
        "If it is on the allowlist, check OpenAI's deprecations page — retired models keep appearing in the model list.",
    );
  }
  if (status === 429) {
    return new ConvexError(
      code === "insufficient_quota"
        ? "OpenAI quota exhausted for this project (429 insufficient_quota)."
        : "OpenAI rate limit hit (429). Wait a moment and retry.",
    );
  }
  if (status === 400) {
    // OpenAI's 400 messages are safe to show — they explain which parameter
    // the model rejected ("Unsupported parameter: temperature", etc.).
    const detail = rawMessage.replace(/^\d{3}\s*/, "").slice(0, 300);
    return new ConvexError(`OpenAI rejected the request: ${detail || "bad request"}.`);
  }
  if (typeof status === "number" && status >= 500) {
    return new ConvexError(`OpenAI is having trouble (HTTP ${status}). Retry shortly.`);
  }
  console.error(`[aiWriter] unexpected OpenAI failure model=${model} name=${name} status=${status ?? "-"}`);
  return new ConvexError("OpenAI request failed. Check the Convex logs for details.");
}

const effortValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
);

// ---------------------------------------------------------------------------
// Model availability
// ---------------------------------------------------------------------------

/**
 * Intersects the allowlist with the models `GET /v1/models` reports for this
 * API project. If OpenAI can't be reached the allowlist is returned unverified
 * so the page still works; a wrong pick then surfaces as a clear error at
 * generation time.
 */
export const listAvailableModels = action({
  args: { token: v.string() },
  returns: v.object({
    verified: v.boolean(),
    models: v.array(
      v.object({
        id: v.string(),
        model: v.string(),
        label: v.string(),
        family: v.union(v.literal("reasoning"), v.literal("chat"), v.literal("deep_research")),
        hint: v.optional(v.string()),
        efforts: v.optional(v.array(effortValidator)),
        defaultEffort: v.optional(effortValidator),
        available: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.aiWriter.resolveAdmin, { token: args.token });
    const toRow = (m: AiWriterModelSpec, available: boolean) => ({
      id: m.id,
      model: m.model,
      label: m.label,
      family: m.family,
      hint: m.hint,
      efforts: m.efforts ? [...m.efforts] : undefined,
      defaultEffort: m.defaultEffort,
      available,
    });

    let openai: OpenAI;
    try {
      openai = getClient();
    } catch (err) {
      // No key: still let the page render, generation will explain.
      console.warn("[aiWriter] listAvailableModels: OPENAI_API_KEY missing");
      return { verified: false, models: AI_WRITER_MODELS.map((m) => toRow(m, true)) };
    }

    try {
      const ids = new Set<string>();
      for await (const m of openai.models.list({ timeout: MODELS_TIMEOUT_MS })) {
        ids.add(m.id);
      }
      return {
        verified: true,
        models: AI_WRITER_MODELS.map((m) => toRow(m, ids.has(m.model))),
      };
    } catch (err) {
      const e = err as { status?: number; name?: string };
      console.warn(`[aiWriter] models.list failed status=${e?.status ?? "-"} name=${e?.name ?? "-"}`);
      return { verified: false, models: AI_WRITER_MODELS.map((m) => toRow(m, true)) };
    }
  },
});

// ---------------------------------------------------------------------------
// Standard generation (reasoning + chat families, synchronous)
// ---------------------------------------------------------------------------

export const generate = action({
  args: {
    token: v.string(),
    prompt: v.string(),
    model: v.string(),
    systemInstructions: v.optional(v.string()),
    reasoningEffort: v.optional(effortValidator),
    temperature: v.optional(v.float64()),
  },
  returns: v.object({
    generationId: v.id("aiWriterGenerations"),
    text: v.string(),
    model: v.string(),
    usage: v.optional(usageValidator),
    /** Set when the text was cut short (e.g. max_output_tokens). */
    warning: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.aiWriter.resolveAdmin, { token: args.token });
    const spec = requireModel(args.model, ["reasoning", "chat"]);
    const prompt = requirePrompt(args.prompt);
    const instructions = cleanInstructions(args.systemInstructions);

    // Only send what the family supports — reasoning models reject
    // `temperature`, chat models ignore `reasoning`.
    const reasoningEffort =
      spec.family === "reasoning" && args.reasoningEffort && spec.efforts?.includes(args.reasoningEffort)
        ? args.reasoningEffort
        : undefined;
    const temperature =
      spec.family === "chat" && typeof args.temperature === "number"
        ? Math.min(2, Math.max(0, args.temperature))
        : undefined;

    const openai = getClient();
    const startedAt = Date.now();
    console.log(
      `[aiWriter] generate user=${userId} model=${spec.model} promptChars=${prompt.length}` +
        (reasoningEffort ? ` effort=${reasoningEffort}` : "") +
        (temperature !== undefined ? ` temperature=${temperature}` : ""),
    );

    let resp: OpenAIResponse;
    try {
      resp = await openai.responses.create(
        {
          model: spec.model,
          input: prompt,
          ...(instructions ? { instructions } : {}),
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          max_output_tokens: AI_WRITER_LIMITS.maxOutputTokens,
          // Nothing needs to be retrieved later; don't keep it on OpenAI's side.
          store: false,
        },
        { timeout: STANDARD_TIMEOUT_MS },
      );
    } catch (err) {
      const userErr = toUserError(err, spec.model);
      await ctx.runMutation(internal.aiWriter._insertGeneration, {
        userId,
        kind: "standard",
        model: spec.model,
        prompt,
        systemInstructions: instructions,
        reasoningEffort,
        temperature,
        status: "failed",
        error: userErr.data,
        completedAt: Date.now(),
      });
      throw userErr;
    }

    const text = readText(resp);
    const usage = readUsage(resp);
    // An "incomplete" response that hit max_output_tokens still carries the
    // text written so far — keep it and tell the admin it was cut short rather
    // than discarding a (billed) partial answer.
    const truncated = resp.status === "incomplete" && text.length > 0;
    const ok = text.length > 0 && (resp.status === "completed" || truncated);
    const error = ok ? (truncated ? describeTerminalFailure(resp) : undefined) : describeTerminalFailure(resp);

    const generationId: Id<"aiWriterGenerations"> = await ctx.runMutation(
      internal.aiWriter._insertGeneration,
      {
        userId,
        kind: "standard",
        model: spec.model,
        prompt,
        systemInstructions: instructions,
        reasoningEffort,
        temperature,
        status: ok ? "completed" : "failed",
        output: text || undefined,
        usage,
        error,
        completedAt: Date.now(),
      },
    );

    console.log(
      `[aiWriter] generate done model=${spec.model} status=${resp.status} ms=${Date.now() - startedAt}` +
        (usage ? ` tokens=${usage.totalTokens}` : ""),
    );

    if (!ok) throw new ConvexError(error ?? "OpenAI returned no text.");
    return { generationId, text, model: resp.model || spec.model, usage, warning: truncated ? error : undefined };
  },
});

// ---------------------------------------------------------------------------
// Deep Research (background + polling)
// ---------------------------------------------------------------------------

const deepResearchStatusValidator = v.union(
  v.literal("researching"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/**
 * Kicks off a Deep Research run. Returns immediately with the history row id;
 * the page polls `pollDeepResearch` until the status leaves "researching".
 */
export const startDeepResearch = action({
  args: {
    token: v.string(),
    prompt: v.string(),
    model: v.string(),
    systemInstructions: v.optional(v.string()),
    maxToolCalls: v.optional(v.float64()),
    reasoningEffort: v.optional(effortValidator),
  },
  returns: v.object({
    generationId: v.id("aiWriterGenerations"),
    model: v.string(),
    status: deepResearchStatusValidator,
  }),
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.aiWriter.resolveAdmin, { token: args.token });
    const spec = requireModel(args.model, ["deep_research"]);
    const prompt = requirePrompt(args.prompt);
    const instructions = cleanInstructions(args.systemInstructions);
    const maxToolCalls = Math.max(
      1,
      Math.min(AI_WRITER_LIMITS.maxToolCalls, Math.floor(args.maxToolCalls ?? AI_WRITER_LIMITS.defaultToolCalls)),
    );
    const reasoningEffort =
      args.reasoningEffort && spec.efforts?.includes(args.reasoningEffort)
        ? args.reasoningEffort
        : spec.defaultEffort;

    const openai = getClient();
    console.log(
      `[aiWriter] deepResearch start user=${userId} model=${spec.model} promptChars=${prompt.length} ` +
        `maxToolCalls=${maxToolCalls} effort=${reasoningEffort ?? "default"}`,
    );

    let resp: OpenAIResponse;
    try {
      const body: DeepResearchCreateParams = {
        model: spec.model,
        input: prompt,
        ...(instructions ? { instructions } : {}),
        // Required: at least one data source. Web search is the one that
        // needs no setup on our side. `web_search` is the current tool name
        // on the model page (`web_search_preview` is the older alias; both
        // answered live on 2026-09-19).
        tools: [{ type: "web_search" }],
        background: true,
        // Background responses must be stored so retrieve() can find them.
        store: true,
        max_tool_calls: maxToolCalls,
        reasoning: { summary: "auto", ...(reasoningEffort ? { effort: reasoningEffort } : {}) },
      };
      resp = await openai.responses.create(body, { timeout: POLL_TIMEOUT_MS });
    } catch (err) {
      const userErr = toUserError(err, spec.model);
      await ctx.runMutation(internal.aiWriter._insertGeneration, {
        userId,
        kind: "deep_research",
        model: spec.model,
        prompt,
        systemInstructions: instructions,
        reasoningEffort,
        status: "failed",
        error: userErr.data,
        completedAt: Date.now(),
      });
      throw userErr;
    }

    // A background create normally comes back "queued"; a tiny job could
    // already be complete, so route through the same finaliser as the poll.
    const finished = summarise(resp);
    const generationId: Id<"aiWriterGenerations"> = await ctx.runMutation(
      internal.aiWriter._insertGeneration,
      {
        userId,
        kind: "deep_research",
        model: spec.model,
        prompt,
        systemInstructions: instructions,
        reasoningEffort,
        status: finished.status,
        responseId: resp.id,
        output: finished.text,
        citations: finished.citations,
        usage: finished.usage,
        error: finished.error,
        completedAt: finished.status === "researching" ? undefined : Date.now(),
      },
    );
    console.log(`[aiWriter] deepResearch created response=${resp.id} status=${resp.status}`);
    return { generationId, model: spec.model, status: finished.status };
  },
});

type Summary = {
  status: "researching" | "completed" | "failed" | "cancelled";
  text?: string;
  citations?: Citation[];
  usage?: Usage;
  error?: string;
};

type PollResult = Summary;

function summarise(resp: OpenAIResponse): Summary {
  switch (resp.status) {
    case "queued":
    case "in_progress":
      return { status: "researching" };
    case "completed": {
      const text = readText(resp);
      if (!text) return { status: "failed", error: "Deep Research finished without producing text." };
      return { status: "completed", text, citations: readCitations(resp), usage: readUsage(resp) };
    }
    case "cancelled":
      return { status: "cancelled", error: describeTerminalFailure(resp), usage: readUsage(resp) };
    default:
      return { status: "failed", error: describeTerminalFailure(resp), usage: readUsage(resp) };
  }
}

/**
 * One poll. Cheap while the run is in progress (a single retrieve); the poll
 * that sees a terminal status persists the result so later reopen/copy reads
 * come from our database rather than from OpenAI.
 */
export const pollDeepResearch = action({
  args: { token: v.string(), generationId: v.id("aiWriterGenerations") },
  returns: v.object({
    status: deepResearchStatusValidator,
    text: v.optional(v.string()),
    citations: v.optional(v.array(citationValidator)),
    usage: v.optional(usageValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<PollResult> => {
    const row: OwnerRow | null = await ctx.runQuery(internal.aiWriter._getForOwner, {
      token: args.token,
      id: args.generationId,
    });
    if (!row) throw new ConvexError("Generation not found.");
    if (row.status !== "researching") {
      return { status: row.status, text: row.output, citations: row.citations, usage: row.usage, error: row.error };
    }
    if (!row.responseId) throw new ConvexError("This run has no OpenAI response id to poll.");

    const openai = getClient();
    let resp: OpenAIResponse;
    try {
      resp = await openai.responses.retrieve(row.responseId, {}, { timeout: POLL_TIMEOUT_MS });
    } catch (err) {
      // A transient poll failure must not kill the run — OpenAI keeps working.
      const e = err as { status?: number; name?: string };
      if (e?.status === 404) {
        const error = "OpenAI no longer has this response (it may have expired).";
        await ctx.runMutation(internal.aiWriter._patchGeneration, {
          id: row.id, status: "failed", error, completedAt: Date.now(),
        });
        return { status: "failed", error };
      }
      console.warn(`[aiWriter] poll failed response=${row.responseId} status=${e?.status ?? "-"} name=${e?.name ?? "-"}`);
      throw toUserError(err, row.model);
    }

    const s = summarise(resp);
    if (s.status !== "researching") {
      await ctx.runMutation(internal.aiWriter._patchGeneration, {
        id: row.id,
        status: s.status,
        output: s.text,
        citations: s.citations,
        usage: s.usage,
        error: s.error,
        completedAt: Date.now(),
      });
      console.log(
        `[aiWriter] deepResearch ${s.status} response=${resp.id}` + (s.usage ? ` tokens=${s.usage.totalTokens}` : ""),
      );
    }
    return { status: s.status, text: s.text, citations: s.citations, usage: s.usage, error: s.error };
  },
});

export const cancelDeepResearch = action({
  args: { token: v.string(), generationId: v.id("aiWriterGenerations") },
  returns: v.object({ status: deepResearchStatusValidator }),
  handler: async (ctx, args): Promise<{ status: OwnerRow["status"] }> => {
    const row: OwnerRow | null = await ctx.runQuery(internal.aiWriter._getForOwner, {
      token: args.token,
      id: args.generationId,
    });
    if (!row) throw new ConvexError("Generation not found.");
    if (row.status !== "researching") return { status: row.status };
    if (!row.responseId) throw new ConvexError("This run has no OpenAI response id to cancel.");

    const openai = getClient();
    try {
      await openai.responses.cancel(row.responseId, { timeout: POLL_TIMEOUT_MS });
    } catch (err) {
      const e = err as { status?: number };
      // Already finished on OpenAI's side → the next poll will record the real
      // outcome; anything else is reported.
      if (e?.status !== 400 && e?.status !== 404) throw toUserError(err, row.model);
    }
    await ctx.runMutation(internal.aiWriter._patchGeneration, {
      id: row.id,
      status: "cancelled",
      error: "Cancelled by you.",
      completedAt: Date.now(),
    });
    console.log(`[aiWriter] deepResearch cancelled response=${row.responseId}`);
    return { status: "cancelled" };
  },
});
