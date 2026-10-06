/**
 * PartnerToursRow — home "Tours by local partners" section.
 *
 * Shows approved supplier products (`partnerProducts.listForHome`). Every card
 * carries a picture, the agency name and the price. Suppliers often submit no
 * image, so we fall back to an Unsplash photo of the destination (same source
 * as the Trending strip), and to a branded gradient if even that fails.
 *
 * One product → a single wide featured card; two or more → a horizontal row.
 * Tapping opens a detail sheet with the description and a link to the
 * supplier's site. Hidden entirely while nothing is approved.
 */

import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Modal,
    Linking,
    Dimensions,
    Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";
import { useToken } from "@/lib/useAuthenticatedMutation";

type PartnerProduct = {
    _id: string;
    type: "tour" | "experience" | "hotel" | "other";
    title: string;
    description?: string;
    destination?: string;
    country?: string;
    price?: number;
    currency: string;
    bookingUrl?: string;
    imageUrl?: string;
    partnerName: string;
};

const SCREEN_WIDTH = Dimensions.get("window").width;

const TYPE_ICON: Record<PartnerProduct["type"], keyof typeof Ionicons.glyphMap> = {
    tour: "bus",
    experience: "sparkles",
    hotel: "bed",
    other: "compass",
};

// Destination → fallback photo URL, shared across mounts so re-visiting Home
// doesn't re-hit Unsplash. null = looked up, nothing found.
const fallbackCache: Record<string, string | null> = {};

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

/** "ALBANIA" → "Albania"; leaves mixed-case input alone. */
function prettyPlace(s?: string): string | undefined {
    if (!s) return undefined;
    if (s !== s.toUpperCase()) return s;
    return s
        .toLowerCase()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

export default function PartnerToursRow() {
    const { t } = useTranslation();
    const { colors } = useTheme();
    // Market-guarded: the token lets the server match listings to the user's
    // home airport, so wait for it rather than briefly showing the wrong set.
    const { token, isLoading: tokenLoading } = useToken();
    const products = useQuery(
        (api as any).partnerProducts.listForHome,
        tokenLoading ? "skip" : token ? { token } : {}
    ) as PartnerProduct[] | undefined;
    const getImages = useAction(api.images.getDestinationImages);
    const trackClick = useMutation((api as any).partnerProducts.trackHomeClick);
    const [fallbacks, setFallbacks] = useState<Record<string, string | null>>(fallbackCache);
    const [selected, setSelected] = useState<PartnerProduct | null>(null);

    // Resolve a destination photo for every product that came without an image.
    useEffect(() => {
        if (!products) return;
        const missing = Array.from(
            new Set(
                products
                    .filter((p) => !p.imageUrl && p.destination)
                    .map((p) => p.destination as string)
                    .filter((d) => !(d in fallbackCache))
            )
        );
        if (missing.length === 0) return;
        let cancelled = false;
        (async () => {
            for (const destination of missing) {
                try {
                    const images = await getImages({ destination, count: 1 });
                    fallbackCache[destination] = images?.[0]?.url ?? null;
                } catch {
                    fallbackCache[destination] = null;
                }
            }
            if (!cancelled) setFallbacks({ ...fallbackCache });
        })();
        return () => {
            cancelled = true;
        };
    }, [products]);

    if (!products || products.length === 0) return null;

    const imageFor = (p: PartnerProduct) =>
        p.imageUrl || (p.destination ? fallbacks[p.destination] : null) || null;

    const track = (p: PartnerProduct, kind: "open" | "site") => {
        trackClick({
            productId: p._id,
            kind,
            source: Platform.OS,
            ...(token ? { token } : {}),
        }).catch(() => {});
    };

    const open = (p: PartnerProduct) => {
        track(p, "open");
        setSelected(p);
    };

    const featured = products.length === 1;

    return (
        <View style={styles.section}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: colors.text }]}>
                    {t("partnerTours.title", { defaultValue: "Tours by local partners" })}
                </Text>
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                    {t("partnerTours.subtitle", { defaultValue: "Hand-picked trips from travel agencies" })}
                </Text>
            </View>

            {featured ? (
                <View style={{ paddingHorizontal: 20 }}>
                    <ProductCard
                        product={products[0]}
                        imageUrl={imageFor(products[0])}
                        width={SCREEN_WIDTH - 40}
                        height={240}
                        onPress={() => open(products[0])}
                    />
                </View>
            ) : (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rowContent}
                >
                    {products.map((p) => (
                        <ProductCard
                            key={p._id}
                            product={p}
                            imageUrl={imageFor(p)}
                            width={260}
                            height={300}
                            onPress={() => open(p)}
                        />
                    ))}
                </ScrollView>
            )}

            <ProductSheet
                product={selected}
                imageUrl={selected ? imageFor(selected) : null}
                onClose={() => setSelected(null)}
                onVisitSite={(p) => track(p, "site")}
            />
        </View>
    );
}

