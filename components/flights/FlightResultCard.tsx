import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import type { NormalizedFlightOption } from "@/types/flights";

interface Props {
  option: NormalizedFlightOption;
  currency?: string;
  onPress?: () => void;
  /** When set, shows a secondary "Create trip with this flight" button. */
  onCreateTrip?: () => void;
}

function formatDuration(mins?: number | null): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  // SerpApi format: "2024-06-10 08:00"
  const parts = iso.split(" ");
  return parts[1] ?? iso;
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const map: Record<string, { bg: string; fg: string }> = {
    good: { bg: "#E8F7EE", fg: "#0F8A3B" },
    warn: { bg: "#FFF4E0", fg: "#A36100" },
    bad: { bg: "#FDECEC", fg: "#B82626" },
    neutral: { bg: "#EEF0F4", fg: "#3A3A3A" },
  };
  const t = map[tone];
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        backgroundColor: t.bg,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: t.fg, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export const FlightResultCard: React.FC<Props> = ({
  option,
  currency = "EUR",
  onPress,
  onCreateTrip,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const first = option.flights[0];
  const last = option.flights[option.flights.length - 1] ?? first;
  const stops = option.flights.length > 0 ? option.flights.length - 1 : 0;
  const hasBookingToken = Boolean(option.bookingToken);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 12,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    logo: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.lightGray },
    airlineCol: { flex: 1 },
    airline: { color: colors.text, fontWeight: "600", fontSize: 14 },
    flightNo: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    price: { color: colors.text, fontWeight: "700", fontSize: 18 },
    timesRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    timeCol: { alignItems: "center", minWidth: 72 },
    time: { color: colors.text, fontWeight: "700", fontSize: 16 },
    code: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    middle: { flex: 1, alignItems: "center", gap: 4 },
    duration: { color: colors.textSecondary, fontSize: 12 },
    line: { height: 1, backgroundColor: colors.border, width: "100%" },
    stopsText: { color: colors.textMuted, fontSize: 11 },
    badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    button: {
      backgroundColor: hasBookingToken ? colors.primary : colors.lightGray,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    buttonText: {
      color: hasBookingToken ? "#1A1A1A" : colors.textMuted,
      fontWeight: "700",
      fontSize: 14,
    },
    createTripButton: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      borderRadius: 12,
      paddingVertical: 12,
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    createTripText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
    co2: { color: colors.textMuted, fontSize: 11 },
  });

  const dealBadge =
    option.dealScore === "strong_deal" ? (
      <Badge label="Low price" tone="good" />
    ) : option.dealScore === "expensive" ? (
      <Badge label="Higher than usual" tone="bad" />
    ) : option.dealScore === "normal" ? (
      <Badge label="Typical price" tone="neutral" />
    ) : null;

  const hasOvernightLayover = option.layovers.some((l) => l.overnight);
  const hasOftenDelayed = option.flights.some((f) => f.oftenDelayedByOver30Min);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {option.airlineLogo ? (
          <Image source={{ uri: option.airlineLogo }} style={styles.logo} />
        ) : (
          <View style={styles.logo} />
        )}
        <View style={styles.airlineCol}>
          <Text style={styles.airline} numberOfLines={1}>
            {first?.airline ?? "Flight"}
          </Text>
          <Text style={styles.flightNo} numberOfLines={1}>
            {option.flights
              .map((f) => f.flightNumber)
              .filter(Boolean)
              .join(" • ") || ""}
          </Text>
        </View>
        <Text style={styles.price}>
          {option.price != null
            ? `${currency} ${Math.round(option.price).toLocaleString()}`
            : "—"}
        </Text>
      </View>

      <View style={styles.timesRow}>
        <View style={styles.timeCol}>
          <Text style={styles.time}>{formatTime(first?.departureAirport.time)}</Text>
          <Text style={styles.code}>{first?.departureAirport.id ?? ""}</Text>
        </View>
        <View style={styles.middle}>
          <Text style={styles.duration}>
            {formatDuration(option.totalDurationMinutes)}
          </Text>
          <View style={styles.line} />
          <Text style={styles.stopsText}>
            {stops === 0
              ? "Nonstop"
              : `${stops} stop${stops > 1 ? "s" : ""}`}
          </Text>
        </View>
        <View style={styles.timeCol}>
          <Text style={styles.time}>{formatTime(last?.arrivalAirport.time)}</Text>
          <Text style={styles.code}>{last?.arrivalAirport.id ?? ""}</Text>
        </View>
      </View>

      <View style={styles.badgesRow}>
        {dealBadge}
        {stops === 0 && <Badge label="Nonstop" tone="good" />}
        {stops === 1 && <Badge label="1 stop" tone="neutral" />}
        {hasOvernightLayover && <Badge label="Overnight layover" tone="warn" />}
        {hasOftenDelayed && <Badge label="Often delayed" tone="warn" />}
      </View>

      {option.carbonEmissions?.thisFlight != null && (
        <Text style={styles.co2}>
          CO₂: {Math.round(option.carbonEmissions.thisFlight / 1000)} kg
          {option.carbonEmissions.differencePercent != null
            ? ` (${option.carbonEmissions.differencePercent > 0 ? "+" : ""}${option.carbonEmissions.differencePercent}% vs typical)`
            : ""}
        </Text>
      )}

      <TouchableOpacity
        style={styles.button}
        disabled={!hasBookingToken}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {hasBookingToken ? "View booking options" : "Check availability unavailable"}
        </Text>
      </TouchableOpacity>

      {onCreateTrip && (
        <TouchableOpacity
          style={styles.createTripButton}
          onPress={onCreateTrip}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles" size={16} color={colors.primary} />
          <Text style={styles.createTripText}>
            {t("flights.createTripWithFlight", {
              defaultValue: "Create trip with this flight",
            })}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
