/**
 * Utility functions for the shareable trip card feature.
 * Handles trip ID generation, date formatting, and destination codes.
 */

// Common destination → 3-letter code mapping
const DESTINATION_CODES: Record<string, string> = {
  "amsterdam": "AMS", "athens": "ATH", "bali": "DPS", "bangkok": "BKK",
  "barcelona": "BCN", "berlin": "BER", "budapest": "BUD", "cairo": "CAI",
  "cancun": "CUN", "cape town": "CPT", "chicago": "CHI", "copenhagen": "CPH",
  "crete": "HER", "dubai": "DXB", "dublin": "DUB", "edinburgh": "EDI",
  "florence": "FLR", "hanoi": "HAN", "helsinki": "HEL", "hong kong": "HKG",
  "istanbul": "IST", "kuala lumpur": "KUL", "kyoto": "KIX", "lisbon": "LIS",
  "london": "LON", "los angeles": "LAX", "madrid": "MAD", "marrakech": "RAK",
  "melbourne": "MEL", "mexico city": "MEX", "miami": "MIA", "milan": "MIL",
  "montreal": "YUL", "moscow": "MOW", "munich": "MUC", "mykonos": "JMK",
  "nairobi": "NBO", "new york": "NYC", "nice": "NCE", "osaka": "OSA",
  "paris": "PAR", "prague": "PRG", "reykjavik": "REK", "rio de janeiro": "GIG",
  "rome": "ROM", "san francisco": "SFO", "santorini": "JTR", "seoul": "SEL",
  "shanghai": "PVG", "singapore": "SIN", "stockholm": "STO", "sydney": "SYD",
  "taipei": "TPE", "tel aviv": "TLV", "tokyo": "TYO", "toronto": "YYZ",
  "vancouver": "YVR", "venice": "VCE", "vienna": "VIE", "zurich": "ZRH",
};

/**
 * Generate a 3-letter destination code from a destination name.
 * Uses a known mapping or falls back to the first 3 letters (uppercased).
 */
export function getDestinationCode(destination: string): string {
  const lower = destination.toLowerCase().trim();
  // Check exact match first
  if (DESTINATION_CODES[lower]) return DESTINATION_CODES[lower];
  // Check if destination contains a known city (e.g. "Barcelona, Spain")
  for (const [city, code] of Object.entries(DESTINATION_CODES)) {
    if (lower.includes(city)) return code;
  }
  // Fallback: first 3 uppercase letters (skip non-alpha)
  const letters = destination.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return letters.slice(0, 3) || "PLN";
}

/**
 * Generate a unique trip card ID: PLN-{DEST}-{YEAR}-{HASH}
 */
export function generateTripCardId(destination: string, startDate: number): string {
  const code = getDestinationCode(destination);
  const year = new Date(startDate).getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let hash = "";
  for (let i = 0; i < 4; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `PLN-${code}-${year}-${hash}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format trip dates for the share card.
 * - Same month: "Jun 12 – 16, 2026"
 * - Different months: "Jun 28 – Jul 3, 2026"
 * - Different years: "Dec 28, 2026 – Jan 3, 2027"
 */
export function formatShareDates(startDate: number, endDate: number): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const sMonth = MONTH_NAMES[start.getMonth()];
  const eMonth = MONTH_NAMES[end.getMonth()];
  const sDay = start.getDate();
  const eDay = end.getDate();
  const sYear = start.getFullYear();
  const eYear = end.getFullYear();

  if (sYear !== eYear) {
    return `${sMonth} ${sDay}, ${sYear} – ${eMonth} ${eDay}, ${eYear}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${sMonth} ${sDay} – ${eDay}, ${sYear}`;
  }
  return `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${sYear}`;
}

/**
 * Format budget display: "€45 / day"
 */
export function formatBudget(perDayAmount: number, currencySymbol: string): string {
  return `${currencySymbol}${Math.round(perDayAmount)} / day`;
}

/**
 * Calculate trip duration in days (inclusive).
 */
export function getTripDurationDays(startDate: number, endDate: number): number {
  const ms = endDate - startDate;
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Derive travel style from traveler count.
 */
export function getTravelStyle(travelerCount: number | undefined): string {
  const count = travelerCount ?? 1;
  if (count <= 1) return "SOLO";
  if (count === 2) return "COUPLE";
  return "GROUP";
}

/**
 * Format interests for the tag pill (max 2, joined with " + ").
 */
export function formatInterestsTag(interests: string[]): string {
  if (!interests || interests.length === 0) return "ADVENTURE";
  return interests.slice(0, 2).map(i => i.toUpperCase()).join(" + ");
}

/**
 * Check if destination name is long enough to need a smaller font.
 * Returns true if the name is likely to overflow at 110px font.
 */
export function needsSmallerFont(destination: string): boolean {
  // Rough heuristic: at 110px serif font on 1080px canvas with 60px margins each side,
  // approximately 12-13 characters fit. Be conservative.
  return destination.length > 12;
}
