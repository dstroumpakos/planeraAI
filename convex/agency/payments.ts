/**
 * Planera for Travel Agencies — client → agency payments (Convex adapter).
 *
 * See `clientPayments.ts` for the policy. In short: the money never touches
 * Planera. Option 1 prints the agency's bank details and payment link on the
 * quote. Option 2 opens a checkout on the agency's OWN Viva Wallet or Stripe
 * account, and only exists once those keys have passed a live check.
 *
 * Flows that touch a provider follow the module's usual three steps:
 * internal mutation (authorise, budget, hand over the sealed keys) → action
 * (decrypt, call the provider) → internal mutation (re-check, persist).
 *
 * Verification is the same function whoever asks — the client's return page,
 * a webhook, the scheduler or the agent — and it always asks the provider on
 * the agency's keys. A redirect or a webhook body only says "go and check".
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Money, TravelPackage } from "./model/types";
import { money } from "./model/types";
import {
  applyOnlinePayment,
  balanceOf,
  formatIban,
  hasManualInstructions,
  isOnlineActive,
  normalizePaymentSettings,
  optionFor,
  payOptions,
  reconcile,
  validateProviderCredentials,
  type PayKind,
  type PaymentProvider,
  type PaymentSettings,
  type ProviderCredentials,
  type StripeCredentials,
  type VerifiedPayment,
  type VivaCredentials,
} from "./clientPayments";
import {
  checkProviderKeys,
  PaymentProviderError,
  stripeCreateSession,
  stripeRetrieveSession,
  vivaCreateOrder,
  vivaRetrieveTransaction,
  vivaWebhookKey,
} from "./paymentProviders";
import type { Fulfilment, TravellerDetails } from "./fulfilment";
import { AgencyError, conflict, guard, invalid, notFound } from "./errors";
import { newToken, sha256Hex } from "./crypto";
import {
  assertTenant,
  audit,
  consumeLimit,
  quotePublicBaseUrl,
  requireAccess,
  requireAccessRW,
  vaultMasterKey,
} from "./store";
import { openJson, sealJson } from "./vault";

type Env = "sandbox" | "production";
type AnyCtx = QueryCtx | MutationCtx;

const providerArg = v.union(v.literal("viva"), v.literal("stripe"));
const kindArg = v.union(v.literal("deposit"), v.literal("full"), v.literal("balance"));

/** A checkout opened in the last half hour is reused instead of opening another. */
const REUSE_WINDOW_MS = 30 * 60_000;
/** After this a checkout nobody paid is closed on our side. */
const STALE_AFTER_MS = 25 * 60 * 60_000;

const returnUrl = () => `${quotePublicBaseUrl()}/q/paid`;
const siteUrl = () => (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");

const notifyRef = makeFunctionReference<
  "action",
  { agencyId: Id<"agencies">; quoteId: string; event: "paid"; amount?: string },
  null
>("agency/notify:quoteEvent");

function formatMoney(m: Money): string {
  return `${(m.amountMinor / 100).toFixed(2)} ${m.currency}`;
}

// ── Shared reads ────────────────────────────────────────────────────────────

async function liveAccounts(ctx: AnyCtx, agencyId: Id<"agencies">) {
  const rows = await ctx.db
    .query("agencyPaymentAccounts")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
    .collect();
  return rows.filter((r) => !r.revokedAt);
}

async function activeAccount(ctx: AnyCtx, agencyId: Id<"agencies">) {
  return (await liveAccounts(ctx, agencyId)).find((a) => isOnlineActive(a)) ?? null;
}

/** Money confirmed through online checkouts for this quote. */
export async function paidOnlineMinor(ctx: AnyCtx, quoteRowId: Id<"quotes">): Promise<number> {
  const rows = await ctx.db
    .query("agencyPayments")
    .withIndex("by_quoteRow", (q) => q.eq("quoteRowId", quoteRowId))
    .collect();
  return rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amountMinor, 0);
}

/**
 * What the client owes and has paid. Once the agent opened the booking record,
 * ITS ledger is the truth (it includes cash and transfers recorded by hand);
 * before that, the chosen option's price and whatever was paid online.
 */
async function balanceFor(ctx: AnyCtx, row: Doc<"quotes">) {
  const f = row.fulfilment as Fulfilment | undefined;
  if (f) return balanceOf(f.payment.due, f.payment.received.amountMinor);
  const pkg = ((row.packages ?? []) as TravelPackage[]).find((p) => p.tier === row.acceptedTier);
  if (!pkg) return null;
  return balanceOf(pkg.totals.internal.customerPrice, await paidOnlineMinor(ctx, row._id));
}

