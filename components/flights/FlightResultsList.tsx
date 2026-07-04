import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import type { NormalizedFlightOption } from "@/types/flights";
import { FlightResultCard } from "./FlightResultCard";

interface Props {
  bestFlights: NormalizedFlightOption[];
  otherFlights: NormalizedFlightOption[];
  currency?: string;
  onSelect: (option: NormalizedFlightOption) => void;
  onCreateTrip?: (option: NormalizedFlightOption) => void;
  ctaLabel?: string;
}

export const FlightResultsList: React.FC<Props> = ({
  bestFlights,
  otherFlights,
  currency = "EUR",
  onSelect,
  onCreateTrip,
  ctaLabel,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const styles = StyleSheet.create({
    section: { color: colors.text, fontWeight: "700", fontSize: 16, marginTop: 8 },
    empty: { color: colors.textSecondary, textAlign: "center", paddingVertical: 24 },
  });

  const items: Array<
    | { kind: "header"; label: string; key: string }
    | { kind: "card"; option: NormalizedFlightOption; key: string }
  > = [];

  if (bestFlights.length > 0) {
    items.push({
      kind: "header",
      label: t("flights.bestFlights", { defaultValue: "Best flights" }),
      key: "h-best",
    });
    bestFlights.forEach((o) =>
      items.push({ kind: "card", option: o, key: `b-${o.id}` })
    );
  }
  if (otherFlights.length > 0) {
    items.push({
      kind: "header",
      label: t("flights.otherFlights", { defaultValue: "Other flights" }),
      key: "h-other",
    });
    otherFlights.forEach((o) =>
      items.push({ kind: "card", option: o, key: `o-${o.id}` })
    );
  }

  if (items.length === 0) {
    return (
      <View>
        <Text style={styles.empty}>
          {t("flights.noFlightsFound", {
            defaultValue:
              "No flights found for these dates. Try different dates or fewer filters.",
          })}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      scrollEnabled={false}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item }) =>
        item.kind === "header" ? (
          <Text style={styles.section}>{item.label}</Text>
        ) : (
          <FlightResultCard
            option={item.option}
            currency={currency}
            onPress={() => onSelect(item.option)}
            onCreateTrip={onCreateTrip ? () => onCreateTrip(item.option) : undefined}
            ctaLabel={ctaLabel}
          />
        )
      }
    />
  );
};
