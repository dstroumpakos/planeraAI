import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Modal, Platform, StatusBar, TextInput, FlatList, ActivityIndicator, Linking } from "react-native";
import { Image } from "expo-image";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";
import { Id } from "@/convex/_generated/dataModel";
import Constants from "expo-constants";

const INSIGHT_CATEGORIES = [
  { id: "food", label: "Food & Drink", icon: "restaurant" },
  { id: "transport", label: "Transport", icon: "bus" },
  { id: "neighborhoods", label: "Neighborhoods", icon: "map" },
  { id: "timing", label: "Best Time", icon: "time" },
  { id: "hidden_gem", label: "Hidden Gems", icon: "diamond" },
  { id: "avoid", label: "What to Avoid", icon: "warning" },
  { id: "other", label: "Other", icon: "information-circle" },
];

export default function Profile() {
    const router = useRouter();
    const { data: session } = authClient.useSession();
    const { token } = useToken();
    const trips = useQuery(api.trips.list as any, { token: token || "skip" });
    const userPlan = useQuery(api.users.getPlan as any, { token: token || "skip" });
    const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" });
    
    // Get completed trips for insights
    const completedTrips = useQuery(
        api.insights.getCompletedTrips,
        token ? { token } : "skip"
    );
    
    // Get user's own insights
    const myInsights = useQuery(
        api.insights.getMyInsights,
        token ? { token } : "skip"
    );
    
    // Check if user is admin
    const isAdmin = useQuery(
        (api as any).admin.isAdmin,
        token ? { token } : "skip"
    );
    
    // Get profile image URL if profilePicture storage ID exists
    const profileImageUrl = useQuery(
        api.users.getProfileImageUrl as any,
        userSettings?.profilePicture ? { storageId: userSettings.profilePicture, token: token || "skip" } : "skip"
    );
    
    const generateUploadUrl = useAuthenticatedMutation(api.users.generateUploadUrl as any);
    const saveProfilePicture = useAuthenticatedMutation(api.users.saveProfilePicture as any);
    const createInsight = useAuthenticatedMutation(api.insights.create as any);
    const dismissTrip = useAuthenticatedMutation(api.insights.dismissTrip as any);
    
    const { isDarkMode, toggleDarkMode, colors } = useTheme();
    const [menuVisible, setMenuVisible] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(userSettings?.name || user?.name || "");
    
    // Insights state
    const [showInsightsModal, setShowInsightsModal] = useState(false);
    const [selectedInsightTrip, setSelectedInsightTrip] = useState<{
        _id: Id<"trips">;
        destination: string;
        startDate: number;
        endDate: number;
        travelers: number;
    } | null>(null);
    const [insightContent, setInsightContent] = useState("");
    const [insightCategory, setInsightCategory] = useState("other");
    const [insightStep, setInsightStep] = useState<"trips" | "form">("trips");
    
    // @ts-ignore
    const updateUserName = useAuthenticatedMutation(api.users.updateUserName as any);

    const handleLogout = async () => {
        try {
            await authClient.signOut();
            // Clear any cached data and redirect to login
            router.replace("/");
        } catch (error) {
            console.error("Logout failed:", error);
            if (Platform.OS !== 'web') {
                Alert.alert("Error", "Failed to log out. Please try again.");
            }
            // Still try to redirect even if signOut fails
            router.replace("/");
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
                    const uploadUrl = await generateUploadUrl({ token: token || "" });
                    
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
                    await saveProfilePicture({ token: token || "", storageId });
                    
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
    const completedTripsCount = trips?.filter((t: any) => t.status === "completed").length || 0;
    const now = Date.now();
    const pastTripsCount = trips?.filter((t: any) => t.endDate < now).length || 0;
    const upcomingTripsCount = tripCount - pastTripsCount;
    const isPremium = userPlan?.plan === "premium";

    const handleSaveName = async () => {
        if (!editedName.trim()) {
            Alert.alert("Error", "Name cannot be empty");
            return;
        }
        
        try {
            await updateUserName({ token: token || "", name: editedName.trim() });
            setIsEditingName(false);
            await new Promise(resolve => setTimeout(resolve, 500));
            if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (error) {
            console.error("Failed to update name:", error);
            Alert.alert("Error", "Failed to update name");
        }
    };

    const handleCancelEditName = () => {
        setIsEditingName(false);
        setEditedName(userSettings?.name || user?.name || "");
    };

    // Insights handlers
    const handleSubmitInsight = async () => {
        if (!selectedInsightTrip || !insightContent) {
            Alert.alert("Error", "Please select a trip and write your insight");
            return;
        }

        try {
            await createInsight({
                destination: selectedInsightTrip.destination,
                content: insightContent,
                category: insightCategory as any,
                verified: true,
            });
            resetInsightForm();
            setShowInsightsModal(false);
            Alert.alert("Success", "Thank you for sharing your insight! It will help other travelers.");
        } catch (error) {
            console.error(error);
            Alert.alert("Error", "Failed to share insight");
        }
    };

    const resetInsightForm = () => {
        setSelectedInsightTrip(null);
        setInsightContent("");
        setInsightCategory("other");
        setInsightStep("trips");
    };

    const handleSelectInsightTrip = (trip: any) => {
        setSelectedInsightTrip(trip);
        setInsightStep("form");
    };

    const formatInsightDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
        });
    };

    const menuItems = [
        // {
        //     title: "My Flights",
        //     subtitle: "View booked flights & policies",
        //     icon: "airplane-outline",
        //     iconBg: isDarkMode ? "#1E3A5F" : "#DBEAFE",
        //     iconColor: "#2563EB",
        //     action: () => router.push("/settings/my-flights")
        // },
        {
            title: "Saved Trips",
            subtitle: `${upcomingTripsCount} upcoming, ${pastTripsCount} past`,
            icon: "bookmark-outline",
            iconBg: isDarkMode ? "#3D3D00" : "#FFF8E1",
            iconColor: colors.primary,
            action: () => router.push("/(tabs)/trips")
        },
        // {
        //     title: "Traveler Profiles",
        //     subtitle: "Manage passport & traveler info",
        //     icon: "people-outline",
        //     iconBg: isDarkMode ? "#1D3D2E" : "#D1FAE5",
        //     iconColor: "#059669",
        //     action: () => router.push("/settings/traveler-profiles")
        // },
        {
            title: "Travel Preferences",
            subtitle: "Airport, Budget, Interests",
            icon: "options-outline",
            iconBg: isDarkMode ? "#3D3D00" : "#FFF8E1",
            iconColor: colors.primary,
            action: () => router.push("/settings/travel-preferences")
        },
        // {
        //     title: "Payment Methods",
        //     subtitle: "Visa ending in 4242",
        //     icon: "card-outline",
        //     iconBg: isDarkMode ? "#2D1B4E" : "#F3E8FF",
        //     iconColor: "#9333EA",
        //     action: () => router.push("/subscription")
        // },
    ];

    const styles = createStyles(colors, isDarkMode);

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
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
                        <TouchableOpacity 
                            style={styles.menuDropdownItem}
                            onPress={() => {
                                setMenuVisible(false);
                                Linking.openURL('mailto:support@planeraai.app?subject=Planera%20Support%20Request');
                            }}
                        >
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
                                    cachePolicy="disk"
                                    transition={200}
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
                    {!isEditingName ? (
                        <TouchableOpacity 
                            style={styles.nameContainer}
                            onPress={() => {
                                setEditedName(userSettings?.name || user?.name || "");
                                setIsEditingName(true);
                            }}
                        >
                            <Text style={styles.userName}>{userSettings?.name || user?.name || "Planera User"}</Text>
                            <Ionicons name="pencil-outline" size={16} color={colors.primary} />
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.editNameFieldContainer}>
                            <TextInput
                                style={[styles.editNameField, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                                placeholder="Enter your name"
                                placeholderTextColor={colors.textMuted}
                                value={editedName}
                                onChangeText={setEditedName}
                                maxLength={50}
                                autoFocus
                            />
                            <View style={styles.editNameFieldActions}>
                                <TouchableOpacity 
                                    style={[styles.editNameFieldButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                                    onPress={handleCancelEditName}
                                >
                                    <Ionicons name="close" size={18} color={colors.text} />
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={[styles.editNameFieldButton, { backgroundColor: colors.primary }]}
                                    onPress={handleSaveName}
                                >
                                    <Ionicons name="checkmark" size={18} color={colors.text} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                    <View style={styles.memberBadge}>
                        <Ionicons name="diamond-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.memberText}>
                            Planera {isPremium ? "Premium" : "Free"} Member
                        </Text>
                    </View>
                </View>

                {/* Travel Interests */}
                {userSettings?.interests && userSettings.interests.length > 0 && (
                    <View style={styles.interestsSection}>
                        <Text style={styles.interestsSectionTitle}>Travel Interests</Text>
                        <View style={styles.interestsTags}>
                            {userSettings.interests.map((interest: string) => (
                                <View 
                                    key={interest}
                                    style={[styles.interestTag, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                                >
                                    <Ionicons 
                                        name={
                                            interest === "Adventure" ? "trail-sign" : 
                                            interest === "Culinary" ? "restaurant" : 
                                            interest === "Culture" ? "library" :
                                            interest === "Relaxation" ? "cafe" :
                                            interest === "Nightlife" ? "wine" :
                                            interest === "Nature" ? "leaf" :
                                            interest === "History" ? "book" :
                                            interest === "Shopping" ? "cart" :
                                            interest === "Luxury" ? "diamond" :
                                            "people"
                                        } 
                                        size={16}
                                        color="#1A1A1A"
                                        style={{ marginRight: 6 }}
                                    />
                                    <Text style={styles.interestTagText}>{interest}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

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

                {/* Admin Section - Only visible to admins */}
                {isAdmin && (
                    <>
                        <Text style={styles.sectionTitle}>ADMIN</Text>
                        <TouchableOpacity 
                            style={[styles.insightsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={() => router.push("/admin" as any)}
                        >
                            <View style={[styles.insightsIconContainer, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                                <Ionicons name="shield" size={24} color="#4F46E5" />
                            </View>
                            <View style={styles.insightsTextContainer}>
                                <Text style={[styles.insightsTitle, { color: colors.text }]}>Admin Dashboard</Text>
                                <Text style={[styles.insightsSubtitle, { color: colors.textMuted }]}>
                                    Moderate content and manage users
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    </>
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

                {/* Share Travel Insights Section */}
                <>
                    <Text style={styles.sectionTitle}>SHARE YOUR EXPERIENCE</Text>
                    <TouchableOpacity 
                        style={[styles.insightsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => router.push("/settings/share-insight")}
                    >
                        <View style={[styles.insightsIconContainer, { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FFF8E1' }]}>
                            <Ionicons name="bulb" size={24} color={colors.primary} />
                        </View>
                        <View style={styles.insightsTextContainer}>
                            <Text style={[styles.insightsTitle, { color: colors.text }]}>Share Travel Tips</Text>
                            <Text style={[styles.insightsSubtitle, { color: colors.textMuted }]}>
                                Help other travelers with insights from your trips
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                </>

                {/* My Traveler Insights Section */}
                {myInsights && myInsights.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>MY TRAVELER INSIGHTS</Text>
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator={false}
                            style={styles.myInsightsScroll}
                            contentContainerStyle={{ paddingHorizontal: 16 }}
                        >
                            {myInsights.map((insight: any) => (
                                <View 
                                    key={insight._id} 
                                    style={[
                                        styles.myInsightCard, 
                                        { backgroundColor: colors.card, borderColor: colors.border }
                                    ]}
                                >
                                    <View style={styles.myInsightHeader}>
                                        <View style={[
                                            styles.myInsightCategoryBadge,
                                            { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FFF8E1' }
                                        ]}>
                                            <Ionicons 
                                                name={
                                                    insight.category === 'food' ? 'restaurant' :
                                                    insight.category === 'transport' ? 'bus' :
                                                    insight.category === 'hidden_gem' ? 'diamond' :
                                                    insight.category === 'avoid' ? 'warning' :
                                                    insight.category === 'neighborhoods' ? 'map' :
                                                    insight.category === 'timing' ? 'time' :
                                                    'bulb'
                                                }
                                                size={14} 
                                                color={colors.primary}
                                            />
                                            <Text style={[styles.myInsightCategoryText, { color: colors.primary }]}>
                                                {insight.category.replace('_', ' ')}
                                            </Text>
                                        </View>
                                        <View style={styles.myInsightLikes}>
                                            <Ionicons name="heart" size={14} color="#F59E0B" />
                                            <Text style={[styles.myInsightLikesText, { color: colors.textMuted }]}>{insight.likes}</Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.myInsightDestination, { color: colors.text }]}>
                                        {insight.destination}
                                    </Text>
                                    <Text style={[styles.myInsightContent, { color: colors.textMuted }]} numberOfLines={3}>
                                        {insight.content}
                                    </Text>
                                    <View style={styles.myInsightFooter}>
                                        <Text style={[styles.myInsightDate, { color: colors.textMuted }]}>
                                            {new Date(insight.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                        </Text>
                                        <View style={[
                                            styles.myInsightStatusBadge,
                                            { 
                                                backgroundColor: insight.moderationStatus === 'approved' 
                                                    ? (isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5')
                                                    : insight.moderationStatus === 'pending'
                                                    ? (isDarkMode ? 'rgba(251, 191, 36, 0.2)' : '#FEF3C7')
                                                    : (isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2')
                                            }
                                        ]}>
                                            <Text style={[
                                                styles.myInsightStatusText,
                                                { 
                                                    color: insight.moderationStatus === 'approved' 
                                                        ? '#059669'
                                                        : insight.moderationStatus === 'pending'
                                                        ? '#D97706'
                                                        : '#DC2626'
                                                }
                                            ]}>
                                                {insight.moderationStatus === 'approved' ? 'Published' : 
                                                 insight.moderationStatus === 'pending' ? 'Pending' : 'Rejected'}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                    </>
                )}

                {/* Help & Support */}
                <View style={styles.helpSection}>
                    <TouchableOpacity 
                        style={styles.helpItem}
                        onPress={() => Linking.openURL('mailto:support@planeraai.app?subject=Planera%20Support%20Request')}
                    >
                        <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
                        <Text style={styles.helpText}>Help & Support</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.helpItem} onPress={handleLogout}>
                        <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
                        <Text style={styles.helpText}>Log Out</Text>
                    </TouchableOpacity>
                </View>

                {/* Version */}
                <Text style={styles.versionText}>PLANERA V{Constants.expoConfig?.version || '1.0.0'}</Text>

                {/* Bottom Spacing */}
                <View style={{ height: 120 }} />
            </ScrollView>

            {/* Share Insights Modal */}
            <Modal
                visible={showInsightsModal}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => {
                    setShowInsightsModal(false);
                    resetInsightForm();
                }}
            >
                <SafeAreaView style={[styles.insightsModalContainer, { backgroundColor: colors.background }]}>
                    <View style={[styles.insightsModalHeader, { borderBottomColor: colors.border }]}>
                        <TouchableOpacity 
                            onPress={() => {
                                if (insightStep === "form") {
                                    setInsightStep("trips");
                                } else {
                                    setShowInsightsModal(false);
                                    resetInsightForm();
                                }
                            }}
                        >
                            <Ionicons name={insightStep === "form" ? "chevron-back" : "close"} size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.insightsModalTitle, { color: colors.text }]}>Share Your Tips</Text>
                        <View style={{ width: 24 }} />
                    </View>

                    <ScrollView style={styles.insightsModalContent} contentContainerStyle={styles.insightsModalScrollContent}>
                        {insightStep === "trips" ? (
                            <>
                                <Text style={[styles.insightsModalSectionTitle, { color: colors.text }]}>Select a Completed Trip</Text>
                                <Text style={[styles.insightsModalSectionSubtitle, { color: colors.textMuted }]}>
                                    Choose a trip you've taken to share your experience
                                </Text>
                                {completedTrips?.map((trip: any) => (
                                    <TouchableOpacity
                                        key={trip._id}
                                        style={[styles.insightTripCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                                        onPress={() => handleSelectInsightTrip(trip)}
                                    >
                                        <View style={[styles.insightTripIcon, { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FFF8E1' }]}>
                                            <Ionicons name="airplane" size={20} color={colors.primary} />
                                        </View>
                                        <View style={styles.insightTripInfo}>
                                            <Text style={[styles.insightTripDestination, { color: colors.text }]}>{trip.destination}</Text>
                                            <Text style={[styles.insightTripDates, { color: colors.textMuted }]}>
                                                {formatInsightDate(trip.startDate)} - {formatInsightDate(trip.endDate)}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                                    </TouchableOpacity>
                                ))}
                            </>
                        ) : (
                            <>
                                <Text style={[styles.insightsModalSectionSubtitle, { color: colors.textMuted, marginBottom: 20 }]}>
                                    Sharing insights for: <Text style={{ color: colors.primary, fontWeight: '600' }}>{selectedInsightTrip?.destination}</Text>
                                </Text>

                                <Text style={[styles.insightFormLabel, { color: colors.text }]}>Category</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.insightCategoryScroll}>
                                    {INSIGHT_CATEGORIES.map((cat) => (
                                        <TouchableOpacity
                                            key={cat.id}
                                            style={[
                                                styles.insightCategoryChip,
                                                { backgroundColor: colors.inputBackground, borderColor: colors.border },
                                                insightCategory === cat.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                                            ]}
                                            onPress={() => setInsightCategory(cat.id)}
                                        >
                                            <Ionicons
                                                name={cat.icon as any}
                                                size={16}
                                                color={insightCategory === cat.id ? colors.text : colors.textMuted}
                                            />
                                            <Text
                                                style={[
                                                    styles.insightCategoryText,
                                                    { color: colors.textMuted },
                                                    insightCategory === cat.id && { color: colors.text },
                                                ]}
                                            >
                                                {cat.label}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>

                                <Text style={[styles.insightFormLabel, { color: colors.text, marginTop: 20 }]}>Your Insight</Text>
                                <TextInput
                                    style={[styles.insightTextArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                                    placeholder="Share your experience, tips, or recommendations..."
                                    placeholderTextColor={colors.textMuted}
                                    value={insightContent}
                                    onChangeText={setInsightContent}
                                    multiline
                                    numberOfLines={5}
                                />

                                <TouchableOpacity 
                                    style={[styles.insightSubmitButton, { backgroundColor: colors.primary }]} 
                                    onPress={handleSubmitInsight}
                                >
                                    <Ionicons name="send" size={18} color={colors.text} />
                                    <Text style={[styles.insightSubmitText, { color: colors.text }]}>Share Insight</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
        </>
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
    nameContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
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
    interestsSection: {
        marginBottom: 24,
    },
    interestsSectionTitle: {
        fontSize: 14,
        fontWeight: "700",
        color: colors.text,
        marginBottom: 12,
    },
    interestsTags: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    interestTag: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: colors.primary,
        borderWidth: 1,
    },
    interestTagText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
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
    editNameFieldContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
    },
    editNameField: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        fontSize: 16,
        fontWeight: "600",
    },
    editNameFieldActions: {
        flexDirection: "row",
        gap: 8,
    },
    editNameFieldButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    editNameModal: {
        borderRadius: 16,
        padding: 24,
        marginHorizontal: 24,
        borderWidth: 1,
    },
    editNameTitle: {
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 16,
    },
    editNameInput: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        fontSize: 16,
        marginBottom: 20,
    },
    editNameActions: {
        flexDirection: "row",
        gap: 12,
    },
    editNameButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: "center",
        borderWidth: 1,
    },
    editNameButtonText: {
        fontSize: 16,
        fontWeight: "600",
    },
    // Insights Section Styles
    insightsCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
    },
    insightsIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    insightsTextContainer: {
        flex: 1,
    },
    insightsTitle: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 4,
    },
    insightsSubtitle: {
        fontSize: 13,
    },
    // My Insights Section Styles
    myInsightsScroll: {
        marginBottom: 24,
    },
    myInsightCard: {
        width: 260,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginRight: 12,
    },
    myInsightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10,
    },
    myInsightCategoryBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    myInsightCategoryText: {
        fontSize: 12,
        fontWeight: "600",
        textTransform: "capitalize",
    },
    myInsightLikes: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    myInsightLikesText: {
        fontSize: 12,
        fontWeight: "500",
    },
    myInsightDestination: {
        fontSize: 15,
        fontWeight: "700",
        marginBottom: 6,
    },
    myInsightContent: {
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 12,
    },
    myInsightFooter: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    myInsightDate: {
        fontSize: 12,
    },
    myInsightStatusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    myInsightStatusText: {
        fontSize: 11,
        fontWeight: "600",
    },
    // Insights Modal Styles
    insightsModalContainer: {
        flex: 1,
    },
    insightsModalHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
    },
    insightsModalTitle: {
        fontSize: 18,
        fontWeight: "700",
    },
    insightsModalContent: {
        flex: 1,
    },
    insightsModalScrollContent: {
        padding: 20,
    },
    insightsModalSectionTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 8,
    },
    insightsModalSectionSubtitle: {
        fontSize: 14,
        marginBottom: 24,
    },
    insightTripCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
    },
    insightTripIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    insightTripInfo: {
        flex: 1,
    },
    insightTripDestination: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 4,
    },
    insightTripDates: {
        fontSize: 13,
    },
    insightFormLabel: {
        fontSize: 14,
        fontWeight: "600",
        marginBottom: 12,
    },
    insightCategoryScroll: {
        marginBottom: 8,
    },
    insightCategoryChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        marginRight: 8,
        borderWidth: 1,
    },
    insightCategoryText: {
        marginLeft: 6,
        fontWeight: "500",
        fontSize: 13,
    },
    insightTextArea: {
        height: 120,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        fontSize: 16,
        textAlignVertical: "top",
    },
    insightSubmitButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        borderRadius: 12,
        marginTop: 24,
        gap: 8,
    },
    insightSubmitText: {
        fontSize: 16,
        fontWeight: "700",
    },
});