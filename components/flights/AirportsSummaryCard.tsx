import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import type { NormalizedAirportGroup } from "@/types/flights";

interface Props {
  airports?: NormalizedAirportGroup[];
}

export const AirportsSummaryCard: React.FC<Props> = ({ airports }) => {
  const { colors } = useTheme();
  if (!airports || airports.length === 0) return null;
  const group = airports[0];
  const dep = group.departure?.[0];
  const arr = group.arrival?.[0];
  if (!dep && !arr) return null;

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    side: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.lightGray },
    code: { color: colors.text, fontWeight: "700", fontSize: 16 },
    city: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    arrow: { color: colors.textMuted, marginHorizontal: 6 },
  });

  const renderSide = (a?: typeof dep) => (
    <View style={styles.side}>
      {a?.thumbnail || a?.image ? (
        <Image source={{ uri: a.thumbnail || a.image! }} style={styles.thumb} />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.code} numberOfLines={1}>
          {a?.airport?.id ?? "—"}
        </Text>
        <Text style={styles.city} numberOfLines={1}>
          {[a?.city, a?.country].filter(Boolean).join(", ") || a?.airport?.name || ""}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.card}>
      {renderSide(dep)}
      <Text style={styles.arrow}>→</Text>
      {renderSide(arr)}
    </View>
  );
};
