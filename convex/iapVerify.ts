"use node";

/**
 * Apple In-App Purchase receipt verification.
 *
 * SECURITY: Never trust client-supplied productId / transactionId on their own.
 * The receipt is verified against Apple's servers and the granted entitlement
 * is derived ONLY from what Apple says was actually purchased.
 *
 * verifyReceipt is Apple's legacy endpoint; for production we recommend the
 * App Store Server API + signed JWS validation, but verifyReceipt is still
 * accepted and is sufficient to close the trust-the-client exploit.
 */

import { action, internalAction } from "./_generated/server";
import { reportError } from "./helpers/reportError";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  SignedDataVerifier,
  Environment,
} from "@apple/app-store-server-library";
import { getAppleRootCertificates } from "./lib/appleRootCerts";
import { BILLING_GRACE_PERIOD_MS } from "./helpers/subscription";
import { refreshGooglePurchaseExpiry } from "./iapVerifyGoogle";

const PRODUCTION_URL = "https://buy.itunes.apple.com/verifyReceipt";
const SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

const PRODUCT_IDS = {
  YEARLY: "com.planeraaitravelplanner.pro.yearly",
  MONTHLY: "com.planeraaitravelplanner.pro.monthly",
  SINGLE_TRIP: "com.planeraaitravelplanner.trip.single",
};

const SUBSCRIPTION_PRODUCT_IDS = [PRODUCT_IDS.YEARLY, PRODUCT_IDS.MONTHLY];

// Apple sometimes returns these spuriously; retrying usually clears them.
//  21002 — receipt-data malformed/missing (often transient on Apple's side)
//  21005 — receipt server temporarily unavailable
const TRANSIENT_APPLE_STATUSES = new Set([21002, 21005]);

interface VerifyReceiptResponse {
  status: number;
  environment?: string;
  receipt?: {
    bundle_id?: string;
    in_app?: Array<{
      product_id: string;
      transaction_id: string;
      original_transaction_id?: string;
      purchase_date_ms?: string;
      expires_date_ms?: string;
    }>;
  };
  latest_receipt_info?: Array<{
    product_id: string;
    transaction_id: string;
    original_transaction_id?: string;
    purchase_date_ms?: string;
    expires_date_ms?: string;
  }>;
  pending_renewal_info?: Array<unknown>;
}

async function callVerify(url: string, body: Record<string, unknown>): Promise<VerifyReceiptResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`verifyReceipt HTTP ${res.status}`);
  }
  return (await res.json()) as VerifyReceiptResponse;
}

async function verifyAppleReceipt(receipt: string): Promise<VerifyReceiptResponse> {
  const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET;
  const body: Record<string, unknown> = {
    "receipt-data": receipt,
    "exclude-old-transactions": false,
  };
  if (sharedSecret) body.password = sharedSecret;

  // Always try production first; on status 21007, retry sandbox. Retry a few
  // times on transient Apple statuses (21002/21005) with a short backoff —
  // 21002 in particular is frequently spurious and clears on a retry.
  const MAX_ATTEMPTS = 3;
  let resp: VerifyReceiptResponse | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    resp = await callVerify(PRODUCTION_URL, body);
    if (resp.status === 21007) {
      resp = await callVerify(SANDBOX_URL, body);
    }
    if (!TRANSIENT_APPLE_STATUSES.has(resp.status)) break;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return resp as VerifyReceiptResponse;
}

/**
 * Latest (max) `expires_date_ms` for the given subscription products across
 * the verified receipt. Apple returns ALL auto-renewal transactions in
 * `latest_receipt_info`, so re-verifying the original receipt yields the
 * current period's expiry even after several monthly renewals.
 */
function latestSubscriptionExpiry(
  resp: VerifyReceiptResponse,
  productIds: string[]
): number | undefined {
  const all = [
    ...(resp.latest_receipt_info ?? []),
    ...(resp.receipt?.in_app ?? []),
  ];
  const expiries = all
    .filter((t) => productIds.includes(t.product_id) && t.expires_date_ms)
    .map((t) => Number(t.expires_date_ms))
    .filter((n) => Number.isFinite(n) && n > 0);
  return expiries.length ? Math.max(...expiries) : undefined;
}

