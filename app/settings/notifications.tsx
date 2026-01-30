import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";

export default function Notifications() {
    const router = useRouter();
    const settings = useQuery(api.users.getSettings);
    const updateNotifications = useMutation(api.users.updateNotifications);

    const [pushNotifications, setPushNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [dealAlerts, setDealAlerts] = useState(true);
    const [tripReminders, setTripReminders] = useState(true);

    useEffect(() => {
        if (settings) {
            setPushNotifications(settings.pushNotifications ?? true);
            setEmailNotifications(settings.emailNotifications ?? true);
            setDealAlerts(settings.dealAlerts ?? true);
            setTripReminders(settings.tripReminders ?? true);
        }
    }, [settings]);

    const handleSave = async () => {
        try {
            await updateNotifications({
                pushNotifications,
                emailNotifications,
                dealAlerts,
                tripReminders,
            });
            Alert.alert("Success", "Notification preferences updated successfully!");
            router.back();
        } catch (error) {
            console.error("Update failed:", error);
            Alert.alert("Error", "Failed to update notification preferences");
        }
    };

    if (settings === undefined) {
        return (
            <SafeAreaView style={styles.container}>
                <Text>Loading...</Text>
            </SafeAreaView>
        );
    }

    const notificationOptions = [
        {
            title: "Push Notifications",
            description: "Receive notifications on your device",
            icon: "notifications-outline",
            value: pushNotifications,
            onChange: setPushNotifications,
        },
        {
            title: "Email Notifications",
            description: "Receive updates via email",
            icon: "mail-outline",
            value: emailNotifications,
            onChange: setEmailNotifications,
        },
        {
            title: "Deal Alerts",
            description: "Get notified about special deals and offers",
            icon: "pricetag-outline",
            value: dealAlerts,
            onChange: setDealAlerts,
        },
        {
            title: "Trip Reminders",
            description: "Reminders about upcoming trips",
            icon: "time-outline",
            value: tripReminders,
            onChange: setTripReminders,
        },
    ];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#1B3F92" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    {notificationOptions.map((option, index) => (
                        <View key={index} style={styles.notificationItem}>
                            <View style={styles.iconContainer}>
                                <Ionicons name={option.icon as any} size={24} color="#1B3F92" />
                            </View>
                            <View style={styles.textContainer}>
                                <Text style={styles.notificationTitle}>{option.title}</Text>
                                <Text style={styles.notificationDescription}>{option.description}</Text>
                            </View>
                            <Switch
                                value={option.value}
                                onValueChange={option.onChange}
                                trackColor={{ false: "#CFD8DC", true: "#1B3F92" }}
                                thumbColor={"#FFFFFF"}
                            />
                        </View>
                    ))}
                </View>

                <View style={styles.infoBox}>
                    <Ionicons name="information-circle-outline" size={20} color="#1B3F92" />
                    <Text style={styles.infoText}>
                        You can manage notification permissions in your device settings
                    </Text>
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                    <Text style={styles.saveButtonText}>Save Preferences</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F6F8',
    },
    header: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 20,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1B3F92',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    section: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 20,
    },
    notificationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
    },
    iconContainer: {
        width: 40,
        alignItems: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    notificationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#37474F',
        marginBottom: 4,
    },
    notificationDescription: {
        fontSize: 13,
        color: '#78909C',
    },
    infoBox: {
        backgroundColor: '#E3F2FD',
        borderRadius: 8,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    infoText: {
        flex: 1,
        fontSize: 13,
        color: '#1B3F92',
        marginLeft: 12,
    },
    saveButton: {
        backgroundColor: '#1B3F92',
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        marginBottom: 40,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});
