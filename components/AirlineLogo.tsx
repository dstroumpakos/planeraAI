import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import { resolveAirlineLogo } from "@/lib/airlineLogos";

interface AirlineLogoProps {
  airline?: string;
  /** Provider-supplied logo URL, when the deal has one. */
  logo?: string;
  /** Used to derive the carrier code when `logo` is missing. */
  flightNumber?: string;
  size?: number;
}

/**
 * Carrier logo chip. Renders on a white plate in both themes — most airline
 * logos are dark-on-transparent and disappear against a dark card.
 *
 * Falls back to the airline's initial when the carrier isn't one we can resolve
 * (or the image 404s), so the slot never renders as an empty box.
 */
export function AirlineLogo({ airline, logo, flightNumber, size = 34 }: AirlineLogoProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);

  const uri = useMemo(
    () => resolveAirlineLogo({ airlineLogo: logo, flightNumber, airline }),
    [logo, flightNumber, airline]
  );

  const plate = {
    width: size,
    height: size,
    borderRadius: size / 4,
    borderColor: colors.border,
  };

  if (!uri || failed) {
    const initial = airline?.trim().charAt(0).toUpperCase();
    if (!initial) return null;
    return (
      <View style={[styles.plate, plate, { backgroundColor: colors.card }]}>
        <Text style={[styles.initial, { color: colors.textMuted, fontSize: size * 0.45 }]}>
          {initial}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.plate, plate]}>
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="contain"
        onError={() => setFailed(true)}
        accessibilityLabel={airline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: "#FFF",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 3,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  initial: {
    fontWeight: "800",
  },
});
