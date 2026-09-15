import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTripWeather, forecastForDay, weatherGlyph } from "@/lib/weather";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Picks the trip the home tab should switch into "Today" mode for: one that
 * is in progress right now, else one starting within the next 7 days (the
 * countdown window). Returns null when the default home is right.
 */
export function pickLiveTrip(trips: any[] | undefined | null): { trip: any; mode: "live" | "soon"; dayIndex: number; daysUntil: number } | null {
    if (!trips || trips.length === 0) return null;
    const now = Date.now();
    let live: any = null;
    let soon: any = null;
    for (const t of trips) {
        if (t.status !== "completed" || typeof t.startDate !== "number" || typeof t.endDate !== "number") continue;
        if (now >= t.startDate && now <= t.endDate + DAY_MS) {
            if (!live || t.startDate > live.startDate) live = t;
        } else if (t.startDate > now && t.startDate - now <= 7 * DAY_MS) {
            if (!soon || t.startDate < soon.startDate) soon = t;
        }
    }
    if (live) {
        return { trip: live, mode: "live", dayIndex: Math.floor((now - live.startDate) / DAY_MS), daysUntil: 0 };
    }
    if (soon) {
        return { trip: soon, mode: "soon", dayIndex: -1, daysUntil: Math.ceil((soon.startDate - now) / DAY_MS) };
    }
    return null;
}

/**
 * The home-tab hero while a trip is live (or about to start). The morning
 * briefing push already lands on the trip; this makes the screen the user
 * opens at breakfast show the day, not "Where to go?".
 */
