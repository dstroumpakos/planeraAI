/**
 * Planera for Travel Agencies — the client paying the AGENCY (pure).
 *
 * Planera has no travel-agency licence and is not a payment institution, so it
 * never receives, holds or forwards a traveller's money. Two ways a client can
 * pay, and in both the money goes straight to the agency:
 *
 *  1. Instructions. The agency's IBAN, beneficiary and (optionally) its own
 *     payment link are printed on the quote. The agent records the money by
 *     hand when it arrives, as before.
 *  2. Online, on the agency's OWN Viva Wallet or Stripe account (BYOK, like a
 *     supplier connection). Planera creates the checkout with the agency's keys
 *     and reads back whether it was paid. It stays OFF until those keys pass a
 *     live check — an agency that has not connected an account never shows a
 *     "pay now" button.
 *
 * A payment counts as paid only when the provider says so on the agency's own
 * credentials. A redirect or a webhook body is a hint to go and ask, never the
 * answer.
 */

import type { Money } from "./model/types";
import { money } from "./model/types";
import type { Fulfilment } from "./fulfilment";
import { ValidationError } from "./validation";

// ── Settings (option 1) ─────────────────────────────────────────────────────

export type PayWhen = "on_accept" | "on_request";

export interface PaymentSettings {
  beneficiary?: string;
  bankName?: string;
  /** Stored compact and uppercase: GR1601101250000000012300695. */
  iban?: string;
  bic?: string;
  /** The agency's own payment page (Viva, Stripe, a bank e-POS link). */
  paymentLinkUrl?: string;
  instructions?: string;
  /** 1..99 offers a deposit; 0 / absent asks for the full amount only. */
  depositPercent?: number;
  /**
   * "on_accept": the client can pay as soon as they choose an option.
   * "on_request": only after the agent asks, e.g. once availability is checked.
   */
  payWhen?: PayWhen;
}

/** ISO 13616 mod-97 check. Catches nearly every typo in a pasted IBAN. */
export function normalizeIban(raw: string): string {
  const iban = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    throw new ValidationError("the IBAN is not valid");
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  if (rem !== 1) throw new ValidationError("the IBAN is not valid, check for a typo");
  if (iban.startsWith("GR") && iban.length !== 27) {
    throw new ValidationError("a Greek IBAN has 27 characters");
  }
  return iban;
}

/** "GR16 0110 1250 …" — how people read an IBAN off a page. */
export const formatIban = (iban: string): string => iban.replace(/(.{4})/g, "$1 ").trim();

const BIC_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function clip(raw: string | undefined, max: number): string | undefined {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : undefined;
}

export function normalizePaymentSettings(input: PaymentSettings): PaymentSettings {
  const out: PaymentSettings = {
    beneficiary: clip(input.beneficiary, 120),
    bankName: clip(input.bankName, 80),
    instructions: (input.instructions ?? "").trim().slice(0, 1000) || undefined,
    payWhen: input.payWhen === "on_request" ? "on_request" : "on_accept",
  };
  if (input.iban?.trim()) out.iban = normalizeIban(input.iban);
  if (out.iban && !out.beneficiary) {
    throw new ValidationError("add the beneficiary name for the IBAN");
  }
  if (input.bic?.trim()) {
    const bic = input.bic.replace(/\s/g, "").toUpperCase();
    if (!BIC_RE.test(bic)) throw new ValidationError("the BIC / SWIFT code is not valid");
    out.bic = bic;
  }
  if (input.paymentLinkUrl?.trim()) {
    let url: URL;
    try {
      url = new URL(input.paymentLinkUrl.trim());
    } catch {
      throw new ValidationError("the payment link is not a valid address");
    }
    if (url.protocol !== "https:") throw new ValidationError("the payment link must start with https://");
    out.paymentLinkUrl = url.toString().slice(0, 500);
  }
  const pct = input.depositPercent ?? 0;
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new ValidationError("the deposit must be a whole percentage between 0 and 100");
  }
  // 100% is not a deposit, it is the full amount.
  out.depositPercent = pct > 0 && pct < 100 ? pct : 0;
  return out;
}

