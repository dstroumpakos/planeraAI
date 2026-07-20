// Single source of truth for outbound affiliate / booking links.
//
// COMMISSION RULE: every CJ partner is monetised on the CLICK through
// `https://www.{cjDomain}/click-101641262-{LINKID}`. The publisher id
// (101641262) is embedded in the redirect, so the click is always tracked.
// Deep-linkable CJ link types (Evergreen) additionally accept a `url=`
// param that forwards to a destination/date-prefilled search page.
//
// Strategy (per product decision): use the CJ tracking URL FIRST when we
// have a link id for that partner; otherwise fall back to the plain
// provider URL (un-commissioned but still useful to the traveller).

export const CJ_PUBLISHER_ID = "101641262";

// CJ redirect mirrors — all interchangeable. We use one stable host.
const CJ_HOST = "https://www.anrdoezrs.net";

/**
 * Build a commission-safe CJ tracking URL.
 * @param linkId   The CJ link id for the advertiser/creative.
 * @param deepTarget Optional fully-qualified destination URL. Only appended
 *                   for Evergreen / deep-linkable link types.
 */
export function buildClickUrl(linkId: string, deepTarget?: string): string {
  const base = `${CJ_HOST}/click-${CJ_PUBLISHER_ID}-${linkId}`;
  if (deepTarget) {
    return `${base}?url=${encodeURIComponent(deepTarget)}`;
  }
  return base;
}

// ── CJ link ids ───────────────────────────────────────────────────────────
// Deep-linkable (Evergreen) — accept a `url=` target.
const TRIPCOM_EVERGREEN = "15735051";
const IBERIA_EVERGREEN = "15736023";
const VOLOTEA_EVERGREEN = "15735255";
const AIRSERBIA_EVERGREEN = "15735227";
const LOT_EVERGREEN = "16998075";

// Non-deep-link homepage/landing links, keyed by language (fallback: en).
const KIWI_BY_LANG: Record<string, string> = {
  en: "13856226",
  de: "16967825",
};
// Volotea localized homepage CJ links (EU low-cost carrier).
const VOLOTEA_BY_LANG: Record<string, string> = {
  en: "13995505",
  el: "14464215",
  es: "13980924",
  fr: "14446290",
  de: "13980926",
};
const ESKY_BY_LANG: Record<string, string> = {
  en: "15347259",
  el: "16990541",
  es: "15544598",
  de: "17095575",
};
const TRIPCOM_HOTELS_BY_LANG: Record<string, string> = {
  de: "17000323",
};
// Air Serbia localized "book now" text links (homepage landings).
const AIRSERBIA_BY_LANG: Record<string, string> = {
  en: "13957405",
  el: "13971287",
  es: "13971292",
  fr: "13957403",
  de: "13957404",
};
// LOT country-homepage links (LOT localizes by market, not language).
const LOT_BY_LANG: Record<string, string> = {
  en: "16943085",
  el: "17250142",
  es: "17249841",
  fr: "17249821",
  de: "16943099",
};

function pickByLang(map: Record<string, string>, lang: string): string {
  return map[lang] || map.en || Object.values(map)[0];
}

// ── Locale → provider domains (for direct, non-CJ fallbacks) ───────────────
const SKYSCANNER_DOMAIN: Record<string, string> = {
  en: "www.skyscanner.com",
  el: "gr.skyscanner.com",
  es: "www.skyscanner.es",
  fr: "www.skyscanner.fr",
  de: "www.skyscanner.de",
  ar: "www.skyscanner.ae",
};
const AIRBNB_DOMAIN: Record<string, string> = {
  en: "www.airbnb.com",
  el: "www.airbnb.gr",
  es: "www.airbnb.es",
  fr: "www.airbnb.fr",
  de: "www.airbnb.de",
  ar: "www.airbnb.com",
};

function skyDomain(lang: string) {
  return SKYSCANNER_DOMAIN[lang] || SKYSCANNER_DOMAIN.en;
}
function airbnbDomain(lang: string) {
  return AIRBNB_DOMAIN[lang] || AIRBNB_DOMAIN.en;
}

// ── Param shapes ───────────────────────────────────────────────────────────
export interface FlightLinkParams {
  origin?: string; // raw origin label (for non-coded providers)
  destination?: string;
  originCode: string; // resolved IATA code (already lowercased where needed)
  destCode: string;
  outboundDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  travelers: number;
  lang: string;
}

export interface HotelLinkParams {
  destination: string;
  destEntityId?: string | null; // Skyscanner entity id when known
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  travelers: number;
  nights?: number;
  lang: string;
}

// ── Flight link builders ───────────────────────────────────────────────────

// Trip.com keeps its existing Allianceid commission (already live, non-CJ).
function tripComFlightTarget(p: FlightLinkParams): string {
  const dep = p.originCode.toLowerCase();
  const arr = p.destCode.toLowerCase();
  return (
    `https://www.trip.com/flights/showfarefirst?dcity=${dep}&acity=${arr}` +
    `&ddate=${p.outboundDate}&rdate=${p.returnDate}&aairport=${arr}` +
    `&triptype=rt&class=y&lowpricesource=searchform&quantity=${p.travelers}` +
    `&searchboxarg=t&nonstoponly=off&locale=${p.lang}-XX&curr=EUR` +
    `&Allianceid=7913522&SID=297487884&trip_sub1=`
  );
}

