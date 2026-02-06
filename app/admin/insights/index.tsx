import React, { useState } from "react";
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

type StatusFilter = "pending" | "approved" | "rejected" | "flagged" | undefined;

const STATUS_TABS = [
    { key: "pending", label: "Pending", icon: "time" },
    { key: "approved", label: "Approved", icon: "checkmark-circle" },
    { key: "rejected", label: "Rejected", icon: "close-circle" },
    { key: "flagged", label: "Flagged", icon: "flag" },
] as const;

export default function AdminInsightsList() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
    
    const insights = useQuery(
        (api as any).admin.listInsights,
        token ? { token, status: statusFilter, limit: 50 } : "skip"
    );
    
    const approveInsight = useAuthenticatedMutation((api as any).admin.approveInsight);
    const rejectInsight = useAuthenticatedMutation((api as any).admin.rejectInsight);

    const handleQuickApprove = async (insightId: string) => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        try {
            await approveInsight({ insightId });
        } catch (error) {
            Alert.alert("Error", "Failed to approve insight");
        }
    };

    const handleQuickReject = async (insightId: string) => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        Alert.alert(
            "Reject Insight",
            "Are you sure you want to reject this insight?",
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Reject", 
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await rejectInsight({ insightId });
                        } catch (error) {
                            Alert.alert("Error", "Failed to reject insight");
                        }
                    }
                },
            ]
        );
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'food': return 'restaurant';
            case 'transport': return 'bus';
            case 'neighborhoods': return 'map';
            case 'timing': return 'time';
            case 'hidden_gem': return 'diamond';
            case 'avoid': return 'warning';
            default: return 'bulb';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'approved': return '#059669';
            case 'rejected': return '#DC2626';
            case 'flagged': return '#DC2626';
            default: return '#D97706';
        }
    };

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Moderate Insights</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Status Tabs */}
                <View style={[styles.filterWrapper, { borderBottomColor: colors.border }]}>
                    <ScrollView 
                        horizontal 
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterContainer}
                    >
                        {STATUS_TABS.map((tab) => (
                            <TouchableOpacity
                                key={tab.key}
                                style={[
                                    styles.filterChip,
                                    { backgroundColor: colors.card, borderColor: colors.border },
                                    statusFilter === tab.key && { backgroundColor: colors.text, borderColor: colors.text },
                                ]}
                                onPress={() => {
                                    if (Platform.OS !== 'web') {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    }
                                    setStatusFilter(tab.key);
                                }}
                            >
                                <Ionicons 
                                    name={tab.icon as any} 
                                    size={16} 
                                    color={statusFilter === tab.key ? colors.card : colors.textMuted} 
                                />
                                <Text style={[
                                    styles.filterText,
                                    { color: colors.textMuted },
                                    statusFilter === tab.key && { color: colors.card }
                                ]}>
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                {/* Insights List */}
                {!insights ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : insights.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="chatbubbles-outline" size={60} color={colors.textMuted} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Insights</Text>
                        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                            No {statusFilter} insights to review.
                        </Text>
                    </View>
                ) : (
                    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                        {insights.map((insight: any) => (
                            <TouchableOpacity
                                key={insight._id}
                                style={[styles.insightCard, { backgroundColor: colors.card }]}
                                onPress={() => router.push(`/admin/insights/${insight._id}` as any)}
                            >
                                <View style={styles.insightHeader}>
                                    <View style={[
                                        styles.categoryBadge, 
                                        { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FEF3C7' }
                                    ]}>
                                        <Ionicons 
                                            name={getCategoryIcon(insight.category) as any}
                                            size={14} 
                                            color={colors.primary}
                                        />
                                        <Text style={[styles.categoryText, { color: colors.primary }]}>
                                            {insight.category.replace('_', ' ')}
                                        </Text>
                                    </View>
                                    {insight.featured && (
                                        <View style={[styles.featuredBadge, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                                            <Ionicons name="star" size={12} color="#4F46E5" />
                                        </View>
                                    )}
                                </View>

                                <Text style={[styles.insightDestination, { color: colors.text }]}>
                                    {insight.destination || "Unknown destination"}
                                </Text>

                                <Text style={[styles.insightContent, { color: colors.textMuted }]} numberOfLines={3}>
                                    {insight.content}
                                </Text>

                                <View style={styles.insightMeta}>
                                    <Text style={[styles.metaText, { color: colors.textMuted }]}>
                                        {insight.userName} • {new Date(insight.createdAt).toLocaleDateString()}
                                    </Text>
                                    <View style={styles.likesContainer}>
                                        <Ionicons name="heart" size={14} color="#F59E0B" />
                                        <Text style={[styles.likesText, { color: colors.textMuted }]}>{insight.likes || 0}</Text>
                                    </View>
                                </View>

                                {/* Quick Actions for pending insights */}
                                {statusFilter === "pending" && (
                                    <View style={[styles.quickActions, { borderTopColor: colors.border }]}>
                                        <TouchableOpacity 
                                            style={[styles.actionButton, styles.rejectButton]}
                                            onPress={() => handleQuickReject(insight._id)}
                                        >
                                            <Ionicons name="close" size={18} color="#DC2626" />
                                            <Text style={[styles.actionButtonText, { color: '#DC2626' }]}>Reject</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity 
                                            style={[styles.actionButton, styles.approveButton, { backgroundColor: colors.primary }]}
                                            onPress={() => handleQuickApprove(insight._id)}
                                        >
                                            <Ionicons name="checkmark" size={18} color="#1A1A1A" />
                                            <Text style={[styles.actionButtonText, { color: '#1A1A1A' }]}>Approve</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                )}
            </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
    filterWrapper: {
        borderBottomWidth: 1,
    },
    filterContainer: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    filterChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        marginRight: 8,
    },
    filterText: {
        fontSize: 13,
        fontWeight: "600",
        marginLeft: 6,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: "600",
        marginTop: 16,
    },
    emptyText: {
        fontSize: 14,
        textAlign: "center",
        marginTop: 8,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    insightCard: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    insightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    categoryBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    categoryText: {
        fontSize: 12,
        fontWeight: "500",
        textTransform: "capitalize",
    },
    featuredBadge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
    },
    insightDestination: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 8,
    },
    insightContent: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 12,
    },
    insightMeta: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    metaText: {
        fontSize: 12,
    },
    likesContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    likesText: {
        fontSize: 12,
    },
    quickActions: {
        flexDirection: "row",
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        gap: 12,
    },
    actionButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        borderRadius: 8,
        gap: 6,
    },
    rejectButton: {
        backgroundColor: "rgba(220, 38, 38, 0.1)",
    },
    approveButton: {},
    actionButtonText: {
        fontSize: 14,
        fontWeight: "600",
    },
});
