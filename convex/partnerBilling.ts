/**
 * Supplier listing subscription: €20/month + VAT, paid by card through Stripe
 * embedded Checkout on /partners/billing.
 *
 * Who pays: every supplier account created from 2026-10 on
 * (`partnerAccounts.billingRequired`). Earlier suppliers stay free, and the
 * operator can waive the fee per account from the admin panel. Without a live
 * subscription a supplier can still build drafts; nothing reaches review or
 * the app until they pay (see `lib/partnerListingAccess.ts`).
 *
 * Invoicing: Stripe collects the money and sends its receipt, but the legal
 * Greek invoice — Τιμολόγιο Παροχής Υπηρεσιών, transmitted to myDATA — is
 * issued by Planera's own invoicing software. So before paying, the supplier
 * gives its invoicing details (Επωνυμία, ΑΦΜ, ΔΟΥ, δραστηριότητα, address),
 * and every paid invoice becomes a `partnerInvoices` row plus an email to the
 * operator with everything needed to issue the τιμολόγιο. The admin marks it
 * issued once done.
 *
 * VAT: Greek customers pay 24% ΦΠΑ on top; EU customers with a VIES-valid VAT
 * number are reverse-charged; customers outside the EU pay none. The rules
 * live in `lib/partnerVat.ts`.
 *
 * Stripe setup is self-provisioning: the €20 monthly price (lookup key
 * `planera_partner_listing_monthly`) and the 24% tax rate are found or created
 * on first use, so no dashboard step is required. `STRIPE_PRICE_PARTNER_MONTHLY`
 * and `STRIPE_TAX_RATE_GR_VAT` override them if set. Webhooks reuse the
 * existing /stripe/webhook endpoint; partner events are recognised by
 * `metadata.kind === "partner"` (or by customer id for invoice events).
 *
 * Optional env: PARTNER_BILLING_ALERT_TO (operator inbox for τιμολόγιο alerts).
 */

import { v, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportError } from "./helpers/reportError";
import {
  stripeRequest,
  subscriptionPeriodEndMs,
  type StripeSubscription,
} from "./lib/stripe";
import {
  EU_COUNTRIES,
  GREEK_VAT_RATE,
  isValidGreekAfm,
  normalizeVatNumber,
  vatBreakdown,
  vatRateFor,
  vatTreatment,
  viesCountryCode,
} from "./lib/partnerVat";

const WEB_URL = () => process.env.PLANERA_WEB_URL || "https://planeraai.app";
const PRICE_LOOKUP_KEY = "planera_partner_listing_monthly";
const PRICE_NET_MINOR = 2000; // €20.00, VAT exclusive
const TAX_RATE_KEY = "gr_vat_24";
const DEFAULT_ALERT_TO = "dstroumpakos@planeraai.app";
const STRIPE_LOCALES = new Set(["el", "en", "de", "fr", "es"]);

type BillingAccount = {
  accountId: Id<"partnerAccounts">;
  email: string;
  partnerName: string;
  kind: string;
  billingRequired: boolean;
  listingActive: boolean;
  billingDetails: any | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
};

/** A validation error the portal can translate by `code`; `message` is the fallback. */
function fail(code: string, message: string) {
  return new ConvexError({ code, message });
}

async function requireAccount(ctx: any, token: string): Promise<BillingAccount> {
  const a: BillingAccount | null = await ctx.runQuery(
    internal.partnerBillingDb.accountForToken,
    { token }
  );
  if (!a) throw new ConvexError("Not authenticated.");
  return a;
}

// ───────────────────────── Stripe objects we own ────────────────────────────

let cachedPriceId: string | undefined;
let cachedTaxRateId: string | undefined;

/** The €20/month price, found by lookup key or created once. */
async function partnerPriceId(): Promise<string> {
  if (process.env.STRIPE_PRICE_PARTNER_MONTHLY) return process.env.STRIPE_PRICE_PARTNER_MONTHLY;
  if (cachedPriceId) return cachedPriceId;
  const found = await stripeRequest<{ data: Array<{ id: string }> }>("/prices", {
    params: { lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 },
  });
  if (found.data[0]) return (cachedPriceId = found.data[0].id);
  const created = await stripeRequest<{ id: string }>("/prices", {
    method: "POST",
    params: {
      currency: "eur",
      unit_amount: PRICE_NET_MINOR,
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
      lookup_key: PRICE_LOOKUP_KEY,
      nickname: "Partner listing — monthly",
      product_data: { name: "Planera — Προβολή πακέτων συνεργάτη (μηνιαία συνδρομή)" },
    },
    idempotencyKey: `price:${PRICE_LOOKUP_KEY}:v1`,
  });
  return (cachedPriceId = created.id);
}

