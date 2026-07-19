/**
 * Emails for per-route fare watches (see `routePriceAlerts.ts`).
 *
 * Kept separate from the watch logic for the same reason `postmark.ts` is kept
 * apart from `newsletter.ts`: copy and markup churn far more often than the
 * scheduling rules, and mixing them makes both harder to review.
 *
 * Every send is transactional and carries a one-click unsubscribe for that
 * single watch — unsubscribing from one route must never silently kill the
 * others or the newsletter.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

type AlertLang = "en" | "el" | "es" | "fr" | "de" | "ar";
const LANGS: AlertLang[] = ["en", "el", "es", "fr", "de", "ar"];

function pickLang(raw?: string): AlertLang {
  const l = (raw || "en").slice(0, 2).toLowerCase() as AlertLang;
  return LANGS.includes(l) ? l : "en";
}

const COPY: Record<AlertLang, Record<string, string>> = {
  en: {
    confirmSubject: "Confirm your fare alert for {route}",
    confirmHeading: "One tap to start watching this fare",
    confirmBody:
      "We will check {route} twice a day and email you if the price drops below {price}.",
    confirmCta: "Confirm my fare alert",
    dropSubject: "Fare drop: {route} is now {price}",
    dropHeading: "The price just dropped",
    dropBody: "{route} has fallen from {was} to {price}.",
    dropCta: "See these flights",
    dates: "Dates",
    anyDates: "Flexible dates",
    unsub: "Stop watching this route",
    disclaimer:
      "Fares change constantly and are confirmed by the airline at booking.",
  },
  el: {
    confirmSubject: "Επιβεβαίωσε την ειδοποίηση τιμής για {route}",
    confirmHeading: "Ένα πάτημα για να ξεκινήσει η παρακολούθηση",
    confirmBody:
      "Θα ελέγχουμε τη διαδρομή {route} δύο φορές την ημέρα και θα σου στείλουμε email αν η τιμή πέσει κάτω από {price}.",
    confirmCta: "Επιβεβαίωση ειδοποίησης",
    dropSubject: "Πτώση τιμής: {route} τώρα {price}",
    dropHeading: "Η τιμή μόλις έπεσε",
    dropBody: "Η διαδρομή {route} έπεσε από {was} σε {price}.",
    dropCta: "Δες αυτές τις πτήσεις",
    dates: "Ημερομηνίες",
    anyDates: "Ευέλικτες ημερομηνίες",
    unsub: "Διακοπή παρακολούθησης",
    disclaimer:
      "Οι τιμές αλλάζουν συνεχώς και επιβεβαιώνονται από την αεροπορική κατά την κράτηση.",
  },
  es: {
    confirmSubject: "Confirma tu alerta de precio para {route}",
    confirmHeading: "Un toque para empezar a vigilar esta tarifa",
    confirmBody:
      "Revisaremos {route} dos veces al día y te avisaremos si baja de {price}.",
    confirmCta: "Confirmar mi alerta",
    dropSubject: "Bajada de precio: {route} ahora {price}",
    dropHeading: "El precio acaba de bajar",
    dropBody: "{route} ha bajado de {was} a {price}.",
    dropCta: "Ver estos vuelos",
    dates: "Fechas",
    anyDates: "Fechas flexibles",
    unsub: "Dejar de vigilar esta ruta",
    disclaimer:
      "Las tarifas cambian constantemente y la aerolínea las confirma al reservar.",
  },
  fr: {
    confirmSubject: "Confirmez votre alerte prix pour {route}",
    confirmHeading: "Un clic pour suivre ce tarif",
    confirmBody:
      "Nous vérifierons {route} deux fois par jour et vous préviendrons si le prix passe sous {price}.",
    confirmCta: "Confirmer mon alerte",
    dropSubject: "Baisse de prix : {route} à {price}",
    dropHeading: "Le prix vient de baisser",
    dropBody: "{route} est passé de {was} à {price}.",
    dropCta: "Voir ces vols",
    dates: "Dates",
    anyDates: "Dates flexibles",
    unsub: "Ne plus suivre cet itinéraire",
    disclaimer:
      "Les tarifs changent constamment et sont confirmés par la compagnie à la réservation.",
  },
  de: {
    confirmSubject: "Bestätige deinen Preisalarm für {route}",
    confirmHeading: "Ein Klick, um diesen Preis zu beobachten",
    confirmBody:
      "Wir prüfen {route} zweimal täglich und melden uns, wenn der Preis unter {price} fällt.",
    confirmCta: "Preisalarm bestätigen",
    dropSubject: "Preis gefallen: {route} jetzt {price}",
    dropHeading: "Der Preis ist gerade gefallen",
    dropBody: "{route} ist von {was} auf {price} gefallen.",
    dropCta: "Diese Flüge ansehen",
    dates: "Daten",
    anyDates: "Flexible Daten",
    unsub: "Diese Strecke nicht mehr beobachten",
    disclaimer:
      "Preise ändern sich laufend und werden bei der Buchung von der Airline bestätigt.",
  },
  ar: {
    confirmSubject: "أكّد تنبيه السعر لمسار {route}",
    confirmHeading: "نقرة واحدة لبدء متابعة هذا السعر",
    confirmBody:
      "سنتحقق من {route} مرتين يوميًا ونراسلك إذا انخفض السعر عن {price}.",
    confirmCta: "تأكيد التنبيه",
    dropSubject: "انخفاض السعر: {route} الآن {price}",
    dropHeading: "انخفض السعر للتو",
    dropBody: "انخفض مسار {route} من {was} إلى {price}.",
    dropCta: "اعرض هذه الرحلات",
    dates: "التواريخ",
    anyDates: "تواريخ مرنة",
    unsub: "إيقاف متابعة هذا المسار",
    disclaimer: "تتغير الأسعار باستمرار وتؤكدها شركة الطيران عند الحجز.",
  },
};

const SITE = "https://www.planeraai.app";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
}

function money(n: number, currency: string): string {
  return Math.round(n) + " " + currency;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(o: {
  dir: string;
  heading: string;
  body: string;
  meta: string;
  ctaHref: string;
  ctaLabel: string;
  unsubHref: string;
  unsubLabel: string;
  disclaimer: string;
}): string {
  const font =
    "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  return [
    '<!doctype html><html dir="' + o.dir + '"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:' + font + ';color:#0d0d0d">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">',
    '<div style="font-size:20px;font-weight:700;margin-bottom:10px">' + esc(o.heading) + "</div>",
    '<div style="font-size:15px;line-height:1.5;color:#41413e">' + esc(o.body) + "</div>",
    '<div style="font-size:13px;color:#6e6e6a;margin-top:10px">' + esc(o.meta) + "</div>",
    '<div style="margin:22px 0 6px"><a href="' + esc(o.ctaHref) + '" style="display:inline-block;background:#FFE500;color:#0d0d0d;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">' + esc(o.ctaLabel) + "</a></div>",
    '<div style="font-size:12px;color:#8a8a85;margin-top:20px;line-height:1.5">' + esc(o.disclaimer) + "</div>",
    '<div style="font-size:12px;margin-top:14px"><a href="' + esc(o.unsubHref) + '" style="color:#8a8a85">' + esc(o.unsubLabel) + "</a></div>",
    "</div></body></html>",
  ].join("");
}

function datesLine(
  L: Record<string, string>,
  outboundDate?: string,
  returnDate?: string
): string {
  if (!outboundDate) return L.anyDates;
  return L.dates + ": " + outboundDate + (returnDate ? " → " + returnDate : "");
}

/** Deep link back into the public search, carrying the watched route. */
function searchLink(row: any, campaign: string): string {
  const p = new URLSearchParams();
  p.set("departureId", row.departureId);
  p.set("arrivalId", row.arrivalId);
  if (row.outboundDate) p.set("outboundDate", row.outboundDate);
  if (row.returnDate) p.set("returnDate", row.returnDate);
  if (row.adults && row.adults > 1) p.set("adults", String(row.adults));
  p.set("utm_source", "price_alert");
  p.set("utm_medium", "email");
  p.set("utm_campaign", campaign);
  return SITE + "/search?" + p.toString();
}

