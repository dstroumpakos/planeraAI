/**
 * Rich cards rendered from Atlas tool results.
 *
 * The server emits these deterministically from the tool output (see
 * `convex/atlasTools.ts`) rather than parsing them out of the model's prose, so
 * a card appears whenever its tool ran — the model can't forget to include it.
 *
 * Weather and restaurant cards are NOT here: those already exist inside the
 * Atlas screen with their own styling and are fed from the same `cards` array.
 */

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";

export interface AtlasCardData {
    type: string;
    data: any;
}

// ───────────────────────────────── Shell ────────────────────────────────────

const CardShell = ({
    icon,
    title,
    subtitle,
    children,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle?: string | null;
    children: React.ReactNode;
}) => {
    const { colors, isDarkMode } = useTheme();
    return (
        <View
            style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
            ]}
        >
            <View style={styles.cardHeader}>
                <View
                    style={[
                        styles.cardIcon,
                        { backgroundColor: isDarkMode ? "rgba(255,229,0,0.15)" : "#FFF8E1" },
                    ]}
                >
                    <Ionicons name={icon} size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
                    {!!subtitle && (
                        <Text style={[styles.cardSubtitle, { color: colors.textMuted }]}>
                            {subtitle}
                        </Text>
                    )}
                </View>
            </View>
            {children}
        </View>
    );
};

const Row = ({ label, value }: { label: string; value: string }) => {
    const { colors } = useTheme();
    return (
        <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
            <Text style={[styles.rowValue, { color: colors.text }]} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
};

// ───────────────────────────── Individual cards ─────────────────────────────

const FlightPricesCard = ({ data }: { data: any }) => {
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();
    const dates: any[] = data?.dates ?? [];

    return (
        <CardShell
            icon="airplane"
            title={t("atlas.cards.cheapestDates")}
            subtitle={`${data.origin} → ${data.destination}`}
        >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {dates.map((d, i) => (
                    <View
                        key={`${d.date}-${i}`}
                        style={[
                            styles.priceChip,
                            {
                                backgroundColor: isDarkMode ? "rgba(255,229,0,0.10)" : "#FFFBEA",
                                borderColor: colors.border,
                            },
                        ]}
                    >
                        <Text style={[styles.priceChipDate, { color: colors.textMuted }]}>
                            {String(d.date ?? "").slice(5)}
                        </Text>
                        {!!d.returnDate && (
                            <Text style={[styles.priceChipReturn, { color: colors.textMuted }]}>
                                ↩ {String(d.returnDate).slice(5)}
                            </Text>
                        )}
                        <Text style={[styles.priceChipPrice, { color: colors.text }]}>
                            {data.currency === "EUR" ? "€" : ""}
                            {d.price}
                        </Text>
                    </View>
                ))}
            </ScrollView>
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                {t("atlas.cards.indicativeFares")}
            </Text>
        </CardShell>
    );
};

const DealsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const deals: any[] = data?.deals ?? [];

    return (
        <CardShell
            icon="pricetag"
            title={t("atlas.cards.dealsFromYou")}
            subtitle={data.homeIata ? `${t("atlas.cards.from")} ${data.homeIata}` : null}
        >
            {deals.map((d, i) => (
                <View key={`${d.id ?? i}`} style={styles.dealRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.dealCity, { color: colors.text }]}>
                            {d.destinationCity}
                            {d.destinationCountry ? `, ${d.destinationCountry}` : ""}
                        </Text>
                        {!!d.airline && (
                            <Text style={[styles.dealMeta, { color: colors.textMuted }]}>
                                {d.airline}
                                {d.travelWindow ? ` · ${d.travelWindow}` : ""}
                            </Text>
                        )}
                    </View>
                    <Text style={[styles.dealPrice, { color: colors.primary }]}>
                        {d.currency === "EUR" ? "€" : `${d.currency} `}
                        {d.price}
                    </Text>
                </View>
            ))}
        </CardShell>
    );
};

const SightsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const sights: any[] = data?.sights ?? [];

    return (
        <CardShell icon="camera" title={t("atlas.cards.notableSights")} subtitle={data.destination}>
            {sights.map((s, i) => (
                <View key={`${s.name}-${i}`} style={styles.sightRow}>
                    <Text style={[styles.sightName, { color: colors.text }]}>{s.name}</Text>
                    <Text style={[styles.sightDesc, { color: colors.textMuted }]} numberOfLines={3}>
                        {s.description}
                    </Text>
                    {(s.area || s.duration) && (
                        <Text style={[styles.sightMeta, { color: colors.textMuted }]}>
                            {[s.area, s.duration ? `~${s.duration}h` : null].filter(Boolean).join(" · ")}
                        </Text>
                    )}
                </View>
            ))}
        </CardShell>
    );
};

const SpendCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();

    return (
        <CardShell
            icon="wallet"
            title={t("atlas.cards.typicalSpend")}
            subtitle={data.destination}
        >
            <View style={styles.bigStatRow}>
                <Text style={[styles.bigStat, { color: colors.text }]}>€{data.dailyEur}</Text>
                <Text style={[styles.bigStatLabel, { color: colors.textMuted }]}>
                    {t("atlas.cards.perPersonPerDay")}
                </Text>
            </View>
            {!!data.avgStayDays && (
                <Row
                    label={t("atlas.cards.averageStay")}
                    value={`${data.avgStayDays} ${t("atlas.cards.days")}`}
                />
            )}
            {!!data.estimatedTripCost && (
                <Row
                    label={t("atlas.cards.estTripCost")}
                    value={`€${data.estimatedTripCost}`}
                />
            )}
            {data.level === "country" && (
                <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                    {t("atlas.cards.countryLevelEstimate")}
                </Text>
            )}
        </CardShell>
    );
};

const CurrencyCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();

    return (
        <CardShell
            icon="swap-horizontal"
            title={t("atlas.cards.exchangeRate")}
            subtitle={data.asOf ? `${t("atlas.cards.asOf")} ${data.asOf}` : null}
        >
            <View style={styles.bigStatRow}>
                <Text style={[styles.bigStat, { color: colors.text }]}>
                    {data.converted?.toFixed(2)} {data.to}
                </Text>
                <Text style={[styles.bigStatLabel, { color: colors.textMuted }]}>
                    = {data.amount} {data.from}
                </Text>
            </View>
            <Row label={t("atlas.cards.rate")} value={`1 ${data.from} = ${data.rate} ${data.to}`} />
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                {t("atlas.cards.ecbReference")}
            </Text>
        </CardShell>
    );
};

const CountryFactsCard = ({ data }: { data: any }) => {
    const { t } = useTranslation();

    return (
        <CardShell icon="earth" title={data.name} subtitle={data.region || null}>
            <Row label={t("atlas.cards.capital")} value={data.capital} />
            <Row label={t("atlas.cards.currency")} value={data.currencies} />
            <Row label={t("atlas.cards.languages")} value={data.languages} />
            {!!data.callingCode && (
                <Row label={t("atlas.cards.callingCode")} value={data.callingCode} />
            )}
            <Row
                label={t("atlas.cards.drivesOn")}
                value={
                    data.drivingSide === "left"
                        ? t("atlas.cards.left")
                        : data.drivingSide === "right"
                            ? t("atlas.cards.right")
                            : "—"
                }
            />
            {Array.isArray(data.timezones) && data.timezones.length > 0 && (
                <Row label={t("atlas.cards.timezone")} value={data.timezones.slice(0, 3).join(", ")} />
            )}
        </CardShell>
    );
};

const HolidaysCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const holidays: any[] = (data?.holidays ?? []).slice(0, 8);

    return (
        <CardShell
            icon="calendar"
            title={t("atlas.cards.publicHolidays")}
            subtitle={`${data.country} · ${data.year}`}
        >
            {holidays.map((h, i) => (
                <View key={`${h.date}-${i}`} style={styles.holidayRow}>
                    <Text style={[styles.holidayDate, { color: colors.primary }]}>
                        {String(h.date).slice(5)}
                    </Text>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.holidayName, { color: colors.text }]}>{h.localName}</Text>
                        {h.name !== h.localName && (
                            <Text style={[styles.holidayAlt, { color: colors.textMuted }]}>{h.name}</Text>
                        )}
                    </View>
                </View>
            ))}
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                {t("atlas.cards.holidayClosures")}
            </Text>
        </CardShell>
    );
};

const AirQualityCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();

    // European AQI: lower is better. Colour follows the official banding.
    const aqi = data.aqi;
    const bandColor =
        aqi == null ? colors.textMuted
            : aqi <= 20 ? "#50CCAA"
                : aqi <= 40 ? "#8CD05F"
                    : aqi <= 60 ? "#F0E641"
                        : aqi <= 80 ? "#FF9B57"
                            : aqi <= 100 ? "#FF5050"
                                : "#960032";

    return (
        <CardShell icon="leaf" title={t("atlas.cards.airQuality")} subtitle={data.location}>
            <View style={styles.bigStatRow}>
                <Text style={[styles.bigStat, { color: bandColor }]}>{aqi ?? "—"}</Text>
                <Text style={[styles.bigStatLabel, { color: colors.textMuted }]}>{data.band}</Text>
            </View>
            {data.pm25 != null && <Row label="PM2.5" value={`${data.pm25} µg/m³`} />}
            {data.pm10 != null && <Row label="PM10" value={`${data.pm10} µg/m³`} />}
            {data.uvIndex != null && (
                <Row label={t("atlas.cards.uvIndex")} value={String(data.uvIndex)} />
            )}
        </CardShell>
    );
};

const LocalTimeCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();

    return (
        <CardShell icon="time" title={t("atlas.cards.localTime")} subtitle={data.location}>
            <View style={styles.bigStatRow}>
                <Text style={[styles.bigStatSmall, { color: colors.text }]}>{data.localTime}</Text>
            </View>
            <Row
                label={t("atlas.cards.timezone")}
                value={`${data.timezone} (UTC${data.utcOffset >= 0 ? "+" : ""}${data.utcOffset})`}
            />
        </CardShell>
    );
};

const TripsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const trips: any[] = data?.trips ?? [];

    return (
        <CardShell icon="map" title={t("atlas.cards.yourTrips")}>
            {trips.map((tr, i) => (
                <View key={`${tr.id ?? i}`} style={styles.dealRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.dealCity, { color: colors.text }]}>{tr.destination}</Text>
                        <Text style={[styles.dealMeta, { color: colors.textMuted }]}>
                            {new Date(tr.startDate).toISOString().slice(0, 10)} →{" "}
                            {new Date(tr.endDate).toISOString().slice(0, 10)}
                        </Text>
                    </View>
                </View>
            ))}
        </CardShell>
    );
};

const PassportCheckCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const travelers: any[] = data?.travelers ?? [];

    return (
        <CardShell
            icon="document-text"
            title={t("atlas.cards.passportCheck")}
            subtitle={data.referenceDate}
        >
            {travelers.map((p, i) => {
                const ok = !p.expired && p.meetsSixMonthRule;
                return (
                    <View key={`${p.name}-${i}`} style={styles.passportRow}>
                        <Ionicons
                            name={ok ? "checkmark-circle" : "alert-circle"}
                            size={18}
                            color={ok ? "#34C759" : "#FF9500"}
                        />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={[styles.dealCity, { color: colors.text }]}>{p.name}</Text>
                            <Text style={[styles.dealMeta, { color: colors.textMuted }]}>
                                {p.nationality} · {t("atlas.cards.expires")} {p.expiry}
                            </Text>
                        </View>
                    </View>
                );
            })}
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                {t("atlas.cards.sixMonthRule")}
            </Text>
        </CardShell>
    );
};

const ItinerariesCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const guides: any[] = data?.guides ?? [];

    return (
        <CardShell icon="book" title={t("atlas.cards.guides")} subtitle={data.destination}>
            {guides.map((g, i) => (
                <TouchableOpacity
                    key={`${g.slug ?? i}`}
                    style={styles.sightRow}
                    activeOpacity={0.7}
                    onPress={() =>
                        Linking.openURL(`https://planeraai.app/itinerary/${g.slug}`).catch(() => { })
                    }
                >
                    <Text style={[styles.sightName, { color: colors.text }]}>{g.title}</Text>
                    {!!g.summary && (
                        <Text style={[styles.sightDesc, { color: colors.textMuted }]} numberOfLines={2}>
                            {g.summary}
                        </Text>
                    )}
                </TouchableOpacity>
            ))}
        </CardShell>
    );
};

