/**
 * searchapi.io accommodation search + normalization.
 *
 * Two engines are used:
 *   - `google_hotels` → hotels & resorts
 *   - `airbnb`        → short-term rentals
 *
 * All network calls happen server-side (Convex actions). The API key never
 * crosses the frontend boundary and is never logged. Both engines are
 * normalized into a single `Accommodation` shape so the UI stays decoupled
 * from searchapi.io's raw response.
 *
 * Failure philosophy: this is an enrichment step inside trip generation, NOT
 * a critical path. Any error (missing key, network, HTTP, empty results,
 * malformed JSON) resolves to an empty array so the caller can fall back to
 * AI/fallback hotels without blowing up generation.
 */

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

// searchapi.io limits per engine.
const AIRBNB_MAX_ADULTS = 16;
const HOTEL_MAX_ADULTS = 6;

// How many of each we keep in the itinerary payload.
const MAX_HOTELS = 8;
const MAX_AIRBNBS = 6;

// How many images we keep per listing (primary + a few for the gallery).
const MAX_IMAGES_PER_LISTING = 5;

export interface Accommodation {
  type: "hotel" | "airbnb";
  name: string;
  /** Primary listing photo (real photo from the supplier CDN). */
  image?: string;
  /** Up to MAX_IMAGES_PER_LISTING photos for the gallery/carousel. */
  images: string[];
  rating?: number;
  reviews?: number;
  /** Star class (hotels only). */
  stars?: number;
  /** Numeric nightly price used for the trip cost summary. */
  pricePerNight: number;
  totalPrice?: number;
  /** Pre-discount price, when the supplier advertises a discount. */
  originalPrice?: number;
  currency: string;
  /** Listing page (Airbnb room / hotel website). */
  link?: string;
  /** Deep link that pre-fills dates & guests (Airbnb). */
  bookingLink?: string;
  description?: string;
  amenities: string[];
  /** e.g. "Superhost", "Guest favorite", "Deal". */
  badges: string[];
  freeCancellation?: boolean;
  gpsCoordinates?: { latitude: number; longitude: number };
  /** e.g. "19% less than usual". */
  dealLabel?: string;
}

function getSearchApiKey(): string | null {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return null;
  }
  return key.trim();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

async function callSearchApi(
  params: URLSearchParams,
  key: string
): Promise<any | null> {
  params.append("api_key", key);
  let res: Response;
  try {
    res = await fetch(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    console.error("[searchapi] Network error");
    return null;
  }

  if (!res.ok) {
    console.error(`[searchapi] HTTP ${res.status}`);
    return null;
  }

  try {
    const json = await res.json();
    if (json?.error) {
      console.error("[searchapi] API error:", String(json.error));
      return null;
    }
    return json;
  } catch {
    console.error("[searchapi] Invalid JSON response");
    return null;
  }
}

function normalizeHotel(raw: any, currency: string): Accommodation | null {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!name) return null;

  const images: string[] = Array.isArray(raw.images)
    ? raw.images
        .map((img: any) =>
          typeof img === "string" ? img : img?.original || img?.thumbnail
        )
        .filter((u: any): u is string => typeof u === "string")
        .slice(0, MAX_IMAGES_PER_LISTING)
    : [];

  const pricePerNight = toNumber(raw.price_per_night?.extracted_price) ?? 0;

  return {
    type: "hotel",
    name,
    image: images[0],
    images,
    rating: toNumber(raw.rating),
    reviews: toNumber(raw.reviews),
    stars: toNumber(raw.extracted_hotel_class),
    pricePerNight: pricePerNight || 0,
    totalPrice: toNumber(raw.total_price?.extracted_price),
    originalPrice: undefined,
    currency,
    link: typeof raw.link === "string" ? raw.link : undefined,
    bookingLink: undefined,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    amenities: Array.isArray(raw.amenities)
      ? raw.amenities.filter((a: any) => typeof a === "string").slice(0, 6)
      : [],
    badges: typeof raw.deal_description === "string" ? [raw.deal_description] : [],
    freeCancellation: undefined,
    gpsCoordinates:
      raw.gps_coordinates &&
      typeof raw.gps_coordinates.latitude === "number" &&
      typeof raw.gps_coordinates.longitude === "number"
        ? {
            latitude: raw.gps_coordinates.latitude,
            longitude: raw.gps_coordinates.longitude,
          }
        : undefined,
    dealLabel: typeof raw.deal === "string" ? raw.deal : undefined,
  };
}

