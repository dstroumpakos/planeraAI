/**
 * PackageCard — premium-feeling card for an OTA partner package.
 * Used inside the Trip Detail "Packages" filter.
 */

import React from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ImageBackground,
    Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";

const CARD_WIDTH = Dimensions.get("window").width - 32;

const INCLUDES_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; key: string }> = {
    flights:        { icon: "airplane",       key: "includesFlights" },
    hotel:          { icon: "bed",            key: "includesHotel" },
    transfers:      { icon: "car",            key: "includesTransfers" },
    breakfast:      { icon: "cafe",           key: "includesBreakfast" },
    half_board:     { icon: "restaurant",     key: "includesHalfBoard" },
    full_board:     { icon: "restaurant",     key: "includesFullBoard" },
    all_inclusive:  { icon: "ribbon",         key: "includesAllInclusive" },
    tours:          { icon: "compass",        key: "includesTours" },
    activities:     { icon: "sparkles",       key: "includesActivities" },
    insurance:      { icon: "shield-checkmark", key: "includesInsurance" },
    guide:          { icon: "person",         key: "includesGuide" },
};

function formatPrice(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
        }).format(amount);
    } catch {
        return `${currency} ${Math.round(amount)}`;
    }
}

export interface PackageCardProps {
    pkg: {
        _id: string;
        title: string;
        subtitle?: string;
        description?: string;
        destinationCity?: string;
        destinationCountry: string;
        durationDays: number;
        priceFrom: number;
        priceCurrency: string;
        priceUnit?: "per_person" | "per_couple" | "total";
        includes: string[];
        highlights?: string[];
        imageUrls: string[];
        heroImageUrl?: string | null;
        badge?: string;
        partner: {
            _id: string;
            name: string;
            logoUrl?: string;
        };
    };
    onPressInquire: () => void;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pkg, onPressInquire }) => {
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();

    const hero = pkg.heroImageUrl || pkg.imageUrls?.[0];
    const priceUnit = pkg.priceUnit ?? "per_person";

    return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: isDarkMode ? "#000" : "#0f172a" }]}>
            {/* Hero image */}
            <ImageBackground
                source={hero ? { uri: hero } : undefined}
                style={styles.hero}
                imageStyle={styles.heroImage}
            >
                <LinearGradient
                    colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
                    style={StyleSheet.absoluteFill}
                />
                {/* Top row: badge + partner pill */}
                <View style={styles.heroTopRow}>
                    {pkg.badge ? (
                        <View style={styles.badgePill}>
                            <Ionicons name="star" size={11} color="#FBBF24" />
                            <Text style={styles.badgeText}>{pkg.badge}</Text>
                        </View>
                    ) : <View />}
                    <View style={styles.partnerPill}>
                        <Text style={styles.partnerPillText} numberOfLines={1}>
                            {pkg.partner.name}
                        </Text>
                    </View>
                </View>

                {/* Bottom: title + duration */}
                <View style={styles.heroBottom}>
                    <Text style={styles.heroTitle} numberOfLines={2}>{pkg.title}</Text>
                    <View style={styles.heroMetaRow}>
                        <View style={styles.heroMetaItem}>
                            <Ionicons name="location" size={13} color="#fff" />
                            <Text style={styles.heroMetaText} numberOfLines={1}>
                                {pkg.destinationCity ? `${pkg.destinationCity}, ${pkg.destinationCountry}` : pkg.destinationCountry}
                            </Text>
                        </View>
                        <View style={styles.heroMetaDot} />
                        <View style={styles.heroMetaItem}>
                            <Ionicons name="calendar-outline" size={13} color="#fff" />
                            <Text style={styles.heroMetaText}>
                                {t("packages.durationDays", { count: pkg.durationDays })}
                            </Text>
                        </View>
                    </View>
                </View>
            </ImageBackground>

            {/* Body */}
            <View style={styles.body}>
                {pkg.subtitle ? (
                    <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>
                        {pkg.subtitle}
                    </Text>
                ) : null}

                {/* Includes badges */}
                {pkg.includes?.length ? (
                    <View style={styles.includesRow}>
                        {pkg.includes.slice(0, 5).map((inc) => {
                            const meta = INCLUDES_META[inc] ?? { icon: "checkmark-circle" as const, key: "" };
                            const label = meta.key ? t(`packages.${meta.key}`) : inc;
                            return (
                                <View
                                    key={inc}
                                    style={[styles.includeChip, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.06)" : "#f3f4f6", borderColor: colors.border }]}
                                >
                                    <Ionicons name={meta.icon} size={12} color={colors.primary} />
                                    <Text style={[styles.includeText, { color: colors.text }]}>{label}</Text>
                                </View>
                            );
                        })}
                    </View>
                ) : null}

                {/* Highlights (optional) */}
                {pkg.highlights && pkg.highlights.length > 0 ? (
                    <View style={styles.highlightsBox}>
                        {pkg.highlights.slice(0, 3).map((h, i) => (
                            <View key={i} style={styles.highlightRow}>
                                <Ionicons name="checkmark" size={14} color={colors.primary} />
                                <Text style={[styles.highlightText, { color: colors.textMuted }]} numberOfLines={2}>
                                    {h}
                                </Text>
                            </View>
                        ))}
                    </View>
                ) : null}

                {/* Footer: price + CTA */}
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                    <View>
                        <Text style={[styles.priceLabel, { color: colors.textMuted }]}>
                            {t("packages.priceFrom")}
                        </Text>
                        <View style={styles.priceRow}>
                            <Text style={[styles.priceAmount, { color: colors.text }]}>
                                {formatPrice(pkg.priceFrom, pkg.priceCurrency)}
                            </Text>
                            <Text style={[styles.priceUnit, { color: colors.textMuted }]}>
                                {" "}{t(`packages.${priceUnit === "per_couple" ? "perCouple" : priceUnit === "total" ? "total" : "perPerson"}`)}
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity
                        style={[styles.cta, { backgroundColor: colors.primary }]}
                        onPress={onPressInquire}
                        activeOpacity={0.85}
                    >
                        <Ionicons name="mail" size={16} color="#fff" />
                        <Text style={styles.ctaText}>{t("packages.requestInfo")}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        width: CARD_WIDTH,
        borderRadius: 20,
        borderWidth: 1,
        overflow: "hidden",
        marginBottom: 20,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
    },
    hero: {
        height: 200,
        justifyContent: "space-between",
        padding: 14,
        backgroundColor: "#1f2937",
    },
    heroImage: {
        resizeMode: "cover",
    },
    heroTopRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
    },
    badgePill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(0,0,0,0.55)",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
    partnerPill: {
        backgroundColor: "rgba(255,255,255,0.92)",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        maxWidth: 150,
    },
    partnerPillText: { color: "#111827", fontSize: 11, fontWeight: "700" },
    heroBottom: {},
    heroTitle: {
        color: "#fff",
        fontSize: 20,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
    heroMetaRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 8,
    },
    heroMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    heroMetaText: { color: "#fff", fontSize: 12, fontWeight: "500" },
    heroMetaDot: {
        width: 3, height: 3, borderRadius: 2,
        backgroundColor: "rgba(255,255,255,0.6)",
        marginHorizontal: 8,
    },
    body: { padding: 14 },
    subtitle: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
    includesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginBottom: 12,
    },
    includeChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
    },
    includeText: { fontSize: 11, fontWeight: "600" },
    highlightsBox: { marginBottom: 12, gap: 4 },
    highlightRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    highlightText: { flex: 1, fontSize: 12, lineHeight: 17 },
    footer: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-end",
        borderTopWidth: 1,
        paddingTop: 12,
    },
    priceLabel: { fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", fontWeight: "600" },
    priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
    priceAmount: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
    priceUnit: { fontSize: 11, fontWeight: "500" },
    cta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: 12,
    },
    ctaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});

export default PackageCard;
