/**
 * Database half of supplier listing billing (see `partnerBilling.ts` for the
 * Stripe half). Split the same way as `stripeBilling` / `stripeBillingDb`:
 * actions talk to Stripe, these functions own every read and write.
 */

import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./partnerApiAuth";
import { assertAdmin } from "./admin";
import { partnerListingActive } from "./lib/partnerListingAccess";
import { vatExemptionNote, vatRateFor } from "./lib/partnerVat";

export const BILLING_DETAILS = v.object({
  legalName: v.string(),
  vatNumber: v.string(),
  taxOffice: v.optional(v.string()),
  profession: v.optional(v.string()),
  address: v.string(),
  city: v.string(),
  postalCode: v.string(),
  country: v.string(),
  phone: v.optional(v.string()),
  invoiceEmail: v.optional(v.string()),
  viesValid: v.optional(v.boolean()),
  updatedAt: v.float64(),
});

/** Resolve an active partner account from a portal session token. */
async function accountFromToken(ctx: any, token: string) {
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db
    .query("partnerAccountSessions")
    .withIndex("by_tokenHash", (q: any) => q.eq("tokenHash", tokenHash))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  const account = await ctx.db.get(session.accountId);
  if (!account || account.status !== "active") return null;
  return account;
}

async function requireAdmin(ctx: any, token: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new ConvexError("Unauthorized.");
  await assertAdmin(ctx, session.userId);
}

/** Move every draft of an account into the review queue. */
export async function promoteDrafts(ctx: any, accountId: any): Promise<number> {
  const products = await ctx.db
    .query("partnerProducts")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId))
    .collect();
  const now = Date.now();
  let n = 0;
  for (const p of products) {
    if (p.status !== "draft") continue;
    await ctx.db.patch(p._id, { status: "pending", updatedAt: now });
    n++;
  }
  return n;
}

const athensDay = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString("el-GR", { timeZone: "Europe/Athens" }) : "—";

/** The line text for the τιμολόγιο, shared by the admin card and the email. */
export function invoiceDescription(periodStart?: number | null, periodEnd?: number | null): string {
  return `Συνδρομή προβολής πακέτων στην εφαρμογή Planera, περίοδος ${athensDay(periodStart)} – ${athensDay(periodEnd)}`;
}

function invoiceView(r: any) {
  return {
    description: invoiceDescription(r.periodStart, r.periodEnd),
    id: r._id,
    accountId: r.accountId,
    partnerName: r.partnerName,
    email: r.email,
    stripeInvoiceId: r.stripeInvoiceId,
    stripeInvoiceNumber: r.stripeInvoiceNumber ?? null,
    hostedInvoiceUrl: r.hostedInvoiceUrl ?? null,
    currency: r.currency,
    netMinor: r.netMinor,
    vatMinor: r.vatMinor,
    totalMinor: r.totalMinor,
    vatRatePct: r.vatRatePct,
    vatNote: r.vatNote ?? null,
    periodStart: r.periodStart ?? null,
    periodEnd: r.periodEnd ?? null,
    paidAt: r.paidAt,
    billing: r.billing ?? null,
    issuedAt: r.issuedAt ?? null,
    invoiceNumber: r.invoiceNumber ?? null,
  };
}

// ─────────────────────────────── internal ───────────────────────────────────

/** Session → the account fields the billing actions need. */
export const accountForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const a = await accountFromToken(ctx, args.token);
    if (!a) return null;
    return {
      accountId: a._id,
      email: a.email,
      partnerName: a.partnerName,
      kind: a.kind ?? "api",
      billingRequired: !!a.billingRequired,
      listingActive: partnerListingActive(a),
      billingDetails: a.billingDetails ?? null,
      stripeCustomerId: a.stripeCustomerId ?? null,
      stripeSubscriptionId: a.stripeSubscriptionId ?? null,
      subscriptionStatus: a.subscriptionStatus ?? null,
    };
  },
});

