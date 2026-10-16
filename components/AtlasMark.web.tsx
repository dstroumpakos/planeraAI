// Web build: lottie-react-native needs extra web deps, so Atlas falls back to a
// static globe icon in the matching colour.

import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const COLORS = { yellow: "#FFE500", grey: "#8D8D92", ink: "#1A1A1A" } as const;

export type AtlasMarkColor = keyof typeof COLORS;
export type AtlasMarkIntro = "hop" | "wave";

export interface AtlasMarkProps {
    size: number;
    color: AtlasMarkColor;
    intro?: AtlasMarkIntro | null;
    busy?: boolean;
    idleWave?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function AtlasMark({ size, color, style }: AtlasMarkProps) {
    return (
        <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
            <Ionicons name="globe" size={size * 0.7} color={COLORS[color]} />
        </View>
    );
}
