import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

export default function TravelStats() {
  const router = useRouter();
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();

  const stats = useQuery(api.stats.getUserStats as any, token ? { token } : "skip");

  const statCards = [
    { icon: "airplane", label: t("stats.trips"), value: stats?.totalTrips ?? 0, color: "#3B82F6" },
    { icon: "globe", label: t("stats.countries"), value: stats?.totalCountries ?? 0, color: "#10B981" },
    { icon: "location", label: t("stats.cities"), value: stats?.totalCities ?? 0, color: "#8B5CF6" },
    { icon: "ticket", label: t("stats.flightsBooked"), value: stats?.totalFlightsBooked ?? 0, color: "#F59E0B" },
    { icon: "bulb", label: t("stats.insightsShared"), value: stats?.insightsShared ?? 0, color: "#EC4899" },
    { icon: "heart", label: t("stats.likesReceived"), value: stats?.totalLikesReceived ?? 0, color: "#EF4444" },
  ];

  const maxBarValue = stats?.monthlyHistory
    ? Math.max(...stats.monthlyHistory.map((m: any) => m.count), 1)
    : 1;

  const styles = createStyles(colors, isDarkMode);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("stats.travelStats")}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {/* Hero */}
          <View style={styles.heroSection}>
            <Text style={styles.heroNumber}>{stats?.totalTrips ?? 0}</Text>
            <Text style={styles.heroLabel}>{t("stats.tripsCompleted")}</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Ionicons name="globe" size={18} color="#10B981" />
                <Text style={styles.heroStatText}>{stats?.totalCountries ?? 0} {t("stats.countries")}</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Ionicons name="location" size={18} color="#8B5CF6" />
                <Text style={styles.heroStatText}>{stats?.totalCities ?? 0} {t("stats.cities")}</Text>
              </View>
            </View>
          </View>

          {/* Stat Cards Grid */}
          <View style={styles.grid}>
            {statCards.map((card) => (
              <View key={card.label} style={styles.statCard}>
                <View style={[styles.statIconBg, { backgroundColor: card.color + "20" }]}>
                  <Ionicons name={card.icon as any} size={20} color={card.color} />
                </View>
                <Text style={styles.statValue}>{card.value}</Text>
                <Text style={styles.statLabel}>{card.label}</Text>
              </View>
            ))}
          </View>

          {/* Favorite Destination */}
          {stats?.favoriteDestination && (
            <View style={styles.infoCard}>
              <Ionicons name="star" size={20} color={colors.primary} />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoLabel}>{t("stats.favoriteDestination")}</Text>
                <Text style={styles.infoValue}>{stats.favoriteDestination}</Text>
              </View>
            </View>
          )}

          {/* Trip Records */}
          {(stats?.longestTripDays ?? 0) > 0 && (
            <View style={styles.recordsRow}>
              <View style={styles.recordCard}>
                <Text style={styles.recordValue}>{stats?.longestTripDays}d</Text>
                <Text style={styles.recordLabel}>{t("stats.longestTrip")}</Text>
              </View>
              <View style={styles.recordCard}>
                <Text style={styles.recordValue}>{stats?.shortestTripDays}d</Text>
                <Text style={styles.recordLabel}>{t("stats.shortestTrip")}</Text>
              </View>
            </View>
          )}

          {/* Monthly Chart (Premium) */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("stats.monthlyActivity")}</Text>
            {!stats?.isPremium && (
              <View style={styles.premiumBadge}>
                <Ionicons name="diamond" size={12} color={colors.primary} />
                <Text style={styles.premiumBadgeText}>Premium</Text>
              </View>
            )}
          </View>

          {stats?.monthlyHistory ? (
            <View style={styles.chartContainer}>
              {stats.monthlyHistory.map((month: any, index: number) => (
                <View key={month.month} style={styles.barColumn}>
                  <Text style={styles.barValue}>{month.count > 0 ? month.count : ""}</Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max((month.count / maxBarValue) * 80, 4),
                        backgroundColor: month.count > 0 ? colors.primary : colors.border,
                      },
                    ]}
                  />
                  <Text style={styles.barLabel}>
                    {month.month.split("-")[1]}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <TouchableOpacity
              style={styles.premiumLock}
              onPress={() => router.push("/subscription")}
            >
              <Ionicons name="lock-closed" size={24} color={colors.textMuted} />
              <Text style={styles.premiumLockText}>{t("stats.unlockWithPremium")}</Text>
            </TouchableOpacity>
          )}

          {/* Top Interests */}
          {stats?.topInterests && stats.topInterests.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t("stats.topInterests")}</Text>
                {!stats?.isPremium && stats.topInterests.length <= 2 && (
                  <View style={styles.premiumBadge}>
                    <Ionicons name="diamond" size={12} color={colors.primary} />
                    <Text style={styles.premiumBadgeText}>Premium</Text>
                  </View>
                )}
              </View>
              {stats.topInterests.map((interest: any, i: number) => (
                <View key={interest.name} style={styles.interestRow}>
                  <Text style={styles.interestRank}>#{i + 1}</Text>
                  <Text style={styles.interestName}>{String(t(`interests.${interest.name}`, interest.name))}</Text>
                  <Text style={styles.interestCount}>{interest.count} {t("stats.trips").toLowerCase()}</Text>
                </View>
              ))}
            </>
          )}

          {/* Spending (Premium) */}
          {stats?.totalSpentOnFlights !== null && stats?.totalSpentOnFlights !== undefined && (
            <View style={styles.infoCard}>
              <Ionicons name="card" size={20} color="#3B82F6" />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoLabel}>{t("stats.totalFlightSpend")}</Text>
                <Text style={styles.infoValue}>
                  {stats.flightCurrency === "EUR" ? "€" : stats.flightCurrency === "USD" ? "$" : stats.flightCurrency}
                  {stats.totalSpentOnFlights.toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
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
    content: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

    heroSection: {
      alignItems: "center",
      paddingVertical: 24,
      backgroundColor: colors.card,
      borderRadius: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroNumber: { fontSize: 48, fontWeight: "800", color: colors.primary },
    heroLabel: { fontSize: 16, color: colors.textSecondary, marginTop: 4 },
    heroRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
    heroStat: { flexDirection: "row", alignItems: "center", gap: 6 },
    heroStatText: { fontSize: 14, fontWeight: "600", color: colors.text },
    heroDivider: { width: 1, height: 16, backgroundColor: colors.border, marginHorizontal: 16 },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginBottom: 16,
    },
    statCard: {
      width: "47%",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statIconBg: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    statValue: { fontSize: 24, fontWeight: "700", color: colors.text },
    statLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

    infoCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    infoTextContainer: { flex: 1 },
    infoLabel: { fontSize: 13, color: colors.textSecondary },
    infoValue: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 2 },

    recordsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
    recordCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    recordValue: { fontSize: 24, fontWeight: "700", color: colors.primary },
    recordLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
      marginTop: 8,
    },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    premiumBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: isDarkMode ? "rgba(255,229,0,0.15)" : "#FFF8E1",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    premiumBadgeText: { fontSize: 11, fontWeight: "600", color: colors.primary },

    chartContainer: {
      flexDirection: "row",
      alignItems: "flex-end",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      height: 140,
      gap: 2,
    },
    barColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
    bar: { width: "70%", borderRadius: 4, minHeight: 4 },
    barValue: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
    barLabel: { fontSize: 9, color: colors.textMuted, marginTop: 4 },

    premiumLock: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 32,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    premiumLockText: { fontSize: 14, color: colors.textMuted },

    interestRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    interestRank: { fontSize: 14, fontWeight: "700", color: colors.primary, width: 30 },
    interestName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
    interestCount: { fontSize: 13, color: colors.textSecondary },
  });
