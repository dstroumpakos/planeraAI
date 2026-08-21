import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import {
  buildTileMap,
  tileUrl,
  TILE_HEADERS,
  TILE_ATTRIBUTION,
  type LatLng,
} from "../lib/staticMap";

// Logo asset (white text on transparent — works on dark backgrounds)
const logoAsset = require("@/assets/images/logo-a-stapr6.png");

// Card renders at 360×640pt, captured at 3x → 1080×1920 (9:16 — the same
// format as every other share slide, so the day-route card sits in the
// ShareTripCard pager without a ratio jump and exports as a normal story).
export const S = 3;
export const CARD_W = 1080 / S;
export const CARD_H = 1920 / S;

const AMBER = "#FFE500";
const WHITE = "#FFFFFF";
const DARK = "#121212";
const NAVY = "#1A1A1A";
const NAVY_LIGHT = "#2C2C2C";
const PANEL = "#15161C";

const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const SANS = Platform.select({ ios: "System", default: "sans-serif" });

/** Walking burns roughly 50 kcal per km for an average adult. */
const KCAL_PER_KM = 50;

/**
 * The static day-route maps are generated at 640×400 (see
 * convex/lib/geocoding.ts) and the interactive-map fallback snapshot at
 * 540×320 — both ≈1.6:1. Framing the map box at the same ratio means
 * contentFit="cover" never crops a stop marker off the edge.
 */
const MAP_ASPECT = 1.6;
/** Laid-out size of the map box — the card is a fixed width, so this is known. */
const MAP_W = CARD_W - (42 / S) * 2;
const MAP_H = MAP_W / MAP_ASPECT;
/** Route line thickness and stop-pin diameter for the self-drawn fallback map. */
const ROUTE_W = 6 / S;
const PIN_SIZE = 40 / S;

export interface RouteStop {
  title: string;
  /** Display time, e.g. "09:00 AM" */
  time?: string;
  image?: string;
  /** Walking distance in km from the previous stop (undefined for the first) */
  legKm?: number;
  /** Stop coordinates, used to draw the fallback map when `mapUri` is unusable. */
  lat?: number;
  lng?: number;
}

export interface ShareRouteData {
  destination: string;
  dayNumber: number;
  /** Total days in the trip — renders as "DAY 1 / 4", which hints there's more. */
  dayCount?: number;
  dayTitle: string;
  /** Trip day date (ms) */
  date?: number;
  travelers: number;
  stops: RouteStop[];
  /**
   * Pre-rendered static map image for this day's route (Mapbox, generated
   * server-side). When it's missing or fails to load, the card falls back to
   * drawing the map itself from the stops' coordinates.
   */
  mapUri?: string;
  totalKm: number;
  walkMinutes: number;
  /** Optional insider tip line shown at the bottom */
  tip?: string;
  /**
   * Full-bleed photo behind the card. Pass the trip's share-card photo so the
   * day slides match the rest of the pager; falls back to the day's first stop
   * image, then to a gradient.
   */
  backgroundUri?: string;
}

/**
 * Presentational body of the day-route share card: full-bleed photo, header
 * (logo/badge/day label/title), chips, map, stats, stop timeline and tip.
 * Pure function of `data` — no capture/share/modal logic here, so it can be
 * mounted both inside ShareRouteCard's on-demand single-day modal and inside
 * ShareTripCard's off-screen per-day pager slides without duplicating layout.
 */
