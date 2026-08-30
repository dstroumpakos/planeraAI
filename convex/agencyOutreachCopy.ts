/**
 * Copy and rendering for the agency outreach emails (see `agencyOutreach.ts`).
 *
 * Pure module — no Convex imports — so the exact bytes that go to Postmark can
 * also be rendered by `scripts/agency-outreach/preview.mjs` without a
 * deployment. A preview that re-implements the copy is worth nothing; this one
 * is the same function the sender calls.
 *
 * Written as a short business letter. No superlatives, no urgency, no "FREE",
 * no exclamation marks — every one of those is a scored token in a spam
 * filter, and none of them help a travel agency decide whether to take a call.
 */

export const BASE_URL = "https://planeraai.app";

/**
 * Planera palette, matching the newsletter shell (convex/newsletter.ts).
 * Applied sparingly on purpose: one logo, one yellow button, cream page. A cold
 * email that arrives dressed as a newsletter gets read as bulk by both filters
 * and people, so the branding stops well short of a marketing template.
 */
const BRAND = {
  paper: "#FAF9F6",
  card: "#FFFFFF",
  ink: "#1A1A1A",
  body: "#4A4A4A",
  muted: "#9A9A9A",
  rule: "#F0EEE9",
  accent: "#FFE500",
};
const LOGO_URL = `${BASE_URL}/logo.png`;
export const AGENCY_SIGNUP_URL = `${BASE_URL}/agency/signup`;
/**
 * Single CTA for every model. `/partners/apply` records which type the business
 * ticked and routes it internally, so one link can carry five offers — and it is
 * live today, unlike `/agency/signup`, whose backend is written but not yet
 * deployed (see convex/agency/README.md).
 */
export const PARTNERS_APPLY_URL = `${BASE_URL}/partners/apply`;

/** A human name to sign off with. Unset means the copy stays impersonal rather
 *  than introducing "Planera from Planera". */
const SIGNATURE_NAME = process.env.AGENCY_OUTREACH_SIGNATURE || "";
const SIGNATURE_ROLE_EL = "Planera — Συνεργασίες";
const SIGNATURE_ROLE_EN = "Planera — Partnerships";

export type Lang = "el" | "en";

export interface LeadCopyInput {
  agencyName: string;
  city?: string;
  services?: string;
  lang: Lang;
  stage: 1 | 2;
  optOutUrl: string;
  deckUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Trim a directory services blob down to something quotable in a sentence. */
export function shortenServices(raw: string | undefined, max = 90): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned.toLowerCase();
  return `${cleaned.slice(0, max).replace(/[\s,·|-]+$/, "")}…`.toLowerCase();
}

/**
 * The source directory mixes Greek and English service blurbs in one column.
 * Quoting an English phrase back inside a Greek sentence reads like a mail
 * merge that misfired, which is precisely the impression the personalization
 * exists to avoid — so the clause is only used when the scripts agree.
 */
function matchesLanguage(text: string, lang: Lang): boolean {
  const hasGreek = /[\u0370-\u03ff\u1f00-\u1fff]/.test(text);
  return lang === "el" ? hasGreek : !hasGreek;
}

function openingLine(lang: Lang, input: LeadCopyInput): string {
  // Parenthetical rather than a preposition: Greek city names decline, and
  // "στην Ηράκλειο" from a template is worse than no city at all.
  const where = input.city ? ` (${input.city})` : "";
  const svcRaw = shortenServices(input.services);
  const svc = svcRaw && matchesLanguage(svcRaw, lang) ? svcRaw : "";
  if (lang === "el") {
    return svc
      ? `Είδα το προφίλ του ${input.agencyName}${where} και ότι καλύπτετε ${svc}.`
      : `Είδα το προφίλ του ${input.agencyName}${where}.`;
  }
  return svc
    ? `I came across ${input.agencyName}${where} and saw that you handle ${svc}.`
    : `I came across ${input.agencyName}${where}.`;
}

/**
 * Every way a travel business can work with Planera today. The first email is a
 * menu rather than a single pitch: a 547-strong directory list contains
 * one-person ticketing offices and tour operators with their own dev team, and
 * guessing which pitch fits is how a relevant offer gets deleted as irrelevant.
 *
 * Kept to one line each. The point is recognition ("that one is us"), not
 * explanation — the detail belongs on the call.
 */