/** Greek VAT 24%, exclusive, found by metadata or created once. */
async function greekVatRateId(): Promise<string> {
  if (process.env.STRIPE_TAX_RATE_GR_VAT) return process.env.STRIPE_TAX_RATE_GR_VAT;
  if (cachedTaxRateId) return cachedTaxRateId;
  const list = await stripeRequest<{
    data: Array<{ id: string; percentage: number; inclusive: boolean; metadata?: Record<string, string> }>;
  }>("/tax_rates", { params: { active: true, limit: 100 } });
  const hit = list.data.find(
    (r) => r.metadata?.planera_key === TAX_RATE_KEY && r.percentage === GREEK_VAT_RATE && !r.inclusive
  );
  if (hit) return (cachedTaxRateId = hit.id);
  const created = await stripeRequest<{ id: string }>("/tax_rates", {
    method: "POST",
    params: {
      display_name: "ΦΠΑ",
      description: "Greek VAT 24%",
      percentage: GREEK_VAT_RATE,
      inclusive: false,
      country: "GR",
      jurisdiction: "GR",
      tax_type: "vat",
      metadata: { planera_key: TAX_RATE_KEY },
    },
    idempotencyKey: `tax_rate:${TAX_RATE_KEY}:v1`,
  });
  return (cachedTaxRateId = created.id);
}

async function taxRatesFor(country: string): Promise<string[]> {
  return vatRateFor(country) > 0 ? [await greekVatRateId()] : [];
}

/**
 * Extra lines Stripe prints on its invoices and receipts. Stripe has no
 * fields for ΔΟΥ or δραστηριότητα, and it can only hold an EU VAT number as a
 * real tax ID, so these go in its custom invoice fields: at most 4, with names
 * up to 40 characters and values up to 140. An empty string clears them.
 */
function invoiceCustomFields(d: any): Array<{ name: string; value: string }> | "" {
  const fields: Array<{ name: string; value: string }> = [];
  if (!EU_COUNTRIES.has(d.country) && d.vatNumber) fields.push({ name: "Tax ID", value: d.vatNumber });
  if (d.taxOffice) fields.push({ name: "ΔΟΥ", value: d.taxOffice });
  if (d.profession) fields.push({ name: "Δραστηριότητα", value: d.profession });
  return fields.length ? fields.map((f) => ({ name: f.name, value: f.value.slice(0, 140) })) : "";
}

function customerParams(account: BillingAccount, d: any, isUpdate: boolean) {
  const customFields = invoiceCustomFields(d);
  return {
    name: d.legalName,
    email: d.invoiceEmail || account.email,
    phone: d.phone || undefined,
    address: {
      line1: d.address,
      city: d.city,
      postal_code: d.postalCode,
      country: d.country,
    },
    preferred_locales: [d.country === "GR" ? "el" : "en"],
    // "" clears old fields on an update; a new customer simply gets none.
    ...(customFields || isUpdate ? { invoice_settings: { custom_fields: customFields } } : {}),
    metadata: { kind: "partner", partnerAccountId: account.accountId, vatNumber: d.vatNumber },
  };
}

/** Find or create the Stripe customer, always refreshed with the latest details. */
async function ensurePartnerCustomer(ctx: any, account: BillingAccount): Promise<string> {
  const d = account.billingDetails;
  if (account.stripeCustomerId) {
    await stripeRequest(`/customers/${encodeURIComponent(account.stripeCustomerId)}`, {
      method: "POST",
      params: customerParams(account, d, true),
    });
    await syncTaxId(account.stripeCustomerId, d);
    return account.stripeCustomerId;
  }
  const customer = await stripeRequest<{ id: string }>("/customers", {
    method: "POST",
    params: customerParams(account, d, false),
    idempotencyKey: `partner-customer:${account.accountId}`,
  });
  await ctx.runMutation(internal.partnerBillingDb.linkStripeCustomer, {
    accountId: account.accountId,
    stripeCustomerId: customer.id,
  });
  await syncTaxId(customer.id, d);
  return customer.id;
}