const settingsOf = (agency: Doc<"agencies">): PaymentSettings => (agency.payments ?? {}) as PaymentSettings;

function paymentOpen(row: Doc<"quotes">, settings: PaymentSettings): boolean {
  if (row.status !== "accepted" || !row.acceptedTier) return false;
  return settings.payWhen !== "on_request" || !!row.paymentRequestedAt;
}

export interface CustomerPaymentView {
  balance: { due: Money; paid: Money; remaining: Money };
  /** Present only when the agency's own Viva / Stripe account is connected and working. */
  online: null | { provider: PaymentProvider; sandbox: boolean; options: Array<{ kind: PayKind; amount: Money }> };
  manual: null | {
    beneficiary: string | null;
    bankName: string | null;
    iban: string | null;
    bic: string | null;
    paymentLinkUrl: string | null;
    instructions: string | null;
    /** What the client writes in the transfer's description. */
    reference: string;
  };
}

/**
 * The payment block of the client's quote page, or null when there is nothing
 * to pay yet or the agency has set up no way to pay.
 */
export async function loadCustomerPayment(
  ctx: AnyCtx,
  row: Doc<"quotes">,
  agency: Doc<"agencies">,
): Promise<CustomerPaymentView | null> {
  const settings = settingsOf(agency);
  if (!paymentOpen(row, settings)) return null;
  const balance = await balanceFor(ctx, row);
  if (!balance) return null;
  let account = await activeAccount(ctx, agency._id);
  // The Viva integration charges in euro only; any other quote currency gets
  // the bank details instead of a button that would fail.
  if (account?.provider === "viva" && balance.due.currency.toUpperCase() !== "EUR") account = null;
  const manual = hasManualInstructions(settings);
  if (!account && !manual) return null;

  return {
    balance,
    online: account
      ? {
          provider: account.provider,
          sandbox: account.environment === "sandbox",
          options: payOptions(balance, settings.depositPercent),
        }
      : null,
    manual: manual
      ? {
          beneficiary: settings.beneficiary ?? null,
          bankName: settings.bankName ?? null,
          iban: settings.iban ? formatIban(settings.iban) : null,
          bic: settings.bic ?? null,
          paymentLinkUrl: settings.paymentLinkUrl ?? null,
          instructions: settings.instructions ?? null,
          reference: row.clientReference ? `${row.quoteId} · ${row.clientReference}` : row.quoteId,
        }
      : null,
  };
}

// ── Settings (agent) ────────────────────────────────────────────────────────

function redactAccount(a: Doc<"agencyPaymentAccounts">) {
  return {
    _id: a._id,
    provider: a.provider,
    environment: a.environment,
    displayHint: a.displayHint ?? null,
    status: a.status,
    lastHealthCheckAt: a.lastHealthCheckAt ?? null,
    lastHealthOk: a.lastHealthOk ?? null,
    lastHealthMessage: a.lastHealthMessage ?? null,
    online: isOnlineActive(a),
    createdAt: a.createdAt,
  };
}

export const settings = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("payments.settings", async () => {
      const access = await requireAccess(ctx, args.token, "manager");
      const agency = await ctx.db.get(access.agencyId);
      if (!agency) throw notFound("agency");
      const accounts = await liveAccounts(ctx, access.agencyId);
      const site = siteUrl();
      return {
        settings: settingsOf(agency),
        accounts: accounts.map((a) => ({
          ...redactAccount(a),
          // Where the agency points its provider. Viva's success/failure URLs
          // live on the payment source, so the agency pastes them there.
          vivaWebhookUrl: a.provider === "viva" && site ? `${site}/agency/payments/viva/webhook?a=${a._id}` : null,
        })),
        returnUrl: returnUrl(),
        stripeWebhookUrl: site ? `${site}/agency/payments/stripe/webhook` : null,
      };
    }),
});

export const updateSettings = mutation({
  args: {
    token: v.string(),
    beneficiary: v.optional(v.string()),
    bankName: v.optional(v.string()),
    iban: v.optional(v.string()),
    bic: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    instructions: v.optional(v.string()),
    depositPercent: v.optional(v.float64()),
    payWhen: v.optional(v.union(v.literal("on_accept"), v.literal("on_request"))),
  },
  handler: async (ctx, args) =>
    guard("payments.updateSettings", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const { token: _t, ...input } = args;
      const clean = normalizePaymentSettings(input);
      // Strip undefined so the stored object is exactly what was set.
      const stored = Object.fromEntries(Object.entries(clean).filter(([, val]) => val !== undefined));
      await ctx.db.patch(access.agencyId, { payments: stored, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "payments.settings",
        meta: { hasIban: !!clean.iban, hasLink: !!clean.paymentLinkUrl, depositPercent: clean.depositPercent, payWhen: clean.payWhen },
      });
      return stored as PaymentSettings;
    }),
});

