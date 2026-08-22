// Server-side geocoding + static day-route map generation.
//
// Mirrors the client-side geocoding that app/trip/map.tsx already does
// on-demand for whichever day is on screen, but runs once at trip-generation
// (or backfill) time for every day, so results can be cached on the trip
// document instead of being re-fetched on every visit.
//
// TWO TIERS. When MAPBOX_TOKEN (or MAPBOX_SERVER_TOKEN) is set, geocoding,
// routing, stop-ordering and reachability all go through Mapbox - see
// lib/mapbox.ts. Without it, everything falls back to the free public services
// this module originally used: Nominatim for geocoding and the OSRM demo server
// for walking legs. Those are rate-limited community infrastructure with no
// SLA, so the fallback path is deliberately slow (Nominatim's usage policy caps
// it at 1 request/second) and every failure degrades to null rather than
// throwing.
//
// The practical difference: a 7-day trip with 5 activities a day costs ~35s of
// mandated sleeping on the Nominatim path, and runs fully parallel on Mapbox.

import { getDistanceMeters } from "../helpers/geo";
import {
    hasMapbox,
    isInsideIsochrone,
    mapboxDirections,
    mapboxForwardGeocode,
    mapboxIsochrone,
    mapboxOptimize,
    MAX_DIRECTIONS_COORDS,
    MAX_OPTIMIZATION_COORDS,
    type MapboxProfile,
} from "./mapbox";

const NOMINATIM_HEADERS = {
    "User-Agent": "PlaneraApp/1.0 (support@planeraai.app)",
    "Accept-Language": "en",
};

export interface GeoPoint {
    lat: number;
    lng: number;
}

export interface DestCenter extends GeoPoint {
    countryCode: string;
}

/** Haversine distance in km between two points. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
    return getDistanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
}

/** Geocode the destination city to get a center point + country code (biases activity search). */
export async function geocodeDestinationServer(destination: string): Promise<DestCenter | null> {
    if (hasMapbox()) {
        // `place` first: a destination string is a city, and asking for POIs
        // here would happily return a restaurant named after the city.
        const hit = await mapboxForwardGeocode(destination, { types: "place,locality,region,country" });
        if (hit) return { lat: hit.lat, lng: hit.lng, countryCode: hit.countryCode };
    }

    try {
        const response = await fetch(
            "https://nominatim.openstreetmap.org/search?format=json&q=" +
                encodeURIComponent(destination) +
                "&limit=1&addressdetails=1",
            { headers: NOMINATIM_HEADERS }
        );
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                countryCode: data[0].address?.country_code || "",
            };
        }
    } catch (e) {
        console.error("[geocoding] destination geocode failed:", e);
    }
    return null;
}

/**
 * Turn an itinerary activity title into something a gazetteer can match.
 *
 * The itinerary AI writes descriptive titles, not place names - "Yu Garden
 * (Yuyuan) + classical garden architecture", "Day trip: Zhujiajiao Water Town
 * (canals, bridges)", "Long Museum (West Bund) - modern & classical Chinese
 * art". Nominatim finds none of those, but finds "Yu Garden" and "Long Museum"
 * immediately, so the decoration is what's blocking the match.
 *
 * Mapbox's Search Box tolerates far more of this decoration than Nominatim
 * does, but stripping it still helps both, so it runs on either path.
 *
 * Returns "" when nothing place-like survives (e.g. "Check-in + decompress"),
 * which callers should treat as "don't bother querying".
 */
export function cleanPlaceQuery(title: string): string {
    let out = title.trim();
    if (!out) return "";

    // "Day trip: Zhujiajiao Water Town" / "Nightlife: cocktail bar crawl" -
    // the label is before the colon, the place after it.
    const colon = out.indexOf(":");
    if (colon !== -1 && colon < out.length - 1) out = out.slice(colon + 1);

    // Everything after a description separator is commentary, not the name.
    // (Hyphens only count when spaced, so "Check-in" and "Jing'an-style" survive.)
    out = out.split(/\s+[+|·]\s+|\s+[—–]\s+|\s+-\s+/)[0];

    // Parentheses hold translations or districts, which usually hurt the match.
    out = out.replace(/\([^)]*\)/g, " ");

    // Leading verbs and connectives the AI habitually prefixes.
    out = out.replace(/^\s*(?:optional|visit|explore|discover|enjoy|see|tour)\b\s*/i, "");
    out = out.replace(/^\s*(?:at|in)\b\s+/i, "");

    out = out.replace(/\s+/g, " ").replace(/^[\s,\-—–]+|[\s,\-—–]+$/g, "").trim();

    // Too short to be a place name once stripped.
    return out.length < 3 ? "" : out;
}

