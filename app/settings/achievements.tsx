/**
 * Achievements screen — backed by WorldPrint quests.
 *
 * This page is the canonical achievements list and shows the exact same
 * quests as the WorldPrint screen (single source of truth: lib/worldPrintQuests.ts
 * + convex/worldPrint.ts). Each quest is displayed as a badge with its emoji,
 * tier, progress, and a claim CTA in the detail modal when complete.
 */

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Modal,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

type QuestTier = "bronze" | "silver" | "gold" | "legendary";

const TIER_TABS: { id: "all" | QuestTier; labelKey: string; fallback: string; icon: string }[] = [
  { id: "all", labelKey: "achievements.all", fallback: "All", icon: "grid-outline" },
  { id: "bronze", labelKey: "achievements.bronze", fallback: "Bronze", icon: "ribbon-outline" },
  { id: "silver", labelKey: "achievements.silver", fallback: "Silver", icon: "medal-outline" },
  { id: "gold", labelKey: "achievements.gold", fallback: "Gold", icon: "trophy-outline" },
  { id: "legendary", labelKey: "achievements.legendary", fallback: "Legendary", icon: "star-outline" },
];

export default function Achievements() {
  const router = useRouter();
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();
  const [selectedTier, setSelectedTier] = useState<"all" | QuestTier>("all");
  const [selectedQuest, setSelectedQuest] = useState<any>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const data = useQuery(
    api.worldPrint.getMyWorldPrint as any,
    token ? { token } : "skip"
  ) as any;
  const claimQuest = useAuthenticatedMutation(
    api.worldPrint.claimQuestReward as any
  );
  const checkInAtLocation = useAuthenticatedMutation(
    api.worldPrint.checkInAtLocation as any
  );

  const quests: any[] = data?.quests ?? [];
  const totalClaimed = useMemo(
    () => quests.filter((q) => q.isClaimed).length,
    [quests]
  );
  const totalAvailable = quests.length;

  const filtered = useMemo(
    () =>
      selectedTier === "all"
        ? quests
        : quests.filter((q) => q.tier === selectedTier),
    [quests, selectedTier]
  );

  const handleClaim = async () => {
    const quest = selectedQuest;
    if (!quest || claiming) return;
    setClaiming(quest.id);
    try {
      const result = await claimQuest({ questId: quest.id });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        `${result?.badge ?? quest.reward?.badge ?? "🏅"} ${quest.name}`,
        t("worldprint.questClaimedBody", {
          defaultValue: "Quest complete. Badge unlocked.",
        }) as string
      );
      setSelectedQuest(null);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not claim quest.");
    } finally {
      setClaiming(null);
    }
  };
  // GPS check-in: read current position and ask the backend to verify the
  // nearest catalog city. Strongest verification path — user must be on the
  // ground in the destination.
  const handleCheckIn = async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      // Permission flow with graceful fallback to Settings.
      const current = await Location.getForegroundPermissionsAsync();
      let status = current.status;
      if (status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        Alert.alert(
          t("achievements.locationDisabledTitle", {
            defaultValue: "Location is off",
          }) as string,
          t("achievements.locationDisabledDesc", {
            defaultValue:
              "Enable location to check in to a city you're visiting.",
          }) as string,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Settings",
              onPress: () => {
                if (Platform.OS === "ios") Linking.openURL("app-settings:");
                else Linking.openSettings();
              },
            },
          ]
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const result = await checkInAtLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        t("achievements.checkInSuccessTitle", {
          defaultValue: "Checked in",
        }) as string,
        `${result.city.name}, ${result.city.country} — ${result.distanceKm} km`
      );
    } catch (e: any) {
      Alert.alert(
        t("achievements.checkInFailedTitle", {
          defaultValue: "Check-in failed",
        }) as string,
        e?.message ?? "Could not verify your location."
      );
    } finally {
      setCheckingIn(false);
    }
  };
  const styles = createStyles(colors, isDarkMode);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("achievements.title")}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Progress */}
        <View style={styles.progress}>
          <Text style={styles.progressText}>
            {totalClaimed}/{totalAvailable}{" "}
            {t("achievements.unlocked", { count: totalClaimed })}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${(totalClaimed / Math.max(totalAvailable, 1)) * 100}%`,
                },
              ]}
            />
          </View>
        </View>

        {/* GPS check-in CTA — the strongest verification path. */}
        <TouchableOpacity
          style={styles.checkInButton}
          onPress={handleCheckIn}
          disabled={checkingIn}
          activeOpacity={0.85}
        >
          {checkingIn ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Ionicons name="location" size={18} color="#000" />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.checkInTitle}>
              {t("achievements.checkInHere", {
                defaultValue: "Check in to where you are",
              })}
            </Text>
            <Text style={styles.checkInSubtitle}>
              {t("achievements.checkInDesc", {
                defaultValue: "Verify a city using your location (within 50 km).",
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#000" />
        </TouchableOpacity>

        {/* Tier Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryContent}
        >
          {TIER_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.categoryTab,
                selectedTier === tab.id && styles.categoryTabActive,
              ]}
              onPress={() => setSelectedTier(tab.id)}
            >
              <Ionicons
                name={tab.icon as any}
                size={14}
                color={selectedTier === tab.id ? colors.text : colors.textMuted}
              />
              <Text
                style={[
                  styles.categoryTabText,
                  selectedTier === tab.id && styles.categoryTabTextActive,
                ]}
              >
                {t(tab.labelKey, { defaultValue: tab.fallback })}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Quest Grid */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
        >
          {!data ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.grid}>
              {filtered.map((quest) => {
                const isUnlocked = quest.isComplete;
                const isClaimed = quest.isClaimed;
                const pct = Math.max(0, Math.min(1, quest.progress ?? 0));
                return (
                  <TouchableOpacity
                    key={quest.id}
                    style={[
                      styles.badgeCard,
                      !isUnlocked && styles.badgeCardLocked,
                      isClaimed && {
                        borderColor: quest.color,
                      },
                    ]}
                    onPress={() => setSelectedQuest(quest)}
                  >
                    {quest.isClaimable && <View style={styles.newDot} />}
                    <View
                      style={[
                        styles.badgeIcon,
                        {
                          backgroundColor: isUnlocked
                            ? `${quest.color}30`
                            : colors.border,
                        },
                      ]}
                    >
                      <Text style={styles.badgeEmoji}>{quest.emoji}</Text>
                    </View>
                    <Text
                      style={[
                        styles.badgeName,
                        !isUnlocked && styles.badgeNameLocked,
                      ]}
                      numberOfLines={2}
                    >
                      {quest.name}
                    </Text>
                    <View style={styles.questProgressBar}>
                      <View
                        style={[
                          styles.questProgressFill,
                          {
                            width: `${pct * 100}%`,
                            backgroundColor: isUnlocked
                              ? quest.color
                              : colors.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.questProgressLabel}>
                      {quest.completedCount}/{quest.totalCount}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Quest Detail Modal */}
        <Modal
          visible={!!selectedQuest}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedQuest(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setSelectedQuest(null)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
              <View
                style={[
                  styles.modalIcon,
                  {
                    backgroundColor: selectedQuest?.isComplete
                      ? `${selectedQuest?.color}30`
                      : colors.border,
                  },
                ]}
              >
                <Text style={styles.modalEmoji}>{selectedQuest?.emoji}</Text>
              </View>
              <View style={styles.modalTierBadge}>
                <Text style={styles.modalTierText}>
                  {(selectedQuest?.tier ?? "").toUpperCase()}
                </Text>
              </View>
              <Text style={styles.modalTitle}>{selectedQuest?.name}</Text>
              <Text style={styles.modalDescription}>
                {selectedQuest?.descriptionKey}
              </Text>

              {selectedQuest && (
                <View style={styles.modalProgressBar}>
                  <View
                    style={[
                      styles.modalProgressFill,
                      {
                        width: `${(selectedQuest.progress ?? 0) * 100}%`,
                        backgroundColor: selectedQuest.color,
                      },
                    ]}
                  />
                </View>
              )}
              <Text style={styles.modalProgressLabel}>
                {selectedQuest?.completedCount} / {selectedQuest?.totalCount}
              </Text>

              {selectedQuest?.isClaimed ? (
                <View
                  style={[
                    styles.claimedBadge,
                    { borderColor: selectedQuest.color },
                  ]}
                >
                  <Text
                    style={[
                      styles.claimedBadgeText,
                      { color: selectedQuest.color },
                    ]}
                  >
                    {selectedQuest.reward?.badge}{" "}
                    {selectedQuest.reward?.title ??
                      t("achievements.unlocked", { count: 1 })}
                  </Text>
                </View>
              ) : selectedQuest?.isClaimable ? (
                <TouchableOpacity
                  style={[
                    styles.claimButton,
                    { backgroundColor: selectedQuest.color },
                  ]}
                  onPress={handleClaim}
                  disabled={!!claiming}
                  activeOpacity={0.85}
                >
                  {claiming === selectedQuest.id ? (
                    <ActivityIndicator size="small" color="#0B1220" />
                  ) : (
                    <Text style={styles.claimButtonText}>
                      {t("worldprint.claim", { defaultValue: "Claim" })}{" "}
                      {selectedQuest.reward?.badge}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.modalLocked}>
                  <Ionicons
                    name="lock-closed"
                    size={16}
                    color={colors.textMuted}
                  />
                  <Text style={styles.modalLockedText}>
                    {t("achievements.keepGoing")}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const createStyles = (colors: any, _isDarkMode: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },

    progress: { paddingHorizontal: 16, marginBottom: 12 },
    progressText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 8,
    },
    progressBar: {
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: 8,
      backgroundColor: colors.primary,
      borderRadius: 4,
    },

    checkInButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: colors.primary,
    },
    checkInTitle: { color: "#000", fontSize: 14, fontWeight: "700" },
    checkInSubtitle: { color: "rgba(0,0,0,0.7)", fontSize: 11, marginTop: 2 },

    categoryScroll: { maxHeight: 44, marginBottom: 8 },
    categoryContent: { paddingHorizontal: 16, gap: 8 },
    categoryTab: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    categoryTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    categoryTabText: {
      fontSize: 13,
      color: colors.textMuted,
      fontWeight: "500",
    },
    categoryTabTextActive: { color: colors.text, fontWeight: "600" },

    content: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
    loadingWrap: { paddingTop: 40, alignItems: "center" },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    badgeCard: {
      width: "30%",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      position: "relative",
    },
    badgeCardLocked: { opacity: 0.55 },
    newDot: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#EF4444",
    },
    badgeIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    badgeEmoji: { fontSize: 26 },
    badgeName: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
      minHeight: 28,
    },
    badgeNameLocked: { color: colors.textMuted },
    questProgressBar: {
      width: "100%",
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      overflow: "hidden",
      marginTop: 6,
    },
    questProgressFill: { height: 4, borderRadius: 2 },
    questProgressLabel: {
      fontSize: 10,
      fontWeight: "600",
      color: colors.textMuted,
      marginTop: 4,
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    modalCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 28,
      alignItems: "center",
      width: "82%",
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    modalEmoji: { fontSize: 40 },
    modalTierBadge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: colors.border,
      marginBottom: 8,
    },
    modalTierText: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1,
      color: colors.textSecondary,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
      textAlign: "center",
    },
    modalDescription: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
      marginBottom: 14,
    },
    modalProgressBar: {
      width: "100%",
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: "hidden",
      marginBottom: 6,
    },
    modalProgressFill: { height: 8, borderRadius: 4 },
    modalProgressLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textMuted,
      marginBottom: 12,
    },
    modalLocked: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 4,
    },
    modalLockedText: { fontSize: 13, color: colors.textMuted },
    claimedBadge: {
      borderWidth: 1.5,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginTop: 4,
    },
    claimedBadgeText: { fontWeight: "800", fontSize: 13 },
    claimButton: {
      borderRadius: 999,
      paddingHorizontal: 22,
      paddingVertical: 12,
      marginTop: 4,
      minWidth: 160,
      alignItems: "center",
    },
    claimButtonText: { color: "#0B1220", fontWeight: "800", fontSize: 14 },
  });
