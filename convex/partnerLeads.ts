import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authMutation, authQuery } from "./functions";
import { assertAdmin } from "./admin";
import { accountFromToken, normalizeUrl } from "./partnerProducts";
import { partnerListingActive } from "./lib/partnerListingAccess";
import { vatBreakdown, vatExemptionNote } from "./lib/partnerVat";
import {
  athensMonthKey,
  commissionMinor,
  leadReference,
  listingMatchesDestination,
  previousMonthKey,
  statementLines,
  withReferral,
  withinAttribution,
} from "./lib/partnerCommission";
import {
  PORTAL_BASE_URL,
  athensDate,
  esc,
  euro,
  partnerEmailHtml,
  partnerOpsInbox,
  rowsHtml,
} from "./lib/partnerEmails";

/**
 * Commission partners, after signing (see partnerAgreements.ts):
 *
 *  1. Trip matching: approved tours/experiences show in a trip's Packages tab
 *     when the trip's destination matches the listing (`listForTrip`).
 *  2. Quote requests: a traveller sends a request to a commission partner;
 *     it gets a PLN-XXXX reference, emails both sides and lands in the
 *     partner's dashboard (`submitRequest`).
 *  3. Outcomes: the partner marks each request quoted / booked / not booked,
 *     with the booking value (`updateOutcome`), or reports a booking that came
 *     through a Planera tracked link (`recordLinkBooking`).
 *  4. Statements: on the first business day of the month a statement of the
 *     previous month's commission is published (`statementTick` cron), which
 *     the operator invoices in e-timologio and marks paid.
 */

const DAY = 24 * 60 * 60 * 1000;
const TRIP_TYPES = new Set(["tour", "experience", "other"]);
const REQUESTS_PER_USER_PER_DAY = 8;
const DISPUTE_DAYS = 10;

const LEAD_STATUS = v.union(
  v.literal("new"),
  v.literal("quoted"),
  v.literal("booked"),
  v.literal("not_booked"),
  v.literal("cancelled")
);

async function requireAdmin(ctx: any, token: string): Promise<string> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new ConvexError("Unauthorized.");
  await assertAdmin(ctx, session.userId);
  return session.userId;
}

function toMinor(major: number | undefined | null): number | undefined {
  if (major == null || !Number.isFinite(major)) return undefined;
  if (major < 0) throw new ConvexError("Amounts cannot be negative.");
  if (major > 1_000_000) throw new ConvexError("That amount looks too large. Enter it in euros, without VAT.");
  return Math.round(major * 100);
}

function leadView(l: any) {
  const value = l.bookingValueMinor ?? 0;
  const refunded = l.status === "cancelled" ? value : l.refundedMinor ?? 0;
  const inWindow = l.bookedAt ? withinAttribution(l.createdAt, l.bookedAt, l.attributionDays) : true;
  const counts = (l.status === "booked" || l.status === "cancelled") && inWindow;
  return {
    id: l._id,
    reference: l.reference,
    origin: l.origin,
    source: l.source,
    productId: l.productId ?? null,
    productTitle: l.productTitle,
    destination: l.destination ?? null,
    startDate: l.startDate ?? null,
    endDate: l.endDate ?? null,
    travelers: l.travelers ?? null,
    contactName: l.contactName,
    contactEmail: l.contactEmail ?? null,
    contactPhone: l.contactPhone ?? null,
    preferredContactMethod: l.preferredContactMethod ?? null,
    message: l.message ?? null,
    status: l.status,
    currency: l.currency,
    bookingValueMinor: l.bookingValueMinor ?? null,
    refundedMinor: l.refundedMinor ?? null,
    bookedAt: l.bookedAt ?? null,
    partnerNote: l.partnerNote ?? null,
    commissionPct: l.commissionPct,
    attributionEndsAt: l.createdAt + l.attributionDays * DAY,
    inWindow,
    commissionMinor: counts ? commissionMinor(l.commissionPct, value, refunded) : 0,
    emailStatus: l.emailStatus ?? null,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

async function uniqueReference(ctx: any): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const ref = leadReference(bytes);
    const taken = await ctx.db
      .query("partnerLeads")
      .withIndex("by_reference", (q: any) => q.eq("reference", ref))
      .first();
    if (!taken) return ref;
  }
  throw new ConvexError("Could not create a reference. Try again.");
}

