// Branded Lottie animations (assets/animations/*.{light,dark}.json, generated
// by scripts/build-ui-animations.mjs). Picks the light/dark variant from the
// app theme unless told otherwise, and respects the OS reduced-motion setting.

import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import LottieView from "lottie-react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useTheme } from "@/lib/ThemeContext";

const SOURCES = {
    // Only shown on the dark generation screen; the light file is not bundled.
    "trip-generating": {
        light: require("@/assets/animations/trip-generating.dark.json"),
        dark: require("@/assets/animations/trip-generating.dark.json"),
    },
    "trip-ready": {
        light: require("@/assets/animations/trip-ready.light.json"),
        dark: require("@/assets/animations/trip-ready.dark.json"),
    },
    "premium-unlocked": {
        light: require("@/assets/animations/premium-unlocked.light.json"),
        dark: require("@/assets/animations/premium-unlocked.dark.json"),
    },
    "achievement-badge": {
        light: require("@/assets/animations/achievement-badge.light.json"),
        dark: require("@/assets/animations/achievement-badge.dark.json"),
    },
    "radar-scan": {
        light: require("@/assets/animations/radar-scan.light.json"),
        dark: require("@/assets/animations/radar-scan.dark.json"),
    },
    "empty-trips": {
        light: require("@/assets/animations/empty-trips.light.json"),
        dark: require("@/assets/animations/empty-trips.dark.json"),
    },
    "loader-mark": {
        light: require("@/assets/animations/loader-mark.light.json"),
        dark: require("@/assets/animations/loader-mark.dark.json"),
    },
} as const;

export type PlaneraAnimationName = keyof typeof SOURCES;

const LOOPING = new Set<PlaneraAnimationName>(["trip-generating", "radar-scan", "empty-trips", "loader-mark"]);

export interface PlaneraLottieProps {
    name: PlaneraAnimationName;
    size?: number;
    /** "auto" follows the app theme; force one when the backdrop is fixed. */
    theme?: "auto" | "light" | "dark";
    loop?: boolean;
    autoPlay?: boolean;
    /** One-shots only: fires when the animation ends (immediately under reduced motion). */
    onFinish?: () => void;
    style?: StyleProp<ViewStyle>;
    /** Rendered instead where Lottie isn't available (web). */
    fallback?: ReactNode;
}

export function PlaneraLottie({ name, size = 160, theme = "auto", loop, autoPlay = true, onFinish, style }: PlaneraLottieProps) {
    const { isDarkMode } = useTheme();
    const reduceMotion = useReducedMotion();
    const variant = theme === "auto" ? (isDarkMode ? "dark" : "light") : theme;
    const shouldLoop = loop ?? LOOPING.has(name);

    // Reduced motion: show a still frame, and let one-shot flows carry on.
    useEffect(() => {
        if (reduceMotion && !shouldLoop) onFinish?.();
    }, [reduceMotion, shouldLoop, onFinish]);

    return (
        <LottieView
            key={variant}
            source={SOURCES[name][variant]}
            autoPlay={autoPlay && !reduceMotion}
            loop={shouldLoop}
            progress={reduceMotion ? (shouldLoop ? 0.5 : 1) : undefined}
            onAnimationFinish={(isCancelled) => {
                if (!isCancelled) onFinish?.();
            }}
            style={[{ width: size, height: size }, style]}
            resizeMode="contain"
        />
    );
}
