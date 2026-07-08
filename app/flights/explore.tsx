import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useDestinationImage } from "@/lib/useImages";
import { useExploreDestinations } from "@/hooks/useExploreDestinations";
import { AIRPORTS, glForIata } from "@/lib/airports";
import type {
  ExploreDestination,
  ExploreInterest,
  ExploreQuery,
} from "@/types/flights";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_GAP = 14;
const H_PADDING = 20;
const CARD_WIDTH = (SCREEN_WIDTH - H_PADDING * 2 - CARD_GAP) / 2;

function currencySymbol(currency: string) {
  const symbols: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
  };
  return symbols[currency] || `${currency} `;
}

// Budget quick-filters (upper bound on the indicative price). `undefined` = any.
const BUDGET_OPTIONS: { key: string; max?: number }[] = [
  { key: "any", max: undefined },
  { key: "u150", max: 150 },
  { key: "u300", max: 300 },
  { key: "u600", max: 600 },
];

const INTEREST_OPTIONS: { key: ExploreInterest; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "popular", icon: "flame" },
  { key: "beaches", icon: "sunny" },
  { key: "outdoors", icon: "leaf" },
  { key: "museums", icon: "business" },
  { key: "history", icon: "book" },
  { key: "skiing", icon: "snow" },
];

/** One destination card — fetches its own Unsplash image lazily. */
function ExploreCard({
  dest,
  currency,
  onPress,
}: {
  dest: ExploreDestination;
  currency: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { image, loading } = useDestinationImage(dest.name);
  const imageUri = image?.url || dest.thumbnail || null;
  const city = dest.name.split(",")[0].trim();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      <View style={styles.cardImageWrap}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.cardImageFallback, { backgroundColor: colors.secondary }]}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="image-outline" size={22} color={colors.textMuted} />
            )}
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.55)"]}
          style={styles.cardImageGradient}
          pointerEvents="none"
        />
        {dest.price != null && (
          <View style={[styles.priceBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.priceBadgeText}>
              {currencySymbol(currency)}
              {Math.round(dest.price)}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardCity, { color: colors.text }]} numberOfLines={1}>
          {city}
        </Text>
        {dest.country ? (
          <Text style={[styles.cardCountry, { color: colors.textMuted }]} numberOfLines={1}>
            {dest.country}
          </Text>
        ) : null}
        <View style={styles.cardMetaRow}>
          {dest.stops != null && (
            <View style={styles.cardMetaItem}>
              <Ionicons name="git-branch-outline" size={11} color={colors.textMuted} />
              <Text style={[styles.cardMetaText, { color: colors.textMuted }]}>
                {dest.stops === 0 ? "Direct" : `${dest.stops}`}
              </Text>
            </View>
          )}
          {dest.flightDuration ? (
            <View style={styles.cardMetaItem}>
              <Ionicons name="time-outline" size={11} color={colors.textMuted} />
              <Text style={[styles.cardMetaText, { color: colors.textMuted }]} numberOfLines={1}>
                {dest.flightDuration}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ExploreScreen() {
  const { colors, isDarkMode } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { token } = useToken();
  const params = useLocalSearchParams<{ homeIata?: string; currency?: string }>();

  const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" });
  const settingsHomeIata = useMemo(() => {
    const raw = (userSettings as any)?.homeAirport as string | undefined;
    if (!raw) return undefined;
    const matches = raw.toUpperCase().match(/\b([A-Z]{3})\b/g);
    return matches ? matches[matches.length - 1] : undefined;
  }, [userSettings]);

  const currency = (params.currency || "EUR").toUpperCase();

  const [origin, setOrigin] = useState<string | undefined>(
    (params.homeIata || undefined)?.toUpperCase()
  );
  const [interest, setInterest] = useState<ExploreInterest | null>(null);
  const [budgetKey, setBudgetKey] = useState<string>("any");
  const [directOnly, setDirectOnly] = useState(false);

  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [originSearch, setOriginSearch] = useState("");

  const { data, loading, error, exploreDestinations } = useExploreDestinations();

  // Default the origin to the user's saved home airport once settings load.
  useEffect(() => {
    if (!origin && settingsHomeIata) setOrigin(settingsHomeIata);
  }, [origin, settingsHomeIata]);

  const runExplore = useCallback(() => {
    if (!origin) return;
    const maxPrice = BUDGET_OPTIONS.find((b) => b.key === budgetKey)?.max;
    const input: ExploreQuery = {
      departureId: origin,
      currency,
      gl: glForIata(origin),
      interests: interest ?? undefined,
      stops: directOnly ? "nonstop" : undefined,
      maxPrice,
    };
    exploreDestinations(input).catch(() => {
      // error is surfaced via `error` state
    });
  }, [origin, currency, interest, budgetKey, directOnly, exploreDestinations]);

  // Re-run whenever the origin or any filter changes.
  useEffect(() => {
    if (origin) runExplore();
  }, [origin, interest, budgetKey, directOnly]);

  const originAirport = useMemo(
    () => AIRPORTS.find((a) => a.code === origin),
    [origin]
  );

  const filteredAirports = useMemo(() => {
    const q = originSearch.trim().toLowerCase();
    const list = q
      ? AIRPORTS.filter(
          (a) =>
            a.city.toLowerCase().includes(q) ||
            a.code.toLowerCase().includes(q) ||
            a.country.toLowerCase().includes(q)
        )
      : AIRPORTS;
    return list.slice(0, 60);
  }, [originSearch]);

  const openDestination = (dest: ExploreDestination) => {
    router.push({
      pathname: "/destination-preview",
      params: { destination: dest.name },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {t("explore.title", { defaultValue: "Where can I go?" })}
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
              {t("explore.subtitle", { defaultValue: "Discover destinations you can afford" })}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Origin selector */}
          <TouchableOpacity
            style={[styles.originSelector, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setOriginModalOpen(true)}
            activeOpacity={0.85}
          >
            <View style={[styles.originIcon, { backgroundColor: colors.primary }]}>
              <Ionicons name="airplane" size={18} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.originLabel, { color: colors.textMuted }]}>
                {t("explore.from", { defaultValue: "Flying from" })}
              </Text>
              <Text style={[styles.originValue, { color: colors.text }]} numberOfLines={1}>
                {originAirport
                  ? `${originAirport.city} (${originAirport.code})`
                  : origin || t("explore.pickOrigin", { defaultValue: "Pick an airport" })}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Interest chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <TouchableOpacity
              style={[
                styles.chip,
                {
                  backgroundColor: interest === null ? colors.primary : colors.card,
                  borderColor: interest === null ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setInterest(null)}
            >
              <Text style={[styles.chipText, { color: interest === null ? "#000" : colors.text }]}>
                {t("explore.interestAll", { defaultValue: "All" })}
              </Text>
            </TouchableOpacity>
            {INTEREST_OPTIONS.map((opt) => {
              const active = interest === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setInterest(active ? null : opt.key)}
                >
                  <Ionicons name={opt.icon} size={13} color={active ? "#000" : colors.primary} />
                  <Text style={[styles.chipText, { color: active ? "#000" : colors.text }]}>
                    {t(`explore.interest_${opt.key}`, { defaultValue: opt.key })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Budget + direct chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {BUDGET_OPTIONS.map((b) => {
              const active = budgetKey === b.key;
              const label =
                b.max == null
                  ? t("explore.budgetAny", { defaultValue: "Any budget" })
                  : `≤ ${currencySymbol(currency)}${b.max}`;
              return (
                <TouchableOpacity
                  key={b.key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setBudgetKey(b.key)}
                >
                  <Text style={[styles.chipText, { color: active ? "#000" : colors.text }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[
                styles.chip,
                {
                  backgroundColor: directOnly ? colors.primary : colors.card,
                  borderColor: directOnly ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setDirectOnly((v) => !v)}
            >
              <Ionicons
                name="arrow-forward"
                size={13}
                color={directOnly ? "#000" : colors.primary}
              />
              <Text style={[styles.chipText, { color: directOnly ? "#000" : colors.text }]}>
                {t("explore.directOnly", { defaultValue: "Direct" })}
              </Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Results */}
          {loading ? (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.stateText, { color: colors.textMuted }]}>
                {t("explore.loading", { defaultValue: "Finding places you can go…" })}
              </Text>
            </View>
          ) : error ? (
            <View style={styles.stateBox}>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.textMuted} />
              <Text style={[styles.stateText, { color: colors.textMuted }]}>{error}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: colors.primary }]}
                onPress={runExplore}
              >
                <Text style={styles.retryBtnText}>
                  {t("explore.retry", { defaultValue: "Try again" })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : data && data.length > 0 ? (
            <>
              <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
                {t("explore.priceDisclaimer", {
                  defaultValue: "Prices are estimates — tap a place to see live fares.",
                })}
              </Text>
              <View style={styles.grid}>
                {data.map((dest, i) => (
                  <ExploreCard
                    key={`${dest.name}-${i}`}
                    dest={dest}
                    currency={currency}
                    onPress={() => openDestination(dest)}
                  />
                ))}
              </View>
            </>
          ) : (
            <View style={styles.stateBox}>
              <Ionicons name="search-outline" size={30} color={colors.textMuted} />
              <Text style={[styles.stateText, { color: colors.textMuted }]}>
                {origin
                  ? t("explore.empty", {
                      defaultValue: "No destinations found. Try a wider budget.",
                    })
                  : t("explore.needOrigin", {
                      defaultValue: "Pick a departure airport to start exploring.",
                    })}
              </Text>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Origin picker modal */}
      <Modal
        visible={originModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOriginModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setOriginModalOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("explore.selectOrigin", { defaultValue: "Select departure airport" })}
            </Text>
            <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder={t("explore.searchAirports", { defaultValue: "Search city or code…" })}
                placeholderTextColor={colors.textMuted}
                value={originSearch}
                onChangeText={setOriginSearch}
                autoCorrect={false}
                autoCapitalize="characters"
              />
            </View>
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {filteredAirports.map((a) => {
                const active = a.code === origin;
                return (
                  <TouchableOpacity
                    key={a.code}
                    style={[styles.originRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setOrigin(a.code);
                      setOriginModalOpen(false);
                      setOriginSearch("");
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.originRowCity, { color: active ? colors.primary : colors.text }]} numberOfLines={1}>
                        {a.city} <Text style={{ color: colors.textMuted }}>({a.code})</Text>
                      </Text>
                      <Text style={[styles.originRowCountry, { color: colors.textMuted }]} numberOfLines={1}>
                        {a.country}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
              {filteredAirports.length === 0 && (
                <Text style={[styles.stateText, { color: colors.textMuted, paddingVertical: 24 }]}>
                  {t("explore.noAirports", { defaultValue: "No airports match your search" })}
                </Text>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: H_PADDING,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  headerTitle: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, fontWeight: "500", marginTop: 2 },
  scrollContent: { paddingHorizontal: H_PADDING, paddingTop: 4 },
  originSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  originIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  originLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  originValue: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  chipRow: { flexDirection: "row", gap: 8, paddingVertical: 2, paddingRight: 8, marginBottom: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "700" },
  disclaimer: { fontSize: 12, fontWeight: "500", marginBottom: 12, marginTop: 2 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardImageWrap: { width: "100%", height: CARD_WIDTH * 0.72, position: "relative" },
  cardImage: { width: "100%", height: "100%" },
  cardImageFallback: { justifyContent: "center", alignItems: "center" },
  cardImageGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  priceBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  priceBadgeText: { fontSize: 13, fontWeight: "900", color: "#000" },
  cardBody: { padding: 12 },
  cardCity: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  cardCountry: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  cardMetaText: { fontSize: 11, fontWeight: "600" },
  stateBox: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 14 },
  stateText: { fontSize: 14, fontWeight: "600", textAlign: "center", paddingHorizontal: 30 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14 },
  retryBtnText: { fontSize: 14, fontWeight: "800", color: "#000" },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    maxHeight: "75%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.35)",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 14 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: "600", padding: 0 },
  modalList: { flexGrow: 0 },
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  originRowCity: { fontSize: 15, fontWeight: "700" },
  originRowCountry: { fontSize: 12, fontWeight: "500", marginTop: 2 },
});
