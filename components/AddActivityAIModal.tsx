import React, { useState, useEffect } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

export interface AIActivityRequest {
    request: string;
    preferredTime: string;
}

interface AddActivityAIModalProps {
    visible: boolean;
    dayNumber?: number;
    onClose: () => void;
    onSubmit: (input: AIActivityRequest) => void;
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const EXAMPLE_KEYS = ["aiAddExample1", "aiAddExample2", "aiAddExample3"];

/**
 * "Add with AI" prompt: the traveler describes what they want to see or do on
 * this day and the AI finds a real matching place and slots it into the day.
 */
export default function AddActivityAIModal({ visible, dayNumber, onClose, onSubmit }: AddActivityAIModalProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const [request, setRequest] = useState("");
    const [time, setTime] = useState("");

    useEffect(() => {
        if (visible) {
            setRequest("");
            setTime("");
        }
    }, [visible]);

    const timeValid = time.trim() === "" || TIME_RE.test(time.trim());
    const canSubmit = request.trim().length >= 2 && timeValid;

    const handleSubmit = () => {
        if (!canSubmit) return;
        onSubmit({ request: request.trim(), preferredTime: time.trim() });
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
                    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
                        <View style={styles.header}>
                            <Ionicons name="sparkles" size={18} color={colors.primary} />
                            <Text style={[styles.title, { color: colors.text }]}>
                                {dayNumber ? t("tripDetail.aiAddTitleDay", { number: dayNumber }) : t("tripDetail.aiAddTitle")}
                            </Text>
                        </View>
                        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t("tripDetail.aiAddSubtitle")}</Text>

                        <TextInput
                            value={request}
                            onChangeText={setRequest}
                            placeholder={t("tripDetail.aiAddPlaceholder")}
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                            multiline
                            maxLength={300}
                            autoFocus
                        />

                        <View style={styles.examples}>
                            {EXAMPLE_KEYS.map((key) => (
                                <TouchableOpacity
                                    key={key}
                                    style={[styles.chip, { borderColor: colors.border }]}
                                    onPress={() => setRequest(t(`tripDetail.${key}`))}
                                    activeOpacity={0.7}
                                >
                                    <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: "600" }}>{t(`tripDetail.${key}`)}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.aiAddTimeLabel")}</Text>
                        <TextInput
                            value={time}
                            onChangeText={setTime}
                            placeholder="14:00"
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: timeValid ? colors.border : "#E5484D" }]}
                            autoCapitalize="none"
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                        />

                        <View style={styles.actions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                                <Text style={[styles.cancelText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.addBtn, { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 }]}
                                disabled={!canSubmit}
                                onPress={handleSubmit}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="sparkles" size={15} color="#1A1A1A" />
                                <Text style={styles.addText}>{t("tripDetail.aiAddConfirm")}</Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </KeyboardAvoidingView>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
    center: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
    card: { borderRadius: 18, padding: 20 },
    header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    title: { fontSize: 18, fontWeight: "700" },
    subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
    label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 14 },
    multiline: { minHeight: 80, textAlignVertical: "top" },
    examples: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -4, marginBottom: 16 },
    chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 16 },
    cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
    cancelText: { fontSize: 16, fontWeight: "600" },
    addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 20, borderRadius: 12 },
    addText: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
});
