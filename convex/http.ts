import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  sha256Hex,
  parseBearer,
  buildCacheKey,
  normalizeDestinationKey,
  normalizePreferences,
  canonicalizeDestination,
  cityTokenOf,
  partnerError,
  partnerJson,
  corsPreflight,
} from "./partnerApiAuth";
import { serializeItinerary } from "./partnerApi";

const http = httpRouter();

/**
 * App Store Server Notifications V2 webhook.
 *
 * Configure this URL in App Store Connect (Production + Sandbox):
 *   https://<your-deployment>.convex.site/apple/notifications
 *
 * Apple POSTs `{ "signedPayload": "<JWS>" }`. We hand the JWS to a Node action
 * that validates the certificate chain against Apple's root and applies the
 * subscription state change. This runs in the V8 runtime, so all crypto lives
 * in the `"use node"` action `iapVerify.processAppleNotification`.
 *
 * Responses:
 *   200 — verified & processed (or a verified TEST notification)
 *   400 — bad request / signature could not be verified (reject forgeries)
 *   500 — verified but processing failed → Apple will retry
 */
http.route({
  path: "/apple/notifications",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let signedPayload: string | undefined;
    try {
      const body = await request.json();
      signedPayload = body?.signedPayload;
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (!signedPayload || typeof signedPayload !== "string") {
      return new Response("Missing signedPayload", { status: 400 });
    }

    // Throws → 500 (verified payload, processing failed) so Apple retries.
    const result = await ctx.runAction(
      internal.iapVerify.processAppleNotification,
      { signedPayload }
    );

    if (!result.verified) {
      return new Response("Invalid signature", { status: 400 });
    }
    return new Response("OK", { status: 200 });
  }),
});

/**
 * Reservation Inbox — Postmark inbound webhook.
 *
 * Setup (one-time, outside the code):
 *   1. Postmark → Servers → Inbound → copy the inbound address.
 *   2. Point an MX record for `in.planera.app` at Postmark's inbound host.
 *   3. Set the inbound webhook URL to:
 *        https://<deployment>.convex.site/inbound/email?key=<RESERVATION_INBOUND_SECRET>
 *   4. Set RESERVATION_INBOUND_SECRET in the Convex environment.
 *
 * The shared secret is the only thing standing between the public internet and
 * a write path into user accounts, so a missing/incorrect key is a hard 401.
 * Everything after that is best-effort: content problems return 200 so Postmark
 * doesn't retry a message that will never parse.
 */
http.route({
  path: "/inbound/email",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.RESERVATION_INBOUND_SECRET;
    if (!expected) {
      console.error("[ReservationInbox] RESERVATION_INBOUND_SECRET not configured");
      return new Response("Not configured", { status: 503 });
    }

    const url = new URL(request.url);
    const provided = url.searchParams.get("key") ?? request.headers.get("X-Inbound-Secret") ?? "";
    if (!timingSafeEqual(provided, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // Postmark puts the address the message was delivered to in OriginalRecipient;
    // ToFull[0] is the fallback when a client rewrote the envelope.
    const recipient =
      payload?.OriginalRecipient ??
      payload?.ToFull?.[0]?.Email ??
      payload?.To ??
      undefined;

    // Fire and forget: mail servers should not wait on an LLM call. Postmark
    // treats the 200 as delivery; failures are surfaced through error reports.
    await ctx.scheduler.runAfter(0, internal.reservationsInbound.parseInboundEmail, {
      recipient,
      fromAddress: payload?.FromFull?.Email ?? payload?.From,
      subject: payload?.Subject,
      textBody: payload?.TextBody,
      htmlBody: payload?.HtmlBody,
      headers: payload?.Headers,
    });

    return new Response("OK", { status: 200 });
  }),
});

