import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/lib/ThemeContext";
import { useFlightSearch } from "@/hooks/useFlightSearch";
import { FlightSearchForm } from "@/components/flights/FlightSearchForm";
import { AirportsSummaryCard } from "@/components/flights/AirportsSummaryCard";
import { PriceInsightsCard } from "@/components/flights/PriceInsightsCard";
import { FlightResultsList } from "@/components/flights/FlightResultsList";
import { BookingOptionsSheet } from "@/components/flights/BookingOptionsSheet";
import type {
  FlightSearchInput,
  NormalizedFlightOption,
} from "@/types/flights";

/**
 * Google Flights search screen (SerpApi-backed).
 *
 * Optional prefill via search params from a trip:
 *   /flights/search?departureId=ATH&arrivalId=BCN&outboundDate=...&returnDate=...&adults=2
 */
export default function FlightsSearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    departureId?: string;
    arrivalId?: string;
    outboundDate?: string;
    returnDate?: string;
    adults?: string;
    currency?: string;
  }>();

  const initial: Partial<FlightSearchInput> = useMemo(
    () => ({
      departureId: params.departureId,
      arrivalId: params.arrivalId,
      outboundDate: params.outboundDate,
      returnDate: params.returnDate,
      adults: params.adults ? Number(params.adults) : undefined,
      currency: params.currency ?? "EUR",
      type: params.returnDate ? "round_trip" : "one_way",
    }),
    [params.departureId, params.arrivalId, params.outboundDate, params.returnDate, params.adults, params.currency]
  );

  const { data, loading, error, searchFlights } = useFlightSearch();
  const [selected, setSelected] = useState<NormalizedFlightOption | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [currentCurrency, setCurrentCurrency] = useState(
    initial.currency ?? "EUR"
  );

  const onSubmit = async (input: FlightSearchInput) => {
    setCurrentCurrency(input.currency ?? "EUR");
    try {
      await searchFlights(input);
    } catch {
      // error is surfaced via `error` state
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 10,
    },
    headerTitle: { color: colors.text, fontWeight: "700", fontSize: 18 },
    content: { padding: 16, gap: 14 },
    error: { color: colors.error, textAlign: "center", paddingVertical: 12 },
    skeleton: {
      backgroundColor: colors.lightGray,
      borderRadius: 14,
      height: 120,
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find flights</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <FlightSearchForm
          initial={initial}
          loading={loading}
          onSubmit={onSubmit}
        />

        {loading && (
          <View style={{ gap: 10 }}>
            <View style={styles.skeleton} />
            <View style={styles.skeleton} />
          </View>
        )}

        {!loading && error && <Text style={styles.error}>{error}</Text>}

        {!loading && data && (
          <>
            <AirportsSummaryCard airports={data.airports} />
            <PriceInsightsCard
              priceInsights={data.priceInsights}
              currency={currentCurrency}
            />
            <FlightResultsList
              bestFlights={data.bestFlights}
              otherFlights={data.otherFlights}
              currency={currentCurrency}
              onSelect={(o) => {
                setSelected(o);
                setSheetOpen(true);
              }}
            />
          </>
        )}
      </ScrollView>

      <BookingOptionsSheet
        visible={sheetOpen}
        flightOption={selected}
        currency={currentCurrency}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
