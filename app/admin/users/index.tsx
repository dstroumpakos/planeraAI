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
    TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

export default function AdminUsersList() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    const [searchQuery, setSearchQuery] = useState("");
    
    const users = useQuery(
        (api as any).admin.listUsers,
        token ? { token, search: searchQuery || undefined, limit: 50 } : "skip"
    );

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Manage Users</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Search */}
                <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="search" size={20} color={colors.textMuted} />
                    <TextInput
                        style={[styles.searchInput, { color: colors.text }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search by name or email..."
                        placeholderTextColor={colors.textMuted}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery("")}>
                            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Users List */}
                {!users ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : users.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={60} color={colors.textMuted} />
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Users Found</Text>
                        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                            {searchQuery ? "Try a different search term" : "No users registered yet"}
                        </Text>
                    </View>
                ) : (
                    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                        {users.map((user: any) => (
                            <TouchableOpacity
                                key={user.userId}
                                style={[styles.userCard, { backgroundColor: colors.card }]}
                                onPress={() => {
                                    if (Platform.OS !== 'web') {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    }
                                    router.push(`/admin/users/${user.userId}` as any);
                                }}
                            >
                                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                                    <Text style={styles.avatarText}>
                                        {(user.name || user.email || "?")[0].toUpperCase()}
                                    </Text>
                                </View>
                                
                                <View style={styles.userInfo}>
                                    <View style={styles.userNameRow}>
                                        <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                                            {user.name || "Unknown"}
                                        </Text>
                                        {user.isAdmin && (
                                            <View style={[styles.badge, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                                                <Text style={[styles.badgeText, { color: '#4F46E5' }]}>Admin</Text>
                                            </View>
                                        )}
                                        {user.isBanned && (
                                            <View style={[styles.badge, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                                                <Text style={[styles.badgeText, { color: '#DC2626' }]}>Banned</Text>
                                            </View>
                                        )}
                                        {user.isShadowBanned && (
                                            <View style={[styles.badge, { backgroundColor: 'rgba(251, 191, 36, 0.2)' }]}>
                                                <Text style={[styles.badgeText, { color: '#D97706' }]}>Shadow</Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={[styles.userEmail, { color: colors.textMuted }]} numberOfLines={1}>
                                        {user.email}
                                    </Text>
                                    <View style={styles.statsRow}>
                                        <View style={styles.statItem}>
                                            <Ionicons name="airplane" size={12} color={colors.textMuted} />
                                            <Text style={[styles.statText, { color: colors.textMuted }]}>{user.tripsCount}</Text>
                                        </View>
                                        <View style={styles.statItem}>
                                            <Ionicons name="chatbubble" size={12} color={colors.textMuted} />
                                            <Text style={[styles.statText, { color: colors.textMuted }]}>{user.insightsCount}</Text>
                                        </View>
                                        <View style={styles.statItem}>
                                            <Ionicons name="heart" size={12} color={colors.textMuted} />
                                            <Text style={[styles.statText, { color: colors.textMuted }]}>{user.totalLikes}</Text>
                                        </View>
                                    </View>
                                </View>

                                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
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
    searchContainer: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 16,
        marginVertical: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
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
    userCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
    },
    avatarPlaceholder: {
        width: 48,
        height: 48,
        borderRadius: 24,
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
    userNameRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
    },
    userName: {
        fontSize: 16,
        fontWeight: "600",
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: "600",
    },
    userEmail: {
        fontSize: 14,
        marginTop: 2,
    },
    statsRow: {
        flexDirection: "row",
        marginTop: 6,
        gap: 16,
    },
    statItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    statText: {
        fontSize: 12,
    },
});
