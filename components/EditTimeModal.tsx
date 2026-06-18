import React, { useState, useEffect } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

interface EditTimeModalProps {
    visible: boolean;
    initialStart?: string;
    initialEnd?: string;
    /** End time of the previous activity in the day, if any (for overlap check). */
    prevEnd?: string;
    /** Start time of the next activity in the day, if any (for overlap check). */
    nextStart?: string;
    onClose: () => void;
    onSave: (start: string, end: string) => void;
}

// Local, dependency-free parser: "09:00" / "9:00 AM" / "2:30 pm" → minutes.
function toMinutes(value: string | undefined): number | null {
    if (!value) return null;
    const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const mer = m[3]?.toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
}

const TIME_RE = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i;

/**
 * Edit an activity's start/end time. Allows any valid time but warns ("with
 * caution") when the new start overlaps the adjacent activities.
 */
export default function EditTimeModal({
    visible,
    initialStart,
    initialEnd,
    prevEnd,
    nextStart,
    onClose,
    onSave,
}: EditTimeModalProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const [start, setStart] = useState(initialStart || "");
    const [end, setEnd] = useState(initialEnd || "");

    useEffect(() => {
        if (visible) {
            setStart(initialStart || "");
            setEnd(initialEnd || "");
        }
    }, [visible, initialStart, initialEnd]);

    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    const startValid = start.trim() === "" || TIME_RE.test(start.trim());
    const endValid = end.trim() === "" || TIME_RE.test(end.trim());
    const formatError = !startValid || !endValid;

    // Overlap: starts before the previous activity ends, or starts after the
    // next activity already starts, or end is before start.
    const prevMin = toMinutes(prevEnd);
    const nextMin = toMinutes(nextStart);
    const overlaps =
        !formatError &&
        startMin != null &&
        ((prevMin != null && startMin < prevMin) ||
            (nextMin != null && startMin > nextMin) ||
            (endMin != null && endMin < startMin));

    const canSave = !formatError && start.trim() !== "";

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
                    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
                        <Text style={[styles.title, { color: colors.text }]}>{t("tripDetail.editTimeTitle")}</Text>

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.startTimeLabel")}</Text>
                        <TextInput
                            value={start}
                            onChangeText={setStart}
                            placeholder="09:00"
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                            autoCapitalize="none"
                            keyboardType="numbers-and-punctuation"
                        />

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.endTimeLabel")}</Text>
                        <TextInput
                            value={end}
                            onChangeText={setEnd}
                            placeholder="11:00"
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                            autoCapitalize="none"
                            keyboardType="numbers-and-punctuation"
                        />

                        <Text style={[styles.hint, { color: colors.textMuted }]}>{t("tripDetail.timeFormatHint")}</Text>

                        {formatError && (
                            <View style={styles.warnRow}>
                                <Ionicons name="alert-circle" size={16} color={colors.error} />
                                <Text style={[styles.warnText, { color: colors.error }]}>{t("tripDetail.invalidTimeFormat")}</Text>
                            </View>
                        )}
                        {!formatError && overlaps && (
                            <View style={styles.warnRow}>
                                <Ionicons name="warning" size={16} color="#F59E0B" />
                                <Text style={[styles.warnText, { color: "#F59E0B" }]}>{t("tripDetail.timeOverlapWarning")}</Text>
                            </View>
                        )}

                        <View style={styles.actions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                                <Text style={[styles.cancelText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.5 }]}
                                disabled={!canSave}
                                onPress={() => onSave(start.trim(), end.trim())}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.saveText}>{t("common.save")}</Text>
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
    title: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
    label: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 14 },
    hint: { fontSize: 12, marginBottom: 8 },
    warnRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
    warnText: { fontSize: 13, flex: 1 },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 16, marginTop: 8 },
    cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
    cancelText: { fontSize: 16, fontWeight: "600" },
    saveBtn: { paddingVertical: 11, paddingHorizontal: 24, borderRadius: 12 },
    saveText: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
});
