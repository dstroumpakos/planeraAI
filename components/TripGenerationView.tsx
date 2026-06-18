import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import Animated, {
    FadeInDown,
    FadeIn,
    FadeOut,
    LinearTransition,
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    withSequence,
    withDelay,
    Easing,
} from "react-native-reanimated";

const BRAND = "#FFE500";

type AnyDay = any;

interface Props {
    trip: any;
    backgroundUrl?: string | null;
    onBack: () => void;
}

/** A single pulsing dot for the "planning…" affordance. */
function PulsingDot({ index }: { index: number }) {
    const o = useSharedValue(0.3);
    useEffect(() => {
        o.value = withDelay(
            index * 180,
            withRepeat(withSequence(withTiming(1, { duration: 450 }), withTiming(0.3, { duration: 450 })), -1),
        );
    }, []);
    const style = useAnimatedStyle(() => ({ opacity: o.value }));
    return <Animated.View style={[styles.dot, style]} />;
}

/** Brand-yellow shimmer sweep used on skeleton placeholders. */
function Shimmer({ height, width, radius = 8, style }: { height: number; width: any; radius?: number; style?: any }) {
    const x = useSharedValue(-1);
    useEffect(() => {
        x.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, false);
    }, []);
    const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 220 }] }));
    return (
        <View style={[{ height, width, borderRadius: radius, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }, style]}>
            <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
                <LinearGradient
                    colors={["transparent", "rgba(255,229,0,0.18)", "transparent"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </View>
    );
}

/** Skeleton card for a day that hasn't streamed in yet. */
function DaySkeleton({ dayNumber, isNext, label }: { dayNumber: number; isNext: boolean; label: string }) {
    return (
        <Animated.View entering={FadeIn.duration(250)} style={styles.card}>
            <View style={styles.cardHeaderRow}>
                <View style={styles.dayBadgeMuted}>
                    <Text style={styles.dayBadgeMutedText}>{dayNumber}</Text>
                </View>
                {isNext ? (
                    <View style={styles.planningRow}>
                        <Text style={styles.planningText}>{label}</Text>
                        <View style={styles.dotsRow}>
                            <PulsingDot index={0} />
                            <PulsingDot index={1} />
                            <PulsingDot index={2} />
                        </View>
                    </View>
                ) : (
                    <Shimmer height={14} width={140} />
                )}
            </View>
            <View style={{ height: 12 }} />
            <Shimmer height={12} width={"86%"} style={{ marginBottom: 10 }} />
            <Shimmer height={12} width={"70%"} style={{ marginBottom: 10 }} />
            <Shimmer height={12} width={"55%"} />
        </Animated.View>
    );
}

/** A real day that has streamed in — animates into place. */
function DayPreviewCard({ day }: { day: AnyDay }) {
    const activities: any[] = Array.isArray(day?.activities) ? day.activities : [];
    const shown = activities.slice(0, 4);
    const extra = activities.length - shown.length;
    return (
        <Animated.View
            entering={FadeInDown.duration(420).springify().damping(16)}
            layout={LinearTransition.springify().damping(18)}
            style={styles.card}
        >
            <View style={styles.cardHeaderRow}>
                <View style={styles.dayBadge}>
                    <Text style={styles.dayBadgeText}>{day?.day ?? "?"}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>
                    {day?.title || `Day ${day?.day ?? ""}`}
                </Text>
            </View>
            <View style={{ height: 10 }} />
            {shown.map((a, i) => (
                <Animated.View
                    key={i}
                    entering={FadeInDown.delay(i * 80).duration(320)}
                    style={styles.activityRow}
                >
                    <Text style={styles.activityTime}>{(a?.startTime || a?.time || "").toString().slice(0, 5)}</Text>
                    <View style={styles.activityDot} />
                    <Text style={styles.activityTitle} numberOfLines={1}>
                        {a?.title || ""}
                    </Text>
                </Animated.View>
            ))}
            {extra > 0 && <Text style={styles.moreText}>+{extra} more</Text>}
        </Animated.View>
    );
}

export default function TripGenerationView({ trip, backgroundUrl, onBack }: Props) {
    const { t } = useTranslation();

    const days: AnyDay[] = Array.isArray(trip?.itinerary?.dayByDayItinerary)
        ? trip.itinerary.dayByDayItinerary
        : [];
    const progress = trip?.generationProgress;
    const tripDays = Math.max(
        1,
        Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24)),
    );
    const totalDays = Math.max(progress?.totalDays || tripDays, days.length);
    const daysReady = days.length;
    const pct = Math.round((daysReady / totalDays) * 100);

    const hasStarted = daysReady > 0;

    // Animated progress bar fill.
    const fill = useSharedValue(0);
    useEffect(() => {
        fill.value = withTiming(daysReady / totalDays, { duration: 420, easing: Easing.out(Easing.cubic) });
    }, [daysReady, totalDays]);
    const fillStyle = useAnimatedStyle(() => ({ width: `${Math.min(fill.value * 100, 100)}%` }));

    const bannerText = hasStarted
        ? t("tripDetail.buildingDay", {
              destination: trip.destination,
              n: daysReady,
              total: totalDays,
              defaultValue: `Building your ${trip.destination} trip — Day ${daysReady} of ${totalDays}`,
          })
        : t("tripDetail.aiDesigning", { defaultValue: "Your AI is designing your trip" });

    return (
        <View style={styles.container}>
            {backgroundUrl ? (
                <Image
                    source={{ uri: backgroundUrl }}
                    style={styles.bg}
                    blurRadius={Platform.OS === "ios" ? 1 : 0.5}
                    cachePolicy="disk"
                    transition={500}
                />
            ) : (
                <View style={[styles.bg, { backgroundColor: "#161616" }]} />
            )}
            <LinearGradient
                colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0.78)", "rgba(0,0,0,0.92)"]}
                style={StyleSheet.absoluteFill}
            />

            <SafeAreaView style={styles.content}>
                <TouchableOpacity style={styles.backBtn} onPress={onBack}>
                    <Ionicons name="chevron-back" size={24} color="white" />
                </TouchableOpacity>

                {/* Header: route + meta */}
                <View style={styles.header}>
                    <View style={styles.routeRow}>
                        <Text style={styles.route} numberOfLines={1}>{trip.origin || t("tripDetail.unknown", { defaultValue: "" })}</Text>
                        <Ionicons name="arrow-forward" size={16} color={BRAND} style={{ marginHorizontal: 8 }} />
                        <Text style={styles.route} numberOfLines={1}>{trip.destination}</Text>
                    </View>

                    {/* Real progress banner */}
                    <Text style={styles.bannerText}>{bannerText}</Text>
                    <View style={styles.progressTrack}>
                        <Animated.View style={[styles.progressFill, fillStyle]} />
                    </View>
                    <View style={styles.bannerSubRow}>
                        <View style={styles.livePulse} />
                        <Text style={styles.bannerSub}>
                            {hasStarted
                                ? t("tripDetail.addingDetails", { defaultValue: "Crafting each day with local picks…" })
                                : t("tripDetail.usuallyTakes", { defaultValue: "This usually takes a moment." })}
                            {"  "}{pct}%
                        </Text>
                    </View>
                </View>

                {/* Day list: real days + skeletons */}
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listInner}
                    showsVerticalScrollIndicator={false}
                >
                    {days.map((day, i) => (
                        <DayPreviewCard key={`d-${i}`} day={day} />
                    ))}
                    {Array.from({ length: Math.max(0, totalDays - daysReady) }).map((_, i) => (
                        <DaySkeleton
                            key={`s-${i}`}
                            dayNumber={daysReady + i + 1}
                            isNext={i === 0}
                            label={t("tripDetail.planningDay", {
                                n: daysReady + i + 1,
                                defaultValue: `Planning Day ${daysReady + i + 1}`,
                            })}
                        />
                    ))}
                    <View style={{ height: 8 }} />
                </ScrollView>

                {/* Leave hint */}
                <TouchableOpacity style={styles.leaveHint} onPress={onBack} activeOpacity={0.7}>
                    <Ionicons name="notifications-outline" size={16} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.leaveHintText}>
                        {t("tripDetail.leaveScreenHint", { defaultValue: "You can leave — we'll notify you when it's ready!" })}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        </View>
    );
}