function skyscannerFlightTarget(p: FlightLinkParams): string {
  const fmt = (d: string) => d.replace(/-/g, "").slice(2); // YYYY-MM-DD -> YYMMDD
  const dep = p.originCode.toLowerCase();
  const arr = p.destCode.toLowerCase();
  return (
    `https://${skyDomain(p.lang)}/transport/flights/${dep}/${arr}/` +
    `${fmt(p.outboundDate)}/${fmt(p.returnDate)}/` +
    `?adultsv2=${p.travelers}&cabinclass=economy&childrenv2=&ref=home&rtn=1` +
    `&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false`
  );
}

function kiwiHomeTarget(): string {
  return "https://www.kiwi.com/";
}

function eskyHomeTarget(lang: string): string {
  const tld =
    lang === "el" ? "gr" : lang === "es" ? "es" : lang === "de" ? "de" : "com";
  return `https://www.esky.${tld}/`;
}

function iberiaFlightTarget(p: FlightLinkParams): string {
  return (
    `https://www.iberia.com/us/flights/?market=US` +
    `&origin=${p.originCode.toUpperCase()}&destination=${p.destCode.toUpperCase()}` +
    `&departureDate=${p.outboundDate}&returnDate=${p.returnDate}&adults=${p.travelers}`
  );
}

function voloteaHomeTarget(lang: string): string {
  const path =
    lang === "es" ? "es" : lang === "fr" ? "fr" : lang === "de" ? "de" : "en";
  return `https://www.volotea.com/${path}/`;
}

export type FlightPartnerKey =
  | "tripcom"
  | "skyscanner"
  | "kiwi"
  | "esky"
  | "iberia"
  | "volotea"
  | "airserbia"
  | "lot";

/** Returns the final (CJ-wrapped when available) flight URL for a partner. */
export function buildFlightLink(
  partner: FlightPartnerKey,
  p: FlightLinkParams,
): string {
  switch (partner) {
    case "tripcom":
      return tripComFlightTarget(p); // already commissioned via Allianceid
    case "skyscanner":
      return skyscannerFlightTarget(p); // no CJ link → plain fallback
    case "kiwi":
      return buildClickUrl(pickByLang(KIWI_BY_LANG, p.lang));
    case "esky":
      return buildClickUrl(pickByLang(ESKY_BY_LANG, p.lang));
    case "iberia":
      return buildClickUrl(IBERIA_EVERGREEN, iberiaFlightTarget(p));
    case "volotea":
      // Prefer a localized homepage CJ link; otherwise deep-link via Evergreen.
      if (VOLOTEA_BY_LANG[p.lang]) {
        return buildClickUrl(VOLOTEA_BY_LANG[p.lang]);
      }
      return buildClickUrl(VOLOTEA_EVERGREEN, voloteaHomeTarget(p.lang));
    case "airserbia":
      if (AIRSERBIA_BY_LANG[p.lang]) {
        return buildClickUrl(AIRSERBIA_BY_LANG[p.lang]);
      }
      return buildClickUrl(AIRSERBIA_EVERGREEN);
    case "lot":
      if (LOT_BY_LANG[p.lang]) {
        return buildClickUrl(LOT_BY_LANG[p.lang]);
      }
      return buildClickUrl(LOT_EVERGREEN);
    default:
      return skyscannerFlightTarget(p);
  }
}

// ── Hotel link builders ────────────────────────────────────────────────────

function airbnbTarget(p: HotelLinkParams): string {
  const dest = encodeURIComponent(p.destination || "");
  return (
    `https://${airbnbDomain(p.lang)}/s/${dest}/homes` +
    `?date_picker_type=calendar&checkin=${p.checkIn}&checkout=${p.checkOut}` +
    `&adults=${p.travelers}&search_type=AUTOSUGGEST`
  );
}

function skyscannerHotelTarget(p: HotelLinkParams): string {
  const domain = skyDomain(p.lang);
  if (p.destEntityId) {
    return (
      `https://${domain}/hotels/search?entity_id=${p.destEntityId}` +
      `&checkin=${p.checkIn}&checkout=${p.checkOut}&rooms=1&adults=${p.travelers}`
    );
  }
  return `https://${domain}/hotels`;
}

function tripComHotelTarget(p: HotelLinkParams): string {
  const city = encodeURIComponent(p.destination || "");
  return (
    `https://www.trip.com/hotels/list?city=&searchWord=${city}` +
    `&checkIn=${p.checkIn}&checkOut=${p.checkOut}&crn=1&adult=${p.travelers}` +
    `&children=0&locale=${p.lang}-XX&curr=EUR`
  );
}

export type HotelPartnerKey =
  | "airbnb"
  | "skyscanner"
  | "tripcom"
  | "esky";

/** Returns the final (CJ-wrapped when available) hotel URL for a partner. */
export function buildHotelLink(
  partner: HotelPartnerKey,
  p: HotelLinkParams,
): string {
  switch (partner) {
    case "airbnb":
      return airbnbTarget(p); // no CJ link → plain fallback
    case "skyscanner":
      return skyscannerHotelTarget(p); // no CJ link → plain fallback
    case "tripcom":
      // Prefer a locale hotel-list CJ link; otherwise deep-link via Evergreen.
      if (TRIPCOM_HOTELS_BY_LANG[p.lang]) {
        return buildClickUrl(TRIPCOM_HOTELS_BY_LANG[p.lang]);
      }
      return buildClickUrl(TRIPCOM_EVERGREEN, tripComHotelTarget(p));
    case "esky":
      return buildClickUrl(pickByLang(ESKY_BY_LANG, p.lang));
    default:
      return airbnbTarget(p);
  }
}
