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
  Modal,
  TextInput,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { LinearGradient } from "expo-linear-gradient";

import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import WorldGlobe, { GlobeVisit, WorldGlobeHandle } from "@/components/WorldGlobe";
import ShareWorldPrintCard, { ShareWorldPrintCardHandle } from "@/components/ShareWorldPrintCard";
import { SIGNATURE_COLORS } from "@/lib/worldPrintQuests";
import { WORLD_CITIES, WorldCity } from "@/lib/worldCities";

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
  const seedDemo = useAuthenticatedMutation(
    api.worldPrint.seedDemoVisits as any
  );
  const clearVisits = useAuthenticatedMutation(
    api.worldPrint.clearMyVisits as any
  );
  const addVisit = useAuthenticatedMutation(api.worldPrint.addVisit as any);
  const removeVisit = useAuthenticatedMutation(api.worldPrint.removeVisit as any);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [showAddCity, setShowAddCity] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [pendingCityId, setPendingCityId] = useState<string | null>(null);
  const [globeSnapshot, setGlobeSnapshot] = useState<string | null>(null);
  const shareCardRef = React.useRef<ShareWorldPrintCardHandle>(null);
  const globeRef = React.useRef<WorldGlobeHandle>(null);

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

  const hasGpsVisits = useMemo(
    () => (data?.visits ?? []).some((v: any) => v?.verifiedSource === "gps"),
    [data?.visits]
  );

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
    await Haptics.selectionAsync();
    try {
      // Capture the live globe canvas first so the card has a real hero image.
      const snapshot = await globeRef.current?.captureSnapshot(2500);
      if (snapshot) {
        setGlobeSnapshot(snapshot);
        // Allow React to flush the new image into the off-screen card before capture.
        await new Promise((r) => setTimeout(r, 200));
      }
      await shareCardRef.current?.share();
    } catch {}
  }, []);

  // Build the data passed to the share card
  const shareCardData = useMemo(() => {
    const claimedQuestCount = (quests as any[]).filter(
      (q: any) => q?.status === "claimed" || q?.claimed
    ).length;
    const recentVisits = [...(visits as any[])]
      .filter((v) => v?.status === "verified" || v?.status === "holographic")
      .sort((a, b) => (b?.verifiedAt ?? 0) - (a?.verifiedAt ?? 0))
      .slice(0, 6);
    return {
      totalCities: stats.totalCities ?? 0,
      totalCountries: stats.totalCountries ?? 0,
      totalQuests: claimedQuestCount,
      signatureColor,
      publicCode,
      topCities: recentVisits.map((v: any) => ({
        name: v?.city?.name ?? "",
        country: v?.city?.country ?? "",
      })),
      globeImage: globeSnapshot,
    };
  }, [stats, quests, visits, signatureColor, publicCode, globeSnapshot]);

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

  // Map cityId -> the user's visit for it (for the add-city sheet toggle state).
  const visitByCityId = useMemo(() => {
    const m = new Map<string, any>();
    for (const v of (data?.visits ?? []) as any[]) m.set(v.cityId, v);
    return m;
  }, [data?.visits]);

  // Filter the shipped city catalog by the search box (name / country / alias).
  const filteredCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    const list =
      q.length === 0
        ? WORLD_CITIES
        : WORLD_CITIES.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.country.toLowerCase().includes(q) ||
              (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
          );
    return list.slice(0, 80);
  }, [citySearch]);

  const handleToggleCity = useCallback(
    async (city: WorldCity) => {
      if (pendingCityId) return;
      const existing = visitByCityId.get(city.id);
      setPendingCityId(city.id);
      try {
        if (existing) {
          const removable =
            existing.verifiedSource === "manual" || existing.status === "claimed";
          if (!removable) {
            Alert.alert(
              t("worldprint.cantRemoveTitle", { defaultValue: "Can't remove" }),
              t("worldprint.cantRemoveBody", {
                defaultValue:
                  "This city was added from a trip or a check-in, so it can't be removed here.",
              })
            );
            return;
          }
          await removeVisit({ visitId: existing._id });
          await Haptics.selectionAsync();
        } else {
          await addVisit({
            cityId: city.id,
            status: "verified",
            verifiedSource: "manual",
          });
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (e: any) {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          e?.message ?? "Could not update city."
        );
      } finally {
        setPendingCityId(null);
      }
    },
    [pendingCityId, visitByCityId, addVisit, removeVisit, t]
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
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
        }}
      />
      <StatusBar barStyle="light-content" backgroundColor="#050A14" />

      {/* Off-screen share card — captured to PNG when the user taps share */}
      <ShareWorldPrintCard ref={shareCardRef} data={shareCardData} />

      {/* The globe is the background of the whole screen */}
      <WorldGlobe
        ref={globeRef}
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <TouchableOpacity
            style={styles.iconButton}
            hitSlop={10}
            onPress={() => {
              setCitySearch("");
              setShowAddCity(true);
            }}
          >
            <Ionicons name="add" size={24} color="#F8FAFC" />
          </TouchableOpacity>
          {visits.length === 0 ? (
            <TouchableOpacity
              style={styles.iconButton}
              hitSlop={10}
              onPress={async () => {
                try {
                  const res = await seedDemo({});
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert(
                    t("worldprint.demoSeeded", { defaultValue: "Demo cities added" }),
                    `+${res?.added ?? 0}`
                  );
                } catch (e: any) {
                  Alert.alert("Error", e?.message ?? "Failed to seed demo");
                }
              }}
            >
              <Ionicons name="sparkles" size={20} color="#FBBF24" />
            </TouchableOpacity>
          ) : (
            !hasGpsVisits && (
            <TouchableOpacity
              style={styles.iconButton}
              hitSlop={10}
              onPress={() => {
                Alert.alert(
                  t("worldprint.clearTitle", { defaultValue: "Clear all visits?" }),
                  t("worldprint.clearBody", {
                    defaultValue: "Remove every city from your WorldPrint.",
                  }),
                  [
                    { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
                    {
                      text: t("worldprint.clear", { defaultValue: "Clear" }),
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await clearVisits({});
                          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        } catch {}
                      },
                    },
                  ]
                );
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#F87171" />
            </TouchableOpacity>
            )
          )}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleShare}
            hitSlop={10}
          >
            <Ionicons name="share-outline" size={22} color="#F8FAFC" />
          </TouchableOpacity>
        </View>
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

      {/* Add-city sheet — manually mark cities you've already visited */}
      <Modal
        visible={showAddCity}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddCity(false)}
      >
        <View style={styles.addBackdrop}>
          <View style={styles.addSheet}>
            <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
              <View style={styles.addHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addTitle}>
                    {t("worldprint.addCityTitle", {
                      defaultValue: "Add a city you've visited",
                    })}
                  </Text>
                  <Text style={styles.addHint}>
                    {t("worldprint.addCityHint", {
                      defaultValue: "Tap a city to add it to your globe",
                    })}
                  </Text>
                </View>
                <TouchableOpacity hitSlop={10} onPress={() => setShowAddCity(false)}>
                  <Ionicons name="close" size={26} color="#CBD5E1" />
                </TouchableOpacity>
              </View>

              <View style={styles.addSearchBox}>
                <Ionicons name="search" size={18} color="#64748B" />
                <TextInput
                  value={citySearch}
                  onChangeText={setCitySearch}
                  placeholder={t("worldprint.addCitySearch", {
                    defaultValue: "Search a city or country",
                  })}
                  placeholderTextColor="#64748B"
                  style={styles.addSearchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {citySearch.length > 0 && (
                  <TouchableOpacity hitSlop={8} onPress={() => setCitySearch("")}>
                    <Ionicons name="close-circle" size={18} color="#475569" />
                  </TouchableOpacity>
                )}
              </View>

              <FlatList
                data={filteredCities}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
                ListEmptyComponent={
                  <Text style={styles.addEmpty}>
                    {t("worldprint.addCityEmpty", {
                      defaultValue: "No cities match your search",
                    })}
                  </Text>
                }
                renderItem={({ item }) => {
                  const visit = visitByCityId.get(item.id);
                  const added = !!visit;
                  const manual =
                    !!visit &&
                    (visit.verifiedSource === "manual" ||
                      visit.status === "claimed");
                  const pending = pendingCityId === item.id;
                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      disabled={pending}
                      onPress={() => handleToggleCity(item)}
                      style={styles.addRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.addRowCity}>{item.name}</Text>
                        <Text style={styles.addRowCountry}>{item.country}</Text>
                      </View>
                      {pending ? (
                        <ActivityIndicator size="small" color="#F59E0B" />
                      ) : added ? (
                        <Ionicons
                          name={manual ? "checkmark-circle" : "lock-closed"}
                          size={22}
                          color={manual ? signatureColor : "#475569"}
                        />
                      ) : (
                        <Ionicons name="add-circle-outline" size={22} color="#64748B" />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            </SafeAreaView>
          </View>
        </View>
      </Modal>
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

  // Add-city sheet
  addBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5,10,20,0.6)",
    justifyContent: "flex-end",
  },
  addSheet: {
    height: "82%",
    backgroundColor: "#0A1120",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  addHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 12,
  },
  addTitle: { color: "#F8FAFC", fontSize: 18, fontWeight: "800" },
  addHint: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  addSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#131C2E",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  addSearchInput: { flex: 1, color: "#F8FAFC", fontSize: 15, padding: 0 },
  addEmpty: {
    color: "#64748B",
    textAlign: "center",
    marginTop: 30,
    fontSize: 14,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.10)",
    gap: 12,
  },
  addRowCity: { color: "#F1F5F9", fontSize: 15, fontWeight: "600" },
  addRowCountry: { color: "#94A3B8", fontSize: 12, marginTop: 1 },
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
