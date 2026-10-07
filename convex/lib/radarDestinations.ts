/**
 * Low-Fare Radar destination pool + wishlist-name → IATA resolution.
 *
 * Shared by the seeder (`lowFareRadarSeed`, a Node action) and the plain
 * Convex runtime (`lowFareRadar.getWishlistRoutes`), so this file must stay
 * free of "use node" and Node-only imports.
 *
 * Two jobs live here:
 *
 *   1. `POPULAR_DESTINATIONS` — the candidate list the admin "Find deals"
 *      button scans when no better signal exists. Ordered by rough global
 *      demand, because the seeder's `"pool"` source scans only the first
 *      `poolTop` (default `DEFAULT_POOL_TOP`) entries: the calendar phase costs
 *      `windows` API calls per destination and is wall-clock budgeted, so
 *      scanning the whole list would blow that budget and silently degrade
 *      the tail to unpriced fallbacks. The tail beyond `DEFAULT_POOL_TOP` is
 *      what makes job 2 broad — and it is reachable from the pool source by
 *      raising `poolTop` explicitly.
 *
 *   2. `resolveDestinationIata` — turn the free text a user typed into their
 *      wishlist ("New York", "Bali", "Ρώμη", "Paris, France") into the code we
 *      should search. Pool entries win, because they carry metro codes (NYC,
 *      LON, PAR, TYO) that make Google Flights price every airport in the
 *      city; the general destination resolver covers the long tail.
 */

import { AIRPORTS } from "../../lib/airports";
import { resolveAirport } from "../../lib/destinationAirports";
import { resolveCountry } from "../../lib/countries";

export type PoolDestination = {
  /** IATA airport or metro code Google Flights accepts as `arrival_id`. */
  code: string;
  /** English display name; also the primary match key for wishlist names. */
  city: string;
  /** Extra names users write for this place (lowercase, no diacritics). */
  aliases?: string[];
};

/** How many pool entries the seeder's `"pool"` source scans by default. */
export const DEFAULT_POOL_TOP = 24;

/**
 * Demand-ordered. The first `DEFAULT_POOL_TOP` entries are the original
 * generic pool and keep the "Find deals" button's quota profile unchanged;
 * everything after them exists to resolve wishlist names and to be reachable
 * with an explicit `destinations` list or a raised `poolTop`.
 */
