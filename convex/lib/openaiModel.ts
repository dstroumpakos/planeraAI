/**
 * The OpenAI model every Planera AI feature calls by default.
 *
 * The `OPENAI_MODEL` env var overrides it without a deploy — the escape hatch
 * for when the API project loses (or hasn't been granted) access to the model:
 * every AI feature returns 403 model_not_found until it's switched. The request
 * shapes below also work on gpt-5.6-terra, which makes it a safe fallback.
 *
 * Per-feature env vars (ATLAS_MODEL, TRANSLATE_MODEL, …) still override this,
 * and an override wins even when this constant changes — check
 * `npx convex env get <NAME> --prod` before assuming a feature switched.
 *
 * gpt-6.1-sol request rules (OpenAI "Using GPT-6" guide, 2026-10):
 *   - reasoning_effort accepts low | medium (default) | high | xhigh | max.
 *     `none` and `minimal` return HTTP 400 — use "low" where the old code
 *     skipped reasoning.
 *   - No temperature / top_p / logprobs (it is always reasoning).
 *   - Use max_completion_tokens, never max_tokens; reasoning tokens count
 *     toward it, so budgets need headroom above the visible output.
 *   - Tool calling needs the Responses API; Chat Completions only serves
 *     requests without tools (see atlas.ts).
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-6.1-sol";
