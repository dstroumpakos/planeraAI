/**
 * Planera for Travel Agencies — after "yes": travellers, booking, confirmation (pure).
 *
 * A quote used to end at acceptance. Everything after it — collecting names and
 * dates of birth, booking each service, writing down the PNR and the voucher
 * number, knowing what is still unticketed and what the client has paid — lived
 * in an email thread and the agent's memory. This module is the record of that
 * work, one entry per service in the chosen option.
 *
 * Two ways a line gets booked, and the record says which:
 *  - "api"    — Planera created the order with the supplier, on the agency's own
 *               credentials (Duffel, Hotelbeds). The reference is the supplier's.
 *  - "manual" — the agency booked it in its own GDS / extranet / by phone and
 *               typed the reference in. Most lines, for most agencies, today.
 *
 * Planera is never the seller: the agency collects the money and issues the
 * documents. `payment` is the agency's own ledger note, not a charge.
 */

import type { CurrencyCode, Money, PackageLine, PackageTier, TravelPackage } from "./model/types";
import { MANUAL_CONNECTOR_ID, money } from "./model/types";
import { ValidationError } from "./validation";

// ── Travellers ──────────────────────────────────────────────────────────────

export type TravellerType = "adult" | "child" | "infant";

export interface Traveller {
  type: TravellerType;
  title: "mr" | "ms" | "mrs" | "miss";
  /** As printed in the passport — airlines reject a ticket over one letter. */
  givenName: string;
  familyName: string;
  /** YYYY-MM-DD */
  bornOn: string;
  gender: "m" | "f";
}

export interface TravellerContact {
  email: string;
  /** E.164, e.g. +306912345678 — what airlines require for disruption notices. */
  phone: string;
}

export interface TravellerDetails {
  travellers: Traveller[];
  contact: TravellerContact;
  submittedAt: number;
  /** "client" = typed on the quote link; "agent" = typed in the workspace. */
  submittedBy: "client" | "agent";
}