/**
 * Store the agency's payment keys. Saved but NOT live: online payment turns on
 * only after `checkAccount` proves the keys against the provider.
 */
export const connectAccount = mutation({
  args: {
    token: v.string(),
    provider: providerArg,
    environment: v.optional(v.union(v.literal("sandbox"), v.literal("production"))),
    fields: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) =>
    guard("payments.connectAccount", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      await consumeLimit(ctx, "connectionWrite", access.agencyId);
      const existing = await liveAccounts(ctx, access.agencyId);
      if (existing.length > 0) {
        throw conflict("a payment account is already connected, remove it first");
      }
      const valid = validateProviderCredentials(args.provider, args.fields, args.environment);
      const now = Date.now();
      const accountId = await ctx.db.insert("agencyPaymentAccounts", {
        agencyId: access.agencyId,
        provider: args.provider,
        environment: valid.environment,
        encryptedCredentials: await sealJson(vaultMasterKey(), valid.credentials),
        displayHint: valid.displayHint,
        status: "active",
        createdByUserId: access.userId,
        createdAt: now,
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "payments.connect",
        targetType: "paymentAccount",
        targetId: accountId,
        meta: { provider: args.provider, environment: valid.environment },
      });
      return { accountId };
    }),
});

/** Revoke: the ciphertext is destroyed, online payment stops at once. */
export const removeAccount = mutation({
  args: { token: v.string(), accountId: v.id("agencyPaymentAccounts") },
  handler: async (ctx, args) =>
    guard("payments.removeAccount", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.accountId);
      assertTenant(access, row);
      await ctx.db.patch(args.accountId, {
        status: "disabled",
        revokedAt: Date.now(),
        updatedAt: Date.now(),
        encryptedCredentials: "",
        displayHint: undefined,
      });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "payments.remove",
        targetType: "paymentAccount",
        targetId: args.accountId,
        meta: { provider: row!.provider },
      });
      return { ok: true };
    }),
});

interface AccountCheckContext {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  provider: PaymentProvider;
  environment: Env;
  encryptedCredentials: string;
}

export const _beginAccountCheck = internalMutation({
  args: { token: v.string(), accountId: v.id("agencyPaymentAccounts") },
  handler: async (ctx, args): Promise<AccountCheckContext> =>
    guard("payments.beginAccountCheck", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      await consumeLimit(ctx, "healthCheck", access.agencyId);
      const row = await ctx.db.get(args.accountId);
      assertTenant(access, row);
      if (row!.revokedAt || !row!.encryptedCredentials) throw notFound("payment account");
      return {
        agencyId: access.agencyId,
        userId: access.userId,
        provider: row!.provider,
        environment: row!.environment,
        encryptedCredentials: row!.encryptedCredentials,
      };
    }),
});

export const _recordAccountCheck = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    actorUserId: v.id("agencyUsers"),
    accountId: v.id("agencyPaymentAccounts"),
    ok: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("payments.recordAccountCheck", async () => {
      const row = await ctx.db.get(args.accountId);
      if (!row || row.agencyId !== args.agencyId || row.revokedAt) throw notFound("payment account");
      await ctx.db.patch(args.accountId, {
        lastHealthCheckAt: Date.now(),
        lastHealthOk: args.ok,
        lastHealthMessage: args.message?.slice(0, 300),
        // Failing keys switch online payment off until they pass again.
        status: args.ok ? "active" : "error",
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        agencyId: args.agencyId,
        actorUserId: args.actorUserId,
        action: "payments.check",
        targetType: "paymentAccount",
        targetId: args.accountId,
        meta: { ok: args.ok, message: args.message },
      });
      return null;
    }),
});

const beginAccountCheckRef = makeFunctionReference<
  "mutation",
  { token: string; accountId: Id<"agencyPaymentAccounts"> },
  AccountCheckContext
>("agency/payments:_beginAccountCheck");

const recordAccountCheckRef = makeFunctionReference<
  "mutation",
  {
    agencyId: Id<"agencies">;
    actorUserId: Id<"agencyUsers">;
    accountId: Id<"agencyPaymentAccounts">;
    ok: boolean;
    message?: string;
  },
  null
>("agency/payments:_recordAccountCheck");

