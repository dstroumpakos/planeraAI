import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

interface ActivityActionSheetProps {
    visible: boolean;
    activityTitle?: string;
    onClose: () => void;
    onEditTime: () => void;
    onReplaceAI: () => void;
    onAddAI: () => void;
    onAddManual: () => void;
    onMove: () => void;
    onRemove: () => void;
}

/**
 * Bottom-sheet action menu for a single itinerary activity. Replaces the old
 * 2-option long-press Alert with the full edit surface (edit time, replace,
 * add below, remove).
 */
export default function ActivityActionSheet({
    visible,
    activityTitle,
    onClose,
    onEditTime,
    onReplaceAI,
    onAddAI,
    onAddManual,
    onMove,
    onRemove,
}: ActivityActionSheetProps) {
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();

    const Row = ({
        icon,
        label,
        onPress,
        destructive,
    }: {
        icon: keyof typeof Ionicons.glyphMap;
        label: string;
        onPress: () => void;
        destructive?: boolean;
    }) => (
        <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => {
                onClose();
                // Defer the action until the sheet has begun closing so a follow-up
                // modal (edit-time / add) doesn't fight this one for the screen.
                setTimeout(onPress, 50);
            }}
            activeOpacity={0.7}
        >
            <Ionicons name={icon} size={22} color={destructive ? colors.error : colors.text} />
            <Text style={[styles.rowLabel, { color: destructive ? colors.error : colors.text }]}>{label}</Text>
        </TouchableOpacity>
    );

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable
                    style={[styles.sheet, { backgroundColor: colors.card }]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    {activityTitle ? (
                        <Text style={[styles.title, { color: colors.textMuted }]} numberOfLines={1}>
                            {activityTitle}
                        </Text>
                    ) : null}

                    <Row icon="time-outline" label={t("tripDetail.editTime")} onPress={onEditTime} />
                    <Row icon="sparkles-outline" label={t("tripDetail.replaceActivity")} onPress={onReplaceAI} />
                    <Row icon="add-circle-outline" label={t("tripDetail.addActivityAI")} onPress={onAddAI} />
                    <Row icon="create-outline" label={t("tripDetail.addActivityManual")} onPress={onAddManual} />
                    <Row icon="swap-vertical-outline" label={t("tripDetail.moveToDay")} onPress={onMove} />
                    <Row icon="trash-outline" label={t("tripDetail.removeActivity")} onPress={onRemove} destructive />

                    <TouchableOpacity
                        style={[styles.cancel, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}
                        onPress={onClose}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.cancelText, { color: colors.text }]}>{t("common.cancel")}</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "flex-end",
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 34,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        alignSelf: "center",
        marginBottom: 12,
    },
    title: {
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 8,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowLabel: {
        fontSize: 16,
        fontWeight: "500",
    },
    cancel: {
        marginTop: 16,
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: "center",
    },
    cancelText: {
        fontSize: 16,
        fontWeight: "700",
    },
});
