/**
 * Planera for Travel Agencies — read a client's request into a search.
 *
 * A tailor-made quote starts as an email: "we are 2 adults and a 7-year-old,
 * thinking Rome for 5 nights around the 10th of May, direct flights if
 * possible, a nice central hotel with breakfast". The agent retypes that into
 * a form. This reads it into the same form, for the agent to CHECK — nothing
 * is searched until the agent presses the button.
 *
 * It fills fields; it never decides. Anything the email does not say is left
 * empty rather than guessed, and every value lands in an editable input.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation } from "../_generated/server";
import { guard, invalid } from "./errors";
import { consumeLimit, requireAccessRW } from "./store";

const MODEL = process.env.AGENCY_COPY_MODEL || "gpt-4o-mini";
const TIMEOUT_MS = 25_000;

export interface ParsedRequest {
  originIata: string | null;
  destinationIata: string | null;
  /** Cities as the client named them, for the agent to confirm the airport. */
  originCity: string | null;
  destinationCity: string | null;
  departDate: string | null;
  returnDate: string | null;
  adults: number | null;
  childrenAges: number[];
  rooms: number | null;
  cabinClass: "economy" | "premium_economy" | "business" | "first" | null;
  directOnly: boolean | null;
  kinds: Array<"flight" | "hotel" | "activity" | "transfer">;
  clientName: string | null;
  /** Everything else worth keeping in view: budget, board, preferences. */
  notes: string[];
  /** What the model was unsure of — shown to the agent, not hidden. */
  assumptions: string[];
}

export const _authorize = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("requestParse.authorize", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      await consumeLimit(ctx, "parseRequest", access.agencyId);
      return null;
    }),
});

const authorizeRef = makeFunctionReference<"mutation", { token: string }, null>(
  "agency/requestParse:_authorize",
);

const SYSTEM = [
  "You read a travel agency client's trip request and extract search fields.",
  "The request may be in Greek or English. Today's date is given; resolve relative",
  'dates ("next month", "around Easter", "the 10th") to YYYY-MM-DD in the FUTURE.',
  "",
  "RULES:",
  "- Extract only what the text states or clearly implies. Unknown => null.",
  "- originIata / destinationIata: the main IATA airport code for the city named",
  "  (e.g. Athens ATH, Rome FCO, London LHR, Paris CDG, Thessaloniki SKG).",
  "  If the client names no departure city, origin is null.",
  "- If a duration is given with a start date, compute returnDate.",
  '- kinds: which services they want among "flight","hotel","activity","transfer".',
  "  If unclear, use [\"flight\",\"hotel\"].",
  "- childrenAges: ages in years for each child mentioned.",
  "- notes: short bullet facts that do not fit a field (budget, board, room type,",
  "  hotel area, preferences), in the language of the request.",
  "- assumptions: anything you inferred rather than read, in the request's language.",
  "",
  "Reply ONLY with JSON:",
  '{"originIata":..,"destinationIata":..,"originCity":..,"destinationCity":..,',
  '"departDate":..,"returnDate":..,"adults":..,"childrenAges":[],"rooms":..,',
  '"cabinClass":..,"directOnly":..,"kinds":[],"clientName":..,"notes":[],"assumptions":[]}',
].join("\n");

const str = (x: unknown, max = 80): string | null =>
  typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
const iata = (x: unknown): string | null => {
  const s = str(x, 3)?.toUpperCase();
  return s && /^[A-Z]{3}$/.test(s) ? s : null;
};
const date = (x: unknown): string | null => {
  const s = str(x, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const int = (x: unknown, min: number, max: number): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : null;

/** Coerce whatever the model returned into the shape — never trust its types. */
export function sanitizeParsed(raw: Record<string, unknown>, todayISO: string): ParsedRequest {
  let departDate = date(raw.departDate);
  let returnDate = date(raw.returnDate);
  if (departDate && departDate < todayISO) departDate = null;
  if (returnDate && (!departDate || returnDate <= departDate)) returnDate = null;

  const kindsAllowed = ["flight", "hotel", "activity", "transfer"] as const;
  const kinds = Array.isArray(raw.kinds)
    ? kindsAllowed.filter((k) => (raw.kinds as unknown[]).includes(k))
    : [];
  const cabins = ["economy", "premium_economy", "business", "first"] as const;
  const cabin = cabins.find((c) => c === raw.cabinClass) ?? null;
  const list = (x: unknown) =>
    Array.isArray(x)
      ? x
          .map((s) => str(s, 200))
          .filter((s): s is string => !!s)
          .slice(0, 12)
      : [];

  return {
    originIata: iata(raw.originIata),
    destinationIata: iata(raw.destinationIata),
    originCity: str(raw.originCity),
    destinationCity: str(raw.destinationCity),
    departDate,
    returnDate,
    adults: int(raw.adults, 1, 9),
    childrenAges: Array.isArray(raw.childrenAges)
      ? (raw.childrenAges as unknown[])
          .map((a) => int(a, 0, 17))
          .filter((a): a is number => a !== null)
          .slice(0, 8)
      : [],
    rooms: int(raw.rooms, 1, 9),
    cabinClass: cabin,
    directOnly: typeof raw.directOnly === "boolean" ? raw.directOnly : null,
    kinds: kinds.length ? [...kinds] : ["flight", "hotel"],
    clientName: str(raw.clientName, 120),
    notes: list(raw.notes),
    assumptions: list(raw.assumptions),
  };
}

export const parseRequest = action({
  args: { token: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<ParsedRequest> =>
    guard("requestParse.parse", async () => {
      const text = args.text.trim();
      if (text.length < 10) throw invalid("paste the client's request first");
      if (text.length > 8000) throw invalid("that request is too long — paste the relevant part");
      await ctx.runMutation(authorizeRef, { token: args.token });

      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw invalid("AI reading is not configured on this workspace");

      const today = new Date().toISOString().slice(0, 10);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: MODEL,
            response_format: { type: "json_object" },
            max_completion_tokens: 700,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: `Today: ${today}\n\nRequest:\n${text}` },
            ],
          }),
        });
        if (!res.ok) {
          console.error(`[agency:requestParse] OpenAI ${res.status}`);
          throw invalid("the AI could not read this request — fill the form by hand");
        }
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw invalid("the AI could not read this request — fill the form by hand");
        return sanitizeParsed(JSON.parse(content) as Record<string, unknown>, today);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          throw invalid("the AI took too long — try again or fill the form by hand");
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }),
});
