// Full-screen / section loading indicator: the Planera mark drawing itself.
// Use it in place of a large ActivityIndicator; keep small inline spinners
// (buttons, rows) as ActivityIndicator.

import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import { PlaneraLottie } from "@/components/PlaneraLottie";

interface BrandLoaderProps {
    size?: number;
    /** Force a variant when the backdrop doesn't follow the app theme. */
    theme?: "auto" | "light" | "dark";
    style?: StyleProp<ViewStyle>;
}

export function BrandLoader({ size = 72, theme = "auto", style }: BrandLoaderProps) {
    const { colors } = useTheme();
    return (
        <View style={[styles.wrap, style]} accessibilityRole="progressbar" accessibilityLabel="Loading">
            <PlaneraLottie
                name="loader-mark"
                size={size}
                theme={theme}
                fallback={<ActivityIndicator size="large" color={colors.primary} />}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: "center",
        justifyContent: "center",
    },
});
