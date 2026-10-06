/**
 * Christmas season — festive destinations + "is this deal worth buying" rules.
 *
 * Shared by the app (home Christmas row, Low-Fare Radar "Christmas" tab) and
 * Convex (`lowFareRadarSeed` season mode), so it must stay free of React
 * Native and Node-only imports.
 *
 * A deal is a Christmas deal purely by its DATES — no schema flag. Any radar
 * deal (curated, seeded or AUTO) whose outbound falls in the festive window
 * shows up under Christmas, and the UI works before any backend deploy.
 */

/** First festive departure (MM-DD). Markets are in full swing by mid-December. */
export const CHRISTMAS_DEPART_FROM = "12-12";
/** Last festive departure (MM-DD, next year) — still counts as a New Year trip. */
export const CHRISTMAS_DEPART_TO = "01-03";
/** Latest return we still call a holiday trip (MM-DD, next year). */
export const CHRISTMAS_RETURN_BY = "01-10";

/** Night count we price when a route has no paired return date. */
export const CHRISTMAS_TRIP_NIGHTS = 7;

/**
 * When the home screen starts/stops promoting Christmas (MM-DD). Holiday fares
 * are cheapest booked 2–3 months out, so the promo opens in mid-September and
 * closes once the last festive departures have gone.
 */
const PROMO_FROM = "09-15";
const PROMO_TO = "12-26";

export type ChristmasVibe = "markets" | "snow" | "city" | "sun";

export type ChristmasDestination = {
  /** IATA airport or metro code Google Flights accepts as `arrival_id`. */
  code: string;
  /** English city name — matches `lowFareRadar.destinationCity`. */
  city: string;
  country: string;
  vibe: ChristmasVibe;
};

/**
 * Ordered by how strongly the place sells "Christmas" — the seeder scans the
 * whole list, the home row shows it in this order.
 */
export const CHRISTMAS_DESTINATIONS: ChristmasDestination[] = [
  // ── Christmas markets ──
  { code: "VIE", city: "Vienna", country: "Austria", vibe: "markets" },
  { code: "PRG", city: "Prague", country: "Czechia", vibe: "markets" },
  { code: "SXB", city: "Strasbourg", country: "France", vibe: "markets" },
  { code: "NUE", city: "Nuremberg", country: "Germany", vibe: "markets" },
  { code: "BUD", city: "Budapest", country: "Hungary", vibe: "markets" },
  { code: "SZG", city: "Salzburg", country: "Austria", vibe: "markets" },
  { code: "MUC", city: "Munich", country: "Germany", vibe: "markets" },
  { code: "CGN", city: "Cologne", country: "Germany", vibe: "markets" },
  { code: "KRK", city: "Kraków", country: "Poland", vibe: "markets" },
  { code: "TLL", city: "Tallinn", country: "Estonia", vibe: "markets" },
  { code: "BRU", city: "Brussels", country: "Belgium", vibe: "markets" },
  { code: "CPH", city: "Copenhagen", country: "Denmark", vibe: "markets" },
  { code: "BSL", city: "Basel", country: "Switzerland", vibe: "markets" },
  { code: "EDI", city: "Edinburgh", country: "United Kingdom", vibe: "markets" },
  // ── Snow & Santa ──
  { code: "RVN", city: "Rovaniemi", country: "Finland", vibe: "snow" },
  { code: "TOS", city: "Tromsø", country: "Norway", vibe: "snow" },
  { code: "INN", city: "Innsbruck", country: "Austria", vibe: "snow" },
  // ── Big-city lights ──
  { code: "NYC", city: "New York", country: "United States", vibe: "city" },
  { code: "LON", city: "London", country: "United Kingdom", vibe: "city" },
  { code: "PAR", city: "Paris", country: "France", vibe: "city" },
  { code: "AMS", city: "Amsterdam", country: "Netherlands", vibe: "city" },
  { code: "BER", city: "Berlin", country: "Germany", vibe: "city" },
  // ── Winter sun ──
  { code: "TFS", city: "Tenerife", country: "Spain", vibe: "sun" },
  { code: "FNC", city: "Madeira", country: "Portugal", vibe: "sun" },
  { code: "DXB", city: "Dubai", country: "United Arab Emirates", vibe: "sun" },
];

