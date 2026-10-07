/**
 * Country-name resolution — single source of truth for the app and Convex.
 *
 * Wishlist entries carry a free-text country, and people also save a whole
 * country as the destination ("Spain", "Αίγυπτος"). Both used to be stored
 * verbatim, so the admin radar view showed junk like "Egypt · Why" and the
 * seeder couldn't search "Spain" at all. Everything that needs to know "is this
 * a country, and which one?" goes through `resolveCountry`.
 *
 * Canonical names are the keys of `COUNTRY_TRANSLATIONS`, which match the
 * `country` field of `lib/airports.ts` ("UK", "USA", "UAE", …).
 */

import { COUNTRY_TRANSLATIONS } from "./destinationTranslations";

/** Other ways people write a country that the translation table doesn't hold. */
const COUNTRY_ALIASES: Record<string, string> = {
  "united kingdom": "UK",
  "great britain": "UK",
  "britain": "UK",
  "england": "UK",
  "scotland": "UK",
  "wales": "UK",
  "u.k.": "UK",
  "united states": "USA",
  "united states of america": "USA",
  "america": "USA",
  "us": "USA",
  "u.s.": "USA",
  "u.s.a.": "USA",
  "ηπα": "USA",
  "αμερικη": "USA",
  "united arab emirates": "UAE",
  "emirates": "UAE",
  "ηνωμενα αραβικα εμιρατα": "UAE",
  "czechia": "Czech Republic",
  "τσεχια": "Czech Republic",
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
  "korea": "South Korea",
  "turkiye": "Turkey",
  "bosnia": "Bosnia & Herzegovina",
  "bosnia and herzegovina": "Bosnia & Herzegovina",
  "macedonia": "North Macedonia",
  "antigua and barbuda": "Antigua & Barbuda",
  "trinidad and tobago": "Trinidad & Tobago",
};

/** Lower-case, strip accents/diacritics (incl. Greek tonos) and punctuation noise. */
export function normalizeCountryKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let LOOKUP: Map<string, string> | null = null;

function lookup(): Map<string, string> {
  if (LOOKUP) return LOOKUP;
  const m = new Map<string, string>();
  for (const [english, langs] of Object.entries(COUNTRY_TRANSLATIONS)) {
    m.set(normalizeCountryKey(english), english);
    for (const name of Object.values(langs)) {
      const k = normalizeCountryKey(name);
      if (k && !m.has(k)) m.set(k, english);
    }
  }
  for (const [alias, english] of Object.entries(COUNTRY_ALIASES)) {
    if (COUNTRY_TRANSLATIONS[english] && !m.has(normalizeCountryKey(alias))) {
      m.set(normalizeCountryKey(alias), english);
    }
  }
  LOOKUP = m;
  return m;
}

/**
 * Canonical English country name for anything a user might type, in any of
 * the app's languages ("Ισπανία", "españa", "United Kingdom" → "Spain", "Spain",
 * "UK"). Returns null when the text isn't a country we know.
 */
export function resolveCountry(input: string | undefined | null): string | null {
  if (!input) return null;
  const key = normalizeCountryKey(String(input));
  if (key.length < 2) return null;
  return lookup().get(key) ?? null;
}

/** Every canonical country name, for pickers. */
export function allCountries(): string[] {
  return Object.keys(COUNTRY_TRANSLATIONS);
}
