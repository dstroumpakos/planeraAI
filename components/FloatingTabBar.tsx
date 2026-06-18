import React, { useEffect } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, withTiming, LinearTransition, FadeIn, FadeOut } from "react-native-reanimated";
import { useTheme } from "@/lib/ThemeContext";
import { useTabBarTranslateY } from "@/lib/tabBarVisibility";

// Icon set per tab route. `create` is the raised yellow center button.
const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap } | "create"> = {
    index: { active: "home", inactive: "home-outline" },
    trips: { active: "map", inactive: "map-outline" },
    create: "create",
    insights: { active: "globe", inactive: "globe-outline" },
    profile: { active: "person", inactive: "person-outline" },
};

const PILL_HEIGHT = 64;
const CREATE_SIZE = 56;
const ITEM_SPRING = LinearTransition.springify().damping(18).stiffness(190).mass(0.6);

/**
 * Floating pill tab bar (Instagram/Threads style): a rounded, translucent bar
 * detached from the screen edges. The active tab expands into a tinted
 * (brand-yellow) pill showing its icon + label while the rest stay icon-only,
 * and a prominent raised yellow "+" create button sits in the middle. The whole
 * bar tucks away on scroll-down and returns on scroll-up.
 */
export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const { colors, isDarkMode } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const translateY = useTabBarTranslateY();

    // Always reveal the bar when the active tab changes (it may have been tucked
    // away by scrolling on the previous screen).
    useEffect(() => {
        if (translateY) translateY.value = withTiming(0, { duration: 160 });
    }, [state.index]);

    const hideStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY ? translateY.value : 0 }],
    }));

    const handlePress = (routeName: string, routeKey: string, isFocused: boolean) => {
        Haptics.selectionAsync();
        if (routeName === "create") {
            router.push("/create-trip");
            return;
        }
        const event = navigation.emit({ type: "tabPress", target: routeKey, canPreventDefault: true });
        if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(routeName);
        }
    };

    return (
        <Animated.View
            style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }, hideStyle]}
            pointerEvents="box-none"
        >
            <View style={styles.shadowWrap}>
                <BlurView
                    intensity={Platform.OS === "android" ? 0 : 40}
                    tint="dark"
                    style={[
                        styles.pill,
                        {
                            backgroundColor: isDarkMode ? "rgba(20,20,22,0.84)" : "rgba(26,26,28,0.92)",
                            borderColor: "rgba(255,255,255,0.08)",
                        },
                    ]}
                >
                    {state.routes.map((route, index) => {
                        const cfg = TAB_ICONS[route.name];
                        const isFocused = state.index === index;
                        const { options } = descriptors[route.key];
                        const label = typeof options.title === "string" ? options.title : route.name;

                        // Center route reserves a fixed spacer; the raised button is on top.
                        if (cfg === "create") {
                            return <View key={route.key} style={styles.createSpacer} />;
                        }

                        return (
                            <TouchableOpacity
                                key={route.key}
                                accessibilityRole="button"
                                accessibilityState={isFocused ? { selected: true } : {}}
                                accessibilityLabel={label}
                                onPress={() => handlePress(route.name, route.key, isFocused)}
                                activeOpacity={0.7}
                                style={styles.slot}
                            >
                                <Animated.View
                                    layout={ITEM_SPRING}
                                    style={[
                                        styles.itemPill,
                                        isFocused && { backgroundColor: "rgba(255,229,0,0.16)", paddingHorizontal: 14 },
                                    ]}
                                >
                                    <Ionicons
                                        name={isFocused ? cfg.active : cfg.inactive}
                                        size={24}
                                        color={isFocused ? colors.primary : "rgba(235,235,245,0.55)"}
                                    />
                                    {isFocused && (
                                        <Animated.Text
                                            entering={FadeIn.duration(160)}
                                            exiting={FadeOut.duration(120)}
                                            numberOfLines={1}
                                            style={[styles.itemLabel, { color: colors.primary }]}
                                        >
                                            {label}
                                        </Animated.Text>
                                    )}
                                </Animated.View>
                            </TouchableOpacity>
                        );
                    })}
                </BlurView>

                {/* Raised yellow create button — centered on top of the pill. */}
                <View style={styles.createOverlay} pointerEvents="box-none">
                    <View style={[styles.createGlow, { backgroundColor: colors.primary }]} />
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Create trip"
                        onPress={() => handlePress("create", "create", false)}
                        activeOpacity={0.85}
                        style={[
                            styles.createBtn,
                            { backgroundColor: colors.primary, borderColor: isDarkMode ? "rgb(20,20,22)" : "rgb(26,26,28)" },
                        ]}
                    >
                        <Ionicons name="add" size={30} color="#1A1A1A" />
                    </TouchableOpacity>
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 18,
        alignItems: "center",
    },
    shadowWrap: {
        width: "100%",
        borderRadius: PILL_HEIGHT / 2,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
        elevation: 12,
    },
    pill: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: PILL_HEIGHT,
        borderRadius: PILL_HEIGHT / 2,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        overflow: "hidden",
    },
    slot: {
        alignItems: "center",
        justifyContent: "center",
    },
    itemPill: {
        flexDirection: "row",
        alignItems: "center",
        height: 44,
        paddingHorizontal: 12,
        borderRadius: 22,
    },
    itemLabel: {
        marginLeft: 7,
        fontSize: 14,
        fontWeight: "600",
    },
    createSpacer: {
        width: CREATE_SIZE,
        height: "100%",
    },
    createOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
    createGlow: {
        position: "absolute",
        width: CREATE_SIZE + 16,
        height: CREATE_SIZE + 16,
        borderRadius: (CREATE_SIZE + 16) / 2,
        opacity: 0.22,
        marginTop: -22,
    },
    createBtn: {
        width: CREATE_SIZE,
        height: CREATE_SIZE,
        borderRadius: CREATE_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        marginTop: -22, // raise above the pill
        borderWidth: 4, // ring that notches the button out of the bar
        shadowColor: "#FFE500",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 12,
        elevation: 8,
    },
});
