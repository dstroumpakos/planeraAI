import React, { useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { useFlightBookingOptions } from "@/hooks/useFlightBookingOptions";
import type { NormalizedFlightOption } from "@/types/flights";
import { FlightResultCard } from "./FlightResultCard";
import { BookingOptionCard } from "./BookingOptionCard";

interface BookingSearchContext {
  departureId?: string;
  arrivalId?: string;
  outboundDate?: string;
  returnDate?: string;
  adults?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  flightOption: NormalizedFlightOption | null;
  /** In a round-trip flow: the selected outbound leg, shown above the return. */
  outboundOption?: NormalizedFlightOption | null;
  /** Route + dates from the search — required by SerpApi's booking endpoint. */
  searchContext?: BookingSearchContext;
  currency?: string;
  /**
   * When provided (round-trip flow with both legs chosen), shows a primary
   * "Create trip with these flights" CTA that builds an AI itinerary from the
   * selected flights — same handoff as the results list.
   */
  onCreateTrip?: () => void;
}

export const BookingOptionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  flightOption,
  outboundOption,
  searchContext,
  currency = "EUR",
  onCreateTrip,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { bookingOptions, loading, error, getBookingOptions, reset } =
    useFlightBookingOptions();
  const travelers = searchContext?.adults ?? 1;
  const multiTraveler = travelers > 1;

  useEffect(() => {
    if (visible && flightOption?.bookingToken) {
      getBookingOptions({
        bookingToken: flightOption.bookingToken,
        currency,
        departureId: searchContext?.departureId,
        arrivalId: searchContext?.arrivalId,
        outboundDate: searchContext?.outboundDate,
        returnDate: searchContext?.returnDate,
        adults: searchContext?.adults,
      }).catch(() => {});
    }
    if (!visible) reset();
  }, [visible, flightOption?.bookingToken, currency, searchContext, getBookingOptions, reset]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    title: { color: colors.text, fontWeight: "700", fontSize: 18, flex: 1 },
    close: { color: colors.text, fontWeight: "600", fontSize: 16 },
    scroll: { padding: 16, gap: 12 },
    section: { color: colors.text, fontWeight: "700", fontSize: 15, marginTop: 4 },
    providersNote: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      marginBottom: 2,
    },
    travelerBanner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: "#FFF4E0",
      borderWidth: 1,
      borderColor: "#F0C674",
      marginTop: 2,
    },
    travelerBannerText: { flex: 1, color: "#7A5200", fontSize: 12, lineHeight: 17 },
    createTripWrap: { borderRadius: 14, overflow: "hidden", marginTop: 4 },
    createTripBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 15,
    },
    createTripText: { color: "#1A1A1A", fontWeight: "800", fontSize: 15 },
    createTripHint: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
      textAlign: "center",
      marginTop: 2,
    },
    orDivider: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "600",
      textAlign: "center",
      marginTop: 6,
    },
    disclaimer: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      padding: 12,
      backgroundColor: colors.lightGray,
      borderRadius: 12,
    },
    error: { color: colors.error, textAlign: "center", paddingVertical: 16 },
    empty: { color: colors.textSecondary, textAlign: "center", paddingVertical: 16 },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* A Modal renders in its own native view hierarchy, so the app's
          SafeAreaProvider insets don't reach here — re-wrap so the header
          clears the status bar / notch instead of sliding under it. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {t("flights.bookingOptions", { defaultValue: "Booking options" })}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>{t("common.done", { defaultValue: "Done" })}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.disclaimer}>
            {t("flights.searchDisclaimer", {
              defaultValue:
                "Planera helps you discover flight options. Booking and payment are completed directly with external providers. Prices and availability may change.",
            })}
          </Text>

          {outboundOption && (
            <>
              <Text style={styles.section}>
                {t("flights.outbound", { defaultValue: "Outbound" })}
              </Text>
              <FlightResultCard option={outboundOption} currency={currency} hideCta travelers={searchContext?.adults} />
            </>
          )}

          {flightOption && (
            <>
              <Text style={styles.section}>
                {outboundOption
                  ? t("flights.return", { defaultValue: "Return" })
                  : t("flights.selectedFlight", { defaultValue: "Selected flight" })}
              </Text>
              <FlightResultCard option={flightOption} currency={currency} hideCta travelers={searchContext?.adults} />
            </>
          )}

          {/* Primary path: turn these flights into a full AI-planned trip. */}
          {onCreateTrip && (
            <>
              <TouchableOpacity
                style={styles.createTripWrap}
                onPress={onCreateTrip}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={[colors.primary, "#34C759"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.createTripBtn}
                >
                  <Ionicons name="sparkles" size={18} color="#1A1A1A" />
                  <Text style={styles.createTripText}>
                    {t("flights.createTripWithFlights", {
                      defaultValue: "Create trip with these flights",
                    })}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
              <Text style={styles.createTripHint}>
                {t("flights.createTripHint", {
                  defaultValue:
                    "We'll build your itinerary around these flights — book them below whenever you're ready.",
                })}
              </Text>
              <Text style={styles.orDivider}>
                {t("flights.orBookDirectly", { defaultValue: "or book directly" })}
              </Text>
            </>
          )}

          <Text style={styles.section}>
            {t("flights.providers", { defaultValue: "Providers" })}
          </Text>

          {loading && (
            <ActivityIndicator color={colors.text} style={{ marginVertical: 24 }} />
          )}

          {!loading && error && <Text style={styles.error}>{error}</Text>}

          {!loading && !error && bookingOptions && (
            <View style={{ gap: 10 }}>
              {bookingOptions.bookingOptions.length === 0 ? (
                <Text style={styles.empty}>
                  {t("flights.noProviders", {
                    defaultValue: "No providers available for this flight right now.",
                  })}
                </Text>
              ) : (
                <>
                  <Text style={styles.providersNote}>
                    {t("flights.providersNote", {
                      defaultValue:
                        "Live prices from each booking site — may differ from the headline fare and include different baggage.",
                    })}
                  </Text>
                  {multiTraveler && (
                    <View style={styles.travelerBanner}>
                      <Ionicons name="people" size={16} color="#7A5200" />
                      <Text style={styles.travelerBannerText}>
                        {t("flights.multiTravelerBookingNote", {
                          count: travelers,
                          defaultValue: `Booking for ${travelers} travelers. Confirm the number of passengers on the provider's site before paying — some providers may require booking each traveler separately.`,
                        })}
                      </Text>
                    </View>
                  )}
                  {/* Sort cheapest-first; options without a price fall last. */}
                  {[...bookingOptions.bookingOptions]
                    .sort(
                      (a, b) =>
                        (a.price ?? Number.POSITIVE_INFINITY) -
                        (b.price ?? Number.POSITIVE_INFINITY)
                    )
                    .map((o) => (
                      <BookingOptionCard key={o.id} option={o} travelers={searchContext?.adults} />
                    ))}
                </>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};
