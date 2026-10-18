/**
 * Planera for Travel Agencies — calls to the agency's OWN payment provider (pure).
 *
 * Every call here runs on the agency's credentials and moves money, if at all,
 * into the agency's account. Planera is never the merchant.
 *
 *  - Viva Wallet Smart Checkout: OAuth2 client credentials → payment order →
 *    redirect to viva's checkout → verify with Retrieve Transaction.
 *    https://developer.viva.com/smart-checkout/smart-checkout-integration/
 *  - Stripe Checkout: a Checkout Session on the agency's key → redirect →
 *    verify by retrieving the session.
 *
 * No Convex imports, and `fetch` is injected, so the request shapes are tested
 * against fakes rather than discovered in production.
 */

import type { PaymentProvider, StripeCredentials, VerifiedPayment, VivaCredentials } from "./clientPayments";
import { decimalToMinor } from "./connectors/http";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
type Env = "sandbox" | "production";

export class PaymentProviderError extends Error {
  constructor(
    public provider: PaymentProvider,
    public status: number,
    message: string,
    /** The provider's own error message, untruncated (never our request). */
    public providerMessage?: string,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

const VIVA_HOSTS: Record<Env, { accounts: string; api: string; checkout: string; legacy: string }> = {
  sandbox: {
    accounts: "https://demo-accounts.vivapayments.com",
    api: "https://demo-api.vivapayments.com",
    checkout: "https://demo.vivapayments.com/web/checkout",
    legacy: "https://demo.vivapayments.com",
  },
  production: {
    accounts: "https://accounts.vivapayments.com",
    api: "https://api.vivapayments.com",
    checkout: "https://www.vivapayments.com/web/checkout",
    legacy: "https://www.vivapayments.com",
  },
};

const STRIPE_API = "https://api.stripe.com/v1";

/** A short provider message, never our own request (it carries the key). */
function summarise(text: string, max = 200): string {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = j.error as Record<string, unknown> | string | undefined;
    const msg =
      (typeof err === "object" && err ? (err.message as string) : undefined) ??
      (typeof err === "string" ? err : undefined) ??
      (j.message as string) ??
      (j.ErrorText as string) ??
      (j.error_description as string);
    if (msg) return String(msg).slice(0, max);
  } catch {
    /* not JSON */
  }
  return text.replace(/\s+/g, " ").slice(0, 120);
}

async function call(
  fetchFn: FetchFn,
  provider: PaymentProvider,
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: controller.signal });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    throw new PaymentProviderError(provider, 0, aborted ? `${provider} timed out` : `${provider} is unreachable`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    const label = provider === "viva" ? "Viva" : "Stripe";
    const hint = res.status === 401 || res.status === 403 ? " (check the keys)" : "";
    throw new PaymentProviderError(
      provider,
      res.status,
      `${label} returned ${res.status}${hint}: ${summarise(text)}`,
      summarise(text, 600),
    );
  }
  return text;
}

const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

// ── Viva Wallet ─────────────────────────────────────────────────────────────