export const POPULAR_DESTINATIONS: PoolDestination[] = [
  // ── Core pool (scanned by default) ──
  { code: "LON", city: "London" },
  { code: "PAR", city: "Paris" },
  { code: "BCN", city: "Barcelona" },
  { code: "FCO", city: "Rome", aliases: ["roma"] },
  { code: "AMS", city: "Amsterdam" },
  { code: "LIS", city: "Lisbon", aliases: ["lisboa"] },
  { code: "MAD", city: "Madrid" },
  { code: "BER", city: "Berlin" },
  { code: "PRG", city: "Prague", aliases: ["praha"] },
  { code: "IST", city: "Istanbul" },
  { code: "ATH", city: "Athens" },
  { code: "DXB", city: "Dubai" },
  { code: "NYC", city: "New York", aliases: ["new york city", "nyc", "manhattan"] },
  { code: "MIA", city: "Miami" },
  { code: "CUN", city: "Cancún", aliases: ["cancun"] },
  { code: "BKK", city: "Bangkok" },
  { code: "SIN", city: "Singapore" },
  { code: "HKT", city: "Phuket" },
  { code: "DPS", city: "Bali", aliases: ["denpasar", "ubud", "seminyak", "canggu"] },
  { code: "TYO", city: "Tokyo" },
  { code: "MEX", city: "Mexico City" },
  { code: "RIO", city: "Rio de Janeiro", aliases: ["rio"] },
  { code: "CPT", city: "Cape Town" },
  { code: "MRU", city: "Mauritius" },

  // ── Extended pool: Europe ──
  { code: "VIE", city: "Vienna", aliases: ["wien"] },
  { code: "BUD", city: "Budapest" },
  { code: "CPH", city: "Copenhagen" },
  { code: "STO", city: "Stockholm" },
  { code: "OSL", city: "Oslo" },
  { code: "HEL", city: "Helsinki" },
  { code: "REK", city: "Reykjavik", aliases: ["iceland", "reykjavík"] },
  { code: "DUB", city: "Dublin" },
  { code: "EDI", city: "Edinburgh" },
  { code: "MIL", city: "Milan", aliases: ["milano"] },
  { code: "VCE", city: "Venice", aliases: ["venezia"] },
  { code: "NAP", city: "Naples", aliases: ["napoli", "amalfi", "amalfi coast"] },
  { code: "FLR", city: "Florence", aliases: ["firenze", "tuscany"] },
  { code: "MUC", city: "Munich", aliases: ["munchen"] },
  { code: "ZRH", city: "Zurich" },
  { code: "BRU", city: "Brussels" },
  { code: "KRK", city: "Krakow", aliases: ["kraków", "cracow"] },
  { code: "WAW", city: "Warsaw" },
  { code: "OPO", city: "Porto" },
  { code: "SVQ", city: "Seville", aliases: ["sevilla"] },
  { code: "NCE", city: "Nice", aliases: ["french riviera", "cote d'azur"] },
  { code: "MLA", city: "Malta", aliases: ["valletta"] },
  { code: "DBV", city: "Dubrovnik" },
  { code: "SPU", city: "Split" },
  { code: "TIA", city: "Tirana" },
  { code: "BEG", city: "Belgrade" },
  { code: "OTP", city: "Bucharest" },
  { code: "SOF", city: "Sofia" },

  // ── Extended pool: Middle East & Africa ──
  { code: "DOH", city: "Doha" },
  { code: "AUH", city: "Abu Dhabi" },
  { code: "TLV", city: "Tel Aviv" },
  { code: "CAI", city: "Cairo" },
  { code: "RAK", city: "Marrakech", aliases: ["marrakesh"] },
  { code: "JNB", city: "Johannesburg" },
  { code: "NBO", city: "Nairobi" },
  { code: "ZNZ", city: "Zanzibar" },
  { code: "SEZ", city: "Seychelles", aliases: ["mahe"] },

  // ── Extended pool: Americas ──
  { code: "LAX", city: "Los Angeles" },
  { code: "SFO", city: "San Francisco" },
  { code: "LAS", city: "Las Vegas" },
  { code: "CHI", city: "Chicago" },
  { code: "BOS", city: "Boston" },
  { code: "WAS", city: "Washington", aliases: ["washington dc", "washington d.c."] },
  { code: "MCO", city: "Orlando" },
  { code: "YTO", city: "Toronto" },
  { code: "YMQ", city: "Montreal", aliases: ["montréal"] },
  { code: "YVR", city: "Vancouver" },
  { code: "HAV", city: "Havana", aliases: ["cuba", "la habana"] },
  { code: "PUJ", city: "Punta Cana" },
  { code: "SAO", city: "São Paulo", aliases: ["sao paulo"] },
  { code: "BUE", city: "Buenos Aires" },
  { code: "LIM", city: "Lima" },
  { code: "BOG", city: "Bogotá", aliases: ["bogota"] },
  { code: "SCL", city: "Santiago", aliases: ["santiago de chile"] },

  // ── Extended pool: Asia & Pacific ──
  { code: "OSA", city: "Osaka", aliases: ["kyoto"] },
  { code: "SEL", city: "Seoul" },
  { code: "HKG", city: "Hong Kong" },
  { code: "TPE", city: "Taipei" },
  { code: "KUL", city: "Kuala Lumpur" },
  { code: "HAN", city: "Hanoi" },
  { code: "SGN", city: "Ho Chi Minh City", aliases: ["saigon", "ho chi minh"] },
  { code: "MNL", city: "Manila" },
  { code: "DEL", city: "Delhi", aliases: ["new delhi"] },
  { code: "BOM", city: "Mumbai" },
  { code: "MLE", city: "Maldives", aliases: ["male", "malé"] },
  { code: "CMB", city: "Colombo", aliases: ["sri lanka"] },
  { code: "KTM", city: "Kathmandu", aliases: ["nepal"] },
  { code: "SYD", city: "Sydney" },
  { code: "MEL", city: "Melbourne" },
  { code: "AKL", city: "Auckland" },
];