function normalizeAirbnb(
  raw: any,
  currency: string,
  nights: number
): Accommodation | null {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.title === "string" ? raw.title : "";
  if (!name) return null;

  const images: string[] = Array.isArray(raw.images)
    ? raw.images
        .filter((u: any): u is string => typeof u === "string")
        .slice(0, MAX_IMAGES_PER_LISTING)
    : [];

  const total = toNumber(raw.price?.extracted_total_price);
  let pricePerNight = toNumber(raw.price?.extracted_price_per_qualifier);
  if (pricePerNight === undefined && total !== undefined && nights > 0) {
    pricePerNight = Math.round(total / nights);
  }

  return {
    type: "airbnb",
    name,
    image: images[0],
    images,
    rating: toNumber(raw.rating),
    reviews: toNumber(raw.reviews),
    stars: undefined,
    pricePerNight: pricePerNight || 0,
    totalPrice: total,
    originalPrice: toNumber(raw.price?.extracted_original_price),
    currency,
    link: typeof raw.link === "string" ? raw.link : undefined,
    bookingLink:
      typeof raw.booking_link === "string" ? raw.booking_link : undefined,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    amenities: Array.isArray(raw.accommodations)
      ? raw.accommodations.filter((a: any) => typeof a === "string").slice(0, 6)
      : [],
    badges: Array.isArray(raw.badges)
      ? raw.badges.filter((b: any) => typeof b === "string")
      : [],
    freeCancellation: undefined,
    gpsCoordinates:
      raw.gps_coordinates &&
      typeof raw.gps_coordinates.latitude === "number" &&
      typeof raw.gps_coordinates.longitude === "number"
        ? {
            latitude: raw.gps_coordinates.latitude,
            longitude: raw.gps_coordinates.longitude,
          }
        : undefined,
    dealLabel: undefined,
  };
}

export interface AccommodationSearchInput {
  destination: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  adults: number;
  currency?: string;
  nights: number;
}

export async function searchHotels(
  input: AccommodationSearchInput
): Promise<Accommodation[]> {
  const key = getSearchApiKey();
  if (!key || !input.destination) return [];
  const currency = (input.currency || "EUR").toUpperCase();

  const params = new URLSearchParams();
  params.append("engine", "google_hotels");
  params.append("q", input.destination);
  params.append("check_in_date", input.checkInDate);
  params.append("check_out_date", input.checkOutDate);
  params.append("adults", String(Math.min(Math.max(input.adults, 1), HOTEL_MAX_ADULTS)));
  params.append("currency", currency);
  params.append("sort_by", "relevance");

  const json = await callSearchApi(params, key);
  const properties = Array.isArray(json?.properties) ? json.properties : [];
  return properties
    .map((p: any) => normalizeHotel(p, currency))
    .filter((h: Accommodation | null): h is Accommodation => h !== null && h.pricePerNight > 0)
    .slice(0, MAX_HOTELS);
}

export async function searchAirbnb(
  input: AccommodationSearchInput
): Promise<Accommodation[]> {
  const key = getSearchApiKey();
  if (!key || !input.destination) return [];
  const currency = (input.currency || "EUR").toUpperCase();

  const params = new URLSearchParams();
  params.append("engine", "airbnb");
  params.append("q", input.destination);
  params.append("check_in_date", input.checkInDate);
  params.append("check_out_date", input.checkOutDate);
  params.append("adults", String(Math.min(Math.max(input.adults, 1), AIRBNB_MAX_ADULTS)));
  params.append("currency", currency);

  const json = await callSearchApi(params, key);
  const properties = Array.isArray(json?.properties) ? json.properties : [];
  return properties
    .map((p: any) => normalizeAirbnb(p, currency, input.nights))
    .filter((a: Accommodation | null): a is Accommodation => a !== null && a.pricePerNight > 0)
    .slice(0, MAX_AIRBNBS);
}

/**
 * Fetch hotels + Airbnb listings in parallel and merge them. Returns an empty
 * array if both engines come back empty (caller should fall back to AI hotels).
 */
export async function fetchAccommodations(
  input: AccommodationSearchInput
): Promise<Accommodation[]> {
  const [hotels, airbnbs] = await Promise.all([
    searchHotels(input).catch(() => [] as Accommodation[]),
    searchAirbnb(input).catch(() => [] as Accommodation[]),
  ]);
  return [...hotels, ...airbnbs];
}

export function isSearchApiConfigured(): boolean {
  return getSearchApiKey() !== null;
}