/** Confirmation that a write tool actually ran. */
const ConfirmationCard = ({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) => {
    const { colors, isDarkMode } = useTheme();
    return (
        <View
            style={[
                styles.confirmation,
                {
                    backgroundColor: isDarkMode ? "rgba(52,199,89,0.12)" : "#EAF9EE",
                    borderColor: isDarkMode ? "rgba(52,199,89,0.3)" : "#C8ECD2",
                },
            ]}
        >
            <Ionicons name={icon} size={16} color="#34C759" />
            <Text style={[styles.confirmationText, { color: colors.text }]}>{label}</Text>
        </View>
    );
};

// ─────────────────────────────── Dispatcher ─────────────────────────────────

export const AtlasCardRenderer = ({ card }: { card: AtlasCardData }) => {
    const { t } = useTranslation();

    switch (card.type) {
        case "flightPrices":
            return <FlightPricesCard data={card.data} />;
        case "deals":
            return <DealsCard data={card.data} />;
        case "sights":
            return <SightsCard data={card.data} />;
        case "spend":
            return <SpendCard data={card.data} />;
        case "currency":
            return <CurrencyCard data={card.data} />;
        case "countryFacts":
            return <CountryFactsCard data={card.data} />;
        case "holidays":
            return <HolidaysCard data={card.data} />;
        case "airQuality":
            return <AirQualityCard data={card.data} />;
        case "localTime":
            return <LocalTimeCard data={card.data} />;
        case "trips":
            return <TripsCard data={card.data} />;
        case "passportCheck":
            return <PassportCheckCard data={card.data} />;
        case "itineraries":
            return <ItinerariesCard data={card.data} />;
        case "watched":
            return (
                <ConfirmationCard
                    icon="notifications"
                    label={t("atlas.cards.nowWatching", { destination: card.data.destination })}
                />
            );
        case "wishlist":
            return (
                <ConfirmationCard
                    icon="heart"
                    label={t("atlas.cards.addedToWishlist", { destination: card.data.destination })}
                />
            );
        // "weather" and "restaurants" are rendered by the Atlas screen's own
        // components, which already exist with their own styling.
        default:
            return null;
    }
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginBottom: 10,
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 8,
        gap: 8,
    },
    cardIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    cardTitle: { fontSize: 14, fontWeight: "700" },
    cardSubtitle: { fontSize: 12, marginTop: 1 },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingVertical: 4,
        gap: 12,
    },
    rowLabel: { fontSize: 12, flexShrink: 0 },
    rowValue: { fontSize: 12, fontWeight: "600", flex: 1, textAlign: "right" },
    bigStatRow: { alignItems: "center", paddingVertical: 6 },
    bigStat: { fontSize: 30, fontWeight: "800" },
    bigStatSmall: { fontSize: 17, fontWeight: "700", textAlign: "center" },
    bigStatLabel: { fontSize: 12, marginTop: 2 },
    disclaimer: { fontSize: 10, marginTop: 8, fontStyle: "italic" },
    priceChip: {
        borderRadius: 10,
        borderWidth: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginRight: 8,
        alignItems: "center",
        minWidth: 68,
    },
    priceChipDate: { fontSize: 11, fontWeight: "600" },
    priceChipReturn: { fontSize: 9, marginTop: 1 },
    priceChipPrice: { fontSize: 15, fontWeight: "800", marginTop: 3 },
    dealRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        gap: 8,
    },
    dealCity: { fontSize: 13, fontWeight: "700" },
    dealMeta: { fontSize: 11, marginTop: 1 },
    dealPrice: { fontSize: 15, fontWeight: "800" },
    sightRow: { paddingVertical: 6 },
    sightName: { fontSize: 13, fontWeight: "700" },
    sightDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
    sightMeta: { fontSize: 10, marginTop: 3 },
    holidayRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, gap: 10 },
    holidayDate: { fontSize: 12, fontWeight: "800", width: 44 },
    holidayName: { fontSize: 12, fontWeight: "600" },
    holidayAlt: { fontSize: 10, marginTop: 1 },
    passportRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
    confirmation: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 12,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 10,
    },
    confirmationText: { fontSize: 13, fontWeight: "600", flex: 1 },
});
