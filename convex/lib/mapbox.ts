// Thin, typed wrappers over the four Mapbox APIs this backend uses.
//
// Every function here is best-effort: it returns null (or an empty result) on a
// missing token, an HTTP error, a malformed body or a timeout, and never
// throws. Callers layer their own free-service fallbacks on top - see
// lib/geocoding.ts, which falls back to Nominatim/OSRM whenever these return
// null, so a deployment with no MAPBOX_TOKEN keeps working exactly as before.
//
// All of these bill against MAPBOX_TOKEN. Unlike the Static Images URLs (which
// are stored on trip documents and read by clients, and so must use a public
// `pk.` token), these calls are server-side only - they can use a secret `sk.`
// token via MAPBOX_SERVER_TOKEN, which is the safer default when set.

export interface MapboxPoint {
    lat: number;
    lng: number;
}

export type MapboxProfile = "walking" | "cycling" | "driving" | "driving-traffic";

const API = "https://api.mapbox.com";

/** Mapbox rejects Directions requests above this many coordinates. */
export const MAX_DIRECTIONS_COORDS = 25;
/** The Optimization API's (much lower) coordinate ceiling. */
export const MAX_OPTIMIZATION_COORDS = 12;

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Token for server-side API calls. Prefers a secret token when one is
 * configured, since these responses never reach the client; falls back to the
 * same public token the Static Images URLs use.
 */
export function mapboxServerToken(): string | undefined {
    return process.env.MAPBOX_SERVER_TOKEN || process.env.MAPBOX_TOKEN || undefined;
}

/** True when Mapbox is configured - callers use this to pick the fast path. */
export function hasMapbox(): boolean {
    return !!mapboxServerToken();
}

