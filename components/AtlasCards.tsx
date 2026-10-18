/**
 * Rich cards rendered from Atlas tool results.
 *
 * The server emits these deterministically from the tool output (see
 * `convex/atlasTools.ts`) rather than parsing them out of the model's prose, so
 * a card appears whenever its tool ran — the model can't forget to include it.
 *
 * Every card type, weather and restaurants included, is rendered from here so
 * the Atlas screen only has to hand over the `cards` array.
 */

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";

export interface AtlasCardData {
    type: string;
    data: any;
}

// Brand yellow is a fill colour, never a text colour: yellow text on a white
// card is unreadable. Accented values sit in a yellow pill with ink text.
const YELLOW = "#FFE500";
const INK = "#1A1A1A";

const currencySymbol = (currency?: string) =>
    !currency || currency === "EUR" ? "€" : `${currency} `;

/** "2026-11-04" → "4 Nov" in the UI language; falls back to the raw string. */
const shortDate = (value: string | number | undefined, lang: string) => {
    if (value == null || value === "") return "";
    const d = typeof value === "number" ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
    if (isNaN(d.getTime())) return String(value);
    try {
        return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
    } catch {
        return d.toISOString().slice(5, 10);
    }
};

// ───────────────────────────────── Shell ────────────────────────────────────

const CardShell = ({
    icon,
    title,
    subtitle,
    badge,
    children,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle?: string | null;
    badge?: string | null;
    children: React.ReactNode;
}) => {
    const { colors, isDarkMode } = useTheme();
    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    shadowOpacity: isDarkMode ? 0 : 0.05,
                },
            ]}
        >
            <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                    <Ionicons name={icon} size={16} color={INK} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                        {title}
                    </Text>
                    {!!subtitle && (
                        <Text style={[styles.cardSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    )}
                </View>
                {!!badge && (
                    <View style={[styles.badge, { backgroundColor: colors.lightGray }]}>
                        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{badge}</Text>
                    </View>
                )}
            </View>
            {children}
        </View>
    );
};