export const hasManualInstructions = (s: PaymentSettings | undefined): boolean =>
  !!(s?.iban || s?.paymentLinkUrl || s?.instructions);

// ── Online account (option 2) ───────────────────────────────────────────────

export type PaymentProvider = "viva" | "stripe";

export interface PaymentAccountState {
  status: "active" | "disabled" | "error";
  lastHealthOk?: boolean;
  revokedAt?: number;
  encryptedCredentials: string;
}

/**
 * THE switch for option 2. Keys saved but never checked, or checked and
 * failing, mean no online payment: a client must never be sent to a checkout
 * that cannot take their money.
 */
export const isOnlineActive = (a: PaymentAccountState | null | undefined): boolean =>
  !!a && !a.revokedAt && !!a.encryptedCredentials && a.status === "active" && a.lastHealthOk === true;

export interface VivaCredentials {
  /** Smart Checkout client id, e.g. "abc….apps.vivapayments.com". */
  clientId: string;
  clientSecret: string;
  /** 4-digit code of the payment source that holds the success/failure URLs. */
  sourceCode: string;
  /** Optional pair that lets Viva's webhook reach us (needed for its verification). */
  merchantId?: string;
  apiKey?: string;
}

export interface StripeCredentials {
  /** A restricted key (rk_) with Checkout Sessions write, or a secret key (sk_). */
  secretKey: string;
}

export type ProviderCredentials = VivaCredentials | StripeCredentials;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const last4 = (s: string) => s.slice(-4);

export function validateProviderCredentials(
  provider: PaymentProvider,
  fields: Record<string, string>,
  environment: "sandbox" | "production" | undefined,
): { credentials: ProviderCredentials; environment: "sandbox" | "production"; displayHint: string } {
  const f = Object.fromEntries(Object.entries(fields ?? {}).map(([k, val]) => [k, String(val ?? "").trim()]));

  if (provider === "stripe") {
    const key = f.secretKey ?? "";
    const m = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.exec(key);
    if (!m) throw new ValidationError("paste a Stripe secret key (sk_…) or restricted key (rk_…)");
    return {
      credentials: { secretKey: key },
      // The key itself says which mode it is. Trusting a dropdown over it is
      // how a live key ends up labelled "test".
      environment: m[2] === "live" ? "production" : "sandbox",
      displayHint: `${m[1]}_${m[2]}_…${last4(key)}`,
    };
  }

  if (provider === "viva") {
    if (!f.clientId || f.clientId.length > 200) throw new ValidationError("the Viva client ID is required");
    if (!f.clientSecret || f.clientSecret.length > 200) {
      throw new ValidationError("the Viva client secret is required");
    }
    if (!/^\d{4}$/.test(f.sourceCode ?? "")) {
      throw new ValidationError("the payment source code is the 4-digit code of your Viva payment source");
    }
    const hasMerchant = !!f.merchantId || !!f.apiKey;
    if (hasMerchant && (!UUID_RE.test(f.merchantId ?? "") || !f.apiKey)) {
      throw new ValidationError("for notifications enter both the Merchant ID and the API key, or neither");
    }
    if (environment !== "sandbox" && environment !== "production") {
      throw new ValidationError("choose demo or live");
    }
    return {
      credentials: {
        clientId: f.clientId,
        clientSecret: f.clientSecret,
        sourceCode: f.sourceCode,
        ...(hasMerchant ? { merchantId: f.merchantId, apiKey: f.apiKey } : {}),
      },
      environment,
      displayHint: `source ${f.sourceCode} · …${last4(f.clientId.split(".")[0] ?? f.clientId)}`,
    };
  }

  throw new ValidationError("unknown payment provider");
}

// ── What is owed ────────────────────────────────────────────────────────────

export interface Balance {
  due: Money;
  paid: Money;
  remaining: Money;
}

export function balanceOf(due: Money, paidMinor: number): Balance {
  const paid = Math.max(0, Math.round(paidMinor));
  return {
    due,
    paid: money(paid, due.currency),
    remaining: money(Math.max(0, due.amountMinor - paid), due.currency),
  };
}

