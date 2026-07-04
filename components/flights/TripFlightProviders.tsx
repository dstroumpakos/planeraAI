import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { BookingOptionCard } from "./BookingOptionCard";
import type { NormalizedBookingOption } from "@/types/flights";

/** Shape stored on the trip by flightsSerpApi.enrichTripBooking. */
export interface StoredBookingProvider {
  bookWith: string | null;
  price: number | null;
  airlineLogos: string[];
  extensions: string[];
  bookingRequest: { url: string; postData: string };
}

interface Props {
  providers?: StoredBookingProvider[] | null;
  travelers?: number;
}

/**
 * Renders the flight-booking provider list on a trip's Flights tab — the same
 * provider cards (resolve-on-tap, per-person/total labels) shown in the flight
 * search booking sheet, for trips created from a flight search.
 */
export const TripFlightProviders: React.FC<Props> = ({ providers, travelers }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  if (!providers || providers.length === 0) return null;
  const multiTraveler = Boolean(travelers && travelers > 1);

  const options: NormalizedBookingOption[] = providers
    .filter((p) => p.bookingRequest?.url && p.bookingRequest?.postData)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .map((p, i) => ({
      id: `trip_provider_${i}`,
      bookWith: p.bookWith,
      airlineLogos: p.airlineLogos ?? [],
      price: p.price,
      extensions: p.extensions ?? [],
      bookingRequest: p.bookingRequest,
    }));

  if (options.length === 0) return null;

  const styles = StyleSheet.create({
    wrap: { marginTop: 16, gap: 10 },
    title: { color: colors.text, fontWeight: "700", fontSize: 16 },
    note: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
    banner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: "#FFF4E0",
      borderWidth: 1,
      borderColor: "#F0C674",
    },
    bannerText: { flex: 1, color: "#7A5200", fontSize: 12, lineHeight: 17 },
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {t("flights.bookThisTrip", { defaultValue: "Book your flights" })}
      </Text>
      <Text style={styles.note}>
        {t("flights.providersNote", {
          defaultValue:
            "Live prices from each booking site — may differ from the headline fare and include different baggage.",
        })}
      </Text>
      {multiTraveler && (
        <View style={styles.banner}>
          <Ionicons name="people" size={16} color="#7A5200" />
          <Text style={styles.bannerText}>
            {t("flights.multiTravelerBookingNote", {
              count: travelers,
              defaultValue: `Booking for ${travelers} travelers. Confirm the number of passengers on the provider's site before paying — some providers may require booking each traveler separately.`,
            })}
          </Text>
        </View>
      )}
      {options.map((o) => (
        <BookingOptionCard key={o.id} option={o} travelers={travelers} />
      ))}
    </View>
  );
};
