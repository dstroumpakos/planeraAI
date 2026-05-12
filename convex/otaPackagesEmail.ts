"use node";

/**
 * OTA Lead emails — sends a notification to the partner and a confirmation to the user
 * when an inquiry is submitted. Uses Postmark's plain /email endpoint so we don't
 * need to add new templates in the Postmark dashboard.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const POSTMARK_API_URL = "https://api.postmarkapp.com/email";
const SENDER_EMAIL = "Planera <support@planeraai.app>";
const MESSAGE_STREAM = "outbound";

function esc(s: string | undefined | null): string {
    if (!s) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function fmtDate(ts: number | undefined): string {
    if (!ts) return "—";
    try {
        return new Date(ts).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return "—";
    }
}

async function postmarkSend(
    apiToken: string,
    to: string,
    subject: string,
    htmlBody: string,
    textBody: string,
    replyTo?: string,
    cc?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
        const payload: any = {
            From: SENDER_EMAIL,
            To: to,
            Subject: subject,
            HtmlBody: htmlBody,
            TextBody: textBody,
            MessageStream: MESSAGE_STREAM,
        };
        if (replyTo) payload.ReplyTo = replyTo;
        if (cc) payload.Cc = cc;

        const res = await fetch(POSTMARK_API_URL, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": apiToken,
            },
            body: JSON.stringify(payload),
        });
        const result: any = await res.json();
        if (!res.ok) {
            return { success: false, error: result?.Message || `HTTP ${res.status}` };
        }
        return { success: true, messageId: result?.MessageID };
    } catch (e: any) {
        return { success: false, error: e?.message || "Unknown error" };
    }
}

export const dispatchLeadEmails = internalAction({
    args: { leadId: v.id("otaLeads") },
    handler: async (ctx: any, args: any) => {
        const apiToken = process.env.POSTMARK_SERVER_TOKEN;
        if (!apiToken) {
            console.error("[otaPackagesEmail] POSTMARK_SERVER_TOKEN not set");
            await ctx.runMutation(internal.otaPackages.markLeadStatus, {
                leadId: args.leadId,
                status: "failed",
                sendError: "POSTMARK_SERVER_TOKEN missing",
            });
            return null;
        }

        const data: any = await ctx.runQuery(internal.otaPackages.getLeadForEmail, {
            leadId: args.leadId,
        });
        if (!data || !data.lead || !data.package || !data.partner) {
            console.error("[otaPackagesEmail] Lead, package, or partner missing");
            return null;
        }
        const { lead, package: pkg, partner } = data;

        // ─── Partner email ───
        const partnerSubject = `New Planera lead — ${pkg.title} (${lead.destination})`;
        const partnerHtml = `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:24px 28px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;">
      <div style="font-size:13px;letter-spacing:.08em;opacity:.85;text-transform:uppercase;">Planera Partner Lead</div>
      <div style="font-size:20px;font-weight:700;margin-top:6px;">${esc(pkg.title)}</div>
    </div>
    <div style="padding:24px 28px;color:#111827;">
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;">
        A Planera traveler has requested information about your package.
        Please reach out within 24 hours for the best conversion experience.
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b7280;width:40%;">Package</td><td style="padding:8px 0;font-weight:600;">${esc(pkg.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Destination</td><td style="padding:8px 0;">${esc(lead.destination)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Travel dates</td><td style="padding:8px 0;">${esc(fmtDate(lead.startDate))} → ${esc(fmtDate(lead.endDate))}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Travelers</td><td style="padding:8px 0;">${lead.travelers}</td></tr>
        ${lead.budget ? `<tr><td style="padding:8px 0;color:#6b7280;">Budget</td><td style="padding:8px 0;">${lead.budget} ${esc(pkg.priceCurrency)}</td></tr>` : ""}
      </table>

      <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
        <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Customer contact</div>
        <div style="font-size:15px;font-weight:600;">${esc(lead.contactName)}</div>
        <div style="font-size:14px;margin-top:4px;"><a href="mailto:${esc(lead.contactEmail)}" style="color:#0ea5e9;text-decoration:none;">${esc(lead.contactEmail)}</a></div>
        ${lead.contactPhone ? `<div style="font-size:14px;margin-top:4px;"><a href="tel:${esc(lead.contactPhone)}" style="color:#0ea5e9;text-decoration:none;">${esc(lead.contactPhone)}</a></div>` : ""}
        <div style="font-size:13px;color:#6b7280;margin-top:8px;">Prefers: ${esc(lead.preferredContactMethod || "any")}</div>
      </div>

      ${lead.message ? `
      <div style="margin-top:16px;padding:14px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:8px;">
        <div style="font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Customer note</div>
        <div style="font-size:14px;color:#111827;white-space:pre-wrap;">${esc(lead.message)}</div>
      </div>` : ""}

      <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
        Sent by Planera AI · Reference: ${esc(lead._id)}
      </p>
    </div>
  </div>
</body></html>`.trim();
        const partnerText = [
            `New Planera lead — ${pkg.title}`,
            ``,
            `Destination: ${lead.destination}`,
            `Dates: ${fmtDate(lead.startDate)} → ${fmtDate(lead.endDate)}`,
            `Travelers: ${lead.travelers}`,
            lead.budget ? `Budget: ${lead.budget} ${pkg.priceCurrency}` : "",
            ``,
            `Customer: ${lead.contactName}`,
            `Email: ${lead.contactEmail}`,
            lead.contactPhone ? `Phone: ${lead.contactPhone}` : "",
            `Prefers: ${lead.preferredContactMethod || "any"}`,
            ``,
            lead.message ? `Note: ${lead.message}` : "",
            ``,
            `Reference: ${lead._id}`,
        ].filter(Boolean).join("\n");

        const cc = Array.isArray(partner.ccEmails) && partner.ccEmails.length
            ? partner.ccEmails.join(",")
            : undefined;

        const partnerResult = await postmarkSend(
            apiToken,
            partner.contactEmail,
            partnerSubject,
            partnerHtml,
            partnerText,
            lead.contactEmail,
            cc,
        );

        // ─── User confirmation email ───
        const userSubject = `Your inquiry has been sent to ${partner.name}`;
        const userHtml = `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="padding:32px 28px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-align:center;">
      <div style="font-size:32px;">✈️</div>
      <div style="font-size:22px;font-weight:700;margin-top:8px;">Inquiry sent!</div>
      <div style="font-size:14px;opacity:.92;margin-top:6px;">${esc(partner.name)} will be in touch shortly.</div>
    </div>
    <div style="padding:24px 28px;color:#111827;">
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">
        Hi ${esc(lead.contactName)},<br/><br/>
        Thanks for your interest in <strong>${esc(pkg.title)}</strong>. We've forwarded your details to <strong>${esc(partner.name)}</strong>, one of our trusted travel partners. They typically respond within 24 hours via your preferred channel.
      </p>

      <div style="margin:20px 0;padding:16px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;font-size:14px;">
        <div style="font-weight:600;margin-bottom:8px;">${esc(pkg.title)}</div>
        <div style="color:#6b7280;">${esc(lead.destination)}</div>
        <div style="color:#6b7280;">${esc(fmtDate(lead.startDate))} → ${esc(fmtDate(lead.endDate))} · ${lead.travelers} travelers</div>
      </div>

      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
        Planera does not handle this booking directly — ${esc(partner.name)} will contact you to confirm pricing and availability.
        If you don't hear back, reply to this email and we'll follow up.
      </p>
    </div>
    <div style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      Planera AI · planeraai.app
    </div>
  </div>
</body></html>`.trim();
        const userText = [
            `Hi ${lead.contactName},`,
            ``,
            `Thanks for your interest in "${pkg.title}".`,
            `We've forwarded your details to ${partner.name}. They typically respond within 24 hours.`,
            ``,
            `Trip: ${lead.destination}`,
            `Dates: ${fmtDate(lead.startDate)} → ${fmtDate(lead.endDate)}`,
            `Travelers: ${lead.travelers}`,
            ``,
            `— Planera AI`,
        ].join("\n");

        await postmarkSend(
            apiToken,
            lead.contactEmail,
            userSubject,
            userHtml,
            userText,
        );

        // ─── Update lead status ───
        if (partnerResult.success) {
            await ctx.runMutation(internal.otaPackages.markLeadStatus, {
                leadId: args.leadId,
                status: "sent",
                sentAt: Date.now(),
            });
        } else {
            await ctx.runMutation(internal.otaPackages.markLeadStatus, {
                leadId: args.leadId,
                status: "failed",
                sendError: partnerResult.error,
            });
        }

        return null;
    },
});
