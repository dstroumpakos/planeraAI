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

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const PRODUCTION_URL = "https://buy.itunes.apple.com/verifyReceipt";
const SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

const PRODUCT_IDS = {
  YEARLY: "com.planeraaitravelplanner.pro.yearly",
  MONTHLY: "com.planeraaitravelplanner.pro.monthly",
  SINGLE_TRIP: "com.planeraaitravelplanner.trip.single",
};

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

  // Always try production first; on status 21007, retry sandbox.
  let resp = await callVerify(PRODUCTION_URL, body);
  if (resp.status === 21007) {
    resp = await callVerify(SANDBOX_URL, body);
  }
  return resp;
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

    // 3. Verify the receipt with Apple
    let resp: VerifyReceiptResponse;
    try {
      resp = await verifyAppleReceipt(args.receipt);
    } catch (e) {
      console.error("[IAP] verifyReceipt error:", e);
      return { success: false, error: "Could not verify purchase with Apple." };
    }
    if (resp.status !== 0) {
      console.error("[IAP] verifyReceipt status:", resp.status);
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
    });

    return result;
  },
});