/**
 * Constant-time string compare, so a wrong secret can't be discovered by
 * timing the 401. Lengths are compared first (they are not secret).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ===========================================================================
// Partner Itinerary API — versioned /v1/ surface (e.g. spytrip.gr).
//
//   POST /v1/itineraries        — create (cache hit → 200, miss → 202 job)
//   GET  /v1/itineraries/{id}   — poll / retrieve
//
// Auth: per-partner Bearer key (Authorization: Bearer <key>), hashed lookup.
// Optional Idempotency-Key header dedupes retries. Returns structured JSON.
// ===========================================================================

const MAX_DAYS = 15;

// CORS preflight for the browser-callable Partner API (e.g. the playground).
http.route({
  path: "/v1/itineraries",
  method: "OPTIONS",
  handler: httpAction(async () => corsPreflight()),
});
http.route({
  pathPrefix: "/v1/itineraries/",
  method: "OPTIONS",
  handler: httpAction(async () => corsPreflight()),
});

/**
 * Authenticate the Bearer key on a request. Returns either the key doc or a
 * ready-to-return error Response.
 */
async function authenticatePartner(
  ctx: any,
  request: Request
): Promise<{ key: any } | { error: Response }> {
  const raw = parseBearer(request.headers.get("Authorization"));
  if (!raw) {
    return {
      error: partnerError("invalid_key", "Missing or malformed Authorization header."),
    };
  }
  const keyHash = await sha256Hex(raw);
  const key = await ctx.runQuery(internal.partnerApiAuth.getKeyByHash, {
    keyHash,
  });
  if (!key) {
    return { error: partnerError("invalid_key", "Unknown API key.") };
  }
  if (!key.active || key.revokedAt) {
    return { error: partnerError("revoked", "This API key has been revoked.") };
  }
  return { key };
}