export const sendConfirmEmail = internalAction({
  args: { confirmToken: v.string() },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(
      internal.routePriceAlerts.getAlertInternal,
      { confirmToken: args.confirmToken }
    );
    if (!row || row.status !== "pending") return;

    const lang = pickLang(row.language);
    const L = COPY[lang];
    const vars = {
      route: row.departureId + " → " + row.arrivalId,
      price: money(row.targetPrice ?? row.baselinePrice, row.currency),
    };

    await ctx.runAction(internal.postmark.sendRawEmail, {
      to: row.email,
      subject: fill(L.confirmSubject, vars),
      html: emailShell({
        dir: lang === "ar" ? "rtl" : "ltr",
        heading: L.confirmHeading,
        body: fill(L.confirmBody, vars),
        meta: datesLine(L, row.outboundDate, row.returnDate),
        ctaHref: SITE + "/alerts/confirm?token=" + row.confirmToken,
        ctaLabel: L.confirmCta,
        unsubHref: SITE + "/alerts/unsubscribe?token=" + row.unsubscribeToken,
        unsubLabel: L.unsub,
        disclaimer: L.disclaimer,
      }),
      text:
        L.confirmHeading +
        "\n\n" +
        fill(L.confirmBody, vars) +
        "\n\n" +
        SITE +
        "/alerts/confirm?token=" +
        row.confirmToken,
    });
  },
});

export const sendDropEmail = internalAction({
  args: {
    id: v.id("routePriceAlerts"),
    price: v.float64(),
    was: v.float64(),
  },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(
      internal.routePriceAlerts.getAlertInternal,
      { id: args.id }
    );
    if (!row || row.status !== "active") return;

    const lang = pickLang(row.language);
    const L = COPY[lang];
    const vars = {
      route: row.departureId + " → " + row.arrivalId,
      price: money(args.price, row.currency),
      was: money(args.was, row.currency),
    };

    await ctx.runAction(internal.postmark.sendRawEmail, {
      to: row.email,
      subject: fill(L.dropSubject, vars),
      html: emailShell({
        dir: lang === "ar" ? "rtl" : "ltr",
        heading: L.dropHeading,
        body: fill(L.dropBody, vars),
        meta: datesLine(L, row.outboundDate, row.returnDate),
        ctaHref: searchLink(row, "fare_drop"),
        ctaLabel: L.dropCta,
        unsubHref: SITE + "/alerts/unsubscribe?token=" + row.unsubscribeToken,
        unsubLabel: L.unsub,
        disclaimer: L.disclaimer,
      }),
      text:
        L.dropHeading +
        "\n\n" +
        fill(L.dropBody, vars) +
        "\n\n" +
        searchLink(row, "fare_drop"),
    });
  },
});
