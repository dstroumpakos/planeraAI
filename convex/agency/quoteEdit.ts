/**
 * Planera for Travel Agencies — editing a quote by hand (pure).
 *
 * The engine proposes; the agent decides. A tailor-made agency never sends the
 * three packages exactly as scored: the client asked for a sea view, the agent
 * knows that hotel's breakfast is poor, the ferry to the island is on the
 * agency's own contract and no API sells it. Before this module the only way to
 * change a line was to search again and hope, and the only way to add a ferry
 * was Word.
 *
 * Every function here takes packages and returns NEW packages — nothing is
 * mutated in place, so a Convex handler can compute, validate, and only then
 * write. Totals are always recomputed from the lines, never patched, so a quote
 * cannot end up with a total that disagrees with what it contains.
 *
 * Money identity kept on every line: supplierCost + markup + serviceFee ===
 * customerPrice. A hand-typed price moves the MARGIN, never the cost.
 */

import type {
  CurrencyCode,
  InternalFinancials,
  Money,
  NormalizedServiceOffer,
  PackageLine,
  PackageTier,
  TravelPackage,
} from "./model/types";
import { MANUAL_CONNECTOR_ID, money } from "./model/types";
import { sumFinancials } from "./pricing";
import { ValidationError } from "./validation";

export const TIERS: PackageTier[] = ["basic", "comfort", "premium"];

/** A quote holds at most this many lines per option — beyond it, it is a catalogue. */
export const MAX_LINES_PER_PACKAGE = 20;
/** Largest single line an agent may type, in minor units (€500,000). */
export const MAX_MANUAL_AMOUNT_MINOR = 50_000_000;

// ── Recompute ───────────────────────────────────────────────────────────────

/** Rebuild a package's totals from its lines. The ONLY way totals change. */
export function recomputePackage(pkg: TravelPackage, currency: CurrencyCode): TravelPackage {
  const payAtProperty: Money[] = [];
  for (const line of pkg.lines) {
    for (const c of line.offer.cost.payAtProperty ?? []) payAtProperty.push(c.amount);
  }
  return {
    ...pkg,
    totals: {
      internal: sumFinancials(
        pkg.lines.map((l) => l.financials),
        currency,
      ),
      payAtProperty,
    },
  };
}

function findTier(packages: TravelPackage[], tier: PackageTier): number {
  const i = packages.findIndex((p) => p.tier === tier);
  if (i < 0) throw new ValidationError(`this quote has no ${tier} option`);
  return i;
}

function checkIndex(pkg: TravelPackage, lineIndex: number): void {
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= pkg.lines.length) {
    throw new ValidationError("that line no longer exists — reload the quote");
  }
}

/** Apply `edit` to one tier, recompute it, and mark it as hand-edited. */
function editTier(
  packages: TravelPackage[],
  tier: PackageTier,
  currency: CurrencyCode,
  edit: (pkg: TravelPackage) => TravelPackage,
): TravelPackage[] {
  const i = findTier(packages, tier);
  const next = packages.slice();
  next[i] = recomputePackage({ ...edit(packages[i]), edited: true }, currency);
  return next;
}

// ── Line operations ─────────────────────────────────────────────────────────

/** Put `line` in place of line `lineIndex`, or append it when index is undefined. */
export function putLine(
  packages: TravelPackage[],
  tier: PackageTier,
  line: PackageLine,
  currency: CurrencyCode,
  lineIndex?: number,
): TravelPackage[] {
  if (line.financials.customerPrice.currency !== currency) {
    throw new ValidationError(
      `that option is priced in ${line.financials.customerPrice.currency}, this quote in ${currency}`,
    );
  }
  return editTier(packages, tier, currency, (pkg) => {
    const lines = pkg.lines.slice();
    if (lineIndex === undefined) {
      // The same fare twice in one option is always a mistake, and on the
      // client's document it reads as double-charging.
      if (lines.some((l) => l.offer.offerId === line.offer.offerId)) {
        throw new ValidationError("this option already contains that item");
      }
      if (lines.length >= MAX_LINES_PER_PACKAGE) {
        throw new ValidationError(`an option can hold at most ${MAX_LINES_PER_PACKAGE} items`);
      }
      lines.push(line);
    } else {
      checkIndex(pkg, lineIndex);
      if (lines.some((l, i) => i !== lineIndex && l.offer.offerId === line.offer.offerId)) {
        throw new ValidationError("this option already contains that item");
      }
      lines[lineIndex] = line;
    }
    return { ...pkg, lines };
  });
}

