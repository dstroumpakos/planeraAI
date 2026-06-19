import React, { useEffect, useRef, useState } from "react";
import { View, TouchableOpacity, StyleSheet, Platform, LayoutChangeEvent } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
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
const PILL_PAD = 8;
const HILITE_W = 50;
const HILITE_H = 42;
const CREATE_SIZE = 56;
const SPRING = { damping: 16, stiffness: 180, mass: 0.7 };

/** A single tab icon that springs up in scale when it becomes active. */
function TabIcon({
    focused,
    activeIcon,
    inactiveIcon,
    activeColor,
}: {
    focused: boolean;
    activeIcon: keyof typeof Ionicons.glyphMap;
    inactiveIcon: keyof typeof Ionicons.glyphMap;
    activeColor: string;
}) {
    const scale = useSharedValue(focused ? 1.1 : 1);
    useEffect(() => {
        scale.value = withSpring(focused ? 1.1 : 1, SPRING);
    }, [focused]);
    const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    return (
        <Animated.View style={style}>
            <Ionicons
                name={focused ? activeIcon : inactiveIcon}
                size={25}
                color={focused ? activeColor : "rgba(235,235,245,0.55)"}
            />
        </Animated.View>
    );
}

/**
 * Floating pill tab bar (Instagram/Threads style): a rounded, translucent bar
 * detached from the screen edges, icon-only, with a brand-tinted highlight that
 * springs across to the active tab and a prominent raised yellow "+" create
 * button in the middle. The whole bar tucks away on scroll-down, returns on
 * scroll-up. Equal-width slots keep spacing even and never collide with the "+".
 */
export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const { colors, isDarkMode } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const translateY = useTabBarTranslateY();

    const [pillWidth, setPillWidth] = useState(0);
    const measured = useRef(false);
    const routeCount = state.routes.length;
    const createIndex = state.routes.findIndex((r) => r.name === "create");
    const slotWidth = pillWidth > 0 ? (pillWidth - PILL_PAD * 2) / routeCount : 0;

    const highlightX = useSharedValue(0);
    const highlightOpacity = useSharedValue(0);
    const targetX = (index: number) => PILL_PAD + index * slotWidth + (slotWidth - HILITE_W) / 2;

    useEffect(() => {
        if (slotWidth <= 0) return;
        const onCreate = state.index === createIndex;
        const x = targetX(state.index);
        if (!measured.current) {
            highlightX.value = x;
            highlightOpacity.value = onCreate ? 0 : 1;
            measured.current = true;
        } else {
            highlightX.value = withSpring(x, SPRING);
            highlightOpacity.value = withTiming(onCreate ? 0 : 1, { duration: 140 });
        }
    }, [state.index, slotWidth]);

    // Reveal the bar whenever the active tab changes (it may have been hidden).
    useEffect(() => {
        if (translateY) translateY.value = withTiming(0, { duration: 160 });
    }, [state.index]);

    const highlightStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: highlightX.value }],
        opacity: highlightOpacity.value,
    }));
    const hideStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY ? translateY.value : 0 }],
    }));

    const onLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - pillWidth) > 0.5) setPillWidth(w);
    };

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
                    onLayout={onLayout}
                >
                    {/* Sliding brand-tinted highlight behind the active icon. */}
                    {slotWidth > 0 && (
                        <Animated.View
                            pointerEvents="none"
                            style={[styles.highlight, { backgroundColor: "rgba(255,229,0,0.16)" }, highlightStyle]}
                        />
                    )}

                    {state.routes.map((route, index) => {
                        const cfg = TAB_ICONS[route.name];
                        const isFocused = state.index === index;
                        const { options } = descriptors[route.key];

                        // Center route reserves an equal empty slot; button drawn on top.
                        if (cfg === "create") {
                            return <View key={route.key} style={styles.slot} />;
                        }

                        return (
                            <TouchableOpacity
                                key={route.key}
                                accessibilityRole="button"
                                accessibilityState={isFocused ? { selected: true } : {}}
                                accessibilityLabel={typeof options.title === "string" ? options.title : route.name}
                                onPress={() => handlePress(route.name, route.key, isFocused)}
                                activeOpacity={0.7}
                                style={styles.slot}
                            >
                                <TabIcon
                                    focused={isFocused}
                                    activeIcon={cfg.active}
                                    inactiveIcon={cfg.inactive}
                                    activeColor={colors.primary}
                                />
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
        height: PILL_HEIGHT,
        borderRadius: PILL_HEIGHT / 2,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: PILL_PAD,
        overflow: "hidden",
    },
    highlight: {
        position: "absolute",
        left: 0,
        top: (PILL_HEIGHT - HILITE_H) / 2,
        width: HILITE_W,
        height: HILITE_H,
        borderRadius: 16,
    },
    slot: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
    },
    createOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
    createGlow: {
        position: "absolute",
        width: CREATE_SIZE + 18,
        height: CREATE_SIZE + 18,
        borderRadius: (CREATE_SIZE + 18) / 2,
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
        shadowOpacity: 0.5,
        shadowRadius: 12,
        elevation: 8,
    },
});