/** Diacritic-free, lowercased, with a trailing ", Country" stripped. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/,\s*[\p{L}\s.-]+$/u, "")
    .trim();
}

const POOL_BY_NAME: Map<string, PoolDestination> = (() => {
  const m = new Map<string, PoolDestination>();
  for (const d of POPULAR_DESTINATIONS) {
    // First writer wins so the demand order above doubles as tie-break.
    const keys = [d.city, ...(d.aliases ?? [])].map(normalizeName);
    for (const k of keys) if (!m.has(k)) m.set(k, d);
  }
  return m;
})();

const POOL_BY_CODE = new Map(POPULAR_DESTINATIONS.map((d) => [d.code, d]));

/**
 * Main airport behind each metro code. `google_flights` accepts metro codes, but
 * `google_flights_calendar` does not reliably: verified live 2026-10-01, DEL→PAR
 * returned no dates in any window while DEL→CDG priced 160 combinations. The
 * calendar scan uses this airport; the verify search keeps the metro code so it
 * still prices every airport in the city.
 */
const METRO_PRIMARY_AIRPORT: Record<string, string> = {
  NYC: "JFK",
  LON: "LHR",
  PAR: "CDG",
  TYO: "HND",
  ROM: "FCO",
  MIL: "MXP",
  STO: "ARN",
  CHI: "ORD",
  WAS: "IAD",
  YTO: "YYZ",
  YMQ: "YUL",
  SAO: "GRU",
  BUE: "EZE",
  RIO: "GIG",
  OSA: "KIX",
  SEL: "ICN",
  MOW: "SVO",
  BJS: "PEK",
  JKT: "CGK",
};

/** Airport code for a calendar scan: the metro's main airport, else `code`. */
export function calendarAirportFor(code: string): string {
  const upper = code.toUpperCase();
  return METRO_PRIMARY_AIRPORT[upper] ?? upper;
}

// ─── Countries as destinations ───
//
// People save whole countries ("Spain", "Αίγυπτος"). A country is searched as
// its main airports from the user's home airport, and only the cheapest
// qualifying one becomes the deal ("Spain from €X" = ATH → Malaga). Country
// names resolve through `lib/countries.ts`.

/**
 * Hand-picked main airports where the dataset order isn't the right pick
 * (metro codes price every airport in the city; island hubs matter for Spain
 * and Greece). Codes must be pool/AIRPORTS/extra codes so the deal gets a city.
 */
const COUNTRY_MAIN_AIRPORTS: Record<string, string[]> = {
  UK: ["LON", "MAN", "EDI"],
  USA: ["NYC", "LAX", "MIA", "MCO"],
  Spain: ["BCN", "MAD", "AGP", "PMI"],
  Italy: ["FCO", "MIL", "NAP", "VCE"],
  France: ["PAR", "NCE", "LYS", "MRS"],
  Japan: ["TYO", "OSA"],
  Greece: ["ATH", "JTR", "HER", "JMK"],
  Turkey: ["IST", "SAW"],
};