/**
 * Keep the customer's EU VAT id (printed on Stripe's invoices) equal to the
 * ΑΦΜ on file: add it, replace a changed one, drop it if the agency moved
 * outside the EU. Cosmetic, so it never blocks payment.
 */
async function syncTaxId(customerId: string, d: any): Promise<void> {
  const path = `/customers/${encodeURIComponent(customerId)}/tax_ids`;
  const wanted = EU_COUNTRIES.has(d.country) ? `${viesCountryCode(d.country)}${d.vatNumber}` : null;
  try {
    const list = await stripeRequest<{ data: Array<{ id: string; type: string; value: string }> }>(path, {
      params: { limit: 100 },
    });
    let present = false;
    for (const tid of list.data.filter((x) => x.type === "eu_vat")) {
      if (tid.value === wanted) present = true;
      else await stripeRequest(`${path}/${encodeURIComponent(tid.id)}`, { method: "DELETE" });
    }
    if (wanted && !present) {
      await stripeRequest(path, { method: "POST", params: { type: "eu_vat", value: wanted } });
    }
  } catch (e) {
    console.warn(`[partnerBilling] tax id not synced for ${customerId}: ${e}`);
  }
}

// ────────────────────────────────── VIES ────────────────────────────────────

/** true / false from VIES, or null when the service could not answer. */
async function checkVies(country: string, vatNumber: string): Promise<boolean | null> {
  const cc = viesCountryCode(country);
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(vatNumber)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    if (typeof json?.isValid !== "boolean") return null;
    // A member state being down comes back as isValid:false + an error code.
    if (!json.isValid && json.userError && json.userError !== "INVALID") return null;
    return json.isValid;
  } catch {
    return null;
  }
}

// ─────────────────────────────── Public API ─────────────────────────────────

/** Monthly fee with VAT for a country (default Greece), from the live price. */
export const getPartnerPricing = action({
  args: { country: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const country = (args.country || "GR").toUpperCase();
    let net = PRICE_NET_MINOR;
    let currency = "EUR";
    try {
      const price = await stripeRequest<{ unit_amount: number | null; currency: string }>(
        `/prices/${encodeURIComponent(await partnerPriceId())}`
      );
      if (price.unit_amount != null) net = price.unit_amount;
      currency = price.currency.toUpperCase();
    } catch (e) {
      await reportError(ctx, "partnerBilling:getPartnerPricing", e, {});
    }
    const b = vatBreakdown(net, country);
    return { currency, interval: "month" as const, ...b, treatment: vatTreatment(country) };
  },
});

/**
 * Save the supplier's invoicing details. Greek ΑΦΜ is checksum-validated and
 * needs a ΔΟΥ; other EU VAT numbers must pass VIES (that is what entitles
 * them to reverse charge). If a subscription already exists, Stripe's copy of
 * the customer — and the VAT on future renewals — follow the change.
 */