export const accountIdByStripeCustomer = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    const a = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .first();
    return a?._id ?? null;
  },
});

export const writeBillingDetails = internalMutation({
  args: { accountId: v.id("partnerAccounts"), details: BILLING_DETAILS },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { billingDetails: args.details });
    return null;
  },
});

export const linkStripeCustomer = internalMutation({
  args: { accountId: v.id("partnerAccounts"), stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { stripeCustomerId: args.stripeCustomerId });
    return null;
  },
});

/**
 * Write a subscription's state onto the account. When the account goes from
 * "can't list" to "can list", its drafts enter the review queue.
 *
 * An event for an OLDER subscription (the supplier cancelled, then started a
 * new one) must not overwrite the current one, so a different subscription id
 * only replaces the stored one when it is itself entitling.
 */
export const applyPartnerSubscription = internalMutation({
  args: {
    accountId: v.id("partnerAccounts"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.string(),
    periodEnd: v.optional(v.float64()),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return { action: "no_account", promoted: 0 };

    const before = partnerListingActive(account);
    const patch = {
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      subscriptionStatus: args.status,
      subscriptionPeriodEnd: args.periodEnd,
      subscriptionCancelAtPeriodEnd: args.cancelAtPeriodEnd,
    };
    if (
      account.stripeSubscriptionId &&
      account.stripeSubscriptionId !== args.stripeSubscriptionId &&
      !partnerListingActive({ ...account, ...patch, billingRequired: true })
    ) {
      return { action: "stale_subscription", promoted: 0 };
    }

    await ctx.db.patch(args.accountId, patch);
    const after = partnerListingActive({ ...account, ...patch });
    const promoted = !before && after ? await promoteDrafts(ctx, args.accountId) : 0;
    return { action: after ? "active" : "inactive", promoted };
  },
});

/**
 * Record one paid Stripe invoice (idempotent by invoice id) and email the
 * operator everything needed to issue the Τιμολόγιο Παροχής Υπηρεσιών.
 */
export const recordInvoice = internalMutation({
  args: {
    accountId: v.id("partnerAccounts"),
    stripeInvoiceId: v.string(),
    stripeInvoiceNumber: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    hostedInvoiceUrl: v.optional(v.string()),
    billingReason: v.optional(v.string()),
    currency: v.string(),
    netMinor: v.float64(),
    vatMinor: v.float64(),
    totalMinor: v.float64(),
    periodStart: v.optional(v.float64()),
    periodEnd: v.optional(v.float64()),
    paidAt: v.float64(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("partnerInvoices")
      .withIndex("by_stripeInvoiceId", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
      .first();
    if (existing) return { action: "duplicate" };

    const account = await ctx.db.get(args.accountId);
    if (!account) return { action: "no_account" };
    const country = account.billingDetails?.country ?? "GR";

    const { billingReason, ...row } = args;
    const id = await ctx.db.insert("partnerInvoices", {
      ...row,
      partnerName: account.partnerName,
      email: account.email,
      // The rate actually charged, derived from the amounts Stripe collected
      // rather than from today's rule.
      vatRatePct:
        args.netMinor > 0 ? Math.round((args.vatMinor / args.netMinor) * 100) : vatRateFor(country),
      vatNote: args.vatMinor === 0 ? vatExemptionNote(country) : undefined,
      billing: account.billingDetails ?? null,
    });

    await ctx.scheduler.runAfter(0, internal.partnerBilling.sendInvoiceAlert, {
      invoiceId: id,
      firstPayment: billingReason === "subscription_create",
    });
    return { action: "recorded" };
  },
});

export const getInvoice = internalQuery({
  args: { invoiceId: v.id("partnerInvoices") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.invoiceId);
    return r ? invoiceView(r) : null;
  },
});

// ─────────────────────────────── supplier ───────────────────────────────────

/** Billing page data for the signed-in supplier. */
export const getMyBilling = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const a = await accountFromToken(ctx, args.token);
    if (!a) return null;
    const invoices = await ctx.db
      .query("partnerInvoices")
      .withIndex("by_account_paid", (q) => q.eq("accountId", a._id))
      .order("desc")
      .take(24);
    const drafts = (
      await ctx.db
        .query("partnerProducts")
        .withIndex("by_account", (q) => q.eq("accountId", a._id))
        .collect()
    ).filter((p) => p.status === "draft").length;
    return {
      partnerName: a.partnerName,
      email: a.email,
      required: !!a.billingRequired,
      active: partnerListingActive(a),
      status: a.subscriptionStatus ?? null,
      periodEnd: a.subscriptionPeriodEnd ?? null,
      cancelAtPeriodEnd: a.subscriptionCancelAtPeriodEnd ?? false,
      hasStripeCustomer: !!a.stripeCustomerId,
      details: a.billingDetails ?? null,
      drafts,
      invoices: invoices.map((r) => ({
        id: r._id,
        paidAt: r.paidAt,
        currency: r.currency,
        netMinor: r.netMinor,
        vatMinor: r.vatMinor,
        totalMinor: r.totalMinor,
        periodStart: r.periodStart ?? null,
        periodEnd: r.periodEnd ?? null,
        invoiceNumber: r.invoiceNumber ?? null,
        issued: !!r.issuedAt,
      })),
    };
  },
});

