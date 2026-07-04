import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import type { PriceInsights } from "@/types/flights";

interface Props {
  priceInsights?: PriceInsights | null;
  currency?: string;
}

function formatPrice(value: number | null | undefined, currency: string) {
  if (value == null) return "—";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

export const PriceInsightsCard: React.FC<Props> = ({
  priceInsights,
  currency = "EUR",
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (!priceInsights) return null;
  const level = (priceInsights.priceLevel || "").toLowerCase();

  const tone =
    level === "low"
      ? { bg: "#E8F7EE", fg: "#0F8A3B", label: t("flights.lowPrice", { defaultValue: "Low price" }) }
      : level === "high"
        ? { bg: "#FDECEC", fg: "#B82626", label: t("flights.higherThanUsual", { defaultValue: "Higher than usual" }) }
        : { bg: colors.lightGray, fg: colors.text, label: t("flights.typicalPrice", { defaultValue: "Typical price" }) };

  const body =
    level === "low"
      ? t("flights.fareLowBody", { defaultValue: "This fare looks low compared with the usual range." })
      : level === "high"
        ? t("flights.fareHighBody", { defaultValue: "This fare looks higher than usual." })
        : t("flights.fareTypicalBody", { defaultValue: "This fare looks typical for this route." });

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: tone.bg,
    },
    badgeText: { color: tone.fg, fontWeight: "600", fontSize: 12 },
    price: { color: colors.text, fontWeight: "700", fontSize: 18 },
    body: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    rangeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    rangeText: { color: colors.textMuted, fontSize: 12 },
  });

  const [low, high] = priceInsights.typicalPriceRange ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{tone.label}</Text>
        </View>
        <Text style={styles.price}>
          {formatPrice(priceInsights.lowestPrice, currency)}
        </Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {low != null && high != null && (
        <View style={styles.rangeRow}>
          <Text style={styles.rangeText}>
            {t("flights.typicalRange", {
              low: formatPrice(low, currency),
              high: formatPrice(high, currency),
              defaultValue: `Typical range: ${formatPrice(low, currency)} – ${formatPrice(high, currency)}`,
            })}
          </Text>
        </View>
      )}
    </View>
  );
};