/** original_transaction_id of the most recent subscription transaction. */
function latestOriginalTransactionId(
  resp: VerifyReceiptResponse,
  productIds: string[]
): string | undefined {
  const all = [
    ...(resp.latest_receipt_info ?? []),
    ...(resp.receipt?.in_app ?? []),
  ];
  const latest = all
    .filter((t) => productIds.includes(t.product_id) && t.expires_date_ms)
    .sort((a, b) => Number(b.expires_date_ms) - Number(a.expires_date_ms))[0];
  return latest?.original_transaction_id ?? latest?.transaction_id;
}

/**
 * A StoreKit 2 signed transaction (JWS) has three base64url segments separated
 * by dots. The legacy App Store receipt is a single base64 blob (no dots).
 * expo-iap v3 surfaces the JWS in `purchaseToken` on iOS, which the LEGACY
 * `verifyReceipt` endpoint rejects as malformed (status 21002) — so we must
 * route JWS tokens through StoreKit 2 verification instead.
 */
function looksLikeJws(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

interface DecodedStoreKit2Tx {
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  expiresDate?: number;
  bundleId?: string;
}

/**
 * Verify a StoreKit 2 signed transaction JWS against Apple's certificate
 * chain (production first, then sandbox) and return the decoded payload.
 * Returns null if the signature/chain can't be validated in either context.
 */
async function verifyStoreKit2Transaction(
  ctx: any,
  jws: string
): Promise<DecodedStoreKit2Tx | null> {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    await reportError(
      ctx,
      "iapVerify:sk2:config",
      new Error("APPLE_BUNDLE_ID not configured"),
      {}
    );
    return null;
  }
  const appAppleId = process.env.APPLE_APP_APPLE_ID
    ? Number(process.env.APPLE_APP_APPLE_ID)
    : undefined;
  const roots = getAppleRootCertificates();

  for (const env of [Environment.PRODUCTION, Environment.SANDBOX]) {
    try {
      const verifier = new SignedDataVerifier(
        roots,
        /* enableOnlineChecks */ false,
        env,
        bundleId,
        env === Environment.PRODUCTION ? appAppleId : undefined
      );
      const tx: any = await verifier.verifyAndDecodeTransaction(jws);
      const transactionId = String(tx.transactionId);
      return {
        productId: String(tx.productId),
        transactionId,
        originalTransactionId: String(tx.originalTransactionId ?? transactionId),
        expiresDate:
          typeof tx.expiresDate === "number" ? tx.expiresDate : undefined,
        bundleId: tx.bundleId ? String(tx.bundleId) : undefined,
      };
    } catch {
      // Try the next environment.
    }
  }
  return null;
}

/**
 * Verify a purchase with Apple and apply the entitlement.
 * Replaces the legacy `users.processApplePurchase` mutation.
 */
