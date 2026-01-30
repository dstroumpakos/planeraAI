/**
 * Flight Review Screen
 * Summary of selections before proceeding to payment/booking
 */

import { useState } from "react";
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
import * as Haptics from "expo-haptics";

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

export default function FlightReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const draftId = params.draftId as Id<"flightBookingDrafts">;
  const tripId = params.tripId as Id<"trips">;
  const flightInfoParam = params.flightInfo as string;

  const [booking, setBooking] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingResult, setBookingResult] = useState<{
    orderId: string;
    bookingReference: string;
    totalAmount: number;
    currency: string;
  } | null>(null);

  const draft = useQuery(api.bookingDraftMutations.getBookingDraft, { draftId });
  const completeBooking = useAction(api.bookingDraft.completeBooking);

  const flightInfo = flightInfoParam ? JSON.parse(flightInfoParam) : null;

  const handleCompleteBooking = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    setBooking(true);

    try {
      const result = await completeBooking({
        draftId,
        // In production, you'd pass paymentIntentId here after collecting payment
      });

      if (result.success) {
        setBookingResult({
          orderId: result.orderId,
          bookingReference: result.bookingReference,
          totalAmount: result.totalAmount,
          currency: result.currency,
        });
        setBookingComplete(true);

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        if (Platform.OS !== "web") {
          Alert.alert("Booking Failed", result.error);
        }
      }
    } catch (error) {
      console.error("Booking error:", error);
      if (Platform.OS !== "web") {
        Alert.alert(
          "Booking Failed",
          "An unexpected error occurred. Please try again."
        );
      }
    } finally {
      setBooking(false);
    }
  };

  const handleViewTrip = () => {
    router.replace({
      pathname: "/trip/[id]",
      params: { id: tripId },
    });
  };

  if (!draft) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading booking details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Booking confirmation screen
  if (bookingComplete && bookingResult) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.content} contentContainerStyle={styles.confirmationContent}>
          <View style={styles.successIconContainer}>
            <Ionicons name="checkmark-circle" size={80} color={colors.success} />
          </View>

          <Text style={styles.successTitle}>Booking Confirmed!</Text>
          <Text style={styles.successSubtitle}>
            Your flight has been successfully booked
          </Text>

          <View style={styles.confirmationCard}>
            <View style={styles.confirmationRow}>
              <Text style={styles.confirmationLabel}>Booking Reference</Text>
              <Text style={styles.confirmationValue}>{bookingResult.bookingReference}</Text>
            </View>
            <View style={styles.confirmationDivider} />
            <View style={styles.confirmationRow}>
              <Text style={styles.confirmationLabel}>Total Paid</Text>
              <Text style={styles.confirmationValue}>
                {bookingResult.currency} {bookingResult.totalAmount.toFixed(2)}
              </Text>
            </View>
          </View>

          <View style={styles.confirmationInfo}>
            <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.confirmationInfoText}>
              A confirmation email has been sent to all passengers with booking details
              and e-tickets.
            </Text>
          </View>

          <View style={styles.confirmationInfo}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.confirmationInfoText}>
              You can manage your booking directly with the airline using the booking
              reference above.
            </Text>
          </View>

          <TouchableOpacity style={styles.viewTripButton} onPress={handleViewTrip}>
            <Text style={styles.viewTripButtonText}>View Trip Details</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFF" />
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Booking</Text>
        <View style={styles.headerRight}>
          {draft.expiresIn !== undefined && (
            <Text style={styles.expiryText}>{draft.expiresIn}m</Text>
          )}
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Flight Summary */}
        {flightInfo && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="airplane" size={20} color={colors.primary} />
              <Text style={styles.cardTitle}>Flight Details</Text>
            </View>

            <View style={styles.flightLeg}>
              <View style={styles.flightLegHeader}>
                <Text style={styles.flightLegLabel}>Outbound</Text>
                <Text style={styles.flightDate}>{flightInfo.outbound?.departureDate}</Text>
              </View>
              <View style={styles.flightLegRoute}>
                <Text style={styles.flightAirport}>{flightInfo.outbound?.origin}</Text>
                <View style={styles.flightArrow}>
                  <View style={styles.flightLine} />
                  <Ionicons name="airplane" size={16} color={colors.primary} />
                  <View style={styles.flightLine} />
                </View>
                <Text style={styles.flightAirport}>{flightInfo.outbound?.destination}</Text>
              </View>
              <Text style={styles.flightTime}>
                {flightInfo.outbound?.departure} • {flightInfo.outbound?.airline}
              </Text>
            </View>

            {flightInfo.return && (
              <>
                <View style={styles.legDivider} />
                <View style={styles.flightLeg}>
                  <View style={styles.flightLegHeader}>
                    <Text style={styles.flightLegLabel}>Return</Text>
                    <Text style={styles.flightDate}>{flightInfo.return?.departureDate}</Text>
                  </View>
                  <View style={styles.flightLegRoute}>
                    <Text style={styles.flightAirport}>{flightInfo.return?.origin}</Text>
                    <View style={styles.flightArrow}>
                      <View style={styles.flightLine} />
                      <Ionicons name="airplane" size={16} color={colors.primary} />
                      <View style={styles.flightLine} />
                    </View>
                    <Text style={styles.flightAirport}>{flightInfo.return?.destination}</Text>
                  </View>
                  <Text style={styles.flightTime}>
                    {flightInfo.return?.departure} • {flightInfo.return?.airline}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Passengers */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="people" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Passengers ({draft.passengers.length})</Text>
          </View>

          {draft.passengers.map((passenger, index) => (
            <View key={index} style={styles.passengerItem}>
              <View style={styles.passengerIcon}>
                <Ionicons name="person" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.passengerInfo}>
                <Text style={styles.passengerName}>{passenger.name}</Text>
                <Text style={styles.passengerType}>
                  {passenger.type.charAt(0).toUpperCase() + passenger.type.slice(1)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Selected Extras */}
        {(draft.selectedBags.length > 0 || draft.selectedSeats.length > 0) && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="add-circle" size={20} color={colors.primary} />
              <Text style={styles.cardTitle}>Selected Extras</Text>
            </View>

            {draft.selectedBags.length > 0 && (
              <View style={styles.extrasSection}>
                <Text style={styles.extrasSectionTitle}>Additional Baggage</Text>
                {draft.selectedBags.map((bag, index) => (
                  <View key={index} style={styles.extrasItem}>
                    <View style={styles.extrasItemLeft}>
                      <Ionicons name="briefcase-outline" size={18} color={colors.textSecondary} />
                      <Text style={styles.extrasItemText}>
                        {bag.type === "checked" ? "Checked bag" : "Cabin bag"} × {bag.quantity}
                      </Text>
                    </View>
                    <Text style={styles.extrasItemPrice}>{bag.priceDisplay}</Text>
                  </View>
                ))}
              </View>
            )}

            {draft.selectedSeats.length > 0 && (
              <View style={styles.extrasSection}>
                <Text style={styles.extrasSectionTitle}>Seat Selection</Text>
                {draft.selectedSeats.map((seat, index) => {
                  const passenger = draft.passengers.find(p => p.passengerId === seat.passengerId);
                  return (
                    <View key={index} style={styles.extrasItem}>
                      <View style={styles.extrasItemLeft}>
                        <Ionicons name="grid-outline" size={18} color={colors.textSecondary} />
                        <Text style={styles.extrasItemText}>
                          Seat {seat.seatDesignator} • {passenger?.name || "Passenger"}
                        </Text>
                      </View>
                      <Text style={styles.extrasItemPrice}>{seat.priceDisplay}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Policy Summary */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="document-text" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Booking Policy</Text>
          </View>

          <View style={styles.policyRow}>
            <View style={[styles.policyBadge, draft.canChange ? styles.policyBadgeAllowed : styles.policyBadgeNotAllowed]}>
              <Ionicons
                name={draft.canChange ? "checkmark" : "close"}
                size={14}
                color={draft.canChange ? colors.success : colors.error}
              />
            </View>
            <Text style={styles.policyText}>{draft.changePolicy}</Text>
          </View>

          <View style={styles.policyRow}>
            <View style={[styles.policyBadge, draft.canRefund ? styles.policyBadgeAllowed : styles.policyBadgeNotAllowed]}>
              <Ionicons
                name={draft.canRefund ? "checkmark" : "close"}
                size={14}
                color={draft.canRefund ? colors.success : colors.error}
              />
            </View>
            <Text style={styles.policyText}>{draft.refundPolicy}</Text>
          </View>

          <View style={styles.acknowledgmentBadge}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.acknowledgmentText}>Policy acknowledged</Text>
          </View>
        </View>

        {/* Price Breakdown */}
        <View style={styles.priceCard}>
          <Text style={styles.priceCardTitle}>Price Breakdown</Text>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Base fare ({draft.passengers.length} passenger{draft.passengers.length > 1 ? "s" : ""})</Text>
            <Text style={styles.priceValue}>{draft.basePriceDisplay}</Text>
          </View>

          {draft.extrasTotalDisplay !== `${draft.currency} 0.00` && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Extras</Text>
              <Text style={styles.priceValue}>{draft.extrasTotalDisplay}</Text>
            </View>
          )}

          <View style={styles.priceDivider} />

          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{draft.totalPriceDisplay}</Text>
          </View>
        </View>

        {/* Terms notice */}
        <View style={styles.termsNotice}>
          <Text style={styles.termsText}>
            By completing this booking, you agree to the airline's terms and conditions
            and Planera's terms of service.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.totalInfo}>
          <Text style={styles.bottomTotalLabel}>Total</Text>
          <Text style={styles.bottomTotalValue}>{draft.totalPriceDisplay}</Text>
        </View>

        <TouchableOpacity
          style={[styles.bookButton, booking && styles.bookButtonDisabled]}
          onPress={handleCompleteBooking}
          disabled={booking}
        >
          {booking ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Text style={styles.bookButtonText}>Complete Booking</Text>
              <Ionicons name="lock-closed" size={18} color="#FFF" />
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
    width: 60,
    alignItems: "flex-end",
  },
  expiryText: {
    fontSize: 14,
    color: colors.warning,
    fontWeight: "500",
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
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  flightLeg: {
    paddingVertical: 8,
  },
  flightLegHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  flightLegLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
  },
  flightDate: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  flightLegRoute: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  flightAirport: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  flightArrow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
  },
  flightLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  flightTime: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  legDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  passengerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  passengerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  passengerInfo: {
    flex: 1,
  },
  passengerName: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
  },
  passengerType: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  extrasSection: {
    marginBottom: 16,
  },
  extrasSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  extrasItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  extrasItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  extrasItemText: {
    fontSize: 14,
    color: colors.text,
  },
  extrasItemPrice: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
  },
  policyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  policyBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  policyBadgeAllowed: {
    backgroundColor: "#ECFDF5",
  },
  policyBadgeNotAllowed: {
    backgroundColor: "#FEF2F2",
  },
  policyText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  acknowledgmentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  acknowledgmentText: {
    fontSize: 13,
    color: colors.success,
    fontWeight: "500",
  },
  priceCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  priceCardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 16,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
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
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  termsNotice: {
    padding: 12,
  },
  termsText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalInfo: {
    flex: 1,
  },
  bottomTotalLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  bottomTotalValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  bookButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  bookButtonDisabled: {
    opacity: 0.6,
  },
  bookButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  // Confirmation styles
  confirmationContent: {
    flexGrow: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  successIconContainer: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: 32,
  },
  confirmationCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    borderWidth: 2,
    borderColor: colors.success,
    marginBottom: 24,
  },
  confirmationRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  confirmationLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  confirmationValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  confirmationDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  confirmationInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    padding: 16,
    backgroundColor: colors.background,
    borderRadius: 12,
    marginBottom: 12,
  },
  confirmationInfoText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  viewTripButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: 24,
  },
  viewTripButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
});
