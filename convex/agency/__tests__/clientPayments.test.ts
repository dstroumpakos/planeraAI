import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOnlinePayment,
  balanceOf,
  formatIban,
  isOnlineActive,
  normalizeIban,
  normalizePaymentSettings,
  optionFor,
  payOptions,
  reconcile,
  validateProviderCredentials,
} from "../clientPayments";
import {
  checkProviderKeys,
  mapStripeSession,
  readVivaOrderCode,
  stripeCreateSession,
  vivaCreateOrder,
  vivaRetrieveTransaction,
  type FetchFn,
} from "../paymentProviders";
import type { Fulfilment } from "../fulfilment";

const eur = (amountMinor: number) => ({ amountMinor, currency: "EUR" });

// ── Settings ────────────────────────────────────────────────────────────────

test("IBAN: a valid Greek IBAN normalises, a one-digit typo is refused", () => {
  assert.equal(normalizeIban("gr16 0110 1250 0000 0001 2300 695"), "GR1601101250000000012300695");
  assert.throws(() => normalizeIban("GR1601101250000000012300696"), /not valid/);
  assert.throws(() => normalizeIban("hello"), /not valid/);
  assert.equal(formatIban("GR1601101250000000012300695"), "GR16 0110 1250 0000 0001 2300 695");
});

test("settings: IBAN needs a beneficiary, link must be https, 100% deposit means full", () => {
  assert.throws(() => normalizePaymentSettings({ iban: "GR1601101250000000012300695" }), /beneficiary/);
  assert.throws(() => normalizePaymentSettings({ paymentLinkUrl: "http://pay.example.com" }), /https/);
  assert.throws(() => normalizePaymentSettings({ depositPercent: 30.5 }), /whole percentage/);
  const s = normalizePaymentSettings({
    beneficiary: "  Meltemi   Travel ",
    iban: "GR16 0110 1250 0000 0001 2300 695",
    bic: "etho grAA",
    depositPercent: 100,
  });
  assert.equal(s.beneficiary, "Meltemi Travel");
  assert.equal(s.bic, "ETHOGRAA");
  assert.equal(s.depositPercent, 0);
  assert.equal(s.payWhen, "on_accept");
});

// ── The on/off switch ───────────────────────────────────────────────────────

test("online payment stays off until the keys passed a check", () => {
  const base = { status: "active" as const, encryptedCredentials: "v1.x" };
  assert.equal(isOnlineActive(null), false);
  assert.equal(isOnlineActive(base), false, "saved but never checked");
  assert.equal(isOnlineActive({ ...base, lastHealthOk: false }), false);
  assert.equal(isOnlineActive({ ...base, status: "error", lastHealthOk: true }), false);
  assert.equal(isOnlineActive({ ...base, lastHealthOk: true, revokedAt: 1 }), false);
  assert.equal(isOnlineActive({ ...base, encryptedCredentials: "", lastHealthOk: true }), false);
  assert.equal(isOnlineActive({ ...base, lastHealthOk: true }), true);
});

test("credentials: Stripe mode comes from the key, Viva needs a 4-digit source", () => {
  const live = validateProviderCredentials("stripe", { secretKey: "rk_live_" + "a".repeat(24) }, "sandbox");
  assert.equal(live.environment, "production");
  assert.ok(!live.displayHint.includes("a".repeat(10)), "hint never holds the key");
  assert.throws(() => validateProviderCredentials("stripe", { secretKey: "pk_live_abc" }, undefined), /secret key/);

  assert.throws(
    () => validateProviderCredentials("viva", { clientId: "id", clientSecret: "s", sourceCode: "12" }, "sandbox"),
    /4-digit/,
  );
  assert.throws(
    () =>
      validateProviderCredentials(
        "viva",
        { clientId: "id", clientSecret: "s", sourceCode: "1234", merchantId: "not-a-uuid", apiKey: "k" },
        "sandbox",
      ),
    /Merchant ID/,
  );
  const viva = validateProviderCredentials(
    "viva",
    { clientId: "abc123.apps.vivapayments.com", clientSecret: "s", sourceCode: "1234" },
    "production",
  );
  assert.equal(viva.environment, "production");
  assert.ok(!("merchantId" in viva.credentials));
});

