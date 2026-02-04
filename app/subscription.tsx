import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import { useIAP } from "@/lib/useIAP";

export default function SubscriptionScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const { token } = useToken();
    
    // Convex mutations for processing purchases
    // @ts-ignore - API types may not include these yet
    const processApplePurchase = useMutation(api.users.processApplePurchase);
    // @ts-ignore
    const restoreApplePurchases = useMutation(api.users.restoreApplePurchases);
    const userPlan = useQuery(api.users.getPlan as any, { token: token || "skip" });
    
    // IAP hook for real Apple StoreKit purchases
    const {
        isLoading: iapLoading,
        yearlySubscription,
        monthlySubscription,
        singleTrip,
        purchaseYearly,
        purchaseMonthly,
        purchaseSingleTrip,
        restorePurchases,
    } = useIAP();
    
    const [loading, setLoading] = useState<string | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<"yearly" | "monthly" | "single">("yearly");
    const [restoring, setRestoring] = useState(false);

    // Get dynamic prices from App Store (with fallbacks)
    const yearlyPrice = yearlySubscription?.price || "€29.99";
    const monthlyPrice = monthlySubscription?.price || "€4.99";
    const singleTripPrice = singleTrip?.price || "€4.99";

    const handlePurchase = async () => {
        if (!token) {
            Alert.alert("Error", "Please sign in to make a purchase");
            return;
        }

        setLoading(selectedPlan);

        try {
            let result;
            
            if (selectedPlan === "yearly") {
                result = await purchaseYearly();
            } else if (selectedPlan === "monthly") {
                result = await purchaseMonthly();
            } else {
                result = await purchaseSingleTrip();
            }

            if (result.success && result.transactionId) {
                // Process the purchase on our backend
                await processApplePurchase({
                    token,
                    productId: result.productId!,
                    transactionId: result.transactionId,
                    receipt: result.receipt,
                });

                if (Platform.OS !== "web") {
                    if (selectedPlan === "single") {
                        Alert.alert("Success! 🎉", "Trip credit added to your account!");
                    } else {
                        Alert.alert("Welcome to Pro! 🎉", "You now have unlimited trip planning!");
                    }
                }
                router.back();
            } else if (result.error === "cancelled") {
                // User cancelled - do nothing silently
                console.log("Purchase cancelled by user");
            } else if (result.error) {
                Alert.alert("Purchase Failed", result.error);
            }
        } catch (error: any) {
            console.error("Purchase error:", error);
            Alert.alert("Error", error.message || "Failed to complete purchase. Please try again.");
        } finally {
            setLoading(null);
        }
    };

    const handleRestorePurchases = async () => {
        if (!token) {
            Alert.alert("Error", "Please sign in to restore purchases");
            return;
        }

        setRestoring(true);

        try {
            const results = await restorePurchases();
            
            // Filter successful restores
            const successfulRestores = results.filter(r => r.success && r.transactionId);
            
            if (successfulRestores.length > 0) {
                // Send to backend
                await restoreApplePurchases({
                    token,
                    purchases: successfulRestores.map(r => ({
                        productId: r.productId!,
                        transactionId: r.transactionId!,
                        receipt: r.receipt,
                    })),
                });

                Alert.alert(
                    "Purchases Restored! ✓",
                    "Your previous purchases have been restored successfully."
                );
            } else {
                Alert.alert(
                    "No Purchases Found",
                    "We couldn't find any previous purchases to restore. If you believe this is an error, please contact support."
                );
            }
        } catch (error: any) {
            console.error("Restore error:", error);
            Alert.alert("Restore Failed", error.message || "Failed to restore purchases. Please try again.");
        } finally {
            setRestoring(false);
        }
    };

    const isSubscriptionActive = userPlan?.isSubscriptionActive;
    const isProcessing = loading !== null || restoring || iapLoading;

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
                    disabled={isProcessing}
                >
                    <View style={[styles.bestValueBadge, { backgroundColor: colors.primary }]}>
                        <Text style={[styles.bestValueText, { color: colors.text }]}>BEST VALUE</Text>
                    </View>
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Planera Pro – Yearly</Text>
                            <View style={[styles.saveBadge, { backgroundColor: colors.primary }]}>
                                <Text style={[styles.saveText, { color: colors.text }]}>SAVE 40%</Text>
                            </View>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{yearlyPrice}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/year</Text>
                        </View>
                        <Text style={[styles.planBilled, { color: colors.textMuted }]}>Billed annually • Cancel anytime</Text>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Unlimited AI Planning</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                        </View>
                    </View>
                    {selectedPlan === "yearly" && (
                        <View style={styles.selectedIndicator}>
                            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                        </View>
                    )}
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
                    disabled={isProcessing}
                >
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Planera Pro - Monthly</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{monthlyPrice}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/mo</Text>
                        </View>
                        <Text style={[styles.planBilled, { color: colors.textMuted }]}>Billed monthly • Cancel anytime</Text>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Unlimited AI Planning</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                        </View>
                    </View>
                    {selectedPlan === "monthly" && (
                        <View style={styles.selectedIndicator}>
                            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                        </View>
                    )}
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
                    disabled={isProcessing}
                >
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>Single Trip</Text>
                            <Text style={[styles.planSubtext, { color: colors.textMuted }]}>One-time purchase</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{singleTripPrice}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>/trip</Text>
                        </View>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>One AI-generated Trip Plan</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>Smart Recommendations</Text>
                            </View>
                        </View>
                    </View>
                    {selectedPlan === "single" && (
                        <View style={styles.selectedIndicator}>
                            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                        </View>
                    )}
                </TouchableOpacity>

                {/* Continue with Free */}
                <TouchableOpacity onPress={() => router.back()} disabled={isProcessing}>
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

                <TouchableOpacity onPress={handleRestorePurchases} disabled={isProcessing}>
                    {restoring ? (
                        <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                        <Text style={[styles.restoreText, { color: colors.text }]}>Restore Purchases</Text>
                    )}
                </TouchableOpacity>
            </ScrollView>

            {/* Bottom CTA */}
            <View style={[styles.bottomCTA, { backgroundColor: colors.background }]}>
                <TouchableOpacity 
                    style={[styles.ctaButton, { backgroundColor: colors.primary }, isProcessing && styles.ctaButtonLoading]}
                    onPress={handlePurchase}
                    disabled={isProcessing}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                        <Text style={[styles.ctaButtonText, { color: colors.text }]}>
                            {selectedPlan === "single" ? "Purchase Trip Credit" : "Start my next era"}
                        </Text>
                    )}
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
    selectedIndicator: {
        position: "absolute",
        top: 16,
        right: 16,
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