/** Prove the keys against the provider. Passing is what turns online payment on. */
export const checkAccount = action({
  args: { token: v.string(), accountId: v.id("agencyPaymentAccounts") },
  handler: async (ctx, args): Promise<{ ok: boolean; message?: string }> =>
    guard("payments.checkAccount", async () => {
      const c = await ctx.runMutation(beginAccountCheckRef, args);
      let ok = false;
      let message: string | undefined;
      try {
        const creds = await openJson<ProviderCredentials>(vaultMasterKey(), c.encryptedCredentials);
        const res = await checkProviderKeys(c.provider, creds, c.environment, fetch, { returnUrl: returnUrl() });
        ok = res.ok;
        message = res.message;
      } catch (e) {
        message = String((e as Error)?.message ?? "the provider could not be reached").slice(0, 300);
      }
      await ctx.runMutation(recordAccountCheckRef, {
        agencyId: c.agencyId,
        actorUserId: c.userId,
        accountId: args.accountId,
        ok,
        message,
      });
      return { ok, message };
    }),
});

// ── Per quote (agent) ───────────────────────────────────────────────────────

/** Open payment on the client's link, for agencies that ask after checking availability. */
export const requestPayment = mutation({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("payments.requestPayment", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      if (row!.status !== "accepted") throw invalid("the client has not chosen an option yet");
      await ctx.db.patch(row!._id, { paymentRequestedAt: Date.now(), updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "payments.request",
        targetType: "quote",
        targetId: row!.quoteId,
      });
      return {
        ok: true,
        linkActive: !!row!.customerLinkTokenHash && (row!.customerLinkExpiresAt ?? 0) > Date.now(),
      };
    }),
});

export const listForQuote = query({
  args: { token: v.string(), quoteId: v.string() },
  handler: async (ctx, args) =>
    guard("payments.listForQuote", async () => {
      const access = await requireAccess(ctx, args.token);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
        .unique();
      assertTenant(access, row);
      const agency = await ctx.db.get(access.agencyId);
      const settings = agency ? settingsOf(agency) : {};
      const account = await activeAccount(ctx, access.agencyId);
      const rows = await ctx.db
        .query("agencyPayments")
        .withIndex("by_quoteRow", (q) => q.eq("quoteRowId", row!._id))
        .order("desc")
        .take(50);
      return {
        payWhen: settings.payWhen ?? "on_accept",
        paymentRequestedAt: row!.paymentRequestedAt ?? null,
        onlineProvider: account?.provider ?? null,
        hasManualInstructions: hasManualInstructions(settings),
        payments: rows.map((p) => ({
          _id: p._id,
          provider: p.provider,
          environment: p.environment,
          kind: p.kind,
          amount: money(p.amountMinor, p.currency),
          status: p.status,
          providerOrderId: p.providerOrderId ?? null,
          providerTransactionId: p.providerTransactionId ?? null,
          error: p.error ?? null,
          createdAt: p.createdAt,
          paidAt: p.paidAt ?? null,
          lastCheckedAt: p.lastCheckedAt ?? null,
        })),
      };
    }),
});

// ── Checkout (public: the link token is the credential) ─────────────────────

interface CheckoutContext {
  reuseUrl?: string;
  paymentId?: Id<"agencyPayments">;
  publicId?: string;
  provider?: PaymentProvider;
  environment?: Env;
  encryptedCredentials?: string;
  amountMinor?: number;
  currency?: string;
  description?: string;
  quoteId?: string;
  email?: string;
  fullName?: string;
  lang?: "el" | "en";
}

const TIER_LABEL: Record<string, string> = { basic: "Basic", comfort: "Comfort", premium: "Premium" };
const KIND_LABEL: Record<PayKind, string> = { deposit: "Προκαταβολή", full: "Πληρωμή", balance: "Εξόφληση" };

