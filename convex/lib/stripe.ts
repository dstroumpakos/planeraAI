/**
 * Minimal Stripe REST client for the Convex V8 runtime.
 *
 * We deliberately do NOT use the `stripe` npm SDK. This backend is shared with
 * the iOS and Android bundles, and the SDK is Node-only — pulling it in would
 * force every billing function into `"use node"` (slower cold starts, bigger
 * install) in exchange for what are, in the end, form-encoded POSTs. `fetch`
 * plus Web Crypto covers everything the web upgrade flow needs, webhook
 * signature verification included.
 *
 * Stripe's API is `application/x-www-form-urlencoded` with bracket syntax for
 * nested data (`line_items[0][price]`, `subscription_data[metadata][userId]`),
 * which `toFormBody` below produces from ordinary JS objects.
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe API version this code is written against. Pinned so a Stripe-side
 *  default upgrade can't change response shapes underneath us. */
const STRIPE_API_VERSION = "2024-06-20";

function flatten(value: any, prefix: string, out: string[][]): void {
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        const key = prefix ? `${prefix}[${k}]` : k;
        if (Array.isArray(v)) {
            v.forEach((item, i) => {
                if (item !== null && typeof item === "object") {
                    flatten(item, `${key}[${i}]`, out);
                } else {
                    out.push([`${key}[${i}]`, String(item)]);
                }
            });
        } else if (typeof v === "object") {
            flatten(v, key, out);
        } else {
            out.push([key, String(v)]);
        }
    }
}

export function toFormBody(params: Record<string, any>): string {
    const pairs: string[][] = [];
    flatten(params, "", pairs);
    return pairs
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
}

function secretKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    return key;
}

/**
 * Call the Stripe API. `params` are form-encoded for writes and appended as a
 * query string for reads. Throws with Stripe's own error message so failures
 * surface something actionable in the Convex logs.
 *
 * `idempotencyKey` makes a retried POST safe — Stripe returns the original
 * response instead of creating a second object. Pass one for anything that
 * creates a customer or a subscription.
 */
export async function stripeRequest<T = any>(
    path: string,
    options: {
        method?: "GET" | "POST" | "DELETE";
        params?: Record<string, any>;
        idempotencyKey?: string;
    } = {}
): Promise<T> {
    const method = options.method ?? "GET";
    const params = options.params ?? {};

    let url = `${STRIPE_API}${path}`;
    let body: string | undefined;

    if (method === "GET") {
        const qs = toFormBody(params);
        if (qs) url += `?${qs}`;
    } else {
        body = toFormBody(params);
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${secretKey()}`,
        "Stripe-Version": STRIPE_API_VERSION,
    };
    if (body !== undefined) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    if (options.idempotencyKey) {
        headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();

    let json: any;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`Stripe returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
        const err = json?.error;
        throw new Error(
            `Stripe ${method} ${path} failed (${res.status}): ${err?.message ?? text.slice(0, 200)}`
        );
    }
    return json as T;
}

// ============================ Webhook signatures ============================

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Length-independent, value-constant comparison of two hex digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * Verify a `Stripe-Signature` header against the raw request body.
 *
 * The header looks like `t=1699999999,v1=<hex>,v1=<hex>` — more than one `v1`
 * appears while a webhook secret is being rotated, so any match counts. The
 * signed payload is `${timestamp}.${rawBody}`, which is why the caller MUST
 * pass the body exactly as received: re-serializing parsed JSON changes the
 * bytes and every signature then fails.
 *
 * The timestamp check is what stops an attacker replaying a genuine, correctly
 * signed event forever.
 */
export async function verifyStripeSignature(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
    toleranceSeconds = 300
): Promise<boolean> {
    if (!signatureHeader) return false;

    let timestamp: string | null = null;
    const signatures: string[] = [];
    for (const part of signatureHeader.split(",")) {
        const [k, val] = part.split("=", 2);
        if (k?.trim() === "t") timestamp = val?.trim() ?? null;
        else if (k?.trim() === "v1" && val) signatures.push(val.trim());
    }
    if (!timestamp || signatures.length === 0) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${timestamp}.${rawBody}`)
    );
    const expected = hex(mac);

    return signatures.some((s) => timingSafeEqualHex(s, expected));
}

// ================================ Types =====================================

export interface StripeSubscription {
    id: string;
    customer: string;
    status: string;
    /** Present up to API version 2024-12-18; removed in 2025-03-31.basil. */
    current_period_end?: number;
    cancel_at_period_end?: boolean;
    items?: {
        data: Array<{
            /** Where basil and later put the period end. */
            current_period_end?: number;
            price?: { id?: string; recurring?: { interval?: string } };
        }>;
    };
    metadata?: Record<string, string>;
}

/**
 * Statuses that should keep premium switched on. `past_due` and `unpaid` are
 * included on purpose: Stripe is still retrying the card, and cutting access
 * mid-dunning churns people who would have paid. Stripe's own retry schedule
 * ends in `canceled`, which does revoke.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

export function subscriptionGrantsAccess(status: string): boolean {
    return ENTITLING_STATUSES.has(status);
}

/**
 * The end of the current billing period, in milliseconds, from either API
 * shape.
 *
 * Stripe's 2025-03-31.basil release moved `current_period_end` from the
 * Subscription object onto each subscription item. Which one an event carries
 * depends on the API version configured on the webhook endpoint — a setting
 * that lives in the Stripe dashboard and can be changed without touching this
 * code, so both are read rather than assuming either.
 *
 * Returns undefined when neither is present; callers must treat that as "do
 * not grant" rather than as "no expiry".
 */
export function subscriptionPeriodEndMs(
    sub: StripeSubscription
): number | undefined {
    const seconds =
        sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    return typeof seconds === "number" ? seconds * 1000 : undefined;
}

/** "month" | "year" from a subscription's first recurring price. */
export function subscriptionInterval(
    sub: StripeSubscription
): "monthly" | "yearly" | undefined {
    const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
    if (interval === "year") return "yearly";
    if (interval === "month") return "monthly";
    return undefined;
}