export const CHRISTMAS_VIBE_EMOJI: Record<ChristmasVibe, string> = {
  markets: "🎄",
  snow: "❄️",
  city: "✨",
  sun: "☀️",
};

/** MM-DD of a YYYY-MM-DD string. */
function monthDay(date: string): string {
  return date.slice(5, 10);
}

/** True when a departure date falls in the festive window (any year). */
export function isChristmasDeparture(outboundDate?: string | null): boolean {
  if (!outboundDate || outboundDate.length < 10) return false;
  const md = monthDay(outboundDate);
  return md >= CHRISTMAS_DEPART_FROM || md <= CHRISTMAS_DEPART_TO;
}

/**
 * True for a festive trip: departs in the window and (when round-trip) is back
 * by early January — a Dec 20 → Feb 14 fare is not a Christmas holiday.
 */
export function isChristmasTrip(
  outboundDate?: string | null,
  returnDate?: string | null
): boolean {
  if (!isChristmasDeparture(outboundDate)) return false;
  if (!returnDate) return true;
  if (returnDate <= outboundDate!) return false;
  const md = monthDay(returnDate);
  // Returns in December are always fine; in January only up to RETURN_BY.
  return md >= CHRISTMAS_DEPART_FROM || md <= CHRISTMAS_RETURN_BY;
}

/**
 * The upcoming (or current) season's concrete dates, YYYY-MM-DD. Before
 * January's cutoff we're still in last December's season.
 */
export function christmasSeason(now: Date = new Date()): {
  departFrom: string;
  departTo: string;
  returnBy: string;
} {
  const y = now.getUTCFullYear();
  const today = now.toISOString().slice(5, 10);
  const startYear = today <= CHRISTMAS_RETURN_BY ? y - 1 : y;
  return {
    departFrom: `${startYear}-${CHRISTMAS_DEPART_FROM}`,
    departTo: `${startYear + 1}-${CHRISTMAS_DEPART_TO}`,
    returnBy: `${startYear + 1}-${CHRISTMAS_RETURN_BY}`,
  };
}

/** Whether the app should be promoting Christmas right now. */
export function isChristmasPromoActive(now: Date = new Date()): boolean {
  const md = now.toISOString().slice(5, 10);
  return md >= PROMO_FROM && md <= PROMO_TO;
}

type PricedDeal = {
  price: number;
  typicalPrice?: number | null;
  originalPrice?: number | null;
  dealTag?: string | null;
  isExpired?: boolean;
};

/**
 * The route's normal fare we compare against: Google's typical-price midpoint
 * captured by the refresh cron, else the seeder's "was" anchor.
 */
function benchmark(deal: PricedDeal): number | null {
  if (deal.typicalPrice && deal.typicalPrice > 0) return deal.typicalPrice;
  if (deal.originalPrice && deal.originalPrice > 0) return deal.originalPrice;
  return null;
}

/** Whole percent below the route's typical fare, or null when unknown / not below. */
export function percentBelowTypical(deal: PricedDeal): number | null {
  const b = benchmark(deal);
  if (!b || deal.price >= b) return null;
  const pct = Math.round(((b - deal.price) / b) * 100);
  return pct > 0 ? pct : null;
}

/**
 * "Worth buying" = a live fare that is demonstrably cheap for its route:
 * strictly below the route's typical price, or graded `low` by Google (the
 * seeder tags those "Great price"). Unknown benchmarks don't qualify — holiday
 * fares are high by default, so we only vouch for ones we can back up.
 */
export function isWorthBuying(deal: PricedDeal): boolean {
  if (deal.isExpired) return false;
  if (percentBelowTypical(deal) != null) return true;
  return deal.dealTag === "Great price";
}
