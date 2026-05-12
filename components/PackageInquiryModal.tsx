/**
 * PackageInquiryModal — modal where a user submits an OTA package inquiry.
 * Collects name, email, phone, message, contact preference + consent.
 */

import React, { useState, useEffect } from "react";
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

interface Props {
    visible: boolean;
    onClose: () => void;
    packageInfo: {
        _id: string;
        title: string;
        partner: { _id: string; name: string };
    } | null;
    tripId?: string;
}

type ContactMethod = "email" | "phone" | "any";

export const PackageInquiryModal: React.FC<Props> = ({
    visible,
    onClose,
    packageInfo,
    tripId,
}) => {
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();
    const { token } = useToken();

    const userSettings = useQuery(
        (api as any).users.getSettings,
        token ? { token } : "skip",
    );

    const submitLeadMut = useMutation((api as any).otaPackages.submitLead);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [contactMethod, setContactMethod] = useState<ContactMethod>("any");
    const [message, setMessage] = useState("");
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (visible) {
            setName((userSettings as any)?.name ?? "");
            setEmail((userSettings as any)?.email ?? "");
            setPhone((userSettings as any)?.phone ?? "");
            setContactMethod("any");
            setMessage("");
            setConsent(false);
            setSubmitting(false);
            setSuccess(false);
        }
    }, [visible, userSettings]);

    const partnerName = packageInfo?.partner.name || "";

    const handleSubmit = async () => {
        if (!token || !packageInfo) return;
        if (!name.trim() || !email.trim()) {
            Alert.alert(t("packages.errorTitle"), t("packages.errorMessage"));
            return;
        }
        if (!consent) {
            Alert.alert(t("packages.errorTitle"), t("packages.consentRequired"));
            return;
        }
        setSubmitting(true);
        try {
            await submitLeadMut({
                token,
                packageId: packageInfo._id as Id<"otaPackages">,
                tripId: tripId ? (tripId as Id<"trips">) : undefined,
                contactName: name.trim(),
                contactEmail: email.trim(),
                contactPhone: phone.trim() || undefined,
                preferredContactMethod: contactMethod,
                message: message.trim() || undefined,
                consentGiven: true,
            });
            setSuccess(true);
        } catch (err: any) {
            Alert.alert(t("packages.errorTitle"), err?.message || t("packages.errorMessage"));
        } finally {
            setSubmitting(false);
        }
    };

    if (!packageInfo) return null;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    style={styles.kav}
                >
                    <View style={[styles.sheet, { backgroundColor: colors.card }]}>
                        {/* Header */}
                        <LinearGradient
                            colors={success ? ["#10b981", "#059669"] : ["#0ea5e9", "#6366f1"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.header}
                        >
                            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                <Ionicons name="close" size={22} color="#fff" />
                            </TouchableOpacity>
                            {!success ? (
                                <>
                                    <Text style={styles.headerTitle}>{t("packages.inquiryTitle")}</Text>
                                    <Text style={styles.headerSubtitle}>
                                        {t("packages.inquirySubtitle", { partner: partnerName })}
                                    </Text>
                                    <View style={styles.headerPkgPill}>
                                        <Ionicons name="briefcase" size={12} color="#fff" />
                                        <Text style={styles.headerPkgText} numberOfLines={1}>{packageInfo.title}</Text>
                                    </View>
                                </>
                            ) : (
                                <>
                                    <Text style={styles.successEmoji}>✈️</Text>
                                    <Text style={styles.headerTitle}>{t("packages.successTitle")}</Text>
                                </>
                            )}
                        </LinearGradient>

                        {success ? (
                            <View style={styles.successBody}>
                                <Text style={[styles.successText, { color: colors.text }]}>
                                    {t("packages.successMessage", { partner: partnerName })}
                                </Text>
                                <TouchableOpacity
                                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                                    onPress={onClose}
                                >
                                    <Text style={styles.primaryBtnText}>{t("packages.gotIt")}</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <ScrollView
                                style={styles.body}
                                contentContainerStyle={{ paddingBottom: 24 }}
                                keyboardShouldPersistTaps="handled"
                            >
                                {/* Name */}
                                <Text style={[styles.label, { color: colors.textMuted }]}>{t("packages.yourName")}</Text>
                                <TextInput
                                    value={name}
                                    onChangeText={setName}
                                    placeholder={t("packages.yourName")}
                                    placeholderTextColor={colors.textMuted}
                                    style={[styles.input, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border }]}
                                    autoCapitalize="words"
                                />

                                {/* Email */}
                                <Text style={[styles.label, { color: colors.textMuted }]}>{t("packages.yourEmail")}</Text>
                                <TextInput
                                    value={email}
                                    onChangeText={setEmail}
                                    placeholder="you@email.com"
                                    placeholderTextColor={colors.textMuted}
                                    style={[styles.input, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border }]}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />

                                {/* Phone */}
                                <Text style={[styles.label, { color: colors.textMuted }]}>{t("packages.yourPhone")}</Text>
                                <TextInput
                                    value={phone}
                                    onChangeText={setPhone}
                                    placeholder="+1 555 0100"
                                    placeholderTextColor={colors.textMuted}
                                    style={[styles.input, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border }]}
                                    keyboardType="phone-pad"
                                />

                                {/* Preferred contact */}
                                <Text style={[styles.label, { color: colors.textMuted }]}>
                                    {t("packages.preferredContact")}
                                </Text>
                                <View style={styles.segment}>
                                    {(["email", "phone", "any"] as ContactMethod[]).map((m) => {
                                        const active = contactMethod === m;
                                        const lbl = m === "email" ? "contactEmail" : m === "phone" ? "contactPhone" : "contactAny";
                                        return (
                                            <TouchableOpacity
                                                key={m}
                                                style={[
                                                    styles.segmentItem,
                                                    {
                                                        backgroundColor: active ? colors.primary : "transparent",
                                                        borderColor: active ? colors.primary : colors.border,
                                                    },
                                                ]}
                                                onPress={() => setContactMethod(m)}
                                            >
                                                <Text style={[styles.segmentText, { color: active ? "#fff" : colors.text }]}>
                                                    {t(`packages.${lbl}`)}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                {/* Message */}
                                <Text style={[styles.label, { color: colors.textMuted }]}>{t("packages.message")}</Text>
                                <TextInput
                                    value={message}
                                    onChangeText={setMessage}
                                    placeholder={t("packages.messagePlaceholder")}
                                    placeholderTextColor={colors.textMuted}
                                    style={[styles.input, styles.textarea, { backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb", color: colors.text, borderColor: colors.border }]}
                                    multiline
                                    numberOfLines={4}
                                    textAlignVertical="top"
                                />

                                {/* Consent */}
                                <TouchableOpacity
                                    style={[styles.consentRow, { borderColor: colors.border, backgroundColor: isDarkMode ? "rgba(255,255,255,0.03)" : "#f9fafb" }]}
                                    onPress={() => setConsent(!consent)}
                                    activeOpacity={0.8}
                                >
                                    <View style={[styles.checkbox, { borderColor: consent ? colors.primary : colors.border, backgroundColor: consent ? colors.primary : "transparent" }]}>
                                        {consent && <Ionicons name="checkmark" size={14} color="#fff" />}
                                    </View>
                                    <Text style={[styles.consentText, { color: colors.text }]}>
                                        {t("packages.consent", { partner: partnerName })}
                                    </Text>
                                </TouchableOpacity>

                                {/* Submit */}
                                <TouchableOpacity
                                    style={[
                                        styles.primaryBtn,
                                        { backgroundColor: consent ? colors.primary : (isDarkMode ? "rgba(255,255,255,0.1)" : "#e5e7eb") },
                                    ]}
                                    onPress={handleSubmit}
                                    disabled={submitting || !consent}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <>
                                            <Ionicons name="paper-plane" size={16} color="#fff" />
                                            <Text style={styles.primaryBtnText}>{t("packages.submit")}</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </ScrollView>
                        )}
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    kav: { flex: 1, justifyContent: "flex-end" },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: "92%",
        overflow: "hidden",
    },
    header: {
        paddingTop: 24,
        paddingBottom: 22,
        paddingHorizontal: 22,
    },
    closeBtn: {
        position: "absolute",
        top: 14,
        right: 14,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.2)",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1,
    },
    headerTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
    headerSubtitle: { color: "rgba(255,255,255,0.92)", fontSize: 13, marginTop: 4 },
    headerPkgPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: "rgba(255,255,255,0.18)",
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        marginTop: 12,
        maxWidth: "100%",
    },
    headerPkgText: { color: "#fff", fontSize: 12, fontWeight: "600", maxWidth: 240 },
    body: { paddingHorizontal: 20, paddingTop: 16 },
    label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6, marginTop: 14 },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
    },
    textarea: { minHeight: 88 },
    segment: {
        flexDirection: "row",
        gap: 8,
    },
    segmentItem: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
    },
    segmentText: { fontSize: 13, fontWeight: "600" },
    consentRow: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        marginTop: 18,
        alignItems: "flex-start",
    },
    checkbox: {
        width: 20, height: 20,
        borderRadius: 5,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 1,
    },
    consentText: { flex: 1, fontSize: 12, lineHeight: 17 },
    primaryBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 14,
        borderRadius: 14,
        marginTop: 22,
    },
    primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    successBody: { padding: 28, alignItems: "center", gap: 16 },
    successEmoji: { fontSize: 36, textAlign: "center", marginBottom: 6 },
    successText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
});

export default PackageInquiryModal;
