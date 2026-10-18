/**
 * Commission partnerships: pure logic shared by the agreement, lead and
 * statement functions (partnerAgreements.ts, partnerLeads.ts). No ctx, no db,
 * so it is unit-tested by scripts/test-partner-commission.ts.
 *
 * A supplier on a commission agreement pays no listing fee. Instead, every
 * quote request Planera forwards carries a reference code, the supplier
 * records which requests became bookings, and Planera invoices a percentage
 * of those bookings once a month.
 *
 * The agreement text is built here from structured sections so the portal
 * can render it nicely, while `agreementPlainText` gives the one canonical
 * string whose SHA-256 is what the supplier actually signs.
 */

// ─────────────────────────────────────────────────────────
// Parties and terms
// ─────────────────────────────────────────────────────────

/** Bumped whenever the template wording changes. Stored on every agreement. */
export const AGREEMENT_TEMPLATE_VERSION = "2026-10";

/** Planera's own party block (sole trader). */
export const PLANERA_PARTY = {
  legalName: "Dionysios Stroumpakos",
  tradingAs: "Planera",
  vatNumber: "170540719",
  taxOffice: "ΚΕΦΟΔΕ Αττικής",
  address: "Tsoukala 6, 13122 Ilion, Attica, Greece",
  representative: "Dionysios Stroumpakos",
  representativeTitle: "Founder",
  email: "partners@planeraai.app",
} as const;

export type AgreementTerms = {
  commissionPct: number;
  attributionDays: number;
  replyBusinessDays: number;
  paymentDays: number;
  noticeDays: number;
};

export type PartnerParty = {
  legalName: string;
  vatNumber: string;
  address: string;
  representative: string;
  representativeTitle: string;
  email: string;
};

/** Sensible defaults the admin form starts from. */
export const DEFAULT_TERMS: AgreementTerms = {
  commissionPct: 10,
  attributionDays: 90,
  replyBusinessDays: 2,
  paymentDays: 30,
  noticeDays: 30,
};

/** How long a supplier has to sign an offered agreement. */
export const OFFER_VALID_DAYS = 30;

/** Throws a readable message for any out-of-range term. */
export function validateTerms(t: AgreementTerms): AgreementTerms {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  check(Number.isFinite(t.commissionPct) && t.commissionPct > 0 && t.commissionPct <= 50, "Commission must be between 0 and 50%.");
  check(Number.isInteger(t.attributionDays) && t.attributionDays >= 7 && t.attributionDays <= 365, "Attribution window must be 7 to 365 days.");
  check(Number.isInteger(t.replyBusinessDays) && t.replyBusinessDays >= 1 && t.replyBusinessDays <= 10, "Reply time must be 1 to 10 business days.");
  check(Number.isInteger(t.paymentDays) && t.paymentDays >= 1 && t.paymentDays <= 90, "Payment term must be 1 to 90 days.");
  check(Number.isInteger(t.noticeDays) && t.noticeDays >= 0 && t.noticeDays <= 180, "Notice period must be 0 to 180 days.");
  // Keep at most two decimals so the text and the maths agree.
  return { ...t, commissionPct: Math.round(t.commissionPct * 100) / 100 };
}