/** GET a Mapbox endpoint and parse JSON. Returns null on any failure. */
async function mapboxFetch(
    path: string,
    params: Record<string, string | number | undefined>,
    label: string,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<any | null> {
    const token = mapboxServerToken();
    if (!token) return null;

    const search = new URLSearchParams({ access_token: token });
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") search.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API}${path}?${search.toString()}`, { signal: controller.signal });
        if (!res.ok) {
            // 401/403 = bad or under-scoped token, 422 = bad geometry, 429 = rate limit.
            console.warn(`[mapbox] ${label} HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.warn(`[mapbox] ${label} failed:`, e instanceof Error ? e.message : e);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Log a 200 whose body didn't hold what we expected.
 *
 * Worth distinguishing loudly: every failure here degrades to the Nominatim/
 * OSRM fallback, so a response-shape change on Mapbox's side would otherwise
 * look exactly like "Mapbox is fine, this place just isn't in it" - the system
 * would quietly run on the slow path forever without anything going red.
 */
function warnUnparsed(label: string, body: any): null {
    if (body !== null && body !== undefined) {
        console.warn(`[mapbox] ${label} returned an unrecognised body:`, JSON.stringify(body).slice(0, 300));
    }
    return null;
}

// ---------------------------------------------------------------------------
// 1. Geocoding - Search Box forward
// ---------------------------------------------------------------------------

export interface MapboxGeocodeResult extends MapboxPoint {
    /** Lowercase ISO 3166-1 alpha-2, to match what Nominatim returns. */
    countryCode: string;
    /** The matched feature's canonical name, useful for logging/debugging. */
    name: string;
    /** "poi" | "address" | "place" | ... - which gazetteer layer matched. */
    featureType: string;
}

export interface MapboxGeocodeOptions {
    /** Bias results toward this point (the destination city center). */
    proximity?: MapboxPoint;
    /** Hard-restrict to this bounding box. */
    bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
    /** ISO 3166-1 alpha-2, any case. */
    country?: string;
    /** IETF tag - returns localized place names for the user's language. */
    language?: string;
    /**
     * Feature layers to search, comma-separated. The default stops at
     * neighborhood on purpose: a day's activity is never an entire city, and
     * including `place`/`locality` lets the API answer "Yu Garden" with
     * "Shanghai" when it has no POI coverage in the area. Callers geocoding an
     * actual city (rather than a stop within one) must pass those types in.
     */
    types?: string;
}

/**
 * Forward-geocode one query string.
 *
 * Uses the Search Box API rather than Geocoding v6 because v6 has no `poi`
 * layer, and nearly everything an itinerary names ("Yu Garden", "Long Museum")
 * is a POI, not an address. Search Box resolves those directly, which is what
 * lets the caller stop mangling activity titles into address-shaped strings.
 *
 * NOTE ON STORAGE: results from this endpoint are cached onto trip documents.
 * Mapbox's terms distinguish temporary from permanent (stored) geocoding, and
 * permanent geocoding is a separate SKU. Confirm the plan covers it before
 * relying on this in production at volume.
 */
export async function mapboxForwardGeocode(
    query: string,
    options: MapboxGeocodeOptions = {}
): Promise<MapboxGeocodeResult | null> {
    const q = query.trim();
    if (!q) return null;

    const body = await mapboxFetch(
        "/search/searchbox/v1/forward",
        {
            q: q.slice(0, 256), // Search Box caps query length.
            limit: 1,
            language: options.language || "en",
            types: options.types || "poi,address,street,neighborhood",
            proximity: options.proximity
                ? `${options.proximity.lng},${options.proximity.lat}`
                : undefined,
            bbox: options.bbox
                ? `${options.bbox.minLng},${options.bbox.minLat},${options.bbox.maxLng},${options.bbox.maxLat}`
                : undefined,
            country: options.country ? options.country.toLowerCase() : undefined,
        },
        "geocode"
    );

    // An empty `features` array is a legitimate "no match"; a body without one
    // at all means the response shape moved.
    if (body && !Array.isArray(body.features)) return warnUnparsed("geocode", body);

    const feature = body?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
        lat,
        lng,
        countryCode: String(feature?.properties?.context?.country?.country_code || "").toLowerCase(),
        name: String(feature?.properties?.name || ""),
        featureType: String(feature?.properties?.feature_type || ""),
    };
}

// ---------------------------------------------------------------------------
// 2. Directions
// ---------------------------------------------------------------------------

export interface RouteLeg {
    distanceKm: number;
    durationMin: number;
}

export interface MapboxRoute {
    legs: RouteLeg[];
    totalKm: number;
    totalMinutes: number;
    /**
     * The route's street-following shape as a precision-5 encoded polyline -
     * the exact format both the Static Images path overlay and the client's
     * polyline decoder expect.
     */
    geometry: string | null;
}

/**
 * Route through every point in order, in ONE request.
 *
 * Replaces the previous approach of calling a router once per consecutive pair:
 * a 6-stop day was 5 sequential round-trips, this is 1. It also returns the
 * real walked geometry, so maps can draw the path along streets instead of
 * straight lines cutting through buildings.
 */
export async function mapboxDirections(
    points: MapboxPoint[],
    profile: MapboxProfile = "walking"
): Promise<MapboxRoute | null> {
    if (points.length < 2 || points.length > MAX_DIRECTIONS_COORDS) return null;

    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const body = await mapboxFetch(
        `/directions/v5/mapbox/${profile}/${encodeURIComponent(coords)}`,
        { geometries: "polyline", overview: "full", steps: "false" },
        "directions"
    );

    // A non-"Ok" code is a real answer ("NoRoute", "NoSegment"); a missing code
    // or an "Ok" with no route is a shape change.
    const route = body?.code === "Ok" ? body?.routes?.[0] : null;
    if (!route) return body && (body.code === undefined || body.code === "Ok")
        ? warnUnparsed("directions", body)
        : null;

    const legs: RouteLeg[] = Array.isArray(route.legs)
        ? route.legs.map((leg: any) => ({
              distanceKm: Number(leg?.distance) / 1000 || 0,
              durationMin: Number(leg?.duration) / 60 || 0,
          }))
        : [];

    return {
        legs,
        totalKm: Number(route.distance) / 1000 || 0,
        totalMinutes: Number(route.duration) / 60 || 0,
        geometry: typeof route.geometry === "string" ? route.geometry : null,
    };
}

// ---------------------------------------------------------------------------
// 3. Optimization (travelling-salesman ordering)
// ---------------------------------------------------------------------------

export interface MapboxOptimization extends MapboxRoute {
    /**
     * Input indices in their optimal visiting order - `order[0]` is the index
     * of the stop to visit first. Always a permutation of 0..points.length-1.
     */
    order: number[];
}

/**
 * Reorder stops into the shortest route that visits all of them.
 *
 * Pins the first and last stops (`source=first`, `destination=last`) rather
 * than optimizing them freely: a travel day starts where the traveller wakes up
 * and usually ends at dinner, so letting those float produces a shorter route
 * that reads as nonsense. Everything in between is free to move.
 *
 * Returns null above MAX_OPTIMIZATION_COORDS stops - the API's hard ceiling.
 */
export async function mapboxOptimize(
    points: MapboxPoint[],
    profile: MapboxProfile = "walking"
): Promise<MapboxOptimization | null> {
    if (points.length < 3 || points.length > MAX_OPTIMIZATION_COORDS) return null;

    const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const body = await mapboxFetch(
        `/optimized-trips/v1/mapbox/${profile}/${encodeURIComponent(coords)}`,
        {
            source: "first",
            destination: "last",
            roundtrip: "false",
            geometries: "polyline",
            overview: "full",
        },
        "optimize"
    );

    const trip = body?.code === "Ok" ? body?.trips?.[0] : null;
    const waypoints = body?.waypoints;
    if (!trip || !Array.isArray(waypoints) || waypoints.length !== points.length) {
        return body && (body.code === undefined || body.code === "Ok")
            ? warnUnparsed("optimize", body)
            : null;
    }

    // `waypoints` comes back in INPUT order, each carrying the position it
    // occupies in the optimized trip. Invert that into visiting order.
    const order: number[] = new Array(points.length).fill(-1);
    for (let inputIndex = 0; inputIndex < waypoints.length; inputIndex++) {
        const position = Number(waypoints[inputIndex]?.waypoint_index);
        if (!Number.isInteger(position) || position < 0 || position >= points.length) return null;
        if (order[position] !== -1) return null; // duplicate position - bad response
        order[position] = inputIndex;
    }
    if (order.some((i) => i === -1)) return null;

    const legs: RouteLeg[] = Array.isArray(trip.legs)
        ? trip.legs.map((leg: any) => ({
              distanceKm: Number(leg?.distance) / 1000 || 0,
              durationMin: Number(leg?.duration) / 60 || 0,
          }))
        : [];

    return {
        order,
        legs,
        totalKm: Number(trip.distance) / 1000 || 0,
        totalMinutes: Number(trip.duration) / 60 || 0,
        geometry: typeof trip.geometry === "string" ? trip.geometry : null,
    };
}

// ---------------------------------------------------------------------------
// 4. Isochrone (reachability contours)
// ---------------------------------------------------------------------------

/** One reachability contour: everywhere you can get to within `minutes`. */
export interface Isochrone {
    minutes: number;
    /**
     * Polygon rings, each an array of [lng, lat] pairs. Usually one ring, but
     * the API can return several disjoint areas (islands, across a river).
     */
    rings: [number, number][][];
}

/** Isochrone contours are capped at 60 minutes per request. */
const MAX_CONTOUR_MINUTES = 60;

/**
 * "Everything within an N-minute walk of here", as polygons.
 *
 * Powers walkability scoring (how much of a day sits inside one walk of its
 * first stop) and the map screen's reachability overlay.
 */
export async function mapboxIsochrone(
    center: MapboxPoint,
    contourMinutes: number[],
    profile: MapboxProfile = "walking"
): Promise<Isochrone[] | null> {
    const minutes = contourMinutes
        .map((m) => Math.round(m))
        .filter((m) => m > 0 && m <= MAX_CONTOUR_MINUTES)
        .sort((a, b) => a - b)
        .slice(0, 4); // API allows at most 4 contours per request.
    if (minutes.length === 0) return null;

    const body = await mapboxFetch(
        `/isochrone/v1/mapbox/${profile}/${encodeURIComponent(`${center.lng.toFixed(6)},${center.lat.toFixed(6)}`)}`,
        { contours_minutes: minutes.join(","), polygons: "true", denoise: 1 },
        "isochrone"
    );

    const features = body?.features;
    if (!Array.isArray(features) || features.length === 0) {
        return body ? warnUnparsed("isochrone", body) : null;
    }

    const out: Isochrone[] = [];
    for (const feature of features) {
        const contour = Number(feature?.properties?.contour);
        const geometry = feature?.geometry;
        if (!Number.isFinite(contour) || !geometry) continue;

        // `polygons=true` yields Polygon; disjoint areas come back as MultiPolygon.
        const rings: [number, number][][] =
            geometry.type === "Polygon"
                ? geometry.coordinates
                : geometry.type === "MultiPolygon"
                  ? geometry.coordinates.flat()
                  : [];
        if (rings.length === 0) continue;
        out.push({ minutes: contour, rings });
    }

    // Mapbox returns contours largest-first; ascending reads better everywhere else.
    out.sort((a, b) => a.minutes - b.minutes);
    return out.length > 0 ? out : null;
}

/** Ray-casting point-in-polygon over an isochrone's rings. */
export function isInsideIsochrone(point: MapboxPoint, isochrone: Isochrone): boolean {
    for (const ring of isochrone.rings) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            const straddles = yi > point.lat !== yj > point.lat;
            if (straddles && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        if (inside) return true;
    }
    return false;
}
