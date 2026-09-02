/**
 * Operator alerts for the agency product.
 *
 * A B2B signup is not like a consumer one: there are few of them, each is worth
 * a real conversation, and the first hours after someone creates a workspace are
 * when a reply actually lands. Until now `registerAgency` only wrote an audit
 * row, which means the only way to learn that a real agency had signed up was to
 * go looking in the Convex dashboard — so in practice nobody would have known.
 *
 * Sent via the scheduler AFTER the signup mutation commits. That ordering is the
 * point: a Postmark outage, a bad API key or a malformed address can never fail
 * or roll back an agency's registration. The worst case is a missed email, and
 * the audit row still records the signup either way.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Same operator address the weekly stats report uses. */
const DEFAULT_TO = "dstroumpakos@planeraai.app";

/** Enough to say "you have momentum" without scanning an unbounded table. */
const COUNT_CEILING = 500;

/** Named because an escaped newline inside a generated string is easy to mangle. */
const NEWLINE = String.fromCharCode(10);

const esc = (raw: string): string =>
  String(raw ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/**
 * How many agencies exist, capped. A bare count is the first thing you want
 * next to a new signup — "is this the third or the fortieth" changes what you
 * do about it — and `take` keeps the read bounded as the table grows.
 */
export const _agencyCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agencies").take(COUNT_CEILING + 1);
    return { count: Math.min(rows.length, COUNT_CEILING), atCeiling: rows.length > COUNT_CEILING };
  },
});

/**
 * This module is newer than the last `convex codegen`, so `internal.agency.notify`
 * does not exist in the generated map yet. Referencing it by name is the same
 * workaround the rest of the agency module uses, and it resolves at runtime.
 */
const agencyCountRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { count: number; atCeiling: boolean }
>("agency/notify:_agencyCount");