http.route({
  path: "/v1/itineraries",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1) Auth
    const auth = await authenticatePartner(ctx, request);
    if ("error" in auth) return auth.error;
    const { key } = auth;

    // 2) Per-minute rate limit
    const rate = await ctx.runMutation(internal.partnerApiAuth.checkRequestRate, {
      keyId: key._id,
      rateLimitPerMin: key.rateLimitPerMin,
    });
    if (!rate.allowed) {
      return partnerError(
        "rate_limited",
        "Rate limit exceeded. Slow down and retry shortly.",
        { "Retry-After": String(rate.retryAfter) }
      );
    }
    await ctx.runMutation(internal.partnerApiAuth.touchKey, { keyId: key._id });

    // 3) Parse + validate body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return partnerError("validation_error", "Request body must be valid JSON.");
    }

    const rawDestination =
      typeof body?.destination === "string" ? body.destination.trim() : "";
    const days = body?.days;
    const preferences = Array.isArray(body?.preferences) ? body.preferences : [];
    const partnerRef =
      typeof body?.partner_ref === "string" && body.partner_ref.trim().length > 0
        ? body.partner_ref.trim()
        : key.partnerRef;
    const webhookUrl =
      typeof body?.webhook_url === "string" ? body.webhook_url.trim() : undefined;

    if (!rawDestination) {
      return partnerError("validation_error", "`destination` is required.");
    }
    if (
      typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > MAX_DAYS
    ) {
      return partnerError(
        "validation_error",
        `\`days\` must be an integer between 1 and ${MAX_DAYS}.`
      );
    }
    if (!preferences.every((p: any) => typeof p === "string")) {
      return partnerError(
        "validation_error",
        "`preferences` must be an array of strings."
      );
    }
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      return partnerError(
        "validation_error",
        "`webhook_url` must be an http(s) URL."
      );
    }

    const normPrefs = normalizePreferences(preferences);
    // Canonicalize "London"/"London, UK" -> "London, United Kingdom" so the
    // cache key matches our pre-generated entries instead of missing them.
    const cityToken = cityTokenOf(rawDestination);
    let destination = canonicalizeDestination(rawDestination);
    // Not a curated city — consult the learned-alias table so repeat requests
    // for the same city (any spelling) collapse onto the first-seen canonical.
    if (destination === rawDestination.trim()) {
      const learned = await ctx.runQuery(internal.partnerApi.lookupCanonical, {
        cityToken,
      });
      if (learned) destination = learned;
    }
    const cacheKey = buildCacheKey(destination, days, preferences);
    const normalizedDestination = normalizeDestinationKey(destination);
    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() || undefined;

    const origin = new URL(request.url).origin;
    const pollUrl = (id: string) => `${origin}/v1/itineraries/${id}`;

    // 4) Idempotency: a repeated key returns the same resource.
    if (idempotencyKey) {
      const prior = await ctx.runQuery(internal.partnerApi.findByIdempotency, {
        keyId: key._id,
        idempotencyKey,
      });
      if (prior) {
        if (prior.cacheKey !== cacheKey) {
          return partnerError(
            "idempotency_conflict",
            "Idempotency-Key was already used with different parameters."
          );
        }
        const view = serializeItinerary(prior);
        return partnerJson(
          { ...view, cached: prior.status === "ready", poll_url: pollUrl(prior.itineraryId) },
          prior.status === "ready" ? 200 : 202
        );
      }
    }

    // 5) Cache lookup — a hit costs zero LLM and no generation quota.
    const cachedHit = await ctx.runQuery(internal.partnerApi.findCached, {
      cacheKey,
    });
    if (cachedHit) {
      // Mint a partner-owned copy so GET stays strictly per-partner.
      const owned = await ctx.runMutation(internal.partnerApi.recordCacheHit, {
        keyId: key._id,
        partnerRef,
        idempotencyKey,
        destination,
        normalizedDestination,
        days,
        preferences: normPrefs,
        cacheKey,
        itinerary: cachedHit.itinerary,
        originSource: cachedHit.source,
      });
      // Track the free cache hit for analytics (not billed, no quota).
      await ctx.runMutation(internal.partnerApiAuth.recordCacheHit, {
        keyId: key._id,
      });
      const view = serializeItinerary(owned);
      return partnerJson(
        { ...view, cached: true, poll_url: pollUrl(owned.itineraryId) },
        200
      );
    }    // 6) Cache miss — consume a generation against daily/monthly caps.
    const consume = await ctx.runMutation(
      internal.partnerApiAuth.consumeGeneration,
      { keyId: key._id, dailyCap: key.dailyCap, monthlyCap: key.monthlyCap }
    );
    if (!consume.allowed) {
      const code =
        consume.code === "monthly_cap_exceeded"
          ? "monthly_cap_exceeded"
          : "daily_cap_exceeded";
      return partnerError(
        code,
        "Generation cap exceeded for this billing window."
      );
    }

    // 7) Record demand so the pre-generation budget can fill the gaps later
    // (pre-build the other common durations for this city on the next cron).
    await ctx.runMutation(internal.partnerApi.recordDemand, {
      destinationKey: normalizedDestination,
      destination,
      days,
    });

    // 7b) Lock in this spelling as the canonical for the city token so future
    // requests with a different spelling match the cache instead of re-running
    // the LLM. First spelling wins; later calls only bump lastSeenAt.
    await ctx.runMutation(internal.partnerApi.rememberCanonical, {
      cityToken,
      destination,
    });

    // 8) Enqueue async generation.
    const { itineraryId } = await ctx.runMutation(
      internal.partnerApi.enqueueGeneration,
      {
        keyId: key._id,
        partnerRef,
        idempotencyKey,
        destination,
        normalizedDestination,
        days,
        preferences: normPrefs,
        cacheKey,
        webhookUrl,
      }
    );

    return partnerJson(
      {
        itinerary_id: itineraryId,
        status: "queued",
        cached: false,
        poll_url: pollUrl(itineraryId),
      },
      202
    );
  }),
});

http.route({
  pathPrefix: "/v1/itineraries/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticatePartner(ctx, request);
    if ("error" in auth) return auth.error;
    const { key } = auth;

    const rate = await ctx.runMutation(internal.partnerApiAuth.checkRequestRate, {
      keyId: key._id,
      rateLimitPerMin: key.rateLimitPerMin,
    });
    if (!rate.allowed) {
      return partnerError(
        "rate_limited",
        "Rate limit exceeded. Slow down and retry shortly.",
        { "Retry-After": String(rate.retryAfter) }
      );
    }

    const path = new URL(request.url).pathname;
    const itineraryId = path.substring(path.lastIndexOf("/") + 1);
    if (!itineraryId) {
      return partnerError("not_found", "Itinerary id missing from path.");
    }

    const record = await ctx.runQuery(internal.partnerApi.getByItineraryId, {
      itineraryId,
    });
    if (!record) {
      return partnerError("not_found", "No itinerary with that id.");
    }
    // Partner isolation: a key can only read its own itineraries.
    if (record.keyId !== key._id) {
      return partnerError("forbidden", "This itinerary belongs to another partner.");
    }

    return partnerJson(serializeItinerary(record), 200);
  }),
});

