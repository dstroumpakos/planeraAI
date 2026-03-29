import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { INTERESTS } from "@/lib/data";
import { useTheme } from "@/lib/ThemeContext";
import { useAuthenticatedMutation, useToken } from "@/lib/useAuthenticatedMutation";
import AIConsentModal from "@/components/AIConsentModal";
import { useTranslation } from "react-i18next";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";

const LOCAL_EXPERIENCES = [
  { id: "local-food", labelKey: "createTrip.localFood", icon: "restaurant" as const },
  { id: "markets", labelKey: "createTrip.traditionalMarkets", icon: "storefront" as const },
  { id: "hidden-gems", labelKey: "createTrip.hiddenGems", icon: "compass" as const },
  { id: "workshops", labelKey: "createTrip.culturalWorkshops", icon: "color-palette" as const },
  { id: "nature", labelKey: "createTrip.natureOutdoor", icon: "leaf" as const },
  { id: "nightlife", labelKey: "createTrip.nightlife", icon: "wine" as const },
  { id: "neighborhoods", labelKey: "createTrip.neighborhoodWalks", icon: "walk" as const },
  { id: "festivals", labelKey: "createTrip.festivals", icon: "calendar" as const },
];

export default function DealTripScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, isDarkMode } = useTheme();
  const { token } = useToken();
  const { t, i18n } = useTranslation();

  // Parse deal data from params
  const dealId = params.dealId as string;
  const origin = params.origin as string;
  const originCity = params.originCity as string;
  const destination = params.destination as string;
  const destinationCity = params.destinationCity as string;
  const airline = params.airline as string;
  const outboundDate = params.outboundDate as string;
  const outboundDeparture = params.outboundDeparture as string;
  const outboundArrival = params.outboundArrival as string;
  const returnDate = params.returnDate as string | undefined;
  const returnDeparture = params.returnDeparture as string | undefined;
  const returnArrival = params.returnArrival as string | undefined;
  const returnAirline = params.returnAirline as string | undefined;
  const price = params.price as string;
  const totalPrice = params.totalPrice as string | undefined;
  const currency = params.currency as string;
  const outboundStops = parseInt(params.outboundStops as string) || 0;
  const returnStops = parseInt(params.returnStops as string) || 0;
  const outboundSegments = params.outboundSegments ? JSON.parse(params.outboundSegments as string) : null;
  const returnSegments = params.returnSegments ? JSON.parse(params.returnSegments as string) : null;

  const [budgetTotal, setBudgetTotal] = useState("");
  const [travelerCount, setTravelerCount] = useState(1);
  const [interests, setInterests] = useState<string[]>([]);
  const [localExperiences, setLocalExperiences] = useState<string[]>([]);
  const [skipHotel, setSkipHotel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAiConsentModal, setShowAiConsentModal] = useState(false);

  const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" });
  const userPlan = useQuery(api.users.getPlan as any, { token: token || "skip" });
  const createFromDeal = useAuthenticatedMutation(api.trips.createFromDeal as any);
  const updateAiConsent = useMutation(api.users.updateAiConsent as any);
  const markGuideSeen = useMutation(api.users.markFirstTripGuideSeen as any);

  const tripDays = returnDate
    ? Math.ceil((new Date(returnDate).getTime() - new Date(outboundDate).getTime()) / (24 * 60 * 60 * 1000))
    : 3;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      weekday: "short",
    });
  };

  const getCurrencySymbol = (curr: string) => {
    const symbols: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", SEK: "kr", NOK: "kr", DKK: "kr" };
    return symbols[curr] || curr;
  };

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const toggleLocalExperience = (id: string) => {
    setLocalExperiences((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (options?: { skipConsentCheck?: boolean }) => {
    // AI consent check
    if (!options?.skipConsentCheck && userSettings && userSettings.aiDataConsent !== true) {
      setShowAiConsentModal(true);
      return;
    }

    if (!budgetTotal || isNaN(Number(budgetTotal)) || Number(budgetTotal) <= 0) {
      Alert.alert(t("common.error"), t("createTrip.validBudget"));
      return;
    }

    if (interests.length === 0) {
      Alert.alert(t("common.error"), t("dealTrip.selectInterests", { defaultValue: "Please select at least one interest" }));
      return;
    }

    // Credit check
    if (userPlan) {
      const isSubActive = userPlan.isSubscriptionActive === true;
      const tripCredits = userPlan.tripCredits ?? 0;
      const tripsGenerated = userPlan.tripsGenerated ?? 0;
      const hasFreeTrial = tripsGenerated < 1;

      if (!isSubActive && tripCredits <= 0 && !hasFreeTrial) {
        Alert.alert(
          t("createTrip.noTripCredits"),
          t("createTrip.noCreditsAlert"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("createTrip.viewOptions"), onPress: () => router.push("/subscription") },
          ]
        );
        return;
      }
    }

    setLoading(true);

    try {
      const tripId = await createFromDeal({
        dealId: dealId as Id<"lowFareRadar">,
        budgetTotal: Number(budgetTotal),
        travelerCount,
        interests,
        localExperiences,
        skipHotel,
        language: i18n.language || "en",
      });

      // Mark first-trip guide as seen so it never shows again
      if (token) {
        markGuideSeen({ token }).catch(() => {});
      }
      router.push(`/trip/${tripId}`);
      setTimeout(() => setLoading(false), 500);
    } catch (error: any) {
      console.error("Error creating deal trip:", error);
      const cleanMessage = (error.message || "Failed to create trip")
        .replace("Uncaught Error: ", "")
        .replace("Error: ", "");
      Alert.alert(t("common.error"), cleanMessage);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("dealTrip.title", { defaultValue: "Plan Your Trip" })}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Flight Deal Card (locked) */}
        <View style={[styles.dealCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.dealBadgeRow}>
            <View style={[styles.dealBadge, { backgroundColor: colors.primary }]}>
              <Ionicons name="pulse" size={12} color="#000" />
              <Text style={styles.dealBadgeText}>
                {t("dealTrip.fromRadar", { defaultValue: "Low Fare Radar" })}
              </Text>
            </View>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
          </View>

          {/* Outbound Flight */}
          <Text style={[styles.flightLabel, { color: colors.textMuted }]}>
            {t("dealTrip.outbound", { defaultValue: "Outbound" })}
          </Text>
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <Text style={[styles.iataCode, { color: colors.text }]}>{origin}</Text>
              <Text style={[styles.cityLabel, { color: colors.textMuted }]}>{originCity}</Text>
            </View>
            <View style={styles.routeLine}>
              <View style={[styles.routeDash, { backgroundColor: colors.border }]} />
              <Ionicons name="airplane" size={18} color={colors.primary} />
              <View style={[styles.routeDash, { backgroundColor: colors.border }]} />
            </View>
            <View style={[styles.routePoint, { alignItems: "flex-end" }]}>
              <Text style={[styles.iataCode, { color: colors.text }]}>{destination}</Text>
              <Text style={[styles.cityLabel, { color: colors.textMuted }]}>{destinationCity}</Text>
            </View>
          </View>
          <View style={styles.flightDetails}>
            <View style={styles.flightDetailItem}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.flightDetailText, { color: colors.text }]}>
                {formatDate(outboundDate)}
              </Text>
            </View>
            <View style={styles.flightDetailItem}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.flightDetailText, { color: colors.text }]}>
                {outboundDeparture} → {outboundArrival}
              </Text>
            </View>
            <View style={styles.flightDetailItem}>
              <Ionicons name="business-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.flightDetailText, { color: colors.text }]}>{airline}</Text>
            </View>
            {outboundStops > 0 && (
              <View style={styles.flightDetailItem}>
                <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                <Text style={[styles.flightDetailText, { color: colors.primary, fontWeight: "600" }]}>
                  {outboundStops} stop{outboundStops > 1 ? "s" : ""}
                  {outboundSegments ? ` via ${outboundSegments.slice(0, -1).map((s: any) => s.arrivalAirport).join(", ")}` : ""}
                </Text>
              </View>
            )}
          </View>

          {/* Return Flight */}
          {returnDate && returnDeparture && returnArrival ? (
            <>
              <View style={[styles.flightDivider, { borderColor: colors.border }]} />
              <Text style={[styles.flightLabel, { color: colors.textMuted }]}>
                {t("dealTrip.return", { defaultValue: "Return" })}
              </Text>
              <View style={styles.routeRow}>
                <View style={styles.routePoint}>
                  <Text style={[styles.iataCode, { color: colors.text }]}>{destination}</Text>
                  <Text style={[styles.cityLabel, { color: colors.textMuted }]}>{destinationCity}</Text>
                </View>
                <View style={styles.routeLine}>
                  <View style={[styles.routeDash, { backgroundColor: colors.border }]} />
                  <Ionicons name="airplane" size={18} color={colors.primary} style={{ transform: [{ scaleX: -1 }] }} />
                  <View style={[styles.routeDash, { backgroundColor: colors.border }]} />
                </View>
                <View style={[styles.routePoint, { alignItems: "flex-end" }]}>
                  <Text style={[styles.iataCode, { color: colors.text }]}>{origin}</Text>
                  <Text style={[styles.cityLabel, { color: colors.textMuted }]}>{originCity}</Text>
                </View>
              </View>
              <View style={styles.flightDetails}>
                <View style={styles.flightDetailItem}>
                  <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.flightDetailText, { color: colors.text }]}>
                    {formatDate(returnDate)}
                  </Text>
                </View>
                <View style={styles.flightDetailItem}>
                  <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.flightDetailText, { color: colors.text }]}>
                    {returnDeparture} → {returnArrival}
                  </Text>
                </View>
                <View style={styles.flightDetailItem}>
                  <Ionicons name="business-outline" size={14} color={colors.textMuted} />
                  <Text style={[styles.flightDetailText, { color: colors.text }]}>
                    {returnAirline || airline}
                  </Text>
                </View>
                {returnStops > 0 && (
                  <View style={styles.flightDetailItem}>
                    <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                    <Text style={[styles.flightDetailText, { color: colors.primary, fontWeight: "600" }]}>
                      {returnStops} stop{returnStops > 1 ? "s" : ""}
                      {returnSegments ? ` via ${returnSegments.slice(0, -1).map((s: any) => s.arrivalAirport).join(", ")}` : ""}
                    </Text>
                  </View>
                )}
              </View>
            </>
          ) : null}

          <View style={styles.priceRow}>
            <View>
              <Text style={[styles.dealPrice, { color: colors.text }]}>
                {getCurrencySymbol(currency)}{price}
                <Text style={[styles.dealPriceNote, { color: colors.textMuted }]}> /pp</Text>
              </Text>
              {totalPrice && (
                <Text style={[styles.dealPriceNote, { color: colors.textMuted, marginTop: 2 }]}>
                  {getCurrencySymbol(currency)}{totalPrice} {t("dealTrip.total", { defaultValue: "total" })}
                </Text>
              )}
            </View>
            <Text style={[styles.dealPriceNote, { color: colors.textMuted }]}>
              {tripDays} {t("dealTrip.days", { defaultValue: "days" })}
            </Text>
          </View>
        </View>

        {/* Budget */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            {t("createTrip.budget", { defaultValue: "BUDGET" })}
          </Text>
          <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.currencyPrefix, { color: colors.text }]}>€</Text>
            <TextInput
              style={[styles.budgetInput, { color: colors.text }]}
              value={budgetTotal}
              onChangeText={setBudgetTotal}
              placeholder={t("createTrip.totalBudget", { defaultValue: "Total budget" })}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>
          {budgetTotal && Number(budgetTotal) > 0 && travelerCount > 1 && (
            <Text style={[styles.budgetHint, { color: colors.textMuted }]}>
              €{Math.round(Number(budgetTotal) / travelerCount)} {t("createTrip.perPerson", { defaultValue: "per person" })}
            </Text>
          )}
        </View>

        {/* Travelers */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            {t("createTrip.travelers", { defaultValue: "TRAVELERS" })}
          </Text>
          <View style={styles.travelerRow}>
            <TouchableOpacity
              style={[styles.travelerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setTravelerCount(Math.max(1, travelerCount - 1))}
            >
              <Ionicons name="remove" size={20} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.travelerCount, { color: colors.text }]}>{travelerCount}</Text>
            <TouchableOpacity
              style={[styles.travelerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setTravelerCount(Math.min(12, travelerCount + 1))}
            >
              <Ionicons name="add" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Interests */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            {t("createTrip.interests", { defaultValue: "INTERESTS" })}
          </Text>
          <View style={styles.chipGrid}>
            {INTERESTS.map((interest) => {
              const selected = interests.includes(interest);
              return (
                <TouchableOpacity
                  key={interest}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => toggleInterest(interest)}
                >
                  <Text style={[styles.chipText, { color: selected ? "#000" : colors.text }]}>
                    {t(`interests.${interest.toLowerCase()}`, { defaultValue: interest })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Local Experiences */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
            {t("createTrip.localExperiences", { defaultValue: "LOCAL EXPERIENCES" })}
          </Text>
          <View style={styles.chipGrid}>
            {LOCAL_EXPERIENCES.map((exp) => {
              const selected = localExperiences.includes(exp.id);
              return (
                <TouchableOpacity
                  key={exp.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => toggleLocalExperience(exp.id)}
                >
                  <Ionicons name={exp.icon} size={14} color={selected ? "#000" : colors.text} />
                  <Text style={[styles.chipText, { color: selected ? "#000" : colors.text }]}>
                    {t(exp.labelKey, { defaultValue: exp.id })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Spacer for bottom button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: colors.text }, loading && styles.generateBtnDisabled]}
          onPress={() => handleSubmit()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <View style={[styles.sparkleIcon, { backgroundColor: colors.primary }]}>
                <Ionicons name="sparkles" size={18} color="#000" />
              </View>
              <Text style={[styles.generateBtnText, { color: colors.background }]}>
                {t("dealTrip.generate", { defaultValue: "Generate Itinerary" })}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* AI Consent Modal */}
      <AIConsentModal
        visible={showAiConsentModal}
        colors={colors}
        onAccept={async () => {
          try {
            await updateAiConsent({ token: token || "", aiDataConsent: true });
            setShowAiConsentModal(false);
            handleSubmit({ skipConsentCheck: true });
          } catch (e) {
            console.error("Failed to save AI consent:", e);
          }
        }}
        onDecline={() => setShowAiConsentModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  dealCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  dealBadgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  dealBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  dealBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#000",
    textTransform: "uppercase",
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  routePoint: {
    alignItems: "flex-start",
    flex: 1,
  },
  iataCode: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cityLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  routeLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  routeDash: {
    height: 1,
    width: 24,
  },
  flightLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  flightDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  flightDetails: {
    gap: 6,
    marginBottom: 12,
  },
  flightDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flightDetailText: {
    fontSize: 13,
    fontWeight: "500",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  dealPrice: {
    fontSize: 24,
    fontWeight: "800",
  },
  dealPriceNote: {
    fontSize: 13,
    fontWeight: "500",
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 52,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: "700",
    marginRight: 8,
  },
  budgetInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
  },
  budgetHint: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 6,
    marginLeft: 4,
  },
  travelerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  travelerBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  travelerCount: {
    fontSize: 24,
    fontWeight: "800",
    minWidth: 30,
    textAlign: "center",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  toggleInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 18,
    borderRadius: 18,
  },
  generateBtnDisabled: {
    opacity: 0.7,
  },
  generateBtnText: {
    fontSize: 17,
    fontWeight: "700",
  },
  sparkleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
