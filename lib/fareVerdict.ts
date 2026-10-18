/**
 * "Buy or wait" — turns Google's price insights for a fare into a verdict
 * plus the reasons behind it, written out so the user can see WHY.
 *
 * Shared by the app (flight search card, radar deal cards) and Convex (alert
 * copy). Pure and dependency-free so both bundles can import it.
 *
 * Inputs are whatever Google gave us for the fare's exact route + dates:
 *   - `priceLevel`: Google's own low / typical / high grade
 *   - `typicalRange`: the route's usual [low, high] fare
 *   - `priceHistory`: lowest fare for these dates over the last ~2 months
 *     (searchapi.io sends `{price, iso_date}`, SerpApi `[unixSeconds, price]`)
 *   - `departureDate`: how much time is left to wait at all
 *
 * Each signal adds or subtracts points; the total picks the verdict. It is a
 * heuristic read of Google's data, not a forecast — the UI says so.
 */

export type FareVerdict = "buy" | "fair" | "wait";

export type FareVerdictReasonKey =
  | "belowRange"
  | "underTypical"
  | "aboveTypical"
  | "aboveRange"
  | "googleLow"
  | "googleHigh"
  | "lowestSeen"
  | "pricesRising"
  | "pricesFalling"
  | "departingSoon"
  | "plentyOfTime";

export interface FareVerdictReason {
  /** i18n key under `fareVerdict.reason.*`. */
  key: FareVerdictReasonKey;
  /** Interpolation values. Money values are plain numbers in the fare's currency. */
  params: Record<string, number>;
  /** Signed contribution to the score (+ favours buying). */
  weight: number;
}

export interface FareVerdictResult {
  verdict: FareVerdict;
  /** Strongest first, at most `MAX_REASONS`. */
  reasons: FareVerdictReason[];
  score: number;
}

export interface FareVerdictInput {
  price: number;
  priceLevel?: string | null;
  typicalRange?: readonly number[] | null;
  priceHistory?: unknown;
  /** Outbound date, "YYYY-MM-DD". */
  departureDate?: string | null;
  /** Override "now" (tests). */
  now?: number;
}

const MAX_REASONS = 3;
/**
 * Fewer days than this to departure: fares rarely fall from here, so there is
 * no realistic "wait" — the verdict is never "wait" inside this window.
 */
const SOON_DAYS = 21;
/** More days than this: plenty of time to watch an unremarkable fare. */
const FAR_DAYS = 120;
/** A history needs this many points before we read a trend into it. */
const MIN_HISTORY_POINTS = 5;
/** Last price this far above/below the history median counts as a trend. */
const TREND_RATIO = 0.1;
/** Ignore gaps to the typical midpoint smaller than this share of it. */
const MIN_GAP_RATIO = 0.03;

/** Normalise either vendor's price_history to [ms, price], oldest first. */
export function parsePriceHistory(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number]> = [];
  for (const p of raw) {
    let t: number | null = null;
    let price: number | null = null;
    if (Array.isArray(p) && p.length >= 2) {
      // SerpApi: [unixSeconds, price]
      t = Number(p[0]) * (Number(p[0]) < 1e12 ? 1000 : 1);
      price = Number(p[1]);
    } else if (p && typeof p === "object") {
      const o = p as { price?: unknown; iso_date?: unknown };
      t = typeof o.iso_date === "string" ? Date.parse(o.iso_date) : null;
      price = Number(o.price);
    }
    if (t != null && Number.isFinite(t) && price != null && price > 0) {
      out.push([t, price]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function daysUntil(date: string, now: number): number | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now) / 86400000);
}

/**
 * Verdict for one fare, or null when Google gave us nothing to judge it by
 * (no grade and no typical range) — the caller then shows no verdict at all
 * rather than an invented one.
 */
export function fareVerdict(input: FareVerdictInput): FareVerdictResult | null {
  const price = Number(input.price);
  if (!(price > 0)) return null;
  const now = input.now ?? Date.now();
  const level = (input.priceLevel || "").toLowerCase();
  const range =
    Array.isArray(input.typicalRange) &&
    input.typicalRange.length === 2 &&
    input.typicalRange[0] > 0 &&
    input.typicalRange[1] >= input.typicalRange[0]
      ? [Number(input.typicalRange[0]), Number(input.typicalRange[1])]
      : null;
  if (!range && level !== "low" && level !== "typical" && level !== "high") {
    return null;
  }

  const reasons: FareVerdictReason[] = [];
  const add = (
    key: FareVerdictReasonKey,
    weight: number,
    params: Record<string, number> = {}
  ) => reasons.push({ key, weight, params });

  // ── Where the fare sits against the route's usual range ──
  if (range) {
    const [low, high] = range;
    const mid = (low + high) / 2;
    const r = (n: number) => Math.round(n);
    if (price < low) {
      add("belowRange", 2, { amount: r(low - price), low: r(low), high: r(high) });
    } else if (price > high) {
      add("aboveRange", -2, { amount: r(price - high), low: r(low), high: r(high) });
    } else if (mid - price >= mid * MIN_GAP_RATIO) {
      add("underTypical", 1, { amount: r(mid - price), typical: r(mid) });
    } else if (price - mid >= mid * MIN_GAP_RATIO) {
      add("aboveTypical", -1, { amount: r(price - mid), typical: r(mid) });
    }
  }
  // Google's own grade — only voiced when the range didn't already say it.
  const said = (k: FareVerdictReasonKey) => reasons.some((x) => x.key === k);
  if (level === "low" && !said("belowRange")) add("googleLow", 2);
  if (level === "high" && !said("aboveRange")) add("googleHigh", -2);

  // ── What these dates' price has been doing ──
  const history = parsePriceHistory(input.priceHistory);
  if (history.length >= MIN_HISTORY_POINTS) {
    const prices = history.map((h) => h[1]);
    const spanDays = Math.max(
      1,
      Math.round((history[history.length - 1][0] - history[0][0]) / 86400000)
    );
    const min = Math.min(...prices);
    const med = median(prices.slice(0, -1));
    const last = prices[prices.length - 1];
    if (price <= min * 1.01) add("lowestSeen", 1, { days: spanDays });
    if (last >= med * (1 + TREND_RATIO)) add("pricesRising", 1, { days: spanDays });
    else if (last <= med * (1 - TREND_RATIO) && !said("lowestSeen"))
      add("pricesFalling", -1, { days: spanDays });
  }

  // ── How long there is to wait at all ──
  const days = input.departureDate ? daysUntil(input.departureDate, now) : null;
  const scoreSoFar = reasons.reduce((s, x) => s + x.weight, 0);
  if (days != null && days >= 0 && days < SOON_DAYS) {
    add("departingSoon", 1, { days });
  } else if (days != null && days > FAR_DAYS && scoreSoFar <= 1) {
    add("plentyOfTime", -1, { months: Math.floor(days / 30) });
  }

  const score = reasons.reduce((s, x) => s + x.weight, 0);
  let verdict: FareVerdict = score >= 2 ? "buy" : score <= -1 ? "wait" : "fair";
  // Three weeks out there is nothing left to wait for.
  if (verdict === "wait" && days != null && days < SOON_DAYS) verdict = "fair";

  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return { verdict, reasons: reasons.slice(0, MAX_REASONS), score };
}
