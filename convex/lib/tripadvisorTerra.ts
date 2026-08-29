/**
 * Tripadvisor **Terra** API client (replaces the legacy Content API).
 *
 * Docs: https://docs.terra.tripadvisor.com/reference/locationssearch
 *       https://docs.terra.tripadvisor.com/reference/locationget
 *       https://docs.terra.tripadvisor.com/reference/cataloglocationsnearbyget
 *
 * WHY THIS EXISTS
 * ---------------
 * Tripadvisor migrated off `api.content.tripadvisor.com/api/v1/*` (the legacy
 * Content API, sunset 2026-08-31) onto Terra at `terra.tripadvisor.com/api`.
 * The two differ in every dimension we touch:
 *
 *   legacy Content API                    Terra
 *   ----------------------------------    ------------------------------------
 *   ?key=<KEY> in the query string        X-API-Key request header
 *   GET /location/search?searchQuery=     GET /locations/search?query=
 *   GET /location/{id}/details            GET /locations/{id}
 *   category=restaurants (lowercase)      category=RESTAURANT (enum, uppercase)
 *   language=en                           locale=en
 *   flat rows: name, rating, num_reviews  nested: names[], traveler_ratings{},
 *   web_url, address_obj.address_string   urls.tripadvisor.main, addresses[]
 *   search returns stubs (id + name)      search returns FULL Location objects
 *
 * That last row is the big one: on the legacy API every search had to be
 * followed by an N-way `/details` fan-out just to get a rating and a real
 * profile URL. Terra returns the whole Location inline, so the fan-out is gone
 * — one call instead of 1+N. `terraLocationDetails()` is kept for the rare row
 * where an optional field was omitted ("Optional fields are omitted from the
 * response when no data is available").
 *
 * Everything here normalizes onto ONE shape (`TerraPlace`) whose field names
 * mirror the restaurant shape the rest of the codebase already uses, so call
 * sites did not have to change their downstream data model.
 *
 * Failure philosophy matches the sibling lib files: no function throws on a
 * missing key, HTTP error, timeout or malformed body — searches resolve to an
 * empty array and detail lookups to `null`, so every caller degrades to its
 * own fallback instead of blowing up a trip generation.
 */

const TERRA_BASE = "https://terra.tripadvisor.com/api";

/** Terra's `category` enum. The legacy API used lowercase plurals. */
export type TerraCategory = "RESTAURANT" | "ATTRACTION" | "HOTEL";

/**
 * Normalized place. Field names deliberately mirror the existing restaurant
 * shape used by tripsActions/atlasTools so nothing downstream had to change.
 */