// ── What is owed ────────────────────────────────────────────────────────────

test("pay options: deposit + full first, then only the balance", () => {
  const fresh = payOptions(balanceOf(eur(120000), 0), 30);
  assert.deepEqual(
    fresh.map((o) => [o.kind, o.amount.amountMinor]),
    [
      ["deposit", 36000],
      ["full", 120000],
    ],
  );
  assert.deepEqual(payOptions(balanceOf(eur(120000), 0), 0).map((o) => o.kind), ["full"]);
  const after = payOptions(balanceOf(eur(120000), 36000), 30);
  assert.deepEqual(after.map((o) => [o.kind, o.amount.amountMinor]), [["balance", 84000]]);
  assert.deepEqual(payOptions(balanceOf(eur(120000), 120000), 30), []);
  assert.throws(() => optionFor("deposit", after), /not available/);
});

test("ledger: an online payment raises received and moves deposit → paid", () => {
  const f: Fulfilment = {
    tier: "comfort",
    startedAt: 0,
    lines: [],
    payment: { status: "unpaid", received: eur(0), due: eur(100000), updatedAt: 0 },
  };
  const dep = applyOnlinePayment(f, 30000, 5);
  assert.equal(dep.payment.status, "deposit");
  assert.equal(dep.payment.received.amountMinor, 30000);
  const full = applyOnlinePayment(dep, 70000, 6);
  assert.equal(full.payment.status, "paid");
  assert.equal(applyOnlinePayment(f, 0, 7), f, "nothing paid, nothing changes");
});

// ── Verification ────────────────────────────────────────────────────────────

test("reconcile: paid is final, foreign orders and wrong currency are not paid", () => {
  const row = { status: "created" as const, amountMinor: 30000, currency: "EUR", providerOrderId: "7271532565172601" };
  assert.deepEqual(reconcile(row, { state: "paid", amountMinor: 30000, currency: "EUR" }), {
    change: "paid",
    amountMinor: 30000,
    note: undefined,
  });
  assert.equal(reconcile({ ...row, status: "paid" }, { state: "failed" }).change, "none");
  assert.equal(reconcile(row, { state: "paid", orderId: "1111111111111111" }).change, "none");
  assert.equal(reconcile(row, { state: "paid", currency: "USD", amountMinor: 30000 }).change, "failed");
  // Recorded at what the provider confirmed, not what was asked.
  const partial = reconcile(row, { state: "paid", amountMinor: 29000, currency: "EUR" });
  assert.equal(partial.change, "paid");
  assert.equal((partial as { amountMinor: number }).amountMinor, 29000);
  assert.equal(reconcile(row, { state: "pending" }).change, "none");
  assert.equal(reconcile(row, { state: "expired" }).change, "expired");
});

// ── Provider request shapes (fake fetch) ────────────────────────────────────

interface Seen {
  url: string;
  init?: RequestInit;
}

function fakeFetch(responses: Array<{ status?: number; body: string }>, seen: Seen[]): FetchFn {
  let i = 0;
  return async (url, init) => {
    seen.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.body, { status: r.status ?? 200 });
  };
}

const vivaCreds = { clientId: "cid.apps.vivapayments.com", clientSecret: "secret", sourceCode: "4321" };
const checkoutInput = {
  amountMinor: 36000,
  currency: "EUR",
  description: "Meltemi · ATH → CDG · Comfort · Προκαταβολή",
  merchantReference: "qte_123",
  email: "client@example.com",
  fullName: "Maria Papadopoulou",
  publicId: "pub_abc",
  successUrl: "https://planeraai.app/q/paid?p=pub_abc&session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://planeraai.app/q/paid?p=pub_abc&cancelled=1",
  lang: "el" as const,
};

