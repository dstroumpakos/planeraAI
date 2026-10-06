/**
 * Origin ≠ destination rule — single source of truth.
 *
 * A trip whose origin and destination are the same place makes no sense: the
 * flight search returns nothing (searchapi rejects ATH→ATH), the itinerary
 * comes back half-empty and the user still burns a credit. Historically the
 * only guard sat deep inside the flight search, long after the trip row had
 * been written and the credit consumed.
 *
 * The two fields arrive in different shapes — origin is a home-airport string
 * ("Athens, Greece ATH", "ATH", "Αθήνα") and destination is a "City, Country"
 * name — so a raw string compare misses almost every real collision. This
 * helper compares them at three levels, any of which counts as "same":
 *
 *   1. Resolved IATA code   — "ATH" vs "Athens, Greece"
 *   2. City of that airport — "London (LGW)" vs "London, UK" (LHR)
 *   3. Normalised city text — for places our airport dataset doesn't know
 *
 * Deliberately conservative: when neither side resolves and the texts differ,
 * we let the trip through rather than block on a guess.
 */

import { AIRPORTS } from "./airports";
import { resolveAirport } from "./destinationAirports";
import { resolveHomeIata } from "./homeAirport";
import { normalizeDestinationToEnglish } from "./destinationTranslations";

/** IATA code for either field, trying the home-airport reader first. */
function resolveCode(value: string): string | undefined {
  return resolveHomeIata(value) ?? resolveAirport(value)?.iata ?? undefined;
}

/** Lower-cased, diacritic-free English city name, e.g. "Αθήνα, Ελλάδα ATH" → "athens". */
function cityKey(value: string): string {
  const english = normalizeDestinationToEnglish(value.trim());
  return english
    .split(",")[0]
    .replace(/\(([A-Za-z]{3})\)/g, " ")   // "(ATH)"
    .replace(/\b[A-Z]{3}\b/g, " ")        // trailing "ATH"
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when `origin` and `destination` denote the same city/airport.
 * Empty values never collide (the "origin required" rule handles those).
 */
export function isSameOriginDestination(
  origin: string | undefined | null,
  destination: string | undefined | null
): boolean {
  const o = (origin ?? "").trim();
  const d = (destination ?? "").trim();
  if (!o || !d) return false;

  // A destination with no airport of its own ("Meteora" → SKG) resolves to its
  // hub, which is a different place from an origin of Thessaloniki. Only
  // compare codes when the destination's code is genuinely its own.
  const dAirport = resolveAirport(d);
  const oCode = resolveCode(o);
  const dCode = dAirport?.hasOwnAirport === false ? undefined : resolveCode(d);
  if (oCode && dCode) {
    if (oCode === dCode) return true;
    // Different airports of the same city (LHR/LGW/STN, JFK/EWR/LGA).
    const oCity = AIRPORTS.find((a) => a.code === oCode)?.city;
    const dCity = AIRPORTS.find((a) => a.code === dCode)?.city;
    if (oCity && dCity && oCity.toLowerCase() === dCity.toLowerCase()) return true;
  }

  const oKey = cityKey(o);
  const dKey = cityKey(d);
  return !!oKey && oKey === dKey;
}

/** Error text the backend throws; clients map it to a localised message. */
export const SAME_ROUTE_ERROR = "Origin and destination cannot be the same city";
