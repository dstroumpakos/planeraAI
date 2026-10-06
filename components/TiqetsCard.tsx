import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

// Tiqets brand-kit turquoise + the navy from its banners. White text on the
// turquoise is too low-contrast for body copy, so copy and CTA sit in navy.
const TIQETS_TURQUOISE = "#4BC3C6";
const NAVY = "#232A4B";

/**
 * Tiqets partner card (museum & attraction tickets). Self-coloured, so it
 * reads the same in light and dark mode. The caller owns the link + click
 * tracking (see `buildTiqetsLink` in lib/affiliateLinks.ts).
 */
export default function TiqetsCard({
    destination,
    onPress,
}: {
    destination?: string;
    onPress: () => void;
}) {
    const { t } = useTranslation();

    return (
        <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
            <View style={styles.header}>
                <Image
                    source={require("../assets/images/partners/tiqets-logo-white.png")}
                    style={styles.logo}
                    resizeMode="contain"
                    accessibilityLabel="Tiqets"
                />
                <Ionicons name="ticket-outline" size={20} color={NAVY} style={{ opacity: 0.7 }} />
            </View>
            <Text style={styles.title}>
                {destination ? t("tiqets.titleIn", { place: destination }) : t("tiqets.title")}
            </Text>
            <Text style={styles.desc}>{t("tiqets.desc")}</Text>
            <View style={styles.cta}>
                <Text style={styles.ctaText}>{t("tiqets.cta")}</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: TIQETS_TURQUOISE,
        borderRadius: 16,
        padding: 18,
        marginTop: 16,
    },
    header: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 12,
    },
    // Logo PNG is 541×206 (trimmed); keep its aspect ratio.
    logo: { height: 26, width: 26 * (541 / 206) },
    title: { color: NAVY, fontSize: 17, fontWeight: "700", lineHeight: 22, marginBottom: 4 },
    desc: { color: NAVY, opacity: 0.8, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    cta: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: NAVY,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    ctaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
