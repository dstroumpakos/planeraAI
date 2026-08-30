import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMBIGUITY_MARGIN,
  MIN_CONFIDENCE,
  mappingKey,
  normalizeName,
  pickBestDestination,
  scoreCandidate,
  type DestinationCandidate,
} from "../destinations";

const PARIS_FR: DestinationCandidate = {
  id: "PAR",
  name: "Paris",
  countryCode: "FR",
  iataCodes: ["CDG", "ORY", "BVA"],
  type: "city",
};
const PARIS_TX: DestinationCandidate = {
  id: "8891",
  name: "Paris",
  countryCode: "US",
  type: "city",
};
const PARIS_ON: DestinationCandidate = {
  id: "9910",
  name: "Paris",
  countryCode: "CA",
  type: "city",
};

// ── Name folding ────────────────────────────────────────────────────────────

test("names fold to a comparable form", () => {
  assert.equal(normalizeName("Παρίσι"), "parisi");
  assert.equal(normalizeName("Αθήνα"), "athina");
  assert.equal(normalizeName("Málaga"), "malaga");
  assert.equal(normalizeName("Paris (CDG)"), "paris");
  assert.equal(normalizeName("New York City"), "new york");
  assert.equal(normalizeName("  ROME   Area "), "rome");
});

test("folding is stable across the forms a provider might return", () => {
  const forms = ["Athens", "ATHENS", "Athens (Greece)", "athens city"];
  const folded = new Set(forms.map(normalizeName));
  assert.equal(folded.size, 1, [...folded].join(" | "));
});

// ── Scoring ─────────────────────────────────────────────────────────────────

test("an IATA the provider itself lists is the strongest possible signal", () => {
  const m = scoreCandidate(PARIS_FR, { iata: "CDG", cityName: "Paris", countryCode: "FR" });
  assert.ok(m);
  assert.equal(m.confidence, 1);
  assert.match(m.reason, /provider lists CDG/);
});

test("a destination id that IS the IATA code scores just below an explicit list", () => {
  const hotelbedsStyle: DestinationCandidate = { id: "ATH", name: "Athens", countryCode: "GR" };
  const m = scoreCandidate(hotelbedsStyle, { iata: "ATH", countryCode: "GR" });
  assert.ok(m);
  assert.ok(m.confidence >= 0.95);
  assert.match(m.reason, /matches the IATA code ATH/);
});

test("a name-only match scores well below a code match", () => {
  const byName = scoreCandidate(
    { id: "1234", name: "Paris", countryCode: "FR" },
    { iata: "CDG", cityName: "Paris", countryCode: "FR" },
  );
  assert.ok(byName);
  assert.ok(byName.confidence < 0.95, String(byName.confidence));
  assert.ok(byName.confidence >= MIN_CONFIDENCE);
});

test("a candidate with nothing in common scores nothing at all", () => {
  assert.equal(
    scoreCandidate({ id: "x", name: "Reykjavik" }, { iata: "CDG", cityName: "Paris" }),
    null,
  );
});

test("a country mismatch is punished hard", () => {
  const right = scoreCandidate(PARIS_FR, { iata: "CDG", cityName: "Paris", countryCode: "FR" })!;
  const wrong = scoreCandidate(PARIS_TX, { iata: "CDG", cityName: "Paris", countryCode: "FR" })!;
  assert.ok(wrong.confidence < right.confidence / 2 + 0.01, `${wrong.confidence} vs ${right.confidence}`);
  assert.match(wrong.reason, /DIFFERENT country/);
});

// ── The Paris, Texas problem ────────────────────────────────────────────────

test("PARIS PROBLEM: the right Paris wins when the provider lists the airport", () => {
  const r = pickBestDestination([PARIS_TX, PARIS_ON, PARIS_FR], {
    iata: "CDG",
    cityName: "Paris",
    countryCode: "FR",
  });
  assert.ok(r.match, "should resolve");
  assert.equal(r.match.candidate.id, "PAR");
  assert.equal(r.match.candidate.countryCode, "FR");
});

test("PARIS PROBLEM: with no country and no codes, it REFUSES rather than guessing", () => {
  // Three identically-named cities, nothing to tell them apart. Picking one
  // would send a hotel search to the wrong continent and look plausible.
  const r = pickBestDestination([PARIS_TX, PARIS_ON, { id: "7", name: "Paris" }], {
    iata: "ZZZ",
    cityName: "Paris",
  });
  assert.equal(r.match, null);
  assert.equal(r.problem, "ambiguous");
  assert.ok(r.alternatives.length >= 2, "it should still show ops what it was torn between");
});

test("a lone wrong-country match falls under the threshold instead of being used", () => {
  const r = pickBestDestination([PARIS_TX], { iata: "CDG", cityName: "Paris", countryCode: "FR" });
  assert.equal(r.match, null);
  assert.equal(r.problem, "below_threshold");
});

test("an empty feed is reported as such, not as ambiguity", () => {
  const r = pickBestDestination([], { iata: "CDG", cityName: "Paris" });
  assert.equal(r.match, null);
  assert.equal(r.problem, "no_candidates");
});

test("a decisive code match is not blocked by a close-scoring neighbour", () => {
  // Two candidates both listing CDG (a city and its airport entry). Both score
  // 1.0, so the margin rule would call it ambiguous — but a code match is
  // decisive and must still resolve.
  const r = pickBestDestination(
    [PARIS_FR, { id: "CDG-APT", name: "Paris Charles de Gaulle", iataCodes: ["CDG"], type: "airport" }],
    { iata: "CDG", cityName: "Paris" },
  );
  assert.ok(r.match, "a decisive match must not be blocked by a tie");
  assert.ok(["PAR", "CDG-APT"].includes(r.match.candidate.id));
});

test("the same place listed twice is not treated as an ambiguity", () => {
  const dup = { id: "PAR", name: "Paris", countryCode: "FR", type: "city" as const };
  const r = pickBestDestination([dup, { ...dup }], { iata: "ZZZ", cityName: "Paris", countryCode: "FR" });
  assert.ok(r.match);
  assert.equal(r.match.candidate.id, "PAR");
});

// ── Type preference ─────────────────────────────────────────────────────────

test("a city is preferred over a broad region with the same name", () => {
  const city: DestinationCandidate = { id: "c", name: "Crete", countryCode: "GR", type: "city" };
  const region: DestinationCandidate = { id: "r", name: "Crete", countryCode: "GR", type: "region" };
  const r = pickBestDestination([region, city], { iata: "HER", cityName: "Crete", countryCode: "GR" });
  assert.ok(r.match);
  assert.equal(r.match.candidate.id, "c");
});

// ── Keys ────────────────────────────────────────────────────────────────────

test("cache keys are per connector — the same IATA differs at every provider", () => {
  assert.equal(mappingKey("hotelbeds", "cdg"), "hotelbeds:CDG");
  assert.notEqual(mappingKey("hotelbeds", "CDG"), mappingKey("viator", "CDG"));
});

test("the ambiguity margin is tight enough to be meaningful", () => {
  assert.ok(AMBIGUITY_MARGIN > 0 && AMBIGUITY_MARGIN < 0.2);
});