/** Statement already invoiced for the month a booking falls in? Then it is locked. */
async function lockedStatementFor(ctx: any, accountId: any, bookedAt?: number) {
  if (!bookedAt) return null;
  const st = await ctx.db
    .query("partnerCommissionStatements")
    .withIndex("by_account_month", (q: any) => q.eq("accountId", accountId).eq("month", athensMonthKey(bookedAt)))
    .first();
  return st && (st.status === "invoiced" || st.status === "paid") ? st : null;
}

// ─────────────────────────────────────────────────────────
// Travellers (app + website, app session token)
// ─────────────────────────────────────────────────────────

/**
 * Supplier tours and experiences that match a trip's destination, shaped like
 * an OTA package card so the Packages tab can render both. `requestable` =
 * the supplier takes quote requests (signed commission agreement); otherwise
 * the card links out to the supplier's site.
 */
export const listForTrip = authQuery({
  args: { tripId: v.id("trips") },
  handler: async (ctx: any, args: any) => {
    const trip = await ctx.db.get(args.tripId);
    if (!trip || trip.userId !== ctx.user.userId) return [];
    const approved = await ctx.db
      .query("partnerProducts")
      .withIndex("by_status_created", (q: any) => q.eq("status", "approved"))
      .order("desc")
      .take(300);

    const accounts = new Map<string, any>();
    const out: any[] = [];
    for (const p of approved) {
      if (!TRIP_TYPES.has(p.type)) continue;
      if (!listingMatchesDestination(trip.destination, p)) continue;
      if (!accounts.has(p.accountId)) {
        const a = await ctx.db.get(p.accountId);
        accounts.set(p.accountId, a && a.status === "active" && partnerListingActive(a) ? a : null);
      }
      const account = accounts.get(p.accountId);
      if (!account) continue;
      const requestable = !!account.commission;
      out.push({
        _id: p._id,
        kind: "partnerProduct",
        type: p.type,
        title: p.title,
        description: p.description ?? undefined,
        subtitle: p.description ? p.description.slice(0, 160) : undefined,
        destinationCity: p.city || p.destination || undefined,
        destinationCountry: p.country || "",
        priceFrom: p.priceOnRequest ? null : p.price ?? null,
        priceCurrency: p.currency ?? "EUR",
        priceOnRequest: !!p.priceOnRequest || p.price == null,
        priceUnit: "per_person",
        includes: [],
        imageUrls: p.imageUrls ?? [],
        heroImageUrl: p.imageUrls?.[0] ?? null,
        bookingUrl: withReferral(normalizeUrl(p.bookingUrl)),
        requestable,
        partner: { _id: account._id, name: account.partnerName },
      });
      if (out.length >= 12) break;
    }
    // Request-taking partners first: they are the ones the traveller can ask.
    out.sort((a, b) => Number(b.requestable) - Number(a.requestable));
    return out;
  },
});

