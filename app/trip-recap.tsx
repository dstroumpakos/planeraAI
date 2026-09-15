import React, { useEffect, useRef } from "react";
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
    ImageBackground, StatusBar, Platform, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTrackMarketing } from "@/lib/trackMarketing";
import ShareTripCard, { ShareTripCardHandle } from "@/components/ShareTripCard";

/**
 * Post-trip recap. Reached from the `trip_recap` push (2–4 days after a trip
 * ends), from the trip screen and from the "This month" card.
 *
 * Two jobs: a memory the user wants to share (acquisition) and a one-tap
 * route into leaving a tip for the next traveller (feeds Atlas and the
 * community achievements). Numbers come from retention.getTripRecap.
 */
export default function TripRecapScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const { colors, isDarkMode } = useTheme();
    const { token } = useToken();
    const trackMarketing = useTrackMarketing();
    const { tripId } = useLocalSearchParams<{ tripId: string }>();
    const shareRef = useRef<ShareTripCardHandle>(null);

    const recap = useQuery((api as any).retention.getTripRecap, token && tripId ? { token, tripId } : "skip");
    const trip = useQuery((api as any).trips.get, token && tripId ? { token, tripId } : "skip");
    const referralCode = useQuery((api as any).referrals.getMyReferralCode, token ? { token } : "skip");

    useEffect(() => {
        if (recap) trackMarketing("recap_view", "app-trip-recap");
    }, [!!recap]);

    const haptic = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

    if (recap === undefined || trip === undefined) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />
            </SafeAreaView>
        );
    }
    if (!recap || !trip) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.centered}>
                    <Text style={{ color: colors.textSecondary }}>{t("recap.notFound")}</Text>
                    <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
                        <Text style={{ color: colors.text, fontWeight: "700" }}>{t("common.back")}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const destination = String(recap.destination).split(",")[0];
    const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const km = recap.totalKm > 0 ? recap.totalKm : null;

    const Stat = ({ value, label }: { value: string; label: string }) => (
        <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );

    const inviteFriends = async () => {
        haptic();
        const code = referralCode || "";
        await Share.share({
            message: t("recap.inviteMessage", { dest: destination, code }),
        });
    };

    return (
        <>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                    <ImageBackground
                        source={recap.coverUrl ? { uri: recap.coverUrl } : undefined}
                        style={[styles.hero, { backgroundColor: "#1F2937" }]}
                    >
                        <View style={styles.heroScrim} />
                        <SafeAreaView edges={["top"]} style={styles.heroTop}>
                            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                                <Ionicons name="arrow-back" size={22} color="#FFF" />
                            </TouchableOpacity>
                        </SafeAreaView>
                        <View style={styles.heroBody}>
                            <Text style={styles.heroEyebrow}>{t("recap.eyebrow")}</Text>
                            <Text style={styles.heroTitle} numberOfLines={2}>{destination}</Text>
                            <Text style={styles.heroDates}>
                                {fmt(recap.startDate)} – {fmt(recap.endDate)} · {t("recap.days", { count: recap.dayCount })}
                            </Text>
                        </View>
                    </ImageBackground>

                    <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Stat value={String(recap.stops)} label={t("recap.stops")} />
                        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                        <Stat value={km ? `${km}` : "–"} label={km ? t("recap.km") : t("recap.kmPending")} />
                        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                        <Stat
                            value={recap.walkMinutes > 0 ? `${Math.round(recap.walkMinutes / 60 * 10) / 10}` : String(recap.countries.length || 1)}
                            label={recap.walkMinutes > 0 ? t("recap.hoursWalked") : t("recap.countries")}
                        />
                    </View>

                    {recap.highlights.length > 0 && (
                        <View style={styles.section}>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("recap.highlights")}</Text>
                            {recap.highlights.map((h: any, i: number) => (
                                <View key={`${h.day}-${i}`} style={styles.highlightRow}>
                                    <View style={[styles.dayBadge, { backgroundColor: colors.secondary }]}>
                                        <Text style={[styles.dayBadgeText, { color: colors.text }]}>{t("recap.dayShort", { day: h.day })}</Text>
                                    </View>
                                    <Text style={[styles.highlightTitle, { color: colors.text }]} numberOfLines={1}>{h.title}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={styles.section}>
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                            onPress={() => { haptic(); shareRef.current?.generateAndShare(); }}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="share-social" size={20} color="#1A1A1A" />
                            <Text style={styles.primaryBtnText}>{t("recap.shareCard")}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={() => {
                                haptic();
                                router.push({ pathname: "/settings/share-insight", params: { tripId: recap.tripId } } as any);
                            }}
                            activeOpacity={0.85}
                        >
                            <Ionicons name={recap.hasInsight ? "checkmark-circle" : "bulb"} size={20} color={colors.text} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.secondaryTitle, { color: colors.text }]}>
                                    {recap.hasInsight ? t("recap.tipDone") : t("recap.tipTitle")}
                                </Text>
                                <Text style={[styles.secondarySub, { color: colors.textSecondary }]}>
                                    {recap.hasInsight ? t("recap.tipDoneSub") : t("recap.tipSub", { dest: destination })}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={inviteFriends}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="people" size={20} color={colors.text} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.secondaryTitle, { color: colors.text }]}>{t("recap.inviteTitle")}</Text>
                                <Text style={[styles.secondarySub, { color: colors.textSecondary }]}>
                                    {referralCode ? t("recap.inviteSub", { code: referralCode }) : t("recap.inviteSubNoCode")}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push(`/trip/${recap.tripId}` as any)}>
                            <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t("recap.openTrip")}</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>

                {/* Off-screen renderer for the share pager (cover / poster / day slides). */}
                <ShareTripCard ref={shareRef} trip={trip as any} />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    hero: { minHeight: 300, justifyContent: "space-between" },
    heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,14,20,0.5)" },
    heroTop: { paddingHorizontal: 16, paddingTop: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
    heroBody: { padding: 20, paddingBottom: 24 },
    heroEyebrow: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
    heroTitle: { color: "#FFF", fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
    heroDates: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 6, fontWeight: "600" },
    statsRow: { flexDirection: "row", marginHorizontal: 20, marginTop: -22, borderRadius: 16, borderWidth: 1, paddingVertical: 14, alignItems: "center" },
    stat: { flex: 1, alignItems: "center" },
    statValue: { fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
    statLabel: { fontSize: 11.5, fontWeight: "600", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
    statDivider: { width: 1, height: 36 },
    section: { paddingHorizontal: 20, marginTop: 24, gap: 10 },
    sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
    highlightRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    dayBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, minWidth: 44, alignItems: "center" },
    dayBadgeText: { fontSize: 11, fontWeight: "700" },
    highlightTitle: { fontSize: 15, fontWeight: "500", flex: 1 },
    primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14 },
    primaryBtnText: { color: "#1A1A1A", fontSize: 16, fontWeight: "700" },
    secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
    secondaryTitle: { fontSize: 15, fontWeight: "700" },
    secondarySub: { fontSize: 12.5, marginTop: 1 },
    linkBtn: { alignItems: "center", paddingVertical: 10 },
    linkText: { fontSize: 14, fontWeight: "600" },
});
