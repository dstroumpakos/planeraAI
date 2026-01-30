import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";

export default function SubscriptionScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const upgradeToPremium = useMutation(api.users.upgradeToPremium);
    const purchaseTripPack = useMutation(api.users.purchaseTripPack);
    const cancelSubscription = useMutation(api.users.cancelSubscription);
    const userPlan = useQuery(api.users.getPlan);
    const [loading, setLoading] = useState<string | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<"yearly" | "monthly" | "single">("yearly");

    const handleUpgrade = async (planType: "monthly" | "yearly") => {
        setLoading(planType);
        try {
            await upgradeToPremium({ planType });
            if (Platform.OS !== "web") {
                Alert.alert("Success", "You are now a Premium member!");
            }
            router.back();
        } catch (error) {
            console.error("Upgrade failed:", error);
            if (Platform.OS !== "web") {
                Alert.alert("Error", "Failed to upgrade plan");
            }
        } finally {
            setLoading(null);
        }
    };

    const handlePurchasePack = async () => {
        setLoading("single");
        try {
            await purchaseTripPack({ pack: "single" });
            if (Platform.OS !== "web") {
                Alert.alert("Success", "Trip credit added!");
            }
            router.back();
        } catch (error) {
            console.error("Purchase failed:", error);
            if (Platform.OS !== "web") {
                Alert.alert("Error", "Failed to purchase");
            }
        } finally {
            setLoading(null);
        }
    };

    const isSubscriptionActive = userPlan?.isSubscriptionActive;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <Text style={[styles.brandText, { color: colors.text }]}>PLANERA</Text>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: colors.text }]}>Unlock your next{"\n"}era of travel.</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                    AI-powered itineraries, unlimited inspiration, and smart recommendations.
                </Text>

                {/* Yearly Plan - Best Value */}
                <TouchableOpacity 
                    style={[
                        styles.planCard, 
                        { backgroundColor: colors.card, borderColor: colors.border },
                        selectedPlan === "yearly" && { borderColor: colors.primary }
                    ]}
                    onPress={() => setSelectedPlan("yearly")}
                >
                    <View style={[styles.bestValueBadge, { backgroundColor: colors.primary }]}>
                        <Text style={[styles.bestValueText, { color: colors.text }]}>BEST VALUE</Text>
                    </View>
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Yearly</Text>
                            <View style={[styles.saveBadge, { backgroundColor: colors.primary }]}>
                                <Text style={[styles.saveText, { color: colors.text }]}>SAVE 40%</Text>
                            </View>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>€4.99</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/mo</Text>
                        </View>
                        <Text style={[styles.planBilled, { color: colors.textMuted }]}>Billed €59.99 yearly</Text>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Unlimited AI Planning</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Full Multi-City Routing</Text>
                            </View>
                        </View>
                    </View>
                </TouchableOpacity>

                {/* Monthly Plan */}
                <TouchableOpacity 
                    style={[
                        styles.planCard, 
                        styles.planCardSimple,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        selectedPlan === "monthly" && { borderColor: colors.primary }
                    ]}
                    onPress={() => setSelectedPlan("monthly")}
                >
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Monthly</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>€9.99</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/mo</Text>
                        </View>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Unlimited AI Planning</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Full Multi-City Routing</Text>
                            </View>
                        </View>
                    </View>
                </TouchableOpacity>

                {/* Single Trip */}
                <TouchableOpacity 
                    style={[
                        styles.planCard, 
                        styles.planCardSimple,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        selectedPlan === "single" && { borderColor: colors.primary }
                    ]}
                    onPress={() => setSelectedPlan("single")}
                >
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Single Trip</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>€2.99</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/trip</Text>
                        </View>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>One-time AI Trip Plan</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Full Multi-City Routing</Text>
                            </View>
                        </View>
                    </View>
                </TouchableOpacity>

                {/* Continue with Free */}
                <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[styles.freePlanLink, { color: colors.textSecondary }]}>Continue with Free Plan</Text>
                </TouchableOpacity>

                {/* Terms */}
                <Text style={[styles.termsText, { color: colors.textMuted }]}>
                    Subscription automatically renews unless auto-renew is turned off at least 24-hours before the end of the current period. Your account will be charged for renewal within 24-hours prior to the end of the current period. You can manage and cancel your subscriptions by going to your App Store account settings after purchase.
                </Text>

                <View style={styles.linksRow}>
                    <TouchableOpacity onPress={() => router.push("/privacy")}>
                        <Text style={[styles.linkText, { color: colors.textSecondary }]}>Privacy Policy</Text>
                    </TouchableOpacity>
                    <Text style={[styles.linkDot, { color: colors.textMuted }]}>•</Text>
                    <TouchableOpacity onPress={() => router.push("/terms")}>
                        <Text style={[styles.linkText, { color: colors.textSecondary }]}>Terms of Service</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity>
                    <Text style={[styles.restoreText, { color: colors.text }]}>Restore Purchases</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Bottom CTA */}
            <View style={[styles.bottomCTA, { backgroundColor: colors.background }]}>
                <TouchableOpacity 
                    style={[styles.ctaButton, { backgroundColor: colors.primary }, loading && styles.ctaButtonLoading]}
                    onPress={() => {
                        if (selectedPlan === "single") {
                            handlePurchasePack();
                        } else {
                            handleUpgrade(selectedPlan);
                        }
                    }}
                    disabled={loading !== null}
                >
                    <Text style={[styles.ctaButtonText, { color: colors.text }]}>
                        {loading ? "Processing..." : "Start my next era"}
                    </Text>
                </TouchableOpacity>
                <View style={styles.securedRow}>
                    <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    <Text style={[styles.securedText, { color: colors.textMuted }]}>Secured with App Store</Text>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 16,
        position: "relative",
    },
    brandText: {
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 2,
    },
    closeButton: {
        position: "absolute",
        right: 20,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    title: {
        fontSize: 32,
        fontWeight: "800",
        textAlign: "center",
        marginBottom: 12,
        lineHeight: 40,
    },
    subtitle: {
        fontSize: 16,
        textAlign: "center",
        marginBottom: 32,
        lineHeight: 24,
    },
    planCard: {
        borderRadius: 16,
        padding: 20,
        marginBottom: 12,
        borderWidth: 2,
        position: "relative",
        overflow: "hidden",
    },
    planCardSimple: {
        paddingVertical: 16,
    },
    saveBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    saveText: {
        fontSize: 10,
        fontWeight: "800",
    },
    bestValueBadge: {
        position: "absolute",
        top: -1,
        left: "50%",
        transform: [{ translateX: -50 }],
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
    },
    bestValueText: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1,
    },
    planHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 16,
        flexWrap: "wrap",
    },
    planName: {
        fontSize: 18,
        fontWeight: "700",
        width: "100%",
        marginBottom: 8,
    },
    planBilled: {
        fontSize: 13,
        marginTop: 2,
        width: "100%",
    },
    planSubtext: {
        fontSize: 13,
        marginTop: 2,
    },
    cancelAnytime: {
        fontSize: 13,
        marginTop: 2,
    },
    planPriceContainer: {
        flexDirection: "row",
        alignItems: "baseline",
        position: "absolute",
        right: 0,
        top: 0,
    },
    planPrice: {
        fontSize: 24,
        fontWeight: "800",
    },
    planPeriod: {
        fontSize: 14,
        marginLeft: 2,
    },
    radioButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 2,
        justifyContent: "center",
        alignItems: "center",
    },
    radioButtonSelected: {
    },
    featuresList: {
        marginTop: 16,
        width: "100%",
        gap: 8,
    },
    planFeatures: {
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
        gap: 12,
    },
    featureItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    featureText: {
        fontSize: 15,
        fontWeight: "500",
    },
    freePlanLink: {
        fontSize: 16,
        textAlign: "center",
        marginTop: 8,
        marginBottom: 24,
        fontWeight: "600",
    },
    termsText: {
        fontSize: 11,
        textAlign: "center",
        lineHeight: 16,
        marginBottom: 16,
    },
    linksRow: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
    },
    linkText: {
        fontSize: 13,
        fontWeight: "500",
    },
    linkDot: {
    },
    restoreText: {
        fontSize: 14,
        textAlign: "center",
        fontWeight: "600",
    },
    bottomCTA: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        paddingBottom: 32,
    },
    ctaButton: {
        paddingVertical: 18,
        borderRadius: 14,
        alignItems: "center",
    },
    ctaButtonLoading: {
        opacity: 0.7,
    },
    ctaButtonText: {
        fontSize: 18,
        fontWeight: "700",
    },
    securedRow: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
    },
    securedText: {
        fontSize: 12,
    },
});
