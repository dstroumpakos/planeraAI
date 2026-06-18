import React, { createContext, useContext, useRef, useCallback } from "react";
import { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

// Shared vertical offset for the floating tab bar. 0 = visible, positive = tucked
// off the bottom. Driven by scroll, read by FloatingTabBar.
const TabBarVisibilityContext = createContext<{ translateY: SharedValue<number> } | null>(null);

// How far to slide the bar down when hiding (bar height + safe-area headroom).
const HIDDEN_OFFSET = 130;

export function TabBarVisibilityProvider({ children }: { children: React.ReactNode }) {
    const translateY = useSharedValue(0);
    return <TabBarVisibilityContext.Provider value={{ translateY }}>{children}</TabBarVisibilityContext.Provider>;
}

export function useTabBarTranslateY(): SharedValue<number> | undefined {
    return useContext(TabBarVisibilityContext)?.translateY;
}

/**
 * Returns an onScroll handler that hides the floating tab bar when the user
 * scrolls down and reveals it when they scroll up (or reach the top). Attach to
 * a ScrollView/FlatList with `scrollEventThrottle={16}`.
 */
export function useHideTabBarOnScroll() {
    const translateY = useTabBarTranslateY();
    const lastY = useRef(0);
    return useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (!translateY) return;
            const y = e?.nativeEvent?.contentOffset?.y ?? 0;
            const dy = y - lastY.current;
            if (y <= 4) {
                translateY.value = withTiming(0, { duration: 180 });
            } else if (dy > 6) {
                translateY.value = withTiming(HIDDEN_OFFSET, { duration: 220 });
            } else if (dy < -6) {
                translateY.value = withTiming(0, { duration: 180 });
            }
            lastY.current = y;
        },
        [translateY]
    );
}
