import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./partnerApiAuth";
import { assertAdmin } from "./admin";
import { accountFromToken } from "./partnerProducts";
import { promoteDrafts } from "./partnerBillingDb";
import {
  AGREEMENT_TEMPLATE_VERSION,
  DEFAULT_TERMS,
  OFFER_VALID_DAYS,
  PLANERA_PARTY,
  agreementPlainText,
  agreementReference,
  agreementTitle,
  buildAgreementSections,
  partnerPartyLines,
  planeraPartyLines,
  validateParty,
  validateTerms,
} from "./lib/partnerCommission";
import {
  PORTAL_BASE_URL,
  agreementTextHtml,
  athensDate,
  esc,
  partnerEmailHtml,
  partnerOpsInbox,
  rowsHtml,
} from "./lib/partnerEmails";

/**
 * Commission agreements: the operator offers one to a single supplier from
 * the website admin, the supplier reads and e-signs it in the partner portal,
 * and signing switches the account to the commission model (no listing fee,
 * listings take quote requests). See convex/lib/partnerCommission.ts for the
 * text and the maths, and partnerLeads.ts for what happens after signing.
 *
 * Signing goes through the HTTP route POST /partners/agreement/sign (http.ts)
 * rather than a public mutation, because only an HTTP action can see the
 * signer's IP address for the evidence record.
 */

const TERMS = v.object({
  commissionPct: v.float64(),
  attributionDays: v.float64(),
  replyBusinessDays: v.float64(),
  paymentDays: v.float64(),
  noticeDays: v.float64(),
});

const PARTY = v.object({
  legalName: v.string(),
  vatNumber: v.string(),
  address: v.string(),
  representative: v.string(),
  representativeTitle: v.string(),
  email: v.string(),
});

const DAY = 24 * 60 * 60 * 1000;
const MAX_SIGNATURE_BYTES = 300_000;

async function requireAdmin(ctx: any, token: string): Promise<string> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new ConvexError("Unauthorized.");
  await assertAdmin(ctx, session.userId);
  return session.userId;
}

function asConvexError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new ConvexError(e instanceof Error ? e.message : String(e));
  }
}

/** The document view both the portal and the admin render. */
function documentView(a: any) {
  const current = a.templateVersion === AGREEMENT_TEMPLATE_VERSION;
  return {
    id: a._id,
    reference: a.reference,
    templateVersion: a.templateVersion,
    title: agreementTitle(),
    status: a.status,
    terms: a.terms,
    partner: a.partner,
    planeraLines: planeraPartyLines(),
    partnerLines: partnerPartyLines(a.partner),
    planeraSigner: `${PLANERA_PARTY.representative}, ${PLANERA_PARTY.representativeTitle}`,
    // Structured sections only while the template still renders the same
    // words; an older agreement falls back to its frozen text.
    sections: current ? buildAgreementSections(a.terms, a.partner) : null,
    bodyText: a.bodyText,
    bodyHash: a.bodyHash,
    offeredAt: a.offeredAt,
    expiresAt: a.expiresAt,
    expired: a.status === "offered" && a.expiresAt < Date.now(),
    signedAt: a.signedAt ?? null,
    signerName: a.signerName ?? null,
    signerTitle: a.signerTitle ?? null,
    signerEmail: a.signerEmail ?? null,
    signerIp: a.signerIp ?? null,
    signatureKind: a.signatureKind ?? null,
    signatureDataUrl: a.signatureDataUrl ?? null,
    terminatedAt: a.terminatedAt ?? null,
    withdrawnAt: a.withdrawnAt ?? null,
  };
}

// ─────────────────────────────────────────────────────────
// Admin (website /admin, app admin session)
// ─────────────────────────────────────────────────────────

