import React, { useState, useEffect } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

export interface ManualActivityInput {
    title: string;
    description: string;
    time: string;
    startTime: string;
    type: string;
}

interface AddActivityModalProps {
    visible: boolean;
    onClose: () => void;
    onAdd: (activity: ManualActivityInput) => void;
}

const TYPES = ["attraction", "restaurant", "museum", "tour", "free", "local-experience"];
const TIME_RE = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i;

/** Manual entry form for adding a user-authored activity to a day. */
export default function AddActivityModal({ visible, onClose, onAdd }: AddActivityModalProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [time, setTime] = useState("");
    const [type, setType] = useState("attraction");

    useEffect(() => {
        if (visible) {
            setTitle("");
            setDescription("");
            setTime("");
            setType("attraction");
        }
    }, [visible]);

    const timeValid = time.trim() === "" || TIME_RE.test(time.trim());
    const canAdd = title.trim() !== "" && timeValid;

    const handleAdd = () => {
        const cleanTime = time.trim();
        onAdd({
            title: title.trim(),
            description: description.trim(),
            time: cleanTime,
            startTime: cleanTime,
            type,
        });
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
                    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
                        <Text style={[styles.title, { color: colors.text }]}>{t("tripDetail.addActivityTitle")}</Text>

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.activityNameLabel")}</Text>
                        <TextInput
                            value={title}
                            onChangeText={setTitle}
                            placeholder={t("tripDetail.activityTitlePlaceholder")}
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                        />

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.startTimeLabel")}</Text>
                        <TextInput
                            value={time}
                            onChangeText={setTime}
                            placeholder="14:00"
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                            autoCapitalize="none"
                            keyboardType="numbers-and-punctuation"
                        />

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.activityDescLabel")}</Text>
                        <TextInput
                            value={description}
                            onChangeText={setDescription}
                            placeholder={t("tripDetail.activityDescPlaceholder")}
                            placeholderTextColor={colors.textMuted}
                            style={[styles.input, styles.multiline, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                            multiline
                        />

                        <Text style={[styles.label, { color: colors.textMuted }]}>{t("tripDetail.activityTypeLabel")}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: 8 }}>
                            {TYPES.map((ty) => (
                                <TouchableOpacity
                                    key={ty}
                                    style={[
                                        styles.chip,
                                        { borderColor: colors.border, backgroundColor: type === ty ? colors.text : "transparent" },
                                    ]}
                                    onPress={() => setType(ty)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={{ color: type === ty ? colors.card : colors.textMuted, fontSize: 13, fontWeight: "600" }}>
                                        {t(`tripDetail.activityType_${ty.replace("-", "_")}`, { defaultValue: ty })}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        <View style={styles.actions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                                <Text style={[styles.cancelText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.addBtn, { backgroundColor: colors.primary, opacity: canAdd ? 1 : 0.5 }]}
                                disabled={!canAdd}
                                onPress={handleAdd}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.addText}>{t("tripDetail.addActivityConfirm")}</Text>
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
    multiline: { minHeight: 70, textAlignVertical: "top" },
    chips: { marginBottom: 18 },
    chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 16 },
    cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
    cancelText: { fontSize: 16, fontWeight: "600" },
    addBtn: { paddingVertical: 11, paddingHorizontal: 24, borderRadius: 12 },
    addText: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
});
