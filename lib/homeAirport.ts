/**
 * Home ("base") airport resolution — single source of truth.
 *
 * `userSettings.homeAirport` is free text typed by the user, so it arrives in
 * every shape imaginable:
 *
 *   "Athens, Greece ATH"   "ATH"        "London (LHR)"
 *   "athens, ath"          "Αθήνα"      "San Francisco, CA"
 *
 * Historically every read site did its own `raw.toUpperCase().match(/\b[A-Z]{3}\b/g)`
 * and took the last hit. That has two failure modes:
 *
 *   1. A name written in a non-Latin script ("Αθήνα", "Москва", "東京") has no
 *      3-letter Latin token at all, so the user silently got zero low-fare
 *      deals, no explore origin and no flight-search prefill.
 *   2. Latin names whose first word happens to be three letters matched the
 *      wrong airport — "San Francisco, CA" resolved to SAN (San Diego), and
 *      "Rio de Janeiro" to RIO.
 *
 * `resolveHomeIata` fixes both by only trusting a bare 3-letter token when it
 * was written in caps AND is a real IATA code we know, then falling back to
 * `resolveAirport`, which already normalizes localized city names to English
 * before looking them up.
 */

import { AIRPORTS } from "./airports";
import { resolveAirport } from "./destinationAirports";
import { normalizeDestinationToEnglish, toEnglishName } from "./destinationTranslations";

const KNOWN_IATA = new Set(AIRPORTS.map((a) => a.code));

/**
 * Characters outside the Latin scripts we accept: Basic Latin + Latin-1
 * Supplement + Latin Extended-A/B (U+0000–U+024F), Latin Extended Additional
 * (U+1E00–U+1EFF, e.g. Vietnamese) and General Punctuation (U+2000–U+206F, for
 * curly quotes and en-dashes). Greek, Cyrillic, Arabic, Hebrew, CJK etc. all
 * fall outside it.
 *
 * Deliberately built from explicit code-point ranges rather than
 * `\p{Script=Latin}` so it behaves identically on Hermes and in Convex's
 * runtime.
 */
const NON_LATIN_CHAR = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/;

/** True when the string contains any non-Latin character (e.g. "Αθήνα"). */
export function hasNonLatinScript(value: string | undefined | null): boolean {
  return !!value && NON_LATIN_CHAR.test(value);
}

/**
 * Resolve a free-form home-airport string to an IATA code.
 *
 * Resolution order (first hit wins):
 *   1. An explicitly delimited code — "London (LHR)", "Athens - ATH".
 *   2. The last ALL-CAPS 3-letter token that is a known IATA code. Casing
 *      matters: "ATH" in "Athens, Greece ATH" is a code, "San" in
 *      "San Francisco, CA" is not.
 *   3. The city/airport name itself via `resolveAirport`, which normalizes
 *      localized names to English first — this is what turns "Αθήνα" into ATH.
 *   4. An ALL-CAPS 3-letter token we don't recognise, so users whose airport
 *      predates our dataset keep working exactly as before.
 *
 * Returns `undefined` when nothing can be resolved.
 */
export function resolveHomeIata(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;

  // 1. Explicitly delimited code.
  const delimited =
    trimmed.match(/\(([A-Za-z]{3})\)/) || trimmed.match(/[-–—]\s*([A-Za-z]{3})\s*$/);
  if (delimited) {
    const code = delimited[1].toUpperCase();
    if (KNOWN_IATA.has(code)) return code;
  }

  // 2/4. Uppercase 3-letter tokens, matched against the ORIGINAL casing.
  const upperTokens = trimmed.match(/\b[A-Z]{3}\b/g) || [];
  let unknownToken: string | undefined;
  for (let i = upperTokens.length - 1; i >= 0; i--) {
    const code = upperTokens[i];
    if (KNOWN_IATA.has(code)) return code;
    if (!unknownToken) unknownToken = code;
  }

  // 3. Resolve by name (handles Greek/Cyrillic/Arabic/… via the translation map).
  const byName = resolveAirport(trimmed)?.iata;
  if (byName) return byName;

  // 4. Unrecognised but code-shaped token, or a lone lowercase code ("ath").
  if (unknownToken) return unknownToken;
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();

  return undefined;
}

/**
 * Canonical English label for a home airport, e.g. "Athens, Greece ATH".
 *
 * Used to rewrite what the user typed before it is stored, so the value in the
 * database is always English and always carries its IATA code. Falls back to
 * the trimmed input when the code isn't in our airport dataset (we still don't
 * want to throw away a working code we can't name).
 */
