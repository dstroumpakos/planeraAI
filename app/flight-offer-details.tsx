/**
 * Flight Offer Details Screen
 * Shows fare details, included baggage, and policy before proceeding to extras
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useToken } from "@/lib/useAuthenticatedMutation";

const colors = {
  background: "#FFFDF7",
  surface: "#FFFFFF",
  primary: "#F5C543",
  primaryDark: "#D4A73A",
  text: "#1A1A1A",
  textSecondary: "#6B7280",
  border: "#E8E6E1",
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
};

interface TravelerParam {
  id: Id<"travelers">;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "male" | "female";
  email?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  passportNumber?: string;
  passportIssuingCountry?: string;
  passportExpiryDate?: string;
}

export default function FlightOfferDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();

  const tripId = params.tripId as Id<"trips">;
  const offerId = params.offerId as string;
  const travelersParam = params.travelers as string;
  const flightInfoParam = params.flightInfo as string;

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerDetails, setOfferDetails] = useState<any>(null);
  const [draftId, setDraftId] = useState<Id<"flightBookingDrafts"> | null>(null);

  const createDraft = useAction(api.bookingDraft.createDraft);
  const { token } = useToken();

  // Parse travelers from params
  let travelers: TravelerParam[] = [];
  try {
    travelers = travelersParam ? JSON.parse(travelersParam) : [];
  } catch (e) {
    console.error('[FlightOfferDetails] Failed to parse travelers:', e);
  }

  // Parse flight info
  let flightInfo: any = null;
  try {
    flightInfo = flightInfoParam ? JSON.parse(flightInfoParam) : null;
  } catch (e) {
    console.error('[FlightOfferDetails] Failed to parse flightInfo:', e);
  }

  useEffect(() => {
    initializeDraft();
  }, []);

  const initializeDraft = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await createDraft({
        token: token!,
        tripId,
        offerId,
        travelers: travelers.map(t => ({
          id: t.id,
          firstName: t.firstName,
          lastName: t.lastName,
          dateOfBirth: t.dateOfBirth,
          gender: t.gender,
          email: t.email,
          phoneCountryCode: t.phoneCountryCode,
          phoneNumber: t.phoneNumber,
          passportNumber: t.passportNumber,
          passportIssuingCountry: t.passportIssuingCountry,
          passportExpiryDate: t.passportExpiryDate,
        })),
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setDraftId(result.draftId);
      setOfferDetails(result.offerDetails);
    } catch (err) {
      console.error("Error initializing draft:", err);
      setError(t('flightOfferDetails.failedToLoadOffer'));
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToExtras = () => {
    if (!draftId) return;

    router.push({
      pathname: "/flight-extras",
      params: {
        draftId,
        tripId,
        offerId,
        flightInfo: flightInfoParam,
      },
    });
  };

  const renderBaggageItem = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    description: string,
    included: boolean
  ) => (
    <View style={styles.baggageItem}>
      <View style={[styles.baggageIconContainer, included && styles.baggageIconIncluded]}>
        <Ionicons
          name={icon}
          size={20}
          color={included ? colors.success : colors.textSecondary}
        />
      </View>
      <View style={styles.baggageInfo}>
        <Text style={styles.baggageTitle}>{title}</Text>
        <Text style={styles.baggageDescription}>{description}</Text>
      </View>
      {included && (
        <View style={styles.includedBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.includedText}>{t('flightOfferDetails.included')}</Text>
        </View>
      )}
    </View>
  );

  const renderPolicyItem = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    description: string,
    allowed: boolean
  ) => (
    <View style={styles.policyItem}>
      <View style={[styles.policyIconContainer, allowed ? styles.policyAllowed : styles.policyNotAllowed]}>
        <Ionicons
          name={icon}
          size={20}
          color={allowed ? colors.success : colors.error}
        />
      </View>
      <View style={styles.policyInfo}>
        <Text style={styles.policyTitle}>{title}</Text>
        <Text style={[styles.policyDescription, !allowed && styles.policyNotAllowedText]}>
          {description}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('flightOfferDetails.loadingOfferDetails')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={colors.error} />
          <Text style={styles.errorTitle}>{t('flightOfferDetails.unableToLoadOffer')}</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>{t('flightOfferDetails.goBack')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Get included baggage summary
  const includedBaggage = offerDetails?.includedBaggage || [];
  const hasCabinBag = includedBaggage.some((b: any) => b.cabinQuantity > 0);
  const hasCheckedBag = includedBaggage.some((b: any) => b.checkedQuantity > 0);
  const checkedBagWeight = includedBaggage.find((b: any) => b.checkedWeight)?.checkedWeight;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('flightOfferDetails.fareDetails')}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Flight Summary */}
        {flightInfo && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('flightOfferDetails.flightSummary')}</Text>
            <View style={styles.flightSummary}>
              <View style={styles.flightLeg}>
                <Ionicons name="airplane" size={18} color={colors.primary} />
                <View style={styles.flightLegInfo}>
                  <Text style={styles.flightRoute}>
                    {flightInfo.outbound?.origin} → {flightInfo.outbound?.destination}
                  </Text>
                  <Text style={styles.flightDetails}>
                    {flightInfo.outbound?.airline} • {flightInfo.outbound?.departure}
                  </Text>
                </View>
              </View>
              {flightInfo.return && (
                <View style={styles.flightLeg}>
                  <Ionicons name="airplane" size={18} color={colors.primary} style={{ transform: [{ rotate: "180deg" }] }} />
                  <View style={styles.flightLegInfo}>
                    <Text style={styles.flightRoute}>
                      {flightInfo.return?.origin} → {flightInfo.return?.destination}
                    </Text>
                    <Text style={styles.flightDetails}>
                      {flightInfo.return?.airline} • {flightInfo.return?.departure}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Passengers */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t('flightOfferDetails.passengers')} ({travelers.length})
          </Text>
          {travelers.map((traveler, index) => (
            <View key={index} style={styles.passengerItem}>
              <Ionicons name="person" size={18} color={colors.textSecondary} />
              <Text style={styles.passengerName}>
                {traveler.firstName} {traveler.lastName}
              </Text>
            </View>
          ))}
        </View>

        {/* Included in Fare */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('flightOfferDetails.includedInFare')}</Text>
          {renderBaggageItem(
            "bag-handle-outline",
            t('flightOfferDetails.carryOnBag'),
            hasCabinBag ? t('flightOfferDetails.personalItemCabin') : t('flightOfferDetails.personalItemOnly'),
            hasCabinBag
          )}
          {renderBaggageItem(
            "briefcase-outline",
            t('flightOfferDetails.checkedBaggage'),
            hasCheckedBag
              ? (checkedBagWeight ? t('flightOfferDetails.checkedBagWithWeight', { weight: checkedBagWeight }) : t('flightOfferDetails.checkedBagIncluded'))
              : t('flightOfferDetails.notIncluded'),
            hasCheckedBag
          )}
        </View>

        {/* Cancellation & Change Policy */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('flightOfferDetails.bookingPolicy')}</Text>
          {renderPolicyItem(
            "swap-horizontal",
            t('flightOfferDetails.flightChanges'),
            offerDetails?.conditions?.changePolicy || t('flightOfferDetails.changesNotAllowed'),
            offerDetails?.conditions?.canChange
          )}
          {renderPolicyItem(
            "cash-outline",
            t('flightOfferDetails.cancellationRefund'),
            offerDetails?.conditions?.refundPolicy || t('flightOfferDetails.nonRefundable'),
            offerDetails?.conditions?.canRefund
          )}
        </View>

        {/* Available Extras Preview */}
        {(offerDetails?.availableBags?.length > 0 || offerDetails?.seatSelectionAvailable) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('flightOfferDetails.availableExtras')}</Text>
            <Text style={styles.extrasDescription}>
              {t('flightOfferDetails.customizeNextScreen')}
            </Text>
            <View style={styles.extrasPreview}>
              {offerDetails?.availableBags?.length > 0 && (
                <View style={styles.extrasItem}>
                  <Ionicons name="briefcase" size={18} color={colors.primary} />
                  <Text style={styles.extrasItemText}>{t('flightOfferDetails.additionalBaggage')}</Text>
                </View>
              )}
              {offerDetails?.seatSelectionAvailable && (
                <View style={styles.extrasItem}>
                  <Ionicons name="grid-outline" size={18} color={colors.primary} />
                  <Text style={styles.extrasItemText}>{t('flightOfferDetails.seatSelection')}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Price Summary */}
        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>{t('flightOfferDetails.baseFare', { count: travelers.length })}</Text>
            <Text style={styles.priceValue}>
              {offerDetails?.currency} {offerDetails?.totalPrice?.toFixed(2)}
            </Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>{t('flightOfferDetails.total')}</Text>
            <Text style={styles.totalValue}>
              {offerDetails?.currency} {offerDetails?.totalPrice?.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.continueButton, creating && styles.continueButtonDisabled]}
          onPress={handleContinueToExtras}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Text style={styles.continueButtonText}>{t('flightOfferDetails.continueToExtras')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 16,
  },
  flightSummary: {
    gap: 12,
  },
  flightLeg: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  flightLegInfo: {
    flex: 1,
  },
  flightRoute: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
  },
  flightDetails: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  passengerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  passengerName: {
    fontSize: 15,
    color: colors.text,
  },
  baggageItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  baggageIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  baggageIconIncluded: {
    backgroundColor: "#ECFDF5",
  },
  baggageInfo: {
    flex: 1,
  },
  baggageTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
  },
  baggageDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  includedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#ECFDF5",
    borderRadius: 12,
  },
  includedText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.success,
  },
  policyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  policyIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  policyAllowed: {
    backgroundColor: "#ECFDF5",
  },
  policyNotAllowed: {
    backgroundColor: "#FEF2F2",
  },
  policyInfo: {
    flex: 1,
  },
  policyTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
  },
  policyDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  policyNotAllowedText: {
    color: colors.error,
  },
  extrasDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  extrasPreview: {
    gap: 8,
  },
  extrasItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  extrasItemText: {
    fontSize: 14,
    color: colors.text,
  },
  priceCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  priceValue: {
    fontSize: 14,
    color: colors.text,
  },
  priceDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueButtonDisabled: {
    opacity: 0.6,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
});