export async function vivaToken(creds: VivaCredentials, env: Env, fetchFn: FetchFn = fetch): Promise<string> {
  const text = await call(fetchFn, "viva", `${VIVA_HOSTS[env].accounts}/connect/token`, {
    method: "POST",
    headers: {
      Authorization: basic(creds.clientId, creds.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const token = (JSON.parse(text) as { access_token?: string }).access_token;
  if (!token) throw new PaymentProviderError("viva", 200, "Viva did not return an access token");
  return token;
}

export interface CheckoutInput {
  amountMinor: number;
  currency: string;
  /** What the client sees on the payment page. */
  description: string;
  /** Our reference, visible to the agency in its provider dashboard. */
  merchantReference: string;
  email?: string;
  fullName?: string;
  /** Planera's random id for this checkout. */
  publicId: string;
  /** Stripe only: Viva's return URLs live on the agency's payment source. */
  successUrl: string;
  cancelUrl: string;
  lang: "el" | "en";
}

export interface CreatedCheckout {
  orderId: string;
  checkoutUrl: string;
}

/**
 * The order code is a 16-digit number. Viva's own docs warn it can overflow a
 * JS number, so it is read out of the raw text, never through JSON.parse.
 */
export function readVivaOrderCode(text: string): string | null {
  const m = /"orderCode"\s*:\s*"?(\d{10,20})"?/i.exec(text);
  return m ? m[1] : null;
}

export async function vivaCreateOrder(
  creds: VivaCredentials,
  env: Env,
  input: CheckoutInput,
  fetchFn: FetchFn = fetch,
): Promise<CreatedCheckout> {
  if (input.currency.toUpperCase() !== "EUR") {
    throw new PaymentProviderError("viva", 0, "online payment through Viva is set up for euro quotes only");
  }
  const token = await vivaToken(creds, env, fetchFn);
  const body = {
    amount: input.amountMinor,
    customerTrns: input.description.slice(0, 255),
    merchantTrns: input.merchantReference.slice(0, 50),
    sourceCode: creds.sourceCode,
    customer: {
      ...(input.email ? { email: input.email } : {}),
      ...(input.fullName ? { fullName: input.fullName.slice(0, 50) } : {}),
      requestLang: input.lang === "el" ? "el-GR" : "en-GB",
    },
    tags: ["planera", input.publicId],
  };
  const text = await call(fetchFn, "viva", `${VIVA_HOSTS[env].api}/checkout/v2/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const orderCode = readVivaOrderCode(text);
  if (!orderCode) throw new PaymentProviderError("viva", 200, "Viva did not return an order code");
  return { orderId: orderCode, checkoutUrl: `${VIVA_HOSTS[env].checkout}?ref=${orderCode}` };
}

/** Viva statusId → our state. F = paid; A = still pending (async methods). */
export function mapVivaStatus(statusId: string | undefined): VerifiedPayment["state"] {
  switch ((statusId ?? "").toUpperCase()) {
    case "F":
      return "paid";
    case "A":
      return "pending";
    case "E":
    case "X":
      return "failed";
    default:
      return "pending";
  }
}

export async function vivaRetrieveTransaction(
  creds: VivaCredentials,
  env: Env,
  transactionId: string,
  fetchFn: FetchFn = fetch,
): Promise<VerifiedPayment> {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) {
    throw new PaymentProviderError("viva", 0, "not a Viva transaction id");
  }
  const token = await vivaToken(creds, env, fetchFn);
  const text = await call(
    fetchFn,
    "viva",
    `${VIVA_HOSTS[env].api}/checkout/v2/transactions/${transactionId}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
  const j = JSON.parse(text) as { statusId?: string; amount?: number | string };
  // `amount` is in euros (a decimal), unlike the order request, which is cents.
  let amountMinor: number | undefined;
  try {
    amountMinor = j.amount !== undefined ? decimalToMinor(String(j.amount), "EUR") : undefined;
  } catch {
    amountMinor = undefined;
  }
  return {
    state: mapVivaStatus(j.statusId),
    amountMinor,
    currency: "EUR",
    transactionId,
    orderId: readVivaOrderCode(text) ?? undefined,
  };
}

/**
 * Viva verifies a webhook URL with a GET that must echo a key, and that key is
 * only available with the Merchant ID + API key pair (Basic auth), not with the
 * Smart Checkout credentials.
 */
export async function vivaWebhookKey(creds: VivaCredentials, env: Env, fetchFn: FetchFn = fetch): Promise<string> {
  if (!creds.merchantId || !creds.apiKey) {
    throw new PaymentProviderError("viva", 0, "add the Merchant ID and API key to receive Viva notifications");
  }
  const text = await call(fetchFn, "viva", `${VIVA_HOSTS[env].legacy}/api/messages/config/token`, {
    method: "GET",
    headers: { Authorization: basic(creds.merchantId, creds.apiKey) },
  });
  const key = (JSON.parse(text) as { Key?: string }).Key;
  if (!key) throw new PaymentProviderError("viva", 200, "Viva did not return a webhook key");
  return key;
}

// ── Stripe ──────────────────────────────────────────────────────────────────

function form(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, val]) => val !== undefined && val !== "")
    .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(val))}`)
    .join("&");
}

const stripeHeaders = (creds: StripeCredentials) => ({
  Authorization: `Bearer ${creds.secretKey}`,
  "Content-Type": "application/x-www-form-urlencoded",
});

export async function stripeCreateSession(
  creds: StripeCredentials,
  input: CheckoutInput,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
): Promise<CreatedCheckout> {
  const body = form({
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": input.amountMinor,
    "line_items[0][price_data][product_data][name]": input.description.slice(0, 250),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.publicId,
    customer_email: input.email,
    locale: input.lang,
    "metadata[planera_payment]": input.publicId,
    "metadata[quote]": input.merchantReference,
    "payment_intent_data[description]": input.merchantReference,
    // Stripe allows 30 minutes to 24 hours. A day covers "I'll pay tonight".
    expires_at: Math.floor(now / 1000) + 23 * 3600,
  });
  const text = await call(fetchFn, "stripe", `${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      ...stripeHeaders(creds),
      // A retried request after a timeout returns the same session, not a second one.
      "Idempotency-Key": `planera-${input.publicId}`,
    },
    body,
  });
  const j = JSON.parse(text) as { id?: string; url?: string };
  if (!j.id || !j.url) throw new PaymentProviderError("stripe", 200, "Stripe did not return a checkout");
  return { orderId: j.id, checkoutUrl: j.url };
}

export function mapStripeSession(j: {
  status?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  id?: string;
}): VerifiedPayment {
  const state: VerifiedPayment["state"] =
    j.payment_status === "paid"
      ? "paid"
      : j.status === "expired"
        ? "expired"
        : "pending";
  return {
    state,
    amountMinor: typeof j.amount_total === "number" ? j.amount_total : undefined,
    currency: j.currency?.toUpperCase(),
    orderId: j.id,
  };
}

