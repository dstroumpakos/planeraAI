/**
 * ShareWorldPrintCard — renders the user's WorldPrint stats as a portrait
 * (1080×1920) share card and exposes an imperative `share()` method.
 *
 * The view itself is rendered off-screen (absolute, far off-screen origin)
 * so the user never sees the canvas; only the captured PNG is opened in the
 * native share sheet.
 */

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Share,
  Alert,
} from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { useTranslation } from "react-i18next";

const logoAsset = require("@/assets/images/logo-a-stapr6.png");

// Card renders at 360×640pt, captured at 3x → 1080×1920px.
const S = 3;
const CARD_W = 1080 / S;
const CARD_H = 1920 / S;

const SERIF = Platform.select({ ios: "Georgia", default: "serif" });

export interface WorldPrintCardData {
  totalCities: number;
  totalCountries: number;
  totalQuests: number;
  signatureColor: string;
  publicCode?: string;
  topCities: Array<{ name: string; country: string }>;
  badges?: string[];
  /** Optional snapshot of the live globe (data: URL or http URL). */
  globeImage?: string | null;
}

export interface ShareWorldPrintCardHandle {
  share: () => Promise<void>;
}

const ShareWorldPrintCard = forwardRef<
  ShareWorldPrintCardHandle,
  { data: WorldPrintCardData }
