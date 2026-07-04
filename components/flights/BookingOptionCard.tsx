import React, { useState } from "react";
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TouchableOpacity, View, Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";
import type { NormalizedBookingOption } from "@/types/flights";

interface Props {
  option: NormalizedBookingOption;
  /**
   * Travelers from the search. Provider prices are PER PERSON, while the
   * flight card shows the TOTAL — so when > 1 we label per-person and also
   * show the ×N total so the two are directly comparable.
   */
  travelers?: number;
}

export const BookingOptionCard: React.FC<Props> = ({ option, travelers }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const resolveBookingUrl = useAction(api.flightsResolve.resolveBookingUrl);
  const [resolving, setResolving] = useState(false);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      gap: 10,
    },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    logoRow: { flexDirection: "row", gap: 4 },
    logo: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.lightGray },
    provider: { color: colors.text, fontWeight: "700", fontSize: 14, flex: 1 },
    priceCol: { alignItems: "flex-end" },
    price: { color: colors.text, fontWeight: "700", fontSize: 16 },
    priceCaption: { color: colors.textMuted, fontSize: 10, marginTop: 1, textAlign: "right" },
    title: { color: colors.textSecondary, fontSize: 12 },
    extension: { color: colors.textMuted, fontSize: 11 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
    },
    buttonText: { color: "#1A1A1A", fontWeight: "700", fontSize: 13 },
    disabled: { backgroundColor: colors.lightGray },
    disabledText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
  });

  // SerpApi's `booking_request.url` is usually Google's `clk/f` endpoint that
  // requires a POST body (`post_data`) and 404s on a plain GET. When post_data
  // is present we resolve it server-side to the real provider URL first, then
  // open that. A bare url without post_data is a direct link we can open.
  const req = option.bookingRequest;
  const canBook = Boolean(req?.url);

  const openProviderError = () =>
    Alert.alert(
      t("flights.couldNotOpenProvider", { defaultValue: "Could not open provider" }),
      t("flights.tryAnotherOption", { defaultValue: "Please try another option." })
    );

  const onContinue = async () => {
    if (!req?.url || resolving) return;
    setResolving(true);
    try {
      let target = req.url;
      if (req.postData) {
        const resolved = await resolveBookingUrl({ url: req.url, postData: req.postData });
        if (resolved?.ok && resolved.url) {
          target = resolved.url;
        } else {
          openProviderError();
          return;
        }
      }
      await Linking.openURL(target);
    } catch {
      openProviderError();
    } finally {
      setResolving(false);
    }
  };

  const localEur = option.localPrices?.find((p) => p.currency === "EUR");
  const multiTraveler = Boolean(travelers && travelers > 1);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.logoRow}>
          {(option.airlineLogos ?? []).slice(0, 2).map((l, i) => (
            <Image key={i} source={{ uri: l }} style={styles.logo} />
          ))}
          {(option.airlineLogos ?? []).length === 0 && <View style={styles.logo} />}
        </View>
        <Text style={styles.provider} numberOfLines={1}>
          {option.bookWith ?? t("flights.provider", { defaultValue: "Provider" })}
        </Text>
        <View style={styles.priceCol}>
          <Text style={styles.price}>
            {option.price != null ? `€ ${Math.round(option.price).toLocaleString()}` : "—"}
          </Text>
          {multiTraveler && option.price != null && (
            <Text style={styles.priceCaption} numberOfLines={2}>
              {t("flights.perPersonAndTotal", {
                total: `€ ${Math.round(option.price * (travelers as number)).toLocaleString()}`,
                count: travelers,
                defaultValue: `per person · € ${Math.round(
                  option.price * (travelers as number)
                ).toLocaleString()} for ${travelers}`,
              })}
            </Text>
          )}
        </View>
      </View>

      {option.optionTitle && <Text style={styles.title}>{option.optionTitle}</Text>}

      {localEur && option.price != null && localEur.price !== option.price && (
        <Text style={styles.extension}>≈ EUR {Math.round(localEur.price).toLocaleString()}</Text>
      )}

      {(option.extensions ?? []).slice(0, 3).map((e, i) => (
        <Text key={i} style={styles.extension} numberOfLines={1}>
          • {e}
        </Text>
      ))}

      {canBook ? (
        <TouchableOpacity
          style={[styles.button, resolving && { opacity: 0.7 }]}
          onPress={onContinue}
          activeOpacity={0.85}
          disabled={resolving}
        >
          {resolving ? (
            <ActivityIndicator size="small" color="#1A1A1A" />
          ) : (
            <Text style={styles.buttonText}>
              {t("flights.continueToProvider", { defaultValue: "Continue to provider" })}
            </Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={[styles.button, styles.disabled]}>
          <Text style={styles.disabledText}>
            {t("flights.availabilityUnavailable", { defaultValue: "Availability check unavailable" })}
          </Text>
        </View>
      )}
    </View>
  );
};