const MAX_DISTANCE_KM = 80;
/** Half-width of the search box around the destination center, in degrees. */
const SEARCH_BOX_DELTA = 0.5;

/**
 * The query strings to try for one activity, most-likely-to-match first.
 *
 * `suffixDestination` appends ", <destination>" to each query, which is how
 * Nominatim wants to be told where to look - it parses comma-structured address
 * strings. Mapbox's Search Box must NOT get the suffix: it token-matches
 * against POI names, so "Sagrada Familia, Barcelona" scores a restaurant
 * literally named "La Chula Restaurante | Sagrada Familia, Barcelona" above the
 * basilica, while the bare "Sagrada Familia" resolves correctly. Search Box
 * gets its location constraint from proximity/bbox/country instead.
 */
function activityQueries(
    activity: { title?: string; address?: string },
    destination: string,
    suffixDestination: boolean
): string[] {
    const suffix = (q: string) => (suffixDestination ? `${q}, ${destination}` : q);
    const queries: string[] = [];
    if (activity.address) queries.push(suffix(activity.address));
    const cleaned = activity.title ? cleanPlaceQuery(activity.title) : "";
    if (cleaned) queries.push(suffix(cleaned));
    // The undecorated title, in the rare case cleaning removed the useful part.
    if (activity.title && activity.title.trim() !== cleaned) {
        queries.push(suffix(activity.title.trim()));
    }
    return queries;
}

/**
 * Feature layers that describe a whole city or larger.
 *
 * A day's activity is never one of these, so a hit at this level means the
 * geocoder found nothing matching and fell back to the area it was pointed at -
 * observed live for Shanghai, where Mapbox has effectively no POI coverage and
 * every query inside the bbox came back as the feature "Shanghai". Left
 * unchecked, that geocodes every stop in a day to the same city-centre point:
 * a zero-length route and a map with all the pins stacked on top of each other.
 * Treating it as a miss is what sends those days to the Nominatim fallback.
 */
const DESTINATION_LEVEL_TYPES = new Set(["place", "locality", "region", "district", "country", "postcode"]);

/** Reject a hit that landed in another city entirely (a same-named place elsewhere). */
function withinDestination(point: GeoPoint, destCenter: DestCenter | null): boolean {
    return !destCenter || haversineKm(destCenter, point) <= MAX_DISTANCE_KM;
}

/** Geocode one activity through Mapbox. Null when nothing plausible matched. */
async function geocodeActivityMapbox(
    activity: { title?: string; address?: string },
    destination: string,
    destCenter: DestCenter | null,
    language?: string
): Promise<GeoPoint | null> {
    const queries = activityQueries(activity, destination, false);
    if (queries.length === 0) return null;

    const bbox = destCenter
        ? {
              minLng: destCenter.lng - SEARCH_BOX_DELTA,
              minLat: destCenter.lat - SEARCH_BOX_DELTA,
              maxLng: destCenter.lng + SEARCH_BOX_DELTA,
              maxLat: destCenter.lat + SEARCH_BOX_DELTA,
          }
        : undefined;

    for (const q of queries) {
        const hit = await mapboxForwardGeocode(q, {
            proximity: destCenter ?? undefined,
            bbox,
            country: destCenter?.countryCode || undefined,
            language,
        });
        if (!hit) continue;
        if (DESTINATION_LEVEL_TYPES.has(hit.featureType)) continue;
        if (!withinDestination(hit, destCenter)) continue;
        return { lat: hit.lat, lng: hit.lng };
    }
    return null;
}

