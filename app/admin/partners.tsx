/**
 * Admin: Partner API management.
 *
 * In-app surface (mirrors the planeraai-web /partner-admin dashboard) for
 * managing Planera Partner API keys. Gated by the app's own admin system via
 * `admin.isAdmin`. Backed by `partnerAdminApp.*` Convex functions which use the
 * caller's session token + checkIsAdmin (no separate admin token needed here).
 */
import React, { useState } from "react";
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
    StatusBar, Alert, TextInput, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useAction } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

export default function AdminPartnersScreen() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();

    const isAdmin = useQuery((api as any).admin.isAdmin, token ? { token } : "skip");
    const summary = useQuery((api as any).partnerAdminApp.getSummary, token ? { token } : "skip");
    const keys = useQuery((api as any).partnerAdminApp.listKeys, token ? { token } : "skip");
    const pregen = useQuery((api as any).partnerAdminApp.getPregenStatus, token ? { token } : "skip");

    const createKey = useMutation((api as any).partnerAdminApp.createKey);
    const revokeKey = useMutation((api as any).partnerAdminApp.revokeKey);
    const reactivateKey = useMutation((api as any).partnerAdminApp.reactivateKey);
    const triggerPregen = useAction((api as any).partnerAdminApp.triggerPregeneration);

    const [showCreate, setShowCreate] = useState(false);
    const [partnerName, setPartnerName] = useState("");
    const [partnerRef, setPartnerRef] = useState("");
    const [rateLimit, setRateLimit] = useState("60");
    const [dailyCap, setDailyCap] = useState("500");
    const [monthlyCap, setMonthlyCap] = useState("5000");
    const [busy, setBusy] = useState(false);

    if (isAdmin === false) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.center}>
                    <Ionicons name="lock-closed" size={56} color={colors.textMuted} />
                    <Text style={[styles.deniedTitle, { color: colors.text }]}>Access Denied</Text>
                    <Text style={{ color: colors.textMuted, marginTop: 6 }}>You don't have admin privileges.</Text>
                    <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 20 }]} onPress={() => router.back()}>
                        <Text style={styles.primaryBtnText}>Go Back</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    async function copy(label: string, value: string) {
        await Clipboard.setStringAsync(value);
        Alert.alert("Copied", `${label} copied to clipboard.`);
    }

    async function handleCreate() {
        if (!token || !partnerName.trim() || !partnerRef.trim()) {
            Alert.alert("Missing fields", "Partner name and ref are required.");
            return;
        }
        setBusy(true);
        try {
            const res = await createKey({
                token,
                partnerName: partnerName.trim(),
                partnerRef: partnerRef.trim(),
                rateLimitPerMin: Number(rateLimit) || undefined,
                dailyCap: Number(dailyCap) || undefined,
                monthlyCap: Number(monthlyCap) || undefined,
            });
            setPartnerName(""); setPartnerRef("");
            setShowCreate(false);
            // Secrets are shown ONCE.
            Alert.alert(
                "Key created — copy now",
                `These secrets are shown only once.\n\nAPI key:\n${res.apiKey}\n\nWebhook secret:\n${res.webhookSecret}`,
                [
                    { text: "Copy API key", onPress: () => copy("API key", res.apiKey) },
                    { text: "Copy webhook secret", onPress: () => copy("Webhook secret", res.webhookSecret) },
                    { text: "Done", style: "cancel" },
                ],
            );
        } catch (e: any) {
            Alert.alert("Error", e?.message || "Failed to create key.");
        } finally {
            setBusy(false);
        }
    }

    function confirmRevoke(keyId: string, name: string) {
        Alert.alert("Revoke key?", `Disable API access for ${name}. You can reactivate later.`, [
            { text: "Cancel", style: "cancel" },
            {
                text: "Revoke", style: "destructive", onPress: async () => {
                    if (!token) return;
                    try { await revokeKey({ token, keyId }); }
                    catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
                },
            },
        ]);
    }

    async function handleReactivate(keyId: string) {
        if (!token) return;
        try { await reactivateKey({ token, keyId }); }
        catch (e: any) { Alert.alert("Error", e?.message || "Failed"); }
    }

    function confirmPregen() {
        Alert.alert("Run pre-generation?", "Pre-build itineraries for top destinations so partner requests are served instantly.", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Run", onPress: async () => {
                    if (!token) return;
                    setBusy(true);
                    try {
                        const res = await triggerPregen({ token });
                        Alert.alert("Scheduled", `Pre-generation scheduled for ${res.scheduled} cities.`);
                    } catch (e: any) {
                        Alert.alert("Error", e?.message || "Failed");
                    } finally { setBusy(false); }
                },
            },
        ]);
    }

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Partner API</Text>
                    <TouchableOpacity onPress={() => setShowCreate(s => !s)} style={styles.iconBtn}>
                        <Ionicons name={showCreate ? "close" : "add"} size={26} color={colors.text} />
                    </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
                    {/* Summary */}
                    <View style={styles.statsRow}>
                        <Stat colors={colors} value={summary?.activeKeys ?? "—"} label="Active keys" />
                        <Stat colors={colors} value={summary?.totalKeys ?? "—"} label="Total keys" />
                        <Stat colors={colors} value={summary?.generationsToday ?? "—"} label="Today" />
                        <Stat colors={colors} value={summary?.generationsThisMonth ?? "—"} label="This month" />
                    </View>

                    {/* Pre-generation */}
                    <TouchableOpacity
                        style={[styles.pregenBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={confirmPregen}
                        disabled={busy}
                    >
                        <Ionicons name="flash" size={18} color={colors.primary === "#FFE500" ? "#B59A00" : colors.primary} />
                        <Text style={[styles.pregenText, { color: colors.text }]}>Run pre-generation of top destinations</Text>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </TouchableOpacity>

                    {/* Pre-generation status */}
                    <PregenStatus pregen={pregen} colors={colors} isDarkMode={isDarkMode} />

                    {/* Create form */}
                    {showCreate && (
                        <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Text style={[styles.formTitle, { color: colors.text }]}>Create partner key</Text>
                            <LabeledInput colors={colors} isDarkMode={isDarkMode} label="Partner name" placeholder="spytrip.gr" value={partnerName} onChangeText={setPartnerName} />
                            <LabeledInput colors={colors} isDarkMode={isDarkMode} label="Partner ref (slug)" placeholder="spytrip" value={partnerRef} onChangeText={setPartnerRef} autoCapitalize="none" />
                            <View style={styles.row3}>
                                <LabeledInput colors={colors} isDarkMode={isDarkMode} flex label="Rate/min" value={rateLimit} onChangeText={setRateLimit} keyboardType="numeric" />
                                <LabeledInput colors={colors} isDarkMode={isDarkMode} flex label="Daily" value={dailyCap} onChangeText={setDailyCap} keyboardType="numeric" />
                                <LabeledInput colors={colors} isDarkMode={isDarkMode} flex label="Monthly" value={monthlyCap} onChangeText={setMonthlyCap} keyboardType="numeric" />
                            </View>
                            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={handleCreate} disabled={busy}>
                                {busy ? <ActivityIndicator color="#1A1A1A" /> : <Text style={styles.primaryBtnText}>Create key</Text>}
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Keys list */}
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Partner keys</Text>
                    {keys === undefined ? (
                        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
                    ) : keys.length === 0 ? (
                        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Ionicons name="key-outline" size={36} color={colors.textMuted} />
                            <Text style={{ color: colors.textMuted, marginTop: 10 }}>No partner keys yet.</Text>
                        </View>
                    ) : (
                        keys.map((k: any) => (
                            <KeyCard
                                key={k.keyId}
                                k={k}
                                token={token!}
                                colors={colors}
                                isDarkMode={isDarkMode}
                                onRevoke={() => confirmRevoke(k.keyId, k.partnerName)}
                                onReactivate={() => handleReactivate(k.keyId)}
                            />
                        ))
                    )}
                </ScrollView>
            </SafeAreaView>
        </>
    );
}

function Stat({ colors, value, label }: any) {
    return (
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
        </View>
    );
}

// Status colors used across the pre-gen breakdown.
const PG_COLORS: Record<string, string> = {
    ready: "#059669",
    generating: "#D97706",
    queued: "#6366F1",
    failed: "#DC2626",
    missing: "#9B9B9B",
};

function timeAgo(ts: number | null): string {
    if (!ts) return "never";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function PregenStatus({ pregen, colors, isDarkMode }: any) {
    const [open, setOpen] = useState(false);

    if (pregen === undefined) {
        return (
            <View style={[styles.pregenCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator color={colors.primary} />
            </View>
        );
    }

    const pct = pregen.expectedTotal > 0
        ? Math.round((pregen.readyTotal / pregen.expectedTotal) * 100)
        : 0;
    const missing = pregen.expectedTotal - pregen.readyTotal - pregen.inProgressTotal - pregen.failedTotal;

    return (
        <View style={[styles.pregenCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.pgHeaderRow}>
                <Text style={[styles.pgTitle, { color: colors.text }]}>Pre-generation status</Text>
                <Text style={[styles.pgPct, { color: PG_COLORS.ready }]}>{pct}%</Text>
            </View>
            <Text style={[styles.pgSub, { color: colors.textMuted }]}>
                {pregen.readyTotal} of {pregen.expectedTotal} itineraries ready · {pregen.completeCities}/{pregen.totalCities} cities complete
            </Text>

            <View style={[styles.pgBarTrack, { backgroundColor: isDarkMode ? '#2C2C2C' : '#E8E6E1' }]}>
                <View style={[styles.pgBarFill, { width: `${pct}%`, backgroundColor: PG_COLORS.ready }]} />
            </View>

            <View style={styles.pgCounters}>
                <PgCounter color={PG_COLORS.ready} label="Ready" value={pregen.readyTotal} />
                <PgCounter color={PG_COLORS.generating} label="In progress" value={pregen.inProgressTotal} />
                <PgCounter color={PG_COLORS.failed} label="Failed" value={pregen.failedTotal} />
                <PgCounter color={colors.textMuted} label="Missing" value={missing} />
            </View>

            <Text style={[styles.pgUpdated, { color: colors.textMuted }]}>
                Last generated: {timeAgo(pregen.lastReadyAt)}
            </Text>

            <View style={styles.pgLegend}>
                {(["ready", "generating", "queued", "failed", "missing"] as const).map((s) => (
                    <View key={s} style={styles.pgLegendItem}>
                        <View style={[styles.pgDot, { backgroundColor: PG_COLORS[s] }]} />
                        <Text style={[styles.pgLegendText, { color: colors.textMuted }]}>{s}</Text>
                    </View>
                ))}
            </View>

            {pregen.failures.length > 0 && (
                <View style={[styles.pgFailBox, { borderColor: 'rgba(220,38,38,0.4)', backgroundColor: isDarkMode ? 'rgba(220,38,38,0.08)' : '#FEF2F2' }]}>
                    <Text style={{ color: PG_COLORS.failed, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                        {pregen.failures.length} failed — run pre-generation again to retry
                    </Text>
                    {pregen.failures.slice(0, 6).map((f: any, i: number) => (
                        <Text key={i} style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                            {f.destination} · {f.days}d{f.error ? ` — ${String(f.error).slice(0, 60)}` : ""}
                        </Text>
                    ))}
                </View>
            )}

            {pregen.requested?.length > 0 && (
                <View style={[styles.pgReqBox, { borderColor: colors.border, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : '#FAFAF8' }]}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 2 }}>
                        Requested — not pre-generated yet ({pregen.requested.length})
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 6 }}>
                        Cities partners asked for that aren't pre-built. The next pre-generation run will cover them.
                    </Text>
                    {pregen.requested.slice(0, 12).map((r: any, i: number) => (
                        <View key={i} style={styles.pgReqRow}>
                            <Text style={[styles.pgReqCity, { color: colors.text }]} numberOfLines={1}>{r.destination}</Text>
                            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                                {r.days.join(", ")}d · {r.count}×
                            </Text>
                        </View>
                    ))}
                    {pregen.requested.length > 12 && (
                        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                            +{pregen.requested.length - 12} more
                        </Text>
                    )}
                </View>
            )}
            <TouchableOpacity style={styles.pgToggle} onPress={() => setOpen((o) => !o)}>
                <Text style={{ color: colors.primary === "#FFE500" ? "#B59A00" : colors.primary, fontWeight: '700', fontSize: 13 }}>
                    {open ? "Hide per-city breakdown" : "Show per-city breakdown"}
                </Text>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.primary === "#FFE500" ? "#B59A00" : colors.primary} />
            </TouchableOpacity>

            {open && (
                <View style={{ marginTop: 8 }}>
                    {pregen.cities.map((c: any) => (
                        <View key={c.destination} style={[styles.pgCityRow, { borderTopColor: colors.border }]}>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={[styles.pgCityName, { color: colors.text }]} numberOfLines={1}>{c.destination}</Text>
                                <Text style={{ color: colors.textMuted, fontSize: 11 }}>{c.readyCount}/{c.total} ready</Text>
                            </View>
                            <View style={styles.pgChips}>
                                {c.durations.map((d: any) => (
                                    <View key={d.days} style={[styles.pgChip, { backgroundColor: PG_COLORS[d.status] }]}>
                                        <Text style={styles.pgChipText}>{d.days}d</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ))}
                    {pregen.extraDestinations.length > 0 && (
                        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 10 }}>
                            Also pre-generated (custom): {pregen.extraDestinations.join(", ")}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}

function PgCounter({ color, label, value }: any) {
    return (
        <View style={styles.pgCounter}>
            <Text style={[styles.pgCounterValue, { color }]}>{value}</Text>
            <Text style={styles.pgCounterLabel}>{label}</Text>
        </View>
    );
}

function LabeledInput({ colors, isDarkMode, label, flex, ...props }: any) {
    return (
        <View style={[{ marginTop: 10 }, flex && { flex: 1 }]}>
            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>{label}</Text>
            <TextInput
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                {...props}
            />
        </View>
    );
}

function KeyCard({ k, token, colors, isDarkMode, onRevoke, onReactivate }: any) {
    const [open, setOpen] = useState(false);
    const usage = useQuery(
        (api as any).partnerAdminApp.getUsage,
        open && token ? { token, keyId: k.keyId } : "skip",
    );
    return (
        <View style={[styles.keyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.keyHeader}>
                <View style={{ flex: 1 }}>
                    <View style={styles.keyTitleRow}>
                        <Text style={[styles.keyName, { color: colors.text }]}>{k.partnerName}</Text>
                        <View style={[styles.badge, { backgroundColor: k.active ? (isDarkMode ? 'rgba(16,185,129,0.2)' : '#D1FAE5') : (isDarkMode ? 'rgba(239,68,68,0.2)' : '#FEE2E2') }]}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: k.active ? '#059669' : '#DC2626' }}>{k.active ? 'ACTIVE' : 'REVOKED'}</Text>
                        </View>
                    </View>
                    <Text style={[styles.keyMeta, { color: colors.textMuted }]}>ref: {k.partnerRef} · {k.keyPrefix}…</Text>
                    <Text style={[styles.keyMeta, { color: colors.textMuted }]}>{k.rateLimitPerMin}/min · {k.dailyCap}/day · {k.monthlyCap}/month</Text>
                </View>
            </View>
            <View style={[styles.keyActions, { borderTopColor: colors.border }]}>
                <TouchableOpacity style={[styles.smallBtn, { borderColor: colors.border }]} onPress={() => setOpen(o => !o)}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{open ? 'Hide' : 'Usage'}</Text>
                </TouchableOpacity>
                {k.active ? (
                    <TouchableOpacity style={[styles.smallBtn, { borderColor: '#DC2626' }]} onPress={onRevoke}>
                        <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>Revoke</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={[styles.smallBtn, { borderColor: '#059669' }]} onPress={onReactivate}>
                        <Text style={{ color: '#059669', fontSize: 12, fontWeight: '600' }}>Reactivate</Text>
                    </TouchableOpacity>
                )}
            </View>
            {open && (
                <View style={[styles.usageBox, { borderTopColor: colors.border }]}>
                    {usage === undefined ? (
                        <ActivityIndicator color={colors.primary} />
                    ) : (
                        <>
                            <Text style={[styles.keyMeta, { color: colors.textMuted }]}>
                                Generations — today: {usage.generationsToday} · month: {usage.generationsThisMonth}
                            </Text>
                            {usage.recent.length === 0 ? (
                                <Text style={[styles.keyMeta, { color: colors.textMuted, marginTop: 6 }]}>No recent itineraries.</Text>
                            ) : (
                                usage.recent.map((r: any) => (
                                    <Text key={r.itineraryId} style={[styles.keyMeta, { color: colors.textMuted, marginTop: 4 }]}>
                                        {r.destination} · {r.days}d · {r.status}{r.source ? ` · ${r.source}` : ""}
                                    </Text>
                                ))
                            )}
                        </>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    deniedTitle: { fontSize: 20, fontWeight: '700', marginTop: 14 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1,
        ...(Platform.OS === 'android' ? { paddingTop: 12 } : {}),
    },
    iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    statsRow: { flexDirection: 'row', gap: 10 },
    statCard: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    statValue: { fontSize: 20, fontWeight: '800' },
    statLabel: { fontSize: 11, marginTop: 2, textAlign: 'center' },
    pregenBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1,
        borderRadius: 14, padding: 14, marginTop: 14,
    },
    pregenText: { flex: 1, fontSize: 14, fontWeight: '600' },
    pregenCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 12 },
    pgHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pgTitle: { fontSize: 15, fontWeight: '700' },
    pgPct: { fontSize: 18, fontWeight: '800' },
    pgSub: { fontSize: 12, marginTop: 4 },
    pgBarTrack: { height: 8, borderRadius: 999, marginTop: 10, overflow: 'hidden' },
    pgBarFill: { height: 8, borderRadius: 999 },
    pgCounters: { flexDirection: 'row', gap: 8, marginTop: 14 },
    pgCounter: { flex: 1, alignItems: 'center' },
    pgCounterValue: { fontSize: 18, fontWeight: '800' },
    pgCounterLabel: { fontSize: 10, marginTop: 2, color: '#9B9B9B' },
    pgUpdated: { fontSize: 11, marginTop: 12 },
    pgLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
    pgLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    pgDot: { width: 9, height: 9, borderRadius: 999 },
    pgLegendText: { fontSize: 11, textTransform: 'capitalize' },
    pgFailBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 12 },
    pgReqBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 12 },
    pgReqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3, gap: 8 },
    pgReqCity: { flex: 1, fontSize: 12, fontWeight: '600' },
    pgToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
    pgCityRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 9 },
    pgCityName: { fontSize: 13, fontWeight: '600' },
    pgChips: { flexDirection: 'row', gap: 5 },
    pgChip: { width: 28, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    pgChipText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    formCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16 },
    formTitle: { fontSize: 15, fontWeight: '700' },
    row3: { flexDirection: 'row', gap: 10 },
    inputLabel: { fontSize: 12, marginBottom: 4 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    primaryBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    primaryBtnText: { color: '#1A1A1A', fontWeight: '700', fontSize: 15 },
    sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 24, marginBottom: 12 },
    emptyCard: { borderWidth: 1, borderRadius: 16, padding: 28, alignItems: 'center' },
    keyCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
    keyHeader: { flexDirection: 'row' },
    keyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    keyName: { fontSize: 15, fontWeight: '700' },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    keyMeta: { fontSize: 12, marginTop: 3 },
    keyActions: { flexDirection: 'row', gap: 10, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
    smallBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
    usageBox: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
});
