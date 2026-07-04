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
}

export const BookingOptionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  flightOption,
  outboundOption,
  searchContext,
  currency = "EUR",
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { bookingOptions, loading, error, getBookingOptions, reset } =
    useFlightBookingOptions();

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
              <FlightResultCard option={outboundOption} currency={currency} hideCta />
            </>
          )}

          {flightOption && (
            <>
              <Text style={styles.section}>
                {outboundOption
                  ? t("flights.return", { defaultValue: "Return" })
                  : t("flights.selectedFlight", { defaultValue: "Selected flight" })}
              </Text>
              <FlightResultCard option={flightOption} currency={currency} hideCta />
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
                  {/* Sort cheapest-first; options without a price fall last. */}
                  {[...bookingOptions.bookingOptions]
                    .sort(
                      (a, b) =>
                        (a.price ?? Number.POSITIVE_INFINITY) -
                        (b.price ?? Number.POSITIVE_INFINITY)
                    )
                    .map((o) => (
                      <BookingOptionCard key={o.id} option={o} />
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
