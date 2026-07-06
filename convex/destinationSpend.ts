/**
 * Curated average daily tourist spend per destination.
 *
 * These figures approximate what a mid-range traveler spends *on the ground*
 * per person per day — lodging + food + local transport + activities — and
 * EXCLUDE international airfare. They are a curated, static snapshot compiled
 * from public sources (Eurostat tourism-expenditure statistics, `tour_dem_*`,
 * for country-level figures, plus per-city cost indices such as Numbeo and
 * Budget Your Trip). All values are in EUR.
 *
 * Why static: this module is imported by a Convex *query* (`getTrendingDestinations`),
 * and queries cannot make network calls. Refresh these numbers periodically
 * (roughly once a year, when Eurostat publishes new expenditure data) rather
 * than fetching live.
 */

import { normalizeDestinationKey } from "./partnerApiAuth";

export const SPEND_CURRENCY = "EUR" as const;

/**
 * City-level average daily spend per person (EUR), keyed by the normalized
 * first-segment city token (e.g. "New York City, USA" -> "new-york-city").
 * Aliases (nyc, la, sf, ...) are included so common short forms resolve too.
 */
export const CITY_DAILY_SPEND_EUR: Record<string, number> = {
  // Western & Southern Europe
  paris: 150,
  london: 160,
  rome: 120,
  barcelona: 115,
  madrid: 105,
  seville: 95,
  valencia: 100,
  amsterdam: 145,
  berlin: 110,
  munich: 130,
  hamburg: 115,
  frankfurt: 120,
  brussels: 120,
  bruges: 110,
  lisbon: 95,
  porto: 90,
  vienna: 120,
  zurich: 205,
  geneva: 195,
  milan: 130,
  venice: 145,
  florence: 120,
  naples: 95,
  nice: 140,
  dublin: 145,
  edinburgh: 130,
  // Northern Europe
  copenhagen: 160,
  stockholm: 150,
  oslo: 175,
  helsinki: 145,
  reykjavik: 185,
  // Central & Eastern Europe
  prague: 85,
  budapest: 80,
  warsaw: 70,
  krakow: 65,
  gdansk: 65,
  tallinn: 85,
  riga: 75,
  vilnius: 70,
  // Greece & the Balkans
  athens: 90,
  thessaloniki: 75,
  santorini: 150,
  mykonos: 165,
  dubrovnik: 110,
  split: 95,
  // Turkey & Middle East
  istanbul: 65,
  dubai: 165,
  "abu-dhabi": 155,
  doha: 160,
  "tel-aviv": 160,
  jerusalem: 130,
  amman: 80,
  // Africa
  marrakech: 70,
  cairo: 55,
  "cape-town": 85,
  nairobi: 90,
  zanzibar: 90,
  // Asia
  tokyo: 135,
  kyoto: 120,
  seoul: 115,
  bangkok: 55,
  phuket: 60,
  singapore: 145,
  "hong-kong": 140,
  bali: 55,
  hanoi: 45,
  "ho-chi-minh-city": 50,
  "kuala-lumpur": 60,
  jakarta: 55,
  manila: 55,
  mumbai: 50,
  delhi: 45,
  // Oceania
  sydney: 150,
  melbourne: 145,
  auckland: 140,
  // North America
  "new-york-city": 210,
  "new-york": 210,
  nyc: 210,
  "los-angeles": 175,
  la: 175,
  "san-francisco": 195,
  sf: 195,
  chicago: 175,
  boston: 185,
  miami: 170,
  "las-vegas": 160,
  seattle: 175,
  washington: 175,
  orlando: 150,
  honolulu: 200,
  toronto: 150,
  vancouver: 155,
  montreal: 135,
  // Latin America
  cancun: 120,
  "mexico-city": 80,
  cdmx: 80,
  "rio-de-janeiro": 90,
  rio: 90,
  "buenos-aires": 75,
  lima: 65,
  cusco: 60,
  cartagena: 75,
  bogota: 60,
  santiago: 80,
};

/**
 * Country-level average daily spend per person (EUR), used as a fallback when
 * the specific city is not in `CITY_DAILY_SPEND_EUR`. Keyed by the normalized
 * country token from the last comma-segment of the destination (e.g.
 * "Reykjavik, Iceland" -> "iceland"). Common short forms (uk, usa, uae) are
 * included as aliases.
 */