/** Every agreement, newest first, plus the supplier accounts one can be offered to. */
export const adminOverview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const agreements = await ctx.db.query("partnerAgreements").order("desc").take(200);
    const accounts = await ctx.db.query("partnerAccounts").take(1000);
    const byId = new Map(accounts.map((a) => [a._id as string, a]));
    return {
      defaults: DEFAULT_TERMS,
      agreements: agreements.map((a) => ({
        id: a._id,
        reference: a.reference,
        accountId: a.accountId,
        partnerName: byId.get(a.accountId)?.partnerName ?? a.partner.legalName,
        status: a.status,
        expired: a.status === "offered" && a.expiresAt < Date.now(),
        terms: a.terms,
        offeredAt: a.offeredAt,
        expiresAt: a.expiresAt,
        signedAt: a.signedAt ?? null,
        signerName: a.signerName ?? null,
        terminatedAt: a.terminatedAt ?? null,
      })),
      suppliers: accounts
        .filter((a) => a.kind === "supplier" && a.status === "active")
        .map((a) => ({
          accountId: a._id,
          partnerName: a.partnerName,
          email: a.email,
          commissionActive: !!a.commission,
          // Prefill for the offer form, from the invoicing details if any.
          prefill: {
            legalName: a.billingDetails?.legalName ?? a.partnerName,
            vatNumber: a.billingDetails?.vatNumber
              ? `${a.billingDetails.country === "GR" ? "EL" : a.billingDetails.country ?? ""}${a.billingDetails.vatNumber}`
              : "",
            address: a.billingDetails
              ? [a.billingDetails.address, `${a.billingDetails.postalCode} ${a.billingDetails.city}`].filter(Boolean).join(", ")
              : "",
            representative: "",
            representativeTitle: "",
            email: a.billingDetails?.invoiceEmail ?? a.email,
          },
        }))
        .sort((x, y) => x.partnerName.localeCompare(y.partnerName)),
    };
  },
});

/** One agreement in full, for the admin print / evidence view. */
export const adminGet = query({
  args: { token: v.string(), agreementId: v.id("partnerAgreements") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.agreementId);
    return a ? { ...documentView(a), signerUserAgent: a.signerUserAgent ?? null } : null;
  },
});

/** Offer an agreement to one supplier. Emails them a link to sign. */
export const adminOffer = mutation({
  args: { token: v.string(), accountId: v.id("partnerAccounts"), terms: TERMS, partner: PARTY },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx, args.token);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.kind !== "supplier") throw new ConvexError("Supplier account not found.");
    const terms = asConvexError(() => validateTerms(args.terms));
    const partner = asConvexError(() => validateParty(args.partner));

    const existing = await ctx.db
      .query("partnerAgreements")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    if (existing.some((a) => a.status === "signed")) {
      throw new ConvexError("This supplier already has a signed agreement. End it before offering a new one.");
    }
    // A fresh offer replaces any unsigned one.
    const now = Date.now();
    for (const a of existing) {
      if (a.status === "offered") await ctx.db.patch(a._id, { status: "withdrawn", withdrawnAt: now });
    }

    const count = (await ctx.db.query("partnerAgreements").collect()).length;
    let reference = agreementReference(count + 1);
    // Belt and braces against a reused number after a manual delete.
    while (await ctx.db.query("partnerAgreements").withIndex("by_reference", (q) => q.eq("reference", reference)).first()) {
      reference = agreementReference(Number(reference.slice(-4)) + 1);
    }
    const bodyText = agreementPlainText({ reference, templateVersion: AGREEMENT_TEMPLATE_VERSION, terms, partner });
    const bodyHash = await sha256Hex(bodyText);
    const id = await ctx.db.insert("partnerAgreements", {
      accountId: args.accountId,
      reference,
      templateVersion: AGREEMENT_TEMPLATE_VERSION,
      status: "offered",
      terms,
      partner,
      bodyText,
      bodyHash,
      offeredAt: now,
      offeredBy: adminId,
      expiresAt: now + OFFER_VALID_DAYS * DAY,
    });
    await ctx.scheduler.runAfter(0, internal.partnerAgreements.sendAgreementEmail, { agreementId: id, kind: "offered" });
    return { ok: true as const, id, reference };
  },
});

