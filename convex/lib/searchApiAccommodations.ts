/**
 * searchapi.io accommodation search + normalization.
 *
 * Three engines are used:
 *   - `google_hotels` → hotels & resorts
 *   - `booking`       → Booking.com properties (dated deep links)
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
const BOOKING_MAX_ADULTS = 30;

// How many of each we keep in the itinerary payload.
const MAX_HOTELS = 8;
const MAX_BOOKING = 6;
const MAX_AIRBNBS = 6;

// How many images we keep per listing (primary + a few for the gallery).
const MAX_IMAGES_PER_LISTING = 5;

export interface Accommodation {
  type: "hotel" | "airbnb";
  /** Supplier the listing came from. Absent on older trips (infer from `type`). */
  provider?: "google_hotels" | "booking" | "airbnb";
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
  /** Listing page (Airbnb room / hotel website / Booking.com property). */
  link?: string;
  /** Deep link that pre-fills dates & guests (Airbnb, Booking.com). */
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
    provider: "google_hotels",
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
    provider: "airbnb",
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

/**
 * Booking.com property page with the stay pre-filled. searchapi returns a bare
 * `/hotel/{cc}/{slug}.html` URL, which opens without dates; Booking honours
 * these query params (and keeps them through its locale redirect).
 */
export function buildBookingDatedLink(
  link: string,
  stay: { checkInDate: string; checkOutDate: string; adults: number; currency: string }
): string {
  const params = new URLSearchParams({
    checkin: stay.checkInDate,
    checkout: stay.checkOutDate,
    group_adults: String(stay.adults),
    group_children: "0",
    no_rooms: "1",
    selected_currency: stay.currency,
  });
  return `${link}${link.includes("?") ? "&" : "?"}${params.toString()}`;
}

// searchapi only returns Booking's square thumbnails; the same image id also
// serves a landscape rendition that fits our card photos.
function bookingLandscapeImage(url: string): string {
  return url.replace(/\/square\d+\//, "/max1024x768/").replace(/\.webp(\?|$)/, ".jpg$1");
}

function normalizeBooking(
  raw: any,
  input: AccommodationSearchInput,
  currency: string
): Accommodation | null {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.title === "string" ? raw.title : "";
  if (!name) return null;

  const thumb =
    typeof raw.thumbnail_hd === "string"
      ? raw.thumbnail_hd
      : typeof raw.thumbnail === "string"
        ? raw.thumbnail
        : undefined;
  const images = thumb ? [bookingLandscapeImage(thumb)] : [];

  const nights = Math.max(1, input.nights);
  // `extracted_price` is the whole stay before Booking's separately listed
  // taxes & charges; the total we show is what the traveller actually pays.
  const stayPrice = toNumber(raw.extracted_price);
  const taxes = toNumber(raw.extracted_taxes_and_charges) ?? 0;
  let pricePerNight = toNumber(raw.extracted_nightly_price);
  if (pricePerNight === undefined && stayPrice !== undefined) {
    pricePerNight = Math.round(stayPrice / nights);
  }
  // Booking's struck-through price covers the whole stay; the card compares
  // it against the nightly rate, so scale it down the same way.
  const originalTotal = toNumber(raw.extracted_original_price);

  // Booking scores out of 10; the rest of the app (and the rating sort) uses /5.
  const rawRating = toNumber(raw.rating);
  const maxRating = toNumber(raw.max_rating) ?? 10;
  const rating =
    rawRating !== undefined ? Math.round((rawRating / maxRating) * 50) / 10 : undefined;

  const link = typeof raw.link === "string" ? raw.link : undefined;

  return {
    type: "hotel",
    provider: "booking",
    name,
    image: images[0],
    images,
    rating,
    reviews: toNumber(raw.reviews),
    stars: toNumber(raw.hotel_class),
    pricePerNight: pricePerNight || 0,
    totalPrice: stayPrice !== undefined ? stayPrice + taxes : undefined,
    originalPrice:
      originalTotal !== undefined && stayPrice !== undefined && originalTotal > stayPrice
        ? Math.round(originalTotal / nights)
        : undefined,
    currency,
    link,
    bookingLink: link
      ? buildBookingDatedLink(link, {
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          adults: Math.min(Math.max(input.adults, 1), BOOKING_MAX_ADULTS),
          currency,
        })
      : undefined,
    description: typeof raw.room_type === "string" ? raw.room_type : undefined,
    amenities: [raw.meal_plan, raw.bed_configuration].filter(
      (a: any): a is string => typeof a === "string" && a.length > 0
    ),
    badges: typeof raw.rating_word === "string" ? [raw.rating_word] : [],
    freeCancellation:
      typeof raw.has_free_cancellation === "boolean" ? raw.has_free_cancellation : undefined,
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

export async function searchBooking(
  input: AccommodationSearchInput
): Promise<Accommodation[]> {
  const key = getSearchApiKey();
  if (!key || !input.destination) return [];
  const currency = (input.currency || "EUR").toUpperCase();

  const params = new URLSearchParams();
  params.append("engine", "booking");
  params.append("q", input.destination);
  params.append("check_in_date", input.checkInDate);
  params.append("check_out_date", input.checkOutDate);
  params.append("adults", String(Math.min(Math.max(input.adults, 1), BOOKING_MAX_ADULTS)));
  params.append("rooms", "1");
  params.append("currency", currency);

  const json = await callSearchApi(params, key);
  const properties = Array.isArray(json?.properties) ? json.properties : [];
  return properties
    .map((p: any) => normalizeBooking(p, input, currency))
    .filter((h: Accommodation | null): h is Accommodation => h !== null && h.pricePerNight > 0)
    .slice(0, MAX_BOOKING);
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

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Fetch Google Hotels + Booking.com + Airbnb listings in parallel and merge
 * them. The two hotel sources overlap, so a property listed on both is kept
 * once, as the Booking.com entry (its link opens on the traveller's dates).
 * Hotels from both sources are interleaved so neither crowds out the other in
 * "recommended" order. Returns an empty array if every engine comes back empty
 * (caller should fall back to AI hotels).
 */
export async function fetchAccommodations(
  input: AccommodationSearchInput
): Promise<Accommodation[]> {
  const [hotels, booking, airbnbs] = await Promise.all([
    searchHotels(input).catch(() => [] as Accommodation[]),
    searchBooking(input).catch(() => [] as Accommodation[]),
    searchAirbnb(input).catch(() => [] as Accommodation[]),
  ]);
  const bookingNames = new Set(booking.map((b) => nameKey(b.name)).filter(Boolean));
  const googleOnly = hotels.filter((h) => !bookingNames.has(nameKey(h.name)));

  const merged: Accommodation[] = [];
  for (let i = 0; i < Math.max(googleOnly.length, booking.length); i++) {
    if (googleOnly[i]) merged.push(googleOnly[i]);
    if (booking[i]) merged.push(booking[i]);
  }
  return [...merged, ...airbnbs];
}

export function isSearchApiConfigured(): boolean {
  return getSearchApiKey() !== null;
}