/** Countries the airport dataset has no airport for: main airport(s) + city. */
const COUNTRY_EXTRA_AIRPORTS: Record<string, Array<{ code: string; city: string }>> = {
  Luxembourg: [{ code: "LUX", city: "Luxembourg" }],
  Monaco: [{ code: "NCE", city: "Nice" }],
  Malta: [{ code: "MLA", city: "Malta" }],
  Slovenia: [{ code: "LJU", city: "Ljubljana" }],
  Slovakia: [{ code: "BTS", city: "Bratislava" }],
  Estonia: [{ code: "TLL", city: "Tallinn" }],
  Latvia: [{ code: "RIX", city: "Riga" }],
  Lithuania: [{ code: "VNO", city: "Vilnius" }],
  "Bosnia & Herzegovina": [{ code: "SJJ", city: "Sarajevo" }],
  Montenegro: [{ code: "TGD", city: "Podgorica" }, { code: "TIV", city: "Tivat" }],
  "North Macedonia": [{ code: "SKP", city: "Skopje" }, { code: "OHD", city: "Ohrid" }],
  Kosovo: [{ code: "PRN", city: "Pristina" }],
  Georgia: [{ code: "TBS", city: "Tbilisi" }, { code: "KUT", city: "Kutaisi" }, { code: "BUS", city: "Batumi" }],
  Armenia: [{ code: "EVN", city: "Yerevan" }],
  Azerbaijan: [{ code: "GYD", city: "Baku" }],
  Cyprus: [{ code: "LCA", city: "Larnaca" }, { code: "PFO", city: "Paphos" }],
  Tunisia: [{ code: "TUN", city: "Tunis" }, { code: "DJE", city: "Djerba" }, { code: "MIR", city: "Monastir" }],
  Algeria: [{ code: "ALG", city: "Algiers" }],
  Ghana: [{ code: "ACC", city: "Accra" }],
  Ethiopia: [{ code: "ADD", city: "Addis Ababa" }],
  Zimbabwe: [{ code: "VFA", city: "Victoria Falls" }, { code: "HRE", city: "Harare" }],
  Namibia: [{ code: "WDH", city: "Windhoek" }],
  Senegal: [{ code: "DSS", city: "Dakar" }],
  Rwanda: [{ code: "KGL", city: "Kigali" }],
  "Hong Kong": [{ code: "HKG", city: "Hong Kong" }],
  Bhutan: [{ code: "PBH", city: "Paro" }],
  "Costa Rica": [{ code: "SJO", city: "San José" }, { code: "LIR", city: "Liberia" }],
  Bolivia: [{ code: "VVI", city: "Santa Cruz" }, { code: "LPB", city: "La Paz" }],
  Aruba: [{ code: "AUA", city: "Aruba" }],
  "Curaçao": [{ code: "CUR", city: "Curaçao" }],
  Barbados: [{ code: "BGI", city: "Barbados" }],
  "Saint Lucia": [{ code: "UVF", city: "Saint Lucia" }],
  "Antigua & Barbuda": [{ code: "ANU", city: "Antigua" }],
  "Trinidad & Tobago": [{ code: "POS", city: "Port of Spain" }],
  Bermuda: [{ code: "BDA", city: "Bermuda" }],
  "Cayman Islands": [{ code: "GCM", city: "Grand Cayman" }],
  Guatemala: [{ code: "GUA", city: "Guatemala City" }],
  Belize: [{ code: "BZE", city: "Belize City" }],
  Russia: [{ code: "MOW", city: "Moscow" }, { code: "LED", city: "Saint Petersburg" }],
  Uzbekistan: [{ code: "TAS", city: "Tashkent" }, { code: "SKD", city: "Samarkand" }],
  Macau: [{ code: "MFM", city: "Macau" }],
  Mongolia: [{ code: "UBN", city: "Ulaanbaatar" }],
};

/** Curated-list airports missing from the dataset (countries that DO have others there). */
const EXTRA_AIRPORT_INFO: Record<string, { city: string; country: string }> = {
  MAN: { city: "Manchester", country: "UK" },
  EDI: { city: "Edinburgh", country: "UK" },
};