export function canonicalHomeAirport(
  raw: string | undefined | null
): { iata: string; label: string } | null {
  const iata = resolveHomeIata(raw);
  if (!iata) return null;

  const airport = AIRPORTS.find((a) => a.code === iata);
  if (airport) {
    return { iata, label: `${airport.city}, ${airport.country} ${airport.code}` };
  }

  // Code we resolved but can't name from AIRPORTS (e.g. SKG). Keep the user's
  // own wording when it's already Latin; otherwise translate it to English and
  // append the code, so we never store text a downstream API can't read.
  const trimmed = String(raw).trim();
  if (!hasNonLatinScript(trimmed)) return { iata, label: trimmed };

  const english = normalizeDestinationToEnglish(trimmed);
  return {
    iata,
    label: hasNonLatinScript(english) ? iata : `${english} ${iata}`,
  };
}

/**
 * English city name for an IATA code, or `undefined` when the code isn't in
 * our airport dataset. Used for admin aggregations that group users by their
 * base airport and want a readable, language-independent label.
 */
export function airportCityName(iata: string | undefined | null): string | undefined {
  if (!iata) return undefined;
  return AIRPORTS.find((a) => a.code === iata.toUpperCase())?.city;
}

export type AirportOption = (typeof AIRPORTS)[number];

/**
 * Airport autocomplete that also matches localized city names, so a Greek user
 * typing "Αθήνα" is offered "Athens (ATH)" and picks the English value instead
 * of free-typing an unresolvable one.
 */
export function searchAirportOptions(query: string, limit = 10): AirportOption[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const needles = new Set<string>([trimmed.toLowerCase()]);
  // "Αθήνα" → "Athens"; "Μιλάνο, Ιταλία" → "Milan, Italy".
  for (const part of trimmed.split(",")) {
    const english = toEnglishName(part).toLowerCase();
    if (english) needles.add(english);
  }

  const matches = (haystack: string) => {
    const lower = haystack.toLowerCase();
    for (const needle of needles) if (lower.includes(needle)) return true;
    return false;
  };

  const results = AIRPORTS.filter(
    (a) =>
      matches(a.city) ||
      matches(a.country) ||
      matches(a.code) ||
      matches(a.name)
  ).slice(0, limit);

  // Nothing matched by substring, but the whole string may still name a place
  // we can map to an airport (e.g. a suburb or an alternate spelling).
  if (results.length === 0) {
    const iata = resolveHomeIata(trimmed);
    const airport = iata && AIRPORTS.find((a) => a.code === iata);
    if (airport) return [airport];
  }

  return results;
}

/**
 * True when a stored base airport still needs the OpenAI lookup.
 *
 * Two cases qualify:
 *   1. Nothing resolved at all — a small airport or a city missing from our
 *      dataset ("Kalamata", "Λάρνακα", "Podgorica"). The user keeps their
 *      typed text and every flight feature silently sees no origin.
 *   2. We resolved a code-shaped token we don't actually know ("KLX"), so we
 *      can't name it and the stored label is whatever the user typed — which
 *      may still be in another language or carry junk around the code.
 *
 * Both are exactly the cases `convex/homeAirportAi.ts` asks OpenAI about.
 */
export function needsAiHomeAirportLookup(raw: string | undefined | null): boolean {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return false;

  const iata = resolveHomeIata(trimmed);
  if (!iata) return true;
  if (KNOWN_IATA.has(iata)) return false;

  // A code we don't know, but the value is already in the canonical shape a
  // previous lookup wrote ("Kalamata, Greece KLX"). Asking again would cost a
  // call per save and hand back the same string, so treat it as resolved.
  return !isCanonicalHomeAirportLabel(trimmed, iata);
}

/**
 * "City, Country XXX" — the exact shape `formatHomeAirportLabel` and
 * `canonicalHomeAirport` produce, with the trailing code matching what the
 * string resolves to.
 */
function isCanonicalHomeAirportLabel(trimmed: string, iata: string): boolean {
  const match = trimmed.match(/^([^,]+),\s*([^,]+)\s+([A-Z]{3})$/);
  return !!match && match[3] === iata;
}

/**
 * Build the canonical stored label from resolved parts — same shape
 * `canonicalHomeAirport` produces, so an AI-resolved airport reads and parses
 * identically to one from AIRPORTS ("Kalamata, Greece KLX").
 */
export function formatHomeAirportLabel(parts: {
  city?: string | null;
  country?: string | null;
  iata: string;
}): string {
  const iata = String(parts.iata).trim().toUpperCase();
  const city = String(parts.city ?? "").trim();
  const country = String(parts.country ?? "").trim();
  if (city && country) return `${city}, ${country} ${iata}`;
  if (city) return `${city} ${iata}`;
  return iata;
}
