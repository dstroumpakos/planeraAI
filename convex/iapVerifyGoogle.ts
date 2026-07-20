"use node";

/**
 * Google Play in-app purchase verification.
 *
 * SECURITY: mirrors the guarantee in `iapVerify.ts` — never trust the
 * client-supplied productId. The purchase token is verified against the Google
 * Play Developer API and the granted entitlement is derived ONLY from what
 * Google reports.
 *
 * Required environment variables (Convex dashboard):
 *   ANDROID_PACKAGE_NAME                    e.g. com.dstroump.planeraaitravelplanner
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL       service account with "View financial data"
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY PEM private key from the service account JSON
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import * as jose from "jose";
import { reportError } from "./helpers/reportError";
import { BILLING_GRACE_PERIOD_MS } from "./helpers/subscription";

const PRODUCT_IDS = {
  YEARLY: "com.planeraaitravelplanner.pro.yearly",
  MONTHLY: "com.planeraaitravelplanner.pro.monthly",
  SINGLE_TRIP: "com.planeraaitravelplanner.trip.single",
};

const SUBSCRIPTION_PRODUCT_IDS = [PRODUCT_IDS.YEARLY, PRODUCT_IDS.MONTHLY];

const ANDROID_PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/**
 * Subscription states Google considers entitling. CANCELED still grants access
 * until the paid period runs out — the user turned off auto-renew but has time
 * remaining. ON_HOLD/PAUSED/EXPIRED do not entitle.
 */
const ENTITLING_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
]);

function packageName(): string {
  const pkg = process.env.ANDROID_PACKAGE_NAME;
  if (!pkg) throw new Error("ANDROID_PACKAGE_NAME not configured");
  return pkg;
}

/**
 * Exchange the service-account key for an androidpublisher access token using
 * the OAuth2 JWT-bearer flow. Tokens last an hour; Convex actions are short
 * lived so we simply mint one per verification rather than caching.
 */
async function getPlayAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Google Play service account credentials not configured");
  }

  // Env vars usually carry the PEM with escaped newlines; importPKCS8 needs real ones.
  const pem = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  const privateKey = await jose.importPKCS8(pem, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new jose.SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Play token exchange failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Play token exchange returned no access_token");
  return json.access_token;
}

async function playGet(path: string): Promise<any> {
  const accessToken = await getPlayAccessToken();
  const res = await fetch(`${ANDROID_PUBLISHER}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Play API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

interface PlaySubscription {
  productId: string;
  expiresAt: number;
  orderId?: string;
  state?: string;
}

/**
 * Resolve a subscription purchase token via subscriptionsv2. The response
 * carries one line item per base plan; we take the furthest expiry, which is
 * the currently-paid-through date after any renewal.
 */
async function verifyPlaySubscription(purchaseToken: string): Promise<PlaySubscription | null> {
  const data = await playGet(
    `/applications/${encodeURIComponent(packageName())}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`
  );

  const lineItems: any[] = Array.isArray(data?.lineItems) ? data.lineItems : [];
  const entitling = lineItems
    .map((li) => ({
      productId: String(li?.productId ?? ""),
      expiry: li?.expiryTime ? Date.parse(li.expiryTime) : NaN,
    }))
    .filter(
      (li) =>
        SUBSCRIPTION_PRODUCT_IDS.includes(li.productId) &&
        Number.isFinite(li.expiry)
    )
    .sort((a, b) => b.expiry - a.expiry)[0];

  if (!entitling) return null;

  return {
    productId: entitling.productId,
    expiresAt: entitling.expiry,
    orderId: data?.latestOrderId ? String(data.latestOrderId) : undefined,
    state: data?.subscriptionState ? String(data.subscriptionState) : undefined,
  };
}

/** Resolve a one-time product purchase token. purchaseState 0 === purchased. */
async function verifyPlayProduct(
  productId: string,
  purchaseToken: string
): Promise<{ orderId?: string } | null> {
  const data = await playGet(
    `/applications/${encodeURIComponent(packageName())}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`
  );
  if (data?.purchaseState !== 0) return null;
  return { orderId: data?.orderId ? String(data.orderId) : undefined };
}

/**
 * Verify a Play purchase token and apply the resulting entitlement.
 *
 * `productId` is only a routing hint for which Play endpoint to call; the
 * entitlement itself comes from Google's response.
 */
export const verifyAndApplyGooglePurchase = action({
  args: {
    token: v.string(),
    productId: v.string(),
    transactionId: v.string(),
    purchaseToken: v.string(),
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
    const session: any = await ctx.runQuery(internal.authNativeDb.getSessionByToken, {
      token: args.token,
    });
    if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
      return { success: false, error: "Authentication required" };
    }
    const userId: string = session.userId;

    // 2. Basic input sanity
    if (!args.purchaseToken || args.purchaseToken.length < 20) {
      return { success: false, error: "Missing or malformed purchase token." };
    }
    if (!Object.values(PRODUCT_IDS).includes(args.productId)) {
      return { success: false, error: "Unknown product." };
    }

    const isSubscription = SUBSCRIPTION_PRODUCT_IDS.includes(args.productId);

    try {
      if (isSubscription) {
        const sub = await verifyPlaySubscription(args.purchaseToken);
        if (!sub) {
          return { success: false, error: "Purchase could not be verified." };
        }
        if (sub.state && !ENTITLING_STATES.has(sub.state)) {
          return { success: false, error: "Subscription is not active." };
        }
        // Allow the billing grace window so a lapsed-but-recoverable sub still
        // restores; the renewal cron keeps it fresh afterwards.
        if (sub.expiresAt + BILLING_GRACE_PERIOD_MS < Date.now()) {
          return { success: false, error: "Subscription is not active." };
        }

        const result: {
          success: boolean;
          alreadyProcessed?: boolean;
          type?: string;
          expiresAt?: number;
          creditsAdded?: number;
          totalCredits?: number;
        } = await ctx.runMutation(internal.users.applyVerifiedApplePurchase, {
          userId,
          // Google's line item is authoritative, not the client's claim.
          productId: sub.productId,
          transactionId: sub.orderId || args.transactionId,
          receipt: args.purchaseToken,
          expiresAt: sub.expiresAt,
          // A Play purchase token is stable across renewals, so it is the
          // analog of Apple's originalTransactionId for mapping a subscription
          // back to its owner.
          originalTransactionId: args.purchaseToken,
          platform: "android" as const,
        });
        return result;
      }

      const product = await verifyPlayProduct(args.productId, args.purchaseToken);
      if (!product) {
        return { success: false, error: "Purchase could not be verified." };
      }

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
        transactionId: product.orderId || args.transactionId,
        receipt: args.purchaseToken,
        platform: "android" as const,
      });
      return result;
    } catch (e) {
      console.error("[IAP][Play] verification error:", e);
      await reportError(ctx, "iapVerifyGoogle:verify", e, {
        productId: args.productId,
      });
      return { success: false, error: "Could not verify purchase with Google Play." };
    }
  },
});

/**
 * Re-verify a stored Play subscription token and return the freshest expiry,
 * or null when it can't be established. Used by the renewal cron in
 * `iapVerify.refreshExpiringSubscriptions`.
 */
export async function refreshGooglePurchaseExpiry(
  purchaseToken: string
): Promise<{ expiresAt: number; originalTransactionId: string } | null> {
  const sub = await verifyPlaySubscription(purchaseToken);
  if (!sub) return null;
  if (sub.state && !ENTITLING_STATES.has(sub.state)) return null;
  return { expiresAt: sub.expiresAt, originalTransactionId: purchaseToken };
}
