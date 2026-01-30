import { Text, View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from "react-native";
import { useQuery, useMutation } from "convex/react";
import { useConvexAuth } from "@/lib/auth-components";
import { api } from "@/convex/_generated/api";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Id } from "@/convex/_generated/dataModel";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";

export default function TripsScreen() {
    const router = useRouter();
    const { isAuthenticated } = useConvexAuth();
    const { colors } = useTheme();
    const trips = useQuery(api.trips.list, isAuthenticated ? {} : "skip");
    const deleteTrip = useMutation(api.trips.deleteTrip);

    const handleDelete = (tripId: Id<"trips">) => {
        Alert.alert(
            "Delete Trip",
            "Are you sure you want to delete this trip?",
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Delete", 
                    style: "destructive", 
                    onPress: () => deleteTrip({ tripId }) 
                }
            ]
        );
    };

    if (trips === undefined) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>My Trips</Text>
                <TouchableOpacity 
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                    onPress={() => router.push("/create-trip")}
                >
                    <Ionicons name="add" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            {trips.length === 0 ? (
                <View style={styles.emptyState}>
                    <View style={[styles.emptyIconContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Ionicons name="airplane-outline" size={48} color={colors.primary} />
                    </View>
                    <Text style={[styles.emptyText, { color: colors.text }]}>No trips yet</Text>
                    <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Tap the + button to plan your first adventure!</Text>
                    <TouchableOpacity 
                        style={[styles.createTripButton, { backgroundColor: colors.primary }]}
                        onPress={() => router.push("/create-trip")}
                    >
                        <Text style={[styles.createTripButtonText, { color: colors.text }]}>Create Your First Trip</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={trips}
                    keyExtractor={(item) => item._id}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <TouchableOpacity 
                            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} 
                            onPress={() => router.push(`/trip/${item._id}`)}
                            activeOpacity={0.9}
                        >
                            <View style={[styles.cardImagePlaceholder, { backgroundColor: colors.text }]}>
                                <Ionicons name="airplane" size={28} color={colors.card} />
                            </View>
                            <View style={styles.cardContent}>
                                <View style={styles.cardHeader}>
                                    <Text style={[styles.destination, { color: colors.text }]}>{item.destination}</Text>
                                    <StatusBadge status={item.status} />
                                </View>
                                <Text style={[styles.dates, { color: colors.textMuted }]}>
                                    {new Date(item.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {new Date(item.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </Text>
                                <View style={styles.cardFooter}>
                                    <View style={styles.detailItem}>
                                        <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                                        <Text style={[styles.details, { color: colors.textMuted }]}>{item.travelers}</Text>
                                    </View>
                                    <View style={styles.detailItem}>
                                        <Ionicons name="wallet-outline" size={16} color={colors.textMuted} />
                                        <Text style={[styles.details, { color: colors.textMuted }]}>{item.budget}</Text>
                                    </View>
                                    <TouchableOpacity 
                                        onPress={() => handleDelete(item._id)}
                                        style={styles.deleteBtn}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}
        </SafeAreaView>
    );
}

function StatusBadge({ status }: { status: string }) {
    const getStatusStyle = () => {
        switch (status) {
            case "generating":
                return { bg: "#FFF8E1", text: "#F59E0B" };
            case "completed":
                return { bg: "#E8F5E9", text: "#4CAF50" };
            case "failed":
                return { bg: "#FFEBEE", text: "#EF4444" };
            default:
                return { bg: "#E8E6E1", text: "#9B9B9B" };
        }
    };
    
    const style = getStatusStyle();
    
    return (
        <View style={[styles.badge, { backgroundColor: style.bg }]}>
            <Text style={[styles.badgeText, { color: style.text }]}>{status.toUpperCase()}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: "800",
    },
    addButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
    },
    listContent: {
        padding: 20,
        paddingBottom: 100,
    },
    card: {
        borderRadius: 16,
        marginBottom: 12,
        flexDirection: "row",
        overflow: "hidden",
        borderWidth: 1,
    },
    cardImagePlaceholder: {
        width: 80,
        justifyContent: "center",
        alignItems: "center",
    },
    cardContent: {
        flex: 1,
        padding: 16,
    },
    cardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 4,
    },
    destination: {
        fontSize: 18,
        fontWeight: "700",
        flex: 1,
        marginRight: 8,
    },
    dates: {
        fontSize: 14,
        marginBottom: 12,
    },
    cardFooter: {
        flexDirection: "row",
        alignItems: "center",
    },
    detailItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginRight: 16,
    },
    details: {
        fontSize: 13,
        fontWeight: "600",
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
    deleteBtn: {
        padding: 4,
        marginLeft: "auto",
    },
    emptyState: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
    },
    emptyIconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 24,
        borderWidth: 1,
    },
    emptyText: {
        fontSize: 22,
        fontWeight: "800",
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 16,
        textAlign: "center",
        marginBottom: 32,
        lineHeight: 24,
    },
    createTripButton: {
        paddingHorizontal: 28,
        paddingVertical: 16,
        borderRadius: 14,
    },
    createTripButtonText: {
        fontSize: 17,
        fontWeight: "700",
    },
});
