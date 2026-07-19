/**
 * Shared types for SerpApi Google Flights integration.
 *
 * These types are used by both the Convex backend (search/booking actions,
 * normalization helpers) and the React Native frontend (hooks, screens,
 * components). Keep this file free of runtime dependencies so it can be
 * imported from either side.
 */

// ----------------------------- Input types ----------------------------------

export type FlightTripType = "one_way" | "round_trip";

export type TravelClass = "economy" | "premium_economy" | "business" | "first";

export type StopsFilter =
  | "any"
  | "nonstop"
  | "one_stop_or_fewer"
  | "two_stops_or_fewer";

export type SortBy =
  | "top"
  | "price"
  | "departure_time"
  | "arrival_time"
  | "duration"
  | "emissions";

export interface FlightSearchInput {
  departureId: string;
  arrivalId: string;
  outboundDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, required when type === "round_trip"
  type?: FlightTripType;
  currency?: string; // ISO 4217, defaults to EUR
  adults?: number;
  children?: number;
  infantsInSeat?: number;
  infantsOnLap?: number;
  travelClass?: TravelClass;
  stops?: StopsFilter;
  sortBy?: SortBy;
  /**
   * Legacy single bag count — historically meant carry-on bags. Kept for
   * back-compat; `carryOnBags` takes precedence when both are set.
   */
  bags?: number;
  carryOnBags?: number;
  checkedBags?: number;
  /** Surface the cheapest flights instead of Google's "best" ranking. */
  showCheapestFlights?: boolean;
  /** Include flights Google hides by default (e.g. long layovers). */
  showHiddenFlights?: boolean;
  /**
   * Hide separate / self-transfer tickets. searchapi maps this to
   * `separate_tickets=1` (hide) vs `0` (show, the default).
   */
  hideSeparateTickets?: boolean;
  maxPrice?: number;
  maxDuration?: number; // minutes
  outboundTimes?: string; // SerpApi `outbound_times` format (e.g. "4,18")
  returnTimes?: string;
  deepSearch?: boolean;
  noCache?: boolean;
  // Round-trip leg 2: pass the departure_token of a selected outbound option
  // to fetch its return-flight options (each carrying a booking_token).
  departureToken?: string;
}

export interface FlightBookingOptionsInput {
  bookingToken: string;
  currency?: string;
  hl?: string;
  gl?: string;
  // SerpApi's booking_options endpoint requires the full route + dates
  // alongside the booking_token, otherwise it errors. Thread them through.
  departureId?: string;
  arrivalId?: string;
  outboundDate?: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD (round trip)
  adults?: number;
}

// --------------------------- Normalized output ------------------------------

export type DealScore = "strong_deal" | "normal" | "expensive" | "unknown";

export type PriceLevel = "low" | "typical" | "high" | string;

export interface PriceInsights {
  lowestPrice?: number | null;
  priceLevel?: PriceLevel | null;
  typicalPriceRange?: number[];
  priceHistory?: [number, number][];
}

export interface NormalizedAirport {
  airport: {
    id: string | null;
    name: string | null;
  };
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
  image?: string | null;
  thumbnail?: string | null;
}

export interface NormalizedAirportGroup {
  departure: NormalizedAirport[];
  arrival: NormalizedAirport[];
}

export interface NormalizedCarbonEmissions {
  thisFlight?: number;
  typicalForRoute?: number;
  differencePercent?: number;
}

export interface NormalizedLayover {
  id?: string | null;
  name?: string | null;
  durationMinutes?: number | null;
  overnight?: boolean;
}

export interface NormalizedFlightSegment {
  airline: string | null;
  airlineLogo?: string | null;
  flightNumber: string | null;
  airplane?: string | null;
  travelClass?: string | null;
  durationMinutes?: number | null;
  legroom?: string | null;
  overnight?: boolean;
  oftenDelayedByOver30Min?: boolean;
  planeAndCrewBy?: string | null;
  ticketAlsoSoldBy?: string[];
  departureAirport: {
    id: string | null;
    name: string | null;
    time: string | null;
  };
  arrivalAirport: {
    id: string | null;
    name: string | null;
    time: string | null;
  };
  extensions?: string[];
}

export interface NormalizedFlightOption {
  id: string;
  source: "best_flights" | "other_flights";
  price: number | null;
  type: string | null;
  totalDurationMinutes: number | null;
  airlineLogo?: string | null;
  departureToken?: string | null;
  bookingToken?: string | null;
  flights: NormalizedFlightSegment[];
  layovers: NormalizedLayover[];
  carbonEmissions?: NormalizedCarbonEmissions | null;
  extensions?: string[];
  dealScore?: DealScore;
}

export interface NormalizedFlightSearchResponse {
  searchId: string | null;
  status: string;
  searchParameters: Record<string, any>;
  bestFlights: NormalizedFlightOption[];
  otherFlights: NormalizedFlightOption[];
  priceInsights?: PriceInsights | null;
  airports?: NormalizedAirportGroup[];
}

// ----------------------------- Booking options ------------------------------

export interface NormalizedBookingOption {
  id: string;
  bookWith: string | null;
  airline?: boolean;
  airlineLogos?: string[];
  marketedAs?: string[];
  price?: number | null;
  localPrices?: {
    currency: string;
    price: number;
  }[];
  optionTitle?: string | null;
  extensions?: string[];
  baggagePrices?: string[];
  bookingRequest?: {
    url?: string | null;
    postData?: string | null;
  };
}

