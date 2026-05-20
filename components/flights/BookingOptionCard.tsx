import React from "react";
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View, Alert } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import type { NormalizedBookingOption } from "@/types/flights";

interface Props {
  option: NormalizedBookingOption;
}

export const BookingOptionCard: React.FC<Props> = ({ option }) => {
  const { colors } = useTheme();

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
    price: { color: colors.text, fontWeight: "700", fontSize: 16 },
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

  // Some SerpApi booking options return `booking_request.post_data` instead of
  // a plain `url`. React Native cannot securely submit an external POST from
  // the device, so for MVP we only deep-link when `url` is present. A future
  // backend-rendered handoff page can fill the gap for POST-only providers.
  const url = option.bookingRequest?.url;
  const postOnly = !url && Boolean(option.bookingRequest?.postData);

  const onContinue = async () => {
    if (!url) return;
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        Alert.alert("Cannot open link", "This provider link cannot be opened.");
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Could not open provider", "Please try another option.");
    }
  };

  const localEur = option.localPrices?.find((p) => p.currency === "EUR");

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
          {option.bookWith ?? "Provider"}
        </Text>
        <Text style={styles.price}>
          {option.price != null ? `€ ${Math.round(option.price).toLocaleString()}` : "—"}
        </Text>
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

      {url ? (
        <TouchableOpacity style={styles.button} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Continue to provider</Text>
        </TouchableOpacity>
      ) : postOnly ? (
        <View style={[styles.button, styles.disabled]}>
          <Text style={styles.disabledText}>
            This provider requires an external booking handoff that is not available in the app yet.
          </Text>
        </View>
      ) : (
        <View style={[styles.button, styles.disabled]}>
          <Text style={styles.disabledText}>Check availability unavailable</Text>
        </View>
      )}
    </View>
  );
};
