import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

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

export default http;