/**
 * Geocode one activity through Nominatim.
 *
 * Sleeps between attempts to honour the 1 req/sec usage policy, so callers must
 * never run this concurrently - that is what gets a deployment blocked.
 */
async function geocodeActivityNominatim(
    activity: { title?: string; address?: string },
    destination: string,
    destCenter: DestCenter | null
): Promise<GeoPoint | null> {
    const queries = activityQueries(activity, destination, true);
    if (queries.length === 0) return null;

    let viewboxParam = "";
    let countryParam = "";
    if (destCenter) {
        const d = SEARCH_BOX_DELTA;
        viewboxParam = `&viewbox=${destCenter.lng - d},${destCenter.lat + d},${destCenter.lng + d},${destCenter.lat - d}&bounded=1`;
        if (destCenter.countryCode) countryParam = `&countrycodes=${destCenter.countryCode}`;
    }

    for (const q of queries) {
        try {
            // Respect Nominatim's 1 req/sec usage policy across sequential calls.
            await new Promise((r) => setTimeout(r, 1050));
            const url =
                "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
                encodeURIComponent(q) +
                viewboxParam +
                countryParam;
            const res = await fetch(url, { headers: NOMINATIM_HEADERS });
            const data = await res.json();
            if (data && data.length > 0) {
                const point = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                if (!withinDestination(point, destCenter)) continue;
                return point;
            }
        } catch (e) {
            console.error("[geocoding] activity geocode failed:", e);
        }
    }
    return null;
}

/**
 * Geocode a single activity: Mapbox when configured, Nominatim otherwise (and
 * as a retry when Mapbox finds nothing, since a miss and an outage look the
 * same from here and neither should lose the stop).
 *
 * Safe to run concurrently only when Mapbox is configured - the Nominatim leg
 * is rate-limited by a sleep. Prefer geocodeActivitiesServer, which picks the
 * right concurrency for whichever path is live.
 */
export async function geocodeActivityServer(
    activity: { title?: string; address?: string },
    destination: string,
    destCenter: DestCenter | null,
    language?: string
): Promise<GeoPoint | null> {
    if (hasMapbox()) {
        const hit = await geocodeActivityMapbox(activity, destination, destCenter, language);
        if (hit) return hit;
    }
    return geocodeActivityNominatim(activity, destination, destCenter);
}

/**
 * Geocode a whole day's activities, in the same order as the input.
 *
 * Parallel on the Mapbox path (its rate limit is per-minute, not per-second, so
 * a day's worth of stops resolves in roughly one round-trip); strictly
 * sequential on the Nominatim fallback, where concurrency would get the
 * deployment blocked.
 */
export async function geocodeActivitiesServer(
    activities: { title?: string; address?: string; lat?: number | null; lng?: number | null }[],
    destination: string,
    destCenter: DestCenter | null,
    language?: string
): Promise<(GeoPoint | null)[]> {
    // Activities that already carry coordinates never need a lookup.
    const cached = activities.map((a) =>
        typeof a?.lat === "number" && typeof a?.lng === "number"
            ? ({ lat: a.lat, lng: a.lng } as GeoPoint)
            : null
    );

    if (hasMapbox()) {
        const results = await Promise.all(
            activities.map((activity, i) =>
                cached[i]
                    ? Promise.resolve(cached[i])
                    : geocodeActivityMapbox(activity, destination, destCenter, language).catch(() => null)
            )
        );
        // Anything Mapbox missed gets one sequential Nominatim retry - straight
        // to Nominatim, not back through geocodeActivityServer, which would
        // re-ask Mapbox the question it just answered with "no". Cheap because
        // misses are rare; it is not the whole day at 1 req/sec.
        for (let i = 0; i < results.length; i++) {
            if (results[i]) continue;
            results[i] = await geocodeActivityNominatim(activities[i], destination, destCenter)
                .catch(() => null);
        }
        return results;
    }

    const out: (GeoPoint | null)[] = [];
    for (let i = 0; i < activities.length; i++) {
        if (cached[i]) {
            out.push(cached[i]);
            continue;
        }
        out.push(await geocodeActivityNominatim(activities[i], destination, destCenter).catch(() => null));
    }
    return out;
}

