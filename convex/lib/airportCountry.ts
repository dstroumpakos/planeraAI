/**
 * IATA airport code → ISO-3166-1 alpha-2 country (lowercase).
 *
 * Used to decide which Low-Fare Radar deals are "local" to a newsletter
 * subscriber: a deal departing CDG maps to "fr", so a subscriber whose
 * captured country is "fr" sees it, while an Athens (ATH → "gr") deal is
 * shown to Greek subscribers. Unknown origins return undefined and fall back
 * to the global-cheapest behaviour, so this map never needs to be exhaustive —
 * it just needs the airports actually used as curated deal origins.
 */

const IATA_TO_COUNTRY: Record<string, string> = {
  // Greece
  ATH: "gr", SKG: "gr", HER: "gr", RHO: "gr", CFU: "gr", JTR: "gr",
  JMK: "gr", CHQ: "gr", KGS: "gr", ZTH: "gr", JSI: "gr", EFL: "gr",
  // France
  CDG: "fr", ORY: "fr", NCE: "fr", LYS: "fr", MRS: "fr", TLS: "fr",
  BOD: "fr", NTE: "fr", BVA: "fr", LIL: "fr", MPL: "fr", SXB: "fr",
  // Germany
  FRA: "de", MUC: "de", BER: "de", DUS: "de", HAM: "de", CGN: "de",
  STR: "de", NUE: "de", HAJ: "de", BRE: "de",
  // Spain
  MAD: "es", BCN: "es", AGP: "es", PMI: "es", VLC: "es", SVQ: "es",
  ALC: "es", IBZ: "es", BIO: "es", LPA: "es", TFS: "es", TFN: "es",
  // Italy
  FCO: "it", MXP: "it", LIN: "it", BGY: "it", VCE: "it", NAP: "it",
  BLQ: "it", CTA: "it", PMO: "it", TRN: "it", BRI: "it", CAG: "it",
  // United Kingdom
  LHR: "gb", LGW: "gb", STN: "gb", LTN: "gb", MAN: "gb", EDI: "gb",
  BHX: "gb", GLA: "gb", BRS: "gb", NCL: "gb", LPL: "gb", LCY: "gb",
  // Netherlands / Belgium / Luxembourg
  AMS: "nl", EIN: "nl", RTM: "nl", BRU: "be", CRL: "be", ANR: "be", LUX: "lu",
  // Portugal
  LIS: "pt", OPO: "pt", FAO: "pt", FNC: "pt",
  // Ireland
  DUB: "ie", ORK: "ie", SNN: "ie",
  // Switzerland / Austria
  ZRH: "ch", GVA: "ch", BSL: "ch", VIE: "at", SZG: "at", INN: "at",
  // Nordics
  CPH: "dk", BLL: "dk", ARN: "se", GOT: "se", NYO: "se", OSL: "no",
  BGO: "no", TRD: "no", HEL: "fi", TMP: "fi", KEF: "is",
  // Eastern Europe
  WAW: "pl", KRK: "pl", GDN: "pl", WRO: "pl", PRG: "cz", BUD: "hu",
  OTP: "ro", CLJ: "ro", SOF: "bg", ZAG: "hr", SPU: "hr", DBV: "hr",
  BEG: "rs", LJU: "si", VNO: "lt", RIX: "lv", TLL: "ee",
  // Turkey / Middle East
  IST: "tr", SAW: "tr", AYT: "tr", ADB: "tr", DXB: "ae", AUH: "ae",
  DOH: "qa", TLV: "il", CAI: "eg", AMM: "jo", RUH: "sa", JED: "sa",
  // North America
  JFK: "us", EWR: "us", LGA: "us", LAX: "us", SFO: "us", ORD: "us",
  MIA: "us", BOS: "us", ATL: "us", DFW: "us", SEA: "us", DEN: "us",
  IAD: "us", IAH: "us", LAS: "us", MCO: "us", PHX: "us", EWX: "us",
  YYZ: "ca", YUL: "ca", YVR: "ca", YYC: "ca",
  // Asia-Pacific
  NRT: "jp", HND: "jp", KIX: "jp", ICN: "kr", PEK: "cn", PVG: "cn",
  HKG: "hk", SIN: "sg", BKK: "th", DMK: "th", KUL: "my", CGK: "id",
  DEL: "in", BOM: "in", SYD: "au", MEL: "au", BNE: "au", AKL: "nz",
  // Latin America / Africa
  GRU: "br", GIG: "br", EZE: "ar", SCL: "cl", BOG: "co", LIM: "pe",
  MEX: "mx", CUN: "mx", JNB: "za", CPT: "za", CMN: "ma", RAK: "ma",
};

/** ISO-2 (lowercase) country for an IATA code, or undefined if unmapped. */
export function iataToCountry(iata: string | undefined | null): string | undefined {
  if (!iata) return undefined;
  return IATA_TO_COUNTRY[iata.trim().toUpperCase()];
}
