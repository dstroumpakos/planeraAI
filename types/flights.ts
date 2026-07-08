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
  bags?: number;
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