export const _beginCheckout = internalMutation({
  args: { linkToken: v.string(), kind: kindArg },
  handler: async (ctx, args): Promise<CheckoutContext> =>
    guard("payments.beginCheckout", async () => {
      await consumeLimit(ctx, "payCheckout", args.linkToken.slice(0, 8));
      const hash = await sha256Hex(args.linkToken);
      const row = await ctx.db
        .query("quotes")
        .withIndex("by_customerLinkTokenHash", (q) => q.eq("customerLinkTokenHash", hash))
        .unique();
      if (!row || !row.customerLinkExpiresAt || row.customerLinkExpiresAt <= Date.now()) {
        throw notFound("quote");
      }
      const agency = await ctx.db.get(row.agencyId);
      if (!agency || agency.status !== "active") throw notFound("quote");
      const settings = settingsOf(agency);
      if (!paymentOpen(row, settings)) throw invalid("payment is not open for this quote yet");

      const account = await activeAccount(ctx, agency._id);
      if (!account) throw invalid("online payment is not available, use the bank details on the page");

      const balance = await balanceFor(ctx, row);
      if (!balance) throw invalid("nothing to pay on this quote");
      const option = optionFor(args.kind, payOptions(balance, settings.depositPercent));

      // A client who clicked "pay", went back and clicked again gets the same
      // checkout, not a second one they might also pay.
      const now = Date.now();
      const recent = await ctx.db
        .query("agencyPayments")
        .withIndex("by_quoteRow", (q) => q.eq("quoteRowId", row._id))
        .order("desc")
        .take(10);
      const reusable = recent.find(
        (p) =>
          p.status === "created" &&
          p.accountId === account._id &&
          p.kind === option.kind &&
          p.amountMinor === option.amount.amountMinor &&
          p.checkoutUrl &&
          now - p.createdAt < REUSE_WINDOW_MS,
      );
      if (reusable) return { reuseUrl: reusable.checkoutUrl!, publicId: reusable.publicId };

      const publicId = newToken().slice(0, 32);
      const paymentId = await ctx.db.insert("agencyPayments", {
        agencyId: agency._id,
        quoteRowId: row._id,
        quoteId: row.quoteId,
        accountId: account._id,
        provider: account.provider,
        environment: account.environment,
        kind: option.kind,
        amountMinor: option.amount.amountMinor,
        currency: option.amount.currency,
        status: "created",
        publicId,
        createdAt: now,
      });

      const params = (row.searchParams ?? {}) as { originIata?: string; destinationIata?: string };
      const travellers = row.travellers as TravellerDetails | undefined;
      const lead = travellers?.travellers?.[0];
      const agencyName = agency.branding?.legalName ?? agency.name;
      return {
        paymentId,
        publicId,
        provider: account.provider,
        environment: account.environment,
        encryptedCredentials: account.encryptedCredentials,
        amountMinor: option.amount.amountMinor,
        currency: option.amount.currency,
        quoteId: row.quoteId,
        description: `${agencyName} · ${params.originIata ?? ""} → ${params.destinationIata ?? ""} · ${
          TIER_LABEL[row.acceptedTier ?? ""] ?? ""
        } · ${KIND_LABEL[option.kind]}`,
        email: travellers?.contact?.email,
        fullName: lead ? `${lead.givenName} ${lead.familyName}` : row.clientName,
        lang: /^(greek|el|ελλην)/i.test(agency.branding?.quoteLanguage ?? "Greek") ? "el" : "en",
      };
    }),
});

