// Web Mercator tile-map layout — enough geometry to draw a static map from raw
// OSM raster tiles, without a static-map service or an API key.
//
// This exists because the free static-map renderer the day-route share card
// used to call (staticmap.openstreetmap.de) was decommissioned: the host no
// longer resolves, so every generated map URL was a broken image. Rather than
// swap in another keyless service that can disappear the same way, the card now
// composes the map itself from tile.openstreetmap.org — the same tile server
// the OSM ecosystem is built on — and overlays its own markers and route line.
//
// Pure math, no React and no I/O, so it can be unit-checked against known tile
// numbers (Athens at z14 is 9271/6322).

export interface LatLng {
  lat: number;
  lng: number;
}

/** One tile to render, with its position in the map box's coordinate space. */
export interface TileRef {
  z: number;
  x: number;
  y: number;
  /** Offset of the tile's top-left corner from the map box's top-left, in points. */
  left: number;
  top: number;
}

export interface TileMapLayout {
  zoom: number;
  tiles: TileRef[];
  /** Rendered edge length of one tile, in points. */
  tileSize: number;
  /** Marker positions in the map box's coordinate space, in points. */
  points: { x: number; y: number }[];
}

/** OSM raster tiles are 256×256. */
const TILE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
/** Zoom used when there's only one point to show (no bounds to fit). */
const SINGLE_POINT_ZOOM = 15;

/** Project a coordinate to absolute world pixels at a given zoom. */
function project(point: LatLng, zoom: number): { x: number; y: number } {
  const worldSize = TILE * Math.pow(2, zoom);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  };
}

/**
 * Largest zoom at which every point fits inside `width`×`height` with `padding`
 * points of breathing room on each side. Walks down from MAX_ZOOM so the result
 * is the tightest framing that still shows the whole route.
 */
function fitZoom(points: LatLng[], width: number, height: number, padding: number): number {
  const usableW = Math.max(width - padding * 2, 1);
  const usableH = Math.max(height - padding * 2, 1);
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const projected = points.map((p) => project(p, z));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= usableW && spanY <= usableH) return z;
  }
  return MIN_ZOOM;
}

/**
 * Work out which tiles cover a `width`×`height` map box centred on `points`,
 * and where each point lands inside that box.
 *
 * Returns null when there's nothing to draw, so callers can fall back to a
 * plain gradient rather than rendering an empty grid.
 */
export function buildTileMap(
  points: LatLng[],
  width: number,
  height: number,
  options: { padding?: number; scale?: number } = {}
): TileMapLayout | null {
  const valid = points.filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (valid.length === 0 || width <= 0 || height <= 0) return null;

  const padding = options.padding ?? 28;
  // Tiles are drawn larger than 1:1 so the raster still looks sharp once the
  // card is captured at 3x. `scale` is how many rendered points one tile pixel
  // occupies; 1 keeps tiles at their native 256pt.
  const scale = options.scale ?? 1;

  const zoom =
    valid.length === 1
      ? SINGLE_POINT_ZOOM
      : fitZoom(valid, width / scale, height / scale, padding / scale);

  const projected = valid.map((p) => project(p, zoom));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Top-left of the map box, in world pixels.
  const originX = centerX - width / (2 * scale);
  const originY = centerY - height / (2 * scale);

  const tileCount = Math.pow(2, zoom);
  const tileSize = TILE * scale;
  const firstX = Math.floor(originX / TILE);
  const lastX = Math.floor((originX + width / scale - 1) / TILE);
  const firstY = Math.floor(originY / TILE);
  const lastY = Math.floor((originY + height / scale - 1) / TILE);

  const tiles: TileRef[] = [];
  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      // Above the north pole / below the south pole there is no tile at all.
      if (y < 0 || y >= tileCount) continue;
      tiles.push({
        z: zoom,
        // Longitude wraps, so a box straddling the antimeridian still resolves.
        x: ((x % tileCount) + tileCount) % tileCount,
        y,
        left: (x * TILE - originX) * scale,
        top: (y * TILE - originY) * scale,
      });
    }
  }

  return {
    zoom,
    tiles,
    tileSize,
    points: projected.map((p) => ({
      x: (p.x - originX) * scale,
      y: (p.y - originY) * scale,
    })),
  };
}

/**
 * Tile URL on the standard OSM tile server. Callers must send an identifying
 * User-Agent (see OSM's tile usage policy) and show the attribution the card
 * renders alongside the map.
 */
export function tileUrl(tile: TileRef): string {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

/** User-Agent for tile requests, matching what the server-side geocoder sends. */
export const TILE_HEADERS = {
  "User-Agent": "PlaneraApp/1.0 (support@planeraai.app)",
};

/** Required by OSM's tile usage policy — render this over or beside the map. */
export const TILE_ATTRIBUTION = "© OpenStreetMap";
