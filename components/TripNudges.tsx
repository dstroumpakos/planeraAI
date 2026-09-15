import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import * as SecureStore from "expo-secure-store";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/ThemeContext";
import { shareTripCalendar } from "@/lib/calendarExport";

const DAY_MS = 24 * 60 * 60 * 1000;
const dismissKey = (tripId: string) => `planTogetherDismissed:${tripId}`;

/**
 * Contextual nudges on the trip screen, each shown only when it makes sense:
 *
 *  - "Plan this together" once, for a trip with 2+ travellers and no
 *    collaborator yet (the invite deep-link already opens the app).
 *  - "Add to calendar" for any trip that hasn't ended — keeps the trip
 *    present outside the app.
 *  - "See your recap" for a trip that has ended.
 */
export default function TripNudges({
    trip, collaborators, isOwner, onInvite,
}: {
    trip: any;
    collaborators: any[] | undefined;
    isOwner: boolean;
    onInvite: () => Promise<void>;
}) {
    const router = useRouter();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const [dismissed, setDismissed] = useState<boolean | null>(null);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        let alive = true;
        SecureStore.getItemAsync(dismissKey(String(trip._id)))
            .then((v) => { if (alive) setDismissed(!!v); })
            .catch(() => { if (alive) setDismissed(false); });
        return () => { alive = false; };
    }, [trip._id]);

    const haptic = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
    const now = Date.now();
    const ended = typeof trip.endDate === "number" && trip.endDate < now - DAY_MS;
    const travelers = trip.travelerCount ?? trip.travelers ?? 1;
    const others = (collaborators || []).filter((c) => c.role !== "owner" && c.userId);
    const showPlanTogether = isOwner && !ended && dismissed === false && travelers >= 2 && others.length === 0;

    const dismiss = async () => {
        setDismissed(true);
        try { await SecureStore.setItemAsync(dismissKey(String(trip._id)), "1"); } catch {}
    };

    const exportCalendar = async () => {
        haptic();
        setExporting(true);
        try { await shareTripCalendar(trip); } catch (e) { console.warn("[calendar] export failed", e); }
        finally { setExporting(false); }
    };

    return (
        <View style={styles.wrap}>
            {showPlanTogether && (
                <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.bannerIcon, { backgroundColor: colors.secondary }]}>
                        <Ionicons name="people" size={20} color={colors.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.bannerTitle, { color: colors.text }]}>{t("tripNudges.planTogetherTitle")}</Text>
                        <Text style={[styles.bannerBody, { color: colors.textSecondary }]}>
                            {t("tripNudges.planTogetherBody", { count: travelers })}
                        </Text>
                        <View style={styles.bannerActions}>
                            <TouchableOpacity
                                style={[styles.bannerBtn, { backgroundColor: colors.primary }]}
                                onPress={async () => { haptic(); await onInvite(); dismiss(); }}
                            >
                                <Text style={styles.bannerBtnText}>{t("tripNudges.invite")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={dismiss} hitSlop={8}>
                                <Text style={[styles.bannerDismiss, { color: colors.textMuted }]}>{t("tripNudges.notNow")}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            <View style={styles.row}>
                {ended ? (
                    <TouchableOpacity
                        style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => { haptic(); router.push({ pathname: "/trip-recap", params: { tripId: trip._id } } as any); }}
                    >
                        <Ionicons name="images-outline" size={16} color={colors.text} />
                        <Text style={[styles.chipText, { color: colors.text }]}>{t("tripNudges.seeRecap")}</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity
                        style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={exportCalendar}
                        disabled={exporting}
                    >
                        <Ionicons name="calendar-outline" size={16} color={colors.text} />
                        <Text style={[styles.chipText, { color: colors.text }]}>
                            {exporting ? t("tripNudges.preparing") : t("tripNudges.addToCalendar")}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

// Kept for parity with the older Share-based invite callers.
export async function shareInviteMessage(message: string) {
    await Share.share({ message });
}

const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 20, gap: 10, marginBottom: 4 },
    banner: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
    bannerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    bannerTitle: { fontSize: 15, fontWeight: "700" },
    bannerBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
    bannerActions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
    bannerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
    bannerBtnText: { color: "#1A1A1A", fontSize: 13, fontWeight: "700" },
    bannerDismiss: { fontSize: 13, fontWeight: "600" },
    row: { flexDirection: "row", gap: 8 },
    chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
    chipText: { fontSize: 13, fontWeight: "600" },
});