/**
 * Bottom pill shown on the completed trip while per-day enrichment is still
 * filling in (ratings, booking links). When enrichment finishes it flashes a
 * brief "ready" confirmation with a light haptic, then fades away. Restrained
 * by design — no confetti.
 */
export function EnrichingToast({ phase, destination }: { phase?: string; destination?: string }) {
    const { t } = useTranslation();
    const [state, setState] = useState<"hidden" | "enriching" | "ready">(
        phase === "enriching" ? "enriching" : "hidden",
    );
    const wasEnriching = useRef(phase === "enriching");

    useEffect(() => {
        if (phase === "enriching") {
            wasEnriching.current = true;
            setState("enriching");
        } else if (phase === "done") {
            if (wasEnriching.current) {
                // We watched it finish — celebrate briefly.
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                setState("ready");
                const tmr = setTimeout(() => setState("hidden"), 2400);
                return () => clearTimeout(tmr);
            }
            setState("hidden");
        }
    }, [phase]);

    if (state === "hidden") return null;

    const ready = state === "ready";
    return (
        <Animated.View
            entering={FadeInDown.duration(300)}
            exiting={FadeOut.duration(250)}
            style={toastStyles.wrap}
            pointerEvents="none"
        >
            <View style={[toastStyles.pill, ready && toastStyles.pillReady]}>
                {ready ? (
                    <Ionicons name="checkmark-circle" size={16} color="#000" />
                ) : (
                    <PulsingDot index={0} />
                )}
                <Text style={[toastStyles.text, ready && toastStyles.textReady]}>
                    {ready
                        ? t("tripDetail.tripReadyToast", {
                              destination: destination || "",
                              defaultValue: `Your ${destination || "trip"} is ready`,
                          })
                        : t("tripDetail.addingDetails", { defaultValue: "Adding local ratings & booking options…" })}
                </Text>
            </View>
        </Animated.View>
    );
}