/** Send a quote request to a commission partner. */
export const submitRequest = authMutation({
  args: {
    productId: v.id("partnerProducts"),
    tripId: v.optional(v.id("trips")),
    contactName: v.string(),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
    preferredContactMethod: v.optional(v.union(v.literal("email"), v.literal("phone"), v.literal("any"))),
    message: v.optional(v.string()),
    travelers: v.optional(v.float64()),
    startDate: v.optional(v.float64()),
    endDate: v.optional(v.float64()),
    consentGiven: v.boolean(),
    source: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    if (!args.consentGiven) throw new ConvexError("Please accept sharing your details with the partner.");
    const contactName = args.contactName.trim().slice(0, 120);
    const contactEmail = args.contactEmail.trim().toLowerCase().slice(0, 200);
    if (!contactName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
      throw new ConvexError("Enter your name and a valid email.");
    }
    const product = await ctx.db.get(args.productId);
    if (!product || product.status !== "approved") throw new ConvexError("This experience is no longer available.");
    const account = await ctx.db.get(product.accountId);
    if (!account || account.status !== "active" || !account.commission) {
      throw new ConvexError("This partner does not take requests through Planera.");
    }

    const userId = ctx.user.userId;
    const since = Date.now() - DAY;
    const recent = await ctx.db
      .query("partnerLeads")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(REQUESTS_PER_USER_PER_DAY + 1);
    if (recent.filter((l: any) => l.createdAt > since).length >= REQUESTS_PER_USER_PER_DAY) {
      throw new ConvexError("You have sent a lot of requests today. Please try again tomorrow.");
    }

    let destination = [product.city || product.destination, product.country].filter(Boolean).join(", ");
    let startDate = args.startDate;
    let endDate = args.endDate;
    let travelers = args.travelers;
    if (args.tripId) {
      const trip = await ctx.db.get(args.tripId);
      if (trip && trip.userId === userId) {
        destination = trip.destination ?? destination;
        startDate = startDate ?? trip.startDate;
        endDate = endDate ?? trip.endDate;
        travelers = travelers ?? trip.travelerCount ?? trip.travelers;
      }
    }

    const now = Date.now();
    const reference = await uniqueReference(ctx);
    const leadId = await ctx.db.insert("partnerLeads", {
      reference,
      accountId: account._id,
      productId: product._id,
      productTitle: product.title,
      agreementId: account.commission.agreementId,
      commissionPct: account.commission.commissionPct,
      attributionDays: account.commission.attributionDays,
      origin: "request",
      source: ["ios", "android", "web"].includes(args.source) ? args.source : "unknown",
      userId,
      tripId: args.tripId,
      destination: destination || undefined,
      startDate,
      endDate,
      travelers: typeof travelers === "number" && travelers > 0 ? Math.min(99, Math.round(travelers)) : undefined,
      contactName,
      contactEmail,
      contactPhone: args.contactPhone?.trim().slice(0, 40) || undefined,
      preferredContactMethod: args.preferredContactMethod ?? "any",
      message: args.message?.trim().slice(0, 2000) || undefined,
      consentGiven: true,
      status: "new",
      currency: "EUR",
      emailStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.partnerLeads.dispatchRequestEmails, { leadId });
    return { ok: true as const, reference, partnerName: account.partnerName };
  },
});

// ─────────────────────────────────────────────────────────
// Supplier dashboard (partner portal session)
// ─────────────────────────────────────────────────────────

/** Requests and bookings for the signed-in supplier, newest first, with totals. */
export const listMine = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;
    const rows = await ctx.db
      .query("partnerLeads")
      .withIndex("by_account_created", (q) => q.eq("accountId", account._id))
      .order("desc")
      .take(1000);
    const leads = rows.map(leadView);
    const month = athensMonthKey(Date.now());
    const thisMonth = leads.filter((l) => l.bookedAt && athensMonthKey(l.bookedAt) === month);
    return {
      commission: account.commission
        ? { pct: account.commission.commissionPct, attributionDays: account.commission.attributionDays, since: account.commission.since }
        : null,
      leads,
      totals: {
        requests: leads.filter((l) => l.origin === "request").length,
        open: leads.filter((l) => l.status === "new" || l.status === "quoted").length,
        booked: leads.filter((l) => l.status === "booked").length,
        bookedValueMinor: leads.filter((l) => l.status === "booked").reduce((s, l) => s + (l.bookingValueMinor ?? 0) - (l.refundedMinor ?? 0), 0),
        commissionThisMonthMinor: thisMonth.reduce((s, l) => s + l.commissionMinor, 0),
      },
    };
  },
});