test("Viva: order in cents with the source code, order code kept as a string", async () => {
  // 9007199254740993 is not representable as a JS number.
  assert.equal(readVivaOrderCode('{"orderCode": 9007199254740993}'), "9007199254740993");
  const seen: Seen[] = [];
  const f = fakeFetch(
    [{ body: '{"access_token":"tok","expires_in":3600}' }, { body: '{"orderCode":9007199254740993}' }],
    seen,
  );
  const out = await vivaCreateOrder(vivaCreds, "sandbox", checkoutInput, f);
  assert.equal(out.orderId, "9007199254740993");
  assert.equal(out.checkoutUrl, "https://demo.vivapayments.com/web/checkout?ref=9007199254740993");
  assert.equal(seen[0].url, "https://demo-accounts.vivapayments.com/connect/token");
  assert.equal(seen[1].url, "https://demo-api.vivapayments.com/checkout/v2/orders");
  const body = JSON.parse(String(seen[1].init?.body));
  assert.equal(body.amount, 36000);
  assert.equal(body.sourceCode, "4321");
  assert.equal(body.merchantTrns, "qte_123");
  assert.equal(body.customer.requestLang, "el-GR");
  await assert.rejects(vivaCreateOrder(vivaCreds, "sandbox", { ...checkoutInput, currency: "USD" }, f), /euro/);
});

test("Viva: a finished transaction is paid, amount read from euros", async () => {
  const seen: Seen[] = [];
  const f = fakeFetch(
    [
      { body: '{"access_token":"tok"}' },
      { body: '{"statusId":"F","amount":360.00,"orderCode":7271532565172601,"currencyCode":"978"}' },
    ],
    seen,
  );
  const v = await vivaRetrieveTransaction(vivaCreds, "production", "2b4c6b5b-49ff-4e46-adc5-f53740212361", f);
  assert.equal(v.state, "paid");
  assert.equal(v.amountMinor, 36000);
  assert.equal(v.orderId, "7271532565172601");
  assert.equal(
    seen[1].url,
    "https://api.vivapayments.com/checkout/v2/transactions/2b4c6b5b-49ff-4e46-adc5-f53740212361",
  );
});

test("Stripe: one checkout session, idempotent, metadata carries our id", async () => {
  const seen: Seen[] = [];
  const f = fakeFetch([{ body: '{"id":"cs_test_abc","url":"https://checkout.stripe.com/c/pay/cs_test_abc"}' }], seen);
  const out = await stripeCreateSession({ secretKey: "rk_test_x" }, checkoutInput, f, 1_000_000_000_000);
  assert.equal(out.orderId, "cs_test_abc");
  const params = new URLSearchParams(String(seen[0].init?.body));
  assert.equal(params.get("mode"), "payment");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "36000");
  assert.equal(params.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(params.get("client_reference_id"), "pub_abc");
  assert.equal(params.get("success_url"), checkoutInput.successUrl);
  assert.equal((seen[0].init?.headers as Record<string, string>)["Idempotency-Key"], "planera-pub_abc");
});

test("Stripe: session states map to paid / pending / expired", () => {
  assert.equal(mapStripeSession({ status: "complete", payment_status: "paid", amount_total: 100 }).state, "paid");
  assert.equal(mapStripeSession({ status: "complete", payment_status: "unpaid" }).state, "pending");
  assert.equal(mapStripeSession({ status: "expired", payment_status: "unpaid" }).state, "expired");
  assert.equal(mapStripeSession({ status: "open", payment_status: "unpaid" }).state, "pending");
});

test("health check: a rejected key fails with the provider's message, never the key", async () => {
  const f = fakeFetch([{ status: 401, body: '{"error":{"message":"Invalid API Key provided"}}' }], []);
  await assert.rejects(
    checkProviderKeys("stripe", { secretKey: "sk_test_SECRETSECRETSECRET" }, "sandbox", f),
    (e: Error) => /401/.test(e.message) && /Invalid API Key/.test(e.message) && !/SECRETSECRET/.test(e.message),
  );
});

