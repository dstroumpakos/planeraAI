import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

/**
 * "This month" — replaces the daily streak on the home tab.
 *
 * A daily streak retains in habit apps; travel isn't a habit, so the streak
 * mostly produced guilt and then a broken streak. A monthly rhythm matches
 * how often people daydream about trips. Three rows, each a real thing to
 * do in the app this month, plus the free-credit line for non-subscribers.
 */
export default function ThisMonthCard({ trips, userPlan }: { trips: any[] | undefined; userPlan: any }) {
    const router = useRouter();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const { token } = useToken();

    const worldPrint = useQuery((api as any).worldPrint.getMyWorldPrint, token ? { token } : "skip");
    const watched = useQuery((api as any).watchedDestinations.getWatchedDestinations, token ? { token } : "skip");
    const myInsights = useQuery((api as any).insights.getMyInsights, token ? { token } : "skip");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Nearest quest: highest progress that isn't claimed yet; claimable first.
    const quest = useMemo(() => {
        const qs: any[] = worldPrint?.quests || [];
        const open = qs.filter((q) => !q.isClaimed);
        open.sort((a, b) => (b.isClaimable ? 1 : 0) - (a.isClaimable ? 1 : 0) || b.progress - a.progress);
        return open[0] || null;
    }, [worldPrint]);

    // A finished trip that has no tip yet is the concrete "write one" target.
    const tipTarget = useMemo(() => {
        if (!trips) return null;
        const withTip = new Set((myInsights || []).map((i: any) => String(i.tripId || "")));
        const ended = trips
            .filter((tr) => tr.status === "completed" && typeof tr.endDate === "number" && tr.endDate < Date.now())
            .sort((a, b) => b.endDate - a.endDate);
        return ended.find((tr) => !withTip.has(String(tr._id))) || null;
    }, [trips, myInsights]);

    const tipsThisMonth = (myInsights || []).filter((i: any) => (i._creationTime || 0) >= monthStart).length;
    const watchCount = watched?.length ?? 0;

    const isPremium =
        userPlan?.plan === "premium" && (!userPlan?.subscriptionExpiresAt || userPlan.subscriptionExpiresAt > Date.now());
    const credits = userPlan?.tripCredits ?? 0;

    const monthName = now.toLocaleDateString(undefined, { month: "long" });

    const Row = ({
        icon, title, sub, done, onPress,
    }: { icon: any; title: string; sub: string; done: boolean; onPress: () => void }) => (
        <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
            <View style={[styles.check, { borderColor: done ? colors.primary : colors.border, backgroundColor: done ? colors.primary : "transparent" }]}>
                {done ? <Ionicons name="checkmark" size={14} color="#1A1A1A" /> : <Ionicons name={icon} size={13} color={colors.textMuted} />}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.text }, done && styles.rowDone]} numberOfLines={1}>{title}</Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
    );

    return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: colors.text }]}>{t("thisMonth.title", { month: monthName })}</Text>
                {!isPremium && (
                    <View style={[styles.creditPill, { backgroundColor: colors.secondary }]}>
                        <Ionicons name="sparkles" size={12} color={colors.text} />
                        <Text style={[styles.creditText, { color: colors.text }]}>
                            {t("thisMonth.credits", { count: credits })}
                        </Text>
                    </View>
                )}
            </View>

            <Row
                icon="compass"
                title={quest ? quest.name : t("thisMonth.questFallback")}
                sub={quest
                    ? quest.isClaimable
                        ? t("thisMonth.questClaim")
                        : t("thisMonth.questProgress", { done: quest.completedCount, total: quest.totalCount })
                    : t("thisMonth.questFallbackSub")}
                done={!!quest?.isClaimable}
                onPress={() => router.push("/worldprint" as any)}
            />
            <Row
                icon="notifications-outline"
                title={watchCount > 0 ? t("thisMonth.watchCheck", { count: watchCount }) : t("thisMonth.watchAdd")}
                sub={watchCount > 0 ? t("thisMonth.watchCheckSub") : t("thisMonth.watchAddSub")}
                done={watchCount >= 3}
                onPress={() => router.push("/destinations" as any)}
            />
            <Row
                icon="bulb-outline"
                title={tipTarget
                    ? t("thisMonth.tipFor", { dest: String(tipTarget.destination).split(",")[0] })
                    : t("thisMonth.tipGeneric")}
                sub={tipsThisMonth > 0 ? t("thisMonth.tipDone", { count: tipsThisMonth }) : t("thisMonth.tipSub")}
                done={tipsThisMonth > 0}
                onPress={() =>
                    router.push(
                        tipTarget
                            ? ({ pathname: "/settings/share-insight", params: { tripId: tipTarget._id, destination: tipTarget.destination } } as any)
                            : ("/settings/share-insight" as any),
                    )
                }
            />

            {!isPremium && (
                <Text style={[styles.footnote, { color: colors.textMuted }]}>{t("thisMonth.nextCredit")}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { marginHorizontal: 20, marginBottom: 20, borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    title: { fontSize: 17, fontWeight: "700" },
    creditPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
    creditText: { fontSize: 12, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    rowTitle: { fontSize: 14.5, fontWeight: "600" },
    rowDone: { textDecorationLine: "line-through", opacity: 0.6 },
    rowSub: { fontSize: 12.5, marginTop: 1 },
    footnote: { fontSize: 11.5, marginTop: 4 },
});
