// Animated launch screen — plays assets/animations/splash.json over the app on
// cold start (a plane traces the mark, which then settles into the "Planera"
// lockup), then fades away once both the animation and the app are ready.
//
// The native splash (app.json) is a plain #171717 screen with no logo, which is
// exactly the animation's first frame, so the hand-off is invisible.
// Regenerate the animation with `node scripts/build-splash-lottie.mjs`.

import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import LottieView from "lottie-react-native";
import * as SplashScreen from "expo-splash-screen";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

export const SPLASH_BACKGROUND = "#171717";

// Never hold the user on the splash longer than this, even if Lottie stalls.
const MAX_ANIMATION_MS = 5000;
// …and if the app never reports ready (e.g. a crash behind the ErrorBoundary),
// get out of the way so its error screen is reachable.
const MAX_OVERLAY_MS = 10000;
const FADE_MS = 350;

interface AnimatedSplashProps {
    /** True once the app underneath can be shown. */
    appReady: boolean;
    /** Called after the overlay has faded out — unmount it then. */
    onFinish: () => void;
}

export function AnimatedSplash({ appReady, onFinish }: AnimatedSplashProps) {
    const { width } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const [animationDone, setAnimationDone] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const hidingRef = useRef(false);
    const opacity = useSharedValue(1);
    const scale = useSharedValue(1);

    // Swap the native splash for this overlay as soon as it is on screen.
    const handleLayout = useCallback(() => {
        SplashScreen.hideAsync().catch(() => {});
    }, []);

    const finishAnimation = useCallback(() => setAnimationDone(true), []);

    // Safety net: a missing/broken animation must never block launch.
    useEffect(() => {
        const timer = setTimeout(finishAnimation, reduceMotion ? 600 : MAX_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [finishAnimation, reduceMotion]);

    useEffect(() => {
        const timer = setTimeout(() => setTimedOut(true), MAX_OVERLAY_MS);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (hidingRef.current) return;
        if (!timedOut && !(animationDone && appReady)) return;
        hidingRef.current = true;
        scale.value = withTiming(1.06, { duration: FADE_MS });
        opacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
            if (finished) runOnJS(onFinish)();
        });
    }, [animationDone, appReady, timedOut, onFinish, opacity, scale]);

    const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
    const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    // The finished lockup spans 86% of the animation's square canvas.
    const size = Math.min(width - 32, 480);

    return (
        <Animated.View
            style={[StyleSheet.absoluteFill, styles.container, containerStyle]}
            onLayout={handleLayout}
            pointerEvents="none"
            accessible
            accessibilityLabel="Planera"
        >
            <Animated.View style={logoStyle}>
                <LottieView
                    source={require("@/assets/animations/splash.json")}
                    // Reduced motion: skip straight to the finished lockup.
                    autoPlay={!reduceMotion}
                    progress={reduceMotion ? 1 : undefined}
                    loop={false}
                    onAnimationFinish={finishAnimation}
                    onAnimationFailure={finishAnimation}
                    style={{ width: size, height: size }}
                    resizeMode="contain"
                />
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: SPLASH_BACKGROUND,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        elevation: 1000,
    },
});
