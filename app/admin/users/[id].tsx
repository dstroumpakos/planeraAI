import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Platform,
    StatusBar,
    Alert,
    TextInput,
    Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

export default function AdminUserDetail() {
    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    
    // Editing state
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editCredits, setEditCredits] = useState("");
    const [showPlanModal, setShowPlanModal] = useState(false);
    
    const user = useQuery(
        (api as any).admin.getUser,
        token && id ? { token, targetUserId: id as string } : "skip"
    );
    
    const banUser = useAuthenticatedMutation((api as any).admin.banUser);
    const shadowBanUser = useAuthenticatedMutation((api as any).admin.shadowBanUser);
    const setUserAdmin = useAuthenticatedMutation((api as any).admin.setUserAdmin);
    const updateUserDetails = useAuthenticatedMutation((api as any).admin.updateUserDetails);
    const updateUserPlan = useAuthenticatedMutation((api as any).admin.updateUserPlan);
    const adjustTripCredits = useAuthenticatedMutation((api as any).admin.adjustTripCredits);
    const deleteUserSessions = useAuthenticatedMutation((api as any).admin.deleteUserSessions);

    // Sync edit fields when user data loads
    useEffect(() => {
        if (user) {
            setEditName(user.name || "");
            setEditEmail(user.email || "");
            setEditCredits(String(user.tripCredits || 0));
        }
    }, [user?.name, user?.email, user?.tripCredits]);

    const handleToggleBan = () => {
        const action = user.isBanned ? "unban" : "ban";
        Alert.alert(
            `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
            `Are you sure you want to ${action} this user? ${user.isBanned ? "They will be able to use the app again." : "They will not be able to create trips or insights."}`,
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: action.charAt(0).toUpperCase() + action.slice(1), 
                    style: user.isBanned ? "default" : "destructive",
                    onPress: async () => {
                        if (Platform.OS !== 'web') {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }
                        try {
                            await banUser({ targetUserId: id as string, ban: !user.isBanned });
                        } catch (error) {
                            Alert.alert("Error", `Failed to ${action} user`);
                        }
                    }
                },
            ]
        );
    };

    const handleToggleShadowBan = async () => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        try {
            await shadowBanUser({ targetUserId: id as string, shadowBan: !user.isShadowBanned });
        } catch (error) {
            Alert.alert("Error", "Failed to update shadow ban status");
        }
    };

    const handleToggleAdmin = () => {
        const action = user.isAdmin ? "remove admin rights from" : "make admin";
        Alert.alert(
            "Change Admin Status",
            `Are you sure you want to ${action} this user?`,
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Confirm", 
                    onPress: async () => {
                        if (Platform.OS !== 'web') {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        }
                        try {
                            await setUserAdmin({ targetUserId: id as string, isAdmin: !user.isAdmin });
                        } catch (error) {
                            Alert.alert("Error", "Failed to update admin status");
                        }
                    }
                },
            ]
        );
    };

    const handleSaveField = async (field: string) => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        try {
            if (field === "name") {
                await updateUserDetails({ targetUserId: id as string, name: editName.trim() });
            } else if (field === "email") {
                await updateUserDetails({ targetUserId: id as string, email: editEmail.trim() });
            } else if (field === "credits") {
                const credits = parseInt(editCredits, 10);
                if (isNaN(credits) || credits < 0) {
                    Alert.alert("Invalid", "Please enter a valid number");
                    return;
                }
                await adjustTripCredits({ targetUserId: id as string, credits });
            }
            setEditingField(null);
        } catch (error) {
            Alert.alert("Error", `Failed to update ${field}`);
        }
    };

    const handleChangePlan = async (plan: "free" | "premium") => {
        if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        try {
            const planArgs: any = { targetUserId: id as string, plan };
            if (plan === "premium") {
                // Default 1 year subscription
                planArgs.subscriptionType = "yearly";
                planArgs.subscriptionExpiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
            }
            await updateUserPlan(planArgs);
            setShowPlanModal(false);
        } catch (error) {
            Alert.alert("Error", "Failed to update plan");
        }
    };

    const handleResetTrips = () => {
        Alert.alert(
            "Reset Trip Counter",
            "This will reset the trips generated count to 0. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    onPress: async () => {
                        if (Platform.OS !== 'web') {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }
                        try {
                            await adjustTripCredits({ 
                                targetUserId: id as string, 
                                credits: user.tripCredits || 0, 
                                resetGenerated: true 
                            });
                        } catch (error) {
                            Alert.alert("Error", "Failed to reset trip counter");
                        }
                    },
                },
            ]
        );
    };

    const handleClearSessions = () => {
        Alert.alert(
            "Clear All Sessions",
            "This will log the user out of all devices. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                        if (Platform.OS !== 'web') {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        }
                        try {
                            const result = await deleteUserSessions({ targetUserId: id as string });
                            Alert.alert("Done", `Cleared ${(result as any)?.deleted || 0} sessions`);
                        } catch (error) {
                            Alert.alert("Error", "Failed to clear sessions");
                        }
                    },
                },
            ]
        );
    };

    if (!user) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>User Details</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* User Profile Card */}
                    <View style={[styles.profileCard, { backgroundColor: colors.card }]}>
                        <View style={[styles.avatarLarge, { backgroundColor: colors.primary }]}>
                            <Text style={styles.avatarLargeText}>
                                {(user.name || user.email || "?")[0].toUpperCase()}
                            </Text>
                        </View>
                        
                        {/* Editable Name */}
                        {editingField === "name" ? (
                            <View style={styles.editRow}>
                                <TextInput
                                    style={[styles.editInput, { color: colors.text, borderColor: colors.primary, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}
                                    value={editName}
                                    onChangeText={setEditName}
                                    autoFocus
                                    placeholder="Enter name"
                                    placeholderTextColor={colors.textMuted}
                                />
                                <TouchableOpacity onPress={() => handleSaveField("name")} style={[styles.editBtn, { backgroundColor: colors.primary }]}>
                                    <Ionicons name="checkmark" size={18} color="#1A1A1A" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => { setEditingField(null); setEditName(user.name || ""); }} style={[styles.editBtn, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                    <Ionicons name="close" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity onPress={() => setEditingField("name")} style={styles.editableRow}>
                                <Text style={[styles.userName, { color: colors.text }]}>{user.name || "Unknown"}</Text>
                                <Ionicons name="pencil" size={14} color={colors.textMuted} style={{ marginLeft: 6 }} />
                            </TouchableOpacity>
                        )}
                        
                        {/* Editable Email */}
                        {editingField === "email" ? (
                            <View style={[styles.editRow, { marginTop: 4 }]}>
                                <TextInput
                                    style={[styles.editInput, { color: colors.text, borderColor: colors.primary, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}
                                    value={editEmail}
                                    onChangeText={setEditEmail}
                                    autoFocus
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    placeholder="Enter email"
                                    placeholderTextColor={colors.textMuted}
                                />
                                <TouchableOpacity onPress={() => handleSaveField("email")} style={[styles.editBtn, { backgroundColor: colors.primary }]}>
                                    <Ionicons name="checkmark" size={18} color="#1A1A1A" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => { setEditingField(null); setEditEmail(user.email || ""); }} style={[styles.editBtn, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                    <Ionicons name="close" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity onPress={() => setEditingField("email")} style={styles.editableRow}>
                                <Text style={[styles.userEmail, { color: colors.textMuted }]}>{user.email}</Text>
                                <Ionicons name="pencil" size={12} color={colors.textMuted} style={{ marginLeft: 6 }} />
                            </TouchableOpacity>
                        )}
                        
                        <View style={styles.badgesRow}>
                            {user.isAdmin && (
                                <View style={[styles.badge, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                                    <Ionicons name="shield" size={12} color="#4F46E5" />
                                    <Text style={[styles.badgeText, { color: '#4F46E5' }]}>Admin</Text>
                                </View>
                            )}
                            {user.isBanned && (
                                <View style={[styles.badge, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                                    <Ionicons name="ban" size={12} color="#DC2626" />
                                    <Text style={[styles.badgeText, { color: '#DC2626' }]}>Banned</Text>
                                </View>
                            )}
                            {user.isShadowBanned && (
                                <View style={[styles.badge, { backgroundColor: 'rgba(251, 191, 36, 0.2)' }]}>
                                    <Ionicons name="eye-off" size={12} color="#D97706" />
                                    <Text style={[styles.badgeText, { color: '#D97706' }]}>Shadow Banned</Text>
                                </View>
                            )}
                            <View style={[styles.badge, { 
                                backgroundColor: user.plan === 'premium' 
                                    ? 'rgba(16, 185, 129, 0.2)' 
                                    : isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' 
                            }]}>
                                <Ionicons 
                                    name={user.plan === 'premium' ? "diamond" : "person"} 
                                    size={12} 
                                    color={user.plan === 'premium' ? "#059669" : colors.textMuted} 
                                />
                                <Text style={[styles.badgeText, { 
                                    color: user.plan === 'premium' ? "#059669" : colors.textMuted 
                                }]}>
                                    {user.plan === 'premium' ? 'Premium' : 'Free'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Stats */}
                    <View style={styles.statsGrid}>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="airplane" size={24} color={colors.primary} />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.tripsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Trips</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="arrow-up-circle" size={24} color="#2563EB" />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.upcomingTripsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Upcoming</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="checkmark-done-circle" size={24} color="#059669" />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.pastTripsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Past Trips</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="chatbubbles" size={24} color={colors.primary} />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.insightsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Insights</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="heart" size={24} color="#F59E0B" />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.totalLikes}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Likes</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Ionicons name="checkmark-circle" size={24} color="#059669" />
                            <Text style={[styles.statValue, { color: colors.text }]}>{user.approvalRate}%</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Approved</Text>
                        </View>
                    </View>

                    {/* Account Details */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <Text style={[styles.cardTitle, { color: colors.textMuted }]}>ACCOUNT DETAILS</Text>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Member Since</Text>
                            <Text style={[styles.breakdownValue, { color: colors.text }]}>
                                {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown"}
                            </Text>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Last Active</Text>
                            <Text style={[styles.breakdownValue, { color: colors.text }]}>
                                {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"}
                            </Text>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Auth Provider</Text>
                            <Text style={[styles.breakdownValue, { color: colors.text }]}>
                                {(user.authProvider || "unknown").charAt(0).toUpperCase() + (user.authProvider || "unknown").slice(1)}
                            </Text>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Active Sessions</Text>
                            <Text style={[styles.breakdownValue, { color: colors.text }]}>{user.activeSessionsCount}</Text>
                        </View>
                    </View>

                    {/* Plan & Subscription */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <View style={styles.cardTitleRow}>
                            <Text style={[styles.cardTitle, { color: colors.textMuted }]}>PLAN & SUBSCRIPTION</Text>
                            <TouchableOpacity onPress={() => setShowPlanModal(true)} style={[styles.editSmallBtn, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                <Ionicons name="pencil" size={12} color={colors.textMuted} />
                                <Text style={[styles.editSmallBtnText, { color: colors.textMuted }]}>Change</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Plan</Text>
                            <TouchableOpacity onPress={() => setShowPlanModal(true)}>
                                <View style={[styles.statusBadge, { 
                                    backgroundColor: user.plan === 'premium' ? 'rgba(16, 185, 129, 0.2)' : isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' 
                                }]}>
                                    <Text style={[styles.statusText, { 
                                        color: user.plan === 'premium' ? '#059669' : colors.textMuted 
                                    }]}>
                                        {user.plan === 'premium' ? 'Premium' : 'Free'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        </View>
                        {user.subscriptionType && (
                            <View style={styles.breakdownRow}>
                                <Text style={[styles.breakdownLabel, { color: colors.text }]}>Billing</Text>
                                <Text style={[styles.breakdownValue, { color: colors.text }]}>
                                    {user.subscriptionType === 'yearly' ? 'Yearly' : 'Monthly'}
                                </Text>
                            </View>
                        )}
                        {user.subscriptionExpiresAt && (
                            <View style={styles.breakdownRow}>
                                <Text style={[styles.breakdownLabel, { color: colors.text }]}>Expires</Text>
                                <Text style={[styles.breakdownValue, { 
                                    color: user.subscriptionExpiresAt < Date.now() 
                                        ? (user.subscriptionExpiresAt + (16 * 24 * 60 * 60 * 1000) > Date.now() ? '#D97706' : '#DC2626')
                                        : colors.text 
                                }]}>
                                    {new Date(user.subscriptionExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    {user.subscriptionExpiresAt < Date.now() 
                                        ? (user.subscriptionExpiresAt + (16 * 24 * 60 * 60 * 1000) > Date.now() ? ' (Grace Period)' : ' (Expired)')
                                        : ''}
                                </Text>
                            </View>
                        )}
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Trips Generated</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={[styles.breakdownValue, { color: colors.text }]}>{user.tripsGenerated}</Text>
                                <TouchableOpacity onPress={handleResetTrips} style={[styles.miniBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '600' }}>Reset</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Trip Credits</Text>
                            {editingField === "credits" ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <TextInput
                                        style={[styles.editInputSmall, { color: colors.text, borderColor: colors.primary, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}
                                        value={editCredits}
                                        onChangeText={setEditCredits}
                                        autoFocus
                                        keyboardType="number-pad"
                                    />
                                    <TouchableOpacity onPress={() => handleSaveField("credits")} style={[styles.editBtnSmall, { backgroundColor: colors.primary }]}>
                                        <Ionicons name="checkmark" size={14} color="#1A1A1A" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => { setEditingField(null); setEditCredits(String(user.tripCredits || 0)); }} style={[styles.editBtnSmall, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                        <Ionicons name="close" size={14} color={colors.textMuted} />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <TouchableOpacity onPress={() => setEditingField("credits")} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={[styles.breakdownValue, { color: colors.text }]}>{user.tripCredits}</Text>
                                    <Ionicons name="pencil" size={12} color={colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {/* Trip Destinations */}
                    {user.tripDestinations && user.tripDestinations.length > 0 && (
                        <View style={[styles.card, { backgroundColor: colors.card }]}>
                            <Text style={[styles.cardTitle, { color: colors.textMuted }]}>TRIP DESTINATIONS</Text>
                            {user.tripDestinations.slice(0, 10).map((trip: any, index: number) => (
                                <View 
                                    key={index}
                                    style={[
                                        styles.breakdownRow,
                                        index === Math.min(9, user.tripDestinations.length - 1) && { borderBottomWidth: 0 }
                                    ]}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                        <Ionicons name="location" size={16} color={colors.primary} />
                                        <Text style={[styles.breakdownLabel, { color: colors.text }]} numberOfLines={1}>
                                            {trip.destination}
                                        </Text>
                                    </View>
                                    <View style={[styles.statusBadge, { 
                                        backgroundColor: trip.endDate < Date.now()
                                            ? 'rgba(16, 185, 129, 0.2)'
                                            : 'rgba(37, 99, 235, 0.2)'
                                    }]}>
                                        <Text style={[styles.statusText, { 
                                            color: trip.endDate < Date.now() ? '#059669' : '#2563EB'
                                        }]}>
                                            {trip.endDate < Date.now() ? 'Past' : 'Upcoming'}
                                        </Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Insights Breakdown */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <Text style={[styles.cardTitle, { color: colors.textMuted }]}>INSIGHTS BREAKDOWN</Text>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Total Submitted</Text>
                            <Text style={[styles.breakdownValue, { color: colors.text }]}>{user.insightsCount}</Text>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Approved</Text>
                            <Text style={[styles.breakdownValue, { color: '#059669' }]}>{user.approvedInsightsCount}</Text>
                        </View>
                        <View style={styles.breakdownRow}>
                            <Text style={[styles.breakdownLabel, { color: colors.text }]}>Rejected</Text>
                            <Text style={[styles.breakdownValue, { color: '#DC2626' }]}>{user.rejectedInsightsCount}</Text>
                        </View>
                    </View>

                    {/* Recent Insights */}
                    {user.insights && user.insights.length > 0 && (
                        <View style={[styles.card, { backgroundColor: colors.card }]}>
                            <Text style={[styles.cardTitle, { color: colors.textMuted }]}>RECENT INSIGHTS</Text>
                            {user.insights.slice(0, 5).map((insight: any, index: number) => (
                                <TouchableOpacity 
                                    key={insight._id}
                                    style={[
                                        styles.insightItem,
                                        { borderBottomColor: colors.border },
                                        index === Math.min(4, user.insights.length - 1) && { borderBottomWidth: 0 }
                                    ]}
                                    onPress={() => router.push(`/admin/insights/${insight._id}` as any)}
                                >
                                    <View style={styles.insightInfo}>
                                        <Text style={[styles.insightDestination, { color: colors.text }]}>
                                            {insight.destination || "Unknown"}
                                        </Text>
                                        <Text style={[styles.insightContent, { color: colors.textMuted }]} numberOfLines={1}>
                                            {insight.content}
                                        </Text>
                                    </View>
                                    <View style={[
                                        styles.statusBadge,
                                        { backgroundColor: 
                                            insight.moderationStatus === 'approved' ? 'rgba(16, 185, 129, 0.2)' :
                                            insight.moderationStatus === 'rejected' ? 'rgba(239, 68, 68, 0.2)' :
                                            'rgba(251, 191, 36, 0.2)'
                                        }
                                    ]}>
                                        <Text style={[
                                            styles.statusText,
                                            { color: 
                                                insight.moderationStatus === 'approved' ? '#059669' :
                                                insight.moderationStatus === 'rejected' ? '#DC2626' :
                                                '#D97706'
                                            }
                                        ]}>
                                            {insight.moderationStatus || 'pending'}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {/* Admin Actions */}
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>ADMIN ACTIONS</Text>
                    <View style={[styles.actionsCard, { backgroundColor: colors.card }]}>
                        <TouchableOpacity 
                            style={[styles.actionItem, { borderBottomColor: colors.border }]}
                            onPress={handleToggleShadowBan}
                        >
                            <View style={[styles.actionIconContainer, { 
                                backgroundColor: user.isShadowBanned 
                                    ? 'rgba(251, 191, 36, 0.2)' 
                                    : isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }]}>
                                <Ionicons 
                                    name={user.isShadowBanned ? "eye" : "eye-off"} 
                                    size={20} 
                                    color={user.isShadowBanned ? "#D97706" : colors.textMuted} 
                                />
                            </View>
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionTitle, { color: colors.text }]}>
                                    {user.isShadowBanned ? "Remove Shadow Ban" : "Shadow Ban"}
                                </Text>
                                <Text style={[styles.actionSubtitle, { color: colors.textMuted }]}>
                                    {user.isShadowBanned 
                                        ? "User's content will be visible again" 
                                        : "Hide user's content without notification"}
                                </Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.actionItem, { borderBottomColor: colors.border }]}
                            onPress={handleToggleBan}
                        >
                            <View style={[styles.actionIconContainer, { 
                                backgroundColor: user.isBanned 
                                    ? 'rgba(239, 68, 68, 0.2)' 
                                    : isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }]}>
                                <Ionicons 
                                    name={user.isBanned ? "checkmark-circle" : "ban"} 
                                    size={20} 
                                    color={user.isBanned ? "#DC2626" : colors.textMuted} 
                                />
                            </View>
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionTitle, { color: user.isBanned ? "#DC2626" : colors.text }]}>
                                    {user.isBanned ? "Unban User" : "Ban User"}
                                </Text>
                                <Text style={[styles.actionSubtitle, { color: colors.textMuted }]}>
                                    {user.isBanned 
                                        ? "Restore user access to the app" 
                                        : "Block user from creating content"}
                                </Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.actionItem, { borderBottomColor: colors.border }]}
                            onPress={handleToggleAdmin}
                        >
                            <View style={[styles.actionIconContainer, { 
                                backgroundColor: user.isAdmin 
                                    ? 'rgba(99, 102, 241, 0.2)' 
                                    : isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }]}>
                                <Ionicons 
                                    name="shield" 
                                    size={20} 
                                    color={user.isAdmin ? "#4F46E5" : colors.textMuted} 
                                />
                            </View>
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionTitle, { color: colors.text }]}>
                                    {user.isAdmin ? "Remove Admin" : "Make Admin"}
                                </Text>
                                <Text style={[styles.actionSubtitle, { color: colors.textMuted }]}>
                                    {user.isAdmin 
                                        ? "Revoke admin privileges" 
                                        : "Grant admin access"}
                                </Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.actionItem, { borderBottomWidth: 0 }]}
                            onPress={handleClearSessions}
                        >
                            <View style={[styles.actionIconContainer, { 
                                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }]}>
                                <Ionicons name="log-out" size={20} color={colors.textMuted} />
                            </View>
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionTitle, { color: colors.text }]}>
                                    Clear All Sessions
                                </Text>
                                <Text style={[styles.actionSubtitle, { color: colors.textMuted }]}>
                                    Log user out of all devices ({user.activeSessionsCount} active)
                                </Text>
                            </View>
                        </TouchableOpacity>
                    </View>

                    {/* User ID */}
                    <View style={[styles.card, { backgroundColor: colors.card, marginBottom: 20 }]}>
                        <Text style={[styles.cardTitle, { color: colors.textMuted }]}>USER ID</Text>
                        <Text style={[styles.userIdText, { color: colors.textMuted }]} selectable>{user.userId}</Text>
                    </View>

                    <View style={{ height: 40 }} />
                </ScrollView>

                {/* Plan Change Modal */}
                <Modal visible={showPlanModal} transparent animationType="fade">
                    <View style={styles.modalOverlay}>
                        <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Change User Plan</Text>
                            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                                Current: {user.plan === 'premium' ? 'Premium' : 'Free'}
                            </Text>
                            
                            <TouchableOpacity
                                style={[styles.planOption, { 
                                    borderColor: user.plan === 'free' ? colors.primary : colors.border,
                                    backgroundColor: user.plan === 'free' ? (isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)') : 'transparent',
                                }]}
                                onPress={() => handleChangePlan("free")}
                            >
                                <View style={[styles.planIconContainer, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
                                    <Ionicons name="person" size={24} color={colors.textMuted} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.planName, { color: colors.text }]}>Free Plan</Text>
                                    <Text style={[styles.planDesc, { color: colors.textMuted }]}>Limited trips, basic features</Text>
                                </View>
                                {user.plan === 'free' && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.planOption, { 
                                    borderColor: user.plan === 'premium' ? '#059669' : colors.border,
                                    backgroundColor: user.plan === 'premium' ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                                }]}
                                onPress={() => handleChangePlan("premium")}
                            >
                                <View style={[styles.planIconContainer, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                                    <Ionicons name="diamond" size={24} color="#059669" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.planName, { color: colors.text }]}>Premium Plan</Text>
                                    <Text style={[styles.planDesc, { color: colors.textMuted }]}>Unlimited trips, 1 year subscription</Text>
                                </View>
                                {user.plan === 'premium' && <Ionicons name="checkmark-circle" size={22} color="#059669" />}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.modalCancelBtn, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
                                onPress={() => setShowPlanModal(false)}
                            >
                                <Text style={[styles.modalCancelText, { color: colors.text }]}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
            </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    headerButton: {
        width: 40,
        height: 40,
        justifyContent: "center",
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: "600",
    },
    content: {
        flex: 1,
    },
    profileCard: {
        margin: 16,
        padding: 24,
        borderRadius: 16,
        alignItems: "center",
    },
    avatarLarge: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 16,
    },
    avatarLargeText: {
        fontSize: 32,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    userName: {
        fontSize: 22,
        fontWeight: "700",
    },
    userEmail: {
        fontSize: 15,
        marginTop: 4,
    },
    editableRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    editRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        width: "100%",
        paddingHorizontal: 8,
    },
    editInput: {
        flex: 1,
        fontSize: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1.5,
    },
    editInputSmall: {
        width: 80,
        fontSize: 15,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1.5,
        textAlign: "center",
    },
    editBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        justifyContent: "center",
        alignItems: "center",
    },
    editBtnSmall: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
    },
    editSmallBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        gap: 4,
    },
    editSmallBtnText: {
        fontSize: 11,
        fontWeight: "600",
    },
    cardTitleRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    miniBtn: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
    },
    userIdText: {
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    // Modal styles
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
    },
    modalContent: {
        width: "100%",
        maxWidth: 400,
        borderRadius: 16,
        padding: 24,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: "700",
        textAlign: "center",
    },
    modalSubtitle: {
        fontSize: 14,
        textAlign: "center",
        marginTop: 4,
        marginBottom: 20,
    },
    planOption: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 1.5,
        marginBottom: 12,
        gap: 12,
    },
    planIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: "center",
        alignItems: "center",
    },
    planName: {
        fontSize: 16,
        fontWeight: "600",
    },
    planDesc: {
        fontSize: 13,
        marginTop: 2,
    },
    modalCancelBtn: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: "center",
        marginTop: 4,
    },
    modalCancelText: {
        fontSize: 16,
        fontWeight: "600",
    },
    badgesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        marginTop: 16,
        gap: 8,
    },
    badge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "600",
    },
    statsGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: 12,
        gap: 8,
    },
    statCard: {
        width: "31%",
        padding: 12,
        borderRadius: 12,
        alignItems: "center",
        marginBottom: 4,
    },
    statValue: {
        fontSize: 20,
        fontWeight: "700",
        marginTop: 6,
    },
    statLabel: {
        fontSize: 13,
        marginTop: 2,
    },
    card: {
        marginHorizontal: 16,
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
    },
    cardTitle: {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    breakdownRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
    },
    breakdownLabel: {
        fontSize: 15,
    },
    breakdownValue: {
        fontSize: 15,
        fontWeight: "600",
    },
    insightItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    insightInfo: {
        flex: 1,
    },
    insightDestination: {
        fontSize: 15,
        fontWeight: "500",
    },
    insightContent: {
        fontSize: 13,
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        marginLeft: 8,
    },
    statusText: {
        fontSize: 11,
        fontWeight: "600",
        textTransform: "capitalize",
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.5,
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 12,
    },
    actionsCard: {
        marginHorizontal: 16,
        borderRadius: 12,
        overflow: "hidden",
    },
    actionItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
    },
    actionIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    actionTextContainer: {
        flex: 1,
    },
    actionTitle: {
        fontSize: 16,
        fontWeight: "500",
    },
    actionSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
});
