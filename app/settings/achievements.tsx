import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Modal, Linking, AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import { ACHIEVEMENT_CATEGORIES } from "@/convex/helpers/achievements";
import * as Location from "expo-location";

export default function Achievements() {
  const router = useRouter();
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedBadge, setSelectedBadge] = useState<any>(null);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null); // null = loading

  // Check location permission on mount and when app returns from settings
  const checkLocationPermission = useCallback(async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  useEffect(() => {
    checkLocationPermission();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkLocationPermission();
    });
    return () => sub.remove();
  }, []);

  const handleRequestLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      setLocationGranted(true);
    } else {
      // Already denied once — must go to settings
      if (Platform.OS === "ios") {
        Linking.openSettings();
      } else {
        Linking.openSettings();
      }
    }
  };

  const data = useQuery(api.achievements.getUserAchievements as any, token ? { token } : "skip");
  const markSeen = useAuthenticatedMutation(api.achievements.markAchievementSeen as any);

  const achievements = data?.achievements || [];
  const filtered =
    selectedCategory === "all"
      ? achievements
      : achievements.filter((a: any) => a.category === selectedCategory);

  const handleBadgeTap = async (badge: any) => {
    setSelectedBadge(badge);
    if (badge.unlocked && !badge.seen && token) {
      await markSeen({ achievementId: badge.id });
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

        {/* Location permission banner */}
        {locationGranted === false && (
          <View style={styles.permissionBanner}>
            <Ionicons name="location-outline" size={28} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.permissionTitle}>{t("achievements.locationDisabledTitle")}</Text>
              <Text style={styles.permissionDesc}>{t("achievements.locationDisabledDesc")}</Text>
            </View>
            <TouchableOpacity style={styles.permissionButton} onPress={handleRequestLocation}>
              <Text style={styles.permissionButtonText}>{t("achievements.enableLocation")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Progress */}
        <View style={styles.progress}>
          <Text style={styles.progressText}>
            {data?.totalUnlocked ?? 0}/{data?.totalAvailable ?? 0} {t("achievements.unlocked", { count: data?.totalUnlocked ?? 0 })}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${((data?.totalUnlocked ?? 0) / Math.max(data?.totalAvailable ?? 1, 1)) * 100}%`,
                },
              ]}
            />
          </View>
        </View>

        {/* Category Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryContent}
        >
          <TouchableOpacity
            style={[styles.categoryTab, selectedCategory === "all" && styles.categoryTabActive]}
            onPress={() => setSelectedCategory("all")}
          >
            <Text style={[styles.categoryTabText, selectedCategory === "all" && styles.categoryTabTextActive]}>
              {t("achievements.all")}
            </Text>
          </TouchableOpacity>
          {ACHIEVEMENT_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.categoryTab, selectedCategory === cat.id && styles.categoryTabActive]}
              onPress={() => setSelectedCategory(cat.id)}
            >
              <Ionicons
                name={cat.icon as any}
                size={14}
                color={selectedCategory === cat.id ? colors.text : colors.textMuted}
              />
              <Text
                style={[styles.categoryTabText, selectedCategory === cat.id && styles.categoryTabTextActive]}
              >
                {t(cat.titleKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Badge Grid */}
        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          <View style={styles.grid}>
            {filtered.map((badge: any) => {
              // When location is denied, treat all badges as locked
              const isUnlocked = locationGranted === false ? false : badge.unlocked;
              return (
              <TouchableOpacity
                key={badge.id}
                style={[styles.badgeCard, !isUnlocked && styles.badgeCardLocked]}
                onPress={() => handleBadgeTap(badge)}
              >
                {!badge.seen && isUnlocked && <View style={styles.newDot} />}
                <View
                  style={[
                    styles.badgeIcon,
                    {
                      backgroundColor: isUnlocked
                        ? colors.primary + "30"
                        : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={badge.icon as any}
                    size={28}
                    color={isUnlocked ? colors.primary : colors.textMuted}
                  />
                </View>
                <Text
                  style={[styles.badgeName, !isUnlocked && styles.badgeNameLocked]}
                  numberOfLines={2}
                >
                  {t(badge.titleKey)}
                </Text>
              </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Badge Detail Modal */}
        <Modal
          visible={!!selectedBadge}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedBadge(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setSelectedBadge(null)}
          >
            <View style={styles.modalCard}>
              <View
                style={[
                  styles.modalIcon,
                  {
                    backgroundColor: selectedBadge?.unlocked
                      ? colors.primary + "30"
                      : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={selectedBadge?.icon as any}
                  size={40}
                  color={selectedBadge?.unlocked ? colors.primary : colors.textMuted}
                />
              </View>
              <Text style={styles.modalTitle}>{selectedBadge ? t(selectedBadge.titleKey) : ""}</Text>
              <Text style={styles.modalDescription}>
                {selectedBadge ? t(selectedBadge.descriptionKey) : ""}
              </Text>
              {selectedBadge?.unlocked && selectedBadge?.unlockedAt && (
                <Text style={styles.modalDate}>
                  {t("achievements.unlockedOn", { date: new Date(selectedBadge.unlockedAt).toLocaleDateString() })}
                </Text>
              )}
              {!selectedBadge?.unlocked && (
                <View style={styles.modalLocked}>
                  <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  <Text style={styles.modalLockedText}>{t("achievements.keepGoing")}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
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

    permissionBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.primary + "40",
    },
    permissionTitle: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 2 },
    permissionDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
    permissionButton: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginLeft: 8,
    },
    permissionButtonText: { fontSize: 12, fontWeight: "600", color: "#fff" },

    progress: { paddingHorizontal: 16, marginBottom: 12 },
    progressText: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 8 },
    progressBar: {
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },

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
    categoryTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    categoryTabText: { fontSize: 13, color: colors.textMuted, fontWeight: "500" },
    categoryTabTextActive: { color: colors.text, fontWeight: "600" },

    content: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

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
    badgeCardLocked: { opacity: 0.5 },
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
    badgeName: { fontSize: 11, fontWeight: "600", color: colors.text, textAlign: "center" },
    badgeNameLocked: { color: colors.textMuted },

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
      width: "80%",
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 8, textAlign: "center" },
    modalDescription: { fontSize: 14, color: colors.textSecondary, textAlign: "center", marginBottom: 12 },
    modalDate: { fontSize: 12, color: colors.textMuted },
    modalLocked: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
    modalLockedText: { fontSize: 13, color: colors.textMuted },
  });