function ProductCard({
    product,
    imageUrl,
    width,
    height,
    onPress,
}: {
    product: PartnerProduct;
    imageUrl: string | null;
    width: number;
    height: number;
    onPress: () => void;
}) {
    const { t } = useTranslation();
    const place = prettyPlace(product.destination);

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            onPress={onPress}
            style={[styles.card, { width, height }]}
        >
            <CardImage imageUrl={imageUrl} type={product.type} />
            <LinearGradient
                colors={["rgba(0,0,0,0.05)", "rgba(0,0,0,0.25)", "rgba(0,0,0,0.85)"]}
                locations={[0, 0.45, 1]}
                style={StyleSheet.absoluteFill}
            />

            {/* Type pill */}
            <View style={styles.typePill}>
                <Ionicons name={TYPE_ICON[product.type]} size={12} color="#1A1A1A" />
                <Text style={styles.typePillText}>
                    {t(`partnerTours.type.${product.type}`, { defaultValue: product.type })}
                </Text>
            </View>

            <View style={styles.cardBody}>
                {/* Agency name */}
                <View style={styles.agencyRow}>
                    <Ionicons name="storefront" size={13} color="#FFE500" />
                    <Text style={styles.agencyText} numberOfLines={1}>
                        {product.partnerName}
                    </Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                    {product.title}
                </Text>
                <View style={styles.cardFooter}>
                    {place ? (
                        <View style={styles.placeRow}>
                            <Ionicons name="location" size={13} color="rgba(255,255,255,0.8)" />
                            <Text style={styles.placeText} numberOfLines={1}>
                                {place}
                            </Text>
                        </View>
                    ) : (
                        <View style={{ flex: 1 }} />
                    )}
                    {product.price != null && (
                        <View style={styles.pricePill}>
                            <Text style={styles.priceFrom}>
                                {t("partnerTours.from", { defaultValue: "from" })}
                            </Text>
                            <Text style={styles.priceValue}>
                                {formatPrice(product.price, product.currency)}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
}

function CardImage({ imageUrl, type }: { imageUrl: string | null; type: PartnerProduct["type"] }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [imageUrl]);

    if (imageUrl && !failed) {
        return (
            <Image
                source={{ uri: imageUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                onError={() => setFailed(true)}
            />
        );
    }
    // Last-resort picture: branded gradient with the product-type icon.
    return (
        <LinearGradient
            colors={["#FFE500", "#F5A623", "#2C2C2E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.placeholder]}
        >
            <Ionicons name={TYPE_ICON[type]} size={56} color="rgba(0,0,0,0.25)" />
        </LinearGradient>
    );
}

function ProductSheet({
    product,
    imageUrl,
    onClose,
    onVisitSite,
}: {
    product: PartnerProduct | null;
    imageUrl: string | null;
    onClose: () => void;
    onVisitSite: (p: PartnerProduct) => void;
}) {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const place = prettyPlace(product?.destination);

    return (
        <Modal visible={!!product} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
            {product && (
                <View
                    style={[
                        styles.sheet,
                        { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 16) + 8 },
                    ]}
                >
                    <View style={styles.sheetImage}>
                        <CardImage imageUrl={imageUrl} type={product.type} />
                        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
                            <Ionicons name="close" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ padding: 20 }}>
                        <View style={styles.agencyRow}>
                            <Ionicons name="storefront" size={14} color={colors.textSecondary} />
                            <Text style={[styles.sheetAgency, { color: colors.textSecondary }]}>
                                {product.partnerName}
                            </Text>
                        </View>
                        <Text style={[styles.sheetTitle, { color: colors.text }]}>{product.title}</Text>

                        <View style={styles.sheetMeta}>
                            {place && (
                                <View style={styles.placeRow}>
                                    <Ionicons name="location" size={14} color={colors.textMuted} />
                                    <Text style={[styles.sheetMetaText, { color: colors.textMuted }]}>{place}</Text>
                                </View>
                            )}
                            {product.price != null && (
                                <Text style={[styles.sheetPrice, { color: colors.text }]}>
                                    {t("partnerTours.from", { defaultValue: "from" })}{" "}
                                    {formatPrice(product.price, product.currency)}
                                </Text>
                            )}
                        </View>

                        {!!product.description && (
                            <Text style={[styles.sheetDesc, { color: colors.textSecondary }]}>
                                {product.description}
                            </Text>
                        )}
                    </ScrollView>

                    <View style={{ paddingHorizontal: 20 }}>
                        {product.bookingUrl ? (
                            <TouchableOpacity
                                style={[styles.cta, { backgroundColor: colors.primary }]}
                                activeOpacity={0.85}
                                onPress={() => {
                                    onVisitSite(product);
                                    Linking.openURL(product.bookingUrl!).catch(() => {});
                                }}
                            >
                                <Text style={styles.ctaText}>
                                    {t("partnerTours.visitSite", {
                                        defaultValue: "View on {{partner}}",
                                        partner: product.partnerName,
                                    })}
                                </Text>
                                <Ionicons name="open-outline" size={18} color="#000" />
                            </TouchableOpacity>
                        ) : null}
                        <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                            {t("partnerTours.disclaimer", {
                                defaultValue: "Offered and booked directly with {{partner}}.",
                                partner: product.partnerName,
                            })}
                        </Text>
                    </View>
                </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    header: {
        paddingHorizontal: 20,
        marginBottom: 14,
    },
    title: {
        fontSize: 20,
        fontWeight: "700",
    },
    subtitle: {
        fontSize: 13,
        fontWeight: "500",
        marginTop: 2,
    },
    rowContent: {
        paddingHorizontal: 20,
        gap: 16,
    },
    card: {
        borderRadius: 24,
        overflow: "hidden",
        backgroundColor: "#2C2C2E",
    },
    placeholder: {
        justifyContent: "center",
        alignItems: "center",
    },
    typePill: {
        position: "absolute",
        top: 14,
        left: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: "rgba(255,255,255,0.92)",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    typePillText: {
        fontSize: 12,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    cardBody: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 16,
    },
    agencyRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
    },
    agencyText: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "700",
        color: "#FFE500",
        letterSpacing: 0.2,
    },
    cardTitle: {
        fontSize: 19,
        fontWeight: "800",
        color: "#fff",
        letterSpacing: -0.3,
        lineHeight: 24,
    },
    cardFooter: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 10,
        gap: 10,
    },
    placeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexShrink: 1,
    },
    placeText: {
        fontSize: 13,
        fontWeight: "600",
        color: "rgba(255,255,255,0.85)",
        flexShrink: 1,
    },
    pricePill: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 4,
        backgroundColor: "#FFE500",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
    },
    priceFrom: {
        fontSize: 11,
        fontWeight: "600",
        color: "rgba(0,0,0,0.65)",
    },
    priceValue: {
        fontSize: 16,
        fontWeight: "800",
        color: "#000",
    },
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheet: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: "hidden",
    },
    sheetImage: {
        height: 200,
        backgroundColor: "#2C2C2E",
    },
    closeBtn: {
        position: "absolute",
        top: 14,
        right: 14,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
    },
    sheetAgency: {
        fontSize: 14,
        fontWeight: "700",
    },
    sheetTitle: {
        fontSize: 22,
        fontWeight: "800",
        letterSpacing: -0.4,
        marginTop: 2,
    },
    sheetMeta: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 10,
        gap: 12,
    },
    sheetMetaText: {
        fontSize: 14,
        fontWeight: "600",
    },
    sheetPrice: {
        fontSize: 18,
        fontWeight: "800",
    },
    sheetDesc: {
        fontSize: 15,
        lineHeight: 22,
        marginTop: 14,
    },
    cta: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 15,
        borderRadius: 16,
        marginTop: 4,
    },
    ctaText: {
        fontSize: 16,
        fontWeight: "800",
        color: "#000",
    },
    disclaimer: {
        fontSize: 12,
        textAlign: "center",
        marginTop: 10,
    },
});