/** Pull back an offer that has not been signed yet. */
export const adminWithdraw = mutation({
  args: { token: v.string(), agreementId: v.id("partnerAgreements") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.agreementId);
    if (!a || a.status !== "offered") throw new ConvexError("Only an unsigned offer can be withdrawn.");
    await ctx.db.patch(a._id, { status: "withdrawn", withdrawnAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * Record that a signed agreement has ended (after the notice period). The
 * supplier goes back to the listing-fee model; requests already received keep
 * earning commission inside their attribution window (clause 12.2).
 */
export const adminTerminate = mutation({
  args: { token: v.string(), agreementId: v.id("partnerAgreements"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.agreementId);
    if (!a || a.status !== "signed") throw new ConvexError("Only a signed agreement can be ended.");
    const now = Date.now();
    await ctx.db.patch(a._id, { status: "terminated", terminatedAt: now, terminationNote: args.note?.trim() || undefined });
    const account = await ctx.db.get(a.accountId);
    if (account?.commission?.agreementId === a._id) {
      await ctx.db.patch(a.accountId, { commission: undefined });
    }
    return { ok: true as const };
  },
});

// ─────────────────────────────────────────────────────────
// Supplier (partner portal session)
// ─────────────────────────────────────────────────────────

/** The agreement to show in the portal: the live offer, else the signed one. */
export const getMine = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;
    const all = await ctx.db
      .query("partnerAgreements")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .order("desc")
      .collect();
    const pick =
      all.find((a) => a.status === "signed") ??
      all.find((a) => a.status === "offered") ??
      all.find((a) => a.status === "terminated");
    if (!pick) return { agreement: null, accountEmail: account.email, partnerName: account.partnerName };
    return { agreement: documentView(pick), accountEmail: account.email, partnerName: account.partnerName };
  },
});

/** Called by the HTTP sign route with the request's IP and user agent. */
export const signInternal = internalMutation({
  args: {
    token: v.string(),
    agreementId: v.id("partnerAgreements"),
    bodyHash: v.string(),
    signerName: v.string(),
    signerTitle: v.string(),
    signatureKind: v.union(v.literal("drawn"), v.literal("typed")),
    signatureDataUrl: v.optional(v.string()),
    accepted: v.boolean(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Your session has expired. Sign in again.");
    const a = await ctx.db.get(args.agreementId);
    if (!a || a.accountId !== account._id) throw new ConvexError("Agreement not found.");
    if (a.status === "signed") throw new ConvexError("This agreement is already signed.");
    if (a.status !== "offered") throw new ConvexError("This offer is no longer open. Contact partners@planeraai.app.");
    if (a.expiresAt < Date.now()) throw new ConvexError("This offer has expired. Ask Planera to send it again.");
    if (args.bodyHash !== a.bodyHash) {
      throw new ConvexError("The agreement text changed since you opened it. Reload the page and read it again.");
    }
    if (!args.accepted) throw new ConvexError("Tick the box to confirm you have read the agreement.");
    const signerName = args.signerName.replace(/\s+/g, " ").trim();
    const signerTitle = args.signerTitle.replace(/\s+/g, " ").trim();
    if (signerName.length < 3) throw new ConvexError("Enter your full name.");
    if (!signerTitle) throw new ConvexError("Enter your title, for example Managing Director.");
    let signatureDataUrl: string | undefined;
    if (args.signatureKind === "drawn") {
      const d = args.signatureDataUrl ?? "";
      if (!d.startsWith("data:image/png;base64,") || d.length < 200) throw new ConvexError("Draw your signature first.");
      if (d.length > MAX_SIGNATURE_BYTES) throw new ConvexError("The signature image is too large. Clear it and sign again.");
      signatureDataUrl = d;
    }

    const now = Date.now();
    await ctx.db.patch(a._id, {
      status: "signed",
      signedAt: now,
      signerName,
      signerTitle,
      signerEmail: account.email,
      signerIp: args.ip?.slice(0, 64) || undefined,
      signerUserAgent: args.userAgent?.slice(0, 300) || undefined,
      signatureKind: args.signatureKind,
      signatureDataUrl,
    });
    await ctx.db.patch(account._id, {
      commission: {
        agreementId: a._id,
        commissionPct: a.terms.commissionPct,
        attributionDays: a.terms.attributionDays,
        since: now,
      },
    });
    // The fee no longer applies, so anything saved as a draft goes to review.
    const promoted = await promoteDrafts(ctx, account._id);
    await ctx.scheduler.runAfter(0, internal.partnerAgreements.sendAgreementEmail, { agreementId: a._id, kind: "signed" });
    return { ok: true as const, signedAt: now, promoted };
  },
});

// ─────────────────────────────────────────────────────────
// Emails
// ─────────────────────────────────────────────────────────

export const getForEmail = internalQuery({
  args: { agreementId: v.id("partnerAgreements") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.agreementId);
    if (!a) return null;
    const account = await ctx.db.get(a.accountId);
    return { a, accountEmail: account?.email ?? a.partner.email, partnerName: account?.partnerName ?? a.partner.legalName };
  },
});

export const sendAgreementEmail = internalAction({
  args: { agreementId: v.id("partnerAgreements"), kind: v.union(v.literal("offered"), v.literal("signed")) },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.partnerAgreements.getForEmail, { agreementId: args.agreementId });
    if (!data) return null;
    const { a, accountEmail, partnerName } = data;
    const url = `${PORTAL_BASE_URL}/partners/agreement`;
    const recipients = Array.from(new Set([accountEmail, a.partner.email].map((e) => e.toLowerCase())));
    const t = a.terms;
    const summary = rowsHtml([
      ["Agreement", esc(a.reference)],
      ["Commission", `${esc(t.commissionPct)}% of each booking from a Planera request`],
      ["Listing fee", "€0"],
      ["Attribution window", `${esc(t.attributionDays)} days`],
    ]);

    const send = async (to: string, subject: string, html: string, text: string) => {
      try {
        await ctx.runAction(internal.postmark.sendRawEmail, {
          to,
          subject,
          html,
          text,
          replyTo: "partners@planeraai.app",
          tag: "partner-agreement",
        });
      } catch (e) {
        console.error("[partnerAgreements] email failed", to, e);
      }
    };

    if (args.kind === "offered") {
      const html = partnerEmailHtml({
        eyebrow: "Planera Partners",
        heading: "Your commission agreement is ready to sign",
        bodyHtml: `<p style="margin:0 0 16px;">Hi ${esc(partnerName)}, Planera has prepared the agreement we discussed. Once you sign it in the partner portal, your experiences go live on Planera trips that include your destination, travellers can send you quote requests, and there is no monthly listing fee.</p>${summary}<p style="margin:12px 0 0;font-size:13px;color:#9a9aa6;">The offer is open until ${esc(athensDate(a.expiresAt))}.</p>`,
        cta: { label: "Review and sign", url },
      });
      const text = `Hi ${partnerName},\n\nYour Planera commission agreement (${a.reference}) is ready to sign.\nCommission: ${t.commissionPct}% of each booking from a Planera request. Listing fee: €0.\n\nReview and sign: ${url}\nOpen until ${athensDate(a.expiresAt)}.`;
      for (const to of recipients) await send(to, `Your Planera agreement is ready to sign (${a.reference})`, html, text);
      return null;
    }

    // Signed: both sides get the full signed text plus the evidence record.
    const evidence = rowsHtml([
      ["Signed by", esc(`${a.signerName}, ${a.signerTitle}`)],
      ["Account", esc(a.signerEmail ?? accountEmail)],
      ["Signed at", esc(new Date(a.signedAt ?? Date.now()).toLocaleString("en-GB", { timeZone: "Europe/Athens" }) + " (Athens)")],
      ["IP address", esc(a.signerIp ?? "not available")],
      ["Signature", a.signatureKind === "typed" ? "Typed name" : "Drawn signature"],
      ["Text fingerprint (SHA-256)", `<code style="font-size:12px;word-break:break-all;color:#fff49f;">${esc(a.bodyHash)}</code>`],
    ]);
    const html = partnerEmailHtml({
      eyebrow: "Agreement signed",
      heading: `${a.reference} is signed and in force`,
      bodyHtml: `<p style="margin:0 0 16px;">Thank you. Your listings now take quote requests through Planera, and the monthly listing fee no longer applies. This email is your copy of the signed agreement. You can also open it and save it as a PDF from the partner portal.</p>${evidence}${agreementTextHtml(a.bodyText)}`,
      cta: { label: "Open the partner portal", url },
    });
    const text = `${a.reference} signed by ${a.signerName}, ${a.signerTitle} on ${athensDate(a.signedAt)}.\nFingerprint (SHA-256): ${a.bodyHash}\n\n${a.bodyText}`;
    for (const to of recipients) await send(to, `Signed: Planera agreement ${a.reference}`, html, text);
    await send(partnerOpsInbox(), `[partner] ${partnerName} signed ${a.reference} (${t.commissionPct}%)`, html, text);
    return null;
  },
});
