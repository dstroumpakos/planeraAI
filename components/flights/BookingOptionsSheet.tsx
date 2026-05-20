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
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import { useFlightBookingOptions } from "@/hooks/useFlightBookingOptions";
import type { NormalizedFlightOption } from "@/types/flights";
import { FlightResultCard } from "./FlightResultCard";
import { BookingOptionCard } from "./BookingOptionCard";

interface Props {
  visible: boolean;
  onClose: () => void;
  flightOption: NormalizedFlightOption | null;
  currency?: string;
}

export const BookingOptionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  flightOption,
  currency = "EUR",
}) => {
  const { colors } = useTheme();
  const { bookingOptions, loading, error, getBookingOptions, reset } =
    useFlightBookingOptions();

  useEffect(() => {
    if (visible && flightOption?.bookingToken) {
      getBookingOptions({
        bookingToken: flightOption.bookingToken,
        currency,
      }).catch(() => {});
    }
    if (!visible) reset();
  }, [visible, flightOption?.bookingToken, currency, getBookingOptions, reset]);

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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Booking options</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.disclaimer}>
            Planera helps you discover flight options. Booking and payment are
            completed directly with external providers. Prices and availability may change.
          </Text>

          {flightOption && (
            <>
              <Text style={styles.section}>Selected flight</Text>
              <FlightResultCard option={flightOption} currency={currency} />
            </>
          )}

          <Text style={styles.section}>Providers</Text>

          {loading && (
            <ActivityIndicator color={colors.text} style={{ marginVertical: 24 }} />
          )}

          {!loading && error && <Text style={styles.error}>{error}</Text>}

          {!loading && !error && bookingOptions && (
            <View style={{ gap: 10 }}>
              {bookingOptions.bookingOptions.length === 0 ? (
                <Text style={styles.empty}>
                  No providers available for this flight right now.
                </Text>
              ) : (
                bookingOptions.bookingOptions.map((o) => (
                  <BookingOptionCard key={o.id} option={o} />
                ))
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};
