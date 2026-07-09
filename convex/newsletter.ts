/**
 * Newsletter Funnel
 *
 * Double opt-in email capture + automated drip sequence.
 *
 * Flow:
 *  1. `subscribe`   — public mutation, called from the marketing site and the
 *                     in-app opt-in card. Creates a `pending` subscriber and
 *                     schedules a confirmation ("please confirm") email.
 *  2. `confirm`     — public mutation, hit from the link in the confirmation
 *                     email. Marks the subscriber `active` and sends the
 *                     welcome email (drip stage 0).
 *  3. drip sequence — the `processNewsletterDrip` cron walks active subscribers
 *                     through the marketing sequence, one email every few days.
 *  4. `unsubscribe` — public mutation, hit from the unsubscribe link in the
 *                     footer of every email.
 *
 * Emails are delivered via the existing Postmark raw-send action
 * (`internal.postmark.sendRawEmail`).
 */

import { mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://planeraai.app";
const APP_STORE_URL =
  "https://apps.apple.com/us/app/planera-ai-travel-planner/id6758346139";

// How long to wait between drip emails.
const DRIP_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
// Number of drip emails after the welcome email.
const MAX_DRIP_STAGE = 3;
// Max subscribers processed per drip cron tick.
const DRIP_BATCH_SIZE = 50;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Email templates (pure helpers — safe to call from mutations and actions)
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

/**
 * Shared branded email shell. Returns a full HTML document.
 */
function renderEmail(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaText: string;
  ctaUrl: string;
  unsubscribeUrl: string;
}): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${opts.heading}</title>
<!--[if mso]><style>table,td,div,h1,p{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF9F6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;color:#FAF9F6;line-height:1px;">
${opts.preheader}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:20px;box-shadow:0 4px 24px rgba(26,26,26,0.06);overflow:hidden;">
      <tr><td style="padding:32px 40px 0;">
        <a href="${BASE_URL}" style="text-decoration:none;display:inline-block;"><img src="${BASE_URL}/logo.png" alt="Planera" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;" /></a>
      </td></tr>
      <tr><td style="padding:24px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:800;color:#1A1A1A;letter-spacing:-0.6px;">${opts.heading}</h1>
        <div style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#4A4A4A;">${opts.bodyHtml}</div>
      </td></tr>
      <tr><td style="padding:0 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:#FFE500;">
          <a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#1A1A1A;text-decoration:none;border-radius:12px;">${opts.ctaText}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:24px 40px 32px;border-top:1px solid #F0EEE9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#9A9A9A;">You're receiving this because you signed up for travel tips and deals from Planera.</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9A9A9A;">© ${year} Planera · <a href="${opts.unsubscribeUrl}" style="color:#9A9A9A;text-decoration:underline;">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function confirmEmail(confirmToken: string, unsubscribeToken: string): {
  subject: string;
  html: string;
  text: string;
} {
  const confirmUrl = `${BASE_URL}/newsletter/confirm?token=${confirmToken}`;
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;
  return {
    subject: "Confirm your Planera newsletter subscription",
    html: renderEmail({
      preheader: "One quick tap to confirm and start getting smarter travel tips.",
      heading: "Confirm your subscription",
      bodyHtml:
        "<p style='margin:0 0 12px;'>Thanks for signing up! Tap the button below to confirm your email and start receiving AI travel tips, flight deals, and destination inspiration.</p>" +
        "<p style='margin:0;'>If you didn't request this, you can safely ignore this email.</p>",
      ctaText: "Confirm my email",
      ctaUrl: confirmUrl,
      unsubscribeUrl,
    }),
    text:
      `Confirm your Planera newsletter subscription.\n\n` +
      `Confirm: ${confirmUrl}\n\n` +
      `If you didn't request this, you can ignore this email.\n` +
      `Unsubscribe: ${unsubscribeUrl}`,
  };
}

/**
 * Welcome email (drip stage 0) + the ongoing drip sequence (stages 1..N).
 * `stage` 0 = welcome, 1..MAX_DRIP_STAGE = drip emails.
 */
