import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useState, useEffect } from "react";
import * as Notifications from "expo-notifications";
import { registerForPushNotificationsAsync } from "@/lib/useNotifications";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import NewsletterSignup from "@/components/NewsletterSignup";

export default function NotificationsScreen() {
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();
    const { token } = useToken();
    const settings = useQuery(api.users.getSettings as any, { token: token || "skip" });
    const updateNotifications = useMutation(api.users.updateNotifications);
    const registerPushToken = useMutation((api as any).notifications.registerPushToken);
    const removePushToken = useMutation((api as any).notifications.removePushToken);

    const [pushNotifications, setPushNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [dealAlerts, setDealAlerts] = useState(true);
    const [tripReminders, setTripReminders] = useState(true);
    const [permissionStatus, setPermissionStatus] = useState<string | null>(null);

    useEffect(() => {
        if (settings) {
            setPushNotifications(settings.pushNotifications ?? true);
            setEmailNotifications(settings.emailNotifications ?? true);
            setDealAlerts(settings.dealAlerts ?? true);
            setTripReminders(settings.tripReminders ?? true);
        }
    }, [settings]);

    // Check device notification permission on mount
    useEffect(() => {
        Notifications.getPermissionsAsync().then(({ status }) => {
            setPermissionStatus(status);
        });
    }, []);

    const handleTogglePush = async (value: boolean) => {
        if (value) {
            // Turning ON - request device permission if not granted
            const { status } = await Notifications.getPermissionsAsync();
            if (status === "denied") {
                Alert.alert(
                    t('settings.notifications.notificationsDisabled'),
                    t('settings.notifications.pushDisabledAlert'),
                    [
                        { text: t('common.cancel'), style: "cancel" },
                        { text: t('settings.notifications.openSettings'), onPress: () => Linking.openSettings() },
                    ]
                );
                return;
            }

            // Show explanation before requesting system permission
            const userAccepted = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    t('settings.notifications.whyWeNeed'),
                    t('settings.notifications.whyWeNeedMsg'),
                    [
                        { text: t('settings.notifications.notNow'), style: "cancel", onPress: () => resolve(false) },
                        { text: t('settings.notifications.allow'), onPress: () => resolve(true) },
                    ]
                );
            });

            if (!userAccepted) return;

            const pushToken = await registerForPushNotificationsAsync();
            if (pushToken && token) {
                try {
                    await registerPushToken({
                        token,
                        pushToken,
                        platform: Platform.OS,
                    });
                } catch (e) {
                    console.error("Failed to register push token:", e);
                }
            }

            if (!pushToken) {
                Alert.alert(
                    t('settings.notifications.couldNotEnable'),
                    t('settings.notifications.couldNotEnableMsg')
                );
                return;
            }
            setPermissionStatus("granted");
        }

        setPushNotifications(value);
    };

    const handleSave = async () => {
        try {
            await updateNotifications({
                token: token || "",
                pushNotifications,
                emailNotifications,
                dealAlerts,
                tripReminders,
            });
            Alert.alert(t('common.success'), t('settings.notifications.updatedSuccess'));
            router.back();
        } catch (error) {
            console.error("Update failed:", error);
            Alert.alert(t('common.error'), t('settings.notifications.failedUpdate'));
        }
    };

    if (settings === undefined) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text }}>{t('common.loading')}</Text>
            </SafeAreaView>
        );
    }

    const notificationOptions = [
        {
            title: t('settings.notifications.pushNotifications'),
            description: permissionStatus === "denied"
                ? t('settings.notifications.pushDisabledDescription')
                : t('settings.notifications.pushDescription'),
            icon: "notifications-outline",
            value: pushNotifications,
            onChange: handleTogglePush,
        },
        {
            title: t('settings.notifications.emailNotifications'),
            description: t('settings.notifications.emailDescription'),
            icon: "mail-outline",
            value: emailNotifications,
            onChange: setEmailNotifications,
        },
        {
            title: t('settings.notifications.dealAlerts'),
            description: t('settings.notifications.dealDescription'),
            icon: "pricetag-outline",
            value: dealAlerts,
            onChange: setDealAlerts,
        },
        {
            title: t('settings.notifications.tripReminders'),
            description: t('settings.notifications.tripRemindersDescription'),
            icon: "time-outline",
            value: tripReminders,
            onChange: setTripReminders,
        },
    ];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings.notifications.title')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content}>
                <View style={[styles.section, { backgroundColor: colors.card }]}>
                    {notificationOptions.map((option, index) => (
                        <View key={index} style={[styles.notificationItem, { borderBottomColor: colors.border }]}>
                            <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? colors.secondary : colors.secondary }]}>
                                <Ionicons name={option.icon as any} size={20} color={colors.primary} />
                            </View>
                            <View style={styles.textContainer}>
                                <Text style={[styles.notificationTitle, { color: colors.text }]}>{option.title}</Text>
                                <Text style={[styles.notificationDescription, { color: colors.textMuted }]}>{option.description}</Text>
                            </View>
                            <Switch
                                value={option.value}
                                onValueChange={option.onChange}
                                trackColor={{ false: colors.border, true: colors.primary }}
                                thumbColor={"#FFFFFF"}
                            />
                        </View>
                    ))}
                </View>

                <NewsletterSignup />

                <View style={[styles.infoBox, { backgroundColor: isDarkMode ? colors.secondary : colors.secondary }]}>
                    <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                        {t('settings.notifications.manageInSettings')}
                    </Text>
                </View>

                <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={handleSave}>
                    <Text style={[styles.saveButtonText, { color: colors.text === '#FFFFFF' ? '#1A1A1A' : '#1A1A1A' }]}>{t('settings.notifications.savePreferences')}</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    section: {
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 20,
    },
    notificationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    notificationTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    notificationDescription: {
        fontSize: 13,
    },
    infoBox: {
        borderRadius: 10,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    infoText: {
        flex: 1,
        fontSize: 13,
        marginLeft: 12,
        lineHeight: 18,
    },
    saveButton: {
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginBottom: 40,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '700',
    },
});
