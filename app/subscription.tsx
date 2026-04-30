import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useState, useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import { useIAP } from "@/lib/useIAP";
import { useTranslation } from "react-i18next";

export default function SubscriptionScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const { token } = useToken();
    const { t } = useTranslation();
    
    // SECURITY: All entitlement grants now go through the verified Apple
    // receipt action. The legacy mutations were removed because they trusted
    // client-supplied productId/transactionId without server-side proof.
    // @ts-ignore - API types may not include this yet on first deploy
    const verifyApplePurchase = useAction(api.iapVerify.verifyAndApplyApplePurchase);
    const userPlan = useQuery(api.users.getPlan as any, token ? { token } : "skip");
    
    // IAP hook for real Apple StoreKit purchases
    const {
        isLoading: iapLoading,
        error: iapError,
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

    // Log product data for debugging price mismatches
    useEffect(() => {
        console.log('[Subscription] 🔍 Product debug info:', {
            yearlyLoaded: !!yearlySubscription,
            yearlyProductId: yearlySubscription?.productId,
            yearlyPrice: yearlySubscription?.price,
            monthlyLoaded: !!monthlySubscription,
            monthlyProductId: monthlySubscription?.productId,
            monthlyPrice: monthlySubscription?.price,
            singleLoaded: !!singleTrip,
            singleProductId: singleTrip?.productId,
            singlePrice: singleTrip?.price,
        });
    }, [yearlySubscription, monthlySubscription, singleTrip]);

    // Use ONLY StoreKit displayPrice - no fallbacks, no formatting
    // This ensures what we display matches what Apple will charge
    const yearlyPrice = yearlySubscription?.price || null;
    const monthlyPrice = monthlySubscription?.price || null;
    const singleTripPrice = singleTrip?.price || null;
    
    // Check if products are loaded (real StoreKit products, not mocks)
    const productsLoaded = yearlyPrice && monthlyPrice;

    const handlePurchase = async () => {
        if (!token) {
            Alert.alert(t('common.error'), t('subscription.signInToPurchase'));
            return;
        }

        // Prevent purchase if products haven't loaded from StoreKit
        if (!productsLoaded) {
            Alert.alert(
                t('subscription.productsNotAvailable'),
                t('subscription.unableToLoadProducts'),
                [{ text: t('common.ok') }]
            );
            return;
        }

        // Log the product being purchased vs what's displayed
        const productToPurchase = selectedPlan === "yearly" ? yearlySubscription 
                                : selectedPlan === "monthly" ? monthlySubscription 
                                : singleTrip;
        
        console.log('[Subscription] 🛒 PURCHASE INITIATED:', {
            selectedPlan,
            displayedProductId: productToPurchase?.productId,
            displayedPrice: productToPurchase?.price,
            yearlyProductId: yearlySubscription?.productId,
            yearlyPrice: yearlySubscription?.price,
            monthlyProductId: monthlySubscription?.productId,
            monthlyPrice: monthlySubscription?.price,
        });

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
                if (!result.receipt) {
                    throw new Error("Missing App Store receipt — purchase cannot be verified.");
                }
                // Verify the receipt with Apple, then apply entitlement server-side
                const verifyRes: any = await verifyApplePurchase({
                    token,
                    productId: result.productId!,
                    transactionId: result.transactionId,
                    receipt: result.receipt,
                });
                if (!verifyRes?.success) {
                    throw new Error(verifyRes?.error || "Could not verify purchase with Apple.");
                }

                if (Platform.OS !== "web") {
                    if (selectedPlan === "single") {
                        Alert.alert(t('common.success') + " 🎉", t('subscription.tripCreditAdded'));
                    } else {
                        Alert.alert(t('subscription.welcomeToPro') + " 🎉", t('subscription.unlimitedTripPlanning'));
                    }
                }
                router.back();
            } else if (result.error === "cancelled") {
                // User cancelled - do nothing silently
                console.log("Purchase cancelled by user");
            } else if (result.error === "already_owned") {
                // User already owns this subscription - auto-restore
                console.log("Item already owned, auto-restoring...");
                try {
                    const restoreResults = await restorePurchases();
                    const successfulRestores = restoreResults.filter(r => r.success && r.transactionId);
                    
                    if (successfulRestores.length > 0) {
                        for (const r of successfulRestores) {
                            if (!r.receipt) continue;
                            try {
                                await verifyApplePurchase({
                                    token,
                                    productId: r.productId!,
                                    transactionId: r.transactionId!,
                                    receipt: r.receipt,
                                });
                            } catch (e) {
                                console.warn("[Subscription] Restore verify failed for", r.productId, e);
                            }
                        }
                        Alert.alert(
                            t('subscription.subscriptionRestored') + " ✓",
                            t('subscription.alreadyActiveRestored')
                        );
                        router.back();
                    } else {
                        Alert.alert(
                            t('subscription.alreadySubscribed'),
                            t('subscription.alreadyActiveRestore')
                        );
                    }
                } catch (restoreErr: any) {
                    console.error("Auto-restore after already_owned failed:", restoreErr);
                    Alert.alert(
                        t('subscription.alreadySubscribed'),
                        t('subscription.alreadyActiveSyncRestore')
                    );
                }
            } else if (result.error) {
                Alert.alert(t('subscription.purchaseFailed'), result.error);
            }
        } catch (error: any) {
            console.error("Purchase error:", error);
            Alert.alert(t('common.error'), error.message || t('subscription.failedCompletePurchase'));
        } finally {
            setLoading(null);
        }
    };

    const handleRestorePurchases = async () => {
        if (!token) {
            Alert.alert(t('common.error'), t('subscription.signInToRestore'));
            return;
        }

        setRestoring(true);

        try {
            const results = await restorePurchases();
            
            // Filter successful restores
            const successfulRestores = results.filter(r => r.success && r.transactionId);
            
            if (successfulRestores.length > 0) {
                // Verify each restored receipt with Apple before granting anything
                for (const r of successfulRestores) {
                    if (!r.receipt) continue;
                    try {
                        await verifyApplePurchase({
                            token,
                            productId: r.productId!,
                            transactionId: r.transactionId!,
                            receipt: r.receipt,
                        });
                    } catch (e) {
                        console.warn("[Subscription] Restore verify failed for", r.productId, e);
                    }
                }

                Alert.alert(
                    t('subscription.purchasesRestored') + " ✓",
                    t('subscription.previousPurchasesRestored')
                );
            } else {
                Alert.alert(
                    t('subscription.noPurchasesFound'),
                    t('subscription.noPurchasesContact')
                );
            }
        } catch (error: any) {
            console.error("Restore error:", error);
            Alert.alert(t('subscription.purchaseFailed'), error.message || t('subscription.failedCompletePurchase'));
        } finally {
            setRestoring(false);
        }
    };

    const isSubscriptionActive = userPlan?.isSubscriptionActive;
    const isProcessing = loading !== null || restoring || iapLoading;
    const purchaseDisabled = isProcessing || (Platform.OS === 'ios' && !productsLoaded);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <Text style={[styles.brandText, { color: colors.text }]}>PLANERA</Text>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: colors.text }]}>{t('subscription.unlockNextEra')}</Text>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                    {t('subscription.aiPoweredItineraries')}
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
                        <Text style={[styles.bestValueText, { color: colors.text }]}>{t('subscription.bestValue')}</Text>
                    </View>
                    <View style={styles.planHeader}>
                        <View>
                            <Text style={[styles.planName, { color: colors.text }]}>{t('subscription.proYearly')}</Text>
                            <View style={[styles.saveBadge, { backgroundColor: colors.primary }]}>
                                <Text style={[styles.saveText, { color: colors.text }]}>{t('subscription.save50')}</Text>
                            </View>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{yearlyPrice || t('common.loading')}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>{t('subscription.perYear')}</Text>
                        </View>
                        <Text style={[styles.planBilled, { color: colors.textMuted }]}>{t('subscription.billedAnnually')} <Text style={{ color: '#DC2626' }}>{t('subscription.cancelAnytime')}</Text></Text>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('subscription.unlimitedAIPlanning')}</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('preAuth.smartRecommendations')}</Text>
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
                            <Text style={[styles.planName, { color: colors.text }]}>{t('subscription.proMonthly')}</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{monthlyPrice || t('common.loading')}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>{t('subscription.perMonth')}</Text>
                        </View>
                        <Text style={[styles.planBilled, { color: colors.textMuted }]}>{t('subscription.billedMonthly')} <Text style={{ color: '#DC2626' }}>{t('subscription.cancelAnytime')}</Text></Text>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('subscription.unlimitedAIPlanning')}</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('preAuth.smartRecommendations')}</Text>
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
                            <Text style={[styles.planName, { color: colors.text }]}>{t('subscription.singleTrip')}</Text>
                            <Text style={[styles.planSubtext, { color: colors.textMuted }]}>{t('subscription.oneTimePurchase')}</Text>
                        </View>
                        <View style={styles.planPriceContainer}>
                            <Text style={[styles.planPrice, { color: colors.text }]}>{singleTripPrice || t('common.loading')}</Text>
                            <Text style={[styles.planPeriod, { color: colors.textMuted }]}>{t('subscription.perTrip')}</Text>
                        </View>
                        <View style={styles.featuresList}>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('subscription.oneAITrip')}</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                                <Text style={[styles.featureText, { color: colors.text }]}>{t('preAuth.smartRecommendations')}</Text>
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
                    <Text style={[styles.freePlanLink, { color: colors.textSecondary }]}>{t('subscription.continueWithFree')}</Text>
                </TouchableOpacity>

                {/* Terms */}
                <Text style={[styles.termsText, { color: colors.textMuted }]}>
                    {t('subscription.subscriptionRenews')}
                </Text>

                <View style={styles.linksRow}>
                    <TouchableOpacity onPress={() => Linking.openURL("https://www.planeraai.app/privacy")}>
                        <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t('auth.privacyPolicy')}</Text>
                    </TouchableOpacity>
                    <Text style={[styles.linkDot, { color: colors.textMuted }]}>•</Text>
                    <TouchableOpacity onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}>
                        <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t('auth.termsOfUse')}</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={handleRestorePurchases} disabled={isProcessing}>
                    {restoring ? (
                        <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                        <Text style={[styles.restoreText, { color: colors.text }]}>{t('subscription.restorePurchases')}</Text>
                    )}
                </TouchableOpacity>

                {iapError && Platform.OS === 'ios' ? (
                    <Text style={[styles.termsText, { color: '#DC2626', marginTop: 12 }]}>
                        {iapError}
                    </Text>
                ) : null}
            </ScrollView>

            {/* Bottom CTA */}
            <View style={[styles.bottomCTA, { backgroundColor: colors.background }]}>
                <TouchableOpacity 
                    style={[styles.ctaButton, { backgroundColor: colors.primary }, purchaseDisabled && styles.ctaButtonLoading]}
                    onPress={handlePurchase}
                    disabled={purchaseDisabled}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                        <Text style={[styles.ctaButtonText, { color: colors.text }]}>
                            {!productsLoaded && Platform.OS === 'ios' 
                                ? t('subscription.loadingProducts') 
                                : selectedPlan === "single" ? t('subscription.purchaseTripCredit') : t('subscription.startMyNextEra')}
                        </Text>
                    )}
                </TouchableOpacity>
                <View style={styles.securedRow}>
                    <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    <Text style={[styles.securedText, { color: colors.textMuted }]}>{t('subscription.securedWithAppStore')}</Text>
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
