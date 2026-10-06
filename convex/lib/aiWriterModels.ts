/**
 * Model allowlist for the internal AI Writer tool (/admin/ai-writer).
 *
 * Only entries listed here can ever reach OpenAI — the actions validate the
 * client's selector `id` against this table, never against free text. The UI
 * shows the intersection of this list with what `GET /v1/models` says the API
 * project can actually use, so a model that OpenAI has not enabled for us is
 * never offered.
 *
 * `id` is the selector value the page sends; `model` is the OpenAI model id
 * that is actually called. They differ only where one OpenAI model backs two
 * modes (gpt-5.6-sol is both the flagship for ordinary generation and the
 * engine behind Deep Research).
 *
 * `family` drives which request parameters are sent:
 *   - "reasoning"      → Responses API, `reasoning.effort` allowed, NO
 *                        temperature (the gpt-5.x / o-series reject it — see
 *                        newsletterAi.ts for the same rule).
 *   - "chat"           → Responses API, `temperature` allowed.
 *   - "deep_research"  → Responses API in background mode with a web-search
 *                        data source, polled until complete. `reasoning.effort`
 *                        allowed, temperature is not.
 *
 * History (2026-09-19): `o3-deep-research` / `o4-mini-deep-research` were
 * retired by OpenAI on 2026-07-23 (deprecations page, announced 2026-04-22)
 * with `gpt-5.6-sol` as the named replacement. They still appear in
 * `GET /v1/models` but every create returns 404 model_not_found — verified
 * live — so they must not be listed here.
 */

export type AiWriterModelFamily = "reasoning" | "chat" | "deep_research";
export type AiWriterEffort = "low" | "medium" | "high" | "xhigh";

export type AiWriterModelSpec = {
    /** Selector value (unique). */
    id: string;
    /** OpenAI model id sent in the request. */
    model: string;
    label: string;
    family: AiWriterModelFamily;
    /** Short hint shown next to the model in the dropdown. */
    hint?: string;
    /** reasoning.effort values the model accepts (reasoning + deep_research). */
    efforts?: ReadonlyArray<AiWriterEffort>;
    /** Effort sent when the admin leaves it on "default" (deep_research only). */
    defaultEffort?: AiWriterEffort;
};

const GPT56_EFFORTS: ReadonlyArray<AiWriterEffort> = ["low", "medium", "high", "xhigh"];
const O_SERIES_EFFORTS: ReadonlyArray<AiWriterEffort> = ["low", "medium", "high"];

export const AI_WRITER_MODELS: ReadonlyArray<AiWriterModelSpec> = [
    // ── Reasoning (Responses API, reasoning.effort) ──────────────────────────
    { id: "o3", model: "o3", label: "o3", family: "reasoning", hint: "Reasoning", efforts: O_SERIES_EFFORTS },
    { id: "o4-mini", model: "o4-mini", label: "o4-mini", family: "reasoning", hint: "Fast reasoning", efforts: O_SERIES_EFFORTS },
    { id: "gpt-5.6-sol", model: "gpt-5.6-sol", label: "GPT-5.6 Sol", family: "reasoning", hint: "Flagship, 1M context", efforts: GPT56_EFFORTS },
    { id: "gpt-5.6-terra", model: "gpt-5.6-terra", label: "GPT-5.6 Terra", family: "reasoning", hint: "Used by Planera's own features", efforts: GPT56_EFFORTS },
    { id: "gpt-5.6-luna", model: "gpt-5.6-luna", label: "GPT-5.6 Luna", family: "reasoning", efforts: GPT56_EFFORTS },
    { id: "gpt-5.4-2026-03-05", model: "gpt-5.4-2026-03-05", label: "GPT-5.4 (2026-03-05)", family: "reasoning", efforts: O_SERIES_EFFORTS },
    { id: "gpt-5.2", model: "gpt-5.2", label: "GPT-5.2", family: "reasoning", efforts: O_SERIES_EFFORTS },
    { id: "gpt-5.1", model: "gpt-5.1", label: "GPT-5.1", family: "reasoning", efforts: O_SERIES_EFFORTS },
    { id: "gpt-5", model: "gpt-5", label: "GPT-5", family: "reasoning", efforts: O_SERIES_EFFORTS },
    { id: "gpt-5-mini", model: "gpt-5-mini", label: "GPT-5 mini", family: "reasoning", hint: "Cheap", efforts: O_SERIES_EFFORTS },

    // ── Chat (temperature supported) ─────────────────────────────────────────
    { id: "gpt-4.1", model: "gpt-4.1", label: "GPT-4.1", family: "chat", hint: "Temperature" },
    { id: "gpt-4o", model: "gpt-4o", label: "GPT-4o", family: "chat", hint: "Temperature" },
    { id: "gpt-4o-mini", model: "gpt-4o-mini", label: "GPT-4o mini", family: "chat", hint: "Cheap, temperature" },

    // ── Deep Research (background + web search, polled) ──────────────────────
    // OpenAI's named successor to o3-deep-research. Verified live 2026-09-19:
    // accepts background + web_search + max_tool_calls + effort high/xhigh.
    {
        id: "deep-research:gpt-5.6-sol",
        model: "gpt-5.6-sol",
        label: "Deep Research · GPT-5.6 Sol",
        family: "deep_research",
        hint: "Web research, minutes",
        efforts: ["medium", "high", "xhigh"],
        defaultEffort: "high",
    },
];

const BY_ID = new Map(AI_WRITER_MODELS.map((m) => [m.id, m]));

export function findAiWriterModel(id: string): AiWriterModelSpec | undefined {
    return BY_ID.get(id);
}

/** Hard ceilings so a runaway prompt can't burn the account. */
export const AI_WRITER_LIMITS = {
    maxPromptChars: 60_000,
    maxInstructionChars: 8_000,
    /** max_output_tokens for a standard generation. */
    maxOutputTokens: 8_000,
    /** Deep Research `max_tool_calls` ceiling (each call is a web search). */
    maxToolCalls: 60,
    defaultToolCalls: 25,
} as const;