export const verifyAndApplyApplePurchase = action({
  args: {
    token: v.string(),
    productId: v.string(),
    transactionId: v.string(),
    receipt: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    type: v.optional(v.string()),
    expiresAt: v.optional(v.float64()),
    creditsAdded: v.optional(v.float64()),
    totalCredits: v.optional(v.float64()),
    alreadyProcessed: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // 1. Authenticate the caller
    const user: any = await ctx.runQuery(internal.authNativeDb.getUserSettings, {
      userId: "", // will be ignored — we look up via session token below
    }).catch(() => null);
    // Resolve userId from the session token
    const session: any = await ctx.runQuery(internal.authNativeDb.getSessionByToken, {
      token: args.token,
    });
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      return { success: false, error: "Authentication required" };
    }
    const userId: string = session.userId;

    // 2. Basic input sanity
    if (!args.receipt || args.receipt.length < 20) {
      return { success: false, error: "Missing or malformed receipt." };
    }
    if (!Object.values(PRODUCT_IDS).includes(args.productId)) {
      return { success: false, error: "Unknown product." };
    }

    // 2b. StoreKit 2 path: expo-iap v3 sends a signed transaction JWS on iOS,
    // which the legacy verifyReceipt endpoint rejects (status 21002). Verify it
    // against Apple's certificate chain directly and apply the entitlement.
    if (looksLikeJws(args.receipt)) {
      let decoded: DecodedStoreKit2Tx | null;
      try {
        decoded = await verifyStoreKit2Transaction(ctx, args.receipt);
      } catch (e) {
        await reportError(ctx, "iapVerify:sk2:verify", e, { productId: args.productId });
        return { success: false, error: "Could not verify purchase with Apple." };
      }
      if (!decoded) {
        return { success: false, error: "Purchase could not be verified." };
      }

      // Bundle must match.
      const expectedBundle = process.env.APPLE_BUNDLE_ID;
      if (expectedBundle && decoded.bundleId && decoded.bundleId !== expectedBundle) {
        return { success: false, error: "Receipt bundle mismatch." };
      }

      // The verified transaction is authoritative — trust its product, not the
      // client-supplied productId.
      const verifiedProductId = decoded.productId;
      if (!Object.values(PRODUCT_IDS).includes(verifiedProductId)) {
        return { success: false, error: "Unknown product." };
      }

      let sk2ExpiresAt: number | undefined;
      if (
        verifiedProductId === PRODUCT_IDS.YEARLY ||
        verifiedProductId === PRODUCT_IDS.MONTHLY
      ) {
        sk2ExpiresAt = decoded.expiresDate;
        if (!sk2ExpiresAt) {
          return { success: false, error: "Subscription expiry missing." };
        }
        // Allow the 16-day billing grace window so a lapsed-but-recoverable sub
        // still restores; the renewal cron keeps it fresh afterwards.
        if (sk2ExpiresAt + BILLING_GRACE_PERIOD_MS < Date.now()) {
          return { success: false, error: "Subscription is not active." };
        }
      }

      const sk2Result: {
        success: boolean;
        alreadyProcessed?: boolean;
        type?: string;
        expiresAt?: number;
        creditsAdded?: number;
        totalCredits?: number;
      } = await ctx.runMutation(internal.users.applyVerifiedApplePurchase, {
        userId,
        productId: verifiedProductId,
        transactionId: decoded.transactionId,
        receipt: args.receipt,
        expiresAt: sk2ExpiresAt,
        originalTransactionId: decoded.originalTransactionId,
      });
      return sk2Result;
    }

    // 3. Verify the receipt with Apple (legacy base64 receipt path)
    let resp: VerifyReceiptResponse;
    try {
      resp = await verifyAppleReceipt(args.receipt);
    } catch (e) {
      console.error("[IAP] verifyReceipt error:", e);
      await reportError(ctx, "iapVerify:verifyAppleReceipt", e, { productId: args.productId });
      return { success: false, error: "Could not verify purchase with Apple." };
    }
    if (resp.status !== 0) {
      console.error("[IAP] verifyReceipt status:", resp.status);
      await reportError(ctx, "iapVerify:badStatus", new Error(`Apple status ${resp.status}`), { productId: args.productId, status: resp.status });
      return { success: false, error: `Apple receipt status ${resp.status}` };
    }

    // 4. Bundle ID must match the app
    const expectedBundle = process.env.APPLE_BUNDLE_ID;
    if (expectedBundle && resp.receipt?.bundle_id && resp.receipt.bundle_id !== expectedBundle) {
      return { success: false, error: "Receipt bundle mismatch." };
    }

    // 5. Look for the claimed transaction in the verified receipt.
    const allTx = [
      ...(resp.latest_receipt_info ?? []),
      ...(resp.receipt?.in_app ?? []),
    ];
    const matched = allTx.find(
      (t) => t.transaction_id === args.transactionId && t.product_id === args.productId
    );
    if (!matched) {
      return { success: false, error: "Transaction not found in verified receipt." };
    }

    // Stable per-subscription key Apple uses in renewals + server notifications.
    const originalTransactionId =
      matched.original_transaction_id ?? matched.transaction_id;

    // 6. For subscriptions, derive expiry from Apple's response (don't trust client time).
    let expiresAt: number | undefined;
    if (
      args.productId === PRODUCT_IDS.YEARLY ||
      args.productId === PRODUCT_IDS.MONTHLY
    ) {
      // Use the latest matching transaction's expires_date_ms
      const subTx = [...allTx]
        .filter((t) => t.product_id === args.productId && t.expires_date_ms)
        .sort((a, b) => Number(b.expires_date_ms) - Number(a.expires_date_ms))[0];
      if (subTx?.expires_date_ms) {
        expiresAt = Number(subTx.expires_date_ms);
      }
      if (!expiresAt || expiresAt < Date.now()) {
        return { success: false, error: "Subscription is not active." };
      }
    }

    // 7. Apply the verified entitlement via internal mutation
    const result: {
      success: boolean;
      alreadyProcessed?: boolean;
      type?: string;
      expiresAt?: number;
      creditsAdded?: number;
      totalCredits?: number;
    } = await ctx.runMutation(internal.users.applyVerifiedApplePurchase, {
      userId,
      productId: args.productId,
      transactionId: args.transactionId,
      receipt: args.receipt,
      expiresAt,
      originalTransactionId,
    });

    return result;
  },
});

