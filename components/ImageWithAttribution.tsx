import React from "react";
import { View, Text, StyleSheet, Pressable, Linking, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

interface ImageWithAttributionProps {
  imageUrl: string;
  photographerName: string;
  photographerUrl?: string;
  downloadLocation?: string;
  onDownload?: () => void;
  onImagePress?: () => void;
  position?: "top" | "bottom";
}

export function ImageWithAttribution({
  imageUrl,
  photographerName,
  photographerUrl,
  downloadLocation,
  onDownload,
  onImagePress,
  position = "bottom",
}: ImageWithAttributionProps) {
  const handlePhotographerPress = async () => {
    if (!photographerUrl) return;
    try {
      await Linking.openURL(photographerUrl);
      if (onDownload && downloadLocation) {
        onDownload();
      }
    } catch (error) {
      console.error("Failed to open photographer URL:", error);
    }
  };

  const handleUnsplashPress = async () => {
    try {
      const unsplashUrl = photographerUrl
        ? `https://unsplash.com?utm_source=planera&utm_medium=referral`
        : "https://unsplash.com";
      await Linking.openURL(unsplashUrl);
    } catch (error) {
      console.error("Failed to open Unsplash URL:", error);
    }
  };

  const isTop = position === "top";

  return (
    <View style={styles.container}>
      <Image source={{ uri: imageUrl }} style={styles.image} />

      <Pressable
        style={[
          styles.imageTouchArea,
          isTop ? styles.imageTouchAreaTop : styles.imageTouchAreaBottom,
        ]}
        onPress={onImagePress}
        disabled={!onImagePress}
      />

      <LinearGradient
        colors={isTop ? ["rgba(0, 0, 0, 0.6)", "transparent"] : ["transparent", "rgba(0, 0, 0, 0.6)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.attributionOverlay,
          isTop ? styles.attributionTop : styles.attributionBottom,
        ]}
        pointerEvents="auto"
      >
        <View style={styles.attributionContent}>
          <Text style={styles.attributionText}>Photo by </Text>
          <Pressable
            onPress={handlePhotographerPress}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            {({ pressed }) => (
              <Text
                style={[
                  styles.attributionText,
                  styles.link,
                  pressed && styles.linkPressed,
                ]}
              >
                {photographerName}
              </Text>
            )}
          </Pressable>
          <Text style={styles.attributionText}> on </Text>
          <Pressable
            onPress={handleUnsplashPress}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            {({ pressed }) => (
              <Text
                style={[
                  styles.attributionText,
                  styles.link,
                  pressed && styles.linkPressed,
                ]}
              >
                Unsplash
              </Text>
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  image: {
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageTouchArea: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  imageTouchAreaTop: {
    top: 60,
    bottom: 0,
  },
  imageTouchAreaBottom: {
    top: 0,
    bottom: 60,
  },
  attributionOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 10,
    elevation: 10,
  },
  attributionTop: {
    top: 0,
  },
  attributionBottom: {
    bottom: 0,
  },
  attributionContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  attributionText: {
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 16,
  },
  link: {
    textDecorationLine: "underline",
  },
  linkPressed: {
    opacity: 0.7,
  },
});