export const COUNTRY_DAILY_SPEND_EUR: Record<string, number> = {
  france: 130,
  "united-kingdom": 150,
  uk: 150,
  "great-britain": 150,
  italy: 115,
  spain: 100,
  netherlands: 140,
  germany: 110,
  belgium: 115,
  "czech-republic": 80,
  czechia: 80,
  austria: 120,
  portugal: 90,
  greece: 95,
  switzerland: 195,
  denmark: 155,
  sweden: 145,
  norway: 175,
  finland: 140,
  iceland: 180,
  ireland: 140,
  poland: 70,
  hungary: 75,
  croatia: 100,
  slovenia: 100,
  estonia: 90,
  latvia: 80,
  lithuania: 75,
  romania: 65,
  bulgaria: 60,
  turkey: 60,
  "united-arab-emirates": 160,
  uae: 160,
  qatar: 155,
  israel: 150,
  jordan: 80,
  morocco: 70,
  egypt: 55,
  "south-africa": 85,
  kenya: 90,
  tanzania: 90,
  usa: 180,
  "united-states": 180,
  canada: 150,
  mexico: 90,
  brazil: 85,
  argentina: 75,
  peru: 65,
  colombia: 65,
  chile: 85,
  japan: 125,
  "south-korea": 110,
  china: 90,
  "hong-kong": 140,
  thailand: 55,
  singapore: 140,
  indonesia: 55,
  vietnam: 45,
  malaysia: 60,
  philippines: 55,
  india: 45,
  australia: 150,
  "new-zealand": 140,
  maldives: 240,
};

export type AvgDailySpend = {
  amount: number;
  currency: typeof SPEND_CURRENCY;
  level: "city" | "country";
};

/**
 * Resolve the average daily spend per person for a destination string.
 * Tries a city-level match on the first segment first, then falls back to a
 * country-level match on the last segment. Returns null when neither is known.
 */
/**
 * Generic city-first / country-fallback lookup over one of the curated maps.
 * Returns the matched value plus which level it came from, or null.
 */
function lookupByDestination(
  destination: string,
  cityMap: Record<string, number>,
  countryMap: Record<string, number>,
): { value: number; level: "city" | "country" } | null {
  if (!destination) return null;

  const segments = destination.split(",").map((s) => s.trim()).filter(Boolean);

  // City-level match on the first segment.
  const cityToken = normalizeDestinationKey(segments[0] ?? destination);
  if (cityToken && cityMap[cityToken] !== undefined) {
    return { value: cityMap[cityToken], level: "city" };
  }

  // Country-level fallback on the last segment (when a country is present).
  if (segments.length > 1) {
    const countryToken = normalizeDestinationKey(segments[segments.length - 1]);
    if (countryToken && countryMap[countryToken] !== undefined) {
      return { value: countryMap[countryToken], level: "country" };
    }
  }

  return null;
}

export function getAvgDailySpend(destination: string): AvgDailySpend | null {
  const r = lookupByDestination(destination, CITY_DAILY_SPEND_EUR, COUNTRY_DAILY_SPEND_EUR);
  return r ? { amount: r.value, currency: SPEND_CURRENCY, level: r.level } : null;
}

/**
 * Typical trip length (in days) for a destination — how long travelers tend to
 * stay. City figures reflect common city-break / beach-holiday lengths; the
 * country fallback approximates Eurostat "average length of stay" (nights spent
 * per arrival) rounded to whole days.
 */