/** Record what happened with a request. Amounts are euros excluding VAT. */
export const updateOutcome = mutation({
  args: {
    token: v.string(),
    leadId: v.id("partnerLeads"),
    status: LEAD_STATUS,
    bookingValue: v.optional(v.float64()),
    refunded: v.optional(v.float64()),
    bookedAt: v.optional(v.float64()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.accountId !== account._id) throw new ConvexError("Request not found.");
    if (await lockedStatementFor(ctx, account._id, lead.bookedAt)) {
      throw new ConvexError("This booking is on a statement that has already been invoiced. Email partners@planeraai.app to change it.");
    }

    const patch: any = { status: args.status, updatedAt: Date.now() };
    if (args.note !== undefined) patch.partnerNote = args.note.trim().slice(0, 1000) || undefined;
    if (args.status === "booked" || args.status === "cancelled") {
      const value = toMinor(args.bookingValue) ?? lead.bookingValueMinor;
      if (!value || value <= 0) throw new ConvexError("Enter the booking value in euros, without VAT.");
      const refunded = toMinor(args.refunded) ?? (args.status === "booked" ? lead.refundedMinor : undefined);
      if (refunded && refunded > value) throw new ConvexError("The refund cannot be more than the booking value.");
      const bookedAt = args.bookedAt ?? lead.bookedAt ?? Date.now();
      if (bookedAt > Date.now() + DAY) throw new ConvexError("The booking date cannot be in the future.");
      if (await lockedStatementFor(ctx, account._id, bookedAt)) {
        throw new ConvexError("That month has already been invoiced. Email partners@planeraai.app to add this booking.");
      }
      patch.bookingValueMinor = value;
      patch.refundedMinor = refunded || undefined;
      patch.bookedAt = bookedAt;
    } else {
      // Not a booking (any more): drop the money fields so nothing is billed.
      patch.bookingValueMinor = undefined;
      patch.refundedMinor = undefined;
      patch.bookedAt = undefined;
    }
    await ctx.db.patch(lead._id, patch);
    return { ok: true as const };
  },
});

/** Report a booking that came through a Planera tracked link (clause 3.3). */
export const recordLinkBooking = mutation({
  args: {
    token: v.string(),
    productId: v.optional(v.id("partnerProducts")),
    customerName: v.string(),
    bookingValue: v.float64(),
    bookedAt: v.optional(v.float64()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    if (!account.commission) throw new ConvexError("Bookings can be recorded once your commission agreement is signed.");
    const name = args.customerName.trim().slice(0, 120);
    if (!name) throw new ConvexError("Enter the customer's name or booking reference.");
    const value = toMinor(args.bookingValue);
    if (!value || value <= 0) throw new ConvexError("Enter the booking value in euros, without VAT.");
    const bookedAt = args.bookedAt ?? Date.now();
    if (bookedAt > Date.now() + DAY) throw new ConvexError("The booking date cannot be in the future.");
    if (await lockedStatementFor(ctx, account._id, bookedAt)) {
      throw new ConvexError("That month has already been invoiced. Email partners@planeraai.app to add this booking.");
    }
    let productTitle = "Booking from a Planera link";
    if (args.productId) {
      const p = await ctx.db.get(args.productId);
      if (!p || p.accountId !== account._id) throw new ConvexError("Experience not found.");
      productTitle = p.title;
    }
    const now = Date.now();
    const reference = await uniqueReference(ctx);
    await ctx.db.insert("partnerLeads", {
      reference,
      accountId: account._id,
      productId: args.productId,
      productTitle,
      agreementId: account.commission.agreementId,
      commissionPct: account.commission.commissionPct,
      attributionDays: account.commission.attributionDays,
      origin: "link",
      source: "portal",
      contactName: name,
      consentGiven: false,
      status: "booked",
      currency: "EUR",
      bookingValueMinor: value,
      bookedAt,
      partnerNote: args.note?.trim().slice(0, 1000) || undefined,
      // The window opens at the booking for link bookings: the click itself
      // is not something we can see per customer.
      createdAt: Math.min(now, bookedAt),
      updatedAt: now,
    });
    return { ok: true as const, reference };
  },
});

function statementView(s: any) {
  return {
    id: s._id,
    accountId: s.accountId,
    partnerName: s.partnerName,
    month: s.month,
    currency: s.currency,
    lines: s.lines,
    netMinor: s.netMinor,
    vatRatePct: s.vatRatePct,
    vatMinor: s.vatMinor,
    totalMinor: s.totalMinor,
    vatNote: s.vatNote ?? null,
    status: s.status,
    publishedAt: s.publishedAt,
    disputeDeadline: s.disputeDeadline,
    canDispute: s.status === "open" && Date.now() < s.disputeDeadline,
    disputeNote: s.disputeNote ?? null,
    invoiceNumber: s.invoiceNumber ?? null,
    invoicedAt: s.invoicedAt ?? null,
    paidAt: s.paidAt ?? null,
  };
}

export const listMyStatements = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;
    const rows = await ctx.db
      .query("partnerCommissionStatements")
      .withIndex("by_account_month", (q) => q.eq("accountId", account._id))
      .order("desc")
      .take(60);
    return rows.map(statementView);
  },
});

