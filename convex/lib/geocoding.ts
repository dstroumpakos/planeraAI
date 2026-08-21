// Server-side geocoding + static day-route map generation.
//
// Mirrors the client-side geocoding that app/trip/map.tsx already does
// on-demand for whichever day is on screen, but runs once at trip-generation
// (or backfill) time for every day, so results can be cached on the trip
// document instead of being re-fetched from Nominatim/OSRM on every visit.
//
// Geocoding (Nominatim) and walking routes (OSRM) are free, public and
// unauthenticated, matching what map.tsx already relies on. They're rate-limited
// community infrastructure, not production SLA services — callers must treat
// failures as expected and degrade gracefully (leave fields null), never throw.
//
// The static map image is the one piece that needs a key: it comes from Mapbox
// and requires MAPBOX_TOKEN in the Convex environment. See buildStaticMapUrl.

import { getDistanceMeters } from "../helpers/geo";

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

const MAX_DISTANCE_KM = 80;

/**
 * Geocode a single activity. Two strategies (address+destination, then
 * title+destination) — a trimmed-down version of map.tsx's multi-strategy
 * search, since this runs for every activity across every day instead of
 * just the one day a user has open, and each extra strategy is another
 * sequential Nominatim round-trip.
 */
export async function geocodeActivityServer(
    activity: { title?: string; address?: string },
    destination: string,
    destCenter: DestCenter | null
): Promise<GeoPoint | null> {
    const queries: string[] = [];
    if (activity.address) queries.push(`${activity.address}, ${destination}`);
    if (activity.title) queries.push(`${activity.title}, ${destination}`);
    if (queries.length === 0) return null;

    let viewboxParam = "";
    let countryParam = "";
    if (destCenter) {
        const delta = 0.5;
        viewboxParam = `&viewbox=${destCenter.lng - delta},${destCenter.lat + delta},${destCenter.lng + delta},${destCenter.lat - delta}&bounded=1`;
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
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                if (destCenter && haversineKm(destCenter, { lat, lng }) > MAX_DISTANCE_KM) continue;
                return { lat, lng };
            }
        } catch (e) {
            console.error("[geocoding] activity geocode failed:", e);
        }
    }
    return null;
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

/**
 * Encode a point list as a Google-algorithm polyline (precision 5) — the
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

/** Planera yellow, as Mapbox wants it (hex, no leading #). */
const MAP_ACCENT = "FFE500";
/** Dark basemap, to match the share card's palette. */
const MAP_STYLE = "mapbox/dark-v11";

/**
 * Build a static day-route map image URL: a route line through the day's stops
 * plus a numbered pin at each one, framed automatically to fit them all.
 *
 * Uses Mapbox's Static Images API, which needs MAPBOX_TOKEN set in the Convex
 * environment. Returns null when the token is missing, so a misconfigured
 * deployment degrades to "no map" instead of emitting a URL that 401s.
 *
 * The token is embedded in the URL, which is stored on the trip document and
 * read by the client — so this must be a PUBLIC (`pk.`) token, ideally
 * URL-restricted in the Mapbox dashboard. Never put a secret (`sk.`) token here.
 *
 * (The previous implementation called staticmap.openstreetmap.de, which has
 * since been decommissioned — the host no longer resolves, so every URL it
 * produced was a broken image. The client keeps its own OpenStreetMap-tile
 * renderer as a fallback for when this returns null.)
 */
export function buildStaticMapUrl(
    points: GeoPoint[],
    token: string | undefined,
    width = 640,
    height = 400
): string | null {
    if (points.length === 0 || !token) return null;

    const overlays: string[] = [];
    if (points.length >= 2) {
        overlays.push(`path-4+${MAP_ACCENT}-0.9(${encodeURIComponent(encodePolyline(points))})`);
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
}

/**
 * True for map URLs pointing at staticmap.openstreetmap.de, the decommissioned
 * renderer this module used to call. Those were cached on trip documents before
 * the host went away, and are permanently broken images — treat them as missing
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
}

/**
 * Geocode every activity in a single day and build its static map + route
 * totals. Best-effort throughout — a failure on one activity or leg never
 * throws, it just leaves that piece null/zero so the day still saves with
 * whatever data succeeded.
 */
export async function buildDayMapData(
    activities: { title?: string; address?: string; lat?: number | null; lng?: number | null }[],
    destination: string,
    destCenter: DestCenter | null,
    mapboxToken?: string
): Promise<DayMapResult> {
    const activityCoords: (GeoPoint | null)[] = [];
    for (const activity of activities) {
        if (typeof activity.lat === "number" && typeof activity.lng === "number") {
            activityCoords.push({ lat: activity.lat, lng: activity.lng });
            continue;
        }
        const point = await geocodeActivityServer(activity, destination, destCenter);
        activityCoords.push(point);
    }

    const points = activityCoords.filter((p): p is GeoPoint => p !== null);
    let totalKm = 0;
    let walkMinutes = 0;
    for (let i = 1; i < points.length; i++) {
        const leg = await fetchWalkingLegServer(points[i - 1], points[i]);
        totalKm += leg.distanceKm;
        walkMinutes += leg.durationMin;
    }

    return {
        activityCoords,
        mapImageUrl: buildStaticMapUrl(points, mapboxToken),
        totalKm,
        walkMinutes,
    };
}
