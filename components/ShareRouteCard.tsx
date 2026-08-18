import React, { useState, useCallback, useImperativeHandle, forwardRef, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Modal,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useTranslation } from "react-i18next";

const logoAsset = require("@/assets/images/logo-a-stapr6.png");

// Card renders at 360×450pt, captured at 3x → 1080×1350 (4:5, the format the
// route map needs to stay readable — the 9:16 share slides are too narrow for
// a map plus a timeline).
const S = 3;
const CARD_W = 1080 / S;
const CARD_H = 1350 / S;

const AMBER = "#FFE500";
const WHITE = "#FFFFFF";
const DARK = "#121212";
const NAVY = "#1A1A1A";
const NAVY_LIGHT = "#2C2C2C";
const PANEL = "#15161C";

const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const SANS = Platform.select({ ios: "System", default: "sans-serif" });

export interface RouteStop {
  title: string;
  /** Display time, e.g. "09:00 AM" */
  time?: string;
  image?: string;
  /** Walking distance in km from the previous stop (undefined for the first) */
  legKm?: number;
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
  /** file:// uri of the MapView snapshot */
  mapUri: string;
  totalKm: number;
  walkMinutes: number;
  /** Optional insider tip line shown at the bottom */
  tip?: string;
}

export interface ShareRouteCardHandle {
  open: (data: ShareRouteData) => void;
}

const { width: SCREEN_W } = Dimensions.get("window");
const PREVIEW_W = SCREEN_W - 32;
const PREVIEW_SCALE = PREVIEW_W / CARD_W;
const PREVIEW_H = CARD_H * PREVIEW_SCALE;

/** Walking burns roughly 50 kcal per km for an average adult. */
const KCAL_PER_KM = 50;