export type PayKind = "deposit" | "full" | "balance";

export interface PayOption {
  kind: PayKind;
  amount: Money;
}

/** Smallest charge worth opening a checkout for: one euro. */
const MIN_CHARGE_MINOR = 100;

/**
 * The buttons a client gets. Nothing paid yet: the full amount, plus a deposit
 * when the agency asks for one. Something paid: only what is left.
 */
export function payOptions(balance: Balance, depositPercent: number | undefined): PayOption[] {
  const { due, paid, remaining } = balance;
  if (remaining.amountMinor < MIN_CHARGE_MINOR) return [];
  if (paid.amountMinor > 0) return [{ kind: "balance", amount: remaining }];

  const out: PayOption[] = [];
  const pct = depositPercent ?? 0;
  if (pct > 0 && pct < 100) {
    const deposit = Math.round((due.amountMinor * pct) / 100);
    if (deposit >= MIN_CHARGE_MINOR && deposit < due.amountMinor) {
      out.push({ kind: "deposit", amount: money(deposit, due.currency) });
    }
  }
  out.push({ kind: "full", amount: due });
  return out;
}

export function optionFor(kind: PayKind, options: PayOption[]): PayOption {
  const o = options.find((x) => x.kind === kind);
  if (!o) throw new ValidationError("this payment is not available any more, refresh the page");
  return o;
}

// ── Ledger ──────────────────────────────────────────────────────────────────

/**
 * Add a confirmed online payment to the agency's own ledger. Called once per
 * payment, on the transition to "paid", so a re-delivered webhook cannot count
 * the same money twice.
 */
export function applyOnlinePayment(f: Fulfilment, amountMinor: number, now: number): Fulfilment {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return f;
  const received = f.payment.received.amountMinor + amountMinor;
  return {
    ...f,
    payment: {
      ...f.payment,
      status: received >= f.payment.due.amountMinor ? "paid" : "deposit",
      received: money(received, f.payment.due.currency),
      updatedAt: now,
    },
  };
}

// ── Verification ────────────────────────────────────────────────────────────

/** What the provider told us when we asked about one checkout. */
export interface VerifiedPayment {
  state: "paid" | "pending" | "failed" | "expired";
  amountMinor?: number;
  currency?: string;
  transactionId?: string;
  /** The order this answer is about, to check it against our row. */
  orderId?: string;
  message?: string;
}

export interface PaymentRowState {
  status: "created" | "paid" | "failed" | "expired";
  amountMinor: number;
  currency: string;
  providerOrderId?: string;
}

export type Reconciled =
  | { change: "none" }
  | { change: "paid"; amountMinor: number; note?: string }
  | { change: "failed" | "expired"; message?: string };

/**
 * Decide what a provider answer does to our row. Paid is final: a later
 * "failed" or "expired" about the same order (a stale webhook, a retry) never
 * un-pays it. The amount recorded is what the provider CONFIRMED, not what we
 * asked for, because that is the money the agency actually has.
 */
export function reconcile(row: PaymentRowState, v: VerifiedPayment): Reconciled {
  if (row.status === "paid") return { change: "none" };
  if (v.orderId && row.providerOrderId && v.orderId !== row.providerOrderId) {
    // An answer about a different order (a tampered return URL). Ignore it.
    return { change: "none" };
  }
  if (v.state === "paid") {
    if (v.currency && v.currency.toUpperCase() !== row.currency.toUpperCase()) {
      return { change: "failed", message: `paid in ${v.currency}, expected ${row.currency}` };
    }
    const amountMinor = Number.isInteger(v.amountMinor) && v.amountMinor! > 0 ? v.amountMinor! : row.amountMinor;
    return {
      change: "paid",
      amountMinor,
      note: amountMinor !== row.amountMinor ? `asked ${row.amountMinor}, received ${amountMinor}` : undefined,
    };
  }
  if (v.state === "failed" || v.state === "expired") {
    // A failed attempt on a checkout the client can still retry is not final
    // for Stripe, but the row is: a new attempt opens a new checkout.
    if (row.status === "created") return { change: v.state, message: v.message };
  }
  return { change: "none" };
}
