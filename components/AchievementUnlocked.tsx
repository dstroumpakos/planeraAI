import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef, useCallback } from "react";
import * as Location from "expo-location";

export default function AchievementUnlocked() {
  const { token } = useToken();
  const { colors, isDarkMode } = useTheme();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [badge, setBadge] = useState<any>(null);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

  // Check location permission on mount and when app returns to foreground
  const checkPerm = useCallback(async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  useEffect(() => { checkPerm(); }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") checkPerm(); });
    return () => sub.remove();
  }, []);

  const data = useQuery(api.achievements.getUserAchievements as any, token ? { token } : "skip");
  const markSeen = useAuthenticatedMutation(api.achievements.markAchievementSeen as any);

  useEffect(() => {
    if (!data?.achievements || locationGranted !== true) return;
    const unseen = data.achievements.find((a: any) => a.unlocked && !a.seen);
    if (unseen && !visible) {
      setBadge(unseen);
      setVisible(true);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  }, [data?.achievements, locationGranted]);

  const handleDismiss = async () => {
    if (badge && token) {
      await markSeen({ achievementId: badge.id });
    }
    Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setVisible(false);
      setBadge(null);
    });
  };

  if (!visible || !badge) return null;

  const styles = createStyles(colors, isDarkMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleDismiss}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.confetti}>🎉</Text>
          <View style={styles.iconCircle}>
            <Ionicons name={badge.icon as any} size={36} color={colors.primary} />
          </View>
          <Text style={styles.unlockLabel}>{t("achievements.newBadge")}</Text>
          <Text style={styles.title}>{t(badge.titleKey)}</Text>
          <Text style={styles.description}>{t(badge.descriptionKey)}</Text>
          <TouchableOpacity style={styles.dismissButton} onPress={handleDismiss}>
            <Text style={styles.dismissText}>{t("common.ok")}</Text>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "center",
      alignItems: "center",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 24,
      padding: 32,
      alignItems: "center",
      width: "80%",
      borderWidth: 1,
      borderColor: colors.primary,
    },
    confetti: { fontSize: 32, marginBottom: 8 },
    iconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary + "30",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    unlockLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.primary,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 4,
    },
    title: { fontSize: 20, fontWeight: "800", color: colors.text, marginBottom: 8, textAlign: "center" },
    description: { fontSize: 14, color: colors.textSecondary, textAlign: "center", marginBottom: 20 },
    dismissButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 12,
    },
    dismissText: { fontSize: 16, fontWeight: "700", color: colors.text },
  });
