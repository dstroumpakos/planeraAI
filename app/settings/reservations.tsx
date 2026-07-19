import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Alert, ActivityIndicator, Modal } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api } from "@/convex/_generated/api";
import { groupJourneyLegs } from "@/convex/helpers/tripMatch";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useMemo } from "react";

const TYPE_META: Record<string, { icon: any; color: string }> = {
    flight: { icon: "airplane", color: "#3B82F6" },
    hotel: { icon: "bed", color: "#8B5CF6" },
    car: { icon: "car-sport", color: "#F59E0B" },
    rail: { icon: "train", color: "#10B981" },
    ferry: { icon: "boat", color: "#0EA5E9" },
    activity: { icon: "ticket", color: "#EC4899" },
    restaurant: { icon: "restaurant", color: "#EF4444" },
    other: { icon: "document-text", color: "#6B7280" },
};

function formatWhen(startAt?: number, endAt?: number): string {
    if (!startAt) return "";
    const start = new Date(startAt);
    const dateOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

    if (!endAt) {
        return `${start.toLocaleDateString(undefined, dateOpts)} · ${start.toLocaleTimeString(undefined, timeOpts)}`;
    }

    const end = new Date(endAt);
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
        return `${start.toLocaleDateString(undefined, dateOpts)} · ${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleTimeString(undefined, timeOpts)}`;
    }
    return `${start.toLocaleDateString(undefined, dateOpts)} → ${end.toLocaleDateString(undefined, dateOpts)}`;
}

