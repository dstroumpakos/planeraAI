import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import type {
  FareVerdict,
  FareVerdictReason,
  FareVerdictResult,
} from "@/lib/fareVerdict";

const TONE: Record<FareVerdict, { fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  buy: { fg: "#0F8A3B", bg: "#E8F7EE", icon: "checkmark-circle" },
  fair: { fg: "#8A6100", bg: "#FFF4D6", icon: "remove-circle" },
  wait: { fg: "#B82626", bg: "#FDECEC", icon: "time" },
};

const MONEY_PARAMS = ["amount", "low", "high", "typical"];

/** Loose `t` so dynamic keys type-check (react-i18next's own is key-typed). */
type TFunction = (key: string, opts?: Record<string, unknown>) => string;

export function verdictLabel(t: TFunction, verdict: FareVerdict): string {
  const fallback = {
    buy: "Good time to buy",
    fair: "Fair price",
    wait: "Worth waiting",
  }[verdict];
  return t(`fareVerdict.${verdict}`, { defaultValue: fallback });
}

/** One reason as a sentence, money params formatted with `money`. */
export function verdictReasonText(
  t: TFunction,
  reason: FareVerdictReason,
  money: (n: number) => string
): string {
  const params: Record<string, string | number> = { ...reason.params };
  for (const k of MONEY_PARAMS) {
    if (typeof params[k] === "number") params[k] = money(params[k] as number);
  }
  const fallback: Record<FareVerdictReason["key"], string> = {
    belowRange: "{{amount}} below the usual {{low}}–{{high}} for this route",
    underTypical: "{{amount}} under the typical {{typical}}",
    aboveTypical: "{{amount}} above the typical {{typical}}",
    aboveRange: "{{amount}} above the usual {{low}}–{{high}} for this route",
    googleLow: "Google rates this fare low for the route",
    googleHigh: "Google rates this fare high for the route",
    lowestSeen: "Lowest price for these dates in the last {{days}} days",
    pricesRising: "Prices for these dates have been rising",
    pricesFalling: "Prices for these dates have been falling",
    departingSoon: "{{days}} days to go: fares rarely drop this late",
    plentyOfTime: "{{months}} months out: there's time to watch it",
  };
  return t(`fareVerdict.reason.${reason.key}`, {
    ...params,
    defaultValue: fallback[reason.key],
  });
}

interface Props {
  result: FareVerdictResult;
  /** Formats a money amount in the fare's currency. */
  money: (n: number) => string;
  /** One line (chip + strongest reason) instead of the full list. */
  compact?: boolean;
}

/**
 * The buy-or-wait verdict with its reasons written out (lib/fareVerdict.ts).
 */
export const FareVerdictView: React.FC<Props> = ({ result, money, compact }) => {
  const { colors } = useTheme();
  const { t: rawT } = useTranslation();
  const t = rawT as unknown as TFunction;
  const tone = TONE[result.verdict];
  const reasons = compact ? result.reasons.slice(0, 1) : result.reasons;

  return (
    <View style={compact ? styles.compact : styles.full}>
      <View style={[styles.chip, { backgroundColor: tone.bg }]}>
        <Ionicons name={tone.icon} size={13} color={tone.fg} />
        <Text style={[styles.chipText, { color: tone.fg }]}>
          {verdictLabel(t, result.verdict)}
        </Text>
      </View>
      {compact ? (
        reasons[0] ? (
          <Text
            style={[styles.compactReason, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {verdictReasonText(t, reasons[0], money)}
          </Text>
        ) : null
      ) : (
        <>
          {reasons.map((r) => (
            <View key={r.key} style={styles.reasonRow}>
              <Ionicons
                name={r.weight > 0 ? "arrow-up-circle-outline" : "arrow-down-circle-outline"}
                size={14}
                color={r.weight > 0 ? TONE.buy.fg : TONE.wait.fg}
                style={{ marginTop: 1 }}
              />
              <Text style={[styles.reasonText, { color: colors.textSecondary }]}>
                {verdictReasonText(t, r, money)}
              </Text>
            </View>
          ))}
          <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
            {t("fareVerdict.disclaimer", {
              defaultValue: "Our read of Google's price data for these dates, not a forecast.",
            })}
          </Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  full: { gap: 6 },
  compact: { gap: 4, marginTop: 8 },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  compactReason: { fontSize: 12, lineHeight: 16 },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 18 },
  disclaimer: { fontSize: 11, lineHeight: 15, marginTop: 2 },
});