const EXTRA_BY_CODE: Map<string, { city: string; country: string }> = (() => {
  const m = new Map<string, { city: string; country: string }>(Object.entries(EXTRA_AIRPORT_INFO));
  for (const [country, list] of Object.entries(COUNTRY_EXTRA_AIRPORTS)) {
    for (const a of list) if (!m.has(a.code)) m.set(a.code, { city: a.city, country });
  }
  return m;
})();

/** Airports searched for a country, best first. At most this many. */
export const MAX_COUNTRY_AIRPORTS = 4;

/** Main airports to search for a canonical country name (may be empty). */
export function countryAirports(country: string): string[] {
  const curated = COUNTRY_MAIN_AIRPORTS[country];
  if (curated) return curated.slice(0, MAX_COUNTRY_AIRPORTS);
  const extra = COUNTRY_EXTRA_AIRPORTS[country];
  if (extra) return extra.map((a) => a.code).slice(0, MAX_COUNTRY_AIRPORTS);
  // The dataset is ordered roughly busiest-first.
  return AIRPORTS.filter((a) => a.country === country)
    .map((a) => a.code)
    .slice(0, MAX_COUNTRY_AIRPORTS);
}

/** Canonical country of an airport or metro code; null when unknown. */
export function countryForIata(code: string): string | null {
  const raw = code.toUpperCase();
  const primary = calendarAirportFor(raw); // LON → LHR
  // The dataset wins over the extras table (NCE is France, not Monaco).
  return (
    AIRPORTS.find((a) => a.code === raw)?.country ??
    AIRPORTS.find((a) => a.code === primary)?.country ??
    EXTRA_BY_CODE.get(raw)?.country ??
    EXTRA_BY_CODE.get(primary)?.country ??
    null
  );
}

/**
 * A saved name that is a whole country with something to search, e.g.
 * "Spain" → { country: "Spain", airports: [BCN, MAD, AGP, PMI] }.
 * Null for anything that isn't a country (or a country we have no airport for).
 */
export function resolveCountryDestination(
  name: string | undefined | null
): { country: string; airports: string[] } | null {
  const country = resolveCountry(name);
  if (!country) return null;
  const airports = countryAirports(country);
  return airports.length ? { country, airports } : null;
}

/** English city name for an airport or metro code; the code itself if unknown. */
export function cityForIata(code: string): string {
  const upper = code.toUpperCase();
  const pool = POOL_BY_CODE.get(upper);
  if (pool) return pool.city;
  const hit = AIRPORTS.find((a) => a.code === upper);
  return hit?.city ?? EXTRA_BY_CODE.get(upper)?.city ?? upper;
}

/**
 * Resolve a wishlist destination name to a searchable code.
 *
 * Pool first (metro codes, aliases), then the general destination resolver,
 * which knows ~600 places in several languages and maps airport-less spots to
 * their nearest hub — a wishlisted "Santorini" or "Amalfi" still yields a route
 * a user could actually fly. Returns `null` when nothing recognises the name;
 * the admin view lists those so they can be added here.
 */
export function resolveDestinationIata(
  name: string | undefined | null
): { code: string; city: string } | null {
  if (!name) return null;
  const raw = String(name).trim();
  if (!raw) return null;

  const pool = POOL_BY_NAME.get(normalizeName(raw));
  if (pool) return { code: pool.code, city: pool.city };

  const resolved = resolveAirport(raw);
  if (!resolved?.iata) return null;
  const code = resolved.iata.toUpperCase();
  // A resolver hit on a pool airport (e.g. "jfk" → JFK) keeps the pool's
  // metro code so it dedupes against wishlist names that resolved directly.
  const city = cityForIata(code);
  const poolByCity = POOL_BY_NAME.get(normalizeName(city));
  if (poolByCity) return { code: poolByCity.code, city: poolByCity.city };
  // No dataset name for this code (e.g. KGS): keep what the user wrote rather
  // than showing a bare code as the city.
  return { code, city: city === code ? raw : city };
}