const NAME_RE = /^[\p{L}][\p{L}' .-]{0,59}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

/** Ages at `onDate`, in whole years. */
export function ageOn(bornOn: string, onDate: string): number {
  const [by, bm, bd] = bornOn.split("-").map(Number);
  const [ty, tm, td] = onDate.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Normalise a phone the way people actually type it in Greece: spaces, dashes,
 * a leading 00, or a bare 69… mobile. Returns E.164 or throws.
 */
export function normalizePhone(raw: string): string {
  let p = (raw ?? "").replace(/[\s().-]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (/^(69\d{8}|2\d{9})$/.test(p)) p = `+30${p}`;
  if (!PHONE_RE.test(p)) {
    throw new ValidationError("phone must include the country code, e.g. +30 691 234 5678");
  }
  return p;
}

/**
 * Validate the passenger list against the party the quote was priced for. A
 * fare is priced per passenger type, so four names for a quote priced for
 * three, or a "child" who is 30, would be refused by the airline at booking —
 * better refused here, while the client is still on the form.
 */
export function validateTravellers(
  input: { travellers: Traveller[]; contact: TravellerContact },
  party: { adults: number; childrenAges: number[]; departDate: string },
  today: string,
): { travellers: Traveller[]; contact: TravellerContact } {
  const expected = party.adults + party.childrenAges.length;
  if (!Array.isArray(input.travellers) || input.travellers.length !== expected) {
    throw new ValidationError(`this trip is for ${expected} travellers — enter each of them`);
  }

  const travellers = input.travellers.map((t, i) => {
    const n = i + 1;
    const givenName = (t.givenName ?? "").trim().replace(/\s+/g, " ");
    const familyName = (t.familyName ?? "").trim().replace(/\s+/g, " ");
    if (!NAME_RE.test(givenName) || !NAME_RE.test(familyName)) {
      throw new ValidationError(`traveller ${n}: first and last name as in the passport`);
    }
    if (!isRealDate(t.bornOn) || t.bornOn >= today) {
      throw new ValidationError(`traveller ${n}: date of birth is not valid`);
    }
    if (!["m", "f"].includes(t.gender)) throw new ValidationError(`traveller ${n}: choose a gender`);
    if (!["mr", "ms", "mrs", "miss"].includes(t.title)) {
      throw new ValidationError(`traveller ${n}: choose a title`);
    }
    const age = ageOn(t.bornOn, party.departDate);
    if (age > 120) throw new ValidationError(`traveller ${n}: date of birth is not valid`);
    const type: TravellerType = age < 2 ? "infant" : age < 12 ? "child" : "adult";
    return { type, title: t.title, givenName, familyName, bornOn: t.bornOn, gender: t.gender };
  });

  // The fare was priced for this many ADULTS; a mismatch changes the price.
  const adults = travellers.filter((t) => t.type === "adult").length;
  if (adults !== party.adults) {
    throw new ValidationError(
      `the offer was priced for ${party.adults} adult${party.adults === 1 ? "" : "s"} (12+ on the departure date) — check the dates of birth`,
    );
  }
  const infants = travellers.filter((t) => t.type === "infant").length;
  if (infants > adults) throw new ValidationError("each infant must travel with an adult");

  const email = (input.contact?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new ValidationError("a contact email is required");
  }
  return { travellers, contact: { email, phone: normalizePhone(input.contact?.phone ?? "") } };
}

// ── Booking record ──────────────────────────────────────────────────────────

export type BookingStatus =
  /** Nothing done yet. */
  | "pending"
  /** An API booking is in flight. Locks the line against a second attempt. */
  | "booking"
  /** Asked the supplier, waiting (on request / manual). */
  | "requested"
  /** Supplier confirmed; a reference exists. */
  | "confirmed"
  /** Tickets / vouchers issued. */
  | "ticketed"
  /** Supplier refused. Safe to try again. */
  | "failed"
  /**
   * We do not know. The call timed out or dropped AFTER it was sent, so an
   * order MAY exist. Must be checked in the supplier's own system before any
   * retry, or the client is booked twice.
   */
  | "unknown"
  | "cancelled";

export interface BookingLine {
  offerId: string;
  kind: PackageLine["kind"];
  connectorId: string;
  /** What the line is, for the agent's checklist and the client's confirmation. */
  title: string;
  status: BookingStatus;
  mode?: "api" | "manual";
  /** PNR / booking reference / voucher number. */
  supplierReference?: string;
  /** Supplier-side order id, where it differs from the reference. */
  supplierBookingId?: string;
  /** Ticket numbers, voucher codes. */
  documents?: string[];
  /** Last moment to ticket / pay the supplier (ISO). */
  deadlineISO?: string;
  /** What the supplier actually charged, when it told us. */
  amountCharged?: Money;
  /** Agent-only working note. */
  note?: string;
  error?: string;
  updatedAt: number;
  updatedByUserId?: string;
}

export type PaymentStatus = "unpaid" | "deposit" | "paid" | "refunded";

export interface Fulfilment {
  tier: PackageTier;
  startedAt: number;
  lines: BookingLine[];
  payment: {
    status: PaymentStatus;
    /** What the client has paid the AGENCY so far. */
    received: Money;
    due: Money;
    note?: string;
    updatedAt: number;
  };
  /** When the agent released the confirmation to the client's link. */
  confirmationSharedAt?: number;
}

export function lineTitle(line: PackageLine): string {
  const o = line.offer;
  switch (o.kind) {
    case "flight": {
      const first = o.outbound[0];
      const last = o.outbound[o.outbound.length - 1];
      const carrier = first?.carrier ? `${first.carrier} ` : "";
      return `${carrier}${first?.fromIata ?? ""} → ${last?.toIata ?? ""}${o.inbound?.length ? " (με επιστροφή)" : ""}`;
    }
    case "hotel":
      return `${o.name}${o.nights ? ` · ${o.nights} νύχτες` : ""}`;
    case "activity":
      return o.title;
    case "transfer":
      return `Μεταφορά ${o.fromLabel} → ${o.toLabel}`;
    case "service":
      return o.title;
  }
}

/** Open the booking record for the option the client chose. */
export function startFulfilment(
  packages: TravelPackage[],
  tier: PackageTier,
  now: number,
  userId?: string,
): Fulfilment {
  const pkg = packages.find((p) => p.tier === tier);
  if (!pkg || pkg.lines.length === 0) throw new ValidationError("that option has nothing to book");
  const due = pkg.totals.internal.customerPrice;
  return {
    tier,
    startedAt: now,
    lines: pkg.lines.map((l) => ({
      offerId: l.offer.offerId,
      kind: l.kind,
      connectorId: l.offer.connectorId,
      title: lineTitle(l),
      status: "pending",
      updatedAt: now,
      updatedByUserId: userId,
    })),
    payment: { status: "unpaid", received: money(0, due.currency), due, updatedAt: now },
  };
}

/**
 * Re-sync the record after the chosen option was edited: new lines appear as
 * pending, removed lines disappear — UNLESS work was already done on them. A
 * booked line vanishing from the checklist because someone tidied the quote is
 * how a hotel gets paid for and never cancelled.
 */
export function syncFulfilment(f: Fulfilment, packages: TravelPackage[], now: number): Fulfilment {
  const pkg = packages.find((p) => p.tier === f.tier);
  if (!pkg) return f;
  const byId = new Map(f.lines.map((l) => [l.offerId, l]));
  const kept = pkg.lines.map(
    (l) =>
      byId.get(l.offer.offerId) ?? {
        offerId: l.offer.offerId,
        kind: l.kind,
        connectorId: l.offer.connectorId,
        title: lineTitle(l),
        status: "pending" as const,
        updatedAt: now,
      },
  );
  const inPkg = new Set(pkg.lines.map((l) => l.offer.offerId));
  const orphans = f.lines.filter((l) => !inPkg.has(l.offerId) && l.status !== "pending");
  return {
    ...f,
    lines: [...kept, ...orphans],
    payment: { ...f.payment, due: pkg.totals.internal.customerPrice },
  };
}

const TERMINAL_OK: BookingStatus[] = ["confirmed", "ticketed"];

export type FulfilmentStage = "collecting" | "in_progress" | "confirmed" | "attention";

/** One word for the whole trip, for the list view and the client's page. */
export function fulfilmentStage(f: Fulfilment): FulfilmentStage {
  const live = f.lines.filter((l) => l.status !== "cancelled");
  if (live.some((l) => l.status === "failed" || l.status === "unknown")) return "attention";
  if (live.length > 0 && live.every((l) => TERMINAL_OK.includes(l.status))) return "confirmed";
  if (live.every((l) => l.status === "pending")) return "collecting";
  return "in_progress";
}

export interface ManualLineUpdate {
  status: BookingStatus;
  supplierReference?: string;
  documents?: string[];
  deadlineISO?: string;
  note?: string;
}

/** An agent recording what happened on a line they booked outside Planera. */
export function applyManualUpdate(
  f: Fulfilment,
  offerId: string,
  u: ManualLineUpdate,
  now: number,
  userId: string,
): Fulfilment {
  const i = f.lines.findIndex((l) => l.offerId === offerId);
  if (i < 0) throw new ValidationError("that service is not part of this booking");
  const line = f.lines[i];
  // "booking" belongs to the API call that holds it; overwriting it from the
  // form would let a second attempt start while the first is still in flight.
  if (line.status === "booking") {
    throw new ValidationError("a booking request for this service is still running");
  }
  if (u.status === "booking") throw new ValidationError("not a status that can be set by hand");
  const ref = u.supplierReference?.trim().slice(0, 40) || undefined;
  if (TERMINAL_OK.includes(u.status) && !ref && !line.supplierReference) {
    throw new ValidationError("add the booking reference (PNR / voucher) to confirm it");
  }
  if (u.deadlineISO && Number.isNaN(Date.parse(u.deadlineISO))) {
    throw new ValidationError("the deadline is not a valid date");
  }
  const documents = u.documents
    ?.map((d) => d.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);

  const lines = f.lines.slice();
  lines[i] = {
    ...line,
    status: u.status,
    mode: line.mode === "api" && line.supplierReference ? "api" : "manual",
    supplierReference: ref ?? line.supplierReference,
    documents: documents ?? line.documents,
    deadlineISO: u.deadlineISO || line.deadlineISO,
    note: u.note === undefined ? line.note : u.note.trim().slice(0, 500) || undefined,
    error: TERMINAL_OK.includes(u.status) ? undefined : line.error,
    updatedAt: now,
    updatedByUserId: userId,
  };
  return { ...f, lines };
}

/** Lock a line for an API booking. Throws when a second attempt would be unsafe. */
export function lockForBooking(f: Fulfilment, offerId: string, now: number, userId: string): Fulfilment {
  const i = f.lines.findIndex((l) => l.offerId === offerId);
  if (i < 0) throw new ValidationError("that service is not part of this booking");
  const line = f.lines[i];
  if (line.connectorId === MANUAL_CONNECTOR_ID) {
    throw new ValidationError("a service you added by hand is booked outside Planera");
  }
  switch (line.status) {
    case "booking":
      throw new ValidationError("a booking request for this service is already running");
    case "confirmed":
    case "ticketed":
      throw new ValidationError("this service is already booked");
    case "unknown":
      // THE dangerous case. See BookingStatus.unknown.
      throw new ValidationError(
        "the last attempt may have gone through — check the supplier's system, then record the result by hand",
      );
    case "cancelled":
      throw new ValidationError("this service was cancelled");
  }
  const lines = f.lines.slice();
  lines[i] = { ...line, status: "booking", error: undefined, updatedAt: now, updatedByUserId: userId };
  return { ...f, lines };
}

export interface BookingOutcome {
  status: "confirmed" | "ticketed" | "requested" | "failed" | "unknown";
  supplierReference?: string;
  supplierBookingId?: string;
  documents?: string[];
  deadlineISO?: string;
  amountCharged?: Money;
  message?: string;
}

export function recordBookingOutcome(
  f: Fulfilment,
  offerId: string,
  outcome: BookingOutcome,
  now: number,
): Fulfilment {
  const i = f.lines.findIndex((l) => l.offerId === offerId);
  if (i < 0) return f;
  const lines = f.lines.slice();
  const ok = outcome.status !== "failed" && outcome.status !== "unknown";
  lines[i] = {
    ...lines[i],
    status: outcome.status,
    mode: "api",
    supplierReference: outcome.supplierReference ?? lines[i].supplierReference,
    supplierBookingId: outcome.supplierBookingId ?? lines[i].supplierBookingId,
    documents: outcome.documents?.length ? outcome.documents : lines[i].documents,
    deadlineISO: outcome.deadlineISO ?? lines[i].deadlineISO,
    amountCharged: outcome.amountCharged ?? lines[i].amountCharged,
    error: ok ? undefined : (outcome.message ?? "the supplier did not confirm").slice(0, 300),
    updatedAt: now,
  };
  return { ...f, lines };
}

export function setPayment(
  f: Fulfilment,
  input: { status: PaymentStatus; receivedMinor: number; note?: string },
  now: number,
): Fulfilment {
  if (!["unpaid", "deposit", "paid", "refunded"].includes(input.status)) {
    throw new ValidationError("unknown payment status");
  }
  if (!Number.isInteger(input.receivedMinor) || input.receivedMinor < 0) {
    throw new ValidationError("the amount received must be zero or more");
  }
  const cur: CurrencyCode = f.payment.due.currency;
  return {
    ...f,
    payment: {
      ...f.payment,
      status: input.status,
      received: money(input.receivedMinor, cur),
      note: input.note?.trim().slice(0, 300) || undefined,
      updatedAt: now,
    },
  };
}

// ── What the client sees ────────────────────────────────────────────────────

export interface CustomerBookingView {
  stage: FulfilmentStage;
  tier: PackageTier;
  /** Present only once the agent released the confirmation. */
  confirmation: null | {
    sharedAt: number;
    lines: Array<{
      title: string;
      kind: PackageLine["kind"];
      status: "confirmed" | "ticketed" | "in_progress";
      reference?: string;
      documents?: string[];
    }>;
  };
  travellersSubmitted: boolean;
  travellersExpected: number;
}

/**
 * The client's view of the booking. Never the agent's notes, the supplier's
 * order id, the amount charged, or the payment ledger — and until the agent
 * releases it, not even the references: a PNR the agent has not checked yet is
 * not something to hand a client.
 */
export function toCustomerBooking(
  f: Fulfilment | undefined,
  travellersSubmitted: boolean,
  travellersExpected: number,
): CustomerBookingView | null {
  if (!f) return null;
  return {
    stage: fulfilmentStage(f),
    tier: f.tier,
    travellersSubmitted,
    travellersExpected,
    confirmation: f.confirmationSharedAt
      ? {
          sharedAt: f.confirmationSharedAt,
          lines: f.lines
            .filter((l) => l.status !== "cancelled")
            .map((l) => ({
              title: l.title,
              kind: l.kind,
              status:
                l.status === "ticketed"
                  ? ("ticketed" as const)
                  : l.status === "confirmed"
                    ? ("confirmed" as const)
                    : ("in_progress" as const),
              reference: TERMINAL_OK.includes(l.status) ? l.supplierReference : undefined,
              documents: TERMINAL_OK.includes(l.status) ? l.documents : undefined,
            })),
        }
      : null,
  };
}