export const ShareRouteCardBody: React.FC<{ data: ShareRouteData }> = ({ data }) => {
  const { t, i18n } = useTranslation();

  const locale =
    i18n.language === "el" ? "el-GR"
    : i18n.language === "es" ? "es-ES"
    : i18n.language === "fr" ? "fr-FR"
    : i18n.language === "de" ? "de-DE"
    : i18n.language === "ar" ? "ar-SA"
    : "en-US";

  const dateLabel = useMemo(() => {
    if (!data.date) return "";
    try {
      return new Date(data.date).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }, [data.date, locale]);

  const weekdayLabel = useMemo(() => {
    if (!data.date) return "";
    try {
      return new Date(data.date).toLocaleDateString(locale, { weekday: "long" });
    } catch {
      return "";
    }
  }, [data.date, locale]);

  const stats = useMemo(() => {
    const km = data.totalKm;
    const hours = data.walkMinutes / 60;
    const difficulty =
      km < 5 ? t("shareRoute.easy") : km < 10 ? t("shareRoute.moderate") : t("shareRoute.challenging");
    const bars = km < 5 ? 1 : km < 10 ? 2 : 3;
    return {
      distance: `~${km.toFixed(1)} km`,
      time: hours >= 1 ? `~${hours.toFixed(1)} ${t("shareRoute.hrs")}` : `~${Math.round(data.walkMinutes)} ${t("shareRoute.min")}`,
      calories: `~${Math.round((km * KCAL_PER_KM) / 10) * 10} kcal`,
      difficulty,
      bars,
    };
  }, [data.totalKm, data.walkMinutes, t]);

  const stops = data.stops.slice(0, 5);

  // The server-generated image is preferred, but it's a single remote URL and
  // has broken before (the previous provider was decommissioned), so a failed
  // load falls through to the tile map rather than leaving a dead panel.
  const [mapImageFailed, setMapImageFailed] = useState(false);
  const useMapImage = !!data.mapUri && !mapImageFailed;

  // Fallback map, composed from OpenStreetMap tiles using the stops' own
  // coordinates. MAP_W/MAP_H mirror the map box's laid-out size (the card is a
  // fixed 360pt wide, so these are known up front rather than measured).
  const tileMap = useMemo(
    () =>
      useMapImage
        ? null
        : buildTileMap(
            data.stops
              .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
              .map((s) => ({ lat: s.lat as number, lng: s.lng as number }) as LatLng),
            MAP_W,
            MAP_H,
            { padding: 30 / S }
          ),
    [useMapImage, data.stops]
  );
  // Trip photo first (keeps the day slides visually in step with the cover,
  // poster and itinerary slides), then the day's own first stop photo.
  const backgroundUri = data.backgroundUri || data.stops.find((s) => s.image)?.image;
  // "09:00 AM — 07:27 PM": the day's real span, straight off the stop times.
  const firstTime = data.stops.find((s) => s.time)?.time;
  const lastTime = [...data.stops].reverse().find((s) => s.time)?.time;
  const timeSpan =
    firstTime && lastTime && firstTime !== lastTime ? `${firstTime} — ${lastTime}` : firstTime || "";

  const statTiles: { key: string; icon?: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [
    { key: "distance", icon: "walk", label: t("shareRoute.totalDistance"), value: stats.distance },
    { key: "time", icon: "time-outline", label: t("shareRoute.walkingTime"), value: stats.time },
    { key: "calories", icon: "flash-outline", label: t("shareRoute.calories"), value: stats.calories },
    { key: "difficulty", label: t("shareRoute.difficulty"), value: stats.difficulty },
  ];

  return (
    <View style={styles.card}>
      {/* ── Full-bleed background ── */}
      {backgroundUri ? (
        <Image
          source={{ uri: backgroundUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <LinearGradient
          colors={[NAVY, NAVY_LIGHT, NAVY]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      )}
      <LinearGradient
        colors={["rgba(0,0,0,0.80)", "rgba(0,0,0,0.88)", "rgba(0,0,0,0.84)"]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* ── Logo ── */}
      <View style={styles.logoContainer}>
        <Image source={logoAsset} style={styles.logoImage} contentFit="contain" />
      </View>

      <View style={styles.content}>
        {/* ── Header ── */}
        <View style={styles.pill}>
          <Text style={styles.pillText}>{t("shareRoute.routeMap").toUpperCase()}</Text>
        </View>
        <View style={styles.dayLabelRow}>
          <Text style={styles.dayLabel}>{t("shareCard.day").toUpperCase()} {data.dayNumber}</Text>
          {!!data.dayCount && data.dayCount > 1 && (
            <Text style={styles.dayLabelTotal}>/ {data.dayCount}</Text>
          )}
        </View>
        <Text style={styles.dayTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.5}>
          {data.dayTitle.toUpperCase()}
        </Text>
        <Text style={styles.destination} numberOfLines={1}>{data.destination}</Text>
        <View style={styles.accentLine} />

        {/* ── Date + travellers chips ── */}
        <View style={styles.chipsRow}>
          {!!dateLabel && (
            <View style={styles.chip}>
              <Ionicons name="calendar-outline" size={30 / S} color={AMBER} />
              <View style={styles.chipBody}>
                <Text style={styles.chipValue} numberOfLines={1}>{dateLabel}</Text>
                {!!weekdayLabel && <Text style={styles.chipSub} numberOfLines={1}>{weekdayLabel}</Text>}
              </View>
            </View>
          )}
          <View style={styles.chip}>
            <Ionicons name="people-outline" size={30 / S} color={AMBER} />
            <View style={styles.chipBody}>
              <Text style={styles.chipValue} numberOfLines={1}>
                {data.travelers} {t("shareCard.travelers")}
              </Text>
              {!!timeSpan && <Text style={styles.chipSub} numberOfLines={1}>{timeSpan}</Text>}
            </View>
          </View>
        </View>

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          {useMapImage ? (
            <Image
              source={{ uri: data.mapUri as string }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
              onError={() => setMapImageFailed(true)}
            />
          ) : tileMap ? (
            <>
              {tileMap.tiles.map((tile) => (
                <Image
                  key={`${tile.z}/${tile.x}/${tile.y}`}
                  source={{ uri: tileUrl(tile), headers: TILE_HEADERS }}
                  style={{
                    position: "absolute",
                    left: tile.left,
                    top: tile.top,
                    width: tileMap.tileSize,
                    height: tileMap.tileSize,
                  }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ))}
              {/* Darken the basemap so the amber route and pins stay legible. */}
              <View style={styles.mapTint} />
              {/* Route line, one rotated bar per leg — the app has no SVG
                  dependency, and rotating about each bar's centre means no
                  transformOrigin is needed. */}
              {tileMap.points.slice(1).map((point, i) => {
                const prev = tileMap.points[i];
                const dx = point.x - prev.x;
                const dy = point.y - prev.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                if (length < 1) return null;
                return (
                  <View
                    key={`leg-${i}`}
                    style={[
                      styles.routeLeg,
                      {
                        left: (prev.x + point.x) / 2 - length / 2,
                        top: (prev.y + point.y) / 2 - ROUTE_W / 2,
                        width: length,
                        transform: [{ rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }],
                      },
                    ]}
                  />
                );
              })}
              {tileMap.points.map((point, i) => (
                <View
                  key={`pin-${i}`}
                  style={[styles.mapPin, { left: point.x - PIN_SIZE / 2, top: point.y - PIN_SIZE / 2 }]}
                >
                  <Text style={styles.mapPinText}>{i + 1}</Text>
                </View>
              ))}
              {/* Required by OpenStreetMap's tile usage policy. */}
              <Text style={styles.mapAttribution}>{TILE_ATTRIBUTION}</Text>
            </>
          ) : (
            <LinearGradient
              colors={[NAVY, NAVY_LIGHT, NAVY]}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
          )}
          <View style={styles.stopsBadge}>
            <Ionicons name="location" size={28 / S} color={DARK} />
            <Text style={styles.stopsBadgeText}>
              {stops.length} {t("shareRoute.stops").toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          {statTiles.map((tile) => (
            <View key={tile.key} style={styles.statTile}>
              <View style={styles.statIcon}>
                {tile.icon ? (
                  <Ionicons name={tile.icon} size={34 / S} color={AMBER} />
                ) : (
                  <View style={styles.barsRow}>
                    {[0, 1, 2].map((i) => (
                      <View
                        key={i}
                        style={[
                          styles.bar,
                          { height: (10 + i * 7) / S },
                          i < stats.bars && styles.barActive,
                        ]}
                      />
                    ))}
                  </View>
                )}
              </View>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {tile.value}
              </Text>
              <Text style={styles.statLabel} numberOfLines={1}>{tile.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Timeline strip ── */}
        <View style={styles.timeline}>
          {stops.map((stop, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <View style={styles.legCol}>
                  <Ionicons name="walk" size={26 / S} color="rgba(255,255,255,0.45)" />
                  {typeof stop.legKm === "number" && (
                    <Text style={styles.legText}>{stop.legKm.toFixed(1)} km</Text>
                  )}
                  <View style={styles.legLine} />
                </View>
              )}
              <View style={styles.stopCol}>
                {!!stop.time && <Text style={styles.stopTime}>{stop.time}</Text>}
                <View style={styles.stopThumbWrap}>
                  {stop.image ? (
                    <Image source={{ uri: stop.image }} style={styles.stopThumb} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.stopThumb, styles.stopThumbFallback]}>
                      <Ionicons name="location" size={30 / S} color={AMBER} />
                    </View>
                  )}
                  <View style={styles.stopBadge}>
                    <Text style={styles.stopBadgeText}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={styles.stopTitle} numberOfLines={2}>{stop.title}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* ── Tip ── */}
        {!!data.tip && (
          <View style={styles.tipRow}>
            <Ionicons name="sparkles" size={28 / S} color={AMBER} />
            <Text style={styles.tipText} numberOfLines={2}>
              <Text style={styles.tipLabel}>{t("shareRoute.tip")}: </Text>
              {data.tip}
            </Text>
          </View>
        )}
      </View>

      {/* ── Footer ── */}
      <View style={styles.brandRowAbsolute}>
        <View style={styles.brandDot} />
        <Text style={styles.brandText}>planeraai.app</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: "#0B0D12",
    overflow: "hidden",
  },

  // ── Logo ──
  logoContainer: {
    position: "absolute",
    top: 54 / S,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
  logoImage: {
    width: 220 / S,
    height: 55 / S,
  },

  // Everything between the logo and the brand row.
  content: {
    position: "absolute",
    top: 150 / S,
    left: 42 / S,
    right: 42 / S,
    bottom: 110 / S,
    alignItems: "center",
  },

  // ── Header ──
  pill: {
    backgroundColor: "rgba(255,229,0,0.10)",
    borderWidth: 1.5 / S,
    borderColor: "rgba(255,229,0,0.5)",
    borderRadius: 26 / S,
    paddingHorizontal: 20 / S,
    paddingVertical: 7 / S,
  },
  pillText: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 19 / S,
    color: AMBER,
    letterSpacing: 3 / S,
  },
  dayLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8 / S,
    marginTop: 16 / S,
  },
  dayLabel: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 44 / S,
    color: AMBER,
    letterSpacing: 2 / S,
  },
  dayLabelTotal: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 30 / S,
    color: "rgba(255,255,255,0.45)",
  },
  dayTitle: {
    fontFamily: SANS,
    fontWeight: "900",
    fontSize: 66 / S,
    lineHeight: 70 / S,
    color: WHITE,
    letterSpacing: -1 / S,
    marginTop: 2 / S,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 2 / S },
    textShadowRadius: 8 / S,
  },
  destination: {
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 26 / S,
    color: "rgba(255,255,255,0.7)",
    marginTop: 10 / S,
    textAlign: "center",
  },
  accentLine: {
    width: 70 / S,
    height: 3 / S,
    backgroundColor: AMBER,
    borderRadius: 2 / S,
    marginTop: 14 / S,
    marginBottom: 22 / S,
  },

  // ── Chips ──
  chipsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 10 / S,
    alignSelf: "stretch",
  },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10 / S,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 18 / S,
    paddingHorizontal: 16 / S,
    paddingVertical: 10 / S,
  },
  chipBody: { flex: 1 },
  chipValue: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 22 / S,
    color: WHITE,
  },
  chipSub: {
    fontFamily: SANS,
    fontSize: 18 / S,
    color: "rgba(255,255,255,0.5)",
    marginTop: 1 / S,
  },

  // ── Map ──
  mapWrap: {
    alignSelf: "stretch",
    aspectRatio: MAP_ASPECT,
    marginTop: 20 / S,
    borderRadius: 22 / S,
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#0F1116",
    overflow: "hidden",
  },
  mapTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8,10,14,0.45)",
  },
  routeLeg: {
    position: "absolute",
    height: ROUTE_W,
    borderRadius: ROUTE_W / 2,
    backgroundColor: AMBER,
  },
  mapPin: {
    position: "absolute",
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    backgroundColor: AMBER,
    borderWidth: 3 / S,
    borderColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  mapPinText: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 22 / S,
    color: DARK,
  },
  mapAttribution: {
    position: "absolute",
    right: 8 / S,
    bottom: 6 / S,
    fontFamily: SANS,
    fontSize: 14 / S,
    color: "rgba(255,255,255,0.55)",
  },
  stopsBadge: {
    position: "absolute",
    right: 16 / S,
    top: 16 / S,
    flexDirection: "row",
    alignItems: "center",
    gap: 6 / S,
    backgroundColor: AMBER,
    borderRadius: 22 / S,
    paddingHorizontal: 16 / S,
    paddingVertical: 8 / S,
  },
  stopsBadgeText: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 20 / S,
    color: DARK,
    letterSpacing: 1.5 / S,
  },

  // ── Stats ──
  statsRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 10 / S,
    marginTop: 16 / S,
  },
  statTile: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(21,22,28,0.85)",
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 18 / S,
    paddingVertical: 12 / S,
    paddingHorizontal: 6 / S,
    gap: 4 / S,
  },
  statIcon: {
    width: 44 / S,
    height: 44 / S,
    borderRadius: 12 / S,
    backgroundColor: "rgba(255,229,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 24 / S,
    color: WHITE,
    textAlign: "center",
  },
  statLabel: {
    fontFamily: SANS,
    fontSize: 16 / S,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
  },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3 / S,
  },
  bar: {
    width: 6 / S,
    borderRadius: 3 / S,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  barActive: {
    backgroundColor: AMBER,
  },

  // ── Timeline ──
  timeline: {
    flex: 1,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: PANEL,
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 22 / S,
    marginTop: 16 / S,
    paddingVertical: 18 / S,
    paddingHorizontal: 14 / S,
  },
  stopCol: {
    flex: 1,
    alignItems: "center",
    gap: 5 / S,
  },
  stopTime: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 19 / S,
    color: AMBER,
  },
  stopThumbWrap: {
    width: 110 / S,
    height: 110 / S,
  },
  stopThumb: {
    width: "100%",
    height: "100%",
    borderRadius: 55 / S,
    borderWidth: 2 / S,
    borderColor: "rgba(255,255,255,0.2)",
  },
  stopThumbFallback: {
    backgroundColor: "rgba(255,229,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  stopBadge: {
    position: "absolute",
    left: -4 / S,
    top: -4 / S,
    width: 32 / S,
    height: 32 / S,
    borderRadius: 16 / S,
    backgroundColor: AMBER,
    alignItems: "center",
    justifyContent: "center",
  },
  stopBadgeText: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 19 / S,
    color: DARK,
  },
  stopTitle: {
    fontFamily: SANS,
    fontWeight: "600",
    fontSize: 18 / S,
    lineHeight: 23 / S,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
  },
  legCol: {
    alignItems: "center",
    justifyContent: "center",
    width: 56 / S,
    gap: 2 / S,
  },
  legText: {
    fontFamily: SANS,
    fontSize: 16 / S,
    color: "rgba(255,255,255,0.45)",
  },
  legLine: {
    width: 40 / S,
    height: 1 / S,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: 3 / S,
  },

  // ── Tip ──
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 10 / S,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16 / S,
    paddingHorizontal: 16 / S,
    paddingVertical: 10 / S,
    marginTop: 14 / S,
  },
  tipText: {
    flex: 1,
    fontFamily: SANS,
    fontSize: 18 / S,
    lineHeight: 23 / S,
    color: "rgba(255,255,255,0.75)",
  },
  tipLabel: {
    fontWeight: "800",
    color: AMBER,
  },

  // ── Branding ──
  brandRowAbsolute: {
    position: "absolute",
    bottom: 50 / S,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  brandDot: {
    width: 8 / S,
    height: 8 / S,
    borderRadius: 4 / S,
    backgroundColor: AMBER,
    marginRight: 10 / S,
  },
  brandText: {
    fontFamily: SANS,
    fontWeight: "500",
    fontSize: 20 / S,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 1.5 / S,
  },
});