export interface NormalizedBookingOptionsResponse {
  selectedFlights: NormalizedFlightOption[];
  baggagePrices?: any;
  bookingOptions: NormalizedBookingOption[];
  priceInsights?: PriceInsights | null;
}

// ----------------------------- Low-fare radar -------------------------------

export interface LowFareRadarInput {
  homeAirport: string;
  destinationAirports: string[];
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  selectedDates?: string[];
  currency?: string;
  maxPrice?: number;
  adults?: number;
}

export interface LowFareRadarDeal {
  destinationAirport: string;
  cheapestPrice: number | null;
  bestOption: NormalizedFlightOption | null;
  priceLevel?: string;
  typicalPriceRange?: number[];
  dealQuality: DealScore;
}

// ----------------------------- Travel Explore -------------------------------
// "Where can I go?" destination discovery via searchapi.io
// `google_travel_explore`. Prices are indicative discovery signals, NOT
// bookable fares.

export type ExploreTravelMode = "all" | "flights_only";

export type ExploreInterest =
  | "popular"
  | "outdoors"
  | "beaches"
  | "museums"
  | "history"
  | "skiing";

export interface ExploreQuery {
  departureId: string; // IATA, e.g. "ATH"
  currency?: string; // ISO 4217, defaults to EUR
  hl?: string; // UI language, defaults to "en"
  gl?: string; // country code for localization
  travelMode?: ExploreTravelMode;
  interests?: ExploreInterest;
  stops?: StopsFilter;
  maxPrice?: number;
  adults?: number;
  // searchapi.io `time_period` (e.g. "one_week_trip_in_the_next_six_months"
  // or a "YYYY-MM-DD..YYYY-MM-DD" custom range). Defaults to the engine default.
  timePeriod?: string;
}

export interface ExploreDestination {
  name: string;
  country?: string;
  kgmid?: string;
  iata?: string;
  coordinates?: { lat: number; lng: number };
  /** Indicative round-trip flight price (discovery signal, not bookable). */
  price?: number;
  stops?: number;
  airline?: string;
  flightDuration?: string;
  avgHotelPerNight?: number;
  outboundDate?: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  /** Engine-provided image, used only as a fallback for the Unsplash lookup. */
  thumbnail?: string;
}

// ----------------- Travel Explore — single-destination drill-down -----------
// searchapi.io `google_travel_explore_destination`: given an origin AND one
// destination, returns indicative flight options to that destination. Powers
// the "Flights from your city, from €X" module on a destination preview page.
// Requires a known origin — only meaningful for a logged-in user whose home
// airport we can resolve. Prices are indicative teasers, NOT bookable fares:
// the "See flights" CTA must re-run the real `google_flights` search to obtain
// a provider-locked, bookable `booking_token`.

export interface ExploreDestinationFlightsQuery {
  departureId: string; // origin IATA (the viewer's resolved home airport)
  arrivalId: string; // destination IATA or /m/ location id
  currency?: string; // ISO 4217, defaults to EUR
  hl?: string; // UI language, defaults to "en"
  travelClass?: TravelClass;
  stops?: StopsFilter;
  maxPrice?: number;
  adults?: number;
  // searchapi.io `time_period` (e.g. "one_week_trip_in_the_next_six_months"
  // or a "YYYY-MM-DD..YYYY-MM-DD" range). Defaults to the engine default.
  timePeriod?: string;
}

export interface ExploreDestinationFlight {
  /** Indicative price (discovery signal, not bookable). */
  price?: number;
  airline?: string;
  stops?: number;
  departureAirport?: string; // IATA
  arrivalAirport?: string; // IATA
  outboundDate?: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  flightDuration?: string;
}

export interface ExploreDestinationFlights {
  arrivalId: string;
  departureId: string;
  currency: string;
  /** Cheapest indicative price across the returned options, if any. */
  cheapestPrice?: number;
  flights: ExploreDestinationFlight[];
}

// ----------------- Flexible-date price calendar ("cheapest days") -----------
// searchapi.io `google_flights_calendar`: cheapest ROUND-TRIP fare per
// departure date over a rolling window. Used for the "cheapest days to fly"
// strip on the destination preview. Round-trip keeps prices consistent with the
// explore-destination teaser, but the 200-combination cap limits the window to
// ~2 weeks of departures. Each returned date keeps the return that produced its
// cheapest fare, so a tap can prefill both legs of the search. Indicative fares.

export interface FlightCalendarQuery {
  departureId: string; // origin IATA (resolved home airport)
  arrivalId: string; // destination IATA
  currency?: string; // ISO 4217, defaults to EUR
}

export interface FlightCalendarReturn {
  date: string; // YYYY-MM-DD return date
  price: number; // indicative round-trip fare for this departure+return pair
}
export interface FlightCalendarDate {
  date: string; // YYYY-MM-DD departure date
  returnDate?: string; // YYYY-MM-DD return that gave this date's cheapest fare
  price: number; // indicative round-trip fare
  isLowest?: boolean; // engine flagged this as a lowest-price date
  /**
   * Every priced return for this departure, cheapest first. Only populated on
   * the PUBLIC path (`flightCalendarPublic`, opts.includeReturns), which is the
   * one that renders a two-leg picker; the mobile teaser strip shows a single
   * date and would only pay the payload cost for nothing.
   */
  returns?: FlightCalendarReturn[];
}

export interface FlightCalendar {
  departureId: string;
  arrivalId: string;
  currency: string;
  /** Cheapest, date-spread selection (soonest first) for the teaser strip. */
  dates: FlightCalendarDate[];
}