export const _attachCheckout = internalMutation({
  args: {
    paymentId: v.id("agencyPayments"),
    providerOrderId: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("payments.attachCheckout", async () => {
      const row = await ctx.db.get(args.paymentId);
      if (!row) return null;
      if (args.error) {
        await ctx.db.patch(args.paymentId, { status: "failed", error: args.error.slice(0, 300), updatedAt: Date.now() });
        return null;
      }
      await ctx.db.patch(args.paymentId, {
        providerOrderId: args.providerOrderId,
        checkoutUrl: args.checkoutUrl,
        updatedAt: Date.now(),
      });
      // Catch the client who paid and closed the tab before coming back:
      // re-ask the provider later. Viva can only be asked once we hold a
      // transaction id, so for it this mostly closes stale checkouts.
      await ctx.scheduler.runAfter(40 * 60_000, autoCheckRef, { paymentId: args.paymentId });
      await ctx.scheduler.runAfter(STALE_AFTER_MS + 60_000, autoCheckRef, { paymentId: args.paymentId });
      return null;
    }),
});

const beginCheckoutRef = makeFunctionReference<
  "mutation",
  { linkToken: string; kind: PayKind },
  CheckoutContext
>("agency/payments:_beginCheckout");

const attachCheckoutRef = makeFunctionReference<
  "mutation",
  { paymentId: Id<"agencyPayments">; providerOrderId?: string; checkoutUrl?: string; error?: string },
  null
>("agency/payments:_attachCheckout");

const autoCheckRef = makeFunctionReference<"action", { paymentId: Id<"agencyPayments"> }, null>(
  "agency/payments:_autoCheck",
);

/** The client pressing "pay". Returns the provider's checkout URL to redirect to. */
export const startCheckout = action({
  args: { linkToken: v.string(), kind: kindArg },
  handler: async (ctx, args): Promise<{ checkoutUrl: string; publicId: string }> =>
    guard("payments.startCheckout", async () => {
      if (!args.linkToken || args.linkToken.length < 16 || args.linkToken.length > 200) {
        throw notFound("quote");
      }
      const c = await ctx.runMutation(beginCheckoutRef, args);
      if (c.reuseUrl) return { checkoutUrl: c.reuseUrl, publicId: c.publicId! };

      const back = `${returnUrl()}?p=${c.publicId}`;
      try {
        const creds = await openJson<ProviderCredentials>(vaultMasterKey(), c.encryptedCredentials!);
        const input = {
          amountMinor: c.amountMinor!,
          currency: c.currency!,
          description: c.description!,
          merchantReference: c.quoteId!,
          email: c.email,
          fullName: c.fullName,
          publicId: c.publicId!,
          successUrl: `${back}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${back}&cancelled=1`,
          lang: c.lang ?? "el",
        };
        const created =
          c.provider === "viva"
            ? await vivaCreateOrder(creds as VivaCredentials, c.environment!, input)
            : await stripeCreateSession(creds as StripeCredentials, input);
        await ctx.runMutation(attachCheckoutRef, {
          paymentId: c.paymentId!,
          providerOrderId: created.orderId,
          checkoutUrl: created.checkoutUrl,
        });
        return { checkoutUrl: created.checkoutUrl, publicId: c.publicId! };
      } catch (e) {
        const message = e instanceof PaymentProviderError ? e.message : "the payment page could not be opened";
        await ctx.runMutation(attachCheckoutRef, { paymentId: c.paymentId!, error: message });
        throw new AgencyError(
          "connector_unavailable",
          "Η πληρωμή δεν μπορεί να ανοίξει αυτή τη στιγμή. Δοκιμάστε ξανά ή χρησιμοποιήστε τα στοιχεία τράπεζας.",
        );
      }
    }),
});

// ── Verification (one path for everyone) ────────────────────────────────────

interface VerifyContext {
  paymentId: Id<"agencyPayments">;
  provider: PaymentProvider;
  environment: Env;
  encryptedCredentials: string;
  status: Doc<"agencyPayments">["status"];
  providerOrderId: string | null;
  providerTransactionId: string | null;
  createdAt: number;
}

/** Find the payment by whichever handle the caller holds. */
export const _beginVerify = internalMutation({
  args: {
    paymentId: v.optional(v.id("agencyPayments")),
    publicId: v.optional(v.string()),
    provider: v.optional(providerArg),
    orderId: v.optional(v.string()),
    /** Set for unauthenticated callers (return page, webhooks). */
    throttleKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<VerifyContext | null> =>
    guard("payments.beginVerify", async () => {
      if (args.throttleKey) await consumeLimit(ctx, "payVerify", args.throttleKey.slice(0, 16));
      let row: Doc<"agencyPayments"> | null = null;
      if (args.paymentId) row = await ctx.db.get(args.paymentId);
      else if (args.publicId) {
        row = await ctx.db
          .query("agencyPayments")
          .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId!))
          .unique();
      } else if (args.provider && args.orderId) {
        row = await ctx.db
          .query("agencyPayments")
          .withIndex("by_provider_order", (q) => q.eq("provider", args.provider!).eq("providerOrderId", args.orderId!))
          .first();
      }
      if (!row) return null;
      const account = await ctx.db.get(row.accountId);
      // A removed account means its keys are gone: nothing left to ask with.
      if (!account || account.revokedAt || !account.encryptedCredentials) return null;
      return {
        paymentId: row._id,
        provider: row.provider,
        environment: row.environment,
        encryptedCredentials: account.encryptedCredentials,
        status: row.status,
        providerOrderId: row.providerOrderId ?? null,
        providerTransactionId: row.providerTransactionId ?? null,
        createdAt: row.createdAt,
      };
    }),
});

