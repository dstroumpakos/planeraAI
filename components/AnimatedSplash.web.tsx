// Web build: no launch animation (lottie-react-native needs extra web deps).
// Hide the splash and get out of the way as soon as the app is ready.

import { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";

export const SPLASH_BACKGROUND = "#171717";

interface AnimatedSplashProps {
    appReady: boolean;
    onFinish: () => void;
}

export function AnimatedSplash({ appReady, onFinish }: AnimatedSplashProps) {
    useEffect(() => {
        if (!appReady) return;
        SplashScreen.hideAsync().catch(() => {});
        onFinish();
    }, [appReady, onFinish]);
    return null;
}
