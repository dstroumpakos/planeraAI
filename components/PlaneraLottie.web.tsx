// Web build: lottie-react-native needs extra web deps, so render the fallback
// (or reserve the space) and let one-shot flows continue.

import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export type PlaneraAnimationName =
    | "trip-generating"
    | "trip-ready"
    | "premium-unlocked"
    | "achievement-badge"
    | "radar-scan"
    | "empty-trips"
    | "loader-mark";

export interface PlaneraLottieProps {
    name: PlaneraAnimationName;
    size?: number;
    theme?: "auto" | "light" | "dark";
    loop?: boolean;
    autoPlay?: boolean;
    onFinish?: () => void;
    style?: StyleProp<ViewStyle>;
    fallback?: ReactNode;
}

export function PlaneraLottie({ size = 160, onFinish, style, fallback }: PlaneraLottieProps) {
    useEffect(() => {
        if (!onFinish) return;
        const timer = setTimeout(onFinish, 1200);
        return () => clearTimeout(timer);
    }, [onFinish]);

    if (fallback) return <>{fallback}</>;
    return <View style={[{ width: size, height: size }, style]} />;
}