// =================== subscription renewal refresh ===========================

/**
 * Re-verify a single user's stored subscription receipt with Apple and push
 * the freshest expiry into their plan. Returns the outcome string from
 * `users.refreshSubscriptionExpiry` ("refreshed" | "downgraded" | ...).
 */
async function refreshOneSubscription(ctx: any, userId: string): Promise<string> {
  const sub: {
    receipt: string;
    productId: string;
    platform: "ios" | "android";
  } | null = await ctx.runQuery(internal.users.getLatestSubscriptionReceipt, {
    userId,
  });
  if (!sub?.receipt) return "no_receipt";

  // Play subscriptions must be re-verified against Google. Sending a Play
  // purchase token to Apple's verifyReceipt would fail every run and, without
  // this branch, silently downgrade paying Android subscribers.
  if (sub.platform === "android") {
    const fresh = await refreshGooglePurchaseExpiry(sub.receipt);
    if (!fresh) return "unchanged";
    const googleResult: { action: string } = await ctx.runMutation(
      internal.users.refreshSubscriptionExpiry,
      {
        userId,
        expiresAt: fresh.expiresAt,
        originalTransactionId: fresh.originalTransactionId,
      }
    );
    return googleResult.action;
  }

  const resp = await verifyAppleReceipt(sub.receipt);
  if (resp.status !== 0) {
    // 21006 = receipt valid but subscription expired/cancelled at Apple.
    // Don't downgrade off a transient/odd status here; the grace-aware
    // entitlement checks already protect the user. Try again next run.
    console.error(`[IAP] refresh status ${resp.status}`);
    return "unchanged";
  }

  const expiresAt = latestSubscriptionExpiry(resp, SUBSCRIPTION_PRODUCT_IDS);
  if (!expiresAt) return "unchanged";

  const originalTransactionId = latestOriginalTransactionId(
    resp,
    SUBSCRIPTION_PRODUCT_IDS
  );

  const result: { action: string } = await ctx.runMutation(
    internal.users.refreshSubscriptionExpiry,
    { userId, expiresAt, originalTransactionId }
  );
  return result.action;
}

/**
 * Cron entry point: re-verify subscriptions at/near expiry so auto-renewing
 * subscribers keep premium without a server-to-server notification pipeline.
 */
export const refreshExpiringSubscriptions = internalAction({
  args: {},
  returns: v.object({
    checked: v.float64(),
    refreshed: v.float64(),
    downgraded: v.float64(),
    failed: v.float64(),
  }),
  handler: async (ctx) => {
    const candidates: Array<{ userId: string }> = await ctx.runQuery(
      internal.users.getSubscriptionsNeedingRefresh,
      {}
    );
    let refreshed = 0;
    let downgraded = 0;
    let failed = 0;
    for (const c of candidates) {
      try {
        const action = await refreshOneSubscription(ctx, c.userId);
        if (action === "refreshed") refreshed++;
        else if (action === "downgraded") downgraded++;
      } catch (e) {
        failed++;
        await reportError(ctx, "iapVerify:refreshSubscription", e, {});
      }
    }
    console.log(
      `[IAP] subscription refresh: checked=${candidates.length} renewed=${refreshed} downgraded=${downgraded} failed=${failed}`
    );
    return { checked: candidates.length, refreshed, downgraded, failed };
  },
});