export const newAgencySignup = internalAction({
  args: {
    agencyName: v.string(),
    slug: v.string(),
    ownerEmail: v.string(),
    currency: v.string(),
    signedUpAt: v.float64(),
  },
  handler: async (ctx, args): Promise<null> => {
    const to = process.env.AGENCY_ALERT_TO || process.env.STATS_REPORT_TO || DEFAULT_TO;

    const { count, atCeiling } = await ctx.runQuery(agencyCountRef, {});
    const total = atCeiling ? `${count}+` : String(count);

    const when = new Date(args.signedUpAt).toISOString().replace("T", " ").slice(0, 16);
    const workspace = `https://www.planeraai.app/agency/login`;

    // A demo tenant is still worth an email — it is usually us — but it should
    // not read like a customer. Naming it in the subject keeps the inbox honest.
    const looksInternal =
      /(\bdemo\b|\btest\b)/i.test(args.agencyName) ||
      args.ownerEmail.toLowerCase().endsWith("@planeraai.app");

    const subject = looksInternal
      ? `[internal] Agency workspace created: ${args.agencyName}`
      : `New travel agency signed up: ${args.agencyName}`;

    const rows: Array<[string, string]> = [
      ["Agency", args.agencyName],
      ["Owner", args.ownerEmail],
      ["Currency", args.currency],
      ["Slug", args.slug],
      ["Signed up", `${when} UTC`],
      ["Agencies total", total],
    ];

    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p style="margin:0 0 14px"><strong>${esc(args.agencyName)}</strong> just created an agency workspace.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
    ${rows
      .map(
        ([label, value]) => `<tr>
      <td style="padding:4px 16px 4px 0;color:#666;white-space:nowrap">${esc(label)}</td>
      <td style="padding:4px 0"><strong>${esc(value)}</strong></td>
    </tr>`,
      )
      .join("")}
  </table>
  <p style="margin:0 0 14px;color:#444">
    They have not connected a supplier yet — that is the step where a new agency
    gets stuck, so it is the one worth reaching out about.
  </p>
  <p style="margin:0"><a href="${workspace}" style="color:#0b62d6">${workspace}</a></p>
</div>`.trim();

    const text = [
      `${args.agencyName} just created an agency workspace.`,
      "",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      "They have not connected a supplier yet — that is where a new agency gets stuck.",
      workspace,
    ].join("\n");

    const res: { success: boolean; error?: string } = await ctx.runAction(
      internal.postmark.sendRawEmail,
      {
        to,
        subject,
        html,
        text,
        tag: "agency-signup",
        // Operator mail to a fixed internal address. A bounce here means our own
        // inbox had a bad day, not that we unsubscribed from our own alerts.
        ignoreSuppression: true,
      },
    );
    if (!res.success) console.error(`[agency-signup-alert] send failed: ${res.error}`);
    return null;
  },
});

// ── Quote events → the agency, not us ───────────────────────────────────────

/**
 * Who on the agency side should hear that a client opened or accepted a quote.
 *
 * The owner. Not every member: a five-person agency does not want five copies,
 * and "who handles this client" is a routing decision we have no basis to make.
 */
export const _quoteEventRecipients = internalQuery({
  args: { agencyId: v.id("agencies"), quoteId: v.string() },
  handler: async (ctx, args) => {
    const agency = await ctx.db.get(args.agencyId);
    if (!agency) return null;

    const owner = await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    const user = owner ? await ctx.db.get(owner.userId) : null;

    const row = await ctx.db
      .query("quotes")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    // Re-derive the tenant rather than trusting the scheduled args.
    if (!row || row.agencyId !== args.agencyId) return null;

    const params = (row.searchParams ?? {}) as {
      originIata?: string;
      destinationIata?: string;
      departDate?: string;
    };

    return {
      to: user?.email ?? null,
      agencyName: agency.name,
      // The agency's own preference, so a Greek agency is not emailed the
      // contact address of a workspace it does not recognise.
      replyTo: agency.branding?.contactEmail ?? null,
      route: `${params.originIata ?? "?"} → ${params.destinationIata ?? "?"}`,
      departDate: params.departDate ?? "",
      viewCount: row.viewCount ?? 0,
    };
  },
});

const recipientsRef = makeFunctionReference<
  "query",
  { agencyId: Id<"agencies">; quoteId: string },
  {
    to: string | null;
    agencyName: string;
    replyTo: string | null;
    route: string;
    departDate: string;
    viewCount: number;
  } | null
>("agency/notify:_quoteEventRecipients");

/**
 * Tell the agency their client did something.
 *
 * Scheduled from the customer-link mutations, so a mail failure can never break
 * a traveller's page load or lose an acceptance — the acceptance is already
 * committed to the quote row before this runs.
 */
export const quoteEvent = internalAction({
  args: {
    agencyId: v.id("agencies"),
    quoteId: v.string(),
    event: v.union(v.literal("viewed"), v.literal("accepted")),
    tier: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const info = await ctx.runQuery(recipientsRef, {
      agencyId: args.agencyId,
      quoteId: args.quoteId,
    });
    if (!info?.to) return null;

    const accepted = args.event === "accepted";
    const subject = accepted
      ? `Quote accepted — ${info.route}`
      : `Your client opened the quote — ${info.route}`;

    const lead = accepted
      ? `Your client accepted the <strong>${esc(args.tier ?? "")}</strong> package for ${esc(info.route)}.`
      : `Your client opened the quote for ${esc(info.route)} for the first time.`;

    const body = accepted
      ? `<p style="margin:0 0 14px;color:#444">This is an expression of interest, not a booking. Re-confirm prices and ticket as usual.</p>` +
        (args.note
          ? `<p style="margin:0 0 14px"><em>Their note:</em><br>${esc(args.note)}</p>`
          : "")
      : `<p style="margin:0 0 14px;color:#444">Nothing to do yet — but a quote read and not answered is usually worth a call.</p>`;

    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p style="margin:0 0 14px">${lead}</p>
  <p style="margin:0 0 14px;color:#666">Departing ${esc(info.departDate)} · quote ${esc(args.quoteId)}</p>
  ${body}
</div>`.trim();

    const text = [
      accepted
        ? `Your client accepted the ${args.tier ?? ""} package for ${info.route}.`
        : `Your client opened the quote for ${info.route}.`,
      `Departing ${info.departDate} · quote ${args.quoteId}`,
      accepted ? "This is an expression of interest, not a booking." : "",
      args.note ? `Their note: ${args.note}` : "",
    ]
      .filter(Boolean)
      .join(NEWLINE);

    const res: { success: boolean; error?: string } = await ctx.runAction(
      internal.postmark.sendRawEmail,
      {
        to: info.to,
        subject,
        html,
        text,
        tag: "agency-quote-event",
        ...(info.replyTo ? { replyTo: info.replyTo } : {}),
      },
    );
    if (!res.success) console.error(`[agency-quote-event] send failed: ${res.error}`);
    return null;
  },
});
