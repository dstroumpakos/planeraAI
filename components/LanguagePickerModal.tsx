import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { SUPPORTED_LANGUAGES, saveLanguagePreference } from "@/lib/i18n";

interface LanguagePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export function LanguagePickerModal({ visible, onDismiss }: LanguagePickerModalProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { token } = useToken();
  // @ts-ignore - updateAppSettings exists in Convex backend
  const updateAppSettings = useMutation(api.users.updateAppSettings);
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || "en");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await i18n.changeLanguage(selectedLanguage);
      // Persist language locally so it survives app restarts
      await saveLanguagePreference(selectedLanguage);
      await updateAppSettings({
        token: token || "",
        language: selectedLanguage,
        currency: "USD",
      });
      onDismiss();
    } catch (error) {
      console.error("Language save failed:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Globe icon */}
          <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
            <Ionicons name="language" size={32} color="#1A1A1A" />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {t("languagePicker.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t("languagePicker.subtitle")}
          </Text>

          {/* Language list */}
          <View style={styles.languageList}>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = selectedLanguage === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.languageItem,
                    { borderColor: isSelected ? colors.primary : colors.border },
                    isSelected && { backgroundColor: colors.secondary },
                  ]}
                  onPress={() => setSelectedLanguage(lang.code)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.flag}>{lang.flag}</Text>
                  <Text style={[styles.langName, { color: colors.text }]}>
                    {lang.nativeName}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={styles.saveButtonText}>
              {saving ? t("common.saving") : t("languagePicker.save")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  container: {
    width: width - 48,
    maxWidth: 400,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  languageList: {
    width: "100%",
    gap: 8,
    marginBottom: 20,
  },
  languageItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  flag: {
    fontSize: 22,
    marginRight: 12,
  },
  langName: {
    fontSize: 16,
    fontWeight: "500",
    flex: 1,
  },
  saveButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
  },
});