export const disputeStatement = mutation({
  args: { token: v.string(), statementId: v.id("partnerCommissionStatements"), note: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    const s = await ctx.db.get(args.statementId);
    if (!s || s.accountId !== account._id) throw new ConvexError("Statement not found.");
    if (s.status !== "open" || Date.now() > s.disputeDeadline) {
      throw new ConvexError("The 10 day window to dispute this statement has closed. Email partners@planeraai.app.");
    }
    const note = args.note.trim().slice(0, 2000);
    if (!note) throw new ConvexError("Tell us which line is wrong and why.");
    await ctx.db.patch(s._id, { status: "disputed", disputeNote: note, disputedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.partnerLeads.sendDisputeAlert, { statementId: s._id });
    return { ok: true as const };
  },
});

// ─────────────────────────────────────────────────────────
// Admin (website /admin)
// ─────────────────────────────────────────────────────────

export const adminOverview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const leads = await ctx.db.query("partnerLeads").order("desc").take(300);
    const statements = await ctx.db.query("partnerCommissionStatements").order("desc").take(120);
    const names = new Map<string, string>();
    for (const l of leads) {
      if (!names.has(l.accountId)) names.set(l.accountId, (await ctx.db.get(l.accountId))?.partnerName ?? "");
    }
    return {
      leads: leads.map((l) => ({ ...leadView(l), partnerName: names.get(l.accountId) ?? "" })),
      statements: statements.map(statementView),
      previousMonth: previousMonthKey(athensMonthKey(Date.now())),
    };
  },
});

export const adminSetStatementStatus = mutation({
  args: {
    token: v.string(),
    statementId: v.id("partnerCommissionStatements"),
    status: v.union(v.literal("open"), v.literal("invoiced"), v.literal("paid")),
    invoiceNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const s = await ctx.db.get(args.statementId);
    if (!s) throw new ConvexError("Statement not found.");
    const patch: any = { status: args.status };
    if (args.status === "invoiced") {
      const n = args.invoiceNumber?.trim();
      if (!n) throw new ConvexError("Enter the invoice number from e-timologio.");
      patch.invoiceNumber = n;
      patch.invoicedAt = Date.now();
    }
    if (args.status === "paid") {
      if (!s.invoiceNumber && !args.invoiceNumber?.trim()) throw new ConvexError("Mark it invoiced first.");
      if (args.invoiceNumber?.trim()) patch.invoiceNumber = args.invoiceNumber.trim();
      patch.paidAt = Date.now();
    }
    await ctx.db.patch(s._id, patch);
    return { ok: true as const };
  },
});

/** Build (or rebuild, while still open or disputed) the statements for a month. */
export const adminGenerateStatements = mutation({
  args: { token: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw new ConvexError("Month must look like 2026-11.");
    return await generateForMonth(ctx, args.month, { rebuild: true, notify: false });
  },
});

// ─────────────────────────────────────────────────────────
// Statements: generation + cron
// ─────────────────────────────────────────────────────────

