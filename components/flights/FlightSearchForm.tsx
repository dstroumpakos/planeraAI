import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import type { FlightSearchInput, StopsFilter } from "@/types/flights";

interface Props {
  initial?: Partial<FlightSearchInput>;
  loading?: boolean;
  onSubmit: (input: FlightSearchInput) => void;
}

const STOPS: { value: StopsFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "nonstop", label: "Nonstop" },
  { value: "one_stop_or_fewer", label: "≤1 stop" },
];

export const FlightSearchForm: React.FC<Props> = ({ initial, loading, onSubmit }) => {
  const { colors } = useTheme();
  const [departureId, setDepartureId] = useState(initial?.departureId ?? "");
  const [arrivalId, setArrivalId] = useState(initial?.arrivalId ?? "");
  const [outboundDate, setOutboundDate] = useState(initial?.outboundDate ?? "");
  const [returnDate, setReturnDate] = useState(initial?.returnDate ?? "");
  const [type, setType] = useState<"one_way" | "round_trip">(
    initial?.type ?? (initial?.returnDate ? "round_trip" : "one_way")
  );
  const [adults, setAdults] = useState(String(initial?.adults ?? 1));
  const [stops, setStops] = useState<StopsFilter>(initial?.stops ?? "any");
  const [maxPrice, setMaxPrice] = useState(
    initial?.maxPrice != null ? String(initial.maxPrice) : ""
  );
  const [currency] = useState(initial?.currency ?? "EUR");

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 12,
    },
    label: { color: colors.textSecondary, fontSize: 12, marginBottom: 4 },
    input: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
    },
    row: { flexDirection: "row", gap: 10 },
    col: { flex: 1 },
    toggleRow: { flexDirection: "row", gap: 8 },
    toggle: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.lightGray,
      alignItems: "center",
    },
    toggleActive: { backgroundColor: colors.primary },
    toggleText: { color: colors.text, fontWeight: "600", fontSize: 13 },
    chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lightGray,
    },
    chipActive: { backgroundColor: colors.primary },
    chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
    submit: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    submitText: { color: "#1A1A1A", fontWeight: "700", fontSize: 15 },
    disclaimer: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  });

  const submit = () => {
    if (!departureId.trim() || !arrivalId.trim() || !outboundDate.trim()) return;
    if (type === "round_trip" && !returnDate.trim()) return;
    onSubmit({
      departureId: departureId.trim().toUpperCase(),
      arrivalId: arrivalId.trim().toUpperCase(),
      outboundDate: outboundDate.trim(),
      returnDate: type === "round_trip" ? returnDate.trim() : undefined,
      type,
      currency,
      adults: Number(adults) || 1,
      stops,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.toggleRow}>
        {(["one_way", "round_trip"] as const).map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.toggle, type === v && styles.toggleActive]}
            onPress={() => setType(v)}
          >
            <Text style={styles.toggleText}>
              {v === "one_way" ? "One way" : "Round trip"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>From (IATA)</Text>
          <TextInput
            style={styles.input}
            value={departureId}
            onChangeText={setDepartureId}
            autoCapitalize="characters"
            maxLength={4}
            placeholder="ATH"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>To (IATA)</Text>
          <TextInput
            style={styles.input}
            value={arrivalId}
            onChangeText={setArrivalId}
            autoCapitalize="characters"
            maxLength={4}
            placeholder="BCN"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Departure (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={outboundDate}
            onChangeText={setOutboundDate}
            placeholder="2026-06-10"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        {type === "round_trip" && (
          <View style={styles.col}>
            <Text style={styles.label}>Return (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={returnDate}
              onChangeText={setReturnDate}
              placeholder="2026-06-17"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        )}
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Passengers</Text>
          <TextInput
            style={styles.input}
            value={adults}
            onChangeText={setAdults}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Max price ({currency})</Text>
          <TextInput
            style={styles.input}
            value={maxPrice}
            onChangeText={setMaxPrice}
            keyboardType="number-pad"
            placeholder="—"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <View>
        <Text style={styles.label}>Stops</Text>
        <View style={styles.chipRow}>
          {STOPS.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.chip, stops === s.value && styles.chipActive]}
              onPress={() => setStops(s.value)}
            >
              <Text style={styles.chipText}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submit, loading && { opacity: 0.6 }]}
        onPress={submit}
        disabled={loading}
      >
        <Text style={styles.submitText}>{loading ? "Searching…" : "Find flights"}</Text>
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        Planera helps you discover flight options. Booking and payment are completed
        directly with external providers. Prices and availability may change.
      </Text>
    </View>
  );
};
