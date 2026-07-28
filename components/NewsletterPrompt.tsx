import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTranslation } from "react-i18next";
import * as SecureStore from "expo-secure-store";
import * as Haptics from "expo-haptics";

// One-time flag so a user is never nagged twice, regardless of the outcome.
const SEEN_KEY = "newsletterPromptSeen";
// Small delay after the app settles so the prompt doesn't jar the first frame.
const SHOW_DELAY_MS = 2500;

/**
 * Fallback in-app newsletter opt-in for users who were NOT auto-enrolled at
 * signup (i.e. accounts created before auto-enrolment shipped, or signups where
 * no email was available). New signups are enrolled server-side and will report
 * status "active", so they never see this.
 *
 * Shows at most once (SecureStore-gated), only when the signed-in user has no
 * subscriber record ("none"). Single opt-in — tapping accept enrols them and
 * the welcome email goes out immediately. Never blocks or throws.
 */
export default function NewsletterPrompt() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const { token } = useToken();
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const status = useQuery(
    api.newsletter.myStatus,
    token ? { token } : "skip",
  );
  const subscribeMe = useMutation(api.newsletter.subscribeMe);

  useEffect(() => {
    if (!token || !status) return;
    if (status.status !== "none") return; // active / pending / unsubscribed → leave alone

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const seen = await SecureStore.getItemAsync(SEEN_KEY);
        if (seen || cancelled) return;
        timer = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, SHOW_DELAY_MS);
      } catch {
        // ignore — a marketing prompt must never break the app
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, status]);

  const markSeen = async () => {
    try {
      await SecureStore.setItemAsync(SEEN_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  const haptic = (style: Haptics.ImpactFeedbackStyle) => {
    if (Platform.OS !== "web") Haptics.impactAsync(style).catch(() => {});
  };

  const handleDismiss = async () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    await markSeen();
    setVisible(false);
  };

  const handleAccept = async () => {
    if (submitting) return;
    setSubmitting(true);
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    // Mark seen up-front so a network hiccup can't re-prompt them.
    await markSeen();
    try {
      await subscribeMe({
        token: token || "",
        language: i18n.language,
      });
      setDone(true);
    } catch {
      // Even on failure we close quietly — they can subscribe from Settings.
      setVisible(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.close}
            onPress={done ? () => setVisible(false) : handleDismiss}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={22} color="#9B9B9B" />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons
              name={done ? "checkmark" : "mail-open-outline"}
              size={30}
              color="#1A1A1A"
            />
          </View>

          {done ? (
            <>
              <Text style={styles.title}>{t("newsletter.promptDoneTitle")}</Text>
              <Text style={styles.body}>{t("newsletter.promptDoneBody")}</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => setVisible(false)}
              >
                <Text style={styles.primaryButtonText}>{t("common.done")}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>{t("newsletter.promptTitle")}</Text>
              <Text style={styles.body}>{t("newsletter.promptBody")}</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleAccept}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#1A1A1A" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {t("newsletter.promptAccept")}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.dismiss} onPress={handleDismiss}>
                <Text style={styles.dismissText}>
                  {t("newsletter.promptDismiss")}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    paddingTop: 28,
    alignItems: "center",
  },
  close: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 2,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 21,
    fontWeight: "800",
    color: "#1A1A1A",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#FFE500",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  dismiss: {
    paddingVertical: 14,
    alignItems: "center",
  },
  dismissText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9B9B9B",
  },
});