const Row = ({ label, value, last }: { label: string; value: string; last?: boolean }) => {
    const { colors } = useTheme();
    return (
        <View
            style={[
                styles.row,
                !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
        >
            <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
            <Text style={[styles.rowValue, { color: colors.text }]} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
};

const Disclaimer = ({ children }: { children: React.ReactNode }) => {
    const { colors } = useTheme();
    return (
        <View style={styles.disclaimerRow}>
            <Ionicons name="information-circle-outline" size={12} color={colors.textMuted} />
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>{children}</Text>
        </View>
    );
};

const BigStat = ({ value, label, color }: { value: string; label?: string | null; color?: string }) => {
    const { colors } = useTheme();
    return (
        <View style={styles.bigStatRow}>
            <Text style={[styles.bigStat, { color: color ?? colors.text }]}>{value}</Text>
            {!!label && <Text style={[styles.bigStatLabel, { color: colors.textMuted }]}>{label}</Text>}
        </View>
    );
};

/** A list row that is either static or a tappable link with a chevron. */
const ListRow = ({
    onPress,
    last,
    children,
}: {
    onPress?: () => void;
    last?: boolean;
    children: React.ReactNode;
}) => {
    const { colors } = useTheme();
    const style = [
        styles.listRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    ];
    if (!onPress) return <View style={style}>{children}</View>;
    return (
        <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.6}>
            {children}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
    );
};

// ───────────────────────────── Individual cards ─────────────────────────────

const WeatherCard = ({ data }: { data: any }) => {
    const { t } = useTranslation();

    // Choose gradient based on condition/time
    const getTheme = (cond: string, day: boolean) => {
        const condition = (cond || "").toLowerCase();
        let gradient = ["#4FACFE", "#00C6FB"]; // Default day
        let icon: keyof typeof Ionicons.glyphMap = day ? "sunny" : "moon";

        if (!day) gradient = ["#141E30", "#243B55"]; // Night

        if (condition.includes("rain") || condition.includes("drizzle") || condition.includes("shower")) {
            gradient = ["#373B44", "#4286f4"];
            icon = "rainy";
        } else if (condition.includes("cloud") || condition.includes("overcast") || condition.includes("fog")) {
            gradient = ["#8E9EAB", "#2C3E50"];
            icon = "cloudy";
        } else if (condition.includes("snow") || condition.includes("ice")) {
            gradient = ["#A8C0D0", "#274046"];
            icon = "snow";
        } else if (condition.includes("thunder") || condition.includes("storm")) {
            gradient = ["#141E30", "#434343"];
            icon = "thunderstorm";
        }

        return { gradientColors: gradient, iconName: icon };
    };

    const isDay = data?.isDay ?? true;
    const { gradientColors, iconName } = getTheme(data?.condition, isDay);
    const forecast: any[] = Array.isArray(data?.forecast) ? data.forecast.slice(0, 5) : [];

    return (
        <LinearGradient
            colors={gradientColors as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.weatherCard}
        >
            <View style={styles.weatherTop}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.weatherLocation} numberOfLines={1}>{data?.location}</Text>
                    <Text style={styles.weatherCondition}>{data?.condition}</Text>
                </View>
                <View style={styles.weatherIconWrap}>
                    <Ionicons name={iconName} size={30} color="#FFF" />
                </View>
            </View>

            <Text style={styles.weatherBigTemp}>{data?.temperature}°</Text>

            <View style={styles.weatherStats}>
                {data?.humidity != null && (
                    <View style={styles.weatherStatItem}>
                        <Ionicons name="water-outline" size={14} color="#FFF" />
                        <Text style={styles.weatherStatText}>{data.humidity}% {t("atlas.humidity")}</Text>
                    </View>
                )}
                {data?.windSpeed != null && (
                    <View style={styles.weatherStatItem}>
                        <Ionicons name="speedometer-outline" size={14} color="#FFF" />
                        <Text style={styles.weatherStatText}>{data.windSpeed} km/h {t("atlas.wind")}</Text>
                    </View>
                )}
            </View>

            {forecast.length > 0 && (
                <View style={styles.forecastRow}>
                    {forecast.map((day: any, i: number) => {
                        const { iconName: dayIcon } = getTheme(day.condition, true);
                        return (
                            <View key={i} style={styles.forecastItem}>
                                <Text style={styles.forecastDay}>{day.day}</Text>
                                <Ionicons name={dayIcon} size={18} color="#FFF" style={{ marginVertical: 6 }} />
                                <Text style={styles.forecastHigh}>{day.high}°</Text>
                                <Text style={styles.forecastLow}>{day.low}°</Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </LinearGradient>
    );
};

const RestaurantsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const restaurants: any[] = data?.restaurants ?? [];
    if (restaurants.length === 0) return null;

    return (
        <CardShell icon="restaurant" title={t("atlas.topRestaurants")} badge={t("atlas.tripAdvisor")}>
            {restaurants.map((r, i) => (
                <ListRow key={`${r.name}-${i}`} last={i === restaurants.length - 1}>
                    <View style={{ flex: 1 }}>
                        <View style={styles.titleLine}>
                            <Text style={[styles.itemTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                                {r.name}
                            </Text>
                            {!!r.priceRange && (
                                <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>{r.priceRange}</Text>
                            )}
                        </View>
                        <View style={styles.metaLine}>
                            {r.rating != null && (
                                <>
                                    <Ionicons name="star" size={11} color="#FF9500" />
                                    <Text style={[styles.itemMeta, { color: colors.text, fontWeight: "700" }]}>
                                        {r.rating}
                                    </Text>
                                    {r.reviewCount != null && (
                                        <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                                            ({Number(r.reviewCount).toLocaleString()})
                                        </Text>
                                    )}
                                </>
                            )}
                            {!!r.cuisine && (
                                <Text style={[styles.itemMeta, { color: colors.textMuted, flexShrink: 1 }]} numberOfLines={1}>
                                    {r.rating != null ? " · " : ""}{r.cuisine}
                                </Text>
                            )}
                        </View>
                        {!!r.address && (
                            <View style={styles.metaLine}>
                                <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                                <Text style={[styles.itemMeta, { color: colors.textMuted, flex: 1 }]} numberOfLines={1}>
                                    {r.address}
                                </Text>
                            </View>
                        )}
                    </View>
                </ListRow>
            ))}
        </CardShell>
    );
};

const FlightPricesCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const dates: any[] = data?.dates ?? [];
    const cheapest = dates.reduce(
        (min, d) => (typeof d?.price === "number" && d.price < min ? d.price : min),
        Infinity
    );

    // A month-scoped lookup ("fares in November") has to say which month, or it
    // reads as the default next-two-weeks teaser.
    let monthLabel = "";
    if (typeof data?.month === "string" && /^\d{4}-\d{2}$/.test(data.month)) {
        const [y, m] = data.month.split("-").map(Number);
        try {
            monthLabel = new Intl.DateTimeFormat(i18n.language, {
                month: "long",
                year: "numeric",
            }).format(new Date(Date.UTC(y, m - 1, 1)));
        } catch {
            monthLabel = data.month;
        }
    }

    const openSearch = (d: any) =>
        router.push({
            pathname: "/flights/search",
            params: {
                departureId: data.origin,
                arrivalId: data.destination,
                outboundDate: d.date,
                ...(d.returnDate ? { returnDate: d.returnDate } : {}),
                autoSearch: "1",
            },
        } as any);

    return (
        <CardShell
            icon="airplane"
            title={t("atlas.cards.cheapestDates")}
            subtitle={`${data.origin} → ${data.destination}${monthLabel ? ` · ${monthLabel}` : ""}`}
        >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {dates.map((d, i) => {
                    const best = d.price === cheapest;
                    return (
                        <TouchableOpacity
                            key={`${d.date}-${i}`}
                            activeOpacity={0.7}
                            onPress={() => openSearch(d)}
                            style={[
                                styles.priceChip,
                                best
                                    ? { backgroundColor: YELLOW, borderColor: YELLOW }
                                    : { backgroundColor: colors.lightGray, borderColor: colors.border },
                            ]}
                        >
                            <Text style={[styles.priceChipDate, { color: best ? INK : colors.textSecondary }]}>
                                {shortDate(d.date, i18n.language)}
                            </Text>
                            {!!d.returnDate && (
                                <Text style={[styles.priceChipReturn, { color: best ? INK : colors.textMuted }]}>
                                    ↩ {shortDate(d.returnDate, i18n.language)}
                                </Text>
                            )}
                            <Text style={[styles.priceChipPrice, { color: best ? INK : colors.text }]}>
                                {currencySymbol(data.currency)}
                                {d.price}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
            <Disclaimer>{t("atlas.cards.indicativeFares")}</Disclaimer>
        </CardShell>
    );
};

/** 445 → "7h 25m". */
const fmtDuration = (m: number | null | undefined) =>
    typeof m === "number" && m > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : "";

/** Live dated search (search_flights): itineraries with stops and layovers. */
const FlightOptionsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const options: any[] = data?.options ?? [];
    const returnOptions: any[] = data?.returnOptions ?? [];
    const summary = data?.summary ?? {};
    const sym = currencySymbol(data?.currency);

    const stopsLabel = (o: any) => {
        if (!o?.stops) return t("atlas.cards.nonstop");
        const via = (o.layovers ?? [])
            .map((l: any) =>
                [l.airport, fmtDuration(l.durationMinutes), l.overnight ? t("atlas.cards.overnight") : ""]
                    .filter(Boolean)
                    .join(" ")
            )
            .join(", ");
        const count = o.stops === 1 ? t("atlas.cards.oneStop") : t("atlas.cards.multiStops", { count: o.stops });
        return via ? `${count} · ${via}` : count;
    };

    const openSearch = () =>
        router.push({
            pathname: "/flights/search",
            params: {
                departureId: data.origin,
                arrivalId: data.destination,
                outboundDate: data.outboundDate,
                ...(data.returnDate ? { returnDate: data.returnDate } : {}),
                ...(data.adults ? { adults: String(data.adults) } : {}),
                autoSearch: "1",
            },
        } as any);

    const dates = [shortDate(data?.outboundDate, i18n.language), shortDate(data?.returnDate ?? "", i18n.language)]
        .filter(Boolean)
        .join(" – ");

    const nonstopLine =
        summary.nonstopCount > 0 && typeof summary.cheapestNonstop === "number"
            ? t("atlas.cards.nonstopFrom", { price: `${sym}${summary.cheapestNonstop}` })
            : data?.stopsFilter === "nonstop"
              ? null
              : t("atlas.cards.noNonstop");

    const Row = ({ o }: { o: any }) => (
        <View style={{ flex: 1 }}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                {o.departTime ?? "?"} → {o.arriveTime ?? "?"}
                {o.durationMinutes ? ` · ${fmtDuration(o.durationMinutes)}` : ""}
            </Text>
            <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={2}>
                {(o.airlines ?? []).join(" + ")}
                {" · "}
                {stopsLabel(o)}
                {o.selfTransfer ? ` · ${t("atlas.cards.selfTransfer")}` : ""}
            </Text>
        </View>
    );

    return (
        <CardShell
            icon="airplane"
            title={t("atlas.cards.flightOptions")}
            subtitle={`${data.origin} → ${data.destination}${dates ? ` · ${dates}` : ""}`}
        >
            {!!nonstopLine && (
                <Text style={[styles.flightSummary, { color: colors.textSecondary }]}>{nonstopLine}</Text>
            )}
            {options.map((o, i) => (
                <ListRow key={`o-${i}`} last={i === options.length - 1} onPress={openSearch}>
                    <Row o={o} />
                    {typeof o.price === "number" && (
                        <View style={styles.pricePill}>
                            <Text style={styles.pricePillText}>
                                {sym}
                                {o.price}
                            </Text>
                        </View>
                    )}
                </ListRow>
            ))}
            {returnOptions.length > 0 && (
                <>
                    <Text style={[styles.flightSection, { color: colors.textSecondary }]}>
                        {t("atlas.cards.returnFlights")}
                    </Text>
                    {returnOptions.map((o, i) => (
                        <ListRow key={`r-${i}`} last={i === returnOptions.length - 1}>
                            <Row o={o} />
                        </ListRow>
                    ))}
                </>
            )}
            <Disclaimer>{t("atlas.cards.liveFares")}</Disclaimer>
        </CardShell>
    );
};

/** Live stays (search_hotels / search_airbnb): Booking.com hotels or Airbnb homes for set dates. */
const StaysCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t, i18n } = useTranslation();
    const listings: any[] = data?.listings ?? [];
    const isAirbnb = data?.provider === "airbnb";
    const providerName = isAirbnb ? "Airbnb" : "Booking.com";
    const sym = currencySymbol(data?.currency);
    if (listings.length === 0) return null;

    const subtitle = [
        data?.destination,
        `${shortDate(data?.checkInDate, i18n.language)} – ${shortDate(data?.checkOutDate, i18n.language)}`,
        t("atlas.cards.nights", { count: data?.nights ?? 1 }),
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <CardShell
            icon={isAirbnb ? "home" : "bed"}
            title={isAirbnb ? t("atlas.cards.staysAirbnb") : t("atlas.cards.staysBooking")}
            subtitle={subtitle}
            badge={providerName}
        >
            {listings.map((l, i) => (
                <ListRow
                    key={`${l.name}-${i}`}
                    last={i === listings.length - 1}
                    onPress={l.url ? () => Linking.openURL(l.url).catch(() => {}) : undefined}
                >
                    {l.image ? (
                        <Image source={{ uri: l.image }} style={styles.stayThumb} />
                    ) : (
                        <View style={[styles.stayThumb, { backgroundColor: colors.lightGray }]} />
                    )}
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                            {l.name}
                        </Text>
                        <View style={styles.metaLine}>
                            {l.score != null && (
                                <>
                                    <Ionicons name="star" size={11} color="#FF9500" />
                                    <Text style={[styles.itemMeta, { color: colors.text, fontWeight: "700" }]}>
                                        {l.score}
                                        {isAirbnb ? "" : `/${l.scoreMax}`}
                                    </Text>
                                    {l.reviews != null && (
                                        <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                                            ({Number(l.reviews).toLocaleString()})
                                        </Text>
                                    )}
                                </>
                            )}
                            {!!l.badge && (
                                <Text style={[styles.itemMeta, { color: colors.textMuted, flexShrink: 1 }]} numberOfLines={1}>
                                    {l.score != null ? " · " : ""}
                                    {l.badge}
                                </Text>
                            )}
                        </View>
                        {l.freeCancellation === true && (
                            <Text style={[styles.itemMeta, { color: "#22A45D", fontWeight: "600" }]}>
                                {t("atlas.cards.freeCancellation")}
                            </Text>
                        )}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                        {l.total != null ? (
                            <View style={styles.pricePill}>
                                <Text style={styles.pricePillText}>
                                    {sym}
                                    {l.total}
                                </Text>
                            </View>
                        ) : null}
                        <Text style={[styles.itemMeta, { color: colors.textMuted, marginTop: 3 }]}>
                            {sym}
                            {l.perNight}
                            {t("atlas.cards.perNightShort")}
                        </Text>
                    </View>
                </ListRow>
            ))}
            <Disclaimer>{t("atlas.cards.staysDisclaimer", { provider: providerName })}</Disclaimer>
        </CardShell>
    );
};

const DealsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const router = useRouter();
    const deals: any[] = data?.deals ?? [];

    return (
        <CardShell
            icon="pricetag"
            title={t("atlas.cards.dealsFromYou")}
            subtitle={data.homeIata ? `${t("atlas.cards.from")} ${data.homeIata}` : null}
        >
            {deals.map((d, i) => (
                <ListRow
                    key={`${d.id ?? i}`}
                    last={i === deals.length - 1}
                    onPress={() =>
                        router.push({
                            pathname: "/flights/search",
                            params: { departureId: d.origin ?? data.homeIata, arrivalCityName: d.destinationCity },
                        } as any)
                    }
                >
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                            {d.destinationCity}
                            {d.destinationCountry ? `, ${d.destinationCountry}` : ""}
                        </Text>
                        {!!d.airline && (
                            <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={1}>
                                {d.airline}
                                {d.travelWindow ? ` · ${d.travelWindow}` : ""}
                            </Text>
                        )}
                    </View>
                    <View style={styles.pricePill}>
                        <Text style={styles.pricePillText}>
                            {currencySymbol(d.currency)}
                            {d.price}
                        </Text>
                    </View>
                </ListRow>
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
                <ListRow key={`${s.name}-${i}`} last={i === sights.length - 1}>
                    <View style={[styles.indexDot, { backgroundColor: colors.lightGray }]}>
                        <Text style={[styles.indexDotText, { color: colors.text }]}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]}>{s.name}</Text>
                        {!!s.description && (
                            <Text style={[styles.itemBody, { color: colors.textSecondary }]} numberOfLines={3}>
                                {s.description}
                            </Text>
                        )}
                        {(s.area || s.duration) && (
                            <Text style={[styles.itemMeta, { color: colors.textMuted, marginTop: 4 }]}>
                                {[s.area, s.duration ? `~${s.duration}h` : null].filter(Boolean).join(" · ")}
                            </Text>
                        )}
                    </View>
                </ListRow>
            ))}
        </CardShell>
    );
};

const SpendCard = ({ data }: { data: any }) => {
    const { t } = useTranslation();
    const rows: { label: string; value: string }[] = [];
    if (data.avgStayDays) rows.push({ label: t("atlas.cards.averageStay"), value: `${data.avgStayDays} ${t("atlas.cards.days")}` });
    if (data.estimatedTripCost) rows.push({ label: t("atlas.cards.estTripCost"), value: `€${data.estimatedTripCost}` });

    return (
        <CardShell icon="wallet" title={t("atlas.cards.typicalSpend")} subtitle={data.destination}>
            <BigStat value={`€${data.dailyEur}`} label={t("atlas.cards.perPersonPerDay")} />
            {rows.map((r, i) => (
                <Row key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
            ))}
            {data.level === "country" && <Disclaimer>{t("atlas.cards.countryLevelEstimate")}</Disclaimer>}
        </CardShell>
    );
};

const CurrencyCard = ({ data }: { data: any }) => {
    const { t } = useTranslation();

    return (
        <CardShell
            icon="swap-horizontal"
            title={t("atlas.cards.exchangeRate")}
            subtitle={data.asOf ? `${t("atlas.cards.asOf")} ${data.asOf}` : null}
        >
            <BigStat
                value={`${data.converted?.toFixed(2)} ${data.to}`}
                label={`= ${data.amount} ${data.from}`}
            />
            <Row label={t("atlas.cards.rate")} value={`1 ${data.from} = ${data.rate} ${data.to}`} last />
            <Disclaimer>{t("atlas.cards.ecbReference")}</Disclaimer>
        </CardShell>
    );
};

const CountryFactsCard = ({ data }: { data: any }) => {
    const { t } = useTranslation();
    const rows: { label: string; value: string }[] = [
        { label: t("atlas.cards.capital"), value: data.capital },
        { label: t("atlas.cards.currency"), value: data.currencies },
        { label: t("atlas.cards.languages"), value: data.languages },
    ];
    if (data.callingCode) rows.push({ label: t("atlas.cards.callingCode"), value: data.callingCode });
    rows.push({
        label: t("atlas.cards.drivesOn"),
        value:
            data.drivingSide === "left"
                ? t("atlas.cards.left")
                : data.drivingSide === "right"
                    ? t("atlas.cards.right")
                    : "—",
    });
    if (Array.isArray(data.timezones) && data.timezones.length > 0) {
        rows.push({ label: t("atlas.cards.timezone"), value: data.timezones.slice(0, 3).join(", ") });
    }

    return (
        <CardShell icon="earth" title={data.name} subtitle={data.region || null}>
            {rows.map((r, i) => (
                <Row key={r.label} label={r.label} value={r.value || "—"} last={i === rows.length - 1} />
            ))}
        </CardShell>
    );
};

const HolidaysCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t, i18n } = useTranslation();
    const holidays: any[] = (data?.holidays ?? []).slice(0, 8);

    return (
        <CardShell icon="calendar" title={t("atlas.cards.publicHolidays")} subtitle={`${data.country} · ${data.year}`}>
            {holidays.map((h, i) => (
                <ListRow key={`${h.date}-${i}`} last={i === holidays.length - 1}>
                    <View style={styles.datePill}>
                        <Text style={styles.datePillText}>{shortDate(h.date, i18n.language)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]}>{h.localName}</Text>
                        {h.name !== h.localName && (
                            <Text style={[styles.itemMeta, { color: colors.textMuted }]}>{h.name}</Text>
                        )}
                    </View>
                </ListRow>
            ))}
            <Disclaimer>{t("atlas.cards.holidayClosures")}</Disclaimer>
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
            : aqi <= 20 ? "#2FB38E"
                : aqi <= 40 ? "#6DB33F"
                    : aqi <= 60 ? "#C9B800"
                        : aqi <= 80 ? "#FF9B57"
                            : aqi <= 100 ? "#FF5050"
                                : "#960032";

    const rows: { label: string; value: string }[] = [];
    if (data.pm25 != null) rows.push({ label: "PM2.5", value: `${data.pm25} µg/m³` });
    if (data.pm10 != null) rows.push({ label: "PM10", value: `${data.pm10} µg/m³` });
    if (data.uvIndex != null) rows.push({ label: t("atlas.cards.uvIndex"), value: String(data.uvIndex) });

    return (
        <CardShell icon="leaf" title={t("atlas.cards.airQuality")} subtitle={data.location}>
            <BigStat value={aqi != null ? String(aqi) : "—"} label={data.band} color={bandColor} />
            {rows.map((r, i) => (
                <Row key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
            ))}
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
                last
            />
        </CardShell>
    );
};

const TripsCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const trips: any[] = data?.trips ?? [];

    return (
        <CardShell icon="map" title={t("atlas.cards.yourTrips")}>
            {trips.map((tr, i) => (
                <ListRow
                    key={`${tr.id ?? i}`}
                    last={i === trips.length - 1}
                    onPress={tr.id ? () => router.push(`/trip/${tr.id}` as any) : undefined}
                >
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                            {tr.destination}
                        </Text>
                        <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                            {shortDate(tr.startDate, i18n.language)} → {shortDate(tr.endDate, i18n.language)}
                        </Text>
                    </View>
                </ListRow>
            ))}
        </CardShell>
    );
};

const PassportCheckCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const travelers: any[] = data?.travelers ?? [];

    return (
        <CardShell icon="document-text" title={t("atlas.cards.passportCheck")} subtitle={data.referenceDate}>
            {travelers.map((p, i) => {
                const ok = !p.expired && p.meetsSixMonthRule;
                return (
                    <ListRow key={`${p.name}-${i}`} last={i === travelers.length - 1}>
                        <Ionicons
                            name={ok ? "checkmark-circle" : "alert-circle"}
                            size={20}
                            color={ok ? "#34C759" : "#FF9500"}
                        />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.itemTitle, { color: colors.text }]}>{p.name}</Text>
                            <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                                {p.nationality} · {t("atlas.cards.expires")} {p.expiry}
                            </Text>
                        </View>
                    </ListRow>
                );
            })}
            <Disclaimer>{t("atlas.cards.sixMonthRule")}</Disclaimer>
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
                <ListRow
                    key={`${g.slug ?? i}`}
                    last={i === guides.length - 1}
                    onPress={() =>
                        Linking.openURL(`https://planeraai.app/itinerary/${g.slug}`).catch(() => { })
                    }
                >
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]}>{g.title}</Text>
                        {!!g.summary && (
                            <Text style={[styles.itemBody, { color: colors.textSecondary }]} numberOfLines={2}>
                                {g.summary}
                            </Text>
                        )}
                    </View>
                </ListRow>
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
            <View style={styles.confirmationIcon}>
                <Ionicons name={icon} size={14} color="#FFF" />
            </View>
            <Text style={[styles.confirmationText, { color: colors.text }]}>{label}</Text>
        </View>
    );
};