export const saveBillingDetails = action({
  args: {
    token: v.string(),
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
  },
  handler: async (ctx, args) => {
    const account = await requireAccount(ctx, args.token);
    const clean = (s?: string) => s?.trim().replace(/\s+/g, " ") || undefined;
    const country = args.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw fail("country", "Choose a country.");

    const legalName = clean(args.legalName);
    const address = clean(args.address);
    const city = clean(args.city);
    const postalCode = clean(args.postalCode);
    if (!legalName || !address || !city || !postalCode) {
      throw fail("required", "Company name, address, city and postal code are required.");
    }
    const vatNumber = normalizeVatNumber(args.vatNumber, country);
    if (!vatNumber) throw fail("vat_required", "VAT number is required.");

    const invoiceEmail = clean(args.invoiceEmail)?.toLowerCase();
    if (invoiceEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invoiceEmail)) {
      throw fail("email", "Enter a valid invoice email.");
    }

    let viesValid: boolean | undefined;
    const treatment = vatTreatment(country);
    if (treatment === "domestic") {
      if (!isValidGreekAfm(vatNumber)) {
        throw fail("afm_invalid", "This ΑΦΜ is not valid. Check the 9 digits.");
      }
      if (!clean(args.taxOffice)) throw fail("tax_office", "ΔΟΥ is required for Greek invoices.");
    } else if (treatment === "reverse_charge") {
      const ok = await checkVies(country, vatNumber);
      if (ok === null) {
        throw fail("vies_down", "The EU VAT service (VIES) is not responding. Please try again in a few minutes.");
      }
      if (!ok) throw fail("vies_invalid", "This VAT number is not registered in VIES.");
      viesValid = true;
    }

    const details = {
      legalName,
      vatNumber,
      taxOffice: clean(args.taxOffice),
      profession: clean(args.profession),
      address,
      city,
      postalCode,
      country,
      phone: clean(args.phone),
      invoiceEmail,
      viesValid,
      updatedAt: Date.now(),
    };
    await ctx.runMutation(internal.partnerBillingDb.writeBillingDetails, {
      accountId: account.accountId,
      details,
    });

    // Keep Stripe in step for customers who already exist.
    if (account.stripeCustomerId) {
      try {
        await ensurePartnerCustomer(ctx, { ...account, billingDetails: details });
        const oldCountry = account.billingDetails?.country;
        if (
          account.stripeSubscriptionId &&
          oldCountry &&
          vatRateFor(oldCountry) !== vatRateFor(country)
        ) {
          const sub = await stripeRequest<StripeSubscription & { items: { data: Array<{ id: string }> } }>(
            `/subscriptions/${encodeURIComponent(account.stripeSubscriptionId)}`
          );
          const itemId = sub.items?.data?.[0]?.id;
          if (itemId) {
            const rates = await taxRatesFor(country);
            await stripeRequest(`/subscription_items/${encodeURIComponent(itemId)}`, {
              method: "POST",
              // An empty string is Stripe's way of clearing a list.
              params: { tax_rates: rates.length ? rates : "", proration_behavior: "none" },
            });
          }
        }
      } catch (e) {
        await reportError(ctx, "partnerBilling:saveBillingDetails", e, {
          accountId: account.accountId,
        });
      }
    }
    return { ok: true as const };
  },
});

/** Start an embedded Checkout for the monthly listing subscription. */
export const createCheckoutSession = action({
  args: { token: v.string(), locale: v.optional(v.string()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; clientSecret: string } | { ok: false; error: string }> => {
    const account = await requireAccount(ctx, args.token);
    if (account.kind !== "supplier" || !account.billingRequired) {
      return { ok: false, error: "not_required" };
    }
    if (account.listingActive) return { ok: false, error: "already_active" };
    if (!account.billingDetails) return { ok: false, error: "billing_details_required" };

    try {
      const customer = await ensurePartnerCustomer(ctx, account);
      const taxRates = await taxRatesFor(account.billingDetails.country);
      const meta = { kind: "partner", partnerAccountId: account.accountId };
      const locale = args.locale && STRIPE_LOCALES.has(args.locale) ? args.locale : "auto";
      const session = await stripeRequest<{ client_secret: string }>("/checkout/sessions", {
        method: "POST",
        params: {
          mode: "subscription",
          ui_mode: "embedded",
          customer,
          client_reference_id: `partner_${account.accountId}`,
          line_items: [
            {
              price: await partnerPriceId(),
              quantity: 1,
              ...(taxRates.length ? { tax_rates: taxRates } : {}),
            },
          ],
          return_url: `${WEB_URL()}/partners/billing?session_id={CHECKOUT_SESSION_ID}`,
          allow_promotion_codes: true,
          metadata: meta,
          subscription_data: { metadata: meta, description: "Planera partner listing" },
          locale,
        },
      });
      return { ok: true, clientSecret: session.client_secret };
    } catch (e) {
      await reportError(ctx, "partnerBilling:createCheckoutSession", e, {
        accountId: account.accountId,
      });
      return { ok: false, error: "stripe_error" };
    }
  },
});

/**
 * Read back a finished Checkout on the return page and apply it, so the
 * supplier sees "active" without waiting for the webhook. Both paths funnel
 * into the same idempotent mutations.
 */
export const getCheckoutStatus = action({
  args: { token: v.string(), sessionId: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; status?: string; active?: boolean; error?: string }> => {
    const account = await requireAccount(ctx, args.token);
    try {
      const session = await stripeRequest<{
        status: string;
        subscription?: string;
        metadata?: Record<string, string>;
      }>(`/checkout/sessions/${encodeURIComponent(args.sessionId)}`);
      if (session.metadata?.partnerAccountId !== account.accountId) {
        return { ok: false, error: "not_found" };
      }
      if (session.status !== "complete" || !session.subscription) {
        return { ok: true, status: session.status, active: false };
      }
      const sub = await stripeRequest<StripeSubscription & { latest_invoice?: string }>(
        `/subscriptions/${encodeURIComponent(session.subscription)}`
      );
      const res = await syncSubscription(ctx, sub, account.accountId);
      return { ok: true, status: session.status, active: res.action === "active" };
    } catch (e) {
      await reportError(ctx, "partnerBilling:getCheckoutStatus", e, { accountId: account.accountId });
      return { ok: false, error: "stripe_error" };
    }
  },
});

/** Stripe-hosted portal: change card, see receipts, cancel. */
export const createPortalSession = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    const account = await requireAccount(ctx, args.token);
    if (!account.stripeCustomerId) return { ok: false, error: "no_stripe_customer" };
    try {
      const session = await stripeRequest<{ url: string }>("/billing_portal/sessions", {
        method: "POST",
        params: {
          customer: account.stripeCustomerId,
          return_url: `${WEB_URL()}/partners/billing`,
        },
      });
      return { ok: true, url: session.url };
    } catch (e) {
      await reportError(ctx, "partnerBilling:createPortalSession", e, { accountId: account.accountId });
      return { ok: false, error: "stripe_error" };
    }
  },
});