export function removeLine(
  packages: TravelPackage[],
  tier: PackageTier,
  lineIndex: number,
  currency: CurrencyCode,
): TravelPackage[] {
  return editTier(packages, tier, currency, (pkg) => {
    checkIndex(pkg, lineIndex);
    return { ...pkg, lines: pkg.lines.filter((_, i) => i !== lineIndex) };
  });
}

/** Move a line up (-1) or down (+1) — the document reads in line order. */
export function moveLine(
  packages: TravelPackage[],
  tier: PackageTier,
  lineIndex: number,
  direction: -1 | 1,
  currency: CurrencyCode,
): TravelPackage[] {
  return editTier(packages, tier, currency, (pkg) => {
    checkIndex(pkg, lineIndex);
    const target = lineIndex + direction;
    if (target < 0 || target >= pkg.lines.length) return pkg;
    const lines = pkg.lines.slice();
    [lines[lineIndex], lines[target]] = [lines[target], lines[lineIndex]];
    return { ...pkg, lines };
  });
}

/**
 * Re-state a line at the customer price the agent typed.
 *
 * The supplier cost is a fact and never moves. The difference lands on the
 * agency's own lines: markup for a net rate; service fee for commissionable or
 * gross rates, where the supplier's terms forbid a markup and the only thing
 * the agency may add is its own fee. A price BELOW cost is allowed — agencies
 * do sell at a loss to win a client — and shows as a negative margin the agent
 * can see, rather than being silently refused.
 */
export function withCustomerPrice(line: PackageLine, customerPriceMinor: number): PackageLine {
  if (!Number.isInteger(customerPriceMinor) || customerPriceMinor < 0) {
    throw new ValidationError("the price must be a positive amount");
  }
  if (customerPriceMinor > MAX_MANUAL_AMOUNT_MINOR) {
    throw new ValidationError("that price is larger than a single line may be");
  }
  const f = line.financials;
  const cur = f.customerPrice.currency;
  const delta = customerPriceMinor - f.customerPrice.amountMinor;
  const onMarkup = line.offer.cost.rateType === "net";

  const markup = f.markup.amountMinor + (onMarkup ? delta : 0);
  const serviceFee = f.serviceFee.amountMinor + (onMarkup ? 0 : delta);
  const financials: InternalFinancials = {
    ...f,
    markup: money(markup, cur),
    serviceFee: money(serviceFee, cur),
    customerPrice: money(customerPriceMinor, cur),
    expectedGrossProfit: money(markup + serviceFee + f.expectedCommission.amountMinor, cur),
  };
  return { ...line, financials, priceOverridden: true };
}

export function setLinePrice(
  packages: TravelPackage[],
  tier: PackageTier,
  lineIndex: number,
  customerPriceMinor: number,
  currency: CurrencyCode,
): TravelPackage[] {
  return editTier(packages, tier, currency, (pkg) => {
    checkIndex(pkg, lineIndex);
    const lines = pkg.lines.slice();
    lines[lineIndex] = withCustomerPrice(lines[lineIndex], customerPriceMinor);
    return { ...pkg, lines };
  });
}

export function setLineNote(
  packages: TravelPackage[],
  tier: PackageTier,
  lineIndex: number,
  note: string | undefined,
  currency: CurrencyCode,
): TravelPackage[] {
  const clean = note?.trim().replace(/\s+/g, " ").slice(0, 280) || undefined;
  return editTier(packages, tier, currency, (pkg) => {
    checkIndex(pkg, lineIndex);
    const lines = pkg.lines.slice();
    lines[lineIndex] = { ...lines[lineIndex], clientNote: clean };
    return { ...pkg, lines };
  });
}

