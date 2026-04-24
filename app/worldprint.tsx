/**
 * WorldPrint screen — the user's living globe.
 *
 * Shows:
 *  - The dark globe with glowing markers for every city visited/planned.
 *  - Header stats (cities, countries, quests completed).
 *  - Horizontally-scrolling quest list with progress bars.
 *  - Claim sheet + share card integration.
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Share,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { LinearGradient } from "expo-linear-gradient";

import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import WorldGlobe, { GlobeVisit } from "@/components/WorldGlobe";
import { SIGNATURE_COLORS } from "@/lib/worldPrintQuests";

export default function WorldPrintScreen() {
  const router = useRouter();
  const { token } = useToken();
  const { colors, isDarkMode } = useTheme();
  const { t } = useTranslation();

  const data = useQuery(
    api.worldPrint.getMyWorldPrint as any,
    token ? { token } : "skip"
  ) as any;

  const ensureProfile = useAuthenticatedMutation(
    api.worldPrint.ensureProfile as any
  );
  const claimQuest = useAuthenticatedMutation(
    api.worldPrint.claimQuestReward as any
  );
  const setSigColor = useAuthenticatedMutation(
    api.worldPrint.setSignatureColor as any
  );

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  // On first mount, trigger profile creation + auto-import from completed trips
  useEffect(() => {
    if (!token) return;
    ensureProfile({}).catch(() => {
      /* non-fatal */
    });
    // Intentionally run once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const visits: GlobeVisit[] = useMemo(() => {
    if (!data?.visits) return [];
    return data.visits as GlobeVisit[];
  }, [data?.visits]);

  const signatureColor = data?.profile?.signatureColor ?? "#F59E0B";
  const stats = data?.stats ?? { totalCities: 0, totalCountries: 0, totalPlanned: 0 };
  const quests = data?.quests ?? [];
  const dimLevel = data?.dimLevel ?? 0;
  const publicCode = data?.profile?.publicCode;

  const handleClaim = useCallback(
    async (questId: string, questName: string) => {
      if (claiming) return;
      setClaiming(questId);
      try {
        const result = await claimQuest({ questId });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          `${result?.badge ?? "🏅"} ${questName}`,
          t("worldprint.questClaimedBody", {
            defaultValue: "Quest complete. Badge unlocked.",
          })
        );
      } catch (e: any) {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          e?.message ?? "Could not claim quest."
        );
      } finally {
        setClaiming(null);
      }
    },
    [claiming, claimQuest, t]
  );

  const handleShare = useCallback(async () => {
    if (!publicCode) return;
    const url = `https://planera.app/globe/${publicCode}`;
    await Haptics.selectionAsync();
    try {
      await Share.share({
        message: t("worldprint.shareMessage", {
          defaultValue: `My WorldPrint: ${stats.totalCities} cities, ${stats.totalCountries} countries. ${url}`,
          cities: stats.totalCities,
          countries: stats.totalCountries,
          url,
        }),
        url,
      });
    } catch {}
  }, [publicCode, stats, t]);

  const handleSetColor = useCallback(
    async (hex: string) => {
      await Haptics.selectionAsync();
      try {
        await setSigColor({ colorHex: hex });
      } catch {}
      setShowColorPicker(false);
    },
    [setSigColor]
  );

  if (!token || !data) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: "#050A14" }]}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050A14" />

      {/* The globe is the background of the whole screen */}
      <WorldGlobe
        visits={visits}
        signatureColor={signatureColor}
        dimLevel={dimLevel}
        onCityPress={setSelectedCity}
      />

      {/* Gradient overlay for legibility at top/bottom */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,10,20,0.85)", "rgba(5,10,20,0)"]}
        style={styles.topGradient}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,10,20,0)", "rgba(5,10,20,0.95)"]}
        style={styles.bottomGradient}
      />

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={["top"]}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={26} color="#F8FAFC" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{t("worldprint.title", { defaultValue: "WorldPrint" })}</Text>
          <Text style={styles.subtitle}>
            {t("worldprint.subtitle", { defaultValue: "Your living globe" })}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleShare}
          hitSlop={10}
        >
          <Ionicons name="share-outline" size={22} color="#F8FAFC" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom content: stats + quests */}
      <SafeAreaView style={styles.bottomContent} edges={["bottom"]}>
        {/* Signature color pill */}
        <TouchableOpacity
          style={styles.colorPill}
          onPress={() => setShowColorPicker((s) => !s)}
          activeOpacity={0.85}
        >
          <View style={[styles.colorSwatch, { backgroundColor: signatureColor }]} />
          <Text style={styles.colorPillLabel}>
            {t("worldprint.yourColor", { defaultValue: "Your color" })}
          </Text>
          <Ionicons
            name={showColorPicker ? "chevron-down" : "chevron-up"}
            size={14}
            color="#CBD5E1"
          />
        </TouchableOpacity>

        {showColorPicker && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.colorRow}
          >
            {SIGNATURE_COLORS.map((c) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => handleSetColor(c.hex)}
                style={[
                  styles.colorChoice,
                  {
                    backgroundColor: c.hex,
                    borderColor:
                      c.hex === signatureColor ? "#FFFFFF" : "rgba(255,255,255,0.2)",
                    borderWidth: c.hex === signatureColor ? 3 : 1,
                  },
                ]}
              />
            ))}
          </ScrollView>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatTile
            value={stats.totalCities}
            label={t("worldprint.cities", { defaultValue: "Cities" })}
          />
          <StatTile
            value={stats.totalCountries}
            label={t("worldprint.countries", { defaultValue: "Countries" })}
          />
          <StatTile
            value={stats.totalPlanned}
            label={t("worldprint.planned", { defaultValue: "Planned" })}
          />
        </View>

        {/* Quests */}
        <Text style={styles.sectionLabel}>
          {t("worldprint.quests", { defaultValue: "Quests" })}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.questsRow}
        >
          {quests.map((q: any) => (
            <QuestCard
              key={q.id}
              quest={q}
              signatureColor={signatureColor}
              isClaiming={claiming === q.id}
              onClaim={() => handleClaim(q.id, q.name)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---- Sub-components ----

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuestCard({
  quest,
  signatureColor,
  isClaiming,
  onClaim,
}: {
  quest: any;
  signatureColor: string;
  isClaiming: boolean;
  onClaim: () => void;
}) {
  const pct = Math.max(0, Math.min(1, quest.progress ?? 0));
  const isComplete = quest.isComplete;
  const isClaimable = quest.isClaimable;
  const isClaimed = quest.isClaimed;

  return (
    <View
      style={[
        styles.questCard,
        {
          borderColor: isComplete ? quest.color : "rgba(255,255,255,0.08)",
          backgroundColor: isComplete
            ? `${quest.color}22`
            : "rgba(255,255,255,0.04)",
        },
      ]}
    >
      <View style={styles.questHead}>
        <Text style={styles.questEmoji}>{quest.emoji}</Text>
        <View style={styles.questTierBadge}>
          <Text style={styles.questTierText}>{quest.tier.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.questName} numberOfLines={1}>
        {quest.name}
      </Text>
      <Text style={styles.questDesc} numberOfLines={2}>
        {quest.descriptionKey}
      </Text>

      {/* Progress */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${pct * 100}%`,
              backgroundColor: isComplete ? quest.color : signatureColor,
            },
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {quest.completedCount} / {quest.totalCount}
      </Text>

      {/* CTA */}
      {isClaimed ? (
        <View style={[styles.claimedBadge, { borderColor: quest.color }]}>
          <Text style={[styles.claimedBadgeText, { color: quest.color }]}>
            {quest.reward.badge} {quest.reward.title ?? "Unlocked"}
          </Text>
        </View>
      ) : isClaimable ? (
        <TouchableOpacity
          style={[styles.claimButton, { backgroundColor: quest.color }]}
          onPress={onClaim}
          disabled={isClaiming}
          activeOpacity={0.85}
        >
          {isClaiming ? (
            <ActivityIndicator size="small" color="#0B1220" />
          ) : (
            <Text style={styles.claimButtonText}>Claim {quest.reward.badge}</Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.lockedHint}>
          <Ionicons name="lock-closed" size={12} color="#64748B" />
          <Text style={styles.lockedHintText}>
            {quest.totalCount - quest.completedCount} to go
          </Text>
        </View>
      )}
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050A14" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 380,
  },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1, alignItems: "center" },
  title: { color: "#F8FAFC", fontSize: 18, fontWeight: "700", letterSpacing: 0.3 },
  subtitle: { color: "#94A3B8", fontSize: 12, marginTop: 2 },

  bottomContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },

  colorPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    marginBottom: 10,
  },
  colorSwatch: { width: 14, height: 14, borderRadius: 7 },
  colorPillLabel: { color: "#E2E8F0", fontSize: 12, fontWeight: "600" },
  colorRow: { gap: 10, paddingVertical: 6, paddingHorizontal: 2, marginBottom: 10 },
  colorChoice: { width: 28, height: 28, borderRadius: 14 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statTile: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: { color: "#F8FAFC", fontSize: 22, fontWeight: "800" },
  statLabel: { color: "#94A3B8", fontSize: 11, marginTop: 2, letterSpacing: 0.4 },

  sectionLabel: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  questsRow: { gap: 12, paddingBottom: 8, paddingRight: 16 },

  questCard: {
    width: 210,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  questHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  questEmoji: { fontSize: 24 },
  questTierBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  questTierText: { color: "#94A3B8", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  questName: { color: "#F8FAFC", fontSize: 15, fontWeight: "700", marginTop: 8 },
  questDesc: { color: "#94A3B8", fontSize: 11, marginTop: 4, lineHeight: 15, height: 30 },

  progressTrack: {
    marginTop: 12,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel: { color: "#CBD5E1", fontSize: 10, fontWeight: "700", marginTop: 4 },

  claimButton: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  claimButtonText: { color: "#0B1220", fontWeight: "800", fontSize: 13 },

  claimedBadge: {
    marginTop: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  claimedBadgeText: { fontWeight: "800", fontSize: 12 },

  lockedHint: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  lockedHintText: { color: "#64748B", fontSize: 11, fontWeight: "600" },
});
