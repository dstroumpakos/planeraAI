// Shown over the trip screen when a trip finishes generating while the user is
// watching: the boarding pass gets stamped, then it gets out of the way by
// itself (or on tap) to reveal the itinerary.

import { useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { PlaneraLottie } from "@/components/PlaneraLottie";

const LINGER_MS = 900;

interface TripReadyCelebrationProps {
    destination?: string;
    onDone: () => void;
}

export function TripReadyCelebration({ destination, onDone }: TripReadyCelebrationProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();

    useEffect(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, []);

    const handleFinish = useCallback(() => {
        setTimeout(onDone, LINGER_MS);
    }, [onDone]);

    return (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(250)} style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.background }]}>
            <Pressable style={styles.content} onPress={onDone} accessibilityRole="button">
                <PlaneraLottie name="trip-ready" size={280} onFinish={handleFinish} />
                <Text style={[styles.title, { color: colors.text }]}>
                    {t("tripDetail.tripReadyTitle", { defaultValue: "Your trip is ready!" })}
                </Text>
                {!!destination && (
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                        {t("tripDetail.tripReadySubtitle", {
                            destination,
                            defaultValue: `Your ${destination} itinerary is waiting.`,
                        })}
                    </Text>
                )}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        zIndex: 100,
        elevation: 100,
    },
    content: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
    },
    title: {
        fontSize: 26,
        fontWeight: "800",
        letterSpacing: -0.4,
        textAlign: "center",
        marginTop: 4,
    },
    subtitle: {
        fontSize: 16,
        textAlign: "center",
        marginTop: 8,
        lineHeight: 22,
    },
});