const ShareRouteCard = forwardRef<ShareRouteCardHandle, {}>((_props, ref) => {
  const { t, i18n } = useTranslation();
  const shotRef = useRef<ViewShot | null>(null);
  const [data, setData] = useState<ShareRouteData | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useImperativeHandle(ref, () => ({
    open: (d: ShareRouteData) => {
      setData(d);
      setVisible(true);
    },
  }));

  const locale =
    i18n.language === "el" ? "el-GR"
    : i18n.language === "es" ? "es-ES"
    : i18n.language === "fr" ? "fr-FR"
    : i18n.language === "de" ? "de-DE"
    : i18n.language === "ar" ? "ar-SA"
    : "en-US";

  const dateLabel = useMemo(() => {
    if (!data?.date) return "";
    try {
      return new Date(data.date).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }, [data?.date, locale]);

  const weekdayLabel = useMemo(() => {
    if (!data?.date) return "";
    try {
      return new Date(data.date).toLocaleDateString(locale, { weekday: "long" });
    } catch {
      return "";
    }
  }, [data?.date, locale]);

  const stats = useMemo(() => {
    if (!data) return null;
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
  }, [data, t]);

  const capture = useCallback(async (): Promise<string | null> => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (!shotRef.current) return null;
    try {
      return await captureRef(shotRef, {
        format: "png",
        quality: 1.0,
        width: 1080,
        height: 1350,
      });
    } catch (err) {
      console.error("Route card capture failed:", err);
      return null;
    }
  }, []);

  const doShare = useCallback(async () => {
    try {
      setBusy(true);
      const uri = await capture();
      if (!uri) {
        Alert.alert(t("common.error"), t("shareCard.generationFailed"));
        return;
      }
      const fileName = `planera-route-day-${data?.dayNumber || 1}.png`;
      const source = new File(uri);
      const dest = new File(Paths.cache, fileName);
      if (dest.exists) dest.delete();
      source.copy(dest);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest.uri, {
          mimeType: "image/png",
          dialogTitle: t("shareRoute.title"),
          UTI: "public.png",
        });
      }
      setVisible(false);
    } catch (err: any) {
      if (err?.message !== "User did not share") {
        console.error("Route share failed:", err);
        Alert.alert(t("common.error"), t("shareCard.shareFailed"));
      }
    } finally {
      setBusy(false);
    }
  }, [capture, data?.dayNumber, t]);

  const doSave = useCallback(async () => {
    try {
      setBusy(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("common.error"), t("shareCard.galleryPermission"));
        return;
      }
      const uri = await capture();
      if (!uri) {
        Alert.alert(t("common.error"), t("shareCard.generationFailed"));
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t("common.success"), t("shareCard.savedToGallery"));
      setVisible(false);
    } catch (err) {
      console.error("Route save failed:", err);
      Alert.alert(t("common.error"), t("shareCard.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [capture, t]);

  const renderCard = () => {
    if (!data || !stats) return null;
    const stops = data.stops.slice(0, 5);
    const heroImage = data.stops.find((s) => s.image)?.image;
    // "09:00 AM — 07:27 PM": the day's real span, straight off the stop times.
    const firstTime = data.stops.find((s) => s.time)?.time;
    const lastTime = [...data.stops].reverse().find((s) => s.time)?.time;
    const timeSpan =
      firstTime && lastTime && firstTime !== lastTime ? `${firstTime} — ${lastTime}` : firstTime || "";

    const statRows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [
      { icon: "walk", label: t("shareRoute.totalDistance"), value: stats.distance },
      { icon: "time-outline", label: t("shareRoute.walkingTime"), value: stats.time },
      { icon: "flash-outline", label: t("shareRoute.calories"), value: stats.calories },
    ];

    return (
      <View style={styles.card}>
        {/* ── Header ── */}
        <View style={styles.header}>
          {heroImage ? (
            <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <LinearGradient colors={[NAVY, NAVY_LIGHT, NAVY]} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.72)", "rgba(0,0,0,0.35)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.headerInner}>
            <Image source={logoAsset} style={styles.logo} contentFit="contain" />
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
          </View>

          {/* Date + travellers chips */}
          <View style={styles.chipsCol}>
            {!!dateLabel && (
              <View style={styles.chip}>
                <Ionicons name="calendar-outline" size={30 / S} color={AMBER} />
                <View>
                  <Text style={styles.chipValue}>{dateLabel}</Text>
                  {!!weekdayLabel && <Text style={styles.chipSub}>{weekdayLabel}</Text>}
                </View>
              </View>
            )}
            <View style={styles.chip}>
              <Ionicons name="people-outline" size={30 / S} color={AMBER} />
              <View>
                <Text style={styles.chipValue}>
                  {data.travelers} {t("shareCard.travelers")}
                </Text>
                {!!timeSpan && <Text style={styles.chipSub}>{timeSpan}</Text>}
              </View>
            </View>
          </View>
        </View>

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          <Image source={{ uri: data.mapUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient
            colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Floating stats panel */}
          <View style={styles.statsPanel}>
            {statRows.map((row) => (
              <View key={row.icon} style={styles.statRow}>
                <View style={styles.statIcon}>
                  <Ionicons name={row.icon} size={34 / S} color={AMBER} />
                </View>
                <View style={styles.statBody}>
                  <Text style={styles.statLabel} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.statValue} numberOfLines={1}>{row.value}</Text>
                </View>
              </View>
            ))}
            <View style={styles.statRow}>
              <View style={styles.statIcon}>
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
              </View>
              <View style={styles.statBody}>
                <Text style={styles.statLabel} numberOfLines={1}>{t("shareRoute.difficulty")}</Text>
                <Text style={styles.statValue} numberOfLines={1}>{stats.difficulty}</Text>
              </View>
            </View>
          </View>

          {/* Stop count badge */}
          <View style={styles.stopsBadge}>
            <Ionicons name="location" size={28 / S} color={DARK} />
            <Text style={styles.stopsBadgeText}>
              {stops.length} {t("shareRoute.stops").toUpperCase()}
            </Text>
          </View>
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

        {/* ── Tip + footer ── */}
        <View style={styles.footer}>
          {!!data.tip && (
            <View style={styles.tipRow}>
              <Ionicons name="sparkles" size={28 / S} color={AMBER} />
              <Text style={styles.tipText} numberOfLines={2}>
                <Text style={styles.tipLabel}>{t("shareRoute.tip")}: </Text>
                {data.tip}
              </Text>
            </View>
          )}
          <View style={styles.footerRow}>
            <Text style={styles.tagline}>
              {t("shareCard.posterTagline1").toUpperCase()}{" "}
              <Text style={styles.taglineAccent}>{t("shareCard.posterTagline2").toUpperCase()}</Text>
            </Text>
            <View style={styles.ctaPill}>
              <Text style={styles.ctaText}>{t("shareCard.posterCta").toUpperCase()}</Text>
              <Ionicons name="arrow-forward" size={24 / S} color={DARK} />
              <Text style={styles.ctaDomain}>planeraai.app</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <>
      {/* Off-screen capture target */}
      <View style={styles.offscreen} pointerEvents="none">
        <ViewShot
          ref={(r) => { shotRef.current = r; }}
          options={{ format: "png", quality: 1.0, width: 1080, height: 1350 }}
        >
          {renderCard()}
        </ViewShot>
      </View>

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t("shareRoute.title")}</Text>
            <View style={{ width: 36 }} />
          </View>

          <View style={styles.previewArea}>
            <View style={[styles.previewFrame, { width: PREVIEW_W, height: PREVIEW_H }]}>
              <View style={{ transform: [{ scale: PREVIEW_SCALE }], transformOrigin: "0% 0%" }}>
                {renderCard()}
              </View>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.shareBtn} onPress={doShare} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={DARK} /> : (
                <Text style={styles.shareBtnText}>{t("shareRoute.shareDay")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={doSave} disabled={busy}>
              <Text style={styles.saveBtnText}>{t("shareCard.saveToGallery")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
});

ShareRouteCard.displayName = "ShareRouteCard";
export default ShareRouteCard;

const styles = StyleSheet.create({
  offscreen: { position: "absolute", left: -9999, top: -9999 },
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: "#0B0D12",
    overflow: "hidden",
  },

  // ── Header ──
  header: {
    height: 430 / S,
    overflow: "hidden",
  },
  headerInner: {
    position: "absolute",
    top: 34 / S,
    left: 42 / S,
    right: 300 / S,
  },
  logo: {
    width: 200 / S,
    height: 50 / S,
    marginBottom: 14 / S,
  },
  pill: {
    alignSelf: "flex-start",
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
  },
  chipsCol: {
    position: "absolute",
    right: 34 / S,
    bottom: 26 / S,
    gap: 10 / S,
    alignItems: "flex-end",
  },
  chip: {
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
    flex: 1,
    backgroundColor: "#0F1116",
    overflow: "hidden",
  },
  statsPanel: {
    position: "absolute",
    left: 26 / S,
    top: 26 / S,
    width: 300 / S,
    backgroundColor: "rgba(21,22,28,0.92)",
    borderRadius: 22 / S,
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 14 / S,
    paddingHorizontal: 16 / S,
    gap: 12 / S,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12 / S,
  },
  statIcon: {
    width: 44 / S,
    height: 44 / S,
    borderRadius: 12 / S,
    backgroundColor: "rgba(255,229,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  statBody: { flex: 1 },
  statLabel: {
    fontFamily: SANS,
    fontSize: 17 / S,
    color: "rgba(255,255,255,0.5)",
  },
  statValue: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 25 / S,
    color: WHITE,
    marginTop: 1 / S,
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
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: PANEL,
    borderTopWidth: 1 / S,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingVertical: 18 / S,
    paddingHorizontal: 20 / S,
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
    width: 82 / S,
    height: 82 / S,
  },
  stopThumb: {
    width: "100%",
    height: "100%",
    borderRadius: 41 / S,
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
    width: 60 / S,
    paddingTop: 34 / S,
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

  // ── Footer ──
  footer: {
    backgroundColor: "#0B0D12",
    paddingHorizontal: 24 / S,
    paddingTop: 12 / S,
    paddingBottom: 14 / S,
    gap: 8 / S,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10 / S,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16 / S,
    paddingHorizontal: 16 / S,
    paddingVertical: 10 / S,
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
  stopsBadge: {
    position: "absolute",
    right: 26 / S,
    top: 26 / S,
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
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10 / S,
  },
  tagline: {
    flex: 1,
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 21 / S,
    color: WHITE,
    letterSpacing: 1.5 / S,
  },
  taglineAccent: {
    color: AMBER,
  },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8 / S,
    backgroundColor: AMBER,
    borderRadius: 34 / S,
    paddingHorizontal: 18 / S,
    paddingVertical: 10 / S,
  },
  ctaText: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 20 / S,
    color: DARK,
    letterSpacing: 1.5 / S,
  },
  ctaDomain: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 20 / S,
    color: "rgba(0,0,0,0.65)",
  },

  // ── Modal ──
  modal: {
    flex: 1,
    backgroundColor: "#111118",
    paddingTop: Platform.OS === "ios" ? 56 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: WHITE, fontSize: 18, fontWeight: "600" },
  modalTitle: { fontFamily: SANS, fontSize: 17, fontWeight: "600", color: WHITE },
  previewArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  previewFrame: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
    gap: 10,
  },
  shareBtn: {
    height: 50,
    backgroundColor: AMBER,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  shareBtnText: { fontFamily: SANS, fontWeight: "700", fontSize: 16, color: DARK },
  saveBtn: {
    height: 50,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  saveBtnText: { fontFamily: SANS, fontWeight: "600", fontSize: 16, color: WHITE },
});
