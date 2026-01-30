import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

const COLORS = {
    primary: "#FFE500",
    text: "#1A1A1A",
    textSecondary: "#6B6B6B",
    white: "#FFFFFF",
    border: "#E8E6E1",
    premium: "#4CAF50",
};

export default function TripCounter() {
    const router = useRouter();
    const userPlan = useQuery(api.users.getPlan);

    if (!userPlan) return null;

    const isPremium = userPlan.plan === "premium" && userPlan.isSubscriptionActive;
    const credits = userPlan.tripCredits || 0;
    const freeTripsUsed = userPlan.tripsGenerated || 0;
    
    // Calculate remaining free trips (1 free trip for new users)
    const freeTripsRemaining = Math.max(0, 1 - freeTripsUsed);
    
    // Total available trips
    const availableTrips = isPremium ? "Unlimited" : (credits + freeTripsRemaining);

    return (
        <TouchableOpacity 
            style={styles.container}
            onPress={() => router.push("/subscription")}
            activeOpacity={0.8}
        >
            <View style={styles.iconContainer}>
                <Ionicons 
                    name={isPremium ? "infinite" : "ticket-outline"} 
                    size={16} 
                    color={isPremium ? COLORS.white : COLORS.text} 
                />
            </View>
            <View style={styles.textContainer}>
                <Text style={styles.label}>Available Trips</Text>
                <Text style={[
                    styles.count, 
                    isPremium ? styles.premiumText : null
                ]}>
                    {availableTrips}
                </Text>
            </View>
            {!isPremium && (
                <View style={styles.addButton}>
                    <Ionicons name="add" size={14} color={COLORS.white} />
                </View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: COLORS.white,
        padding: 8,
        paddingRight: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 8,
    },
    iconContainer: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: COLORS.primary,
        justifyContent: "center",
        alignItems: "center",
    },
    textContainer: {
        justifyContent: "center",
    },
    label: {
        fontSize: 10,
        color: COLORS.textSecondary,
        fontWeight: "600",
        textTransform: "uppercase",
    },
    count: {
        fontSize: 14,
        fontWeight: "800",
        color: COLORS.text,
    },
    premiumText: {
        color: COLORS.premium,
    },
    addButton: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: COLORS.text,
        justifyContent: "center",
        alignItems: "center",
        marginLeft: 4,
    },
});
