/**
 * HTML shells for commission-partner emails (agreements, quote requests,
 * statements). Same dark card + yellow rule as the partner review emails in
 * partnerAdminApp.ts, so every partner mail reads as one family.
 */

export const PORTAL_BASE_URL = "https://planeraai.app";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Operator inbox for partner events. */
export function partnerOpsInbox(): string {
  return (
    process.env.PARTNER_BILLING_ALERT_TO ||
    process.env.STATS_REPORT_TO ||
    "dstroumpakos@planeraai.app"
  );
}

export function euro(minor: number, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function athensDate(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    timeZone: "Europe/Athens",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Rows of label/value pairs, already escaped by the caller where needed. */
export function rowsHtml(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 8px;">${rows
    .map(
      ([k, val]) =>
        `<tr><td style="padding:8px 0;color:#9a9aa6;width:40%;vertical-align:top;">${esc(k)}</td><td style="padding:8px 0;color:#f2f2f5;vertical-align:top;">${val}</td></tr>`
    )
    .join("")}</table>`;
}

export function partnerEmailHtml(opts: {
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const cta = opts.cta
    ? `<div style="text-align:center;margin:28px 0 0;"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#FFE500;color:#111;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;">${esc(opts.cta.label)}</a></div>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${PORTAL_BASE_URL}/logo.png" alt="Planera AI" width="150" style="display:inline-block;width:150px;height:auto;border:0;" />
    </div>
    <div style="background:#16161c;border:1px solid #26262e;border-radius:16px;border-top:4px solid #FFE500;padding:32px;">
      <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#FFE500;font-weight:700;margin-bottom:8px;">${esc(opts.eyebrow)}</div>
      <h1 style="margin:0 0 16px;color:#fff;font-size:22px;line-height:1.25;">${esc(opts.heading)}</h1>
      <div style="color:#c4c4cf;font-size:15px;line-height:1.6;">${opts.bodyHtml}</div>
      ${cta}
    </div>
    <p style="text-align:center;color:#6c6c78;font-size:12px;margin:20px 0 0;">${esc(opts.footer ?? "Planera AI · planeraai.app")}</p>
  </div></body></html>`;
}

/** A frozen agreement text as readable HTML (keeps every line break). */
export function agreementTextHtml(text: string): string {
  return `<div style="margin-top:18px;padding:18px;background:#faf7f0;color:#1b1c20;border-radius:12px;font-family:Georgia,'Times New Roman',serif;font-size:13.5px;line-height:1.55;white-space:pre-wrap;">${esc(text)}</div>`;
}