async function generateForMonth(ctx: any, month: string, opts: { rebuild: boolean; notify: boolean }) {
  // Accounts that have ever had a signed agreement (current or ended).
  const agreements = [
    ...(await ctx.db.query("partnerAgreements").withIndex("by_status", (q: any) => q.eq("status", "signed")).collect()),
    ...(await ctx.db.query("partnerAgreements").withIndex("by_status", (q: any) => q.eq("status", "terminated")).collect()),
  ];
  const accountIds = Array.from(new Set(agreements.map((a: any) => a.accountId as string)));
  let created = 0;
  let updated = 0;
  const now = Date.now();
  for (const accountId of accountIds) {
    const account = await ctx.db.get(accountId as any);
    if (!account) continue;
    const existing = await ctx.db
      .query("partnerCommissionStatements")
      .withIndex("by_account_month", (q: any) => q.eq("accountId", accountId).eq("month", month))
      .first();
    if (existing && (!opts.rebuild || existing.status === "invoiced" || existing.status === "paid")) continue;

    // Bookings dated from a few days before the month to its end (Athens offset slack).
    const [y, m] = month.split("-").map(Number);
    const from = Date.UTC(y, m - 1, 1) - 3 * DAY;
    const to = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) + 3 * DAY;
    const leads = await ctx.db
      .query("partnerLeads")
      .withIndex("by_account_booked", (q: any) => q.eq("accountId", accountId).gte("bookedAt", from).lt("bookedAt", to))
      .collect();
    const { lines, totalMinor } = statementLines(leads as any, month);
    if (lines.length === 0 && !existing) continue;

    const country = account.billingDetails?.country ?? "GR";
    const vat = vatBreakdown(totalMinor, country);
    const doc = {
      accountId: account._id,
      partnerName: account.partnerName,
      month,
      currency: "EUR",
      lines,
      netMinor: vat.netMinor,
      vatRatePct: vat.ratePct,
      vatMinor: vat.vatMinor,
      totalMinor: vat.totalMinor,
      vatNote: vatExemptionNote(country),
    };
    if (existing) {
      await ctx.db.patch(existing._id, { ...doc, status: "open", disputeNote: undefined, disputedAt: undefined, publishedAt: now, disputeDeadline: now + DISPUTE_DAYS * DAY });
      updated++;
      if (opts.notify) await ctx.scheduler.runAfter(0, internal.partnerLeads.sendStatementEmail, { statementId: existing._id });
    } else {
      const id = await ctx.db.insert("partnerCommissionStatements", { ...doc, status: "open", publishedAt: now, disputeDeadline: now + DISPUTE_DAYS * DAY });
      created++;
      if (opts.notify) await ctx.scheduler.runAfter(0, internal.partnerLeads.sendStatementEmail, { statementId: id });
    }
  }
  return { month, created, updated };
}

/**
 * Daily cron. On the first business day of the month (Mon to Fri, day 1 to 3,
 * Athens time) publish last month's statements. Idempotent: an account whose
 * statement already exists for that month is skipped.
 */
export const statementTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", day: "numeric", weekday: "short" }).formatToParts(now);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (day > 3 || weekday === "Sat" || weekday === "Sun") return null;
    const month = previousMonthKey(athensMonthKey(now.getTime()));
    return await generateForMonth(ctx, month, { rebuild: false, notify: true });
  },
});

// ─────────────────────────────────────────────────────────
// Emails
// ─────────────────────────────────────────────────────────

export const getLeadForEmail = internalQuery({
  args: { leadId: v.id("partnerLeads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return null;
    const account = await ctx.db.get(lead.accountId);
    const agreement = lead.agreementId ? await ctx.db.get(lead.agreementId) : null;
    return { lead, account, partnerEmail: agreement?.partner.email ?? null, replyDays: agreement?.terms.replyBusinessDays ?? 2 };
  },
});

export const markLeadEmail = internalMutation({
  args: { leadId: v.id("partnerLeads"), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, { emailStatus: args.ok ? "sent" : "failed", emailError: args.error });
    return null;
  },
});