// ── Tier operations ─────────────────────────────────────────────────────────

export function updateTier(
  packages: TravelPackage[],
  tier: PackageTier,
  patch: { customTitle?: string | null; hidden?: boolean },
): TravelPackage[] {
  const i = findTier(packages, tier);
  const next = packages.slice();
  const cur = packages[i];
  const title =
    patch.customTitle === undefined
      ? cur.customTitle
      : patch.customTitle?.trim().slice(0, 60) || undefined;
  const hidden = patch.hidden === undefined ? cur.hidden : patch.hidden;
  // A client must always have SOMETHING to look at.
  if (hidden && packages.every((p, j) => j === i || p.hidden)) {
    throw new ValidationError("at least one option has to stay visible to the client");
  }
  next[i] = { ...cur, customTitle: title, hidden: hidden || undefined };
  return next;
}

/** Copy every line of one option into another — the usual start of "same trip, better hotel". */
export function copyTier(
  packages: TravelPackage[],
  from: PackageTier,
  to: PackageTier,
  currency: CurrencyCode,
): TravelPackage[] {
  if (from === to) throw new ValidationError("pick a different option to copy into");
  const source = packages[findTier(packages, from)];
  return editTier(packages, to, currency, (pkg) => ({
    ...pkg,
    lines: source.lines.map((l) => ({ ...l })),
    foodBudget: source.foodBudget ?? pkg.foodBudget,
  }));
}

// ── Manual lines ────────────────────────────────────────────────────────────

export interface ManualLineInput {
  category: NormalizedServiceOffer["category"];
  title: string;
  description?: string;
  supplierName?: string;
  /** What the agency pays, minor units. */
  supplierCostMinor: number;
  /** What the client pays, minor units. */
  customerPriceMinor: number;
  refundable: boolean;
  clientNote?: string;
}

const CATEGORIES: ReadonlyArray<NormalizedServiceOffer["category"]> = [
  "flight",
  "hotel",
  "transfer",
  "activity",
  "ferry",
  "car",
  "insurance",
  "guide",
  "other",
];

function amount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_MANUAL_AMOUNT_MINOR) {
    throw new ValidationError(`${label} must be an amount between 0 and 500,000`);
  }
  return value;
}

/**
 * Build a line the agent typed in. Priced as a NET rate: the agency knows what
 * it pays and what it charges, and the difference is its markup — the same
 * identity every searched line keeps, so the package totals stay honest.
 */
export function buildManualLine(
  input: ManualLineInput,
  currency: CurrencyCode,
  now: number,
  id: string,
): PackageLine {
  const title = input.title?.trim().replace(/\s+/g, " ").slice(0, 140);
  if (!title) throw new ValidationError("give the service a name the client will recognise");
  if (!CATEGORIES.includes(input.category)) throw new ValidationError("unknown service category");
  const cost = amount(input.supplierCostMinor, "the supplier cost");
  const price = amount(input.customerPriceMinor, "the client price");

  const offer: NormalizedServiceOffer = {
    kind: "service",
    offerId: `${MANUAL_CONNECTOR_ID}:${id}`,
    connectorId: MANUAL_CONNECTOR_ID,
    supplierOfferId: id,
    category: input.category,
    title,
    description: input.description?.trim().slice(0, 500) || undefined,
    supplierName: input.supplierName?.trim().slice(0, 80) || undefined,
    cost: { rateType: "net", base: money(cost, currency), taxes: money(0, currency) },
    conditions: { refundable: !!input.refundable, changeable: !!input.refundable },
    quotedAt: now,
  };

  const m = (x: number) => money(x, currency);
  return {
    kind: "service",
    offer,
    financials: {
      supplierCost: m(cost),
      markup: m(price - cost),
      serviceFee: m(0),
      expectedCommission: m(0),
      customerPrice: m(price),
      expectedGrossProfit: m(price - cost),
    },
    priceOverridden: true,
    clientNote: input.clientNote?.trim().slice(0, 280) || undefined,
  };
}