/**
 * Public action: let an authenticated client refresh its own subscription on
 * demand (e.g. on app launch). Cheap, idempotent, and self-healing for users
 * whose monthly renewal hasn't been reflected yet.
 */
export const refreshMySubscription = action({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean(), action: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const session: any = await ctx.runQuery(
      internal.authNativeDb.getSessionByToken,
      { token: args.token }
    );
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      return { success: false };
    }
    try {
      const action = await refreshOneSubscription(ctx, session.userId);
      return { success: true, action };
    } catch (e) {
      await reportError(ctx, "iapVerify:refreshMySubscription", e, {});
      return { success: false };
    }
  },
});

// ============== App Store Server Notifications (V2) processing ===============

/**
 * Verify + apply a single App Store Server Notification (V2).
 *
 * The signed payload is a JWS whose `x5c` certificate chain is validated
 * against Apple's bundled root (see `lib/appleRootCerts.ts`). We try the
 * Production trust context first, then Sandbox, so a single endpoint handles
 * both. Called from the public HTTP webhook in `http.ts` (which runs in the
 * V8 runtime and can't use Node crypto directly).
 *
 * Returns `{ verified }`. The webhook maps `verified=false` → HTTP 400 so
 * forged payloads are rejected and never touch user data.
 */
export const processAppleNotification = internalAction({
  args: { signedPayload: v.string() },
  returns: v.object({ verified: v.boolean(), action: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const bundleId = process.env.APPLE_BUNDLE_ID;
    if (!bundleId) {
      await reportError(
        ctx,
        "iapVerify:notification:config",
        new Error("APPLE_BUNDLE_ID not configured"),
        {}
      );
      return { verified: false };
    }
    const appAppleId = process.env.APPLE_APP_APPLE_ID
      ? Number(process.env.APPLE_APP_APPLE_ID)
      : undefined;
    const roots = getAppleRootCertificates();

    // Verify against both trust contexts; the correct one decodes cleanly.
    let payload: any;
    let tx: any;
    let lastErr: unknown;
    for (const env of [Environment.PRODUCTION, Environment.SANDBOX]) {
      try {
        const verifier = new SignedDataVerifier(
          roots,
          /* enableOnlineChecks */ false,
          env,
          bundleId,
          // appAppleId is only validated (and required) for Production.
          env === Environment.PRODUCTION ? appAppleId : undefined
        );
        payload = await verifier.verifyAndDecodeNotification(args.signedPayload);
        const sti = payload?.data?.signedTransactionInfo;
        if (sti) tx = await verifier.verifyAndDecodeTransaction(sti);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        payload = undefined;
        tx = undefined;
      }
    }

    if (!payload) {
      // Signature/chain invalid — treat as forged/untrusted. Do NOT report as
      // an error (avoids alert noise from internet scanners hitting the URL).
      console.error("[IAP] notification verification failed");
      return { verified: false };
    }

    const originalTransactionId: string | undefined =
      tx?.originalTransactionId ?? tx?.transactionId;
    if (!originalTransactionId) {
      // Verified but no transaction (e.g. TEST notification) — acknowledge.
      console.log(
        `[IAP] notification ${payload.notificationType} (no tx) acknowledged`
      );
      return { verified: true, action: "ack" };
    }

    const expiresAt =
      typeof tx?.expiresDate === "number" ? tx.expiresDate : undefined;

    try {
      const result: { action: string } = await ctx.runMutation(
        internal.users.applyAppleNotification,
        {
          originalTransactionId,
          notificationType: String(payload.notificationType),
          subtype: payload.subtype ? String(payload.subtype) : undefined,
          productId: tx?.productId ? String(tx.productId) : undefined,
          expiresAt,
        }
      );
      console.log(
        `[IAP] notification ${payload.notificationType}/${payload.subtype ?? "-"} -> ${result.action}`
      );
      return { verified: true, action: result.action };
    } catch (e) {
      await reportError(ctx, "iapVerify:applyNotification", e, {
        notificationType: String(payload.notificationType),
      });
      // Verified payload but processing failed — surface 500 so Apple retries.
      throw e;
    }
  },
});