export default function Reservations() {
    const router = useRouter();
    const { token } = useToken();
    const { isDarkMode, colors } = useTheme();
    const { t } = useTranslation();

    const data = useQuery(api.reservations.listMine as any, token ? { token } : "skip");
    const ensureAddress = useAuthenticatedMutation(api.reservations.ensureInboundAddress as any);
    const confirmReservation = useAuthenticatedMutation(api.reservations.confirmReservation as any);
    const rejectReservation = useAuthenticatedMutation(api.reservations.rejectReservation as any);
    const assignToTrip = useAuthenticatedMutation(api.reservations.assignToTrip as any);

    const [address, setAddress] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pickerFor, setPickerFor] = useState<any | null>(null);

    const trips = useQuery(api.trips.list as any, token ? { token } : "skip");

    // Mint the forwarding address on first open.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!token || address) return;
            try {
                const result = await ensureAddress({});
                if (!cancelled && result?.alias) {
                    setAddress(`${result.alias}@${result.domain}`);
                }
            } catch {
                // Non-fatal: the list still works without the address card.
            }
        })();
        return () => { cancelled = true; };
    }, [token, address, ensureAddress]);

    const handleCopy = useCallback(async () => {
        if (!address) return;
        await Clipboard.setStringAsync(address);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [address]);

    // Every action applies to the whole booking. Confirming an outbound flight
    // but not its return would leave half a journey in review.
    const handleConfirm = useCallback(async (group: any) => {
        setBusyId(group.key);
        try {
            if (group.legs.some((leg: any) => !leg.tripId)) {
                // Nothing to attach it to yet — ask where it belongs first.
                setPickerFor(group);
                return;
            }
            for (const leg of group.legs) {
                await confirmReservation({ reservationId: leg._id });
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) {
            Alert.alert(t("common.error"), e?.message ?? "Could not confirm this booking.");
        } finally {
            setBusyId(null);
        }
    }, [confirmReservation, t]);

    const handleReject = useCallback(async (group: any) => {
        setBusyId(group.key);
        try {
            for (const leg of group.legs) {
                await rejectReservation({ reservationId: leg._id });
            }
        } catch (e: any) {
            Alert.alert(t("common.error"), e?.message ?? "Could not dismiss this booking.");
        } finally {
            setBusyId(null);
        }
    }, [rejectReservation, t]);

    /**
     * Encode an instant the way create-trip's own time picker does: the local
     * wall-clock hours the user sees, carried on a UTC instant so the server
     * reads back the same hours regardless of timezone. Anything else would
     * shift a 21:10 landing by the device's offset.
     */
    const toWallClockIso = useCallback((ms?: number): string | undefined => {
        if (!ms) return undefined;
        const d = new Date(ms);
        return new Date(Date.UTC(
            d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0
        )).toISOString();
    }, []);

    /**
     * A booking we could not match is the strongest trip-creation signal in the
     * app: a real reservation, to a real place, on dates the user already
     * committed to. Send them into create-trip with all of it filled in.
     *
     * A round trip prefills the real window: outbound departure to return
     * arrival. A one-way has no return to end on, and create-trip defaults a
     * missing end date to "a week from today" — which for a future flight lands
     * BEFORE the start — so we derive a week from the booking instead.
     */
    const handlePlanTrip = useCallback((group: any) => {
        setPickerFor(null);
        setBusyId(null);
        const params: Record<string, string> = {};
        if (group?.destination) params.prefilledDestination = group.destination;
        if (group?.startAt) {
            params.prefilledStartDate = String(group.startAt);
            params.prefilledEndDate = String(
                group.endAt && group.endAt > group.startAt
                    ? group.endAt
                    : group.startAt + 7 * 24 * 60 * 60 * 1000
            );
        }
        // Real flight times beat any default: landing at 22:45 and flying out at
        // 06:00 changes what the first and last day can hold.
        const arrival = toWallClockIso(group?.arrivalAt);
        const departure = toWallClockIso(group?.departureAt);
        if (arrival) params.prefilledArrivalTime = arrival;
        if (departure) params.prefilledDepartureTime = departure;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/create-trip", params } as any);
    }, [router, toWallClockIso]);

    const handlePickTrip = useCallback(async (tripId: string | null) => {
        const group = pickerFor;
        setPickerFor(null);
        if (!group) return;
        try {
            for (const leg of group.legs) {
                if (tripId) {
                    await confirmReservation({ reservationId: leg._id, tripId });
                } else {
                    // Confirm as a standalone booking, unattached to any trip.
                    await assignToTrip({ reservationId: leg._id });
                    await confirmReservation({ reservationId: leg._id });
                }
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) {
            Alert.alert(t("common.error"), e?.message ?? "Could not save this booking.");
        } finally {
            setBusyId(null);
        }
    }, [pickerFor, confirmReservation, assignToTrip, t]);

    const items = data?.items ?? [];
    // Group within a status, never across one: a cancelled outbound must not be
    // folded into a still-active return.
    const byStatus = useCallback(
        (status: string) => groupJourneyLegs(items.filter((i: any) => i.status === status)),
        [items]
    );
    const needsReview = useMemo(() => byStatus("needs_review"), [byStatus]);
    const confirmed = useMemo(() => byStatus("confirmed"), [byStatus]);
    const cancelled = useMemo(() => byStatus("cancelled"), [byStatus]);

    const renderCard = (group: any, showActions: boolean) => {
        const item = group.legs[0];
        const meta = TYPE_META[item.type] ?? TYPE_META.other;
        const busy = busyId === group.key;
        const multiLeg = group.legs.length > 1;
        // Any leg from an unverified sender taints the booking.
        const unverified = group.legs.some((leg: any) => leg.senderVerified === false);
        // Legs of one booking share a trip; the first one speaks for all.
        const trip = group.legs.find((leg: any) => leg.trip)?.trip ?? null;

        return (
            <View
                key={group.key}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
                <View style={styles.cardHeader}>
                    <View style={[styles.typeIcon, { backgroundColor: meta.color + "22" }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.color} />
                    </View>
                    <View style={styles.cardHeaderText}>
                        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                            {group.label}
                        </Text>
                        <Text style={[styles.cardProvider, { color: colors.textMuted }]} numberOfLines={1}>
                            {[
                                group.isRoundTrip
                                    ? t("reservations.roundTrip", { defaultValue: "Round trip" })
                                    : multiLeg
                                        ? t("reservations.legCount", { count: group.legs.length, defaultValue: "{{count}} flights" })
                                        : null,
                                item.provider,
                            ].filter(Boolean).join(" · ")}
                        </Text>
                    </View>
                    {unverified && (
                        <View style={styles.unverifiedPill}>
                            <Ionicons name="alert-circle-outline" size={12} color="#B45309" />
                            <Text style={styles.unverifiedText}>{t("reservations.unverified", { defaultValue: "Unverified sender" })}</Text>
                        </View>
                    )}
                </View>

                {/* One row per leg, so a round trip reads as an itinerary. */}
                {multiLeg && (
                    <View style={styles.legList}>
                        {group.legs.map((leg: any) => (
                            <View key={leg._id} style={styles.legRow}>
                                <Ionicons name="ellipse" size={6} color={meta.color} />
                                <Text style={[styles.legTitle, { color: colors.text }]} numberOfLines={1}>
                                    {leg.title}
                                </Text>
                                <Text style={[styles.legWhen, { color: colors.textMuted }]} numberOfLines={1}>
                                    {formatWhen(leg.startAt, leg.endAt)}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}

                <View style={styles.metaRow}>
                    {!multiLeg && !!item.startAt && (
                        <View style={styles.metaItem}>
                            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                            <Text style={[styles.metaText, { color: colors.textMuted }]}>
                                {formatWhen(item.startAt, item.endAt)}
                            </Text>
                        </View>
                    )}
                    {!!item.confirmationCode && (
                        <View style={styles.metaItem}>
                            <Ionicons name="barcode-outline" size={13} color={colors.textMuted} />
                            <Text style={[styles.metaText, { color: colors.textMuted }]}>{item.confirmationCode}</Text>
                        </View>
                    )}
                    {typeof group.price === "number" && (
                        <View style={styles.metaItem}>
                            <Ionicons name="pricetag-outline" size={13} color={colors.textMuted} />
                            <Text style={[styles.metaText, { color: colors.textMuted }]}>
                                {group.currency === "EUR" ? "€" : (group.currency ? group.currency + " " : "")}{group.price}
                            </Text>
                        </View>
                    )}
                </View>

                {trip ? (
                    <TouchableOpacity
                        style={styles.tripLink}
                        onPress={() => router.push(`/trip/${trip._id}` as any)}
                    >
                        <Ionicons name="link-outline" size={13} color={colors.text} />
                        <Text style={[styles.tripLinkText, { color: colors.text }]} numberOfLines={1}>
                            {trip.destination}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.unmatchedRow}>
                        <Text style={[styles.unmatchedText, { color: colors.textMuted }]}>
                            {t("reservations.noTripYet", { defaultValue: "Not linked to a trip yet" })}
                        </Text>
                        {item.status !== "cancelled" && (
                            <TouchableOpacity
                                style={[styles.planTripBtn, { borderColor: meta.color + "55", backgroundColor: meta.color + "14" }]}
                                onPress={() => handlePlanTrip(group)}
                            >
                                <Ionicons name="sparkles-outline" size={13} color={meta.color} />
                                <Text style={[styles.planTripText, { color: meta.color }]} numberOfLines={1}>
                                    {group.destination
                                        ? t("reservations.planTripTo", {
                                            destination: group.destination,
                                            defaultValue: "Plan your {{destination}} trip",
                                        })
                                        : t("reservations.planTripGeneric", { defaultValue: "Plan a trip around this" })}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {showActions && (
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.actionBtn, styles.rejectBtn, { borderColor: colors.border }]}
                            onPress={() => handleReject(group)}
                            disabled={busy}
                        >
                            <Text style={[styles.rejectText, { color: colors.textMuted }]}>
                                {t("reservations.dismiss", { defaultValue: "Dismiss" })}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.actionBtn, styles.confirmBtn]}
                            onPress={() => handleConfirm(group)}
                            disabled={busy}
                        >
                            {busy ? (
                                <ActivityIndicator size="small" color="#1A1A1A" />
                            ) : (
                                <Text style={styles.confirmText}>
                                    {group.legs.every((leg: any) => leg.tripId)
                                        ? t("reservations.addToTrip", { defaultValue: "Add to trip" })
                                        : t("reservations.chooseTrip", { defaultValue: "Choose trip" })}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={26} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {t("reservations.title", { defaultValue: "Bookings" })}
                </Text>
                <View style={styles.backBtn} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* Forwarding address */}
                <View style={[styles.addressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.addressLabel, { color: colors.textMuted }]}>
                        {t("reservations.forwardLabel", { defaultValue: "FORWARD CONFIRMATIONS TO" })}
                    </Text>
                    {address ? (
                        <TouchableOpacity onPress={handleCopy} style={styles.addressRow}>
                            <Text style={[styles.addressText, { color: colors.text }]} numberOfLines={1}>
                                {address}
                            </Text>
                            <Ionicons
                                name={copied ? "checkmark-circle" : "copy-outline"}
                                size={20}
                                color={copied ? "#10B981" : colors.textMuted}
                            />
                        </TouchableOpacity>
                    ) : (
                        <ActivityIndicator size="small" color={colors.textMuted} style={{ alignSelf: "flex-start", marginTop: 8 }} />
                    )}
                    <Text style={[styles.addressHint, { color: colors.textMuted }]}>
                        {t("reservations.forwardHint", {
                            defaultValue: "Forward any flight, hotel or ticket confirmation. We read the details and slot it into the right day.",
                        })}
                    </Text>
                </View>

                {data === undefined && (
                    <ActivityIndicator size="small" color={colors.textMuted} style={{ marginTop: 32 }} />
                )}

                {data !== undefined && items.length === 0 && (
                    <View style={styles.empty}>
                        <Ionicons name="mail-open-outline" size={44} color={colors.textMuted} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>
                            {t("reservations.emptyTitle", { defaultValue: "No bookings yet" })}
                        </Text>
                        <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                            {t("reservations.emptyBody", {
                                defaultValue: "Forward your first confirmation to the address above and it'll show up here within a minute.",
                            })}
                        </Text>
                    </View>
                )}

                {needsReview.length > 0 && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                            {t("reservations.needsReview", { defaultValue: "Needs review" })} ({needsReview.length})
                        </Text>
                        <Text style={[styles.sectionHint, { color: colors.textMuted }]}>
                            {t("reservations.needsReviewHint", {
                                defaultValue: "Check we read these correctly before they join your itinerary.",
                            })}
                        </Text>
                        {needsReview.map((item: any) => renderCard(item, true))}
                    </View>
                )}

                {confirmed.length > 0 && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                            {t("reservations.confirmed", { defaultValue: "Confirmed" })}
                        </Text>
                        {confirmed.map((item: any) => renderCard(item, false))}
                    </View>
                )}

                {cancelled.length > 0 && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                            {t("reservations.cancelled", { defaultValue: "Cancelled" })}
                        </Text>
                        {cancelled.map((item: any) => renderCard(item, false))}
                    </View>
                )}

                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Trip picker */}
            <Modal visible={!!pickerFor} transparent animationType="slide" onRequestClose={() => { setPickerFor(null); setBusyId(null); }}>
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {t("reservations.whichTrip", { defaultValue: "Which trip is this for?" })}
                        </Text>
                        <ScrollView style={{ maxHeight: 320 }}>
                            {(trips ?? []).map((trip: any) => (
                                <TouchableOpacity
                                    key={trip._id}
                                    style={[styles.tripOption, { borderBottomColor: colors.border }]}
                                    onPress={() => handlePickTrip(trip._id)}
                                >
                                    <Text style={[styles.tripOptionText, { color: colors.text }]} numberOfLines={1}>
                                        {trip.destination}
                                    </Text>
                                    <Text style={[styles.tripOptionDate, { color: colors.textMuted }]}>
                                        {new Date(trip.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        {/* None of the listed trips fit — the way out is a new one. */}
                        <TouchableOpacity
                            style={[styles.modalCreate, { borderColor: colors.border }]}
                            onPress={() => handlePlanTrip(pickerFor)}
                        >
                            <Ionicons name="add-circle-outline" size={18} color="#F5C451" />
                            <Text style={[styles.modalCreateText, { color: colors.text }]} numberOfLines={1}>
                                {pickerFor?.destination
                                    ? t("reservations.createTripTo", {
                                        destination: pickerFor.destination,
                                        defaultValue: "Create a trip to {{destination}}",
                                    })
                                    : t("reservations.createTripGeneric", { defaultValue: "Create a new trip" })}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.modalSecondary} onPress={() => handlePickTrip(null)}>
                            <Text style={[styles.modalSecondaryText, { color: colors.textMuted }]}>
                                {t("reservations.keepStandalone", { defaultValue: "Keep as a standalone booking" })}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.modalCancel} onPress={() => { setPickerFor(null); setBusyId(null); }}>
                            <Text style={[styles.modalCancelText, { color: colors.text }]}>
                                {t("common.cancel", { defaultValue: "Cancel" })}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontWeight: "600" },
    scroll: { padding: 16 },

    addressCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
    addressLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
    addressRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 8,
    },
    addressText: { fontSize: 16, fontWeight: "600", flex: 1 },
    addressHint: { fontSize: 13, lineHeight: 18, marginTop: 10 },

    section: { marginTop: 28 },
    sectionTitle: { fontSize: 18, fontWeight: "700" },
    sectionHint: { fontSize: 13, marginTop: 4, marginBottom: 12 },

    card: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 10 },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    typeIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    cardHeaderText: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
    cardProvider: { fontSize: 13, marginTop: 2 },
    unverifiedPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: "#FEF3C7",
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
    },
    unverifiedText: { fontSize: 10, fontWeight: "600", color: "#B45309" },

    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    metaText: { fontSize: 12.5 },

    tripLink: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
    tripLinkText: { fontSize: 13, fontWeight: "600" },
    legList: { marginTop: 10, gap: 6 },
    legRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    legTitle: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
    legWhen: { fontSize: 12, marginLeft: "auto" },

    unmatchedRow: { marginTop: 10 },
    unmatchedText: { fontSize: 12.5, fontStyle: "italic" },
    planTripBtn: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        marginTop: 8,
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 9,
        borderWidth: 1,
    },
    planTripText: { fontSize: 12.5, fontWeight: "700", flexShrink: 1 },

    actions: { flexDirection: "row", gap: 10, marginTop: 14 },
    actionBtn: { flex: 1, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    rejectBtn: { borderWidth: 1 },
    rejectText: { fontSize: 14, fontWeight: "600" },
    confirmBtn: { backgroundColor: "#FFE500" },
    confirmText: { fontSize: 14, fontWeight: "700", color: "#1A1A1A" },

    empty: { alignItems: "center", paddingTop: 56, paddingHorizontal: 24 },
    emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 14 },
    emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 6 },

    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    modalSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
    modalTitle: { fontSize: 17, fontWeight: "700", marginBottom: 12 },
    tripOption: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tripOptionText: { fontSize: 15, fontWeight: "600", flex: 1 },
    tripOptionDate: { fontSize: 13 },
    modalCreate: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginTop: 8,
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
    },
    modalCreateText: { fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
    modalSecondary: { paddingVertical: 14, alignItems: "center" },
    modalSecondaryText: { fontSize: 14, fontWeight: "600" },
    modalCancel: { paddingVertical: 12, alignItems: "center" },
    modalCancelText: { fontSize: 15, fontWeight: "600" },
});