export const isManualLine = (line: PackageLine): boolean =>
  line.offer.connectorId === MANUAL_CONNECTOR_ID;

// ── Alternatives pool ───────────────────────────────────────────────────────

/**
 * Candidates the agent can swap in, per kind. Kept on the quote at search time
 * so a swap is instant and costs no supplier call — the agent is choosing
 * between prices they already have, which is the conversation they are in.
 */
export type AlternativesPool = Partial<Record<"flight" | "hotel" | "activity" | "transfer", PackageLine[]>>;

/** Per-kind cap. Enough to choose from; small enough to stay far below the doc limit. */
export const POOL_CAP: Record<"flight" | "hotel" | "activity" | "transfer", number> = {
  flight: 15,
  hotel: 20,
  activity: 15,
  transfer: 8,
};

/** Hard cap after add-on searches, which append to the pool. */
export const POOL_MAX: Record<"flight" | "hotel" | "activity" | "transfer", number> = {
  flight: 40,
  hotel: 60,
  activity: 40,
  transfer: 20,
};

/**
 * Choose what goes in the pool: the cheapest few AND the best few, because an
 * agent swapping a line is usually doing one of exactly two things — "find me
 * something cheaper" or "find me something nicer".
 */
export function pickPool(
  lines: PackageLine[],
  cap: number,
  quality: (line: PackageLine) => number,
): PackageLine[] {
  if (lines.length <= cap) return lines.slice().sort(byPrice);
  const cheap = lines.slice().sort(byPrice);
  const best = lines.slice().sort((a, b) => quality(b) - quality(a));
  const out = new Map<string, PackageLine>();
  let i = 0;
  while (out.size < cap && (i < cheap.length || i < best.length)) {
    for (const l of [cheap[i], best[i]]) {
      if (l && out.size < cap && !out.has(l.offer.offerId)) out.set(l.offer.offerId, l);
    }
    i++;
  }
  return [...out.values()].sort(byPrice);
}

const byPrice = (a: PackageLine, b: PackageLine) =>
  a.financials.customerPrice.amountMinor - b.financials.customerPrice.amountMinor;

/** Quality signal per line, 0..1-ish — only used to pick a diverse pool. */
export function lineQuality(line: PackageLine): number {
  const o = line.offer;
  switch (o.kind) {
    case "hotel":
      return (o.reviewScore ?? 0) / 10 + (o.starRating ?? 0) / 10;
    case "flight":
      return 1 / (1 + o.outboundStops + (o.inboundStops ?? 0)) + (o.conditions.refundable ? 0.2 : 0);
    case "activity":
      return o.qualityScore ?? 0;
    default:
      return 0;
  }
}

/** Merge new candidates into a pool, newest first on a clash, capped per kind. */
export function mergePool(pool: AlternativesPool, add: AlternativesPool): AlternativesPool {
  const out: AlternativesPool = { ...pool };
  for (const kind of Object.keys(POOL_MAX) as Array<keyof typeof POOL_MAX>) {
    const incoming = add[kind] ?? [];
    if (!incoming.length) continue;
    const byId = new Map<string, PackageLine>();
    for (const l of incoming) byId.set(l.offer.offerId, l);
    for (const l of pool[kind] ?? []) if (!byId.has(l.offer.offerId)) byId.set(l.offer.offerId, l);
    out[kind] = [...byId.values()].slice(0, POOL_MAX[kind]);
  }
  return out;
}

/** Find a candidate by offer id across the pool AND the packages themselves. */
export function findCandidate(
  pool: AlternativesPool,
  packages: TravelPackage[],
  offerId: string,
): PackageLine | null {
  for (const lines of Object.values(pool)) {
    const hit = lines?.find((l) => l.offer.offerId === offerId);
    if (hit) return hit;
  }
  for (const p of packages) {
    const hit = p.lines.find((l) => l.offer.offerId === offerId);
    if (hit) return hit;
  }
  return null;
}
