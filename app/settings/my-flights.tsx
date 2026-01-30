/**
 * My Flights Screen
 * Displays all booked flights with full details including:
 * - Flight information
 * - Cancellation/Change policies
 * - Baggage (included & paid)
 * - Seat selections
 * - Passenger details
 */

import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";

// Format currency
const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
};

// Format date for display
const formatDate = (dateString: string): string => {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// Format timestamp
const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

interface FlightBooking {
  _id: string;
  tripId: string;
  tripDestination?: string;
  duffelOrderId: string;
  bookingReference?: string;
  totalAmount: number;
  currency: string;
  basePriceCents?: bigint;
  extrasTotalCents?: bigint;
  outboundFlight: {
    airline: string;
    airlineLogo?: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
    aircraft?: string;
  };
  returnFlight?: {
    airline: string;
    airlineLogo?: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    departureDate: string;
    departureAirport?: string;
    arrivalAirport?: string;
    origin: string;
    destination: string;
    duration?: string;
    cabinClass?: string;
    aircraft?: string;
  };
  passengers: Array<{
    givenName: string;
    familyName: string;
    email: string;
    type?: "adult" | "child" | "infant";
    dateOfBirth?: string;
  }>;
  policies?: {
    canChange: boolean;
    canRefund: boolean;
    changePolicy: string;
    refundPolicy: string;
    changePenaltyAmount?: string;
    changePenaltyCurrency?: string;
    refundPenaltyAmount?: string;
    refundPenaltyCurrency?: string;
  };
  includedBaggage?: Array<{
    passengerId: string;
    passengerName?: string;
    cabinBags?: bigint;
    checkedBags?: bigint;
    checkedBagWeight?: { amount: number; unit: string };
  }>;
  paidBaggage?: Array<{
    passengerId: string;
    passengerName?: string;
    type: string;
    quantity: bigint;
    priceCents: bigint;
    currency: string;
    weight?: { amount: number; unit: string };
  }>;
  seatSelections?: Array<{
    passengerId: string;
    passengerName?: string;
    segmentId: string;
    flightNumber?: string;
    seatDesignator: string;
    priceCents: bigint;
    currency: string;
  }>;
  status: string;
  createdAt: number;
  confirmedAt?: number;
  departureTimestamp?: number;
  isUpcoming: boolean;
  isPast: boolean;
}

export default function MyFlightsScreen() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const styles = createStyles(colors, isDarkMode);

  const bookings = useQuery(api.flightBookingMutations.getUserFlightBookings);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");

  const onRefresh = async () => {
    setRefreshing(true);
    // Query will automatically refresh
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleToggleExpand = (bookingId: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedBookingId(expandedBookingId === bookingId ? null : bookingId);
  };

  if (bookings === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Flights</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your flights...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const upcomingBookings = bookings?.filter((b) => b.isUpcoming) || [];
  const pastBookings = bookings?.filter((b) => b.isPast) || [];
  const displayedBookings = activeTab === "upcoming" ? upcomingBookings : pastBookings;

  const renderFlightSegment = (
    flight: FlightBooking["outboundFlight"],
    label: string
  ) => (
    <View style={styles.flightSegment}>
      <Text style={styles.segmentLabel}>{label}</Text>
      <View style={styles.flightRoute}>
        <View style={styles.flightEndpoint}>
          <Text style={styles.airportCode}>{flight.origin}</Text>
          <Text style={styles.flightTime}>{flight.departure}</Text>
          {flight.departureAirport && (
            <Text style={styles.airportName}>{flight.departureAirport}</Text>
          )}
        </View>
        <View style={styles.flightMiddle}>
          <View style={styles.flightLine}>
            <View style={styles.flightDot} />
            <View style={styles.flightDash} />
            <Ionicons name="airplane" size={16} color={colors.primary} />
            <View style={styles.flightDash} />
            <View style={styles.flightDot} />
          </View>
          {flight.duration && (
            <Text style={styles.durationText}>{flight.duration}</Text>
          )}
        </View>
        <View style={styles.flightEndpoint}>
          <Text style={styles.airportCode}>{flight.destination}</Text>
          <Text style={styles.flightTime}>{flight.arrival}</Text>
          {flight.arrivalAirport && (
            <Text style={styles.airportName}>{flight.arrivalAirport}</Text>
          )}
        </View>
      </View>
      <View style={styles.flightDetails}>
        <View style={styles.flightDetail}>
          <Ionicons name="business-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.flightDetailText}>{flight.airline}</Text>
        </View>
        <View style={styles.flightDetail}>
          <Text style={styles.flightDetailText}>{flight.flightNumber}</Text>
        </View>
        {flight.cabinClass && (
          <View style={styles.flightDetail}>
            <Ionicons name="ribbon-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.flightDetailText}>{flight.cabinClass}</Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderBookingCard = (booking: FlightBooking) => {
    const isExpanded = expandedBookingId === booking._id;

    return (
      <View key={booking._id} style={styles.bookingCard}>
        {/* Header - Always Visible */}
        <TouchableOpacity
          style={styles.bookingHeader}
          onPress={() => handleToggleExpand(booking._id)}
          activeOpacity={0.7}
        >
          <View style={styles.bookingHeaderLeft}>
            <View style={styles.destinationRow}>
              <Ionicons name="airplane" size={18} color={colors.primary} />
              <Text style={styles.destinationText}>
                {booking.tripDestination || booking.outboundFlight.destination}
              </Text>
            </View>
            <Text style={styles.dateText}>
              {formatDate(booking.outboundFlight.departureDate)}
              {booking.returnFlight && ` - ${formatDate(booking.returnFlight.departureDate)}`}
            </Text>
          </View>
          <View style={styles.bookingHeaderRight}>
            <View style={[
              styles.statusBadge,
              booking.status === "confirmed" && styles.statusConfirmed,
              booking.status === "cancelled" && styles.statusCancelled,
            ]}>
              <Text style={[
                styles.statusText,
                booking.status === "confirmed" && styles.statusTextConfirmed,
                booking.status === "cancelled" && styles.statusTextCancelled,
              ]}>
                {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
              </Text>
            </View>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textSecondary}
            />
          </View>
        </TouchableOpacity>

        {/* Booking Reference */}
        {booking.bookingReference && (
          <View style={styles.referenceRow}>
            <Text style={styles.referenceLabel}>Booking Reference:</Text>
            <Text style={styles.referenceValue}>{booking.bookingReference}</Text>
          </View>
        )}

        {/* Expanded Details */}
        {isExpanded && (
          <View style={styles.expandedContent}>
            {/* Flight Segments */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Flight Details</Text>
              {renderFlightSegment(booking.outboundFlight, "Outbound")}
              {booking.returnFlight && renderFlightSegment(booking.returnFlight, "Return")}
            </View>

            {/* Passengers */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Passengers</Text>
              {booking.passengers.map((passenger, index) => (
                <View key={index} style={styles.passengerRow}>
                  <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                  <View style={styles.passengerInfo}>
                    <Text style={styles.passengerName}>
                      {passenger.givenName} {passenger.familyName}
                    </Text>
                    {passenger.type && (
                      <Text style={styles.passengerType}>
                        {passenger.type.charAt(0).toUpperCase() + passenger.type.slice(1)}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Policies */}
            {booking.policies && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Cancellation & Change Policy</Text>
                <View style={styles.policyCard}>
                  {/* Change Policy */}
                  <View style={styles.policyRow}>
                    <View style={styles.policyIcon}>
                      <Ionicons
                        name={booking.policies.canChange ? "checkmark-circle" : "close-circle"}
                        size={20}
                        color={booking.policies.canChange ? "#059669" : "#DC2626"}
                      />
                    </View>
                    <View style={styles.policyContent}>
                      <Text style={styles.policyLabel}>Changes</Text>
                      <Text style={styles.policyText}>{booking.policies.changePolicy}</Text>
                    </View>
                  </View>

                  {/* Refund Policy */}
                  <View style={[styles.policyRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={styles.policyIcon}>
                      <Ionicons
                        name={booking.policies.canRefund ? "checkmark-circle" : "close-circle"}
                        size={20}
                        color={booking.policies.canRefund ? "#059669" : "#DC2626"}
                      />
                    </View>
                    <View style={styles.policyContent}>
                      <Text style={styles.policyLabel}>Refunds</Text>
                      <Text style={styles.policyText}>{booking.policies.refundPolicy}</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* Baggage */}
            {(booking.includedBaggage || booking.paidBaggage) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Baggage</Text>
                
                {/* Included Baggage */}
                {booking.includedBaggage && booking.includedBaggage.length > 0 && (
                  <View style={styles.baggageSection}>
                    <Text style={styles.baggageSubtitle}>Included with Ticket</Text>
                    {booking.includedBaggage.map((bag, index) => (
                      <View key={index} style={styles.baggageRow}>
                        <Ionicons name="bag-outline" size={16} color={colors.textSecondary} />
                        <View style={styles.baggageInfo}>
                          {bag.passengerName && (
                            <Text style={styles.baggagePassenger}>{bag.passengerName}</Text>
                          )}
                          <View style={styles.baggageDetails}>
                            {bag.cabinBags !== undefined && Number(bag.cabinBags) > 0 && (
                              <View style={styles.baggageChip}>
                                <Ionicons name="briefcase-outline" size={12} color="#059669" />
                                <Text style={styles.baggageChipText}>
                                  {Number(bag.cabinBags)} cabin bag{Number(bag.cabinBags) > 1 ? "s" : ""}
                                </Text>
                              </View>
                            )}
                            {bag.checkedBags !== undefined && Number(bag.checkedBags) > 0 && (
                              <View style={styles.baggageChip}>
                                <Ionicons name="cube-outline" size={12} color="#059669" />
                                <Text style={styles.baggageChipText}>
                                  {Number(bag.checkedBags)} checked bag{Number(bag.checkedBags) > 1 ? "s" : ""}
                                  {bag.checkedBagWeight && ` (${bag.checkedBagWeight.amount}${bag.checkedBagWeight.unit})`}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Paid Baggage */}
                {booking.paidBaggage && booking.paidBaggage.length > 0 && (
                  <View style={styles.baggageSection}>
                    <Text style={styles.baggageSubtitle}>Purchased Extra Bags</Text>
                    {booking.paidBaggage.map((bag, index) => (
                      <View key={index} style={styles.baggageRow}>
                        <Ionicons name="bag-add-outline" size={16} color={colors.primary} />
                        <View style={styles.baggageInfo}>
                          {bag.passengerName && (
                            <Text style={styles.baggagePassenger}>{bag.passengerName}</Text>
                          )}
                          <View style={styles.baggageDetails}>
                            <View style={[styles.baggageChip, styles.paidBaggageChip]}>
                              <Text style={styles.paidBaggageChipText}>
                                {Number(bag.quantity)}x {bag.type === "checked" ? "Checked" : "Cabin"} bag
                                {bag.weight && ` (${bag.weight.amount}${bag.weight.unit})`}
                              </Text>
                            </View>
                            <Text style={styles.baggagePrice}>
                              {formatCurrency(Number(bag.priceCents) / 100, bag.currency)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Seat Selections */}
            {booking.seatSelections && booking.seatSelections.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Seat Selections</Text>
                {booking.seatSelections.map((seat, index) => (
                  <View key={index} style={styles.seatRow}>
                    <View style={styles.seatIcon}>
                      <Ionicons name="grid-outline" size={16} color={colors.primary} />
                    </View>
                    <View style={styles.seatInfo}>
                      {seat.passengerName && (
                        <Text style={styles.seatPassenger}>{seat.passengerName}</Text>
                      )}
                      <Text style={styles.seatDesignator}>Seat {seat.seatDesignator}</Text>
                    </View>
                    <Text style={styles.seatPrice}>
                      {formatCurrency(Number(seat.priceCents) / 100, seat.currency)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Price Breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Price Breakdown</Text>
              <View style={styles.priceBreakdown}>
                {booking.basePriceCents !== undefined && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Flight fare</Text>
                    <Text style={styles.priceValue}>
                      {formatCurrency(Number(booking.basePriceCents) / 100, booking.currency)}
                    </Text>
                  </View>
                )}
                {booking.extrasTotalCents !== undefined && Number(booking.extrasTotalCents) > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Extras (bags, seats)</Text>
                    <Text style={styles.priceValue}>
                      {formatCurrency(Number(booking.extrasTotalCents) / 100, booking.currency)}
                    </Text>
                  </View>
                )}
                <View style={[styles.priceRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Total Paid</Text>
                  <Text style={styles.totalValue}>
                    {formatCurrency(booking.totalAmount, booking.currency)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Booking Info */}
            <View style={styles.bookingInfo}>
              <Text style={styles.bookingInfoText}>
                Booked on {formatTimestamp(booking.createdAt)}
              </Text>
              <Text style={styles.bookingInfoText}>
                Order ID: {booking.duffelOrderId}
              </Text>
            </View>
          </View>
        )}

        {/* Quick Price (when collapsed) */}
        {!isExpanded && (
          <View style={styles.quickPrice}>
            <Text style={styles.quickPriceLabel}>Total</Text>
            <Text style={styles.quickPriceValue}>
              {formatCurrency(booking.totalAmount, booking.currency)}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Flights</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "upcoming" && styles.tabActive]}
          onPress={() => setActiveTab("upcoming")}
        >
          <Ionicons
            name="airplane-outline"
            size={18}
            color={activeTab === "upcoming" ? colors.primary : colors.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === "upcoming" && styles.tabTextActive]}>
            Upcoming ({upcomingBookings.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "past" && styles.tabActive]}
          onPress={() => setActiveTab("past")}
        >
          <Ionicons
            name="time-outline"
            size={18}
            color={activeTab === "past" ? colors.primary : colors.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === "past" && styles.tabTextActive]}>
            Past ({pastBookings.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {displayedBookings.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons
                name={activeTab === "upcoming" ? "airplane-outline" : "time-outline"}
                size={48}
                color={colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              No {activeTab} flights
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === "upcoming"
                ? "Book a flight to see it here"
                : "Your completed flights will appear here"}
            </Text>
            {activeTab === "upcoming" && (
              <TouchableOpacity
                style={styles.browseButton}
                onPress={() => router.push("/(tabs)")}
              >
                <Text style={styles.browseButtonText}>Plan a Trip</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.text} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          displayedBookings.map(renderBookingCard)
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    tabContainer: {
      flexDirection: "row",
      paddingHorizontal: 20,
      gap: 12,
      marginBottom: 16,
    },
    tab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: {
      backgroundColor: colors.primary + "20",
      borderColor: colors.primary,
    },
    tabText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: colors.primary,
    },
    content: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
    },
    bookingCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    bookingHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 16,
    },
    bookingHeaderLeft: {
      flex: 1,
    },
    destinationRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    destinationText: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    dateText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    bookingHeaderRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: colors.border,
    },
    statusConfirmed: {
      backgroundColor: "#ECFDF5",
    },
    statusCancelled: {
      backgroundColor: "#FEF2F2",
    },
    statusText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    statusTextConfirmed: {
      color: "#059669",
    },
    statusTextCancelled: {
      color: "#DC2626",
    },
    referenceRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 8,
    },
    referenceLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    referenceValue: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.primary,
      letterSpacing: 1,
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    section: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 12,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    flightSegment: {
      marginBottom: 16,
    },
    segmentLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
      marginBottom: 8,
    },
    flightRoute: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    flightEndpoint: {
      alignItems: "center",
      width: 80,
    },
    airportCode: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
    },
    flightTime: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    airportName: {
      fontSize: 11,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: 2,
    },
    flightMiddle: {
      flex: 1,
      alignItems: "center",
    },
    flightLine: {
      flexDirection: "row",
      alignItems: "center",
      width: "100%",
      paddingHorizontal: 8,
    },
    flightDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.textSecondary,
    },
    flightDash: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    durationText: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 4,
    },
    flightDetails: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap",
    },
    flightDetail: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    flightDetailText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    passengerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 8,
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
      fontSize: 12,
      color: colors.textSecondary,
    },
    policyCard: {
      backgroundColor: colors.background,
      borderRadius: 12,
      overflow: "hidden",
    },
    policyRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      padding: 12,
      gap: 12,
    },
    policyIcon: {
      paddingTop: 2,
    },
    policyContent: {
      flex: 1,
    },
    policyLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 2,
    },
    policyText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    baggageSection: {
      marginBottom: 16,
    },
    baggageSubtitle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
      marginBottom: 8,
    },
    baggageRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 8,
    },
    baggageInfo: {
      flex: 1,
    },
    baggagePassenger: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.text,
      marginBottom: 4,
    },
    baggageDetails: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },
    baggageChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: "#ECFDF5",
      borderRadius: 12,
    },
    baggageChipText: {
      fontSize: 12,
      color: "#059669",
      fontWeight: "500",
    },
    paidBaggageChip: {
      backgroundColor: colors.primary + "20",
    },
    paidBaggageChipText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "500",
    },
    baggagePrice: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },
    seatRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 8,
    },
    seatIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.primary + "20",
      justifyContent: "center",
      alignItems: "center",
    },
    seatInfo: {
      flex: 1,
    },
    seatPassenger: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.text,
    },
    seatDesignator: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    seatPrice: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    priceBreakdown: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 12,
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
    totalRow: {
      marginTop: 8,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginBottom: 0,
    },
    totalLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    totalValue: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.primary,
    },
    bookingInfo: {
      padding: 16,
      gap: 4,
    },
    bookingInfoText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    quickPrice: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    quickPriceLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    quickPriceValue: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.primary,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 60,
    },
    emptyIconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.cardBackground,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
      marginBottom: 24,
    },
    browseButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: colors.primary,
      borderRadius: 12,
    },
    browseButtonText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
    },
  });
