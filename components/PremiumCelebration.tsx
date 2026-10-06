// Full-screen moment after a successful purchase: the padlock springs open and
// a crown bursts out, then the user continues.

import { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { PlaneraLottie } from "@/components/PlaneraLottie";

interface PremiumCelebrationProps {
    visible: boolean;
    title: string;
    subtitle: string;
    onContinue: () => void;
}

export function PremiumCelebration({ visible, title, subtitle, onContinue }: PremiumCelebrationProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const [showButton, setShowButton] = useState(false);

    useEffect(() => {
        if (!visible) {
            setShowButton(false);
            return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // Don't make anyone wait for the full animation to be able to move on.
        const timer = setTimeout(() => setShowButton(true), 1400);
        return () => clearTimeout(timer);
    }, [visible]);

    const handleFinish = useCallback(() => setShowButton(true), []);

    return (
        <Modal visible={visible} animationType="fade" onRequestClose={onContinue} statusBarTranslucent>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <PlaneraLottie name="premium-unlocked" size={300} onFinish={handleFinish} />
                <Animated.Text entering={FadeInDown.delay(900).duration(400)} style={[styles.title, { color: colors.text }]}>
                    {title}
                </Animated.Text>
                <Animated.Text entering={FadeInDown.delay(1050).duration(400)} style={[styles.subtitle, { color: colors.textMuted }]}>
                    {subtitle}
                </Animated.Text>
                <View style={styles.buttonSlot}>
                    {showButton && (
                        <Animated.View entering={FadeIn.duration(250)}>
                            <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={onContinue}>
                                <Text style={styles.buttonText}>{t("common.continue", { defaultValue: "Continue" })}</Text>
                            </TouchableOpacity>
                        </Animated.View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
    },
    title: {
        fontSize: 28,
        fontWeight: "800",
        letterSpacing: -0.4,
        textAlign: "center",
    },
    subtitle: {
        fontSize: 16,
        lineHeight: 22,
        textAlign: "center",
        marginTop: 8,
    },
    buttonSlot: {
        height: 56,
        marginTop: 32,
        alignSelf: "stretch",
        alignItems: "center",
    },
    button: {
        paddingHorizontal: 48,
        paddingVertical: 16,
        borderRadius: 14,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: "800",
        color: "#000",
    },
});