// ───────────────────────────── Sync + webhook ───────────────────────────────

async function syncSubscription(
  ctx: any,
  sub: StripeSubscription & { latest_invoice?: string | { id: string } },
  accountIdHint?: string
): Promise<{ action: string }> {
  const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id;
  let accountId: string | null = sub.metadata?.partnerAccountId || accountIdHint || null;
  if (!accountId && customerId) {
    accountId = await ctx.runQuery(internal.partnerBillingDb.accountIdByStripeCustomer, {
      stripeCustomerId: customerId,
    });
  }
  if (!accountId || !customerId) return { action: "no_partner" };

  const res: { action: string; promoted: number } = await ctx.runMutation(
    internal.partnerBillingDb.applyPartnerSubscription,
    {
      accountId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status: sub.status,
      periodEnd: subscriptionPeriodEndMs(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    }
  );

  // Renewals arrive as subscription updates, so the newest invoice is checked
  // here too — the invoice.paid event is then optional, not required.
  const invoiceId =
    typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if (invoiceId) await recordInvoiceById(ctx, invoiceId, accountId);

  console.log(
    `[partnerBilling] ${sub.id} status=${sub.status} account=${accountId} → ${res.action} (+${res.promoted} drafts)`
  );
  return { action: res.action };
}

/**
 * When to look again at an invoice that is not paid yet. A renewal's
 * "subscription updated" event fires when Stripe CREATES the invoice; it is
 * finalised and charged about an hour later, and a declined card is retried
 * over days. The webhook endpoint does not carry invoice.paid, so without
 * these re-checks no renewal would ever reach the τιμολόγιο list.
 */
const INVOICE_RECHECK_DELAYS_MS = [75, 6 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60].map((m) => m * 60 * 1000);

/** Fetch an invoice with our pinned API version and record it if it is paid. */
async function recordInvoiceById(ctx: any, invoiceId: string, accountId: string, attempt = 0) {
  const inv = await stripeRequest<any>(`/invoices/${encodeURIComponent(invoiceId)}`);
  if ((inv.status === "draft" || inv.status === "open") && attempt < INVOICE_RECHECK_DELAYS_MS.length) {
    await ctx.scheduler.runAfter(INVOICE_RECHECK_DELAYS_MS[attempt], internal.partnerBilling.recheckInvoice, {
      invoiceId,
      accountId,
      attempt: attempt + 1,
    });
    return;
  }
  if (inv.status !== "paid" || !(inv.amount_paid > 0)) return;
  const vat = typeof inv.tax === "number" ? inv.tax : 0;
  const net = typeof inv.total_excluding_tax === "number" ? inv.total_excluding_tax : inv.total - vat;
  const line = inv.lines?.data?.[0]?.period;
  const paidAt = inv.status_transitions?.paid_at;
  await ctx.runMutation(internal.partnerBillingDb.recordInvoice, {
    accountId,
    stripeInvoiceId: inv.id,
    stripeInvoiceNumber: inv.number ?? undefined,
    stripeSubscriptionId: typeof inv.subscription === "string" ? inv.subscription : undefined,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
    billingReason: inv.billing_reason ?? undefined,
    currency: String(inv.currency || "eur").toUpperCase(),
    netMinor: net,
    vatMinor: vat,
    totalMinor: inv.total,
    periodStart: line?.start ? line.start * 1000 : undefined,
    periodEnd: line?.end ? line.end * 1000 : undefined,
    paidAt: paidAt ? paidAt * 1000 : Date.now(),
  });
}

/** Scheduled re-check of a not-yet-paid invoice (see INVOICE_RECHECK_DELAYS_MS). */
export const recheckInvoice = internalAction({
  args: { invoiceId: v.string(), accountId: v.id("partnerAccounts"), attempt: v.number() },
  handler: async (ctx, args) => {
    try {
      await recordInvoiceById(ctx, args.invoiceId, args.accountId, args.attempt);
    } catch (e) {
      await reportError(ctx, "partnerBilling:recheckInvoice", e, { ...args });
      // A Stripe hiccup must not end the chain: try again at the next step.
      if (args.attempt < INVOICE_RECHECK_DELAYS_MS.length) {
        await ctx.scheduler.runAfter(INVOICE_RECHECK_DELAYS_MS[args.attempt], internal.partnerBilling.recheckInvoice, {
          ...args,
          attempt: args.attempt + 1,
        });
      }
    }
    return null;
  },
});

/**
 * Handle a verified Stripe webhook event if it belongs to a supplier
 * subscription. Returns null for everything else so `stripeBilling` carries
 * on with its own (app Premium) handling.
 */
export async function handlePartnerStripeEvent(
  ctx: any,
  type: string,
  object: any
): Promise<{ action: string } | null> {
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (object?.metadata?.kind !== "partner") return null;
      if (!object.subscription) return { action: "partner_no_subscription" };
      const sub = await stripeRequest<StripeSubscription>(
        `/subscriptions/${encodeURIComponent(String(object.subscription))}`
      );
      return await syncSubscription(ctx, sub, object.metadata.partnerAccountId);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      if (object?.metadata?.kind !== "partner") return null;
      return await syncSubscription(ctx, object);
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const customerId = typeof object?.customer === "string" ? object.customer : null;
      if (!customerId) return null;
      const accountId = await ctx.runQuery(internal.partnerBillingDb.accountIdByStripeCustomer, {
        stripeCustomerId: customerId,
      });
      if (!accountId) return null;
      await recordInvoiceById(ctx, object.id, accountId);
      return { action: "partner_invoice" };
    }
    default:
      return null;
  }
}