export const dispatchRequestEmails = internalAction({
  args: { leadId: v.id("partnerLeads") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.partnerLeads.getLeadForEmail, { leadId: args.leadId });
    if (!data || !data.account) return null;
    const { lead, account, partnerEmail, replyDays } = data;
    const dates =
      lead.startDate || lead.endDate
        ? [athensDate(lead.startDate), athensDate(lead.endDate)].filter(Boolean).join(" to ")
        : "Not set";
    const rows = rowsHtml([
      ["Reference", `<strong style="color:#FFE500;">${esc(lead.reference)}</strong>`],
      ["Experience", esc(lead.productTitle)],
      ["Trip", esc(lead.destination ?? "")],
      ["Dates", esc(dates)],
      ["Travellers", esc(lead.travelers ?? "Not set")],
      ["Name", esc(lead.contactName)],
      ["Email", esc(lead.contactEmail ?? "")],
      ["Phone", esc(lead.contactPhone ?? "Not given")],
      ["Prefers", esc(lead.preferredContactMethod ?? "any")],
    ]);
    const note = lead.message
      ? `<div style="margin:16px 0 0;padding:14px 16px;background:#1f1f27;border-left:3px solid #FFE500;border-radius:8px;color:#e4e4ea;white-space:pre-wrap;">${esc(lead.message)}</div>`
      : "";
    const html = partnerEmailHtml({
      eyebrow: "New quote request",
      heading: lead.productTitle,
      bodyHtml: `<p style="margin:0 0 16px;">A Planera traveller would like a quote. Reply to this email to answer them directly, ideally within ${esc(replyDays)} business days. Please keep the reference <strong style="color:#fff;">${esc(lead.reference)}</strong> on your quote and booking, and record the outcome in your dashboard.</p>${rows}${note}`,
      cta: { label: "Open your requests", url: `${PORTAL_BASE_URL}/partners/leads` },
    });
    const text = [
      `New Planera quote request ${lead.reference}`,
      `Experience: ${lead.productTitle}`,
      `Trip: ${lead.destination ?? ""}`,
      `Dates: ${dates}`,
      `Travellers: ${lead.travelers ?? "Not set"}`,
      `Name: ${lead.contactName}`,
      `Email: ${lead.contactEmail ?? ""}`,
      `Phone: ${lead.contactPhone ?? "Not given"}`,
      lead.message ? `Message: ${lead.message}` : "",
      "",
      `Record the outcome: ${PORTAL_BASE_URL}/partners/leads`,
    ].filter(Boolean).join("\n");

    const to = Array.from(new Set([account.email, partnerEmail].filter((e): e is string => !!e).map((e) => e.toLowerCase())));
    let ok = true;
    let error: string | undefined;
    for (const addr of to) {
      try {
        await ctx.runAction(internal.postmark.sendRawEmail, {
          to: addr,
          subject: `Quote request ${lead.reference}: ${lead.productTitle}`,
          html,
          text,
          replyTo: lead.contactEmail ?? undefined,
          tag: "partner-lead",
        });
      } catch (e) {
        ok = false;
        error = e instanceof Error ? e.message : String(e);
      }
    }
    await ctx.runMutation(internal.partnerLeads.markLeadEmail, { leadId: lead._id, ok, error });

    if (lead.contactEmail) {
      const userHtml = partnerEmailHtml({
        eyebrow: "Request sent",
        heading: `${account.partnerName} has your request`,
        bodyHtml: `<p style="margin:0 0 16px;">Hi ${esc(lead.contactName)}, we sent your request for <strong style="color:#fff;">${esc(lead.productTitle)}</strong> to ${esc(account.partnerName)}. They will reply to you directly with a quote. Your reference is <strong style="color:#FFE500;">${esc(lead.reference)}</strong>.</p><p style="margin:0;font-size:13px;color:#9a9aa6;">${esc(account.partnerName)} sells and runs this experience and you pay them directly. Planera only passes on your request.</p>`,
      });
      try {
        await ctx.runAction(internal.postmark.sendRawEmail, {
          to: lead.contactEmail,
          subject: `Your request to ${account.partnerName} (${lead.reference})`,
          html: userHtml,
          text: `Hi ${lead.contactName},\n\nWe sent your request for "${lead.productTitle}" to ${account.partnerName}. They will reply with a quote. Reference: ${lead.reference}.\n\nPlanera AI`,
          tag: "partner-lead-confirmation",
        });
      } catch (e) {
        console.error("[partnerLeads] confirmation email failed", e);
      }
    }
    return null;
  },
});

export const getStatementForEmail = internalQuery({
  args: { statementId: v.id("partnerCommissionStatements") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.statementId);
    if (!s) return null;
    const account = await ctx.db.get(s.accountId);
    return { s, email: account?.email ?? null, billing: account?.billingDetails ?? null };
  },
});

