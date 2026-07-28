/**
 * Airline logo resolution.
 *
 * Deals sourced from the flight providers carry an `airlineLogo` URL
 * (searchapi.io / SerpApi return Google's gstatic logo for the marketing
 * carrier). Admin-curated and seeded deals do not — `lowFareRadarSeed` never
 * writes the field — so those rows would render a blank corner.
 *
 * We fill the gap client-side from data the deal already has: the IATA carrier
 * code prefix on the flight number, falling back to a name lookup. Both resolve
 * to the same gstatic URL shape the providers hand us, so a derived logo is
 * pixel-identical to a stored one.
 */

const GSTATIC_LOGO = "https://www.gstatic.com/flights/airline_logos/70px";

/**
 * Airline display name → IATA code. Only carriers that realistically show up in
 * the radar. Written as natural names — keys are run through `normalizeName` at
 * module load, so entries that collapse onto each other ("Qatar Airways" and
 * "Qatar") are harmless as long as they agree on the code.
 */
const NAME_TO_IATA: Record<string, string> = {
  // Greece / home market
  aegean: "A3",
  olympic: "OA",
  "olympic air": "OA",
  "sky express": "GQ",
  skyexpress: "GQ",
  // European low-cost
  ryanair: "FR",
  "ryanair uk": "FR",
  "malta air": "FR",
  buzz: "FR",
  lauda: "FR",
  "lauda europe": "FR",
  "wizz air": "W6",
  wizz: "W6",
  "wizz air malta": "W6",
  easyjet: "U2",
  "easyjet europe": "U2",
  "easyjet switzerland": "U2",
  volotea: "V7",
  vueling: "VY",
  transavia: "HV",
  "transavia france": "TO",
  jet2: "LS",
  "jet2com": "LS",
  smartwings: "QS",
  play: "OG",
  norwegian: "DY",
  "norwegian air shuttle": "DY",
  // European legacy
  lufthansa: "LH",
  swiss: "LX",
  "swiss international": "LX",
  austrian: "OS",
  eurowings: "EW",
  condor: "DE",
  "discover airlines": "4Y",
  "ita airways": "AZ",
  ita: "AZ",
  "air france": "AF",
  klm: "KL",
  "klm royal dutch": "KL",
  "british airways": "BA",
  iberia: "IB",
  "iberia express": "I2",
  "air europa": "UX",
  "tap air portugal": "TP",
  tap: "TP",
  "brussels airlines": "SN",
  "aer lingus": "EI",
  finnair: "AY",
  sas: "SK",
  scandinavian: "SK",
  "scandinavian airlines system": "SK",
  "air serbia": "JU",
  lot: "LO",
  "lot polish": "LO",
  "polish airlines": "LO",
  "czech airlines": "OK",
  "air baltic": "BT",
  airbaltic: "BT",
  "croatia airlines": "OU",
  "cyprus airways": "CY",
  "km malta": "KM",
  "km malta airlines": "KM",
  "air malta": "KM",
  // Turkey / Middle East / Africa
  turkish: "TK",
  "turkish airlines": "TK",
  pegasus: "PC",
  "pegasus airlines": "PC",
  emirates: "EK",
  "qatar airways": "QR",
  qatar: "QR",
  etihad: "EY",
  "etihad airways": "EY",
  flydubai: "FZ",
  "saudi arabian": "SV",
  saudia: "SV",
  "royal jordanian": "RJ",
  "middle east": "ME",
  egyptair: "MS",
  "royal air maroc": "AT",
  tunisair: "TU",
  "el al": "LY",
  israir: "6H",
  // North America
  delta: "DL",
  "delta air": "DL",
  united: "UA",
  american: "AA",
  "air canada": "AC",
  jetblue: "B6",
  "air transat": "TS",
  westjet: "WS",
};

/** Strip the noise that separates "Aegean" from "Aegean Airlines". */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'’&]/g, "")
    .replace(/\b(airlines?|air lines|airways|company|group|co|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lookup table keyed the same way inbound airline names are normalized. */
const NORMALIZED_NAME_TO_IATA: Record<string, string> = Object.fromEntries(
  Object.entries(NAME_TO_IATA).map(([name, iata]) => [normalizeName(name), iata])
);

/**
 * Pull the IATA carrier code off a flight number ("GQ 770" → "GQ").
 * IATA codes are two characters and may contain a digit ("U2", "3U", "W6"),
 * so we only accept a two-character prefix followed by the numeric part.
 */
export function iataFromFlightNumber(flightNumber?: string): string | null {
  if (!flightNumber) return null;
  const match = flightNumber.trim().toUpperCase().match(/^([A-Z0-9]{2})\s*\d{1,4}\b/);
  if (!match) return null;
  const code = match[1];
  // A purely numeric prefix is part of the number, not a carrier code.
  if (/^\d{2}$/.test(code)) return null;
  return code;
}

/** Resolve an airline display name to its IATA code, if we know it. */
export function iataFromAirlineName(airline?: string): string | null {
  if (!airline) return null;
  const normalized = normalizeName(airline);
  if (!normalized) return null;
  if (NORMALIZED_NAME_TO_IATA[normalized]) return NORMALIZED_NAME_TO_IATA[normalized];
  // "Aegean Airlines SA" and friends — match the longest known prefix.
  const hit = Object.keys(NORMALIZED_NAME_TO_IATA)
    .filter((key) => normalized.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? NORMALIZED_NAME_TO_IATA[hit] : null;
}

export function logoUrlForIata(iata: string): string {
  return `${GSTATIC_LOGO}/${iata.toUpperCase()}.png`;
}

/**
 * Best available logo URL for a deal, or null when the carrier is unknown to us
 * (callers should fall back to an initial chip rather than an empty box).
 */
export function resolveAirlineLogo(deal: {
  airlineLogo?: string;
  flightNumber?: string;
  airline?: string;
}): string | null {
  if (deal.airlineLogo) return deal.airlineLogo;
  const iata = iataFromFlightNumber(deal.flightNumber) ?? iataFromAirlineName(deal.airline);
  return iata ? logoUrlForIata(iata) : null;
}
