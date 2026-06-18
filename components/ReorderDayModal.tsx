import React, { useState, useEffect, useRef } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, Animated, PanResponder } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

const ROW_HEIGHT = 64;

interface ReorderDayModalProps {
    visible: boolean;
    dayNumber: number;
    activities: any[];
    onClose: () => void;
    /** Persist a single move within the day (from index -> to index). */
    onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * Drag-to-reorder the activities of one day. Uses RN-core PanResponder (no
 * gesture-handler root wrapper required) + Animated. Fixed-height compact rows
 * so the drop-target maths stay simple and robust: the lifted row follows the
 * finger and an insertion line marks where it lands; on release we persist a
 * single moveActivity(from, to).
 */
export default function ReorderDayModal({
    visible,
    dayNumber,
    activities,
    onClose,
    onReorder,
}: ReorderDayModalProps) {
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();

    // Local working copy so reorders feel instant; resynced when reopened.
    const [items, setItems] = useState<any[]>(activities);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [hoverIndex, setHoverIndex] = useState<number>(0);

    const dragY = useRef(new Animated.Value(0)).current;
    // Mirror state into refs so the PanResponder closures (created once) read
    // current values without being recreated on every render.
    const itemsRef = useRef(items);
    const draggingRef = useRef<number | null>(null);
    const hoverRef = useRef(0);
    itemsRef.current = items;

    useEffect(() => {
        if (visible) {
            setItems(activities);
            setDraggingIndex(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

    const makePanResponder = (startIndex: number) =>
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                draggingRef.current = startIndex;
                hoverRef.current = startIndex;
                setDraggingIndex(startIndex);
                setHoverIndex(startIndex);
                dragY.setValue(0);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            },
            onPanResponderMove: (_evt, gesture) => {
                dragY.setValue(gesture.dy);
                const len = itemsRef.current.length;
                const target = clamp(Math.round(startIndex + gesture.dy / ROW_HEIGHT), 0, len - 1);
                if (target !== hoverRef.current) {
                    hoverRef.current = target;
                    setHoverIndex(target);
                }
            },
            onPanResponderRelease: () => {
                const from = startIndex;
                const to = hoverRef.current;
                draggingRef.current = null;
                setDraggingIndex(null);
                if (to !== from) {
                    const next = [...itemsRef.current];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    setItems(next);
                    onReorder(from, to);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                dragY.setValue(0);
            },
            onPanResponderTerminate: () => {
                draggingRef.current = null;
                setDraggingIndex(null);
                dragY.setValue(0);
            },
        });

    // PanResponders are stable per mounted row; recreate when item count changes.
    const responders = useRef<ReturnType<typeof makePanResponder>[]>([]);
    if (responders.current.length !== items.length) {
        responders.current = items.map((_, i) => makePanResponder(i));
    }

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    <Text style={[styles.title, { color: colors.text }]}>
                        {t("tripDetail.reorderDayTitle", { number: dayNumber })}
                    </Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t("tripDetail.reorderHint")}</Text>

                    <View style={[styles.list, { height: Math.max(items.length, 1) * ROW_HEIGHT }]}>
                        {items.map((act, i) => {
                            const isDragging = draggingIndex === i;
                            const showIndicatorAbove = draggingIndex !== null && hoverIndex === i && i !== draggingIndex;
                            return (
                                <React.Fragment key={act?.id || `${i}-${act?.title || ""}`}>
                                    {showIndicatorAbove && (
                                        <View style={[styles.indicator, { top: i * ROW_HEIGHT, backgroundColor: colors.primary }]} />
                                    )}
                                    <Animated.View
                                        style={[
                                            styles.row,
                                            {
                                                top: i * ROW_HEIGHT,
                                                backgroundColor: colors.card,
                                                borderColor: colors.border,
                                            },
                                            isDragging && {
                                                transform: [{ translateY: dragY }, { scale: 1.03 }],
                                                zIndex: 100,
                                                elevation: 8,
                                                shadowColor: "#000",
                                                shadowOpacity: isDarkMode ? 0.5 : 0.2,
                                                shadowRadius: 8,
                                                shadowOffset: { width: 0, height: 4 },
                                                opacity: 0.97,
                                            },
                                        ]}
                                    >
                                        <View style={styles.rowInner}>
                                            <Text style={[styles.rowTime, { color: colors.textMuted }]} numberOfLines={1}>
                                                {act?.startTime || act?.time || ""}
                                            </Text>
                                            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                                                {act?.title || t("tripDetail.activity")}
                                            </Text>
                                            <View style={styles.dragHandle} {...responders.current[i].panHandlers}>
                                                <Ionicons name="reorder-three" size={24} color={colors.textMuted} />
                                            </View>
                                        </View>
                                    </Animated.View>
                                </React.Fragment>
                            );
                        })}
                    </View>

                    <TouchableOpacity style={[styles.done, { backgroundColor: colors.primary }]} onPress={onClose} activeOpacity={0.8}>
                        <Text style={styles.doneText}>{t("common.done")}</Text>
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
    title: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
    subtitle: { fontSize: 13, marginBottom: 14 },
    list: { position: "relative", marginBottom: 16 },
    row: {
        position: "absolute",
        left: 0,
        right: 0,
        height: ROW_HEIGHT - 8,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: "center",
        paddingHorizontal: 14,
    },
    rowInner: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowTime: { fontSize: 13, width: 56 },
    rowTitle: { flex: 1, fontSize: 15, fontWeight: "500" },
    dragHandle: { paddingHorizontal: 4, paddingVertical: 8 },
    indicator: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, zIndex: 50 },
    done: { paddingVertical: 14, borderRadius: 14, alignItems: "center" },
    doneText: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
});
