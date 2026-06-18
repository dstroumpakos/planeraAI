import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

interface MoveToDayModalProps {
    visible: boolean;
    /** Total number of days in the trip. */
    dayCount: number;
    /** The day the activity currently lives on (disabled in the list). */
    currentDayIndex: number;
    onClose: () => void;
    /** Move to the END of the chosen day. */
    onSelectDay: (toDayIndex: number) => void;
}

/**
 * Reliable cross-day move: pick a destination day and the activity is appended
 * to it. Backs the same `moveActivity` mutation as drag-and-drop, and is the
 * accessible fallback when dragging across the long scrolling list is awkward.
 */
export default function MoveToDayModal({
    visible,
    dayCount,
    currentDayIndex,
    onClose,
    onSelectDay,
}: MoveToDayModalProps) {
    const { colors } = useTheme();
    const { t } = useTranslation();

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    <Text style={[styles.title, { color: colors.text }]}>{t("tripDetail.moveToDayTitle")}</Text>
                    <ScrollView style={{ maxHeight: 360 }}>
                        {Array.from({ length: dayCount }).map((_, i) => {
                            const isCurrent = i === currentDayIndex;
                            return (
                                <TouchableOpacity
                                    key={i}
                                    style={[styles.row, { borderBottomColor: colors.border, opacity: isCurrent ? 0.4 : 1 }]}
                                    disabled={isCurrent}
                                    onPress={() => {
                                        onClose();
                                        setTimeout(() => onSelectDay(i), 50);
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.rowLabel, { color: colors.text }]}>{t("tripDetail.day", { number: i + 1 })}</Text>
                                    {isCurrent ? (
                                        <Text style={[styles.currentTag, { color: colors.textMuted }]}>{t("tripDetail.moveCurrentDay")}</Text>
                                    ) : (
                                        <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                    <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
                        <Text style={[styles.cancelText, { color: colors.textMuted }]}>{t("common.cancel")}</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 },
    handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
    title: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
    rowLabel: { fontSize: 16, fontWeight: "500" },
    currentTag: { fontSize: 13 },
    cancel: { marginTop: 16, paddingVertical: 14, alignItems: "center" },
    cancelText: { fontSize: 16, fontWeight: "700" },
});