function statementTableHtml(s: any): string {
  const lines = s.lines
    .map(
      (l: any) =>
        `<tr><td style="padding:6px 0;color:#f2f2f5;">${esc(l.reference)}<br/><span style="color:#9a9aa6;font-size:12px;">${esc(l.productTitle)} · ${esc(athensDate(l.bookedAt))}</span></td><td style="padding:6px 0;text-align:right;color:#c4c4cf;">${esc(euro(l.bookingValueMinor - l.refundedMinor))}</td><td style="padding:6px 0;text-align:right;color:#fff;">${esc(euro(l.commissionMinor))}</td></tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0 12px;"><tr><th style="text-align:left;color:#9a9aa6;font-weight:600;padding-bottom:6px;">Booking</th><th style="text-align:right;color:#9a9aa6;font-weight:600;">Value</th><th style="text-align:right;color:#9a9aa6;font-weight:600;">Commission</th></tr>${lines}</table>${rowsHtml([
    ["Commission (net)", esc(euro(s.netMinor))],
    [`VAT ${s.vatRatePct}%`, esc(euro(s.vatMinor))],
    ["Total", `<strong style="color:#FFE500;">${esc(euro(s.totalMinor))}</strong>`],
  ])}`;
}

export const sendStatementEmail = internalAction({
  args: { statementId: v.id("partnerCommissionStatements") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.partnerLeads.getStatementForEmail, { statementId: args.statementId });
    if (!data) return null;
    const { s, email, billing } = data;
    const table = statementTableHtml(s);
    if (email) {
      const html = partnerEmailHtml({
        eyebrow: `Statement ${s.month}`,
        heading: `Your Planera commission for ${s.month}`,
        bodyHtml: `<p style="margin:0 0 12px;">Here are the bookings from Planera requests that you recorded for ${esc(s.month)}. If a line is wrong, you can dispute it from your dashboard until ${esc(athensDate(s.disputeDeadline))}. After that, Planera issues the invoice.</p>${table}`,
        cta: { label: "View the statement", url: `${PORTAL_BASE_URL}/partners/leads#statements` },
      });
      try {
        await ctx.runAction(internal.postmark.sendRawEmail, {
          to: email,
          subject: `Planera commission statement ${s.month}: ${euro(s.totalMinor)}`,
          html,
          text: `Planera commission statement ${s.month}\nNet ${euro(s.netMinor)}, VAT ${euro(s.vatMinor)}, total ${euro(s.totalMinor)}.\nDispute until ${athensDate(s.disputeDeadline)}: ${PORTAL_BASE_URL}/partners/leads`,
          tag: "partner-statement",
        });
      } catch (e) {
        console.error("[partnerLeads] statement email failed", e);
      }
    }
    // Operator copy with the fields e-timologio asks for.
    const ops = rowsHtml([
      ["Partner", esc(s.partnerName)],
      ["ΑΦΜ", esc(billing?.vatNumber ?? "missing")],
      ["Επωνυμία", esc(billing?.legalName ?? s.partnerName)],
      ["Περιγραφή", esc(`Προμήθεια παραπομπής πελατών μέσω Planera, ${s.month}`)],
      ["Καθαρό", esc(euro(s.netMinor))],
      [`ΦΠΑ ${s.vatRatePct}%`, esc(euro(s.vatMinor))],
      ["Σύνολο", esc(euro(s.totalMinor))],
      ["Σημείωση ΦΠΑ", esc(s.vatNote ?? "")],
    ]);
    try {
      await ctx.runAction(internal.postmark.sendRawEmail, {
        to: partnerOpsInbox(),
        subject: `[partner] Commission statement ${s.month}: ${s.partnerName} ${euro(s.totalMinor)}`,
        html: partnerEmailHtml({ eyebrow: "Τιμολόγιο to issue after the dispute window", heading: `${s.partnerName}, ${s.month}`, bodyHtml: `${ops}${table}` }),
        text: `${s.partnerName} ${s.month}: net ${euro(s.netMinor)}, VAT ${euro(s.vatMinor)}, total ${euro(s.totalMinor)}`,
        tag: "partner-statement-ops",
      });
    } catch (e) {
      console.error("[partnerLeads] ops statement email failed", e);
    }
    return null;
  },
});

export const sendDisputeAlert = internalAction({
  args: { statementId: v.id("partnerCommissionStatements") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.partnerLeads.getStatementForEmail, { statementId: args.statementId });
    if (!data) return null;
    const { s } = data;
    try {
      await ctx.runAction(internal.postmark.sendRawEmail, {
        to: partnerOpsInbox(),
        subject: `[partner] ${s.partnerName} disputed statement ${s.month}`,
        html: partnerEmailHtml({
          eyebrow: "Statement disputed",
          heading: `${s.partnerName}, ${s.month}`,
          bodyHtml: `<div style="padding:14px 16px;background:#1f1f27;border-left:3px solid #FFE500;border-radius:8px;white-space:pre-wrap;">${esc(s.disputeNote ?? "")}</div>`,
        }),
        text: `${s.partnerName} disputed ${s.month}: ${s.disputeNote ?? ""}`,
        tag: "partner-statement-dispute",
      });
    } catch (e) {
      console.error("[partnerLeads] dispute alert failed", e);
    }
    return null;
  },
});
