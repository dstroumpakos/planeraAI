import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useConvex } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { formatFare } from "@/lib/currency";
import { dealTripParams } from "@/lib/dealNav";

/**
 * "Your watched fares" — the home-tab surface for destination watches.
 *
 * The push side of watching already exists (radar price drops notify
 * watchers); this is the pull side, so a user has a reason to open the app
 * between trips even when nothing has dropped yet. The empty state sells
 * the feature rather than hiding the row.
 */
export default function WatchedFaresRow() {
    const router = useRouter();
    const convex = useConvex();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const { token } = useToken();
    // `as any`: retention.ts postdates the generated api types.
    const data = useQuery((api as any).retention.getWatchedFares, token ? { token } : "skip");

    if (!token || data === undefined) return null;

    const openDeal = async (dealId: string) => {
        const deal: any = await convex.query((api as any).lowFareRadar.get, { id: dealId }).catch(() => null);
        if (!deal) return;
        router.push({ pathname: "/deal-trip", params: dealTripParams(deal) } as any);
    };

    const watches: any[] = data.watches || [];

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                    <Ionicons name="notifications" size={18} color={colors.text} />
                    <Text style={[styles.title, { color: colors.text }]}>{t("watchedFares.title")}</Text>
                </View>
                <TouchableOpacity onPress={() => router.push("/destinations" as any)}>
                    <Text style={[styles.manage, { color: colors.textSecondary }]}>
                        {watches.length > 0 ? t("watchedFares.manage") : t("watchedFares.addSome")}
                    </Text>
                </TouchableOpacity>
            </View>

            {watches.length === 0 ? (
                <TouchableOpacity
                    style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => router.push("/destinations" as any)}
                    activeOpacity={0.8}
                >
                    <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
                        <Ionicons name="trending-down" size={20} color={colors.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>{t("watchedFares.emptyTitle")}</Text>
                        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{t("watchedFares.emptyBody")}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
                    {watches.map((w) => {
                        const best = w.best;
                        const pct = best?.pctVsTypical;
                        const below = typeof pct === "number" && pct < 0;
                        const trendColor = typeof pct !== "number" ? colors.textMuted : below ? "#16A34A" : pct > 0 ? "#DC2626" : colors.textMuted;
                        return (
                            <TouchableOpacity
                                key={w.destination}
                                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                                activeOpacity={0.85}
                                onPress={() => {
                                    if (best?.dealId) openDeal(best.dealId);
                                    else router.push({ pathname: "/destination-preview", params: { destination: w.label } } as any);
                                }}
                            >
                                <Text style={[styles.route, { color: colors.textMuted }]} numberOfLines={1}>
                                    {data.homeIata ? `${data.homeIata} → ` : ""}{w.destinationIata || ""}
                                </Text>
                                <Text style={[styles.dest, { color: colors.text }]} numberOfLines={1}>{w.label}</Text>
                                {best ? (
                                    <>
                                        <Text style={[styles.price, { color: colors.text }]}>
                                            {t("watchedFares.from")} {formatFare(best.price, best.currency)}
                                        </Text>
                                        <View style={styles.trendRow}>
                                            <Ionicons
                                                name={typeof pct !== "number" ? "remove" : below ? "arrow-down" : pct > 0 ? "arrow-up" : "remove"}
                                                size={13}
                                                color={trendColor}
                                            />
                                            <Text style={[styles.trend, { color: trendColor }]} numberOfLines={1}>
                                                {typeof pct === "number"
                                                    ? t(below ? "watchedFares.belowTypical" : pct > 0 ? "watchedFares.aboveTypical" : "watchedFares.atTypical", { pct: Math.abs(pct) })
                                                    : t("watchedFares.noTypical")}
                                            </Text>
                                        </View>
                                    </>
                                ) : (
                                    <>
                                        <Text style={[styles.price, { color: colors.textMuted }]}>{t("watchedFares.noFare")}</Text>
                                        <View style={styles.trendRow}>
                                            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                                            <Text style={[styles.trend, { color: colors.textMuted }]} numberOfLines={1}>
                                                {data.hasHomeAirport ? t("watchedFares.watching") : t("watchedFares.setHomeAirport")}
                                            </Text>
                                        </View>
                                    </>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                    <TouchableOpacity
                        style={[styles.card, styles.addCard, { borderColor: colors.border }]}
                        onPress={() => router.push("/destinations" as any)}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="add-circle-outline" size={26} color={colors.textMuted} />
                        <Text style={[styles.addText, { color: colors.textSecondary }]}>{t("watchedFares.addAnother")}</Text>
                    </TouchableOpacity>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { marginTop: 8, marginBottom: 16 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 10 },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 18, fontWeight: "700" },
    manage: { fontSize: 13, fontWeight: "600" },
    scroll: { paddingHorizontal: 20, gap: 10 },
    card: { width: 150, borderRadius: 14, borderWidth: 1, padding: 12 },
    route: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginBottom: 2 },
    dest: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
    price: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
    trendRow: { flexDirection: "row", alignItems: "center", gap: 3 },
    trend: { fontSize: 11, fontWeight: "600", flex: 1 },
    addCard: { alignItems: "center", justifyContent: "center", borderStyle: "dashed", gap: 6 },
    addText: { fontSize: 12, fontWeight: "600", textAlign: "center" },
    empty: { marginHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
    emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    emptyTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
    emptyBody: { fontSize: 13, lineHeight: 18 },
});
