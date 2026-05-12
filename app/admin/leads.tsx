/**
 * Admin: OTA partner leads viewer.
 */
import React, { useState } from "react";
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, StatusBar, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

const STATUSES = ["all", "pending", "sent", "contacted", "converted", "failed", "closed"] as const;

const STATUS_COLORS: Record<string, string> = {
    pending: "#f59e0b",
    sent: "#0ea5e9",
    contacted: "#6366f1",
    converted: "#10b981",
    failed: "#ef4444",
    closed: "#6b7280",
};

export default function AdminLeadsScreen() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    const [filter, setFilter] = useState<typeof STATUSES[number]>("all");

    const leads = useQuery(
        (api as any).otaAdmin.listAllLeads,
        token ? { token, status: filter === "all" ? undefined : filter } : "skip",
    );
    const updateStatus = useMutation((api as any).otaAdmin.updateLeadStatus);

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Partner Leads</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                    {STATUSES.map(s => {
                        const active = s === filter;
                        return (
                            <TouchableOpacity
                                key={s}
                                style={[styles.filterChip, { backgroundColor: active ? colors.text : colors.card, borderColor: colors.border }]}
                                onPress={() => setFilter(s)}
                            >
                                <Text style={{ color: active ? colors.card : colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{s}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {!leads ? (
                    <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
                ) : leads.length === 0 ? (
                    <View style={styles.loading}>
                        <Ionicons name="mail-outline" size={42} color={colors.textMuted} />
                        <Text style={{ color: colors.textMuted, marginTop: 12 }}>No leads</Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                        {leads.map((lead: any) => (
                            <View key={lead._id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <View style={styles.cardHeader}>
                                    <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[lead.status] || '#6b7280' }]} />
                                    <Text style={[styles.cardStatus, { color: STATUS_COLORS[lead.status] || '#6b7280' }]}>{lead.status.toUpperCase()}</Text>
                                    <Text style={[styles.cardDate, { color: colors.textMuted }]}>
                                        {new Date(lead.createdAt).toLocaleString()}
                                    </Text>
                                </View>
                                <Text style={[styles.cardTitle, { color: colors.text }]}>{lead.package?.title || '—'}</Text>
                                <Text style={[styles.cardSub, { color: colors.textMuted }]}>{lead.partner?.name || '—'} · {lead.destination}</Text>
                                <View style={styles.row}>
                                    <Field color={colors.textMuted} label="Contact" value={lead.contactName} text={colors.text} />
                                    <Field color={colors.textMuted} label="Email" value={lead.contactEmail} text={colors.text} />
                                </View>
                                <View style={styles.row}>
                                    {lead.contactPhone ? <Field color={colors.textMuted} label="Phone" value={lead.contactPhone} text={colors.text} /> : null}
                                    <Field color={colors.textMuted} label="Travelers" value={String(lead.travelers)} text={colors.text} />
                                </View>
                                {lead.message ? (
                                    <View style={{ marginTop: 8, padding: 10, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : '#f9fafb', borderRadius: 8 }}>
                                        <Text style={{ color: colors.text, fontSize: 13 }}>{lead.message}</Text>
                                    </View>
                                ) : null}
                                {lead.sendError ? (
                                    <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>Error: {lead.sendError}</Text>
                                ) : null}

                                <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
                                    {(["contacted","converted","closed"] as const).map(next => (
                                        <TouchableOpacity
                                            key={next}
                                            style={[styles.actionBtn, { borderColor: colors.border }]}
                                            onPress={async () => {
                                                if (!token) return;
                                                try {
                                                    await updateStatus({ token, leadId: lead._id, status: next });
                                                } catch (e: any) {
                                                    Alert.alert("Error", e?.message || "Failed");
                                                }
                                            }}
                                        >
                                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{next}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                )}
            </SafeAreaView>
        </>
    );
}

function Field({ label, value, color, text }: any) {
    return (
        <View style={{ flex: 1, marginTop: 8 }}>
            <Text style={{ color, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: '700' }}>{label}</Text>
            <Text style={{ color: text, fontSize: 13, marginTop: 2 }} numberOfLines={1}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
    headerTitle: { fontSize: 17, fontWeight: '700' },
    iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    filters: { gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    cardStatus: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
    cardDate: { fontSize: 11, marginLeft: 'auto' },
    cardTitle: { fontSize: 15, fontWeight: '700', marginTop: 6 },
    cardSub: { fontSize: 12, marginTop: 2 },
    row: { flexDirection: 'row', gap: 12 },
    actionsRow: { flexDirection: 'row', gap: 8, borderTopWidth: 1, paddingTop: 10, marginTop: 12 },
    actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
