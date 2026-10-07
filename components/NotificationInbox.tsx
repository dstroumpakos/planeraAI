import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useConvex } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { openNotificationTarget } from "@/lib/useNotifications";
import { useNotificationInbox, type InboxItem } from "@/lib/useNotificationInbox";

const PAGE = 30;

type Filter = "all" | "deals" | "trips" | "other";

const CATEGORY_ICON: Record<InboxItem["category"], string> = {
    deals: "pricetag",
    trips: "airplane",
    account: "gift",
    general: "notifications",
};

/**
 * Every notification we've sent this user (notificationLog), newest first.
 * Tapping a row opens the same screen the push would have, and marks it read.
 */
export default function NotificationInbox() {
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const convex = useConvex();
    const { token } = useToken();
    const [limit, setLimit] = useState(PAGE);
    const [filter, setFilter] = useState<Filter>("all");
    // Optimistic reads, so the dot clears on tap before the query refreshes.
    const [readLocally, setReadLocally] = useState<Set<string>>(new Set());
    const [markingAll, setMarkingAll] = useState(false);
    const { page, error } = useNotificationInbox(limit);

    const items = useMemo(() => {
        const all = (page?.items || []).map((i) => (readLocally.has(i._id) ? { ...i, read: true } : i));
        if (filter === "all") return all;
        if (filter === "other") return all.filter((i) => i.category === "account" || i.category === "general");
        return all.filter((i) => i.category === filter);
    }, [page, filter, readLocally]);

    const hasUnread = (page?.items || []).some((i) => !i.read && !readLocally.has(i._id));

    const formatWhen = (ts: number) => {
        const mins = Math.floor((Date.now() - ts) / 60000);
        if (mins < 1) return t("settings.notifications.timeNow");
        if (mins < 60) return t("settings.notifications.timeMinutes", { count: mins });
        const hours = Math.floor(mins / 60);
        if (hours < 24) return t("settings.notifications.timeHours", { count: hours });
        const days = Math.floor(hours / 24);
        if (days < 7) return t("settings.notifications.timeDays", { count: days });
        try {
            return new Date(ts).toLocaleDateString(i18n.language, { day: "numeric", month: "short" });
        } catch {
            return new Date(ts).toDateString();
        }
    };

    const onPressItem = async (item: InboxItem) => {
        setReadLocally((prev) => new Set(prev).add(item._id));
        // Marks the row read too (via notificationId), even when the payload
        // has no destination to open.
        await openNotificationTarget(
            { ...(item.data || {}), notificationId: item._id },
            { router, convex, token, via: "inbox" }
        ).catch(() => false);
    };

    const markAllRead = async () => {
        if (!token || markingAll) return;
        setMarkingAll(true);
        setReadLocally(new Set((page?.items || []).map((i) => i._id)));
        try {
            await convex.mutation((api as any).notifications.markAllRead, { token });
        } catch (e) {
            console.warn("[NotificationInbox] markAllRead failed:", e);
        } finally {
            setMarkingAll(false);
        }
    };

    const filters: Array<{ key: Filter; label: string }> = [
        { key: "all", label: t("settings.notifications.filterAll") },
        { key: "deals", label: t("settings.notifications.filterDeals") },
        { key: "trips", label: t("settings.notifications.filterTrips") },
        { key: "other", label: t("settings.notifications.filterOther") },
    ];

    if (page === undefined && !error) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
            </View>
        );
    }

    const header = (
        <View>
            <View style={styles.filterRow}>
                {filters.map((f) => {
                    const active = filter === f.key;
                    return (
                        <TouchableOpacity
                            key={f.key}
                            onPress={() => setFilter(f.key)}
                            style={[
                                styles.chip,
                                { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card },
                            ]}
                        >
                            <Text style={[styles.chipText, { color: active ? "#1A1A1A" : colors.textSecondary }]}>{f.label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
            {hasUnread && (
                <TouchableOpacity onPress={markAllRead} style={styles.markAll} disabled={markingAll}>
                    <Ionicons name="checkmark-done" size={16} color={colors.textSecondary} />
                    <Text style={[styles.markAllText, { color: colors.textSecondary }]}>{t("settings.notifications.markAllRead")}</Text>
                </TouchableOpacity>
            )}
        </View>
    );

    return (
        <FlatList
            data={items}
            keyExtractor={(i) => i._id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={header}
            ListEmptyComponent={
                <View style={styles.empty}>
                    <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
                        <Ionicons name="notifications-outline" size={28} color={colors.text} />
                    </View>
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>
                        {error ? t("settings.notifications.loadError") : t("settings.notifications.emptyTitle")}
                    </Text>
                    {!error && (
                        <Text style={[styles.emptyBody, { color: colors.textMuted }]}>{t("settings.notifications.emptyBody")}</Text>
                    )}
                </View>
            }
            renderItem={({ item }) => (
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => onPressItem(item)}
                    style={[
                        styles.row,
                        { backgroundColor: item.read ? colors.card : (isDarkMode ? "#2A2817" : "#FFFBE6"), borderColor: colors.border },
                    ]}
                >
                    <View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}>
                        <Ionicons name={CATEGORY_ICON[item.category] as any} size={18} color={colors.text} />
                    </View>
                    <View style={styles.rowText}>
                        <View style={styles.rowTop}>
                            <Text
                                numberOfLines={1}
                                style={[styles.rowTitle, { color: colors.text, fontWeight: item.read ? "500" : "700" }]}
                            >
                                {item.title}
                            </Text>
                            <Text style={[styles.rowTime, { color: colors.textMuted }]}>{formatWhen(item.sentAt)}</Text>
                        </View>
                        <Text numberOfLines={3} style={[styles.rowBody, { color: colors.textSecondary }]}>{item.body}</Text>
                    </View>
                    {!item.read && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
                </TouchableOpacity>
            )}
            ListFooterComponent={
                page?.hasMore ? (
                    <TouchableOpacity onPress={() => setLimit((l) => l + PAGE)} style={[styles.more, { borderColor: colors.border }]}>
                        <Text style={[styles.moreText, { color: colors.text }]}>{t("settings.notifications.loadMore")}</Text>
                    </TouchableOpacity>
                ) : null
            }
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
    list: { padding: 20, paddingBottom: 40 },
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1 },
    chipText: { fontSize: 13, fontWeight: "600" },
    markAll: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingVertical: 4, marginBottom: 8 },
    markAllText: { fontSize: 13, fontWeight: "600" },
    row: {
        flexDirection: "row",
        alignItems: "flex-start",
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 10,
    },
    rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
    rowText: { flex: 1 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
    rowTitle: { flex: 1, fontSize: 15 },
    rowTime: { fontSize: 12 },
    rowBody: { fontSize: 13, lineHeight: 18 },
    dot: { width: 9, height: 9, borderRadius: 5, marginLeft: 8, marginTop: 6 },
    empty: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 20 },
    emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 14 },
    emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6, textAlign: "center" },
    emptyBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },
    more: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: "center", marginTop: 4 },
    moreText: { fontSize: 14, fontWeight: "600" },
});
