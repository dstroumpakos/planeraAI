import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Modal, Image, Platform } from "react-native";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

export default function Profile() {
    const router = useRouter();
    const { data: session } = authClient.useSession();
    const trips = useQuery(api.trips.list);
    const userPlan = useQuery(api.users.getPlan);
    const userSettings = useQuery(api.users.getSettings);
    
    // Get profile image URL if profilePicture storage ID exists
    const profileImageUrl = useQuery(
        api.users.getProfileImageUrl,
        userSettings?.profilePicture ? { storageId: userSettings.profilePicture } : "skip"
    );
    
    const generateUploadUrl = useMutation(api.users.generateUploadUrl);
    const saveProfilePicture = useMutation(api.users.saveProfilePicture);
    
    const { isDarkMode, toggleDarkMode, colors } = useTheme();
    const [menuVisible, setMenuVisible] = useState(false);
    const [uploading, setUploading] = useState(false);

    const handleLogout = async () => {
        try {
            await authClient.signOut();
            await new Promise(resolve => setTimeout(resolve, 500));
            router.replace("/");
        } catch (error) {
            console.error("Logout failed:", error);
            if (Platform.OS !== 'web') {
                Alert.alert("Error", "Failed to log out");
            }
        }
    };

    const handleToggleDarkMode = async () => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        await toggleDarkMode();
    };

    const handlePickImage = async () => {
        try {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            
            if (!permissionResult.granted) {
                if (Platform.OS !== 'web') {
                    Alert.alert("Permission Required", "Please allow access to your photo library to upload a profile picture.");
                }
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                setUploading(true);
                
                try {
                    // Get upload URL
                    const uploadUrl = await generateUploadUrl();
                    
                    // Fetch the image and upload
                    const response = await fetch(result.assets[0].uri);
                    const blob = await response.blob();
                    
                    const uploadResponse = await fetch(uploadUrl, {
                        method: "POST",
                        headers: { "Content-Type": blob.type },
                        body: blob,
                    });
                    
                    const { storageId } = await uploadResponse.json();
                    
                    // Save to user settings
                    await saveProfilePicture({ storageId });
                    
                    if (Platform.OS !== 'web') {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                } catch (error) {
                    console.error("Upload failed:", error);
                    if (Platform.OS !== 'web') {
                        Alert.alert("Error", "Failed to upload profile picture");
                    }
                } finally {
                    setUploading(false);
                }
            }
        } catch (error) {
            console.error("Image picker error:", error);
        }
    };

    const user = session?.user;
    const tripCount = trips?.length || 0;
    const completedTrips = trips?.filter((t: any) => t.status === "completed").length || 0;
    const isPremium = userPlan?.plan === "premium";

    const menuItems = [
        {
            title: "My Flights",
            subtitle: "View booked flights & policies",
            icon: "airplane-outline",
            iconBg: isDarkMode ? "#1E3A5F" : "#DBEAFE",
            iconColor: "#2563EB",
            action: () => router.push("/settings/my-flights")
        },
        {
            title: "Saved Trips",
            subtitle: `${completedTrips} upcoming, ${tripCount - completedTrips} past`,
            icon: "bookmark-outline",
            iconBg: isDarkMode ? "#3D3D00" : "#FFF8E1",
            iconColor: colors.primary,
            action: () => router.push("/(tabs)/trips")
        },
        {
            title: "Traveler Profiles",
            subtitle: "Manage passport & traveler info",
            icon: "people-outline",
            iconBg: isDarkMode ? "#1D3D2E" : "#D1FAE5",
            iconColor: "#059669",
            action: () => router.push("/settings/traveler-profiles")
        },
        {
            title: "Travel Preferences",
            subtitle: "Dietary, Airlines, Seats",
            icon: "options-outline",
            iconBg: isDarkMode ? "#3D3D00" : "#FFF8E1",
            iconColor: colors.primary,
            action: () => router.push("/settings/travel-preferences")
        },
        {
            title: "Payment Methods",
            subtitle: "Visa ending in 4242",
            icon: "card-outline",
            iconBg: isDarkMode ? "#2D1B4E" : "#F3E8FF",
            iconColor: "#9333EA",
            action: () => router.push("/subscription")
        },
    ];

    const styles = createStyles(colors, isDarkMode);

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Profile</Text>
                <TouchableOpacity onPress={() => setMenuVisible(true)}>
                    <Ionicons name="menu" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            {/* Settings Menu Modal */}
            <Modal
                visible={menuVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setMenuVisible(false)}
            >
                <TouchableOpacity 
                    style={styles.modalOverlay} 
                    activeOpacity={1} 
                    onPress={() => setMenuVisible(false)}
                >
                    <View style={styles.menuDropdown}>
                        {/* Dark Mode Toggle */}
                        <TouchableOpacity 
                            style={styles.menuDropdownItem}
                            onPress={handleToggleDarkMode}
                        >
                            <Ionicons 
                                name={isDarkMode ? "sunny" : "moon"} 
                                size={20} 
                                color={colors.text} 
                            />
                            <Text style={styles.menuDropdownText}>
                                {isDarkMode ? "Light Mode" : "Dark Mode"}
                            </Text>
                            <View style={[
                                styles.toggleSwitch,
                                isDarkMode && styles.toggleSwitchActive
                            ]}>
                                <View style={[
                                    styles.toggleKnob,
                                    isDarkMode && styles.toggleKnobActive
                                ]} />
                            </View>
                        </TouchableOpacity>

                        {/* Divider */}
                        <View style={styles.menuDivider} />

                        {/* Help & Support */}
                        <TouchableOpacity style={styles.menuDropdownItem}>
                            <Ionicons name="help-circle-outline" size={20} color={colors.text} />
                            <Text style={styles.menuDropdownText}>Help & Support</Text>
                        </TouchableOpacity>

                        {/* Privacy Policy */}
                        <TouchableOpacity 
                            style={styles.menuDropdownItem}
                            onPress={() => {
                                setMenuVisible(false);
                                router.push("/privacy");
                            }}
                        >
                            <Ionicons name="shield-checkmark-outline" size={20} color={colors.text} />
                            <Text style={styles.menuDropdownText}>Privacy Policy</Text>
                        </TouchableOpacity>

                        {/* Terms of Service */}
                        <TouchableOpacity 
                            style={styles.menuDropdownItem}
                            onPress={() => {
                                setMenuVisible(false);
                                router.push("/terms");
                            }}
                        >
                            <Ionicons name="document-text-outline" size={20} color={colors.text} />
                            <Text style={styles.menuDropdownText}>Terms of Service</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                {/* Profile Card */}
                <View style={styles.profileSection}>
                    <View style={styles.avatarContainer}>
                        <TouchableOpacity onPress={handlePickImage} disabled={uploading}>
                            {profileImageUrl ? (
                                <Image 
                                    source={{ uri: profileImageUrl }} 
                                    style={styles.avatarImage}
                                />
                            ) : (
                                <View style={styles.avatar}>
                                    <Text style={styles.avatarText}>
                                        {user?.name?.[0]?.toUpperCase() || "P"}
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={styles.editAvatarButton}
                            onPress={handlePickImage}
                            disabled={uploading}
                        >
                            <Ionicons 
                                name={uploading ? "hourglass" : "camera"} 
                                size={14} 
                                color={colors.text} 
                            />
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.userName}>{user?.name || "Planera User"}</Text>
                    <View style={styles.memberBadge}>
                        <Ionicons name="diamond-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.memberText}>
                            Planera {isPremium ? "Premium" : "Free"} Member
                        </Text>
                    </View>
                </View>

                {/* Premium Upsell Card */}
                {!isPremium && (
                    <TouchableOpacity 
                        style={styles.premiumCard}
                        onPress={() => router.push("/subscription")}
                    >
                        <View style={styles.premiumHeader}>
                            <Ionicons name="sparkles" size={20} color={colors.primary} />
                            <Text style={styles.premiumTitle}>Planera Premium</Text>
                        </View>
                        <Text style={styles.premiumDescription}>
                            Unlock AI superpowers for unlimited routing and smart travel recommendations.
                        </Text>
                        <View style={styles.upgradeButton}>
                            <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
                            <Ionicons name="arrow-forward" size={18} color={colors.text} />
                        </View>
                    </TouchableOpacity>
                )}

                {/* Account Settings */}
                <Text style={styles.sectionTitle}>ACCOUNT SETTINGS</Text>
                <View style={styles.menuContainer}>
                    {menuItems.map((item, index) => (
                        <TouchableOpacity 
                            key={index} 
                            style={[
                                styles.menuItem,
                                index === menuItems.length - 1 && { borderBottomWidth: 0 }
                            ]}
                            onPress={item.action}
                        >
                            <View style={[styles.menuIconContainer, { backgroundColor: item.iconBg }]}>
                                <Ionicons name={item.icon as any} size={20} color={item.iconColor} />
                            </View>
                            <View style={styles.menuTextContainer}>
                                <Text style={styles.menuTitle}>{item.title}</Text>
                                <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Help & Support */}
                <View style={styles.helpSection}>
                    <TouchableOpacity style={styles.helpItem}>
                        <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
                        <Text style={styles.helpText}>Help & Support</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.helpItem} onPress={handleLogout}>
                        <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
                        <Text style={styles.helpText}>Log Out</Text>
                    </TouchableOpacity>
                </View>

                {/* Version */}
                <Text style={styles.versionText}>PLANERA V2.4.0</Text>

                {/* Bottom Spacing */}
                <View style={{ height: 120 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: colors.text,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
    },
    profileSection: {
        alignItems: "center",
        paddingVertical: 24,
    },
    avatarContainer: {
        position: "relative",
        marginBottom: 16,
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: isDarkMode ? colors.border : "#E8E6E1",
        justifyContent: "center",
        alignItems: "center",
    },
    avatarImage: {
        width: 100,
        height: 100,
        borderRadius: 50,
    },
    avatarText: {
        fontSize: 36,
        fontWeight: "700",
        color: colors.text,
    },
    editAvatarButton: {
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.primary,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 3,
        borderColor: colors.background,
    },
    userName: {
        fontSize: 24,
        fontWeight: "800",
        color: colors.text,
        marginBottom: 8,
    },
    memberBadge: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.cardBackground,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
        borderWidth: 1,
        borderColor: colors.border,
    },
    memberText: {
        fontSize: 14,
        color: colors.textMuted,
        fontWeight: "500",
    },
    premiumCard: {
        backgroundColor: isDarkMode ? "#1A2433" : "#1A2433",
        borderRadius: 20,
        padding: 20,
        marginBottom: 24,
    },
    premiumHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
    },
    premiumTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: colors.white,
    },
    premiumDescription: {
        fontSize: 14,
        color: "rgba(255,255,255,0.7)",
        lineHeight: 20,
        marginBottom: 16,
    },
    upgradeButton: {
        backgroundColor: "#4A90D9",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    upgradeButtonText: {
        fontSize: 16,
        fontWeight: "700",
        color: colors.white,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: "700",
        color: colors.textMuted,
        letterSpacing: 1,
        marginBottom: 12,
    },
    menuContainer: {
        backgroundColor: colors.cardBackground,
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 24,
        borderWidth: 1,
        borderColor: colors.border,
    },
    menuItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    menuIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    menuTextContainer: {
        flex: 1,
    },
    menuTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: colors.text,
        marginBottom: 2,
    },
    menuSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
    },
    helpSection: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 16,
        marginBottom: 24,
    },
    helpItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        gap: 12,
    },
    helpText: {
        fontSize: 16,
        color: colors.textSecondary,
    },
    versionText: {
        fontSize: 12,
        color: colors.textMuted,
        textAlign: "center",
        letterSpacing: 1,
    },
    // Menu Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-start",
        alignItems: "flex-end",
        paddingTop: 100,
        paddingRight: 20,
    },
    menuDropdown: {
        backgroundColor: colors.cardBackground,
        borderRadius: 16,
        padding: 8,
        minWidth: 220,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    menuDropdownItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 12,
    },
    menuDropdownText: {
        flex: 1,
        fontSize: 15,
        fontWeight: "500",
        color: colors.text,
    },
    menuDivider: {
        height: 1,
        backgroundColor: colors.border,
        marginVertical: 4,
    },
    toggleSwitch: {
        width: 44,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.border,
        padding: 2,
        justifyContent: "center",
    },
    toggleSwitchActive: {
        backgroundColor: colors.primary,
    },
    toggleKnob: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.white,
    },
    toggleKnobActive: {
        alignSelf: "flex-end",
    },
});
