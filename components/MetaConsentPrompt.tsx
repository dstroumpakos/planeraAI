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
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTranslation } from "react-i18next";
import { getMetaConsent, isMetaSdkConfigured, setMetaConsent } from "@/lib/metaSdk";

// Waits a little longer than NewsletterPrompt so the two never race.
const SHOW_DELAY_MS = 4000;

/**
 * One-time ad-measurement consent for the Meta SDK (see lib/metaSdk.ts).
 *
 * iOS: a short explainer whose only button opens Apple's tracking prompt.
 * Apple rejects pre-prompts with a decline button, so there is none here.
 * Android: Allow / Don't allow, equally prominent (GDPR).
 *
 * Shown once the user has decided nothing yet, and skipped on a launch where
 * the newsletter prompt is due, so two modals never stack.
 */
export default function MetaConsentPrompt() {
  const { t } = useTranslation();
  const { token } = useToken();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const newsletter = useQuery(api.newsletter.myStatus, token ? { token } : "skip");

  useEffect(() => {
    if (!token || !newsletter || !isMetaSdkConfigured()) return;
    if (newsletter.status === "none") return; // newsletter prompt has this launch

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const consent = await getMetaConsent();
      if (consent !== "undecided" || cancelled) return;
      timer = setTimeout(() => {
        if (!cancelled) setVisible(true);
      }, SHOW_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, newsletter]);

  const answer = async (granted: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await setMetaConsent(granted);
    } finally {
      setSubmitting(false);
      setVisible(false);
    }
  };

  if (!visible) return null;

  const isIOS = Platform.OS === "ios";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="stats-chart-outline" size={28} color="#1A1A1A" />
          </View>

          <Text style={styles.title}>{t("metaConsent.title")}</Text>
          <Text style={styles.body}>{t(isIOS ? "metaConsent.bodyIos" : "metaConsent.body")}</Text>

          <TouchableOpacity style={styles.primaryButton} onPress={() => answer(true)} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#1A1A1A" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {t(isIOS ? "metaConsent.continue" : "metaConsent.allow")}
              </Text>
            )}
          </TouchableOpacity>

          {!isIOS && (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => answer(false)} disabled={submitting}>
              <Text style={styles.secondaryButtonText}>{t("metaConsent.decline")}</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.footnote}>{t("metaConsent.footnote")}</Text>
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
  secondaryButton: {
    width: "100%",
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  footnote: {
    fontSize: 12,
    color: "#9B9B9B",
    textAlign: "center",
    lineHeight: 17,
    marginTop: 14,
  },
});
