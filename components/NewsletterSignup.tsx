import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface NewsletterSignupProps {
  /** Pre-fill the email input (e.g. the logged-in user's email). */
  defaultEmail?: string;
  /** Where the signup came from (analytics/source tag). */
  source?: string;
}

/**
 * In-app newsletter opt-in card. Captures an email into the double opt-in
 * funnel (`api.newsletter.subscribe`) and shows a "check your inbox" state.
 */
export default function NewsletterSignup({
  defaultEmail,
  source = "app",
}: NewsletterSignupProps) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const subscribe = useMutation(api.newsletter.subscribe);

  const [email, setEmail] = useState(defaultEmail ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t("newsletter.invalidEmail"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      await subscribe({
        email: trimmed,
        source,
        language: i18n.language,
      });
      setStatus("success");
    } catch (e) {
      setError(t("newsletter.errorGeneric"));
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
          <Ionicons name="mail-open-outline" size={22} color="#1A1A1A" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          {t("newsletter.successTitle")}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t("newsletter.successBody")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
          <Ionicons name="paper-plane-outline" size={20} color="#1A1A1A" />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t("newsletter.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t("newsletter.subtitle")}
          </Text>
        </View>
      </View>

      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.inputBackground,
            borderColor: status === "error" ? colors.error : colors.border,
            color: colors.text,
          },
        ]}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (status === "error") setStatus("idle");
        }}
        placeholder={t("newsletter.emailPlaceholder")}
        placeholderTextColor={colors.textSecondary}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={status !== "loading"}
      />

      {status === "error" && !!error && (
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleSubmit}
        disabled={status === "loading"}
        activeOpacity={0.85}
      >
        {status === "loading" ? (
          <ActivityIndicator color="#1A1A1A" />
        ) : (
          <Text style={styles.buttonText}>{t("newsletter.subscribeButton")}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -4,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
  },
});