export const _recordVerification = internalMutation({
  args: {
    paymentId: v.id("agencyPayments"),
    state: v.union(v.literal("paid"), v.literal("pending"), v.literal("failed"), v.literal("expired")),
    amountMinor: v.optional(v.float64()),
    currency: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("payments.recordVerification", async () => {
      const row = await ctx.db.get(args.paymentId);
      if (!row) return null;
      const now = Date.now();
      const r = reconcile(
        { status: row.status, amountMinor: row.amountMinor, currency: row.currency, providerOrderId: row.providerOrderId },
        {
          state: args.state,
          amountMinor: args.amountMinor,
          currency: args.currency,
          transactionId: args.transactionId,
          orderId: args.orderId,
          message: args.message,
        },
      );

      if (r.change === "paid") {
        await ctx.db.patch(row._id, {
          status: "paid",
          amountMinor: r.amountMinor,
          paidAt: now,
          providerTransactionId: args.transactionId ?? row.providerTransactionId,
          error: r.note,
          lastCheckedAt: now,
          updatedAt: now,
        });
        // Into the agency's ledger, if the booking record is open. If not,
        // `startFulfilment` picks the paid rows up when it opens.
        const quote = await ctx.db.get(row.quoteRowId);
        if (quote?.fulfilment) {
          await ctx.db.patch(quote._id, {
            fulfilment: applyOnlinePayment(quote.fulfilment as Fulfilment, r.amountMinor, now),
            updatedAt: now,
          });
        }
        await audit(ctx, {
          agencyId: row.agencyId,
          action: "payments.paid",
          targetType: "quote",
          targetId: row.quoteId,
          meta: { provider: row.provider, kind: row.kind, amountMinor: r.amountMinor, currency: row.currency },
        });
        await ctx.scheduler.runAfter(0, notifyRef, {
          agencyId: row.agencyId,
          quoteId: row.quoteId,
          event: "paid",
          amount: formatMoney(money(r.amountMinor, row.currency)),
        });
        return { status: "paid" as const, amount: money(r.amountMinor, row.currency) };
      }

      if (r.change === "failed" || r.change === "expired") {
        await ctx.db.patch(row._id, {
          status: r.change,
          error: r.message?.slice(0, 300),
          lastCheckedAt: now,
          updatedAt: now,
        });
        return { status: r.change, amount: money(row.amountMinor, row.currency) };
      }

      // Nobody paid it and it is a day old: close it on our side, so the agent
      // is not left looking at a "waiting" row forever.
      const stale = row.status === "created" && now - row.createdAt > STALE_AFTER_MS;
      await ctx.db.patch(row._id, {
        ...(stale ? { status: "expired" as const } : {}),
        providerTransactionId: row.providerTransactionId ?? args.transactionId,
        lastCheckedAt: now,
        updatedAt: now,
      });
      return { status: stale ? ("expired" as const) : row.status, amount: money(row.amountMinor, row.currency) };
    }),
});

const beginVerifyRef = makeFunctionReference<
  "mutation",
  {
    paymentId?: Id<"agencyPayments">;
    publicId?: string;
    provider?: PaymentProvider;
    orderId?: string;
    throttleKey?: string;
  },
  VerifyContext | null
>("agency/payments:_beginVerify");

const recordVerificationRef = makeFunctionReference<
  "mutation",
  {
    paymentId: Id<"agencyPayments">;
    state: VerifiedPayment["state"];
    amountMinor?: number;
    currency?: string;
    transactionId?: string;
    orderId?: string;
    message?: string;
  },
  { status: Doc<"agencyPayments">["status"]; amount: Money } | null
>("agency/payments:_recordVerification");

/**
 * Ask the provider about one payment and record the answer. `transactionId` is
 * a hint from a Viva redirect or webhook; it is only believed after Viva itself
 * confirms that transaction belongs to this payment's order.
 */
async function verifyPayment(
  ctx: ActionCtx,
  lookup: {
    paymentId?: Id<"agencyPayments">;
    publicId?: string;
    provider?: PaymentProvider;
    orderId?: string;
    throttleKey?: string;
  },
  transactionIdHint?: string,
): Promise<{ status: Doc<"agencyPayments">["status"]; amount: Money } | null> {
  const c = await ctx.runMutation(beginVerifyRef, lookup);
  if (!c) return null;

  let verified: VerifiedPayment = { state: "pending" };
  if (c.status !== "paid") {
    try {
      const creds = await openJson<ProviderCredentials>(vaultMasterKey(), c.encryptedCredentials);
      if (c.provider === "stripe" && c.providerOrderId) {
        verified = await stripeRetrieveSession(creds as StripeCredentials, c.providerOrderId);
      } else if (c.provider === "viva") {
        const tx = c.providerTransactionId ?? transactionIdHint;
        if (tx) verified = await vivaRetrieveTransaction(creds as VivaCredentials, c.environment, tx);
      }
    } catch (e) {
      // A failed lookup is not a failed payment. Leave it pending; the next
      // check (scheduler, webhook, agent) asks again.
      console.error("[agency:payments.verify]", (e as Error)?.message);
      verified = { state: "pending" };
    }
  }
  return await ctx.runMutation(recordVerificationRef, {
    paymentId: c.paymentId,
    state: verified.state,
    amountMinor: verified.amountMinor,
    currency: verified.currency,
    transactionId: verified.transactionId,
    orderId: verified.orderId,
    message: verified.message,
  });
}

/**
 * The client landing back on Planera after the provider's page. Stripe sends
 * `?p=` (ours) and `session_id`; Viva sends its own `s` (order) and `t`
 * (transaction) to the success URL on the agency's payment source.
 */
export const confirmReturn = action({
  args: {
    p: v.optional(v.string()),
    s: v.optional(v.string()),
    t: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: "paid" | "pending" | "failed" | "expired"; amount: Money } | null> =>
    guard("payments.confirmReturn", async () => {
      const p = args.p && /^[A-Za-z0-9_-]{16,64}$/.test(args.p) ? args.p : undefined;
      const s = args.s && /^\d{10,20}$/.test(args.s) ? args.s : undefined;
      const t = args.t && /^[0-9a-f-]{36}$/i.test(args.t) ? args.t : undefined;
      if (!p && !s) return null;
      const res = await verifyPayment(
        ctx,
        p ? { publicId: p, throttleKey: p } : { provider: "viva", orderId: s, throttleKey: s },
        t,
      );
      if (!res) return null;
      return { status: res.status === "created" ? "pending" : res.status, amount: res.amount };
    }),
});

/** The agent pressing "check again" on a payment in the booking panel. */
export const _authorizeRecheck = internalMutation({
  args: { token: v.string(), paymentId: v.id("agencyPayments") },
  handler: async (ctx, args) =>
    guard("payments.authorizeRecheck", async () => {
      const access = await requireAccessRW(ctx, args.token, "agent");
      await consumeLimit(ctx, "payVerify", access.agencyId);
      const row = await ctx.db.get(args.paymentId);
      assertTenant(access, row);
      return null;
    }),
});

const authorizeRecheckRef = makeFunctionReference<
  "mutation",
  { token: string; paymentId: Id<"agencyPayments"> },
  null
>("agency/payments:_authorizeRecheck");

export const recheck = action({
  args: { token: v.string(), paymentId: v.id("agencyPayments") },
  handler: async (ctx, args): Promise<{ status: string } | null> =>
    guard("payments.recheck", async () => {
      await ctx.runMutation(authorizeRecheckRef, args);
      const res = await verifyPayment(ctx, { paymentId: args.paymentId });
      return res ? { status: res.status } : null;
    }),
});

export const _autoCheck = internalAction({
  args: { paymentId: v.id("agencyPayments") },
  handler: async (ctx, args): Promise<null> => {
    try {
      await verifyPayment(ctx, { paymentId: args.paymentId });
    } catch (e) {
      console.error("[agency:payments.autoCheck]", (e as Error)?.message);
    }
    return null;
  },
});

// ── Webhooks (from http.ts) ─────────────────────────────────────────────────

/** A provider said something happened to an order. Go and check. */
export const _webhookVerify = internalAction({
  args: { provider: providerArg, orderId: v.string(), transactionId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    try {
      await verifyPayment(
        ctx,
        { provider: args.provider, orderId: args.orderId, throttleKey: `wh:${args.orderId}` },
        args.transactionId,
      );
    } catch (e) {
      console.error("[agency:payments.webhook]", (e as Error)?.message);
    }
    return null;
  },
});

export const _vivaAccountKeys = internalMutation({
  args: { accountId: v.string() },
  handler: async (ctx, args) =>
    guard("payments.vivaAccountKeys", async () => {
      await consumeLimit(ctx, "payVerify", `vivakey:${args.accountId}`);
      const id = ctx.db.normalizeId("agencyPaymentAccounts", args.accountId);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.revokedAt || row.provider !== "viva" || !row.encryptedCredentials) return null;
      return { environment: row.environment, encryptedCredentials: row.encryptedCredentials };
    }),
});

const vivaAccountKeysRef = makeFunctionReference<
  "mutation",
  { accountId: string },
  { environment: Env; encryptedCredentials: string } | null
>("agency/payments:_vivaAccountKeys");

/** Viva's GET verification of the webhook URL: echo the account's key. */
export const _vivaWebhookKey = internalAction({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const a = await ctx.runMutation(vivaAccountKeysRef, args);
      if (!a) return null;
      const creds = await openJson<VivaCredentials>(vaultMasterKey(), a.encryptedCredentials);
      return await vivaWebhookKey(creds, a.environment);
    } catch (e) {
      console.error("[agency:payments.vivaWebhookKey]", (e as Error)?.message);
      return null;
    }
  },
});