const toastStyles = StyleSheet.create({
    wrap: { position: "absolute", left: 0, right: 0, bottom: 28, alignItems: "center", zIndex: 50 },
    pill: {
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: "rgba(20,20,20,0.92)", paddingHorizontal: 16, paddingVertical: 10,
        borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,229,0,0.35)",
    },
    pillReady: { backgroundColor: BRAND, borderColor: BRAND },
    text: { color: "#fff", fontSize: 13, fontWeight: "600" },
    textReady: { color: "#000", fontWeight: "800" },
});

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000" },
    bg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    content: { flex: 1, paddingHorizontal: 20 },
    backBtn: {
        width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.3)", marginTop: 4,
    },
    header: { marginTop: 8, marginBottom: 8 },
    routeRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
    route: { color: "#fff", fontSize: 20, fontWeight: "800", flexShrink: 1 },
    bannerText: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 10 },
    progressTrack: {
        height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden",
    },
    progressFill: { height: "100%", borderRadius: 3, backgroundColor: BRAND },
    bannerSubRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
    livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: BRAND, marginRight: 8 },
    bannerSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600" },

    list: { flex: 1, marginTop: 6 },
    listInner: { paddingBottom: 8 },

    card: {
        backgroundColor: "rgba(255,255,255,0.08)",
        borderColor: "rgba(255,255,255,0.14)",
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
    },
    cardHeaderRow: { flexDirection: "row", alignItems: "center" },
    dayBadge: {
        width: 30, height: 30, borderRadius: 9, backgroundColor: BRAND,
        alignItems: "center", justifyContent: "center", marginRight: 12,
    },
    dayBadgeText: { color: "#000", fontWeight: "800", fontSize: 14 },
    dayBadgeMuted: {
        width: 30, height: 30, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.12)",
        alignItems: "center", justifyContent: "center", marginRight: 12,
    },
    dayBadgeMutedText: { color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 14 },
    cardTitle: { color: "#fff", fontSize: 15, fontWeight: "700", flexShrink: 1 },

    activityRow: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
    activityTime: { color: BRAND, fontSize: 12, fontWeight: "700", width: 44 },
    activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.4)", marginRight: 10 },
    activityTitle: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "500", flexShrink: 1 },
    moreText: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "600", marginTop: 2, marginLeft: 54 },

    planningRow: { flexDirection: "row", alignItems: "center", flex: 1 },
    planningText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
    dotsRow: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: BRAND, marginHorizontal: 2 },

    leaveHint: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        paddingVertical: 12, gap: 8,
    },
    leaveHintText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
});