>(({ data }, ref) => {
  const cardRef = useRef<View>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const sigColor = data.signatureColor || "#F59E0B";
  const url = data.publicCode
    ? `https://planeraai.app/globe/${data.publicCode}`
    : "https://planeraai.app";

  const share = useCallback(async () => {
    if (loading) return;
    try {
      setLoading(true);
      // Allow layout to settle for one frame
      await new Promise((r) => setTimeout(r, 250));
      const node = cardRef.current;
      if (!node) throw new Error("Card not ready");

      const uri = await captureRef(node, {
        format: "png",
        quality: 1,
        width: 1080,
        height: 1920,
      });

      const fileName = `planera-worldprint-${data.publicCode ?? "card"}.png`;
      const source = new File(uri);
      const dest = new File(Paths.cache, fileName);
      if (dest.exists) dest.delete();
      source.copy(dest);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dest.uri, {
          mimeType: "image/png",
          dialogTitle: t("worldprint.shareTitle", {
            defaultValue: "My WorldPrint",
          }),
          UTI: "public.png",
        });
      } else {
        await Share.share({
          message: `My WorldPrint: ${data.totalCities} cities, ${data.totalCountries} countries.\n${url}`,
          url,
        });
      }
    } catch (err: any) {
      if (err?.message !== "User did not share") {
        console.error("WorldPrint share failed:", err);
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          t("worldprint.shareFailed", {
            defaultValue: "Could not generate share card.",
          })
        );
      }
    } finally {
      setLoading(false);
    }
  }, [data, loading, t, url]);

  useImperativeHandle(ref, () => ({ share }), [share]);

  // Compute a darker variant of signature color for gradient depth
  const darken = (hex: string, factor = 0.35) => {
    const h = hex.replace("#", "");
    const n = parseInt(
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h,
      16
    );
    const r = Math.max(0, Math.floor(((n >> 16) & 255) * factor));
    const g = Math.max(0, Math.floor(((n >> 8) & 255) * factor));
    const b = Math.max(0, Math.floor((n & 255) * factor));
    return `rgb(${r},${g},${b})`;
  };

  return (
    <View style={styles.host} pointerEvents="none">
      <ViewShot
        // @ts-ignore - ViewShot accepts a ref to its underlying view
        ref={cardRef}
        options={{ format: "png", quality: 1 }}
        style={styles.card}
      >
        {data.globeImage ? (
          <>
            {/* Live globe snapshot as the hero background */}
            <Image
              source={{ uri: data.globeImage }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory"
            />
            {/* Color-tinted scrim using signature color so brand stays consistent */}
            <LinearGradient
              colors={[
                `${sigColor}55`,
                "rgba(8,12,24,0.45)",
                "rgba(5,8,18,0.96)",
              ]}
              locations={[0, 0.55, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </>
        ) : (
          <LinearGradient
            colors={[sigColor, darken(sigColor, 0.55), "#0A0A0A"]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        {/* Decorative meridian rings */}
        <View style={[styles.ring, styles.ringTop]} />
        <View style={[styles.ring, styles.ringBottom]} />

        {/* Logo + public code */}
        <View style={styles.logoRow}>
          <Image source={logoAsset} style={styles.logo} contentFit="contain" />
          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>SEE THE GLOBE</Text>
            <Text style={styles.codeUrl} numberOfLines={1}>
              {url.replace("https://", "")}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.kicker}>MY · WORLDPRINT</Text>
        <Text style={styles.headline}>The map I left{"\n"}on the world.</Text>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{data.totalCities}</Text>
            <Text style={styles.statLabel}>CITIES</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{data.totalCountries}</Text>
            <Text style={styles.statLabel}>COUNTRIES</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{data.totalQuests}</Text>
            <Text style={styles.statLabel}>QUESTS</Text>
          </View>
        </View>

        {/* Top cities list */}
        <View style={styles.citiesBox}>
          <Text style={styles.citiesHeader}>RECENT PRINTS</Text>
          {data.topCities.slice(0, 6).map((c, i) => (
            <View key={`${c.name}-${i}`} style={styles.cityRow}>
              <View style={[styles.cityDot, { backgroundColor: sigColor }]} />
              <Text style={styles.cityName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.cityCountry} numberOfLines={1}>
                {c.country}
              </Text>
            </View>
          ))}
          {data.topCities.length === 0 && (
            <Text style={styles.cityEmpty}>
              The first print is yet to come.
            </Text>
          )}
        </View>

        {/* Footer removed — code is now next to the logo at the top */}
      </ViewShot>
    </View>
  );
});

ShareWorldPrintCard.displayName = "ShareWorldPrintCard";

const styles = StyleSheet.create({
  // Off-screen host so the card renders but is never visible.
  host: {
    position: "absolute",
    top: -10000,
    left: -10000,
    width: CARD_W,
    height: CARD_H,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    overflow: "hidden",
    borderRadius: 0,
  },
  ring: {
    position: "absolute",
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  ringTop: {
    width: CARD_W * 1.6,
    height: CARD_W * 1.6,
    top: -CARD_W * 0.7,
    left: -CARD_W * 0.3,
  },
  ringBottom: {
    width: CARD_W * 1.4,
    height: CARD_W * 1.4,
    bottom: -CARD_W * 0.4,
    right: -CARD_W * 0.3,
  },
  logoRow: {
    position: "absolute",
    top: 36,
    left: 28,
    right: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  codeBlock: {
    flex: 1,
    alignItems: "flex-end",
  },
  codeLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 9,
    letterSpacing: 2.5,
    fontWeight: "700",
    marginBottom: 2,
  },
  codeUrl: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  logo: {
    width: 56,
    height: 56,
    tintColor: "#FFFFFF",
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: "700",
  },
  kicker: {
    position: "absolute",
    top: 110,
    left: 28,
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    letterSpacing: 4,
    fontWeight: "700",
  },
  headline: {
    position: "absolute",
    top: 138,
    left: 28,
    right: 28,
    color: "#FFFFFF",
    fontSize: 36,
    lineHeight: 40,
    fontFamily: SERIF,
    fontWeight: "400",
  },
  statsRow: {
    position: "absolute",
    top: 280,
    left: 28,
    right: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderRadius: 16,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    fontFamily: SERIF,
  },
  statLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "700",
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  citiesBox: {
    position: "absolute",
    top: 400,
    left: 28,
    right: 28,
    bottom: 36,
    paddingTop: 8,
  },
  citiesHeader: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: "700",
    marginBottom: 14,
  },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  cityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cityName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  cityCountry: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: "400",
  },
  cityEmpty: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 6,
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 28,
    right: 28,
  },
  footerLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: "700",
    marginBottom: 4,
  },
  footerUrl: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});

export default ShareWorldPrintCard;
