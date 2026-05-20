"use node";

/**
 * Convex error reporter.
 *
 * Other Convex actions call this via:
 *   await ctx.scheduler.runAfter(0, internal.errorReporter.reportError, {
 *     source: "tripsActions:generateTrip",
 *     message: String(err?.message ?? err),
 *     stack: err?.stack,
 *     context: { tripId, userId },
 *   });
 *
 * The reporter:
 *   1. Hashes (source + first 200 chars of message) into a throttle key.
 *   2. Asks the DB whether we've already emailed this key in the last hour.
 *   3. If not, sends a plain Postmark email to ERROR_REPORT_EMAIL (defaults
 *      to dstroumpakos@planeraai.app) and records the timestamp.
 *
 * Throttling stops Postmark spam during outages — repeated occurrences are
 * counted but only one email per error key per hour is sent.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as crypto from "crypto";

const POSTMARK_PLAIN_URL = "https://api.postmarkapp.com/email";
const SENDER_EMAIL = "Planera <support@planeraai.app>";
const DEFAULT_RECIPIENT = "dstroumpakos@planeraai.app";
const MESSAGE_STREAM = "outbound";

function hashKey(source: string, message: string): string {
  return crypto
    .createHash("sha1")
    .update(`${source}::${message.slice(0, 200)}`)
    .digest("hex");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const reportError = internalAction({
  args: {
    source: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
    context: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const key = hashKey(args.source, args.message);

    // Always log to the Convex console regardless of throttle.
    console.error(`[errorReporter] ${args.source}: ${args.message}`);

    const claim = await ctx.runMutation(
      internal.errorReporterDb.tryClaimErrorReport,
      { key, source: args.source, message: args.message }
    );

    if (!claim.shouldSend) {
      console.log(
        `[errorReporter] throttled (count=${claim.count}) — not sending email`
      );
      return null;
    }

    const apiToken = process.env.POSTMARK_SERVER_TOKEN;
    if (!apiToken) {
      console.error("[errorReporter] POSTMARK_SERVER_TOKEN not set");
      return null;
    }
    const recipient = process.env.ERROR_REPORT_EMAIL || DEFAULT_RECIPIENT;

    const deployment = process.env.CONVEX_CLOUD_URL ?? "unknown";
    const ts = new Date().toISOString();
    const ctxStr = args.context
      ? JSON.stringify(args.context, null, 2).slice(0, 4000)
      : "(none)";
    const stack = args.stack ? args.stack.slice(0, 4000) : "(no stack)";

    const subject = `[Bloom] ${args.source} — ${args.message.slice(0, 80)}`;
    const textBody = [
      `Convex error report`,
      `--------------------`,
      `Source:      ${args.source}`,
      `Deployment:  ${deployment}`,
      `Timestamp:   ${ts}`,
      `Occurrences: ${claim.count}`,
      ``,
      `Message:`,
      args.message,
      ``,
      `Stack:`,
      stack,
      ``,
      `Context:`,
      ctxStr,
    ].join("\n");

    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px;">
  <h2 style="color: #b91c1c; margin: 0 0 8px 0;">Convex error report</h2>
  <table style="border-collapse: collapse; font-size: 13px;">
    <tr><td style="padding: 2px 8px 2px 0; color: #6b7280;">Source</td><td><code>${escapeHtml(args.source)}</code></td></tr>
    <tr><td style="padding: 2px 8px 2px 0; color: #6b7280;">Deployment</td><td><code>${escapeHtml(deployment)}</code></td></tr>
    <tr><td style="padding: 2px 8px 2px 0; color: #6b7280;">Timestamp</td><td><code>${ts}</code></td></tr>
    <tr><td style="padding: 2px 8px 2px 0; color: #6b7280;">Occurrences</td><td><code>${claim.count}</code></td></tr>
  </table>
  <h3 style="margin: 16px 0 4px 0;">Message</h3>
  <pre style="background: #fef2f2; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 12px;">${escapeHtml(args.message)}</pre>
  <h3 style="margin: 16px 0 4px 0;">Stack</h3>
  <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 11px; max-height: 360px; overflow: auto;">${escapeHtml(stack)}</pre>
  <h3 style="margin: 16px 0 4px 0;">Context</h3>
  <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 11px;">${escapeHtml(ctxStr)}</pre>
  <p style="color: #9ca3af; font-size: 11px; margin-top: 20px;">
    Throttled: max 1 email per unique error key per hour. Subsequent occurrences are counted in the DB.
  </p>
</div>`;

    try {
      const res = await fetch(POSTMARK_PLAIN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": apiToken,
        },
        body: JSON.stringify({
          From: SENDER_EMAIL,
          To: recipient,
          Subject: subject,
          TextBody: textBody,
          HtmlBody: htmlBody,
          MessageStream: MESSAGE_STREAM,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error(`[errorReporter] Postmark HTTP ${res.status}: ${t.slice(0, 300)}`);
        return null;
      }
      console.log(`[errorReporter] sent error email to ${recipient}`);
    } catch (err) {
      console.error("[errorReporter] send failed:", (err as Error)?.message);
    }
    return null;
  },
});