// ─────────────────────────────── Dispatcher ─────────────────────────────────

export const AtlasCardRenderer = ({ card }: { card: AtlasCardData }) => {
    const { t } = useTranslation();

    switch (card.type) {
        case "weather":
            return <WeatherCard data={card.data} />;
        case "restaurants":
            return <RestaurantsCard data={card.data} />;
        case "flightPrices":
            return <FlightPricesCard data={card.data} />;
        case "flightOptions":
            return <FlightOptionsCard data={card.data} />;
        case "stays":
            return <StaysCard data={card.data} />;
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
        default:
            return null;
    }
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 20,
        borderWidth: 1,
        padding: 14,
        marginBottom: 12,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        elevation: 1,
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 10,
        gap: 10,
    },
    cardIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: YELLOW,
        alignItems: "center",
        justifyContent: "center",
    },
    cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
    cardSubtitle: { fontSize: 12, marginTop: 1 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingVertical: 9,
        gap: 12,
    },
    rowLabel: { fontSize: 13, flexShrink: 0 },
    rowValue: { fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
    listRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        gap: 10,
    },
    titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
    metaLine: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
    itemTitle: { fontSize: 14, fontWeight: "700" },
    itemBody: { fontSize: 13, marginTop: 2, lineHeight: 18 },
    itemMeta: { fontSize: 12, marginTop: 1 },
    indexDot: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "flex-start",
        marginTop: 1,
    },
    indexDotText: { fontSize: 12, fontWeight: "800" },
    bigStatRow: { alignItems: "flex-start", paddingTop: 2, paddingBottom: 8 },
    bigStat: { fontSize: 34, fontWeight: "800", letterSpacing: -1 },
    bigStatSmall: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
    bigStatLabel: { fontSize: 13, marginTop: 2 },
    disclaimerRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 10 },
    disclaimer: { fontSize: 11, lineHeight: 15, flex: 1 },
    priceChip: {
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        alignItems: "center",
        minWidth: 76,
    },
    priceChipDate: { fontSize: 12, fontWeight: "700" },
    priceChipReturn: { fontSize: 10, marginTop: 1 },
    priceChipPrice: { fontSize: 17, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },
    stayThumb: { width: 56, height: 56, borderRadius: 12, alignSelf: "flex-start" },
    pricePill: {
        backgroundColor: YELLOW,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    pricePillText: { color: INK, fontSize: 14, fontWeight: "800" },
    flightSummary: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
    flightSection: { fontSize: 12, fontWeight: "700", marginTop: 10, textTransform: "uppercase", letterSpacing: 0.4 },
    datePill: {
        backgroundColor: YELLOW,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        minWidth: 56,
        alignItems: "center",
    },
    datePillText: { color: INK, fontSize: 12, fontWeight: "800" },
    confirmation: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 12,
    },
    confirmationIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: "#34C759",
        alignItems: "center",
        justifyContent: "center",
    },
    confirmationText: { fontSize: 13, fontWeight: "600", flex: 1 },
    // Weather
    weatherCard: {
        borderRadius: 22,
        padding: 18,
        marginBottom: 12,
        overflow: "hidden",
    },
    weatherTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    weatherLocation: { color: "#FFF", fontSize: 17, fontWeight: "700" },
    weatherCondition: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2, textTransform: "capitalize" },
    weatherIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: "rgba(255,255,255,0.18)",
        alignItems: "center",
        justifyContent: "center",
    },
    weatherBigTemp: { color: "#FFF", fontSize: 56, fontWeight: "200", marginTop: 4, letterSpacing: -2 },
    weatherStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    weatherStatItem: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.18)",
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 12,
        gap: 5,
    },
    weatherStatText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
    forecastRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(255,255,255,0.35)",
    },
    forecastItem: { alignItems: "center", flex: 1 },
    forecastDay: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },
    forecastHigh: { color: "#FFF", fontSize: 14, fontWeight: "700" },
    forecastLow: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: "500" },
});