export async function stripeRetrieveSession(
  creds: StripeCredentials,
  sessionId: string,
  fetchFn: FetchFn = fetch,
): Promise<VerifiedPayment> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new PaymentProviderError("stripe", 0, "not a Stripe checkout session id");
  }
  const text = await call(fetchFn, "stripe", `${STRIPE_API}/checkout/sessions/${sessionId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${creds.secretKey}` },
  });
  const j = JSON.parse(text) as Parameters<typeof mapStripeSession>[0] & { payment_intent?: string };
  return { ...mapStripeSession(j), transactionId: j.payment_intent ?? undefined };
}

// ── Health check ────────────────────────────────────────────────────────────

export interface KeyCheckOptions {
  /** Stripe: the success/cancel URL of the test checkout (nobody is sent there). */
  returnUrl?: string;
  now?: number;
  /** Unique per check, so a key fixed since the last check is not answered from Stripe's idempotency cache. */
  idempotencyKey?: string;
  log?: (message: string) => void;
}

/** Stripe's restricted-key permission ids → the row the agent edits in the dashboard. */
const STRIPE_PERMISSION_LABELS: Record<string, string> = {
  checkout_session: "Checkout Sessions",
  product: "Products",
  price: "Prices",
  payment_intent: "PaymentIntents",
  customer: "Customers",
};

/**
 * A restricted key without a permission gets a 403 whose message names it:
 * "... Having the 'rak_checkout_session_write' permission would allow this
 * request to continue." Turned into what the agent has to change.
 */
export function stripePermissionHint(providerMessage: string | undefined): string | null {
  const m = /'rak_([a-z_]+?)_(read|write)'/.exec(providerMessage ?? "");
  if (!m) return null;
  const label =
    STRIPE_PERMISSION_LABELS[m[1]] ?? m[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const level = m[2] === "write" ? "Write" : "Read";
  return `the Stripe key is missing the ${label} permission: edit the restricted key in Stripe and set ${label} to ${level} (Stripe asks for 'rak_${m[1]}_${m[2]}')`;
}

/**
 * Prove the keys can do what a client payment will do.
 *
 * Stripe: a GET only proves read access, so this creates a real Checkout
 * Session the same way `stripeCreateSession` does (inline price_data, €0.50,
 * the currency minimum) and expires it straight away. Nobody is sent to it and
 * nothing is charged. A restricted key missing a write permission fails here,
 * with the permission named, instead of on the client's first payment.
 */
export async function checkProviderKeys(
  provider: PaymentProvider,
  creds: VivaCredentials | StripeCredentials,
  env: Env,
  fetchFn: FetchFn = fetch,
  opts: KeyCheckOptions = {},
): Promise<{ ok: true; message: string }> {
  if (provider === "viva") {
    const c = creds as VivaCredentials;
    await vivaToken(c, env, fetchFn);
    if (c.merchantId && c.apiKey) await vivaWebhookKey(c, env, fetchFn);
    return { ok: true, message: c.merchantId ? "keys and notifications work" : "keys work" };
  }

  const stripe = creds as StripeCredentials;
  const now = opts.now ?? Date.now();
  const returnUrl = opts.returnUrl ?? "https://planeraai.app/q/paid";
  const log = opts.log ?? ((msg: string) => console.warn(msg));
  const body = form({
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": 50,
    "line_items[0][price_data][product_data][name]": "Planera key check (not a payment)",
    success_url: `${returnUrl}?healthcheck=1`,
    cancel_url: `${returnUrl}?healthcheck=1`,
    "metadata[planera_healthcheck]": "1",
    // Stripe's minimum is 30 minutes; the margin absorbs clock skew. Only
    // matters if the expire below fails.
    expires_at: Math.floor(now / 1000) + 35 * 60,
  });
  let created: string;
  try {
    created = await call(fetchFn, "stripe", `${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        ...stripeHeaders(stripe),
        "Idempotency-Key": opts.idempotencyKey ?? `planera-healthcheck-${now}-${Math.random().toString(36).slice(2, 10)}`,
      },
      body,
    });
  } catch (e) {
    if (e instanceof PaymentProviderError && e.status === 403) {
      const hint = stripePermissionHint(e.providerMessage);
      throw new PaymentProviderError(
        "stripe",
        403,
        hint ?? `the Stripe key cannot create a checkout: ${e.providerMessage ?? e.message}`.slice(0, 300),
        e.providerMessage,
      );
    }
    throw e;
  }
  const id = (JSON.parse(created) as { id?: string }).id;
  if (!id) throw new PaymentProviderError("stripe", 200, "Stripe did not return a checkout");

  try {
    await call(fetchFn, "stripe", `${STRIPE_API}/checkout/sessions/${encodeURIComponent(id)}/expire`, {
      method: "POST",
      headers: stripeHeaders(stripe),
    });
  } catch (e) {
    // The key works: the test checkout just lingers until expires_at.
    log(`[agency:payments.checkAccount] could not expire test checkout ${id}: ${(e as Error)?.message}`);
  }
  return { ok: true, message: "key can create checkouts" };
}