export type TerraPlace = {
  /** Tripadvisor location id, as a string (the API returns int32). */
  id: string;
  name: string;
  /** Joined category display names, e.g. "Italian, Seafood". */
  cuisine: string | null;
  /** Euro-symbol band, e.g. "€€ - €€€". Null when Terra omitted price_level. */
  priceRange: string | null;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  /** Real Tripadvisor profile URL (`urls.tripadvisor.main`). */
  webUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Terra key. `TRIPADVISOR_TERRA_API_KEY` is preferred so the new Terra key can
 * be rolled out without disturbing the old variable; `TRIPADVISOR_API_KEY`
 * stays supported for deployments that simply swap the value in place.
 */
export function getTerraApiKey(): string | null {
  const key =
    process.env.TRIPADVISOR_TERRA_API_KEY || process.env.TRIPADVISOR_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function hasTerraApiKey(): boolean {
  return getTerraApiKey() !== null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 6000;

/**
 * GET a Terra endpoint. Returns the parsed body, or null on any failure
 * (missing key, timeout, non-2xx, unparseable JSON). Never throws.
 */
async function terraGet(
  path: string,
  params: Record<string, string | number | undefined | null>,
  timeoutMs: number
): Promise<any | null> {
  const key = getTerraApiKey();
  if (!key) return null;

  const url = new URL(`${TERRA_BASE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        // Terra authenticates by header — the legacy `?key=` query param is gone.
        "X-API-Key": key,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      // ProblemDetail body; trace_id is what Tripadvisor support asks for.
      const body = await res.text().catch(() => "");
      console.error(
        `[terra] ${path} failed (${res.status}): ${body.slice(0, 200)}`
      );
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error(
      `[terra] ${path} error:`,
      error instanceof Error ? error.message : error
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Normalization — Terra's nested Location -> flat TerraPlace
// ---------------------------------------------------------------------------

/** Terra price_level is a word band, not symbols. Map onto the euro scale the app shows. */
const PRICE_LEVELS: Record<string, string> = {
  "cheap eats": "€",
  "mid range": "€€ - €€€",
  "fine dining": "€€€€",
};

function normalizePriceLevel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const mapped = PRICE_LEVELS[raw.trim().toLowerCase()];
  if (mapped) return mapped;
  // Some records still carry the legacy symbol form ("$$ - $$$").
  if (/^[$€\s-]+$/.test(raw)) return raw.replace(/\$/g, "€").trim();
  return raw.trim();
}

/** Pick the primary-language name, else the first one. */
function pickName(loc: any): string | null {
  const names = Array.isArray(loc?.names) ? loc.names : [];
  const primary = names.find((n: any) => n?.primary && n?.value);
  const first = names.find((n: any) => n?.value);
  const value = primary?.value ?? first?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickAddress(loc: any): string | null {
  const addresses = Array.isArray(loc?.addresses) ? loc.addresses : [];
  const withFormatted = addresses.find(
    (a: any) => typeof a?.formatted === "string" && a.formatted.trim()
  );
  if (withFormatted) return withFormatted.formatted.trim();

  const first = addresses[0];
  if (!first) return null;
  const parts = [first.street_address, first.city, first.country_name]
    .filter((p: any) => typeof p === "string" && p.trim())
    .map((p: string) => p.trim());
  return parts.length ? parts.join(", ") : null;
}

/**
 * Terra replaces the legacy `cuisine[]` array with a general `categories[]`
 * tree. For food venues the cuisine lives in the "Eat & Drink" branch.
 */
function pickCuisine(loc: any): string | null {
  const categories = Array.isArray(loc?.categories) ? loc.categories : [];
  const names = (list: any[]) =>
    list
      .map((c: any) => c?.display_name)
      .filter((n: any) => typeof n === "string" && n.trim())
      .map((n: string) => n.trim());

  const food = names(
    categories.filter(
      (c: any) =>
        typeof c?.top_level_category === "string" &&
        c.top_level_category.toLowerCase().includes("eat")
    )
  );
  const chosen = food.length ? food : names(categories);
  const unique = Array.from(new Set(chosen)).slice(0, 3);
  return unique.length ? unique.join(", ") : null;
}

function pickRating(loc: any): { rating: number | null; count: number | null } {
  // `/locations/*` nests it under traveler_ratings.overall; the abbreviated
  // catalog endpoints expose it flat as overall_rating.
  const overall = loc?.traveler_ratings?.overall ?? loc?.overall_rating ?? null;
  const rating = Number(overall?.rating);
  const count = Number(overall?.count);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    count: Number.isFinite(count) ? count : null,
  };
}

/** Convert a raw Terra Location into our flat shape. Null if it has no usable id/name. */
export function normalizeTerraLocation(loc: any): TerraPlace | null {
  const id = loc?.id;
  const name = pickName(loc);
  if (id == null || !name) return null;

  const { rating, count } = pickRating(loc);
  const main = loc?.urls?.tripadvisor?.main;
  const lat = Number(loc?.coordinates?.latitude);
  const lon = Number(loc?.coordinates?.longitude);

  return {
    id: String(id),
    name,
    cuisine: pickCuisine(loc),
    priceRange: normalizePriceLevel(loc?.price_level),
    rating,
    reviewCount: count,
    address: pickAddress(loc),
    webUrl: typeof main === "string" && main.trim() ? main.trim() : null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

/** Rows come back as `{ location: {...}, matched_value | distance_* }`. */
function normalizePage(body: any): TerraPlace[] {
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((row: any) => normalizeTerraLocation(row?.location ?? row))
    .filter((p: TerraPlace | null): p is TerraPlace => p !== null);
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Free-text search — the Terra replacement for `/location/search`.
 * https://docs.terra.tripadvisor.com/reference/locationssearch
 *
 * Note Terra caps `size` at 20 per page; ask for more and it 400s, so we clamp.
 */
export async function terraSearchLocations(opts: {
  query: string;
  category?: TerraCategory;
  /** City/town/country to bias the search — much sharper than baking it into `query`. */
  geoName?: string;
  countryCode?: string;
  locale?: string;
  size?: number;
  page?: number;
  timeoutMs?: number;
}): Promise<TerraPlace[]> {
  const query = opts.query?.trim();
  if (!query) return [];

  const body = await terraGet(
    "/locations/search",
    {
      query: query.slice(0, 500),
      category: opts.category,
      geo_name: opts.geoName,
      country_code: opts.countryCode,
      locale: opts.locale ?? "en",
      size: Math.min(Math.max(opts.size ?? 20, 1), 20),
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

/**
 * Points of interest around a coordinate (or around another location id).
 * https://docs.terra.tripadvisor.com/reference/cataloglocationsnearbyget
 *
 * Use this instead of `terraSearchLocations` whenever real coordinates are on
 * hand — it is geo-exact where free text is guesswork.
 */
export async function terraNearbyLocations(opts: {
  lat?: number;
  lon?: number;
  locationId?: string | number;
  radius?: number;
  unit?: "KM" | "MI";
  category?: TerraCategory;
  minRating?: number;
  /** Terra default is "rating,desc"; "distance,asc" for closest-first. */
  sort?: string;
  locale?: string;
  size?: number;
  timeoutMs?: number;
}): Promise<TerraPlace[]> {
  const hasCoords =
    Number.isFinite(opts.lat as number) && Number.isFinite(opts.lon as number);
  if (!hasCoords && !opts.locationId) return [];

  const body = await terraGet(
    "/locations/nearby",
    {
      lat: hasCoords ? opts.lat : undefined,
      lon: hasCoords ? opts.lon : undefined,
      location_id: opts.locationId,
      radius: opts.radius ?? 5,
      unit: opts.unit ?? "KM",
      category: opts.category,
      min_rating: opts.minRating,
      sort: opts.sort,
      locale: opts.locale ?? "en",
      size: Math.min(Math.max(opts.size ?? 20, 1), 20),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

/**
 * Full detail for one location — the Terra replacement for
 * `/location/{id}/details`. https://docs.terra.tripadvisor.com/reference/locationget
 *
 * Rarely needed now that search returns full Locations; reach for it only to
 * backfill a field Terra omitted from a search row.
 */
export async function terraLocationDetails(
  id: string | number,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraPlace | null> {
  if (id == null || String(id).trim() === "") return null;
  const body = await terraGet(
    `/locations/${encodeURIComponent(String(id))}`,
    { locale: opts.locale ?? "en" },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizeTerraLocation(body) : null;
}

/** Profile-link fallback for a known id when Terra gave us no `urls.tripadvisor.main`. */
export function tripadvisorProfileUrl(id: string | number): string {
  return `https://www.tripadvisor.com/Restaurant_Review-g${id}`;
}
