import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Share, Alert, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import * as Clipboard from "expo-clipboard";

export default function Referrals() {
  const router = useRouter();
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showApplyInput, setShowApplyInput] = useState(false);
  const [applyCode, setApplyCode] = useState("");

  const referralCode = useQuery(api.referrals.getMyReferralCode as any, token ? { token } : "skip");
  const stats = useQuery(api.referrals.getReferralStats as any, token ? { token } : "skip");
  const generateCode = useAuthenticatedMutation(api.referrals.generateReferralCode as any);
  const applyReferral = useAuthenticatedMutation(api.referrals.applyReferralCode as any);

  // Auto-generate code if not yet set
  useEffect(() => {
    if (referralCode === null && token) {
      generateCode({});
    }
  }, [referralCode, token]);

  const handleCopy = async () => {
    if (referralCode) {
      await Clipboard.setStringAsync(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (!referralCode) return;
    try {
      await Share.share({
        message: t("referrals.shareMessage", { code: referralCode }),
      });
    } catch { }
  };

  const handleApplyCode = async () => {
    if (!applyCode.trim()) return;
    try {
      const result = await applyReferral({ code: applyCode.trim() });
      if (result?.success) {
        Alert.alert(t("common.success"), t("referrals.codeApplied"));
        setShowApplyInput(false);
        setApplyCode("");
      } else {
        const reason = result?.reason || "unknown";
        const messages: Record<string, string> = {
          invalid_code: t("referrals.invalidCode"),
          already_used: t("referrals.alreadyUsed"),
          code_not_found: t("referrals.codeNotFound"),
          self_referral: t("referrals.selfReferral"),
        };
        Alert.alert(t("common.error"), messages[reason] || t("referrals.invalidCode"));
      }
    } catch (error) {
      Alert.alert(t("common.error"), t("referrals.invalidCode"));
    }
  };

  const styles = createStyles(colors, isDarkMode);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("referrals.title")}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {/* Hero section */}
          <View style={styles.heroCard}>
            <Ionicons name="gift" size={40} color={colors.primary} />
            <Text style={styles.heroTitle}>{t("referrals.inviteFriends")}</Text>
            <Text style={styles.heroSubtitle}>{t("referrals.rewardExplanation")}</Text>
          </View>

          {/* Referral Code */}
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>{t("referrals.yourCode")}</Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeText}>{referralCode || "..."}</Text>
              <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Share button */}
          <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
            <Ionicons name="share-social" size={20} color={colors.text} />
            <Text style={styles.shareButtonText}>{t("referrals.shareWithFriends")}</Text>
          </TouchableOpacity>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{stats?.totalInvited ?? 0}</Text>
              <Text style={styles.statLabel}>{t("referrals.invited")}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{stats?.totalCompleted ?? 0}</Text>
              <Text style={styles.statLabel}>{t("referrals.signedUp")}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{stats?.totalRewardsEarned ?? 0}</Text>
              <Text style={styles.statLabel}>{t("referrals.credits")}</Text>
            </View>
          </View>

          {/* Apply code */}
          {!showApplyInput ? (
            <TouchableOpacity style={styles.applyButton} onPress={() => setShowApplyInput(true)}>
              <Text style={styles.applyButtonText}>{t("referrals.haveCode")}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.applyCard}>
              <TextInput
                style={styles.applyInput}
                placeholder={t("referrals.enterCode")}
                placeholderTextColor={colors.textMuted}
                value={applyCode}
                onChangeText={(text) => setApplyCode(text.toUpperCase())}
                autoCapitalize="characters"
                maxLength={8}
              />
              <View style={styles.applyActions}>
                <TouchableOpacity
                  style={[styles.applyAction, { backgroundColor: colors.border }]}
                  onPress={() => { setShowApplyInput(false); setApplyCode(""); }}
                >
                  <Text style={{ color: colors.text }}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.applyAction, { backgroundColor: colors.primary }]} onPress={handleApplyCode}>
                  <Text style={{ color: colors.text, fontWeight: "600" }}>{t("referrals.apply")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Referral history */}
          {stats?.referrals && stats.referrals.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("referrals.history")}</Text>
              {stats.referrals.map((ref: any, i: number) => (
                <View key={i} style={styles.historyItem}>
                  <View
                    style={[
                      styles.historyDot,
                      {
                        backgroundColor:
                          ref.status === "completed" || ref.status === "rewarded"
                            ? "#10B981"
                            : "#F59E0B",
                      },
                    ]}
                  />
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyStatus}>
                      {ref.status === "pending" ? t("referrals.pending") : t("referrals.completed")}
                    </Text>
                    <Text style={styles.historyDate}>
                      {new Date(ref.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    content: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

    heroCard: {
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 28,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroTitle: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 12, textAlign: "center" },
    heroSubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: "center", lineHeight: 20 },

    codeCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 20,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    codeLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
    codeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    codeText: {
      fontSize: 28,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 3,
    },
    copyButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },

    shareButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      marginBottom: 20,
    },
    shareButtonText: { fontSize: 16, fontWeight: "700", color: colors.text },

    statsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    statBox: {
      flex: 1,
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statNumber: { fontSize: 24, fontWeight: "800", color: colors.text },
    statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },

    applyButton: { alignItems: "center", paddingVertical: 12 },
    applyButtonText: { fontSize: 14, color: colors.primary, fontWeight: "600" },

    applyCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    applyInput: {
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      padding: 14,
      fontSize: 18,
      color: colors.text,
      textAlign: "center",
      letterSpacing: 2,
      fontWeight: "700",
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    applyActions: { flexDirection: "row", gap: 10 },
    applyAction: {
      flex: 1,
      alignItems: "center",
      padding: 12,
      borderRadius: 10,
    },

    sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 8, marginBottom: 12 },

    historyItem: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
    },
    historyDot: { width: 10, height: 10, borderRadius: 5 },
    historyInfo: { flex: 1 },
    historyStatus: { fontSize: 14, fontWeight: "600", color: colors.text },
    historyDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  });
