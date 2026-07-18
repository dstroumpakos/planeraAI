import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

/**
 * Confirmed reservations for a trip — the user's REAL bookings, rendered as a
 * distinct layer above the AI itinerary.
 *
 * These deliberately live outside `trip.itinerary`: that blob is regenerated,
 * deduped and resequenced by the generation pipeline, which would silently
 * destroy a real booking. Reservations are facts; itinerary activities are
 * suggestions. Keeping them separate is what makes "regenerate this day" safe.
 */

const TYPE_META: Record<string, { icon: any; color: string }> = {
    flight: { icon: "airplane", color: "#3B82F6" },
    hotel: { icon: "bed", color: "#8B5CF6" },
    car: { icon: "car-sport", color: "#F59E0B" },
    rail: { icon: "train", color: "#10B981" },
    ferry: { icon: "boat", color: "#0EA5E9" },
    activity: { icon: "ticket", color: "#EC4899" },
    restaurant: { icon: "restaurant", color: "#EF4444" },
    other: { icon: "document-text", color: "#6B7280" },
};

function formatWhen(startAt?: number, endAt?: number): string {
    if (!startAt) return "";
    const start = new Date(startAt);
    const d: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    const tm: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
    if (!endAt) return `${start.toLocaleDateString(undefined, d)} · ${start.toLocaleTimeString(undefined, tm)}`;
    const end = new Date(endAt);
    if (start.toDateString() === end.toDateString()) {
        return `${start.toLocaleDateString(undefined, d)} · ${start.toLocaleTimeString(undefined, tm)} – ${end.toLocaleTimeString(undefined, tm)}`;
    }
    return `${start.toLocaleDateString(undefined, d)} → ${end.toLocaleDateString(undefined, d)}`;
}

export default function TripReservations({ tripId }: { tripId: string }) {
    const { token } = useToken();
    const { colors } = useTheme();
    const { t } = useTranslation();
    const router = useRouter();

    const data = useQuery(
        api.reservations.listForTrip as any,
        token && tripId ? { token, tripId } : "skip"
    );

    const items = data?.items ?? [];
    if (items.length === 0) return null;

    return (
        <View style={styles.wrapper}>
            <View style={styles.headerRow}>
                <Text style={[styles.header, { color: colors.text }]}>
                    {t("reservations.yourBookings", { defaultValue: "Your bookings" })}
                </Text>
                <TouchableOpacity onPress={() => router.push("/settings/reservations" as any)}>
                    <Text style={[styles.manage, { color: colors.textMuted }]}>
                        {t("reservations.manage", { defaultValue: "Manage" })}
                    </Text>
                </TouchableOpacity>
            </View>
            <Text style={[styles.subheader, { color: colors.textMuted }]}>
                {t("reservations.confirmedSubtitle", {
                    defaultValue: "Confirmed and locked — your plan works around these.",
                })}
            </Text>

            {items.map((item: any) => {
                const meta = TYPE_META[item.type] ?? TYPE_META.other;
                return (
                    <View
                        key={item._id}
                        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                        <View style={[styles.icon, { backgroundColor: meta.color + "22" }]}>
                            <Ionicons name={meta.icon} size={17} color={meta.color} />
                        </View>
                        <View style={styles.body}>
                            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                                {item.title}
                            </Text>
                            <View style={styles.metaRow}>
                                {!!item.startAt && (
                                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                                        {formatWhen(item.startAt, item.endAt)}
                                    </Text>
                                )}
                                {!!item.confirmationCode && (
                                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                                        · {item.confirmationCode}
                                    </Text>
                                )}
                            </View>
                        </View>
                        <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { marginTop: 24, marginBottom: 8 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    header: { fontSize: 18, fontWeight: "700" },
    manage: { fontSize: 13, fontWeight: "600" },
    subheader: { fontSize: 13, marginTop: 3, marginBottom: 12 },
    card: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginBottom: 8,
    },
    icon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    body: { flex: 1 },
    title: { fontSize: 14.5, fontWeight: "600", lineHeight: 19 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 },
    meta: { fontSize: 12.5 },
});
