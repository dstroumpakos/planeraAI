import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { api } from "@/convex/_generated/api";
import { useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import { formatFare } from "@/lib/currency";
import { dealTripParams } from "@/lib/dealNav";
import {
    CHRISTMAS_DESTINATIONS,
    CHRISTMAS_TRIP_NIGHTS,
    CHRISTMAS_VIBE_EMOJI,
    ChristmasVibe,
    christmasSeason,
    isChristmasPromoActive,
    isChristmasTrip,
    isWorthBuying,
    percentBelowTypical,
} from "@/lib/christmas";
import { CHRISTMAS_PHOTOS } from "@/lib/christmasPhotos";
import type { ExploreDestination } from "@/types/flights";

type Card = {
    key: string;
    city: string;
    country?: string;
    vibe: ChristmasVibe;
    /** Best worth-buying Christmas deal to this city, if the radar has one. */
    deal?: any;
    pct: number | null;
    /** Indicative December fare from the Explore grid (not bookable). */
    fare?: ExploreDestination;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENCY = "EUR";
/** One cached Explore call per origin prices the whole row. */
const EXPLORE_PERIOD = "one_week_trip_in_december";

const VIBE_GRADIENT: Record<ChristmasVibe, [string, string]> = {
    markets: ["#C62828", "#7F1D1D"],
    snow: ["#1D4ED8", "#0C4A6E"],
    city: ["#4C1D95", "#1E1B4B"],
    sun: ["#EA580C", "#B45309"],
};

const GOLD = "#FCD34D";

/** "Kraków" / "krakow" / "New York, NY" → "krakow" / "new york". */
const norm = (s?: string) =>
    (s || "")
        .split(",")[0]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

function daysToChristmas(now = new Date()): number {
    const y = now.getMonth() === 11 && now.getDate() > 25 ? now.getFullYear() + 1 : now.getFullYear();
    const xmas = new Date(y, 11, 25);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((xmas.getTime() - today.getTime()) / DAY_MS));
}

/**
 * "Christmas trips" — seasonal home row (mid-Sep → Boxing Day).
 *
 * A festive banner of holiday destinations. Pricing comes from two sources:
 *  1. The radar's Christmas-dated fares that are actually worth buying (below
 *     the route's typical price, or Google-graded low) — straight from
 *     `getDealsForUser`, shown first with their "−N%".
 *  2. One `explore.exploreDestinations` call from the home airport for a
 *     December week (12h server cache per origin) — indicative round-trip
 *     fares + dates for every festive city Google has priced.
 * Cities with neither still show, and open the trip builder on Christmas dates.
 */
export default function ChristmasRow({ deals, homeIata }: { deals: any[]; homeIata?: string | null }) {
    const router = useRouter();
    const { t } = useTranslation();
    const explore = useAuthenticatedAction(api.explore.exploreDestinations);
    const [fares, setFares] = useState<ExploreDestination[]>([]);
    const active = isChristmasPromoActive();

    useEffect(() => {
        if (!active || !homeIata) return;
        let cancelled = false;
        // `hl: "en"` so names match our English city list (and every language
        // shares one cache entry).
        explore({ input: { departureId: homeIata, currency: CURRENCY, hl: "en", timePeriod: EXPLORE_PERIOD } })
            .then((r) => !cancelled && setFares(Array.isArray(r) ? (r as ExploreDestination[]) : []))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [active, homeIata, explore]);

    const cards = useMemo<Card[]>(() => {
        // Cheapest worth-buying Christmas deal per destination city.
        const best = new Map<string, any>();
        for (const d of deals || []) {
            if (!isChristmasTrip(d.outboundDate, d.returnDate) || !isWorthBuying(d)) continue;
            const k = norm(d.destinationCity);
            if (!k) continue;
            const cur = best.get(k);
            if (!cur || d.price < cur.price) best.set(k, d);
        }

        // Cheapest indicative fare per name and per airport code.
        const byName = new Map<string, ExploreDestination>();
        const byIata = new Map<string, ExploreDestination>();
        for (const f of fares) {
            if (!f.price || f.price <= 0) continue;
            const n = norm(f.name);
            if (n && (!byName.has(n) || f.price < byName.get(n)!.price!)) byName.set(n, f);
            const c = (f.iata || "").toUpperCase();
            if (c && (!byIata.has(c) || f.price < byIata.get(c)!.price!)) byIata.set(c, f);
        }

        const out: Card[] = CHRISTMAS_DESTINATIONS.filter((x) => !homeIata || x.code !== homeIata).map((x) => {
            const k = norm(x.city);
            const deal = best.get(k);
            best.delete(k);
            const fare = deal ? undefined : byName.get(k) || byIata.get(x.code);
            return { key: x.code, city: x.city, country: x.country, vibe: x.vibe, deal, fare, pct: deal ? percentBelowTypical(deal) : null };
        });
        // A great Christmas fare to somewhere off the festive list is still a
        // Christmas deal worth showing.
        for (const [k, deal] of best) {
            out.push({ key: `deal-${k}`, city: deal.destinationCity, vibe: "city", deal, pct: percentBelowTypical(deal) });
        }

        // Radar deals (biggest saving, then cheapest) → priced fares (cheapest)
        // → the rest in list order.
        const rank = (c: Card) => (c.deal ? 0 : c.fare ? 1 : 2);
        return out
            .map((c, i) => ({ c, i }))
            .sort((a, b) => {
                if (rank(a.c) !== rank(b.c)) return rank(a.c) - rank(b.c);
                if (a.c.deal && b.c.deal) {
                    if ((b.c.pct ?? 0) !== (a.c.pct ?? 0)) return (b.c.pct ?? 0) - (a.c.pct ?? 0);
                    return a.c.deal.price - b.c.deal.price;
                }
                if (a.c.fare && b.c.fare) return (a.c.fare.price ?? 0) - (b.c.fare.price ?? 0);
                return a.i - b.i;
            })
            .map((x) => x.c);
    }, [deals, fares, homeIata]);

    if (!active) return null;

    const dealCount = cards.filter((c) => c.deal).length;
    const pricedCount = cards.filter((c) => c.fare).length;
    const cheapest = cards.find((c) => c.fare)?.fare?.price;
    const days = daysToChristmas();

    const openCard = (c: Card) => {
        if (c.deal) {
            router.push({ pathname: "/deal-trip", params: dealTripParams(c.deal) } as any);
            return;
        }
        if (c.fare && homeIata && c.fare.iata) {
            // Indicative price — re-run a real search for a bookable fare.
            router.push({
                pathname: "/flights/search",
                params: {
                    autoSearch: "1",
                    departureId: homeIata,
                    arrivalId: c.fare.iata,
                    arrivalCityName: c.city,
                    currency: CURRENCY,
                    adults: "1",
                    ...(c.fare.outboundDate ? { outboundDate: c.fare.outboundDate } : {}),
                    ...(c.fare.returnDate ? { returnDate: c.fare.returnDate } : {}),
                },
            } as any);
            return;
        }
        // No fare yet — start a trip on the week before Christmas Day.
        const season = christmasSeason();
        const start = Date.parse(`${season.departFrom.slice(0, 4)}-12-19T12:00:00Z`);
        const begin = Math.max(start, Date.now() + DAY_MS);
        router.push({
            pathname: "/create-trip",
            params: {
                prefilledDestination: c.country ? `${c.city}, ${c.country}` : c.city,
                prefilledStartDate: String(begin),
                prefilledEndDate: String(begin + CHRISTMAS_TRIP_NIGHTS * DAY_MS),
            },
        } as any);
    };

    const formatRange = (from?: string, to?: string) => {
        if (!from) return "";
        const f = (s: string) =>
            new Date(`${s}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
        return to ? `${f(from)} – ${f(to)}` : f(from);
    };

    const subtitle =
        dealCount > 0
            ? t("christmas.subtitleDeals", { count: dealCount })
            : cheapest
              ? t("christmas.subtitleFrom", { price: formatFare(cheapest, CURRENCY) })
              : t("christmas.subtitle");

    return (
        <View style={styles.container}>
            <LinearGradient colors={["#991B1B", "#14532D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
                {/* Falling-snow sparkle */}
                <Text style={[styles.flake, { top: 10, right: 22, fontSize: 16 }]}>❄</Text>
                <Text style={[styles.flake, { top: 44, right: 64, fontSize: 10 }]}>✦</Text>
                <Text style={[styles.flake, { top: 16, right: 112, fontSize: 9 }]}>❄</Text>
                <Text style={[styles.flake, { top: 62, right: 16, fontSize: 11 }]}>✦</Text>

                <View style={styles.headerRow}>
                    <Text style={styles.headerEmoji}>🎄</Text>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title}>{t("christmas.title")}</Text>
                        <Text style={styles.subtitle}>{subtitle}</Text>
                    </View>
                </View>
                <View style={styles.chips}>
                    <View style={styles.countdown}>
                        <Text style={styles.countdownText}>
                            🎅 {days > 0 ? t("christmas.countdown", { count: days }) : t("christmas.merry")}
                        </Text>
                    </View>
                    {pricedCount > 0 && homeIata && (
                        <View style={styles.originChip}>
                            <Ionicons name="airplane" size={11} color="#FFF" />
                            <Text style={styles.originText}>{t("christmas.fromOrigin", { origin: homeIata })}</Text>
                        </View>
                    )}
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
                    {cards.map((c) => {
                        const photo = CHRISTMAS_PHOTOS[c.key];
                        const price = c.deal?.price ?? c.fare?.price;
                        const currency = c.deal ? c.deal.currency : CURRENCY;
                        const dates = c.deal
                            ? formatRange(c.deal.outboundDate, c.deal.returnDate)
                            : c.fare
                              ? formatRange(c.fare.outboundDate, c.fare.returnDate)
                              : "";
                        return (
                            <TouchableOpacity key={c.key} activeOpacity={0.85} onPress={() => openCard(c)}>
                                <View style={[styles.card, c.deal && styles.cardDeal]}>
                                    <LinearGradient
                                        colors={VIBE_GRADIENT[c.vibe]}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={StyleSheet.absoluteFill}
                                    />
                                    {photo && (
                                        <>
                                            <Image
                                                source={{ uri: photo.url }}
                                                style={StyleSheet.absoluteFill}
                                                contentFit="cover"
                                                cachePolicy="disk"
                                                transition={200}
                                            />
                                            {/* Legibility scrim, tinted with the card's vibe colour */}
                                            <LinearGradient
                                                colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0.05)", `${VIBE_GRADIENT[c.vibe][1]}F2`]}
                                                locations={[0, 0.3, 0.72]}
                                                style={StyleSheet.absoluteFill}
                                            />
                                        </>
                                    )}
                                    <View style={styles.cardBody}>
                                        <View style={styles.cardTop}>
                                            <Text style={styles.vibe}>{CHRISTMAS_VIBE_EMOJI[c.vibe]}</Text>
                                            {c.pct != null ? (
                                                <View style={styles.pctBadge}>
                                                    <Text style={styles.pctText}>−{c.pct}%</Text>
                                                </View>
                                            ) : c.deal ? (
                                                <View style={styles.pctBadge}>
                                                    <Text style={styles.pctText}>{t("christmas.dealBadge")}</Text>
                                                </View>
                                            ) : null}
                                        </View>
                                        <View style={styles.bottom}>
                                            <Text style={styles.city} numberOfLines={1}>
                                                {c.city}
                                            </Text>
                                            <Text style={styles.meta} numberOfLines={2}>
                                                {dates || t(`christmas.vibe.${c.vibe}`)}
                                            </Text>
                                            {price != null ? (
                                                <>
                                                    <Text style={styles.fromLabel}>{t("christmas.from")}</Text>
                                                    <View style={styles.priceRow}>
                                                        <Text style={styles.price}>{formatFare(price, currency)}</Text>
                                                        <Ionicons name="arrow-forward-circle" size={22} color={GOLD} />
                                                    </View>
                                                    {c.deal && (
                                                        <Text style={styles.worth} numberOfLines={1}>
                                                            {c.pct != null
                                                                ? t("christmas.belowTypical", { pct: c.pct })
                                                                : t("christmas.greatPrice")}
                                                        </Text>
                                                    )}
                                                </>
                                            ) : (
                                                <View style={styles.planRow}>
                                                    <Text style={styles.plan} numberOfLines={2}>
                                                        {t("christmas.planTrip")}
                                                    </Text>
                                                    <Ionicons name="arrow-forward" size={13} color={GOLD} />
                                                </View>
                                            )}
                                        </View>
                                        {photo && (
                                            <Text style={styles.credit} numberOfLines={1}>
                                                📷 {photo.photographer} · Unsplash
                                            </Text>
                                        )}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {pricedCount > 0 && <Text style={styles.disclaimer}>{t("christmas.indicative")}</Text>}
            </LinearGradient>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { marginTop: 8, marginBottom: 20, paddingHorizontal: 16 },
    banner: { borderRadius: 22, paddingTop: 16, paddingBottom: 14, overflow: "hidden" },
    flake: { position: "absolute", color: "rgba(255,255,255,0.35)" },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16 },
    headerEmoji: { fontSize: 30 },
    title: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, color: "#FFF" },
    subtitle: { fontSize: 13, fontWeight: "600", marginTop: 2, color: GOLD },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, marginTop: 10, marginBottom: 12 },
    countdown: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    countdownText: { fontSize: 12, fontWeight: "800", color: "#FFF" },
    originChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(0,0,0,0.2)",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    originText: { fontSize: 12, fontWeight: "700", color: "#FFF" },
    scroll: { paddingHorizontal: 16, gap: 10 },
    card: {
        width: 158,
        height: 210,
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
    },
    cardBody: { flex: 1, padding: 12 },
    credit: { fontSize: 8.5, color: "rgba(255,255,255,0.6)", marginTop: 4 },
    cardDeal: { borderColor: GOLD, borderWidth: 2 },
    cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    vibe: { fontSize: 22, textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 4 },
    pctBadge: { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
    pctText: { fontSize: 11, fontWeight: "900", color: "#000" },
    city: {
        fontSize: 18,
        fontWeight: "900",
        color: "#FFF",
        marginBottom: 2,
        textShadowColor: "rgba(0,0,0,0.5)",
        textShadowRadius: 6,
    },
    meta: {
        marginBottom: 6,
        fontSize: 12,
        fontWeight: "700",
        color: "rgba(255,255,255,0.92)",
        textShadowColor: "rgba(0,0,0,0.5)",
        textShadowRadius: 4,
    },
    bottom: { marginTop: "auto" },
    fromLabel: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.75)" },
    priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    price: { fontSize: 22, fontWeight: "900", color: "#FFF" },
    worth: { fontSize: 11, fontWeight: "700", color: "#BBF7D0", marginTop: 2 },
    planRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    plan: { fontSize: 13, fontWeight: "800", color: GOLD, flexShrink: 1 },
    disclaimer: { fontSize: 10.5, color: "rgba(255,255,255,0.65)", paddingHorizontal: 16, marginTop: 10 },
});