export default function TodayCard({ live }: { live: NonNullable<ReturnType<typeof pickLiveTrip>> }) {
    const router = useRouter();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const { token } = useToken();
    const { trip, mode, dayIndex, daysUntil } = live;

    const reservations = useQuery(
        (api as any).reservations.listForTrip,
        token ? { token, tripId: trip._id } : "skip",
    );

    const days: any[] = trip.itinerary?.dayByDayItinerary || [];
    const totalDays = Math.max(days.length, Math.round((trip.endDate - trip.startDate) / DAY_MS) + 1);
    const today = mode === "live" ? days[Math.min(dayIndex, days.length - 1)] : days[0];
    const activities: any[] = today?.activities || [];

    // Next stop: the first activity whose start time is still ahead of the
    // local clock; falls back to the first stop of the day.
    const next = useMemo(() => {
        if (mode !== "live") return activities[0] || null;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        for (const a of activities) {
            const m = /^(\d{1,2}):(\d{2})/.exec(String(a.startTime || a.time || ""));
            if (!m) continue;
            if (parseInt(m[1], 10) * 60 + parseInt(m[2], 10) >= nowMin - 30) return a;
        }
        return activities[activities.length - 1] || null;
    }, [activities, mode]);

    const todaysReservations = useMemo(() => {
        const items: any[] = reservations?.items || [];
        if (mode !== "live") return items.slice(0, 2);
        const dayStart = new Date(trip.startDate + dayIndex * DAY_MS);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = dayStart.getTime() + DAY_MS;
        return items.filter((r) => typeof r.startAt === "number" && r.startAt >= dayStart.getTime() && r.startAt < dayEnd).slice(0, 2);
    }, [reservations, mode, trip.startDate, dayIndex]);

    // Weather for the day shown (today when live, the first day when soon).
    const forecast = useTripWeather(trip);
    const dayTs = mode === "live" ? Date.now() : trip.startDate;
    const weather = forecastForDay(forecast, dayTs);

    const cover = trip.shareCardPhoto?.url || trip.destinationImage?.url || null;
    const destination = String(trip.destination || "").split(",")[0];

    const fmtTime = (ts: number) => {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    const body = (
        <View style={styles.inner}>
            <View style={styles.topRow}>
                <View style={[styles.pill, { backgroundColor: mode === "live" ? colors.primary : "rgba(255,255,255,0.18)" }]}>
                    <Ionicons name={mode === "live" ? "location" : "airplane"} size={12} color={mode === "live" ? "#1A1A1A" : "#FFF"} />
                    <Text style={[styles.pillText, { color: mode === "live" ? "#1A1A1A" : "#FFF" }]}>
                        {mode === "live"
                            ? t("today.dayOf", { day: dayIndex + 1, total: totalDays })
                            : t("today.inDays", { count: daysUntil })}
                    </Text>
                </View>
                <View style={styles.topRight}>
                    {weather && (
                        <View style={styles.weatherChip}>
                            <Ionicons name={weatherGlyph(weather.code).icon as any} size={14} color="#FFF" />
                            <Text style={styles.weatherText}>
                                {Math.round(weather.tMax)}°
                                <Text style={styles.weatherMin}> / {Math.round(weather.tMin)}°</Text>
                            </Text>
                            {typeof weather.precipProb === "number" && weather.precipProb >= 40 && (
                                <Text style={styles.weatherMin}> · {Math.round(weather.precipProb)}% ☔</Text>
                            )}
                        </View>
                    )}
                    <TouchableOpacity onPress={() => router.push({ pathname: "/trip/map", params: { id: trip._id } } as any)} hitSlop={8}>
                        <Ionicons name="map-outline" size={20} color="#FFF" />
                    </TouchableOpacity>
                </View>
            </View>

            <Text style={styles.dest} numberOfLines={1}>{destination}</Text>

            {next ? (
                <View style={styles.nextRow}>
                    <Text style={styles.nextLabel}>{mode === "live" ? t("today.nextStop") : t("today.firstStop")}</Text>
                    <Text style={styles.nextTitle} numberOfLines={1}>{next.title}</Text>
                    <Text style={styles.nextMeta} numberOfLines={1}>
                        {[next.startTime || next.time, next.address || next.location].filter(Boolean).join(" · ")}
                    </Text>
                </View>
            ) : (
                <Text style={styles.nextTitle}>{t("today.freeDay")}</Text>
            )}

            {todaysReservations.length > 0 && (
                <View style={styles.resRow}>
                    {todaysReservations.map((r: any) => (
                        <View key={r._id} style={styles.resChip}>
                            <Ionicons name={r.type === "flight" ? "airplane" : r.type === "hotel" ? "bed" : "ticket"} size={12} color="#FFF" />
                            <Text style={styles.resText} numberOfLines={1}>
                                {typeof r.startAt === "number" ? `${fmtTime(r.startAt)} ` : ""}{r.title}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.footer}>
                <Text style={styles.footerMeta}>
                    {mode === "live"
                        ? t("today.stopsToday", { count: activities.length })
                        : t("today.daysPlanned", { count: totalDays })}
                </Text>
                <View style={[styles.cta, { backgroundColor: colors.primary }]}>
                    <Text style={styles.ctaText}>{mode === "live" ? t("today.openDay") : t("today.openTrip")}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#1A1A1A" />
                </View>
            </View>
        </View>
    );

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            style={styles.container}
            onPress={() => router.push(`/trip/${trip._id}` as any)}
        >
            {cover ? (
                <ImageBackground source={{ uri: cover }} style={styles.bg} imageStyle={styles.bgImage}>
                    <View style={styles.scrim} />
                    {body}
                </ImageBackground>
            ) : (
                <View style={[styles.bg, { backgroundColor: "#1F2937" }]}>{body}</View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { marginHorizontal: 20, marginBottom: 20, borderRadius: 20, overflow: "hidden" },
    bg: { minHeight: 210, justifyContent: "flex-end" },
    bgImage: { borderRadius: 20 },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,14,20,0.55)" },
    inner: { padding: 18, gap: 10 },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
    pillText: { fontSize: 12, fontWeight: "700" },
    topRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    weatherChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.16)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
    weatherText: { color: "#FFF", fontSize: 12.5, fontWeight: "700" },
    weatherMin: { color: "rgba(255,255,255,0.75)", fontSize: 11.5, fontWeight: "600" },
    dest: { color: "#FFF", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
    nextRow: { gap: 2 },
    nextLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    nextTitle: { color: "#FFF", fontSize: 16, fontWeight: "700" },
    nextMeta: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
    resRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    resChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.16)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, maxWidth: "100%" },
    resText: { color: "#FFF", fontSize: 12, fontWeight: "600", flexShrink: 1 },
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
    footerMeta: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "600" },
    cta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
    ctaText: { color: "#1A1A1A", fontSize: 13, fontWeight: "700" },
});
