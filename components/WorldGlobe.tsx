/**
 * WorldGlobe — the interactive map that visualizes a user's WorldPrint.
 *
 * Uses react-native-maps with a dark "night globe" style. Verified cities
 * glow in the user's signature color; planned cities glow dimmer; claimed
 * (unverified) ones are ghostly dots.
 */

import React, { useMemo, useRef } from "react";
import { View, StyleSheet, Text, Platform } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, Region } from "react-native-maps";

export type GlobeVisit = {
  cityId: string;
  city: {
    id: string;
    name: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  };
  status: "claimed" | "planned" | "verified" | "holographic";
};

type Props = {
  visits: GlobeVisit[];
  signatureColor: string;
  // 0 = fully bright, 1 = completely dim (from the streak dim logic).
  dimLevel?: number;
  onCityPress?: (cityId: string) => void;
  initialRegion?: Region;
  style?: any;
};

// Dark "night earth" custom style — minimal, landmass-first, for the globe feel.
const NIGHT_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0B1220" }] },
  { elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1E2A3A" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#2A3A55" }] },
  { featureType: "landscape", stylers: [{ color: "#111B2E" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050A14" }] },
];

function statusOpacity(status: GlobeVisit["status"], dimLevel: number): number {
  const base =
    status === "holographic" ? 1 :
    status === "verified" ? 1 :
    status === "planned" ? 0.55 :
    0.25;
  return Math.max(0.1, base * (1 - dimLevel));
}

function statusSize(status: GlobeVisit["status"]): number {
  if (status === "holographic") return 20;
  if (status === "verified") return 16;
  if (status === "planned") return 12;
  return 10;
}

export default function WorldGlobe({
  visits,
  signatureColor,
  dimLevel = 0,
  onCityPress,
  initialRegion,
  style,
}: Props) {
  const mapRef = useRef<MapView>(null);

  const region: Region = useMemo(() => {
    if (initialRegion) return initialRegion;
    if (visits.length === 0) {
      return { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 };
    }
    // Center on average, with big delta for globe feel
    const avgLat = visits.reduce((s, v) => s + v.city.lat, 0) / visits.length;
    const avgLng = visits.reduce((s, v) => s + v.city.lng, 0) / visits.length;
    return { latitude: avgLat, longitude: avgLng, latitudeDelta: 100, longitudeDelta: 100 };
  }, [visits, initialRegion]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={region}
        customMapStyle={NIGHT_STYLE}
        showsCompass={false}
        showsScale={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={true}
        pitchEnabled={false}
        mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
      >
        {visits.map((v) => {
          const opacity = statusOpacity(v.status, dimLevel);
          const size = statusSize(v.status);
          const color = v.status === "claimed" ? "#94A3B8" : signatureColor;
          return (
            <Marker
              key={v.cityId}
              coordinate={{ latitude: v.city.lat, longitude: v.city.lng }}
              onPress={() => onCityPress?.(v.cityId)}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.markerWrap}>
                {/* Outer glow */}
                <View
                  style={[
                    styles.glow,
                    {
                      width: size * 2.2,
                      height: size * 2.2,
                      borderRadius: size * 1.1,
                      backgroundColor: color,
                      opacity: opacity * 0.25,
                    },
                  ]}
                />
                {/* Core dot */}
                <View
                  style={[
                    styles.dot,
                    {
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      backgroundColor: color,
                      opacity,
                      borderColor:
                        v.status === "holographic" ? "#FFFFFF" : "rgba(255,255,255,0.4)",
                      borderWidth: v.status === "holographic" ? 2 : 1,
                    },
                  ]}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Corner overlay: dim-level hint */}
      {dimLevel > 0.3 && (
        <View style={styles.dimHint} pointerEvents="none">
          <Text style={styles.dimHintText}>Your globe is fading ✦</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050A14" },
  map: { ...StyleSheet.absoluteFillObject },
  markerWrap: { alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute" },
  dot: {},
  dimHint: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  dimHintText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