// ──────────────────────────────── admin ─────────────────────────────────────

/** Paid supplier invoices, oldest un-issued first, then recent issued ones. */
export const adminListInvoices = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("partnerInvoices").withIndex("by_paid").order("desc").take(300);
    const toIssue = rows.filter((r) => !r.issuedAt).reverse();
    const issued = rows.filter((r) => r.issuedAt).slice(0, 50);
    return { toIssue: toIssue.map(invoiceView), issued: issued.map(invoiceView) };
  },
});

export const adminMarkInvoiceIssued = mutation({
  args: {
    token: v.string(),
    invoiceId: v.id("partnerInvoices"),
    invoiceNumber: v.optional(v.string()),
    issued: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.invoiceId);
    if (!row) throw new ConvexError("Invoice not found.");
    await ctx.db.patch(args.invoiceId, {
      issuedAt: args.issued ? Date.now() : undefined,
      invoiceNumber: args.issued ? args.invoiceNumber?.trim() || undefined : undefined,
    });
    return { ok: true as const };
  },
});

/** Every supplier account with its billing state, for the admin overview. */
export const adminListSupplierBilling = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const accounts = await ctx.db.query("partnerAccounts").take(1000);
    return accounts
      .filter((a) => a.kind === "supplier" && a.status !== "invited")
      .map((a) => ({
        accountId: a._id,
        partnerName: a.partnerName,
        email: a.email,
        status: a.status,
        required: !!a.billingRequired,
        active: partnerListingActive(a),
        subscriptionStatus: a.subscriptionStatus ?? null,
        periodEnd: a.subscriptionPeriodEnd ?? null,
        cancelAtPeriodEnd: a.subscriptionCancelAtPeriodEnd ?? false,
        legalName: a.billingDetails?.legalName ?? null,
        vatNumber: a.billingDetails?.vatNumber ?? null,
        country: a.billingDetails?.country ?? null,
        createdAt: a.createdAt,
      }))
      .sort((x, y) => y.createdAt - x.createdAt);
  },
});

/**
 * Waive (or re-impose) the listing fee for one supplier. Waiving moves their
 * drafts into the review queue straight away.
 */
export const adminSetBillingRequired = mutation({
  args: { token: v.string(), accountId: v.id("partnerAccounts"), required: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new ConvexError("Account not found.");
    await ctx.db.patch(args.accountId, { billingRequired: args.required });
    const promoted = args.required ? 0 : await promoteDrafts(ctx, args.accountId);
    return { ok: true as const, promoted };
  },
});
