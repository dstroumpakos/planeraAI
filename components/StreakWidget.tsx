import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState } from "react";

export default function StreakWidget() {
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();
  const [showDetail, setShowDetail] = useState(false);

  const streakData = useQuery(api.streaks.getStreak as any, token ? { token } : "skip");
  const currentStreak = streakData?.currentStreak ?? 0;

  if (!streakData || currentStreak === 0) return null;

  return (
    <>
      <TouchableOpacity style={createStyles(colors, isDarkMode).streakBadge} onPress={() => setShowDetail(true)}>
        <Ionicons name="flame" size={16} color="#F97316" />
        <Text style={createStyles(colors, isDarkMode).streakText}>{currentStreak}</Text>
      </TouchableOpacity>

      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <TouchableOpacity style={createStyles(colors, isDarkMode).overlay} activeOpacity={1} onPress={() => setShowDetail(false)}>
          <View style={createStyles(colors, isDarkMode).card}>
            <View style={createStyles(colors, isDarkMode).flameCircle}>
              <Ionicons name="flame" size={36} color="#F97316" />
            </View>
            <Text style={createStyles(colors, isDarkMode).cardTitle}>
              {t("streaks.dayStreak", { count: currentStreak })}
            </Text>
            <Text style={createStyles(colors, isDarkMode).cardSubtitle}>{t("streaks.keepItUp")}</Text>

            <View style={createStyles(colors, isDarkMode).statsRow}>
              <View style={createStyles(colors, isDarkMode).statItem}>
                <Text style={createStyles(colors, isDarkMode).statNumber}>{streakData.longestStreak}</Text>
                <Text style={createStyles(colors, isDarkMode).statLabel}>{t("streaks.longest")}</Text>
              </View>
              <View style={createStyles(colors, isDarkMode).divider} />
              <View style={createStyles(colors, isDarkMode).statItem}>
                <Text style={createStyles(colors, isDarkMode).statNumber}>{streakData.totalCheckIns}</Text>
                <Text style={createStyles(colors, isDarkMode).statLabel}>{t("streaks.totalDays")}</Text>
              </View>
            </View>

            {streakData.hasStreakShield && (
              <View style={createStyles(colors, isDarkMode).shieldBadge}>
                <Ionicons name="shield-checkmark" size={16} color="#10B981" />
                <Text style={createStyles(colors, isDarkMode).shieldText}>{t("streaks.shieldActive")}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
  StyleSheet.create({
    streakBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: isDarkMode ? "rgba(249,115,22,0.15)" : "#FFF7ED",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
    },
    streakText: { fontSize: 14, fontWeight: "700", color: "#F97316" },

    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 28,
      alignItems: "center",
      width: "80%",
      borderWidth: 1,
      borderColor: colors.border,
    },
    flameCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: isDarkMode ? "rgba(249,115,22,0.15)" : "#FFF7ED",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    cardTitle: { fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 4 },
    cardSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20 },

    statsRow: { flexDirection: "row", alignItems: "center", width: "100%" },
    statItem: { flex: 1, alignItems: "center" },
    statNumber: { fontSize: 22, fontWeight: "700", color: colors.text },
    statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    divider: { width: 1, height: 30, backgroundColor: colors.border },

    shieldBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: isDarkMode ? "rgba(16,185,129,0.15)" : "#D1FAE5",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 10,
      marginTop: 16,
    },
    shieldText: { fontSize: 13, fontWeight: "600", color: "#10B981" },
  });