const COLLAB_OPTIONS: Record<Lang, Array<{ title: string; body: string }>> = {
  el: [
    {
      title: "Εργαλείο προσφορών για το γραφείο σας (σε πρώτη φάση)",
      body: "δίνετε προορισμό, ημερομηνίες και προϋπολογισμό και παίρνετε τρεις έτοιμες προτάσεις πακέτου με δικό σας markup και προσφορά έτοιμη για τον πελάτη. Ανοίγει πρώτα σε λίγα γραφεία.",
    },
    {
      title: "Προβολή των πακέτων σας μέσα στην εφαρμογή",
      body: "τα πακέτα σας εμφανίζονται στα ταξίδια που ταιριάζουν σε προορισμό και διάρκεια, και τα στοιχεία του ενδιαφερόμενου έρχονται σε εσάς με email.",
    },
    {
      title: "Κατάλογος εκδρομών, ξενοδοχείων και εμπειριών",
      body: "δικός σας πίνακας ελέγχου για να καταχωρείτε και να ενημερώνετε προϊόντα που βλέπουν οι ταξιδιώτες.",
    },
    {
      title: "API για το δικό σας site ή εφαρμογή",
      body: "τα δρομολόγια της Planera μέσα στη δική σας σελίδα, με δικό σας κλειδί και όρια χρήσης.",
    },
    {
      title: "Προβολή σε newsletter και προσφορές πτήσεων",
      body: "χορηγούμενη παρουσία σε προορισμό ή διαδρομή που σας ενδιαφέρει.",
    },
  ],
  en: [
    {
      title: "A quoting tool for your agency (early access)",
      body: "enter a destination, dates and budget and get three ready package options with your own markup and a quote you can send to the client. Opening to a small number of agencies first.",
    },
    {
      title: "Your packages shown inside the app",
      body: "they appear on trips that match the destination and duration, and the enquiry lands in your inbox with the traveller's details.",
    },
    {
      title: "A catalogue of tours, hotels and experiences",
      body: "your own dashboard to list and update the products travellers see.",
    },
    {
      title: "An API for your own site or app",
      body: "Planera itineraries inside your pages, with your own key and usage limits.",
    },
    {
      title: "Placement in our newsletter and flight deals",
      body: "sponsored presence on a destination or route that matters to you.",
    },
  ],
};

function buildCopy(input: LeadCopyInput): {
  subject: string;
  preheader: string;
  paragraphs: string[];
  closing?: string;
  options: Array<{ title: string; body: string }>;
  optionsHeading: string;
  ctaText: string;
  ctaUrl: string;
  deckLine?: string;
  signOff: string;
  optOutLine: string;
} {
  const el = input.lang === "el";
  const first = input.stage === 1;

  const subject = el
    ? first
      ? `Συνεργασία Planera — ${input.agencyName}`
      : `Re: Συνεργασία Planera — ${input.agencyName}`
    : first
      ? `Planera partnership — ${input.agencyName}`
      : `Re: Planera partnership — ${input.agencyName}`;

  const preheader = el
    ? "Πέντε τρόποι συνεργασίας για ταξιδιωτικά γραφεία."
    : "Five ways a travel business can work with Planera.";

  const paragraphs = el
    ? first
      ? [
          openingLine("el", input),
          `${SIGNATURE_NAME ? `Ονομάζομαι ${SIGNATURE_NAME} και γράφω` : "Σας γράφω"} από την Planera, ελληνική πλατφόρμα ταξιδιωτικού σχεδιασμού με AI. Ανοίγουμε τώρα συνεργασίες με ταξιδιωτικά γραφεία και σας γράφω γιατί ψάχνουμε τα πρώτα γραφεία που θα δοκιμάσουν μαζί μας. Οι τρόποι είναι παραπάνω από ένας, γιατί κάθε γραφείο δουλεύει διαφορετικά.`,
        ]
      : [
          `Επανέρχομαι σύντομα στο προηγούμενο μήνυμά μου σχετικά με τους τρόπους συνεργασίας με την Planera.`,
          `Επισυνάπτω την παρουσίαση με όλες τις οπτικές και τα βήματα συνεργασίας, σε περίπτωση που είναι πιο εύκολο να τη δείτε offline.`,
          `Αν δεν είναι η κατάλληλη στιγμή, δεν υπάρχει πρόβλημα — πείτε μου και δεν θα ξαναενοχλήσω.`,
        ]
    : first
      ? [
          openingLine("en", input),
          `${SIGNATURE_NAME ? `My name is ${SIGNATURE_NAME} and I am writing` : "I am writing"} from Planera, a Greek AI travel-planning platform. We are opening partnerships with travel agencies and I am writing because we are looking for the first agencies to try this with us. There is more than one way in, because no two agencies are set up the same.`,
        ]
      : [
          `A short follow-up to my previous note about the ways to work with Planera.`,
          `I have attached the deck covering every option and how a partnership works, in case it is easier to read offline.`,
          `If the timing is wrong, that is completely fine — just say so and I will not follow up again.`,
        ];

  const closing = el
    ? "Αν κάποιος από αυτούς τους τρόπους σας αφορά, πείτε μου ποιος και συνεχίζουμε αποκλειστικά για αυτόν. Μια σύντομη κλήση 15 λεπτών αρκεί, ή απλώς απαντήστε σε αυτό το email."
    : "If any of these is relevant, tell me which one and we will talk about that one only. A short 15-minute call is enough, or just reply to this email.";

  return {
    subject,
    preheader,
    paragraphs,
    closing: first ? closing : undefined,
    options: first ? COLLAB_OPTIONS[input.lang] : [],
    optionsHeading: el ? "Οι τρόποι συνεργασίας" : "Ways to work together",
    ctaText: el ? "Δείτε τις συνεργασίες Planera" : "See Planera partnerships",
    ctaUrl: PARTNERS_APPLY_URL,
    deckLine:
      input.deckUrl && input.stage === 1
        ? el
          ? `Παρουσίαση (PowerPoint): <a href="${esc(input.deckUrl)}">κατεβάστε την εδώ</a>.`
          : `Deck (PowerPoint): <a href="${esc(input.deckUrl)}">download it here</a>.`
        : undefined,
    signOff: el
      ? `${SIGNATURE_NAME || "Planera"}<br/>${SIGNATURE_ROLE_EL}<br/><a href="${BASE_URL}">planeraai.app</a>`
      : `${SIGNATURE_NAME || "Planera"}<br/>${SIGNATURE_ROLE_EN}<br/><a href="${BASE_URL}">planeraai.app</a>`,
    optOutLine: el
      ? `Λάβατε αυτό το email στη δημόσια επαγγελματική σας διεύθυνση ως πρόταση συνεργασίας B2B. Αν δεν θέλετε άλλη επικοινωνία, <a href="${esc(input.optOutUrl)}">πατήστε εδώ</a> και η διεύθυνσή σας διαγράφεται αμέσως.`
      : `You received this at a publicly listed business address as a B2B partnership enquiry. If you would rather not hear from us, <a href="${esc(input.optOutUrl)}">click here</a> and your address is removed immediately.`,
  };
}

