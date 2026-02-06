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
    TextInput,
    Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

export default function AdminInsightDetail() {
    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    
    const [showEditModal, setShowEditModal] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [editContent, setEditContent] = useState("");
    const [rejectReason, setRejectReason] = useState("");
    
    const insight = useQuery(
        (api as any).admin.getInsight,
        token && id ? { token, insightId: id as Id<"insights"> } : "skip"
    );
    
    const approveInsight = useAuthenticatedMutation((api as any).admin.approveInsight);
    const rejectInsight = useAuthenticatedMutation((api as any).admin.rejectInsight);
    const updateInsight = useAuthenticatedMutation((api as any).admin.updateInsight);
    const toggleFeature = useAuthenticatedMutation((api as any).admin.toggleFeatureInsight);
    const deleteInsight = useAuthenticatedMutation((api as any).admin.deleteInsight);

    const handleApprove = async () => {
        if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        try {
            await approveInsight({ insightId: id as Id<"insights"> });
            Alert.alert("Success", "Insight approved successfully");
        } catch (error) {
            Alert.alert("Error", "Failed to approve insight");
        }
    };

    const handleReject = async () => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        try {
            await rejectInsight({ 
                insightId: id as Id<"insights">,
                rejectReason: rejectReason.trim() || undefined,
            });
            setShowRejectModal(false);
            setRejectReason("");
            Alert.alert("Success", "Insight rejected");
        } catch (error) {
            Alert.alert("Error", "Failed to reject insight");
        }
    };

    const handleSaveEdit = async () => {
        try {
            await updateInsight({ 
                insightId: id as Id<"insights">,
                content: editContent,
            });
            setShowEditModal(false);
            Alert.alert("Success", "Insight updated");
        } catch (error) {
            Alert.alert("Error", "Failed to update insight");
        }
    };

    const handleToggleFeature = async () => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        try {
            await toggleFeature({ insightId: id as Id<"insights"> });
        } catch (error) {
            Alert.alert("Error", "Failed to toggle featured status");
        }
    };

    const handleDelete = () => {
        Alert.alert(
            "Delete Insight",
            "Are you sure you want to permanently delete this insight? This cannot be undone.",
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Delete", 
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await deleteInsight({ insightId: id as Id<"insights"> });
                            router.back();
                        } catch (error) {
                            Alert.alert("Error", "Failed to delete insight");
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

    const getStatusBgColor = (status: string) => {
        switch (status) {
            case 'approved': return isDarkMode ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5';
            case 'rejected': return isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2';
            case 'flagged': return isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2';
            default: return isDarkMode ? 'rgba(251, 191, 36, 0.2)' : '#FEF3C7';
        }
    };

    if (!insight) {
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
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Insight Detail</Text>
                    <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
                        <Ionicons name="trash-outline" size={22} color="#DC2626" />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* Status Badge */}
                    <View style={styles.statusRow}>
                        <View style={[
                            styles.statusBadge, 
                            { backgroundColor: getStatusBgColor(insight.moderationStatus || 'pending') }
                        ]}>
                            <Text style={[
                                styles.statusText, 
                                { color: getStatusColor(insight.moderationStatus || 'pending') }
                            ]}>
                                {(insight.moderationStatus || 'pending').toUpperCase()}
                            </Text>
                        </View>
                        {insight.featured && (
                            <View style={[styles.featuredBadge, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                                <Ionicons name="star" size={14} color="#4F46E5" />
                                <Text style={{ color: '#4F46E5', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Featured</Text>
                            </View>
                        )}
                    </View>

                    {/* Insight Content Card */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <View style={styles.cardHeader}>
                            <View style={[
                                styles.categoryBadge, 
                                { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FEF3C7' }
                            ]}>
                                <Ionicons 
                                    name={getCategoryIcon(insight.category) as any}
                                    size={16} 
                                    color={colors.primary}
                                />
                                <Text style={[styles.categoryText, { color: colors.primary }]}>
                                    {insight.category.replace('_', ' ')}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => {
                                setEditContent(insight.content);
                                setShowEditModal(true);
                            }}>
                                <Ionicons name="pencil" size={20} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.destination, { color: colors.text }]}>
                            {insight.destination || "Unknown destination"}
                        </Text>

                        <Text style={[styles.insightContent, { color: colors.text }]}>
                            "{insight.content}"
                        </Text>

                        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
                            <View style={styles.stat}>
                                <Ionicons name="heart" size={18} color="#F59E0B" />
                                <Text style={[styles.statValue, { color: colors.text }]}>{insight.likes || 0}</Text>
                                <Text style={[styles.statLabel, { color: colors.textMuted }]}>likes</Text>
                            </View>
                            <View style={styles.stat}>
                                <Ionicons name="flag" size={18} color="#DC2626" />
                                <Text style={[styles.statValue, { color: colors.text }]}>{insight.reportsCount || 0}</Text>
                                <Text style={[styles.statLabel, { color: colors.textMuted }]}>reports</Text>
                            </View>
                        </View>
                    </View>

                    {/* User Info Card */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <Text style={[styles.cardTitle, { color: colors.textMuted }]}>SUBMITTED BY</Text>
                        <TouchableOpacity 
                            style={styles.userRow}
                            onPress={() => router.push(`/admin/users/${insight.userId}` as any)}
                        >
                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                                <Text style={styles.avatarText}>{(insight.userName || "?")[0].toUpperCase()}</Text>
                            </View>
                            <View style={styles.userInfo}>
                                <Text style={[styles.userName, { color: colors.text }]}>{insight.userName}</Text>
                                <Text style={[styles.userEmail, { color: colors.textMuted }]}>{insight.userEmail}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* Timestamps Card */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <Text style={[styles.cardTitle, { color: colors.textMuted }]}>TIMELINE</Text>
                        <View style={styles.timelineItem}>
                            <Ionicons name="add-circle" size={18} color={colors.textMuted} />
                            <Text style={[styles.timelineLabel, { color: colors.textMuted }]}>Created</Text>
                            <Text style={[styles.timelineValue, { color: colors.text }]}>
                                {new Date(insight.createdAt).toLocaleString()}
                            </Text>
                        </View>
                        {insight.approvedAt && (
                            <View style={styles.timelineItem}>
                                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                                <Text style={[styles.timelineLabel, { color: colors.textMuted }]}>Approved</Text>
                                <Text style={[styles.timelineValue, { color: colors.text }]}>
                                    {new Date(insight.approvedAt).toLocaleString()}
                                </Text>
                            </View>
                        )}
                        {insight.rejectedAt && (
                            <View style={styles.timelineItem}>
                                <Ionicons name="close-circle" size={18} color="#DC2626" />
                                <Text style={[styles.timelineLabel, { color: colors.textMuted }]}>Rejected</Text>
                                <Text style={[styles.timelineValue, { color: colors.text }]}>
                                    {new Date(insight.rejectedAt).toLocaleString()}
                                </Text>
                            </View>
                        )}
                        {insight.rejectReason && (
                            <View style={[styles.rejectReasonBox, { backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.1)' : '#FEE2E2' }]}>
                                <Text style={[styles.rejectReasonLabel, { color: '#DC2626' }]}>Rejection Reason:</Text>
                                <Text style={[styles.rejectReasonText, { color: colors.text }]}>{insight.rejectReason}</Text>
                            </View>
                        )}
                    </View>

                    {/* Actions */}
                    <View style={styles.actionsContainer}>
                        <TouchableOpacity 
                            style={[styles.featureButton, { 
                                backgroundColor: insight.featured 
                                    ? 'rgba(99, 102, 241, 0.2)' 
                                    : colors.card,
                                borderColor: insight.featured ? '#4F46E5' : colors.border,
                            }]}
                            onPress={handleToggleFeature}
                        >
                            <Ionicons name={insight.featured ? "star" : "star-outline"} size={20} color="#4F46E5" />
                            <Text style={[styles.featureButtonText, { color: '#4F46E5' }]}>
                                {insight.featured ? "Unfeature" : "Feature"}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Primary Actions */}
                    {insight.moderationStatus !== 'approved' && (
                        <View style={styles.primaryActions}>
                            <TouchableOpacity 
                                style={[styles.rejectButton, { borderColor: '#DC2626' }]}
                                onPress={() => setShowRejectModal(true)}
                            >
                                <Ionicons name="close" size={20} color="#DC2626" />
                                <Text style={[styles.rejectButtonText, { color: '#DC2626' }]}>Reject</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.approveButton, { backgroundColor: colors.primary }]}
                                onPress={handleApprove}
                            >
                                <Ionicons name="checkmark" size={20} color="#1A1A1A" />
                                <Text style={[styles.approveButtonText]}>Approve</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    <View style={{ height: 40 }} />
                </ScrollView>

                {/* Edit Modal */}
                <Modal
                    visible={showEditModal}
                    animationType="slide"
                    presentationStyle="pageSheet"
                    onRequestClose={() => setShowEditModal(false)}
                >
                    <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                            <TouchableOpacity onPress={() => setShowEditModal(false)}>
                                <Text style={[styles.modalCancel, { color: colors.textMuted }]}>Cancel</Text>
                            </TouchableOpacity>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Insight</Text>
                            <TouchableOpacity onPress={handleSaveEdit}>
                                <Text style={[styles.modalSave, { color: colors.primary }]}>Save</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.modalContent}>
                            <TextInput
                                style={[styles.editInput, { 
                                    backgroundColor: colors.card, 
                                    borderColor: colors.border,
                                    color: colors.text,
                                }]}
                                value={editContent}
                                onChangeText={setEditContent}
                                multiline
                                placeholder="Edit insight content..."
                                placeholderTextColor={colors.textMuted}
                                textAlignVertical="top"
                            />
                        </View>
                    </SafeAreaView>
                </Modal>

                {/* Reject Modal */}
                <Modal
                    visible={showRejectModal}
                    animationType="slide"
                    presentationStyle="pageSheet"
                    onRequestClose={() => setShowRejectModal(false)}
                >
                    <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                            <TouchableOpacity onPress={() => setShowRejectModal(false)}>
                                <Text style={[styles.modalCancel, { color: colors.textMuted }]}>Cancel</Text>
                            </TouchableOpacity>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Reject Insight</Text>
                            <TouchableOpacity onPress={handleReject}>
                                <Text style={[styles.modalSave, { color: '#DC2626' }]}>Reject</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.modalContent}>
                            <Text style={[styles.rejectLabel, { color: colors.text }]}>Reason (optional)</Text>
                            <TextInput
                                style={[styles.editInput, { 
                                    backgroundColor: colors.card, 
                                    borderColor: colors.border,
                                    color: colors.text,
                                }]}
                                value={rejectReason}
                                onChangeText={setRejectReason}
                                multiline
                                placeholder="Enter rejection reason..."
                                placeholderTextColor={colors.textMuted}
                                textAlignVertical="top"
                            />
                        </View>
                    </SafeAreaView>
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
        padding: 16,
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: "700",
    },
    featuredBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    card: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    cardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    cardTitle: {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    categoryBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 6,
    },
    categoryText: {
        fontSize: 13,
        fontWeight: "500",
        textTransform: "capitalize",
    },
    destination: {
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 12,
    },
    insightContent: {
        fontSize: 16,
        lineHeight: 24,
        fontStyle: "italic",
    },
    statsRow: {
        flexDirection: "row",
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        gap: 32,
    },
    stat: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    statValue: {
        fontSize: 16,
        fontWeight: "600",
    },
    statLabel: {
        fontSize: 14,
    },
    userRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    avatarPlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    avatarText: {
        fontSize: 18,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: 16,
        fontWeight: "600",
    },
    userEmail: {
        fontSize: 14,
        marginTop: 2,
    },
    timelineItem: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12,
        gap: 8,
    },
    timelineLabel: {
        fontSize: 14,
        width: 80,
    },
    timelineValue: {
        fontSize: 14,
        flex: 1,
    },
    rejectReasonBox: {
        padding: 12,
        borderRadius: 8,
        marginTop: 8,
    },
    rejectReasonLabel: {
        fontSize: 12,
        fontWeight: "600",
        marginBottom: 4,
    },
    rejectReasonText: {
        fontSize: 14,
    },
    actionsContainer: {
        marginBottom: 16,
    },
    featureButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
    },
    featureButtonText: {
        fontSize: 16,
        fontWeight: "600",
    },
    primaryActions: {
        flexDirection: "row",
        gap: 12,
    },
    rejectButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 2,
        gap: 8,
    },
    rejectButtonText: {
        fontSize: 16,
        fontWeight: "600",
    },
    approveButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    approveButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    modalContainer: {
        flex: 1,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    modalCancel: {
        fontSize: 16,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: "600",
    },
    modalSave: {
        fontSize: 16,
        fontWeight: "600",
    },
    modalContent: {
        flex: 1,
        padding: 16,
    },
    rejectLabel: {
        fontSize: 14,
        fontWeight: "500",
        marginBottom: 8,
    },
    editInput: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        lineHeight: 24,
    },
});
