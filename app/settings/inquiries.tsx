/**
 * My Inquiries — list of OTA package inquiries the user has submitted,
 * with their current status.
 */
import React from "react";
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image, StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

const STATUS_COLORS: Record<string, string> = {
    pending: "#f59e0b",
    sent: "#0ea5e9",
    contacted: "#6366f1",
    converted: "#10b981",
    failed: "#ef4444",
    closed: "#6b7280",
};

const STATUS_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    pending: "time-outline",
    sent: "paper-plane-outline",
    contacted: "chatbubbles-outline",
    converted: "checkmark-done-circle-outline",
    failed: "alert-circle-outline",
    closed: "lock-closed-outline",
};

export default function MyInquiriesScreen() {
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const { token } = useToken();

    const leads = useQuery(
        (api as any).otaPackages.listMyLeads,
        token ? { token } : "skip",
    );

    const fmtDate = (ts: number) =>
        new Date(ts).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" });

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{t("packages.myInquiriesTitle")}</Text>
                    <View style={{ width: 40 }} />
                </View>

                {!leads ? (
                    <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
                ) : leads.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <View style={[styles.emptyCircle, { backgroundColor: isDarkMode ? 'rgba(14,165,233,0.15)' : '#dbeafe' }]}>
                            <Ionicons name="briefcase-outline" size={36} color="#0EA5E9" />
                        </View>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>{t("packages.noInquiriesTitle")}</Text>
                        <Text style={[styles.emptyDesc, { color: colors.textMuted }]}>{t("packages.noInquiriesDesc")}</Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                            {t("packages.myInquiriesSubtitle")}
                        </Text>
                        {leads.map((lead: any) => {
                            const status = lead.status as string;
                            const color = STATUS_COLORS[status] || '#6b7280';
                            const icon = STATUS_ICONS[status] || 'help-circle-outline';
                            return (
                                <View
                                    key={lead._id}
                                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                                >
                                    <View style={styles.cardRow}>
                                        {lead.package?.heroImageUrl ? (
                                            <Image source={{ uri: lead.package.heroImageUrl }} style={styles.thumb} />
                                        ) : (
                                            <View style={[styles.thumb, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#f3f4f6', alignItems: 'center', justifyContent: 'center' }]}>
                                                <Ionicons name="briefcase" size={22} color={colors.textMuted} />
                                            </View>
                                        )}
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                                                {lead.package?.title || '—'}
                                            </Text>
                                            <Text style={[styles.partner, { color: colors.textMuted }]} numberOfLines={1}>
                                                {lead.partner?.name || ''}
                                            </Text>
                                            <Text style={[styles.dest, { color: colors.textMuted }]} numberOfLines={1}>
                                                {lead.destination}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={[styles.divider, { backgroundColor: colors.border }]} />

                                    <View style={styles.statusRow}>
                                        <View style={[styles.statusPill, { backgroundColor: `${color}22` }]}>
                                            <Ionicons name={icon} size={13} color={color} />
                                            <Text style={[styles.statusText, { color }]}>{t(`packages.status${status.charAt(0).toUpperCase() + status.slice(1)}`)}</Text>
                                        </View>
                                        <Text style={[styles.sentOn, { color: colors.textMuted }]}>
                                            {t("packages.sentOn", { date: fmtDate(lead.createdAt) })}
                                        </Text>
                                    </View>
                                </View>
                            );
                        })}
                    </ScrollView>
                )}
            </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
    headerTitle: { fontSize: 17, fontWeight: '700' },
    iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
    emptyCircle: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 6 },
    emptyDesc: { fontSize: 13, textAlign: 'center', maxWidth: 280 },
    subtitle: { fontSize: 13, marginBottom: 12 },
    card: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
    cardRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    thumb: { width: 70, height: 70, borderRadius: 10 },
    title: { fontSize: 15, fontWeight: '700' },
    partner: { fontSize: 12, marginTop: 2 },
    dest: { fontSize: 12, marginTop: 2 },
    divider: { height: 1, marginVertical: 10 },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
    statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    sentOn: { fontSize: 11 },
});
