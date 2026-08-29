/**
 * Tripadvisor **Terra** API client (replaces the legacy Content API).
 *
 * Docs index: https://docs.terra.tripadvisor.com/llms.txt
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
 * — one call instead of 1+N.
 *
 * COVERAGE
 * --------
 * Every content endpoint Terra documents is wrapped here. Only the restaurant
 * search path is wired into the product today; the rest exist so that adding a
 * feature is a call site rather than a research project. They are thin, share
 * one transport and one set of normalizers, and cost nothing until called.
 *
 *   search           terraSearchLocations      GET  /locations/search
 *   nearby           terraNearbyLocations      GET  /locations/nearby
 *   details          terraLocationDetails      GET  /locations/{id}
 *   details (batch)  terraLocationsBatch       GET  /locations?id=..&id=..
 *   photos           terraLocationPhotos       GET  /locations/{id}/photos
 *   reviews          terraLocationReviews      GET  /locations/{id}/reviews
 *   recommendations  terraRecommendations      POST /recommendations/search
 *   geo (batch)      terraGeos / terraGeo      GET  /geos?id=..
 *   catalog search   terraCatalogSearch        GET  /catalog/locations/search
 *   catalog nearby   terraCatalogNearby        GET  /catalog/locations/nearby
 *   catalog details  terraCatalogLocation      GET  /catalog/locations/{id}
 *
 * NOT wrapped: the feed-file and allowlist endpoints (`/feed/*`,
 * `/allowlist`). Those are account-administration APIs for partners who have
 * negotiated a bulk data drop — they do nothing without that arrangement, so a
 * wrapper would be untestable code standing in for a contract we do not have.
 *
 * Failure philosophy matches the sibling lib files: no function throws on a
 * missing key, HTTP error, timeout or malformed body — list endpoints resolve
 * to an empty array and single-object endpoints to `null`, so every caller
 * degrades to its own fallback instead of blowing up a trip generation.
 */

const TERRA_BASE = "https://terra.tripadvisor.com/api";

/** Terra's `category` enum. The legacy API used lowercase plurals. */
export type TerraCategory = "RESTAURANT" | "ATTRACTION" | "HOTEL";

/**
 * Normalized place. Field names deliberately mirror the restaurant shape the
 * rest of the codebase already uses, so call sites did not have to change
 * their downstream data model when we migrated.
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

export type TerraPhoto = {
  id: string;
  locationId: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  /** "Management" (the business) or "Traveler". */
  source: string | null;
  /** Terra's own 0–1 aesthetic score. Useful for picking a hero image. */
  attractivenessScore: number | null;
  /** Scene labels from their vision model, e.g. ["food", "dining"]. */
  scenes: string[];
  username: string | null;
  publishedAt: string | null;
};

export type TerraReview = {
  id: string;
  rating: number | null;
  title: string | null;
  text: string | null;
  url: string | null;
  publishedAt: string | null;
  travelDate: string | null;
  /** BUSINESS | COUPLES | FAMILY | FRIENDS | SOLO | NONE */
  tripType: string | null;
  username: string | null;
  userLocation: string | null;
  ownerResponse: string | null;
};

export type TerraGeo = {
  id: string;
  name: string;
  description: string | null;
  typeName: string | null;
  latitude: number | null;
  longitude: number | null;
  urls: {
    geoPage: string | null;
    hotels: string | null;
    restaurants: string | null;
    thingsToDo: string | null;
  };
};