/**
 * Deliberately plain HTML: one column, system font, no images, no background
 * colours, no buttons wider than a sentence. It should look like mail a person
 * sent from Outlook, because that is what it is — and because a newsletter
 * chrome around a cold pitch reads as bulk to both filters and humans.
 */
export function renderOutreachEmail(input: LeadCopyInput): RenderedEmail {
  const c = buildCopy(input);
  const body = c.paragraphs
    .map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`)
    .join("");

  const deckRow = c.deckLine ? `<p style="margin:0 0 14px;">${c.deckLine}</p>` : "";

  // Numbered list, not a table or cards: it has to survive Outlook and stay
  // readable when a client strips the CSS.
  const optionsRow = c.options.length
    ? `<p style="margin:0 0 8px;font-weight:600;">${esc(c.optionsHeading)}</p>
  <ol style="margin:0 0 18px;padding-left:20px;">
${c.options
  .map(
    (o) =>
      `    <li style="margin:0 0 8px;"><strong>${esc(o.title)}</strong> — ${esc(o.body)}</li>`
  )
  .join("\n")}
  </ol>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;font-size:1px;color:${BRAND.paper};line-height:1px;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper};">
  <tr><td align="center" style="padding:28px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${BRAND.card};border-radius:16px;border:1px solid ${BRAND.rule};">
      <tr><td style="padding:28px 36px 0;">
        <a href="${BASE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" alt="Planera" width="120" style="display:block;width:120px;max-width:120px;height:auto;border:0;outline:none;" /></a>
      </td></tr>
      <tr><td style="padding:22px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.ink};">
        <p style="margin:0 0 14px;">${input.lang === "el" ? "Γεια σας," : "Hello,"}</p>
        ${body}
        ${optionsRow}
        ${c.closing ? `<p style="margin:0 0 18px;">${esc(c.closing)}</p>` : ""}
        ${deckRow}
      </td></tr>
      <tr><td style="padding:6px 36px 26px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${BRAND.accent};">
          <a href="${esc(c.ctaUrl)}" style="display:inline-block;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${BRAND.ink};text-decoration:none;border-radius:10px;">${esc(c.ctaText)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 36px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.ink};">
        <p style="margin:0;">${c.signOff}</p>
      </td></tr>
      <tr><td style="padding:16px 36px 26px;border-top:1px solid ${BRAND.rule};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};">${c.optOutLine}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // A real, readable text/plain part. Missing or token text parts are scored
  // against the message by every mainstream filter.
  const deckLines =
    input.deckUrl && input.stage === 1
      ? [`${input.lang === "el" ? "Παρουσίαση" : "Deck"}: ${input.deckUrl}`, ""]
      : [];
  const optionLines = c.options.length
    ? [`${c.optionsHeading}:`, "", ...c.options.map((o, i) => `${i + 1}. ${o.title} — ${o.body}`), ""]
    : [];
  const text = [
    input.lang === "el" ? "Γεια σας," : "Hello,",
    "",
    ...c.paragraphs.flatMap((p) => [p, ""]),
    ...optionLines,
    ...(c.closing ? [c.closing, ""] : []),
    ...deckLines,
    `${c.ctaText}: ${c.ctaUrl}`,
    "",
    SIGNATURE_NAME || "Planera",
    input.lang === "el" ? SIGNATURE_ROLE_EL : SIGNATURE_ROLE_EN,
    BASE_URL,
    "",
    "---",
    input.lang === "el"
      ? `Για διαγραφή από τη λίστα: ${input.optOutUrl}`
      : `To opt out: ${input.optOutUrl}`,
  ].join("\n");

  return { subject: c.subject, html, text };
}