test("health check (Stripe): creates a €0.50 test checkout the real way, then expires it", async () => {
  const seen: Seen[] = [];
  const logs: string[] = [];
  const f = fakeFetch(
    [
      { body: '{"id":"cs_test_hc1","url":"https://checkout.stripe.com/c/pay/cs_test_hc1"}' },
      { body: '{"id":"cs_test_hc1","status":"expired"}' },
    ],
    seen,
  );
  const res = await checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", f, {
    returnUrl: "https://planeraai.app/q/paid",
    now: 1_000_000_000_000,
    idempotencyKey: "planera-healthcheck-fixed",
    log: (m) => logs.push(m),
  });
  assert.equal(res.ok, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(seen[0].init?.method, "POST");
  const params = new URLSearchParams(String(seen[0].init?.body));
  assert.equal(params.get("mode"), "payment");
  // Same inline price_data shape as stripeCreateSession, so the same permissions are exercised.
  assert.equal(params.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "50");
  assert.ok(params.get("line_items[0][price_data][product_data][name]"));
  assert.equal(params.get("success_url"), "https://planeraai.app/q/paid?healthcheck=1");
  assert.equal(params.get("cancel_url"), "https://planeraai.app/q/paid?healthcheck=1");
  assert.equal(params.get("metadata[planera_healthcheck]"), "1");
  assert.equal(params.get("expires_at"), String(1_000_000_000 + 35 * 60));
  const headers = seen[0].init?.headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], "planera-healthcheck-fixed");
  assert.equal(seen[1].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_hc1/expire");
  assert.equal(seen[1].init?.method, "POST");
  assert.deepEqual(logs, []);
});

test("health check (Stripe): each check gets its own idempotency key by default", async () => {
  const seen: Seen[] = [];
  const created = { body: '{"id":"cs_test_hc2"}' };
  const f = fakeFetch([created, { body: "{}" }, created, { body: "{}" }], seen);
  await checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", f, { log: () => {} });
  await checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", f, { log: () => {} });
  const key = (i: number) => (seen[i].init?.headers as Record<string, string>)["Idempotency-Key"];
  assert.match(key(0), /^planera-healthcheck-/);
  assert.notEqual(key(0), key(2));
});

test("health check (Stripe): a 403 on create names the missing permission", async () => {
  const seen: Seen[] = [];
  const f = fakeFetch(
    [
      {
        status: 403,
        body: JSON.stringify({
          error: {
            type: "invalid_request_error",
            message:
              "The provided key 'rk_test_*********************************************wxyz' does not have the required permissions for this endpoint on account 'acct_1AbCdEfGhIjKlMnO'. Having the 'rak_checkout_session_write' permission would allow this request to continue.",
          },
        }),
      },
    ],
    seen,
  );
  await assert.rejects(
    checkProviderKeys("stripe", { secretKey: "rk_test_SECRETSECRETSECRET" }, "sandbox", f, { log: () => {} }),
    (e: Error) =>
      /Checkout Sessions/.test(e.message) &&
      /Write/.test(e.message) &&
      /rak_checkout_session_write/.test(e.message) &&
      !/SECRETSECRET/.test(e.message),
  );
  assert.equal(seen.length, 1, "nothing to expire when create failed");

  // Stripe asking for Products instead is named the same way.
  const products = fakeFetch(
    [{ status: 403, body: `{"error":{"message":"Having the 'rak_product_write' permission would allow this request to continue."}}` }],
    [],
  );
  await assert.rejects(
    checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", products, { log: () => {} }),
    /Products permission.*set Products to Write/,
  );

  // A 403 without a permission name still surfaces Stripe's own message.
  const other = fakeFetch([{ status: 403, body: '{"error":{"message":"This account is restricted."}}' }], []);
  await assert.rejects(
    checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", other, { log: () => {} }),
    /cannot create a checkout: This account is restricted/,
  );
});

test("health check (Stripe): expire failing still passes the key, but is logged", async () => {
  const logs: string[] = [];
  const f = fakeFetch(
    [
      { body: '{"id":"cs_test_hc3","url":"https://checkout.stripe.com/c/pay/cs_test_hc3"}' },
      { status: 500, body: '{"error":{"message":"An unknown error occurred"}}' },
    ],
    [],
  );
  const res = await checkProviderKeys("stripe", { secretKey: "rk_test_x" }, "sandbox", f, {
    log: (m) => logs.push(m),
  });
  assert.equal(res.ok, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cs_test_hc3/);
  assert.match(logs[0], /500/);
});