/** Real walking distance/time via OSRM; haversine estimate when the router is unreachable. */
export async function fetchWalkingLegServer(
    from: GeoPoint,
    to: GeoPoint
): Promise<{ distanceKm: number; durationMin: number }> {
    try {
        const url =
            "https://router.project-osrm.org/route/v1/foot/" +
            `${from.lng},${from.lat};${to.lng},${to.lat}` +
            "?overview=false";
        const res = await fetch(url);
        const data = await res.json();
        if (data.code === "Ok" && data.routes?.length > 0) {
            const route = data.routes[0];
            return {
                distanceKm: typeof route.distance === "number" ? route.distance / 1000 : 0,
                durationMin: typeof route.duration === "number" ? route.duration / 60 : 0,
            };
        }
    } catch (e) {
        console.error("[geocoding] OSRM leg fetch failed:", e);
    }
    const km = haversineKm(from, to);
    return { distanceKm: km, durationMin: (km / 4.5) * 60 };
}

export interface RouteResult {
    /** One entry per consecutive pair of stops, so `legs.length === points.length - 1`. */
    legs: { distanceKm: number; durationMin: number }[];
    totalKm: number;
    totalMinutes: number;
    /**
     * Precision-5 encoded polyline of the route as actually walked, or null on
     * the fallback path (which only knows leg totals, not shapes). Null means
     * "draw straight lines between the stops".
     */
    geometry: string | null;
}

/**
 * Route through a day's stops in order.
 *
 * One Mapbox Directions request when configured - versus one OSRM round-trip
 * per consecutive pair on the fallback path - and it returns the real
 * street-following shape, which the static map draws instead of straight lines.
 */
export async function fetchRouteServer(
    points: GeoPoint[],
    profile: MapboxProfile = "walking"
): Promise<RouteResult> {
    const empty: RouteResult = { legs: [], totalKm: 0, totalMinutes: 0, geometry: null };
    if (points.length < 2) return empty;

    if (hasMapbox() && points.length <= MAX_DIRECTIONS_COORDS) {
        const route = await mapboxDirections(points, profile);
        // Trust the response only if it actually covers every leg.
        if (route && route.legs.length === points.length - 1) {
            return {
                legs: route.legs,
                totalKm: route.totalKm,
                totalMinutes: route.totalMinutes,
                geometry: route.geometry,
            };
        }
    }

    const legs: { distanceKm: number; durationMin: number }[] = [];
    let totalKm = 0;
    let totalMinutes = 0;
    for (let i = 1; i < points.length; i++) {
        const leg = await fetchWalkingLegServer(points[i - 1], points[i]);
        legs.push(leg);
        totalKm += leg.distanceKm;
        totalMinutes += leg.durationMin;
    }
    return { legs, totalKm, totalMinutes, geometry: null };
}

export interface OptimizedRoute {
    /** Stop indices in their optimal visiting order. */
    order: number[];
    /** Route length/duration in the CURRENT order. */
    currentKm: number;
    currentMinutes: number;
    /** Route length/duration in the OPTIMIZED order. */
    optimizedKm: number;
    optimizedMinutes: number;
    geometry: string | null;
}

/**
 * Work out the shortest order to visit a day's stops, and what it saves.
 *
 * Returns null when there is nothing to decide (fewer than 3 stops), when the
 * day exceeds the Optimization API's coordinate ceiling, or when Mapbox is
 * unavailable - there is no free fallback for this, and a hand-rolled
 * nearest-neighbour pass over straight-line distances would produce confidently
 * wrong suggestions in any city with a river or a one-way grid.
 *
 * `order` may come back as the identity permutation, which is a real answer:
 * the day is already optimal. Callers should compare the two totals rather than
 * assuming a non-null result is worth applying.
 */
export async function optimizeStopOrder(
    points: GeoPoint[],
    profile: MapboxProfile = "walking"
): Promise<OptimizedRoute | null> {
    if (points.length < 3 || points.length > MAX_OPTIMIZATION_COORDS) return null;
    if (!hasMapbox()) return null;

    const optimized = await mapboxOptimize(points, profile);
    if (!optimized) return null;

    const current = await fetchRouteServer(points, profile);

    return {
        order: optimized.order,
        currentKm: current.totalKm,
        currentMinutes: current.totalMinutes,
        optimizedKm: optimized.totalKm,
        optimizedMinutes: optimized.totalMinutes,
        geometry: optimized.geometry,
    };
}