export function validateParty(p: PartnerParty): PartnerParty {
  const clean = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();
  const out = {
    legalName: clean(p.legalName),
    vatNumber: clean(p.vatNumber).toUpperCase(),
    address: clean(p.address),
    representative: clean(p.representative),
    representativeTitle: clean(p.representativeTitle),
    email: clean(p.email).toLowerCase(),
  };
  for (const [k, v] of Object.entries(out)) {
    if (!v) throw new Error(`Partner ${k} is required.`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new Error("Partner email is not valid.");
  return out;
}

/** "PLN-AGR-0007" from a running number. */
export function agreementReference(n: number): string {
  return `PLN-AGR-${String(Math.max(1, Math.floor(n))).padStart(4, "0")}`;
}

// No 0/O/1/I/L so a reference read out on the phone cannot be misheard.
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** "PLN-7K3F" from 4 random bytes (or any 4 numbers). */
export function leadReference(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += REF_ALPHABET[(bytes[i] ?? 0) % REF_ALPHABET.length];
  return `PLN-${s}`;
}

// ─────────────────────────────────────────────────────────
// Agreement text
// ─────────────────────────────────────────────────────────

export type AgreementClause = { n: string; label?: string; text: string };
export type AgreementSection = {
  n: number;
  heading: string;
  paragraphs?: string[];
  clauses?: AgreementClause[];
  table?: { label: string; value: string }[];
  parties?: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;

export function agreementTitle(): string {
  return "Tailor-Made Experiences Referral and Commission Agreement";
}

export function buildAgreementSections(terms: AgreementTerms, partner: PartnerParty): AgreementSection[] {
  const days = (n: number) => plural(n, "day", "days");
  return [
    { n: 1, heading: "Parties", parties: true },
    {
      n: 2,
      heading: "Commercial terms at a glance",
      table: [
        { label: "Commission", value: `${pct(terms.commissionPct)} of the Booking Value of each Referred Booking` },
        { label: "Attribution window", value: `${days(terms.attributionDays)} from the Request` },
        { label: "Listing fee", value: "€0 for as long as this Agreement is in force" },
        { label: "Reply to Requests", value: `Within ${plural(terms.replyBusinessDays, "business day", "business days")}` },
        { label: "Commission invoices", value: `Monthly, payable within ${days(terms.paymentDays)}` },
        { label: "Notice to end the Agreement", value: `${days(terms.noticeDays)}, by either party` },
      ],
      paragraphs: ["If this table and the clauses below differ, the clauses prevail."],
    },
    {
      n: 3,
      heading: "Definitions",
      clauses: [
        { n: "3.1", label: "Listing", text: "an experience the Partner publishes in the Planera partner portal and Planera approves." },
        { n: "3.2", label: "Request", text: "a quote request a traveller or a travel agency sends to the Partner through Planera. Each Request carries a unique reference code (for example PLN-7K3F)." },
        { n: "3.3", label: "Referred Booking", text: "a booking the Partner confirms (a) for a traveller or agency that sent a Request, within the attribution window, or (b) through a Planera tracked link to the Partner's website, within the same window." },
        { n: "3.4", label: "Booking Value", text: "the total price the customer pays the Partner for the booked experience, excluding VAT." },
      ],
    },
    {
      n: 4,
      heading: "What Planera does",
      clauses: [
        { n: "4.1", text: "Shows approved Listings to Planera users whose trips or searches include the Listing's destination, in the Planera apps and website, and to travel agencies using Planera for Travel Agencies once that service makes partner experiences available." },
        { n: "4.2", text: "Forwards every Request to the Partner by email and in the partner dashboard, with the reference code and the details the traveller agreed to share." },
        { n: "4.3", text: "Gives the Partner a dashboard showing every Request, its status, and the commission statement for each month." },
        { n: "4.4", text: "Charges no listing fee while this Agreement is in force. Planera decides where and how often Listings appear and does not guarantee any number of Requests or bookings." },
      ],
    },
    {
      n: 5,
      heading: "What the Partner does",
      clauses: [
        { n: "5.1", text: "Keeps Listings accurate, including descriptions, photos, starting prices or \"price on request\", and availability." },
        { n: "5.2", text: "Replies to each Request within the reply time in clause 2." },
        { n: "5.3", text: "Quotes, sells and delivers the experiences in its own name, under its own terms with the customer, and holds every licence, permit and insurance the law requires for them." },
        { n: "5.4", text: "Records the outcome of each Request in the dashboard (quoted, booked or not booked) and, for a booking, its Booking Value, within 7 days of confirming it. Cancellations and refunds are recorded the same way." },
      ],
    },
    {
      n: 6,
      heading: "Payments from customers",
      paragraphs: [
        "Planera never receives, holds or processes payments from travellers or agencies for the Partner's experiences. The Partner collects all payments directly. Planera is not a party to the contract between the Partner and its customer and does not act as a travel agent or tour operator for these bookings.",
      ],
    },
    {
      n: 7,
      heading: "Commission",
      clauses: [
        { n: "7.1", text: "For each Referred Booking, the Partner pays Planera the commission in clause 2, calculated on the Booking Value." },
        { n: "7.2", text: "No commission is due on a booking that is cancelled and fully refunded. If a booking is partly refunded, commission is due on the amount the Partner keeps." },
        { n: "7.3", text: "If a customer books more than once within the attribution window, each booking is a Referred Booking." },
      ],
    },
    {
      n: 8,
      heading: "Statements, invoices and payment",
      clauses: [
        { n: "8.1", text: "On the first business day of each month, Planera publishes a statement in the dashboard listing the previous month's Referred Bookings and the commission due. The Partner may dispute a line within 10 days." },
        { n: "8.2", text: "Planera then issues a service invoice (τιμολόγιο παροχής υπηρεσιών) for the commission plus VAT where it applies, transmitted to myDATA." },
        { n: "8.3", text: "The Partner pays each invoice by bank transfer within the payment term in clause 2." },
        { n: "8.4", text: "Planera may ask, at most once per quarter, for reasonable evidence of the Referred Bookings recorded, such as booking confirmations." },
      ],
    },
    {
      n: 9,
      heading: "Personal data",
      paragraphs: [
        "Each party is an independent controller of the personal data it processes under the GDPR. The Partner uses data received with a Request only to answer that Request and deliver the booked experience, and does not use it for marketing unless the customer gives the Partner separate consent.",
      ],
    },
    {
      n: 10,
      heading: "Content and names",
      paragraphs: [
        "The Partner allows Planera to display its name, logo, Listing text and photos in Planera's apps, website, newsletters and travel agency tools for the purpose of this Agreement, and confirms it holds the rights to that content. Planera may edit Listings for length, format or translation without changing their meaning.",
      ],
    },
    {
      n: 11,
      heading: "Liability",
      paragraphs: [
        "The Partner is solely responsible for its experiences, their safety and any claim from its customers about them. Neither party is liable for indirect or consequential loss. Except for unpaid commission, each party's total liability under this Agreement is limited to the commission paid in the 12 months before the claim.",
      ],
    },
    {
      n: 12,
      heading: "Term and ending the Agreement",
      clauses: [
        { n: "12.1", text: "This Agreement starts when both parties have signed and continues until either party ends it with the notice in clause 2, sent by email." },
        { n: "12.2", text: "When it ends, Listings are removed. Commission remains due on Requests received before the end date that become bookings within the attribution window." },
      ],
    },
    {
      n: 13,
      heading: "Changes",
      paragraphs: [
        "Changes to this Agreement apply only when both parties accept a new version, either by signing it in the partner portal or in writing.",
      ],
    },
    {
      n: 14,
      heading: "Electronic signature",
      paragraphs: [
        "The parties agree that signing this Agreement in the Planera partner portal is an electronic signature under Regulation (EU) No 910/2014 (eIDAS) and binds them as a handwritten signature would. Planera keeps a record of the signer, the time, and a fingerprint of the exact text signed, and sends both parties a copy.",
      ],
    },
    {
      n: 15,
      heading: "Law and courts",
      paragraphs: ["This Agreement is governed by Greek law. The courts of Athens have jurisdiction over any dispute."],
    },
  ];
}

export function planeraPartyLines(): string[] {
  const p = PLANERA_PARTY;
  return [
    `${p.legalName}, trading as ${p.tradingAs}`,
    `ΑΦΜ ${p.vatNumber}, ΔΟΥ ${p.taxOffice}`,
    p.address,
    `Signing as owner and ${p.representativeTitle}`,
    p.email,
  ];
}

export function partnerPartyLines(partner: PartnerParty): string[] {
  return [
    partner.legalName,
    `VAT ${partner.vatNumber}`,
    partner.address,
    `Represented by ${partner.representative}, ${partner.representativeTitle}`,
    partner.email,
  ];
}

/**
 * The one canonical string the signature covers. Whitespace and ordering are
 * fixed here, so the hash a supplier sees in the portal and the hash stored at
 * offer time are always computed from the same bytes.
 */
export function agreementPlainText(opts: {
  reference: string;
  templateVersion: string;
  terms: AgreementTerms;
  partner: PartnerParty;
}): string {
  const sections = buildAgreementSections(opts.terms, opts.partner);
  const out: string[] = [];
  out.push(agreementTitle());
  out.push(`Reference ${opts.reference}, template version ${opts.templateVersion}`);
  out.push("");
  for (const s of sections) {
    out.push(`${s.n}. ${s.heading}`);
    if (s.parties) {
      out.push(`Planera ("Planera"): ${planeraPartyLines().join("; ")}`);
      out.push(`Partner ("the Partner"): ${partnerPartyLines(opts.partner).join("; ")}`);
    }
    for (const row of s.table ?? []) out.push(`${row.label}: ${row.value}`);
    for (const p of s.paragraphs ?? []) out.push(p);
    for (const c of s.clauses ?? []) out.push(`${c.n} ${c.label ? `${c.label}: ` : ""}${c.text}`);
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// ─────────────────────────────────────────────────────────
// Commission maths
// ─────────────────────────────────────────────────────────

/** Commission in minor units on what the partner kept after refunds. */
export function commissionMinor(pctValue: number, bookingValueMinor: number, refundedMinor = 0): number {
  const kept = Math.max(0, Math.round(bookingValueMinor) - Math.max(0, Math.round(refundedMinor)));
  return Math.round((kept * pctValue) / 100);
}

/** A booking counts only if confirmed inside the window that opened with the request. */
export function withinAttribution(requestAt: number, bookedAt: number, attributionDays: number): boolean {
  if (bookedAt < requestAt - 24 * 60 * 60 * 1000) return false; // a day of slack for clock/date-picker drift
  return bookedAt <= requestAt + attributionDays * 24 * 60 * 60 * 1000;
}

/** "2026-11" for a timestamp, in Athens time. */
export function athensMonthKey(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** The month before a "YYYY-MM" key. */
export function previousMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Statement lines for a set of leads booked in `month`. */
export function statementLines(
  leads: {
    _id: string;
    reference: string;
    productTitle: string;
    contactName: string;
    createdAt: number;
    bookedAt?: number;
    status: string;
    bookingValueMinor?: number;
    refundedMinor?: number;
    commissionPct: number;
    attributionDays: number;
  }[],
  month: string
) {
  const lines = [];
  for (const l of leads) {
    if (l.status !== "booked" && l.status !== "cancelled") continue;
    if (!l.bookedAt || athensMonthKey(l.bookedAt) !== month) continue;
    if (!withinAttribution(l.createdAt, l.bookedAt, l.attributionDays)) continue;
    const value = l.bookingValueMinor ?? 0;
    const refunded = l.status === "cancelled" ? value : l.refundedMinor ?? 0;
    lines.push({
      leadId: l._id,
      reference: l.reference,
      productTitle: l.productTitle,
      customer: l.contactName,
      bookedAt: l.bookedAt,
      bookingValueMinor: value,
      refundedMinor: refunded,
      commissionPct: l.commissionPct,
      commissionMinor: commissionMinor(l.commissionPct, value, refunded),
    });
  }
  lines.sort((a, b) => a.bookedAt - b.bookedAt);
  const totalMinor = lines.reduce((s, l) => s + l.commissionMinor, 0);
  return { lines, totalMinor };
}

// ─────────────────────────────────────────────────────────
// Destination matching (trip ↔ listing)
// ─────────────────────────────────────────────────────────

/** Lower-case, strip accents (incl. Greek tonos), collapse punctuation. */
export function normalizePlace(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Names travellers and suppliers use for the same place. The first entry is
 * the canonical key. Villages map to their island, so an Oia tour shows on a
 * "Santorini" trip and the other way round.
 */
const PLACE_ALIASES: string[][] = [
  ["santorini", "σαντορινη", "thira", "thera", "θηρα", "fira", "φηρα", "oia", "οια", "imerovigli", "ημεροβιγλι", "kamari", "καμαρι", "perissa", "περισσα", "pyrgos", "πυργοσ", "akrotiri", "ακρωτηρι", "firostefani", "φηροστεφανι", "jtr"],
  ["mykonos", "μυκονοσ", "jmk"],
  ["crete", "κρητη", "heraklion", "ηρακλειο", "chania", "χανια", "rethymno", "ρεθυμνο", "her", "chq"],
  ["rhodes", "ροδοσ", "rodos", "lindos", "λινδοσ", "rho"],
  ["corfu", "κερκυρα", "kerkyra", "cfu"],
  ["naxos", "ναξοσ", "jnx"],
  ["paros", "παροσ", "pas"],
  ["milos", "μηλοσ", "mlo"],
  ["athens", "αθηνα", "athina", "ath"],
  ["thessaloniki", "θεσσαλονικη", "salonica", "skg"],
  ["zakynthos", "ζακυνθοσ", "zante", "zth"],
  ["kefalonia", "κεφαλονια", "cephalonia", "efl"],
  ["kos", "κωσ", "kgs"],
];

const ALIAS_TO_KEY = new Map<string, string>();
for (const group of PLACE_ALIASES) for (const name of group) ALIAS_TO_KEY.set(normalizePlace(name), group[0]);

/** Canonical place keys found in a free-text destination ("Oia, Santorini, Greece"). */
export function placeKeys(s: string | undefined | null): Set<string> {
  const norm = normalizePlace(s);
  const keys = new Set<string>();
  if (!norm) return keys;
  const words = norm.split(" ");
  // Single words and adjacent pairs ("agios nikolaos") so multi-word names match.
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  for (const g of grams) {
    const k = ALIAS_TO_KEY.get(g);
    if (k) keys.add(k);
  }
  return keys;
}

const COUNTRY_WORDS = new Set(["greece", "ελλαδα", "hellas", "gr", "italy", "spain", "france", "albania"]);

/**
 * Does a listing (city / destination text) belong on a trip to `tripDestination`?
 * Known places compare by canonical key. Otherwise the listing's city name must
 * appear as a whole word in the trip's destination. A country alone never
 * matches, so a Greek tour does not show on every Greek trip.
 */
export function listingMatchesDestination(
  tripDestination: string | undefined | null,
  listing: { city?: string | null; destination?: string | null }
): boolean {
  const tripKeys = placeKeys(tripDestination);
  const listingText = [listing.city, listing.destination].filter(Boolean).join(", ");
  const listingKeys = placeKeys(listingText);
  if (listingKeys.size > 0) {
    for (const k of listingKeys) if (tripKeys.has(k)) return true;
    return false;
  }
  const trip = ` ${normalizePlace(tripDestination)} `;
  const candidates = [listing.city, listing.destination]
    .map((s) => normalizePlace(s?.split(",")[0]))
    .filter((s) => s && s.length >= 3 && !COUNTRY_WORDS.has(s));
  return candidates.some((c) => trip.includes(` ${c} `));
}

/** Tag an outbound supplier link so their analytics can see Planera sent it. */
export function withReferral(url: string | undefined, reference?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "planera");
    u.searchParams.set("utm_medium", "referral");
    u.searchParams.set("ref", reference ?? "planera");
    return u.toString();
  } catch {
    return url;
  }
}
