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

  // Parse travelers from params
  const travelers: TravelerParam[] = travelersParam
    ? JSON.parse(travelersParam)
    : [];

  // Parse flight info
  const flightInfo = flightInfoParam ? JSON.parse(flightInfoParam) : null;

  useEffect(() => {
    initializeDraft();
  }, []);

  const initializeDraft = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await createDraft({
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
      setError("Failed to load offer details. Please try again.");
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
          <Text style={styles.includedText}>Included</Text>
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
          <Text style={styles.loadingText}>Loading offer details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={colors.error} />
          <Text style={styles.errorTitle}>Unable to Load Offer</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Go Back</Text>
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
        <Text style={styles.headerTitle}>Fare Details</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Flight Summary */}
        {flightInfo && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Flight Summary</Text>
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
            Passengers ({travelers.length})
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
          <Text style={styles.cardTitle}>Included in Your Fare</Text>
          {renderBaggageItem(
            "bag-handle-outline",
            "Carry-on Bag",
            hasCabinBag ? "1 personal item + 1 cabin bag" : "Personal item only",
            hasCabinBag
          )}
          {renderBaggageItem(
            "briefcase-outline",
            "Checked Baggage",
            hasCheckedBag
              ? `1 checked bag${checkedBagWeight ? ` (up to ${checkedBagWeight})` : ""}`
              : "Not included",
            hasCheckedBag
          )}
        </View>

        {/* Cancellation & Change Policy */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Booking Policy</Text>
          {renderPolicyItem(
            "swap-horizontal",
            "Flight Changes",
            offerDetails?.conditions?.changePolicy || "Changes not allowed",
            offerDetails?.conditions?.canChange
          )}
          {renderPolicyItem(
            "cash-outline",
            "Cancellation & Refund",
            offerDetails?.conditions?.refundPolicy || "Non-refundable",
            offerDetails?.conditions?.canRefund
          )}
        </View>

        {/* Available Extras Preview */}
        {(offerDetails?.availableBags?.length > 0 || offerDetails?.seatSelectionAvailable) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Available Extras</Text>
            <Text style={styles.extrasDescription}>
              You can customize your booking on the next screen:
            </Text>
            <View style={styles.extrasPreview}>
              {offerDetails?.availableBags?.length > 0 && (
                <View style={styles.extrasItem}>
                  <Ionicons name="briefcase" size={18} color={colors.primary} />
                  <Text style={styles.extrasItemText}>Additional baggage</Text>
                </View>
              )}
              {offerDetails?.seatSelectionAvailable && (
                <View style={styles.extrasItem}>
                  <Ionicons name="grid-outline" size={18} color={colors.primary} />
                  <Text style={styles.extrasItemText}>Seat selection</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Price Summary */}
        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Base fare ({travelers.length} passenger{travelers.length > 1 ? "s" : ""})</Text>
            <Text style={styles.priceValue}>
              {offerDetails?.currency} {offerDetails?.totalPrice?.toFixed(2)}
            </Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>Total</Text>
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
              <Text style={styles.continueButtonText}>Continue to Extras</Text>
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