export interface Walkability {
    /** The contour used, in minutes of walking. */
    minutes: number;
    /** How many of the day's stops fall inside that contour. */
    walkableStops: number;
    totalStops: number;
    /** Polygon rings of the contour ([lng, lat] pairs), for drawing on a map. */
    rings: [number, number][][];
}

/** Default reachability contour - "a quarter of an hour on foot" reads well in UI. */
const DEFAULT_WALK_MINUTES = 15;

/**
 * How much of a day sits within one short walk of where it starts.
 *
 * Anchored on the first stop rather than the day's centroid: the first stop is
 * where the traveller actually begins (usually at or near the hotel), so "3 of
 * your 5 stops are within a 15-minute walk" describes their morning, whereas a
 * centroid describes a point they may never stand on.
 *
 * Mapbox-only - returns null without it, since there is no free isochrone service.
 */
export async function computeWalkability(
    points: GeoPoint[],
    minutes: number = DEFAULT_WALK_MINUTES,
    profile: MapboxProfile = "walking"
): Promise<Walkability | null> {
    if (points.length < 2 || !hasMapbox()) return null;

    const contours = await mapboxIsochrone(points[0], [minutes], profile);
    const contour = contours?.[0];
    if (!contour) return null;

    // The anchor is trivially inside its own contour, so it counts.
    let walkableStops = 1;
    for (let i = 1; i < points.length; i++) {
        if (isInsideIsochrone(points[i], contour)) walkableStops++;
    }

    return {
        minutes: contour.minutes,
        walkableStops,
        totalStops: points.length,
        rings: contour.rings,
    };
}

/**
 * Encode a point list as a Google-algorithm polyline (precision 5) - the
 * compact form Mapbox's Static Images API wants for a route overlay.
 */
function encodePolyline(points: GeoPoint[]): string {
    let lastLat = 0;
    let lastLng = 0;
    let out = "";

    const encodeValue = (value: number) => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        while (v >= 0x20) {
            out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        out += String.fromCharCode(v + 63);
    };

    for (const p of points) {
        const lat = Math.round(p.lat * 1e5);
        const lng = Math.round(p.lng * 1e5);
        encodeValue(lat - lastLat);
        encodeValue(lng - lastLng);
        lastLat = lat;
        lastLng = lng;
    }
    return out;
}

/**
 * Decode a precision-5 polyline back into points - the inverse of
 * encodePolyline, for clients that need to draw a stored route geometry as a
 * native map overlay rather than as an image.
 */
export function decodePolyline(encoded: string): GeoPoint[] {
    const points: GeoPoint[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        const readValue = () => {
            let result = 0;
            let shift = 0;
            let byte: number;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20 && index < encoded.length);
            return result & 1 ? ~(result >> 1) : result >> 1;
        };
        lat += readValue();
        lng += readValue();
        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
}

/** Planera yellow, as Mapbox wants it (hex, no leading #). */
const MAP_ACCENT = "FFE500";
/** Dark basemap, to match the share card's palette. */
const MAP_STYLE = "mapbox/dark-v11";
/**
 * Static Images caps the whole URL at 8192 characters. A full-detail walking
 * geometry can blow past that on a long day, so an over-long one is dropped in
 * favour of straight lines rather than producing a request that 413s.
 */
const MAX_STATIC_URL_LENGTH = 8000;

