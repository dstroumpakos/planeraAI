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
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { useFlightSearch } from "@/hooks/useFlightSearch";
import { resolveAirport } from "@/lib/destinationAirports";
import { AIRPORTS } from "@/lib/airports";
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
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{
    departureId?: string;
    arrivalId?: string;
    outboundDate?: string;
    returnDate?: string;
    adults?: string;
    currency?: string;
    arrivalCityName?: string;
  }>();

  const arrivalInfo = useMemo(
    () => (params.arrivalCityName ? resolveAirport(params.arrivalCityName) : null),
    [params.arrivalCityName]
  );

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
  // Last submitted search input — needed to prefill the trip-creation flow
  // (dates, route, traveler count) when the user picks a flight.
  const [lastInput, setLastInput] = useState<FlightSearchInput | null>(null);

  const onSubmit = async (input: FlightSearchInput) => {
    setCurrentCurrency(input.currency ?? "EUR");
    setLastInput(input);
    try {
      await searchFlights(input);
    } catch {
      // error is surfaced via `error` state
    }
  };

  // Navigate to the deal-trip screen (flight-search mode) with the selected
  // flight locked in and dates/destination/travelers prefilled.
  const onCreateTrip = (option: NormalizedFlightOption) => {
    if (!lastInput) return;
    const segments = option.flights;
    const first = segments[0];
    const lastSeg = segments[segments.length - 1] ?? first;
    const stops = Math.max(0, segments.length - 1);
    const timeOf = (iso?: string | null) => iso?.split(" ")[1] ?? "";
    const minsToLabel = (mins?: number | null) =>
      mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "";

    const originAirport = AIRPORTS.find((a) => a.code === lastInput.departureId);
    const destAirport = AIRPORTS.find((a) => a.code === lastInput.arrivalId);

    const mappedSegments =
      stops > 0
        ? segments.map((s) => ({
            airline: s.airline ?? "",
            flightNumber: s.flightNumber ?? undefined,
            departureAirport: s.departureAirport.id ?? "",
            departureTime: timeOf(s.departureAirport.time),
            arrivalAirport: s.arrivalAirport.id ?? "",
            arrivalTime: timeOf(s.arrivalAirport.time),
            duration: minsToLabel(s.durationMinutes),
          }))
        : null;

    const adults = lastInput.adults || 1;
    router.push({
      pathname: "/deal-trip",
      params: {
        origin: lastInput.departureId,
        originCity: originAirport?.city || first?.departureAirport.name || lastInput.departureId,
        destination: lastInput.arrivalId,
        destinationCity:
          params.arrivalCityName || destAirport?.city || lastSeg?.arrivalAirport.name || lastInput.arrivalId,
        airline: first?.airline ?? "",
        flightNumber: segments.map((s) => s.flightNumber).filter(Boolean).join(" • "),
        outboundDate: lastInput.outboundDate,
        outboundDeparture: timeOf(first?.departureAirport.time),
        outboundArrival: timeOf(lastSeg?.arrivalAirport.time),
        outboundDuration: minsToLabel(option.totalDurationMinutes),
        outboundStops: String(stops),
        outboundSegments: mappedSegments ? JSON.stringify(mappedSegments) : "",
        returnDate: lastInput.returnDate || "",
        price: option.price != null ? String(option.price) : "0",
        totalPrice: option.price != null && adults > 1 ? String(option.price * adults) : "",
        currency: lastInput.currency || currentCurrency,
        travelers: String(adults),
      },
    } as any);
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
    banner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.lightGray,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bannerText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
    bannerEmphasis: { fontWeight: "700", color: colors.text },
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
            {arrivalInfo && !arrivalInfo.hasOwnAirport && arrivalInfo.nearestCity && (
              <View style={styles.banner}>
                <Ionicons
                  name="information-circle"
                  size={18}
                  color={colors.text}
                />
                <Text style={styles.bannerText}>
                  {t(
                    arrivalInfo.distanceKm
                      ? "flights.noOwnAirportWithDistance"
                      : "flights.noOwnAirport",
                    {
                      city: params.arrivalCityName,
                      nearestCity: arrivalInfo.nearestCity,
                      iata: arrivalInfo.iata,
                      distance: arrivalInfo.distanceKm,
                    }
                  )}
                </Text>
              </View>
            )}
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
              onCreateTrip={onCreateTrip}
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