export type TerraRecommendation = {
  place: TerraPlace;
  /** Review snippets Terra returns to justify the pick. */
  reasons: string[];
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

type ParamValue = string | number | boolean | Array<string | number> | undefined | null;

/**
 * Build the URL. Array values become REPEATED query params (`?id=1&id=2`),
 * which is what Terra's batch and locale parameters expect — a comma-joined
 * single value is rejected.
 */
function buildUrl(path: string, params: Record<string, ParamValue>): string {
  const url = new URL(`${TERRA_BASE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue;
        url.searchParams.append(name, String(item));
      }
    } else {
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
}

async function terraFetch(
  path: string,
  init: { method: "GET" | "POST"; params?: Record<string, ParamValue>; body?: any },
  timeoutMs: number
): Promise<any | null> {
  const key = getTerraApiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      // Terra authenticates by header — the legacy `?key=` query param is gone.
      "X-API-Key": key,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(buildUrl(path, init.params ?? {}), {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      // ProblemDetail body; trace_id is what Tripadvisor support asks for.
      const body = await res.text().catch(() => "");
      console.error(
        `[terra] ${init.method} ${path} failed (${res.status}): ${body.slice(0, 200)}`
      );
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error(
      `[terra] ${init.method} ${path} error:`,
      error instanceof Error ? error.message : error
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const terraGet = (
  path: string,
  params: Record<string, ParamValue>,
  timeoutMs: number
) => terraFetch(path, { method: "GET", params }, timeoutMs);

const terraPost = (path: string, body: any, params: Record<string, ParamValue>, timeoutMs: number) =>
  terraFetch(path, { method: "POST", params, body }, timeoutMs);

// ---------------------------------------------------------------------------
// Normalization — Terra's nested shapes -> flat objects
// ---------------------------------------------------------------------------

/**
 * Terra returns localized strings as `[{ language, value, primary }]`.
 * Prefer the primary entry, else the first with a value.
 */
function pickTranslation(list: any): string | null {
  if (!Array.isArray(list)) return null;
  const primary = list.find((n: any) => n?.primary && n?.value);
  const first = list.find((n: any) => n?.value);
  const value = primary?.value ?? first?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function str(value: any): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

function pickAddress(loc: any): string | null {
  const addresses = Array.isArray(loc?.addresses) ? loc.addresses : [];
  const withFormatted = addresses.find((a: any) => str(a?.formatted));
  if (withFormatted) return str(withFormatted.formatted);

  const first = addresses[0];
  if (!first) return null;
  const parts = [first.street_address, first.city, first.country_name]
    .map(str)
    .filter((p): p is string => p !== null);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Terra replaces the legacy `cuisine[]` array with a general `categories[]`
 * tree. For food venues the cuisine lives in the "Eat & Drink" branch.
 */
function pickCuisine(loc: any): string | null {
  const categories = Array.isArray(loc?.categories) ? loc.categories : [];
  const names = (list: any[]) =>
    list.map((c: any) => str(c?.display_name)).filter((n): n is string => n !== null);

  const food = names(
    categories.filter((c: any) =>
      (str(c?.top_level_category) ?? "").toLowerCase().includes("eat")
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
  return { rating: num(overall?.rating), count: num(overall?.count) };
}

/** Convert a raw Terra Location into our flat shape. Null if it has no usable id/name. */
export function normalizeTerraLocation(loc: any): TerraPlace | null {
  const id = loc?.id;
  const name = pickTranslation(loc?.names);
  if (id == null || !name) return null;

  const { rating, count } = pickRating(loc);
  return {
    id: String(id),
    name,
    cuisine: pickCuisine(loc),
    priceRange: normalizePriceLevel(loc?.price_level),
    rating,
    reviewCount: count,
    address: pickAddress(loc),
    webUrl: str(loc?.urls?.tripadvisor?.main),
    latitude: num(loc?.coordinates?.latitude),
    longitude: num(loc?.coordinates?.longitude),
  };
}

/** Rows come back as `{ location: {...}, matched_value | distance_* }`. */
function normalizePage(body: any): TerraPlace[] {
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((row: any) => normalizeTerraLocation(row?.location ?? row))
    .filter((p: TerraPlace | null): p is TerraPlace => p !== null);
}

function normalizePhoto(raw: any): TerraPhoto | null {
  if (raw?.id == null) return null;
  const info = raw?.photo ?? {};
  const cv = raw?.cv_metadata ?? {};
  const scenes = Array.isArray(cv?.scene_classification)
    ? cv.scene_classification
        .map((s: any) => str(typeof s === "string" ? s : s?.name ?? s?.scene))
        .filter((s: string | null): s is string => s !== null)
    : [];
  return {
    id: String(raw.id),
    locationId: raw?.location_id != null ? String(raw.location_id) : null,
    url: str(info?.original_size_url),
    width: num(info?.original_width),
    height: num(info?.original_height),
    caption: str(raw?.caption),
    source: str(raw?.source),
    attractivenessScore: num(cv?.attractiveness_score),
    scenes,
    username: str(raw?.user?.username),
    publishedAt: str(raw?.publish_ts),
  };
}

function normalizeReview(raw: any): TerraReview | null {
  if (raw?.id == null) return null;
  return {
    id: String(raw.id),
    rating: num(raw?.rating),
    title: pickTranslation(raw?.title),
    text: pickTranslation(raw?.text),
    url: str(raw?.url),
    publishedAt: str(raw?.publish_ts),
    travelDate: str(raw?.travel_date),
    tripType: str(raw?.trip_type),
    username: str(raw?.user?.username),
    userLocation: str(raw?.user?.geo),
    ownerResponse: pickTranslation(raw?.owner_response?.text),
  };
}

function normalizeGeo(raw: any): TerraGeo | null {
  const id = raw?.id;
  const name = pickTranslation(raw?.names);
  if (id == null || !name) return null;
  return {
    id: String(id),
    name,
    description: pickTranslation(raw?.descriptions),
    typeName: str(raw?.type?.name),
    latitude: num(raw?.coordinates?.latitude),
    longitude: num(raw?.coordinates?.longitude),
    urls: {
      geoPage: str(raw?.urls?.geo_page),
      hotels: str(raw?.urls?.hotels),
      restaurants: str(raw?.urls?.restaurants),
      thingsToDo: str(raw?.urls?.things_to_do),
    },
  };
}

// ---------------------------------------------------------------------------
// Search
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
  postalCode?: string;
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
      postal_code: opts.postalCode,
      locale: opts.locale ?? "en",
      size: clampSize(opts.size),
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

/**
 * Points of interest around a coordinate (or around another location id).
 * https://docs.terra.tripadvisor.com/reference/locationsnearbyget
 *
 * Prefer this over `terraSearchLocations` whenever real coordinates are on
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
  includePhoto?: boolean;
  locale?: string;
  size?: number;
  page?: number;
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
      include_photo: opts.includePhoto,
      locale: opts.locale ?? "en",
      size: clampSize(opts.size),
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

/**
 * Full detail for one location — the Terra replacement for
 * `/location/{id}/details`. https://docs.terra.tripadvisor.com/reference/locationget
 *
 * Rarely needed now that search returns full Locations; reach for it to
 * backfill a field Terra omitted, or to refresh a stored location by id.
 */
export async function terraLocationDetails(
  id: string | number,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraPlace | null> {
  if (!validId(id)) return null;
  const body = await terraGet(
    `/locations/${encodeURIComponent(String(id))}`,
    { locale: opts.locale ?? "en" },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizeTerraLocation(body) : null;
}

/**
 * Refresh many stored locations in ONE call.
 * https://docs.terra.tripadvisor.com/reference/locationsget
 *
 * Ids we are not licensed for, or that no longer exist, are dropped from the
 * response rather than failing the request — so a short result is normal, and
 * callers should match on id rather than assume positional alignment.
 */
export async function terraLocationsBatch(
  ids: Array<string | number>,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraPlace[]> {
  // uniqueItems is enforced server-side, so dedupe before we spend the call.
  const unique = Array.from(new Set(ids.filter(validId).map(String)));
  if (unique.length === 0) return [];

  const body = await terraGet(
    "/locations",
    { id: unique, locale: opts.locale ?? "en" },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

// ---------------------------------------------------------------------------
// Content: photos and reviews
// ---------------------------------------------------------------------------

/**
 * Photos for a location.
 * https://docs.terra.tripadvisor.com/reference/locationphotosget
 *
 * Each photo carries `attractivenessScore` (0–1) and scene labels from
 * Tripadvisor's vision model, which is what makes automatic hero-image picking
 * viable — sort by score, filter by scene ("food" for a restaurant card).
 *
 * Before showing these to users, check Tripadvisor's display and attribution
 * terms for your licence tier. Their photo content generally carries
 * attribution requirements that the endpoint docs do not spell out.
 */
export async function terraLocationPhotos(
  id: string | number,
  opts: { locale?: string; size?: number; page?: number; sort?: string; timeoutMs?: number } = {}
): Promise<TerraPhoto[]> {
  if (!validId(id)) return [];
  const body = await terraGet(
    `/locations/${encodeURIComponent(String(id))}/photos`,
    {
      locale: opts.locale ?? "en",
      size: opts.size,
      page: opts.page,
      sort: opts.sort,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map(normalizePhoto)
    .filter((p: TerraPhoto | null): p is TerraPhoto => p !== null);
}

/**
 * Reviews for a location.
 * https://docs.terra.tripadvisor.com/reference/locationreviewsget
 *
 * `language: "primary"` returns each review in the language it was written in
 * rather than translated to English — better for showing authentic quotes.
 */
export async function terraLocationReviews(
  id: string | number,
  opts: {
    minRating?: number;
    tripType?: string;
    publishedAfter?: string;
    sortBy?: "MOST_RECENT" | "HIGHEST_RATED";
    language?: string;
    size?: number;
    page?: number;
    timeoutMs?: number;
  } = {}
): Promise<TerraReview[]> {
  if (!validId(id)) return [];
  const body = await terraGet(
    `/locations/${encodeURIComponent(String(id))}/reviews`,
    {
      rating_min: opts.minRating,
      trip_type: opts.tripType,
      published_after_ts: opts.publishedAfter,
      sort_by: opts.sortBy,
      language: opts.language ?? "en",
      size: opts.size,
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map(normalizeReview)
    .filter((r: TerraReview | null): r is TerraReview => r !== null);
}

// ---------------------------------------------------------------------------
// Recommendations (the only POST endpoint)
// ---------------------------------------------------------------------------

/**
 * Natural-language recommendations grounded in real Tripadvisor places.
 * https://docs.terra.tripadvisor.com/reference/recommendationssearch-1
 *
 * This is the closest thing Terra offers to what Atlas currently asks a model
 * to do from memory: give it "romantic dinner spots near the Panthéon" plus a
 * geo, and it returns ranked real locations with review snippets explaining
 * each pick. Those snippets are the valuable part — they are citations, so an
 * answer built on them can be checked.
 *
 * `geo` accepts a destination name, a geo id, or coordinates; pass whichever
 * you actually have rather than stringifying coordinates into the query.
 */
export async function terraRecommendations(opts: {
  query: string;
  geo: { name?: string; geoId?: string | number; lat?: number; lon?: number };
  limit?: number;
  topLevelCategories?: string[];
  excludeLocationIds?: Array<string | number>;
  /** "quality" (Terra's default) or "speed". */
  responsePreference?: "quality" | "speed";
  locale?: string;
  timeoutMs?: number;
}): Promise<TerraRecommendation[]> {
  const query = opts.query?.trim();
  if (!query) return [];

  const geo: Record<string, any> = {};
  if (opts.geo?.name) geo.name = opts.geo.name;
  if (opts.geo?.geoId != null) geo.geo_id = Number(opts.geo.geoId);
  if (Number.isFinite(opts.geo?.lat as number) && Number.isFinite(opts.geo?.lon as number)) {
    geo.coordinates = { latitude: opts.geo.lat, longitude: opts.geo.lon };
  }
  // `geo` is required — without it Terra has no idea where to look.
  if (Object.keys(geo).length === 0) return [];

  const body = await terraPost(
    "/recommendations/search",
    {
      query: query.slice(0, 500),
      geo,
      limit: opts.limit ?? 5,
      top_level_categories: opts.topLevelCategories,
      exclude_location_ids: opts.excludeLocationIds?.filter(validId).map(Number),
      response_preference: opts.responsePreference,
    },
    { locale: opts.locale ?? "en" },
    // Quality mode does real work server-side, so allow more headroom.
    opts.timeoutMs ?? 15000
  );

  const rows = Array.isArray(body?.search_results) ? body.search_results : [];
  const out: TerraRecommendation[] = [];
  for (const row of rows) {
    const place = normalizeTerraLocation(row?.location ?? row?.experience);
    if (!place) continue;
    const reasons = Array.isArray(row?.review_sources)
      ? row.review_sources
          .map((s: any) => str(typeof s === "string" ? s : s?.text ?? s?.snippet))
          .filter((s: string | null): s is string => s !== null)
      : [];
    out.push({ place, reasons });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geos (city / region level)
// ---------------------------------------------------------------------------

/**
 * Metadata for one or more geographic areas — the city behind a location.
 * https://docs.terra.tripadvisor.com/reference/geosget
 *
 * Terra also documents a single-Geo endpoint, but its path is not stated in
 * the public reference, so `terraGeo` goes through the confirmed batch route
 * with one id rather than guessing a URL.
 */
export async function terraGeos(
  ids: Array<string | number>,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraGeo[]> {
  const unique = Array.from(new Set(ids.filter(validId).map(String)));
  if (unique.length === 0) return [];

  const body = await terraGet(
    "/geos",
    { id: unique, locale: opts.locale ?? "en" },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map(normalizeGeo)
    .filter((g: TerraGeo | null): g is TerraGeo => g !== null);
}

export async function terraGeo(
  id: string | number,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraGeo | null> {
  const geos = await terraGeos([id], opts);
  return geos[0] ?? null;
}

// ---------------------------------------------------------------------------
// Catalog — the lightweight projection
// ---------------------------------------------------------------------------

/**
 * Catalog search: the same query surface as `terraSearchLocations`, but it
 * returns only the lightweight catalog projection (no price level, opening
 * hours, awards, and so on).
 * https://docs.terra.tripadvisor.com/reference/cataloglocationssearch
 *
 * The reason to reach for it: catalog endpoints are NOT limited by a partner's
 * allowlist or geofencing. If our key is ever scoped to a subset of
 * Tripadvisor's inventory, catalog search still resolves names to ids across
 * the whole catalogue — useful for "does this venue exist at all?" checks.
 */
export async function terraCatalogSearch(opts: {
  query: string;
  category?: TerraCategory;
  geoName?: string;
  countryCode?: string;
  postalCode?: string;
  locale?: string;
  size?: number;
  page?: number;
  timeoutMs?: number;
}): Promise<TerraPlace[]> {
  const query = opts.query?.trim();
  if (!query) return [];

  const body = await terraGet(
    "/catalog/locations/search",
    {
      query: query.slice(0, 500),
      category: opts.category,
      geo_name: opts.geoName,
      country_code: opts.countryCode,
      postal_code: opts.postalCode,
      locale: opts.locale ?? "en",
      size: clampSize(opts.size),
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

/**
 * Catalog nearby — lightweight geographic search.
 * https://docs.terra.tripadvisor.com/reference/cataloglocationsnearbyget
 */
export async function terraCatalogNearby(opts: {
  lat?: number;
  lon?: number;
  locationId?: string | number;
  radius?: number;
  unit?: "KM" | "MI";
  category?: TerraCategory;
  minRating?: number;
  sort?: string;
  locale?: string;
  size?: number;
  page?: number;
  timeoutMs?: number;
}): Promise<TerraPlace[]> {
  const hasCoords =
    Number.isFinite(opts.lat as number) && Number.isFinite(opts.lon as number);
  if (!hasCoords && !opts.locationId) return [];

  const body = await terraGet(
    "/catalog/locations/nearby",
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
      size: clampSize(opts.size),
      page: opts.page,
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizePage(body) : [];
}

/**
 * Catalog detail for one id — abbreviated summary.
 *
 * The path follows the confirmed `/catalog/locations/{search,nearby}` pattern;
 * the public reference does not spell it out. If this ever 404s, that is why —
 * verify against the docs rather than assuming the id is bad.
 */
export async function terraCatalogLocation(
  id: string | number,
  opts: { locale?: string; timeoutMs?: number } = {}
): Promise<TerraPlace | null> {
  if (!validId(id)) return null;
  const body = await terraGet(
    `/catalog/locations/${encodeURIComponent(String(id))}`,
    { locale: opts.locale ?? "en" },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return body ? normalizeTerraLocation(body?.location ?? body) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Terra rejects page sizes above 20 with a 400 rather than clamping for us. */
function clampSize(size: number | undefined): number {
  return Math.min(Math.max(size ?? 20, 1), 20);
}

function validId(id: string | number | undefined | null): boolean {
  return id != null && String(id).trim() !== "";
}

/** Profile-link fallback for a known id when Terra gave us no `urls.tripadvisor.main`. */
export function tripadvisorProfileUrl(id: string | number): string {
  return `https://www.tripadvisor.com/Restaurant_Review-g${id}`;
}