/**
 * Build a static day-route map image URL: a route line through the day's stops
 * plus a numbered pin at each one, framed automatically to fit them all.
 *
 * Pass `routeGeometry` (the encoded polyline from fetchRouteServer) to draw the
 * path as actually walked; without it the line is drawn straight between stops,
 * which cuts through buildings and understates the walk.
 *
 * Uses Mapbox's Static Images API, which needs MAPBOX_TOKEN set in the Convex
 * environment. Returns null when the token is missing, so a misconfigured
 * deployment degrades to "no map" instead of emitting a URL that 401s.
 *
 * The token is embedded in the URL, which is stored on the trip document and
 * read by the client - so this must be a PUBLIC (`pk.`) token, ideally
 * URL-restricted in the Mapbox dashboard. Never put a secret (`sk.`) token here.
 * (Server-side calls in lib/mapbox.ts read MAPBOX_SERVER_TOKEN instead, which
 * is free to be a secret token since those responses never leave the backend.)
 *
 * (The original implementation called staticmap.openstreetmap.de, which has
 * since been decommissioned - the host no longer resolves, so every URL it
 * produced was a broken image. The client keeps its own OpenStreetMap-tile
 * renderer as a fallback for when this returns null.)
 */
export function buildStaticMapUrl(
    points: GeoPoint[],
    token: string | undefined,
    width = 640,
    height = 400,
    routeGeometry?: string | null
): string | null {
    if (points.length === 0 || !token) return null;

    const build = (geometry: string | null) => {
        const overlays: string[] = [];
        if (geometry) {
            overlays.push(`path-4+${MAP_ACCENT}-0.9(${encodeURIComponent(geometry)})`);
        }
        points.forEach((p, i) => {
            // Mapbox pin labels are a single character, so stops past the 9th go
            // unlabelled rather than rendering a broken marker.
            const label = i < 9 ? `-${i + 1}` : "";
            overlays.push(`pin-s${label}+${MAP_ACCENT}(${p.lng.toFixed(6)},${p.lat.toFixed(6)})`);
        });

        return (
            `https://api.mapbox.com/styles/v1/${MAP_STYLE}/static/` +
            `${overlays.join(",")}/auto/${width}x${height}@2x` +
            `?access_token=${encodeURIComponent(token)}&padding=40`
        );
    };

    const straightLine = points.length >= 2 ? encodePolyline(points) : null;
    if (routeGeometry) {
        const url = build(routeGeometry);
        if (url.length <= MAX_STATIC_URL_LENGTH) return url;
    }
    return build(straightLine);
}

/**
 * True for map URLs pointing at staticmap.openstreetmap.de, the decommissioned
 * renderer this module used to call. Those were cached on trip documents before
 * the host went away, and are permanently broken images - treat them as missing
 * so backfill regenerates them instead of skipping the day as "already done".
 */
export function isDeadMapUrl(url: unknown): boolean {
    return typeof url === "string" && url.includes("staticmap.openstreetmap.de");
}

export interface DayMapResult {
    /** Per-activity coordinates, in the same order as the input activities (null entries = geocode miss). */
    activityCoords: (GeoPoint | null)[];
    mapImageUrl: string | null;
    totalKm: number;
    walkMinutes: number;
    /** Encoded polyline of the walked route, or null when only stop coords are known. */
    routeGeometry: string | null;
    /** How many stops sit within a short walk of the day's first stop, or null when unavailable. */
    walkability: Walkability | null;
}

/**
 * Geocode every activity in a single day and build its static map, route
 * totals and walkability. Best-effort throughout - a failure on one activity,
 * leg or contour never throws, it just leaves that piece null/zero so the day
 * still saves with whatever data succeeded.
 */
export async function buildDayMapData(
    activities: { title?: string; address?: string; lat?: number | null; lng?: number | null }[],
    destination: string,
    destCenter: DestCenter | null,
    mapboxToken?: string,
    options: { language?: string; walkability?: boolean } = {}
): Promise<DayMapResult> {
    const activityCoords = await geocodeActivitiesServer(
        activities,
        destination,
        destCenter,
        options.language
    );

    const points = activityCoords.filter((p): p is GeoPoint => p !== null);
    const route = await fetchRouteServer(points);

    // One extra request per day, so it stays opt-in for bulk backfills.
    const walkability =
        options.walkability === false
            ? null
            : await computeWalkability(points).catch(() => null);

    return {
        activityCoords,
        mapImageUrl: buildStaticMapUrl(points, mapboxToken, 640, 400, route.geometry),
        totalKm: route.totalKm,
        walkMinutes: route.totalMinutes,
        routeGeometry: route.geometry,
        walkability,
    };
}
