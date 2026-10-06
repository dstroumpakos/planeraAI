/**
 * Baggage parsing for Google Flights booking options (SerpApi + searchapi.io).
 *
 * Baggage info is NOT in `extensions[]` — it lives in each booking option's
 * `baggage_prices[]` (under `together` when the vendor nests it). Strings seen
 * live (Oct 2026), amounts are in the request currency, per bag, per person:
 *   "1 free carry-on"                       → included
 *   "2 free checked bags"                   → included ×2
 *   "No checked bags"                       → not offered with this fare
 *   "1st checked bag available for a fee"   → fee, amount unknown
 *   "1st carry-on: 13-36"                   → fee range (Ryanair)
 *   "1st checked bag: 105"                  → fee
 * A bag type missing from the list means unknown (e.g. Wizz only lists checked).
 */
import { v, type Infer } from "convex/values";

export const bagInfoValidator = v.object({
  status: v.union(v.literal("included"), v.literal("fee"), v.literal("none")),
  /** Number of free bags when status = "included". */
  count: v.optional(v.float64()),
  /** Fee per bag in the deal's currency when status = "fee" and known. */
  feeMin: v.optional(v.float64()),
  feeMax: v.optional(v.float64()),
});

export const dealBaggageValidator = v.object({
  carryOn: v.optional(bagInfoValidator),
  checked: v.optional(bagInfoValidator),
});

export type BagInfo = Infer<typeof bagInfoValidator>;
export type DealBaggage = Infer<typeof dealBaggageValidator>;

function parseOne(line: string): { kind: "carryOn" | "checked"; info: BagInfo } | null {
  const lower = line.toLowerCase();
  const kind = /carry[- ]?on|cabin/.test(lower)
    ? "carryOn"
    : /checked/.test(lower)
      ? "checked"
      : null;
  if (!kind) return null;

  if (/^\s*no\b|not included/.test(lower)) return { kind, info: { status: "none" } };

  const free = lower.match(/(\d+)\s+free\b/);
  if (free || /\bincluded\b/.test(lower)) {
    return { kind, info: { status: "included", count: free ? Number(free[1]) : 1 } };
  }

  // "1st carry-on: 13-36" / "1st checked bag: 105" — amount(s) after the colon.
  const after = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
  const nums = (after.match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((n) => Number(n.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 10000);
  if (nums.length) {
    return {
      kind,
      info: { status: "fee", feeMin: Math.min(...nums), feeMax: Math.max(...nums) },
    };
  }
  if (/fee/.test(lower)) return { kind, info: { status: "fee" } };
  return null;
}

/** Parse a booking option's `baggage_prices[]`. Undefined when nothing is known. */
export function parseBaggagePrices(lines: unknown): DealBaggage | undefined {
  if (!Array.isArray(lines)) return undefined;
  const out: DealBaggage = {};
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const parsed = parseOne(line);
    // First line per bag type wins — it describes the 1st bag.
    if (parsed && !out[parsed.kind]) out[parsed.kind] = parsed.info;
  }
  return out.carryOn || out.checked ? out : undefined;
}