// ───────────────────────────── Operator alert ───────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (minor: number, currency: string) =>
  `${(minor / 100).toFixed(2).replace(".", ",")} ${currency === "EUR" ? "€" : currency}`;
const day = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString("el-GR", { timeZone: "Europe/Athens" }) : "—";

/** Email the operator what the Τιμολόγιο Παροχής Υπηρεσιών must contain. */
export const sendInvoiceAlert = internalAction({
  args: { invoiceId: v.id("partnerInvoices"), firstPayment: v.boolean() },
  handler: async (ctx, args) => {
    const inv: any = await ctx.runQuery(internal.partnerBillingDb.getInvoice, {
      invoiceId: args.invoiceId,
    });
    if (!inv) return null;
    const b = inv.billing ?? {};
    const to = process.env.PARTNER_BILLING_ALERT_TO || process.env.STATS_REPORT_TO || DEFAULT_ALERT_TO;
    const greek = !b.country || b.country === "GR";
    const amount = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

    // Grouped in the order they are typed into e-timologio. For a Greek ΑΦΜ,
    // e-timologio fills the name and address itself, so the customer block is
    // only there to check against.
    const groups: Array<[string, Array<[string, string | undefined]>]> = [
      [
        "1. Για το e-timologio",
        [
          ["Παραστατικό", "Τιμολόγιο Παροχής Υπηρεσιών"],
          ["ΑΦΜ πελάτη", greek ? b.vatNumber : `${b.country} ${b.vatNumber}`],
          ["Περιγραφή", inv.description],
          ["Ποσότητα", "1"],
          ["Καθαρή αξία", amount(inv.netMinor)],
          [`ΦΠΑ`, `${inv.vatRatePct}% → ${amount(inv.vatMinor)}`],
          ["Σύνολο", money(inv.totalMinor, inv.currency)],
          ["Πληρωμή", `Κάρτα (Stripe), ${day(inv.paidAt)}`],
          ...(inv.vatNote ? ([["Σημείωση ΦΠΑ", inv.vatNote]] as Array<[string, string]>) : []),
        ],
      ],
      [
        greek ? "2. Έλεγχος (συμπληρώνονται αυτόματα από το ΑΦΜ)" : "2. Πελάτης εξωτερικού: συμπληρώστε τα χειροκίνητα",
        [
          ["Επωνυμία", b.legalName],
          ["ΔΟΥ", b.taxOffice],
          ["Διεύθυνση", [b.address, [b.postalCode, b.city].filter(Boolean).join(" "), b.country].filter(Boolean).join(", ")],
          ["Δραστηριότητα", b.profession],
          ["Email τιμολογίου", b.invoiceEmail || inv.email],
          ["Τηλέφωνο", b.phone],
        ],
      ],
      ["3. Αναφορά", [["Stripe", inv.stripeInvoiceNumber || inv.stripeInvoiceId]]],
    ];


    const cell = "border-bottom:1px solid #eee";
    const table = groups
      .map(
        ([title, r]) =>
          `<tr><td colspan="2" style="padding:16px 6px 6px;font-size:12px;font-weight:bold;color:#111;text-transform:uppercase;letter-spacing:.03em">${esc(title)}</td></tr>\n` +
          r
            .map(
              ([k, val]) =>
                `<tr><td style="${cell};color:#666;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="${cell}"><b>${esc(val || "—")}</b></td></tr>`
            )
            .join("\n")
      )
      .join("\n");

    const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:560px">
<p style="font-size:15px;margin:0 0 6px"><b>Έκδοση Τιμολογίου Παροχής Υπηρεσιών</b></p>
<p style="font-size:13px;color:#555;margin:0 0 6px">${esc(inv.partnerName)} (${esc(inv.email)}) ${
      args.firstPayment ? "μόλις ενεργοποίησε τη συνδρομή του." : "ανανέωσε τη συνδρομή του."
    }</p>
${inv.billing ? "" : `<p style="font-size:13px;color:#b45309;margin:0 0 6px">⚠️ Δεν υπάρχουν στοιχεία τιμολόγησης — επικοινωνήστε με τον συνεργάτη.</p>`}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%">
${table}
</table>
${inv.hostedInvoiceUrl ? `<p style="font-size:12px;margin:14px 0 0"><a href="${esc(inv.hostedInvoiceUrl)}">Απόδειξη Stripe</a></p>` : ""}
<p style="font-size:12px;color:#777;margin:14px 0 0">Αφού εκδοθεί στο e-timologio, σημειώστε το ως εκδοθέν με τον αριθμό του στο <a href="${WEB_URL()}/admin">Admin → Partner Applications → Τιμολόγια</a>.</p>
</div>`;
    const text = groups
      .map(([title, r]) => [title, ...r.map(([k, val]) => `${k}: ${val || "—"}`)].join("\n"))
      .join("\n\n");

    await ctx.runAction(internal.postmark.sendRawEmail, {
      to,
      subject: `${args.firstPayment ? "Νέος συνδρομητής" : "Ανανέωση"} — τιμολόγιο για ${b.legalName || inv.partnerName} (${money(inv.totalMinor, inv.currency)})`,
      html,
      text,
      tag: "partner-billing",
      ignoreSuppression: true,
    });
    return null;
  },
});
