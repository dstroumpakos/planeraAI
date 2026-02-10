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
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";

export default function AdminDashboard() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    
    const stats = useQuery(
        (api as any).admin.getStats,
        token ? { token } : "skip"
    );
    
    const isAdmin = useQuery(
        (api as any).admin.isAdmin,
        token ? { token } : "skip"
    );

    if (isAdmin === false) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.errorContainer}>
                    <Ionicons name="lock-closed" size={60} color={colors.textMuted} />
                    <Text style={[styles.errorTitle, { color: colors.text }]}>Access Denied</Text>
                    <Text style={[styles.errorText, { color: colors.textMuted }]}>
                        You don't have admin privileges.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.backButton, { backgroundColor: colors.primary }]}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.backButtonText}>Go Back</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (!stats) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading admin data...</Text>
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
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Admin Dashboard</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* Quick Stats */}
                    <View style={styles.statsGrid}>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(99, 102, 241, 0.2)' : '#E0E7FF' }]}>
                                <Ionicons name="people" size={24} color="#4F46E5" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalUsersCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Users</Text>
                        </View>
                        
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5' }]}>
                                <Ionicons name="diamond" size={24} color="#059669" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.premiumUsersCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Premium Users</Text>
                        </View>

                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(59, 130, 246, 0.2)' : '#DBEAFE' }]}>
                                <Ionicons name="airplane" size={24} color="#2563EB" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalTripsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Trips</Text>
                        </View>
                        
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5' }]}>
                                <Ionicons name="checkmark-circle" size={24} color="#059669" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.completedTripsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Generated Trips</Text>
                        </View>

                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(251, 191, 36, 0.2)' : '#FEF3C7' }]}>
                                <Ionicons name="time" size={24} color="#D97706" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.pendingInsightsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending Insights</Text>
                        </View>
                        
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2' }]}>
                                <Ionicons name="flag" size={24} color="#DC2626" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.flaggedInsightsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Flagged</Text>
                        </View>
                        
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(139, 92, 246, 0.2)' : '#EDE9FE' }]}>
                                <Ionicons name="chatbubbles" size={24} color="#7C3AED" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalInsightsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Insights</Text>
                        </View>
                        
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.statIconContainer, { backgroundColor: isDarkMode ? 'rgba(20, 184, 166, 0.2)' : '#CCFBF1' }]}>
                                <Ionicons name="pulse" size={24} color="#0D9488" />
                            </View>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.activeSessionsCount}</Text>
                            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Active Sessions</Text>
                        </View>
                    </View>

                    {/* Quick Actions */}
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
                    <View style={[styles.menuContainer, { backgroundColor: colors.card }]}>
                        <TouchableOpacity 
                            style={[styles.menuItem, { borderBottomColor: colors.border }]}
                            onPress={() => router.push("/admin/insights" as any)}
                        >
                            <View style={[styles.menuIconContainer, { backgroundColor: isDarkMode ? 'rgba(251, 191, 36, 0.2)' : '#FEF3C7' }]}>
                                <Ionicons name="chatbubbles" size={20} color="#D97706" />
                            </View>
                            <View style={styles.menuTextContainer}>
                                <Text style={[styles.menuTitle, { color: colors.text }]}>Moderate Insights</Text>
                                <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>
                                    {stats.pendingInsightsCount} pending review
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.menuItem, { borderBottomWidth: 0 }]}
                            onPress={() => router.push("/admin/users" as any)}
                        >
                            <View style={[styles.menuIconContainer, { backgroundColor: isDarkMode ? 'rgba(99, 102, 241, 0.2)' : '#E0E7FF' }]}>
                                <Ionicons name="people" size={20} color="#4F46E5" />
                            </View>
                            <View style={styles.menuTextContainer}>
                                <Text style={[styles.menuTitle, { color: colors.text }]}>Manage Users</Text>
                                <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>
                                    {stats.totalUsersCount} total users · {stats.premiumUsersCount} premium
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* Top Destinations by Insights */}
                    {stats.topDestinations && stats.topDestinations.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Destinations (Insights)</Text>
                            <View style={[styles.listContainer, { backgroundColor: colors.card }]}>
                                {stats.topDestinations.map((item: any, index: number) => (
                                    <View 
                                        key={item.destination} 
                                        style={[
                                            styles.listItem, 
                                            { borderBottomColor: colors.border },
                                            index === stats.topDestinations.length - 1 && { borderBottomWidth: 0 }
                                        ]}
                                    >
                                        <View style={[styles.rankBadge, { backgroundColor: colors.primary }]}>
                                            <Text style={styles.rankText}>{index + 1}</Text>
                                        </View>
                                        <Text style={[styles.listItemTitle, { color: colors.text }]}>{item.destination}</Text>
                                        <Text style={[styles.listItemValue, { color: colors.textMuted }]}>{item.count} insights</Text>
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    {/* Top Destinations by Trips */}
                    {stats.topTripDestinations && stats.topTripDestinations.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Destinations (Trips)</Text>
                            <View style={[styles.listContainer, { backgroundColor: colors.card }]}>
                                {stats.topTripDestinations.map((item: any, index: number) => (
                                    <View 
                                        key={item.destination} 
                                        style={[
                                            styles.listItem, 
                                            { borderBottomColor: colors.border },
                                            index === stats.topTripDestinations.length - 1 && { borderBottomWidth: 0 }
                                        ]}
                                    >
                                        <View style={[styles.rankBadge, { backgroundColor: '#2563EB' }]}>
                                            <Text style={styles.rankText}>{index + 1}</Text>
                                        </View>
                                        <Text style={[styles.listItemTitle, { color: colors.text }]}>{item.destination}</Text>
                                        <Text style={[styles.listItemValue, { color: colors.textMuted }]}>{item.count} trips</Text>
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    {/* Most Liked Insights */}
                    {stats.mostLikedInsights && stats.mostLikedInsights.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Most Liked Insights</Text>
                            <View style={[styles.listContainer, { backgroundColor: colors.card }]}>
                                {stats.mostLikedInsights.map((item: any, index: number) => (
                                    <TouchableOpacity 
                                        key={item._id} 
                                        style={[
                                            styles.insightItem, 
                                            { borderBottomColor: colors.border },
                                            index === stats.mostLikedInsights.length - 1 && { borderBottomWidth: 0 }
                                        ]}
                                        onPress={() => router.push(`/admin/insights/${item._id}` as any)}
                                    >
                                        <View style={styles.insightHeader}>
                                            <Text style={[styles.insightDestination, { color: colors.text }]}>{item.destination}</Text>
                                            <View style={styles.likesContainer}>
                                                <Ionicons name="heart" size={14} color="#F59E0B" />
                                                <Text style={[styles.likesText, { color: colors.textMuted }]}>{item.likes}</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.insightContent, { color: colors.textMuted }]} numberOfLines={2}>
                                            {item.content}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </>
                    )}

                    {/* Most Active Users */}
                    {stats.mostActiveUsers && stats.mostActiveUsers.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Most Active Users</Text>
                            <View style={[styles.listContainer, { backgroundColor: colors.card }]}>
                                {stats.mostActiveUsers.map((item: any, index: number) => (
                                    <TouchableOpacity 
                                        key={item.userId} 
                                        style={[
                                            styles.listItem, 
                                            { borderBottomColor: colors.border },
                                            index === stats.mostActiveUsers.length - 1 && { borderBottomWidth: 0 }
                                        ]}
                                        onPress={() => router.push(`/admin/users/${item.userId}` as any)}
                                    >
                                        <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                                            <Text style={styles.avatarText}>{(item.name || "?")[0].toUpperCase()}</Text>
                                        </View>
                                        <View style={styles.userInfo}>
                                            <Text style={[styles.listItemTitle, { color: colors.text }]}>{item.name}</Text>
                                            <Text style={[styles.userEmail, { color: colors.textMuted }]}>{item.email}</Text>
                                        </View>
                                        <Text style={[styles.listItemValue, { color: colors.textMuted }]}>{item.insightsCount} insights</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </>
                    )}

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
    loadingText: {
        marginTop: 12,
        fontSize: 14,
    },
    errorContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    errorTitle: {
        fontSize: 24,
        fontWeight: "700",
        marginTop: 16,
    },
    errorText: {
        fontSize: 16,
        textAlign: "center",
        marginTop: 8,
    },
    backButton: {
        marginTop: 24,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    backButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
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
    statsGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 16,
        gap: 12,
    },
    statCard: {
        width: "47%",
        padding: 16,
        borderRadius: 12,
        alignItems: "center",
    },
    statIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 12,
    },
    statValue: {
        fontSize: 28,
        fontWeight: "700",
    },
    statLabel: {
        fontSize: 13,
        marginTop: 4,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "600",
        letterSpacing: 0.5,
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 12,
    },
    menuContainer: {
        marginHorizontal: 16,
        borderRadius: 12,
        overflow: "hidden",
    },
    menuItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
    },
    menuIconContainer: {
        width: 40,
        height: 40,
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
        fontWeight: "500",
    },
    menuSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    listContainer: {
        marginHorizontal: 16,
        borderRadius: 12,
        overflow: "hidden",
    },
    listItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
    },
    rankBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    rankText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    listItemTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: "500",
    },
    listItemValue: {
        fontSize: 14,
    },
    insightItem: {
        padding: 16,
        borderBottomWidth: 1,
    },
    insightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    insightDestination: {
        fontSize: 15,
        fontWeight: "600",
    },
    likesContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    likesText: {
        fontSize: 13,
    },
    insightContent: {
        fontSize: 14,
        lineHeight: 20,
    },
    avatarPlaceholder: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    avatarText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    userInfo: {
        flex: 1,
    },
    userEmail: {
        fontSize: 13,
        marginTop: 2,
    },
});