// ---------------------------------------------------------------------------
// Partner Products API — bulk product ingestion for supplier partners.
//   POST /v1/products  — body { products: [ { type, title, ... } ] }
// Auth: per-partner Bearer key (same keys as /v1/itineraries). Ingested rows
// land in the review queue (status "pending") under the key's partner account.
// ---------------------------------------------------------------------------

const MAX_PRODUCTS_PER_REQUEST = 1000;
// Supplier keys carry rateLimitPerMin=0 (they don't use the itinerary API), so
// the products endpoint applies its own default when the key's limit is unset.
const PRODUCTS_RATE_LIMIT_PER_MIN = 120;

http.route({
  path: "/v1/products",
  method: "OPTIONS",
  handler: httpAction(async () => corsPreflight()),
});

http.route({
  path: "/v1/products",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticatePartner(ctx, request);
    if ("error" in auth) return auth.error;
    const { key } = auth;

    if (!key.accountId) {
      return partnerError(
        "forbidden",
        "This API key is not linked to a partner account."
      );
    }

    const rate = await ctx.runMutation(internal.partnerApiAuth.checkRequestRate, {
      keyId: key._id,
      rateLimitPerMin: key.rateLimitPerMin > 0 ? key.rateLimitPerMin : PRODUCTS_RATE_LIMIT_PER_MIN,
    });
    if (!rate.allowed) {
      return partnerError(
        "rate_limited",
        "Rate limit exceeded. Slow down and retry shortly.",
        { "Retry-After": String(rate.retryAfter) }
      );
    }
    await ctx.runMutation(internal.partnerApiAuth.touchKey, { keyId: key._id });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return partnerError("validation_error", "Request body must be valid JSON.");
    }
    const products = Array.isArray(body?.products) ? body.products : null;
    if (!products) {
      return partnerError("validation_error", "`products` must be an array.");
    }
    if (products.length === 0) {
      return partnerError("validation_error", "`products` is empty.");
    }
    if (products.length > MAX_PRODUCTS_PER_REQUEST) {
      return partnerError(
        "validation_error",
        `Send at most ${MAX_PRODUCTS_PER_REQUEST} products per request.`
      );
    }

    // Coerce each row to the ingest shape; the mutation validates/normalizes and
    // skips bad rows, returning per-row errors.
    const rows = products.map((p: any) => ({
      type: ["flight", "hotel", "tour", "experience", "other"].includes(p?.type)
        ? p.type
        : "other",
      title: typeof p?.title === "string" ? p.title : "",
      description: typeof p?.description === "string" ? p.description : undefined,
      destination: typeof p?.destination === "string" ? p.destination : undefined,
      city: typeof p?.city === "string" ? p.city : undefined,
      country: typeof p?.country === "string" ? p.country : undefined,
      price: typeof p?.price === "number" ? p.price : undefined,
      currency: typeof p?.currency === "string" ? p.currency : undefined,
      bookingUrl: typeof p?.bookingUrl === "string" ? p.bookingUrl : undefined,
      imageUrls: Array.isArray(p?.imageUrls)
        ? p.imageUrls.filter((u: any) => typeof u === "string")
        : undefined,
    }));

    const result = await ctx.runMutation(internal.partnerProducts.ingestForAccount, {
      accountId: key.accountId,
      partnerRef: key.partnerRef,
      products: rows,
    });
    return partnerJson(
      { created: result.created, skipped: result.errors.length, errors: result.errors },
      202
    );
  }),
});

export default http;
