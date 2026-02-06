import React from "react";
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
    
    const user = useQuery(
        (api as any).admin.getUser,
        token && id ? { token, targetUserId: id as string } : "skip"
    );
    
    const banUser = useAuthenticatedMutation((api as any).admin.banUser);
    const shadowBanUser = useAuthenticatedMutation((api as any).admin.shadowBanUser);
    const setUserAdmin = useAuthenticatedMutation((api as any).admin.setUserAdmin);

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
                        <Text style={[styles.userName, { color: colors.text }]}>{user.name || "Unknown"}</Text>
                        <Text style={[styles.userEmail, { color: colors.textMuted }]}>{user.email}</Text>
                        
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
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Trips</Text>
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
                            style={[styles.actionItem, { borderBottomWidth: 0 }]}
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
                    </View>

                    <View style={{ height: 40 }} />
                </ScrollView>
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
        width: "48%",
        padding: 16,
        borderRadius: 12,
        alignItems: "center",
        marginBottom: 4,
    },
    statValue: {
        fontSize: 24,
        fontWeight: "700",
        marginTop: 8,
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
