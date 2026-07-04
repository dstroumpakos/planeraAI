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
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useFlightSearch } from "@/hooks/useFlightSearch";
import { resolveAirport } from "@/lib/destinationAirports";
import { AIRPORTS } from "@/lib/airports";
import { FlightSearchForm } from "@/components/flights/FlightSearchForm";
import { AirportsSummaryCard } from "@/components/flights/AirportsSummaryCard";
import { PriceInsightsCard } from "@/components/flights/PriceInsightsCard";
import { FlightResultsList } from "@/components/flights/FlightResultsList";
import { FlightResultCard } from "@/components/flights/FlightResultCard";
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

  // Prefill "From" with the user's home airport when no explicit departure
  // was passed in (e.g. when opened from the home screen button).
  const { token } = useToken();
  const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" });
  const homeIata = useMemo(() => {
    const raw = (userSettings as any)?.homeAirport as string | undefined;
    if (!raw) return undefined;
    const matches = raw.toUpperCase().match(/\b([A-Z]{3})\b/g);
    return matches ? matches[matches.length - 1] : undefined;
  }, [userSettings]);

  const initial: Partial<FlightSearchInput> = useMemo(
    () => ({
      departureId: params.departureId || homeIata,
      arrivalId: params.arrivalId,
      outboundDate: params.outboundDate,
      returnDate: params.returnDate,
      adults: params.adults ? Number(params.adults) : undefined,
      currency: params.currency ?? "EUR",
      type: "round_trip",
    }),
    [params.departureId, params.arrivalId, params.outboundDate, params.returnDate, params.adults, params.currency, homeIata]
  );

  // Two-step round-trip flow: search returns outbound options; picking one
  // triggers a follow-up search (departure_token) for its return options.
  const outbound = useFlightSearch();
  const returnLeg = useFlightSearch();
  const [selectedOutbound, setSelectedOutbound] = useState<NormalizedFlightOption | null>(null);
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
    setSelectedOutbound(null);
    returnLeg.reset();
    try {
      await outbound.searchFlights(input);
    } catch {
      // error is surfaced via `error` state
    }
  };

  const selectOutbound = async (option: NormalizedFlightOption) => {
    if (!lastInput) return;
    if (!option.departureToken) {
      // No return-leg token (rare) — fall back to booking options directly.
      if (option.bookingToken) {
        setSelected(option);
        setSheetOpen(true);
      }
      return;
    }
    setSelectedOutbound(option);
    try {
      await returnLeg.searchFlights({
        ...lastInput,
        departureToken: option.departureToken,
      });
    } catch {
      // error is surfaced via returnLeg.error
    }
  };

  const changeOutbound = () => {
    setSelectedOutbound(null);
    returnLeg.reset();
  };

  const timeOf = (iso?: string | null) => iso?.split(" ")[1] ?? "";
  const minsToLabel = (mins?: number | null) =>
    mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "";

  const mapLeg = (option: NormalizedFlightOption) => {
    const segments = option.flights;
    const first = segments[0];
    const lastSeg = segments[segments.length - 1] ?? first;
    const stops = Math.max(0, segments.length - 1);
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
    return {
      airline: first?.airline ?? "",
      flightNumber: segments.map((s) => s.flightNumber).filter(Boolean).join(" • "),
      departure: timeOf(first?.departureAirport.time),
      arrival: timeOf(lastSeg?.arrivalAirport.time),
      duration: minsToLabel(option.totalDurationMinutes),
      stops,
      segments: mappedSegments,
      firstSeg: first,
      lastSeg,
    };
  };

  // Navigate to the deal-trip screen (flight-search mode) with both legs
  // locked in and dates/destination/travelers prefilled.
  const onCreateTrip = (returnOption: NormalizedFlightOption) => {
    if (!lastInput || !selectedOutbound) return;
    const out = mapLeg(selectedOutbound);
    const ret = mapLeg(returnOption);

    const originAirport = AIRPORTS.find((a) => a.code === lastInput.departureId);
    const destAirport = AIRPORTS.find((a) => a.code === lastInput.arrivalId);
    const adults = lastInput.adults || 1;
    // SerpApi's option price is the TOTAL round-trip fare for ALL searched
    // travelers, so derive per-person from it — don't multiply again.
    const totalFare = returnOption.price ?? selectedOutbound.price;
    const perPersonFare =
      totalFare != null && adults > 0 ? Math.round(totalFare / adults) : totalFare;

    router.push({
      pathname: "/deal-trip",
      params: {
        origin: lastInput.departureId,
        originCity: originAirport?.city || out.firstSeg?.departureAirport.name || lastInput.departureId,
        destination: lastInput.arrivalId,
        destinationCity:
          params.arrivalCityName || destAirport?.city || out.lastSeg?.arrivalAirport.name || lastInput.arrivalId,
        airline: out.airline,
        flightNumber: out.flightNumber,
        outboundDate: lastInput.outboundDate,
        outboundDeparture: out.departure,
        outboundArrival: out.arrival,
        outboundDuration: out.duration,
        outboundStops: String(out.stops),
        outboundSegments: out.segments ? JSON.stringify(out.segments) : "",
        returnDate: lastInput.returnDate || "",
        returnDeparture: ret.departure,
        returnArrival: ret.arrival,
        returnAirline: ret.airline,
        returnFlightNumber: ret.flightNumber,
        returnDuration: ret.duration,
        returnStops: String(ret.stops),
        returnSegments: ret.segments ? JSON.stringify(ret.segments) : "",
        price: perPersonFare != null ? String(perPersonFare) : "0",
        totalPrice: totalFare != null && adults > 1 ? String(Math.round(totalFare)) : "",
        currency: lastInput.currency || currentCurrency,
        travelers: String(adults),
        bookingToken: returnOption.bookingToken || "",
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
    hero: { gap: 8, marginBottom: 2 },
    heroTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    heroBadge: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
    },
    heroTitle: {
      flex: 1,
      color: colors.text,
      fontWeight: "800",
      fontSize: 24,
      letterSpacing: -0.4,
      lineHeight: 29,
    },
    heroSubtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    trustRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
    trustChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.lightGray,
      borderWidth: 1,
      borderColor: colors.border,
    },
    trustText: { color: colors.text, fontSize: 11, fontWeight: "600" },
    stepRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    stepBadgeText: { color: "#000000", fontWeight: "800", fontSize: 12 },
    stepTitle: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 16 },
    changeLink: { color: colors.primary, fontWeight: "700", fontSize: 13 },
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
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <LinearGradient
              colors={[colors.primary, "#34C759"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroBadge}
            >
              <Ionicons name="airplane" size={22} color="#000000" />
            </LinearGradient>
            <Text style={styles.heroTitle}>
              {t("flights.heroTitle", { defaultValue: "Find your perfect flight" })}
            </Text>
          </View>
          <Text style={styles.heroSubtitle}>
            {t("flights.heroSubtitle", {
              defaultValue:
                "Compare live round-trip fares and turn the best deal into a complete AI-planned trip.",
            })}
          </Text>
          <View style={styles.trustRow}>
            <View style={styles.trustChip}>
              <Ionicons name="flash" size={11} color={colors.primary} />
              <Text style={styles.trustText}>
                {t("flights.trustRealtime", { defaultValue: "Real-time prices" })}
              </Text>
            </View>
            <View style={styles.trustChip}>
              <Ionicons name="globe-outline" size={11} color={colors.primary} />
              <Text style={styles.trustText}>
                {t("flights.trustAirlines", { defaultValue: "Hundreds of airlines" })}
              </Text>
            </View>
            <View style={styles.trustChip}>
              <Ionicons name="sparkles" size={11} color={colors.primary} />
              <Text style={styles.trustText}>
                {t("flights.trustOneTap", { defaultValue: "Trip-ready in one tap" })}
              </Text>
            </View>
          </View>
        </View>

        <FlightSearchForm
          initial={initial}
          loading={outbound.loading}
          onSubmit={onSubmit}
        />

        {outbound.loading && (
          <View style={{ gap: 10 }}>
            <View style={styles.skeleton} />
            <View style={styles.skeleton} />
          </View>
        )}

        {!outbound.loading && outbound.error && (
          <Text style={styles.error}>{outbound.error}</Text>
        )}

        {/* Step 1 — pick the outbound flight */}
        {!outbound.loading && outbound.data && !selectedOutbound && (
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
            <AirportsSummaryCard airports={outbound.data.airports} />
            <PriceInsightsCard
              priceInsights={outbound.data.priceInsights}
              currency={currentCurrency}
            />
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <Text style={styles.stepTitle}>
                {t("flights.chooseOutbound", { defaultValue: "Choose your outbound flight" })}
              </Text>
            </View>
            <FlightResultsList
              bestFlights={outbound.data.bestFlights}
              otherFlights={outbound.data.otherFlights}
              currency={currentCurrency}
              onSelect={selectOutbound}
              ctaLabel={t("flights.selectFlight", { defaultValue: "Select this flight" })}
              travelers={lastInput?.adults}
            />
          </>
        )}

        {/* Step 2 — pick the return flight */}
        {selectedOutbound && (
          <>
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Ionicons name="checkmark" size={13} color="#000000" />
              </View>
              <Text style={styles.stepTitle}>
                {t("flights.outboundSelected", { defaultValue: "Outbound selected" })}
              </Text>
              <TouchableOpacity onPress={changeOutbound} hitSlop={8}>
                <Text style={styles.changeLink}>
                  {t("flights.change", { defaultValue: "Change" })}
                </Text>
              </TouchableOpacity>
            </View>
            <FlightResultCard
              option={selectedOutbound}
              currency={currentCurrency}
              hideCta
              travelers={lastInput?.adults}
            />

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepTitle}>
                {t("flights.chooseReturn", { defaultValue: "Choose your return flight" })}
              </Text>
            </View>

            {returnLeg.loading && (
              <View style={{ gap: 10 }}>
                <View style={styles.skeleton} />
                <View style={styles.skeleton} />
              </View>
            )}

            {!returnLeg.loading && returnLeg.error && (
              <Text style={styles.error}>{returnLeg.error}</Text>
            )}

            {!returnLeg.loading && returnLeg.data && (
              <FlightResultsList
                bestFlights={returnLeg.data.bestFlights}
                otherFlights={returnLeg.data.otherFlights}
                currency={currentCurrency}
                onSelect={(o) => {
                  setSelected(o);
                  setSheetOpen(true);
                }}
                onCreateTrip={onCreateTrip}
                travelers={lastInput?.adults}
              />
            )}
          </>
        )}
      </ScrollView>

      <BookingOptionsSheet
        visible={sheetOpen}
        flightOption={selected}
        outboundOption={selectedOutbound}
        currency={currentCurrency}
        searchContext={
          lastInput
            ? {
                departureId: lastInput.departureId,
                arrivalId: lastInput.arrivalId,
                outboundDate: lastInput.outboundDate,
                returnDate: lastInput.returnDate,
                adults: lastInput.adults,
              }
            : undefined
        }
        onCreateTrip={
          selectedOutbound && selected
            ? () => {
                setSheetOpen(false);
                onCreateTrip(selected);
              }
            : undefined
        }
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