function dripEmail(
  stage: number,
  unsubscribeToken: string,
): { subject: string; html: string; text: string } {
  const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?token=${unsubscribeToken}`;

  const content: Record<
    number,
    { subject: string; heading: string; bodyHtml: string; preheader: string; ctaText: string; ctaUrl: string; textCta: string }
  > = {
    0: {
      subject: "Welcome to Planera ✨",
      preheader: "You're in. Here's how to plan your next trip in seconds.",
      heading: "Welcome aboard!",
      bodyHtml:
        "<p style='margin:0 0 12px;'>You're officially on the list. From now on you'll get the good stuff: AI-planned itineraries, flight deals from our Low-Fare Radar, and hand-picked destination guides.</p>" +
        "<p style='margin:0;'>Ready to plan something? Open Planera and let AI build a full itinerary for you in seconds.</p>",
      ctaText: "Start planning",
      ctaUrl: APP_STORE_URL,
      textCta: APP_STORE_URL,
    },
    1: {
      subject: "Plan your first trip in seconds",
      preheader: "Tell us where you're going — we'll handle the rest.",
      heading: "Your AI travel planner",
      bodyHtml:
        "<p style='margin:0 0 12px;'>Planera builds complete, day-by-day itineraries tailored to your budget, dates, and interests — no more juggling ten browser tabs.</p>" +
        "<p style='margin:0;'>Pick a destination and watch a full plan come together in seconds.</p>",
      ctaText: "Plan a trip",
      ctaUrl: APP_STORE_URL,
      textCta: APP_STORE_URL,
    },
    2: {
      subject: "Never overpay for flights again",
      preheader: "Our Low-Fare Radar tracks prices so you don't have to.",
      heading: "Meet Low-Fare Radar",
      bodyHtml:
        "<p style='margin:0 0 12px;'>Our Low-Fare Radar watches fares to the places you love and surfaces the best deals the moment prices drop.</p>" +
        "<p style='margin:0;'>Book flights in-app in a couple of taps once you spot a fare you like.</p>",
      ctaText: "See today's deals",
      ctaUrl: `${BASE_URL}/explore`,
      textCta: `${BASE_URL}/explore`,
    },
    3: {
      subject: "Get inspired — explore the community",
      preheader: "Real trips, real tips, from real travelers.",
      heading: "Explore where others are going",
      bodyHtml:
        "<p style='margin:0 0 12px;'>Discover trending destinations and community insights from travelers just like you. Every guide is grounded in real trips.</p>" +
        "<p style='margin:0;'>Find your next adventure and start planning today.</p>",
      ctaText: "Explore destinations",
      ctaUrl: `${BASE_URL}/explore`,
      textCta: `${BASE_URL}/explore`,
    },
  };

  const c = content[stage] ?? content[0];
  return {
    subject: c.subject,
    html: renderEmail({
      preheader: c.preheader,
      heading: c.heading,
      bodyHtml: c.bodyHtml,
      ctaText: c.ctaText,
      ctaUrl: c.ctaUrl,
      unsubscribeUrl,
    }),
    text:
      `${c.heading}\n\n` +
      c.bodyHtml.replace(/<[^>]*>/g, "").trim() +
      `\n\n${c.ctaText}: ${c.textCta}\n\nUnsubscribe: ${unsubscribeUrl}`,
  };
}

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

/**
 * Capture an email into the newsletter funnel (double opt-in).
 * Idempotent per email: already-active subscribers are left untouched.
 */
export const subscribe = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
    language: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("already_active"),
    ),
  }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!EMAIL_REGEX.test(email)) {
      throw new ConvexError("Please enter a valid email address.");
    }

    const existing = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    // Already subscribed & confirmed — nothing to do (don't leak status, just succeed).
    if (existing && existing.status === "active") {
      return { success: true, status: "already_active" as const };
    }

    const now = Date.now();
    const confirmToken = randomToken();
    const unsubscribeToken = existing?.unsubscribeToken ?? randomToken();

    if (existing) {
      // Re-arm a pending / previously-unsubscribed row.
      await ctx.db.patch(existing._id, {
        status: "pending",
        source: args.source ?? existing.source,
        language: args.language ?? existing.language,
        userId: args.userId ?? existing.userId,
        confirmToken,
        unsubscribeToken,
        dripStage: 0,
        confirmedAt: undefined,
        unsubscribedAt: undefined,
      });
    } else {
      await ctx.db.insert("newsletterSubscribers", {
        email,
        status: "pending",
        source: args.source,
        language: args.language,
        userId: args.userId,
        confirmToken,
        unsubscribeToken,
        dripStage: 0,
        createdAt: now,
      });
    }

    // Send the double opt-in confirmation email.
    const mail = confirmEmail(confirmToken, unsubscribeToken);
    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    return { success: true, status: "pending" as const };
  },
});

/**
 * Confirm a subscription via the double opt-in token, then send the welcome email.
 */
export const confirm = mutation({
  args: { token: v.string() },
  returns: v.object({
    success: v.boolean(),
    alreadyConfirmed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_confirm_token", (q) => q.eq("confirmToken", args.token))
      .unique();

    if (!sub) {
      throw new ConvexError("This confirmation link is invalid or has expired.");
    }

    if (sub.status === "active") {
      return { success: true, alreadyConfirmed: true };
    }

    const now = Date.now();
    await ctx.db.patch(sub._id, {
      status: "active",
      confirmedAt: now,
      unsubscribedAt: undefined,
      dripStage: 0,
      lastEmailSentAt: now,
    });

    // Send the welcome email (drip stage 0).
    const mail = dripEmail(0, sub.unsubscribeToken);
    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: sub.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    return { success: true, alreadyConfirmed: false };
  },
});

/**
 * Unsubscribe via the token embedded in every email footer.
 */
export const unsubscribe = mutation({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_unsubscribe_token", (q) =>
        q.eq("unsubscribeToken", args.token),
      )
      .unique();

    // Always report success to avoid leaking whether an address is on the list.
    if (!sub) {
      return { success: true };
    }

    if (sub.status !== "unsubscribed") {
      await ctx.db.patch(sub._id, {
        status: "unsubscribed",
        unsubscribedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Drip sequence (internal)
// ---------------------------------------------------------------------------

/**
 * Active subscribers due for their next drip email.
 */
export const getDueDripSubscribers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DRIP_INTERVAL_MS;
    const active = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return active
      .filter(
        (s) =>
          s.dripStage < MAX_DRIP_STAGE &&
          (s.lastEmailSentAt ?? 0) <= cutoff,
      )
      .slice(0, DRIP_BATCH_SIZE)
      .map((s) => ({
        _id: s._id,
        email: s.email,
        dripStage: s.dripStage,
        unsubscribeToken: s.unsubscribeToken,
      }));
  },
});

/**
 * Advance a subscriber to the next drip stage after their email was sent.
 */
export const advanceDripStage = internalMutation({
  args: { subscriberId: v.id("newsletterSubscribers"), nextStage: v.float64() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriberId);
    // Guard against races / mid-flight unsubscribes.
    if (!sub || sub.status !== "active") return null;
    await ctx.db.patch(args.subscriberId, {
      dripStage: args.nextStage,
      lastEmailSentAt: Date.now(),
    });
    return null;
  },
});

/**
 * Cron entry point: send the next drip email to every due subscriber.
 */
export const processNewsletterDrip = internalAction({
  args: {},
  returns: v.object({ processed: v.float64() }),
  handler: async (ctx): Promise<{ processed: number }> => {
    const due = await ctx.runQuery(internal.newsletter.getDueDripSubscribers, {});
    let processed = 0;

    for (const sub of due) {
      const nextStage = sub.dripStage + 1;
      if (nextStage > MAX_DRIP_STAGE) continue;

      const mail = dripEmail(nextStage, sub.unsubscribeToken);
      const result = await ctx.runAction(internal.postmark.sendRawEmail, {
        to: sub.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });

      if (result.success) {
        await ctx.runMutation(internal.newsletter.advanceDripStage, {
          subscriberId: sub._id,
          nextStage,
        });
        processed += 1;
      }
    }

    return { processed };
  },
});
