/**
 * Destination matching (pure).
 *
 * Flight suppliers key off IATA codes, which are universal. Hotel, activity and
 * ferry suppliers key off their OWN destination taxonomies — Hotelbeds
 * destination codes, Expedia region ids, Viator destination ids, Tiqets city
 * ids — and none of those can be derived from an IATA code. This module turns a
 * list of candidates fetched from a provider's own locations feed into one
 * chosen id, with a confidence score and a reason.
 *
 * The failure this exists to prevent is booking Paris, Texas. A name match
 * alone is not enough: "Paris" is a real place in France, Texas and Ontario,
 * and a hotel search sent to the wrong one returns plausible, cheap, completely
 * useless results that an agent may not catch until a traveller does. So:
 *
 *  - an explicit IATA match always beats a name match,
 *  - a country mismatch is heavily penalised,
 *  - and when the top two candidates are too close to separate, this returns
 *    NO match rather than a coin flip. An honest "we could not map this
 *    destination" is cheap; a confident wrong answer is not.
 */

export interface DestinationCandidate {
  /** The provider's own id — the thing we are actually looking for. */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 where the provider gives one. */
  countryCode?: string;
  /** IATA codes the provider associates with this destination. */
  iataCodes?: string[];
  type?: "city" | "region" | "airport" | "poi";
  lat?: number;
  lon?: number;
}

export interface DestinationTarget {
  /** The canonical key we resolve from — always an IATA code in our searches. */
  iata: string;
  /** City name, when the caller knows it. Improves matching, never required. */
  cityName?: string;
  countryCode?: string;
}

export interface DestinationMatch {
  candidate: DestinationCandidate;
  /** 0..1. Anything below MIN_CONFIDENCE is not returned as a match. */
  confidence: number;
  /** Why this won — surfaced to ops when a mapping looks wrong. */
  reason: string;
}

export interface DestinationResolution {
  match: DestinationMatch | null;
  /** Present when we declined to choose. */
  problem?: "no_candidates" | "below_threshold" | "ambiguous";
  /** The runners-up, for an ops screen. */
  alternatives: DestinationMatch[];
}

/** Below this, a match is a guess and we do not make it. */
export const MIN_CONFIDENCE = 0.6;

/**
 * If the top two are within this of each other AND neither is a code-level
 * match, the answer is ambiguous. Two same-named cities in different countries
 * is the exact case this catches.
 */
export const AMBIGUITY_MARGIN = 0.08;

/** Confidence at or above this is treated as decisive, so closeness is moot. */
export const DECISIVE_CONFIDENCE = 0.9;

/**
 * Fold a place name to a comparable form: lowercase, accents stripped, Greek
 * transliterated, punctuation and noise words removed. "Αθήνα", "Athína" and
 * "Athens (Greece)" should not be three different places.
 */
const GREEK_MAP: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
  κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
  ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Dropped before comparison — they carry no distinguishing information. */
const NOISE_WORDS = new Set(["city", "area", "region", "province", "district", "and", "the"]);

export function normalizeName(raw: string): string {
  const folded = String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  let transliterated = "";
  for (const ch of folded) transliterated += GREEK_MAP[ch] ?? ch;

  return transliterated
    // Anything parenthesised is a qualifier, not the name: "Paris (CDG)".
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(" ")
    .trim();
}

const upper = (s: string | undefined): string => String(s ?? "").trim().toUpperCase();

/**
 * Score one candidate against the target. Returns null when the candidate is
 * not plausibly the same place at all.
 */
export function scoreCandidate(
  candidate: DestinationCandidate,
  target: DestinationTarget,
): DestinationMatch | null {
  const iata = upper(target.iata);
  const candidateIatas = (candidate.iataCodes ?? []).map(upper);

  let confidence: number;
  let reason: string;

  if (iata && candidateIatas.includes(iata)) {
    // The provider itself says this destination serves that airport. Nothing
    // beats that.
    confidence = 1;
    reason = `provider lists ${iata} under this destination`;
  } else if (iata && upper(candidate.id) === iata) {
    // Several providers reuse IATA city codes as their own ids (Hotelbeds PAR).
    confidence = 0.95;
    reason = `destination id matches the IATA code ${iata}`;
  } else {
    const targetName = normalizeName(target.cityName ?? "");
    const candidateName = normalizeName(candidate.name);
    if (!targetName || !candidateName) return null;

    if (targetName === candidateName) {
      confidence = 0.85;
      reason = "exact name match";
    } else if (
      candidateName.startsWith(`${targetName} `) ||
      targetName.startsWith(`${candidateName} `)
    ) {
      confidence = 0.62;
      reason = "name prefix match";
    } else if (candidateName.includes(targetName) || targetName.includes(candidateName)) {
      confidence = 0.45;
      reason = "partial name match";
    } else {
      return null;
    }
  }

  // Country is the strongest disambiguator we have for same-named places.
  const targetCountry = upper(target.countryCode);
  const candidateCountry = upper(candidate.countryCode);
  if (targetCountry && candidateCountry) {
    if (targetCountry === candidateCountry) {
      confidence = Math.min(1, confidence + 0.05);
      reason += `, same country (${candidateCountry})`;
    } else {
      // Paris, Texas. Halve it — enough to lose to the right answer, and to
      // fall under the threshold when it is the only candidate.
      confidence *= 0.5;
      reason += `, DIFFERENT country (${candidateCountry} ≠ ${targetCountry})`;
    }
  }

  // For a stay, a city beats a broad region or a single airport.
  if (candidate.type === "region") confidence *= 0.9;
  if (candidate.type === "poi") confidence *= 0.8;

  return { candidate, confidence: Math.min(1, Number(confidence.toFixed(4))), reason };
}

/**
 * Choose the provider destination id for a target, or decline.
 *
 * Declining is a first-class outcome: `problem` says which of the three ways it
 * failed, so the caller can tell an agent "no such destination at this
 * supplier" apart from "two equally good matches, someone must pick".
 */
export function pickBestDestination(
  candidates: DestinationCandidate[],
  target: DestinationTarget,
): DestinationResolution {
  if (!candidates.length) return { match: null, problem: "no_candidates", alternatives: [] };

  const scored = candidates
    .map((c) => scoreCandidate(c, target))
    .filter((m): m is DestinationMatch => m !== null)
    .sort((a, b) => b.confidence - a.confidence);

  if (!scored.length) return { match: null, problem: "no_candidates", alternatives: [] };

  const [best, runnerUp] = scored;
  const alternatives = scored.slice(1, 4);

  if (best.confidence < MIN_CONFIDENCE) {
    return { match: null, problem: "below_threshold", alternatives: scored.slice(0, 3) };
  }

  const tooClose =
    runnerUp !== undefined &&
    best.confidence < DECISIVE_CONFIDENCE &&
    best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN &&
    // Identical ids are the same place listed twice, not an ambiguity.
    runnerUp.candidate.id !== best.candidate.id;

  if (tooClose) return { match: null, problem: "ambiguous", alternatives: scored.slice(0, 3) };

  return { match: best, alternatives };
}

/**
 * Cache key for a resolved mapping. Deliberately includes the connector: the
 * same IATA maps to a different id at every provider.
 */
export const mappingKey = (connectorId: string, iata: string): string =>
  `${connectorId}:${upper(iata)}`;