export const CITY_AVG_STAY_DAYS: Record<string, number> = {
  // City breaks (short)
  paris: 4,
  london: 4,
  rome: 4,
  barcelona: 4,
  madrid: 3,
  seville: 3,
  valencia: 3,
  amsterdam: 3,
  berlin: 4,
  munich: 3,
  hamburg: 3,
  frankfurt: 2,
  brussels: 2,
  bruges: 2,
  lisbon: 4,
  porto: 3,
  vienna: 3,
  zurich: 3,
  geneva: 3,
  milan: 3,
  venice: 3,
  florence: 3,
  naples: 3,
  nice: 4,
  dublin: 3,
  edinburgh: 3,
  copenhagen: 3,
  stockholm: 3,
  oslo: 3,
  helsinki: 3,
  reykjavik: 5,
  prague: 4,
  budapest: 4,
  warsaw: 3,
  krakow: 3,
  gdansk: 3,
  tallinn: 3,
  riga: 3,
  vilnius: 3,
  athens: 3,
  thessaloniki: 3,
  // Islands / beach / resort (longer)
  santorini: 5,
  mykonos: 5,
  dubrovnik: 4,
  split: 4,
  // Turkey & Middle East
  istanbul: 4,
  dubai: 5,
  "abu-dhabi": 4,
  doha: 3,
  "tel-aviv": 4,
  jerusalem: 3,
  amman: 3,
  // Africa
  marrakech: 4,
  cairo: 4,
  "cape-town": 6,
  nairobi: 4,
  zanzibar: 7,
  // Asia
  tokyo: 5,
  kyoto: 3,
  seoul: 5,
  bangkok: 4,
  phuket: 6,
  singapore: 4,
  "hong-kong": 4,
  bali: 8,
  hanoi: 3,
  "ho-chi-minh-city": 3,
  "kuala-lumpur": 3,
  jakarta: 3,
  manila: 3,
  mumbai: 3,
  delhi: 3,
  // Oceania
  sydney: 5,
  melbourne: 4,
  auckland: 4,
  // North America
  "new-york-city": 5,
  "new-york": 5,
  nyc: 5,
  "los-angeles": 5,
  la: 5,
  "san-francisco": 4,
  sf: 4,
  chicago: 4,
  boston: 4,
  miami: 5,
  "las-vegas": 4,
  seattle: 4,
  washington: 4,
  orlando: 6,
  honolulu: 7,
  toronto: 4,
  vancouver: 4,
  montreal: 4,
  // Latin America
  cancun: 6,
  "mexico-city": 4,
  cdmx: 4,
  "rio-de-janeiro": 5,
  rio: 5,
  "buenos-aires": 5,
  lima: 3,
  cusco: 4,
  cartagena: 5,
  bogota: 3,
  santiago: 4,
};

/** Country-level average length of stay (days), Eurostat-derived approximations. */
export const COUNTRY_AVG_STAY_DAYS: Record<string, number> = {
  france: 4,
  "united-kingdom": 4,
  uk: 4,
  "great-britain": 4,
  italy: 4,
  spain: 5,
  netherlands: 3,
  germany: 3,
  belgium: 3,
  "czech-republic": 3,
  czechia: 3,
  austria: 4,
  portugal: 4,
  greece: 6,
  switzerland: 3,
  denmark: 3,
  sweden: 3,
  norway: 3,
  finland: 3,
  iceland: 5,
  ireland: 4,
  poland: 3,
  hungary: 3,
  croatia: 5,
  slovenia: 3,
  estonia: 3,
  latvia: 3,
  lithuania: 3,
  romania: 3,
  bulgaria: 4,
  turkey: 5,
  "united-arab-emirates": 5,
  uae: 5,
  qatar: 3,
  israel: 4,
  jordan: 3,
  morocco: 5,
  egypt: 6,
  "south-africa": 6,
  kenya: 5,
  tanzania: 7,
  usa: 5,
  "united-states": 5,
  canada: 5,
  mexico: 6,
  brazil: 5,
  argentina: 5,
  peru: 4,
  colombia: 4,
  chile: 4,
  japan: 5,
  "south-korea": 5,
  china: 5,
  "hong-kong": 4,
  thailand: 8,
  singapore: 4,
  indonesia: 8,
  vietnam: 5,
  malaysia: 4,
  philippines: 5,
  india: 5,
  australia: 6,
  "new-zealand": 6,
  maldives: 7,
};

export type AvgStay = {
  days: number;
  level: "city" | "country";
};

/** Resolve the typical stay length (days) for a destination string. */
export function getAvgStay(destination: string): AvgStay | null {
  const r = lookupByDestination(destination, CITY_AVG_STAY_DAYS, COUNTRY_AVG_STAY_DAYS);
  return r ? { days: r.value, level: r.level } : null;
}
