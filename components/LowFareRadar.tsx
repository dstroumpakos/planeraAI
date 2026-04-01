import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Linking,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 64;

interface FlightSegment {
  airline: string;
  flightNumber?: string;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  duration?: string;
}

interface FlightDeal {
  _id: string;
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  airline: string;
  airlineLogo?: string;
  flightNumber?: string;
  outboundDate: string;
  outboundDeparture: string;
  outboundArrival: string;
  outboundDuration?: string;
  outboundStops?: number;
  outboundSegments?: FlightSegment[];
  returnDate?: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnAirline?: string;
  returnFlightNumber?: string;
  returnStops?: number;
  returnSegments?: FlightSegment[];
  price: number;
  totalPrice?: number;
  originalPrice?: number;
  currency: string;
  cabinBaggage?: string;
  checkedBaggage?: string;
  isRecommended?: boolean;
  dealTag?: string;
  bookingUrl?: string;
  notes?: string;
  matchesPreference?: boolean;
  matchesWishlist?: boolean;
  isExpired?: boolean;
}

interface WishlistDestination {
  destination: string;
  country: string | null;
}

interface LowFareRadarProps {
  deals: FlightDeal[];
  homeIata?: string | null;
  wishlistDestinations?: WishlistDestination[];
  onPlanTrip?: (deal: FlightDeal) => void;
  onPlanFromWishlist?: (destination: string) => void;
  onBookingClick?: (dealId: string) => void;
}

type Filter = "all" | "recommended" | "wishlist";

export function LowFareRadar({ deals, homeIata, wishlistDestinations, onPlanTrip, onPlanFromWishlist, onBookingClick }: LowFareRadarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [wishlistFilter, setWishlistFilter] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const animValues = useRef<Record<string, Animated.Value>>({});

  if (!deals || deals.length === 0) return null;

  const filteredDeals =
    filter === "recommended"
      ? deals.filter((d) => d.isRecommended || d.matchesPreference)
      : filter === "wishlist"
        ? deals.filter((d) => d.matchesWishlist && (!wishlistFilter || d.destinationCity.toLowerCase() === wishlistFilter.toLowerCase()))
        : deals;

  const getAnimValue = (id: string) => {
    if (!animValues.current[id]) {
      animValues.current[id] = new Animated.Value(0);
    }
    return animValues.current[id];
  };

  const toggleExpand = (id: string) => {
    const isExpanding = !expandedIds.has(id);
    Animated.timing(getAnimValue(id), {
      toValue: isExpanding ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (isExpanding) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      weekday: "short",
    });
  };

  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      EUR: "€",
      USD: "$",
      GBP: "£",
      SEK: "kr",
      NOK: "kr",
      DKK: "kr",
    };
    return symbols[currency] || currency;
  };

  const getDiscount = (deal: FlightDeal) => {
    if (!deal.originalPrice || deal.originalPrice <= deal.price) return null;
    return Math.round(
      ((deal.originalPrice - deal.price) / deal.originalPrice) * 100
    );
  };

  const handleBooking = (deal: FlightDeal) => {
    if (deal.bookingUrl) {
      if (onBookingClick) onBookingClick(deal._id);
      Linking.openURL(deal.bookingUrl);
    }
  };

  const recommendedCount = deals.filter(
    (d) => d.isRecommended || d.matchesPreference
  ).length;

  const wishlistCount = deals.filter((d) => d.matchesWishlist).length;

  // Build a summary of wishlisted destinations that have deals from homeIata
  const wishlistWithDeals = wishlistDestinations?.filter((w) =>
    deals.some(
      (d) => d.destinationCity.toLowerCase() === w.destination.toLowerCase()
    )
  ) || [];

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.titleRow}>
          <View
            style={[styles.radarIcon, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="pulse" size={18} color="#000" />
          </View>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              {t("lowFare.title", { defaultValue: "Low Fare Radar" })}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {homeIata
                ? t("lowFare.subtitleFrom", { defaultValue: `Deals from ${homeIata}`, airport: homeIata })
                : t("lowFare.subtitle", { defaultValue: "Best flight deals for you" })}
            </Text>
          </View>
        </View>
      </View>

      {/* Wishlist Destinations with Deals */}
      {wishlistWithDeals.length > 0 && (
        <View style={[styles.wishlistSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.wishlistSummaryHeader}>
            <Ionicons name="heart" size={14} color="#FF3B82" />
            <Text style={[styles.wishlistSummaryTitle, { color: colors.text }]}>
              {t("lowFare.wishlistDeals", { defaultValue: "Deals to your wishlist" })}
            </Text>
          </View>
          <View style={styles.wishlistChips}>
            {wishlistWithDeals.map((w) => (
              <TouchableOpacity
                key={w.destination}
                style={[styles.wishlistChip, {
                  backgroundColor: wishlistFilter?.toLowerCase() === w.destination.toLowerCase() ? "#FF3B82" : "#FF3B82" + "15",
                  borderColor: wishlistFilter?.toLowerCase() === w.destination.toLowerCase() ? "#FF3B82" : "#FF3B82" + "30",
                }]}
                onPress={() => {
                  const isActive = wishlistFilter?.toLowerCase() === w.destination.toLowerCase();
                  setWishlistFilter(isActive ? null : w.destination);
                  setFilter("wishlist");
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.wishlistChipText, {
                  color: wishlistFilter?.toLowerCase() === w.destination.toLowerCase() ? "#FFF" : "#FF3B82",
                }]}>
                  {homeIata ? `${homeIata} → ` : ""}{w.destination}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        <TouchableOpacity
          style={[
            styles.filterBtn,
            {
              backgroundColor:
                filter === "all" ? colors.primary : colors.card,
              borderColor:
                filter === "all" ? colors.primary : colors.border,
            },
          ]}
          onPress={() => { setFilter("all"); setWishlistFilter(null); }}
        >
          <Text
            style={[
              styles.filterText,
              { color: filter === "all" ? "#000" : colors.text },
            ]}
          >
            {t("lowFare.allDeals", { defaultValue: "All Deals" })} (
            {deals.length})
          </Text>
        </TouchableOpacity>
        {recommendedCount > 0 && (
          <TouchableOpacity
            style={[
              styles.filterBtn,
              {
                backgroundColor:
                  filter === "recommended" ? colors.primary : colors.card,
                borderColor:
                  filter === "recommended" ? colors.primary : colors.border,
              },
            ]}
            onPress={() => { setFilter("recommended"); setWishlistFilter(null); }}
          >
            <Ionicons
              name="star"
              size={14}
              color={filter === "recommended" ? "#000" : colors.primary}
            />
            <Text
              style={[
                styles.filterText,
                {
                  color: filter === "recommended" ? "#000" : colors.text,
                },
              ]}
            >
              {t("lowFare.recommended", { defaultValue: "For You" })} (
              {recommendedCount})
            </Text>
          </TouchableOpacity>
        )}
        {wishlistCount > 0 && (
          <TouchableOpacity
            style={[
              styles.filterBtn,
              {
                backgroundColor:
                  filter === "wishlist" ? "#FF3B82" : colors.card,
                borderColor:
                  filter === "wishlist" ? "#FF3B82" : colors.border,
              },
            ]}
            onPress={() => { setFilter("wishlist"); setWishlistFilter(null); }}
          >
            <Ionicons
              name="heart"
              size={14}
              color={filter === "wishlist" ? "#FFF" : "#FF3B82"}
            />
            <Text
              style={[
                styles.filterText,
                {
                  color: filter === "wishlist" ? "#FFF" : colors.text,
                },
              ]}
            >
              {t("lowFare.wishlist", { defaultValue: "Wishlist" })} (
              {wishlistCount})
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Deal Cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardsContainer}
        snapToInterval={CARD_WIDTH + 12}
        decelerationRate="fast"
      >
        {filteredDeals.map((deal) => {
          const discount = getDiscount(deal);
          const animValue = getAnimValue(deal._id);
          const isExpanded = expandedIds.has(deal._id);

          const expandedHeight = animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 340 + ((deal.outboundStops ?? 0) + (deal.returnStops ?? 0)) * 60],
          });

          return (
            <TouchableOpacity
              key={deal._id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: deal.isExpired
                    ? "#FF3B30"
                    : deal.matchesWishlist
                      ? "#FF3B82"
                      : deal.matchesPreference
                        ? colors.primary
                        : colors.border,
                  borderWidth: deal.isExpired || deal.matchesPreference || deal.matchesWishlist ? 2 : 1,
                  opacity: deal.isExpired ? 0.7 : 1,
                  width: CARD_WIDTH,
                },
              ]}
              activeOpacity={0.9}
              onPress={() => toggleExpand(deal._id)}
            >
              {/* Tags */}
              <View style={styles.tagRow}>
                {deal.isExpired && (
                  <View
                    style={[
                      styles.dealTagBadge,
                      { backgroundColor: "#FF3B30" },
                    ]}
                  >
                    <Ionicons name="time-outline" size={12} color="#FFF" />
                    <Text style={styles.dealTagText}>
                      {t("lowFare.expired", { defaultValue: "Expired" })}
                    </Text>
                  </View>
                )}
                {deal.dealTag && !deal.isExpired && (
                  <View
                    style={[
                      styles.dealTagBadge,
                      { backgroundColor: "#FF3B30" },
                    ]}
                  >
                    <Ionicons name="flame" size={12} color="#FFF" />
                    <Text style={styles.dealTagText}>{deal.dealTag}</Text>
                  </View>
                )}
                {deal.matchesWishlist && (
                  <View
                    style={[
                      styles.dealTagBadge,
                      { backgroundColor: "#FF3B82" },
                    ]}
                  >
                    <Ionicons name="heart" size={12} color="#FFF" />
                    <Text style={styles.dealTagText}>
                      {t("lowFare.wishlisted", { defaultValue: "Wishlisted" })}
                    </Text>
                  </View>
                )}
                {deal.isRecommended && (
                  <View
                    style={[
                      styles.dealTagBadge,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Ionicons name="star" size={12} color="#000" />
                    <Text style={[styles.dealTagText, { color: "#000" }]}>
                      {t("lowFare.recommended", { defaultValue: "For You" })}
                    </Text>
                  </View>
                )}
                {deal.matchesPreference && !deal.isRecommended && (
                  <View
                    style={[
                      styles.dealTagBadge,
                      { backgroundColor: "#34C759" },
                    ]}
                  >
                    <Ionicons name="heart" size={12} color="#FFF" />
                    <Text style={styles.dealTagText}>
                      {t("lowFare.savedDest", {
                        defaultValue: "Saved Destination",
                      })}
                    </Text>
                  </View>
                )}
              </View>

              {/* Route */}
              <View style={styles.routeRow}>
                <View style={styles.routePoint}>
                  <Text style={[styles.iataCode, { color: colors.text }]}>
                    {deal.origin}
                  </Text>
                  <Text
                    style={[styles.cityName, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {deal.originCity}
                  </Text>
                </View>
                <View style={styles.routeLine}>
                  <View
                    style={[
                      styles.routeDash,
                      { backgroundColor: colors.border },
                    ]}
                  />
                  <View style={{ alignItems: "center" }}>
                    <Ionicons
                      name="airplane"
                      size={18}
                      color={colors.primary}
                    />
                    {(deal.outboundStops ?? 0) > 0 && (
                      <Text style={[styles.stopsBadge, { color: colors.primary }]}>
                        {deal.outboundStops} stop{(deal.outboundStops ?? 0) > 1 ? "s" : ""}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.routeDash,
                      { backgroundColor: colors.border },
                    ]}
                  />
                </View>
                <View style={[styles.routePoint, { alignItems: "flex-end" }]}>
                  <Text style={[styles.iataCode, { color: colors.text }]}>
                    {deal.destination}
                  </Text>
                  <Text
                    style={[styles.cityName, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {deal.destinationCity}
                  </Text>
                </View>
              </View>

              {/* Flight Times */}
              <View style={styles.timesRow}>
                <View style={styles.timeBlock}>
                  <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                    {t("lowFare.depart", { defaultValue: "Depart" })}
                  </Text>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {deal.outboundDeparture}
                  </Text>
                  <Text
                    style={[styles.dateValue, { color: colors.textMuted }]}
                  >
                    {formatDate(deal.outboundDate)}
                  </Text>
                </View>
                {deal.outboundDuration && (
                  <View style={styles.durationBlock}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.durationText,
                        { color: colors.textMuted },
                      ]}
                    >
                      {deal.outboundDuration}
                    </Text>
                  </View>
                )}
                <View style={[styles.timeBlock, { alignItems: "flex-end" }]}>
                  <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                    {t("lowFare.arrive", { defaultValue: "Arrive" })}
                  </Text>
                  <Text style={[styles.timeValue, { color: colors.text }]}>
                    {deal.outboundArrival}
                  </Text>
                  <Text
                    style={[styles.dateValue, { color: colors.textMuted }]}
                  >
                    {deal.airline}
                  </Text>
                </View>
              </View>

              {/* Price Row */}
              <View style={styles.priceRow}>
                <View style={{ flex: 1 }}>
                  {discount && (
                    <View style={styles.discountRow}>
                      <Text
                        style={[
                          styles.originalPrice,
                          { color: colors.textMuted },
                        ]}
                      >
                        {getCurrencySymbol(deal.currency)}
                        {deal.originalPrice}
                      </Text>
                      <View style={styles.discountBadge}>
                        <Text style={styles.discountText}>-{discount}%</Text>
                      </View>
                    </View>
                  )}
                  <Text style={[styles.price, { color: colors.text }]}>
                    {getCurrencySymbol(deal.currency)}
                    {deal.price}
                    <Text style={[styles.priceNote, { color: colors.textMuted }]}> /pp</Text>
                  </Text>
                  {deal.totalPrice && (
                    <Text
                      style={[styles.priceNote, { color: colors.textMuted }]}
                    >
                      {getCurrencySymbol(deal.currency)}
                      {deal.totalPrice} {t("lowFare.total", { defaultValue: "total" })}
                    </Text>
                  )}
                  <Text
                    style={[styles.priceNote, { color: colors.textMuted }]}
                  >
                    {deal.returnDate
                      ? t("lowFare.roundTrip", {
                          defaultValue: "Round trip",
                        })
                      : t("lowFare.oneWay", { defaultValue: "One way" })}
                  </Text>
                </View>
                <View style={[styles.expandHint, { backgroundColor: colors.lightGray || 'rgba(0,0,0,0.05)', borderRadius: 12 }]}>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.textMuted}
                  />
                </View>
              </View>

              {/* Expanded Details */}
              <Animated.View
                style={[styles.expandedSection, { height: expandedHeight }]}
              >
                <View style={styles.expandedContent}>
                  {/* Baggage info */}
                  <View style={styles.detailSection}>
                    <Text
                      style={[
                        styles.detailSectionTitle,
                        { color: colors.text },
                      ]}
                    >
                      <Ionicons name="bag-outline" size={14} />{" "}
                      {t("lowFare.baggage", {
                        defaultValue: "Luggage Allowance",
                      })}
                    </Text>
                    <View style={styles.baggageRow}>
                      {deal.cabinBaggage && (
                        <View
                          style={[
                            styles.baggageItem,
                            { backgroundColor: colors.secondary },
                          ]}
                        >
                          <Ionicons
                            name="briefcase-outline"
                            size={16}
                            color={colors.text}
                          />
                          <Text
                            style={[
                              styles.baggageText,
                              { color: colors.text },
                            ]}
                          >
                            {deal.cabinBaggage}
                          </Text>
                        </View>
                      )}
                      {deal.checkedBaggage && (
                        <View
                          style={[
                            styles.baggageItem,
                            { backgroundColor: colors.secondary },
                          ]}
                        >
                          <Ionicons
                            name="cube-outline"
                            size={16}
                            color={colors.text}
                          />
                          <Text
                            style={[
                              styles.baggageText,
                              { color: colors.text },
                            ]}
                          >
                            {deal.checkedBaggage}
                          </Text>
                        </View>
                      )}
                      {!deal.cabinBaggage && !deal.checkedBaggage && (
                        <Text
                          style={[
                            styles.baggageText,
                            { color: colors.textMuted },
                          ]}
                        >
                          {t("lowFare.noBaggageInfo", {
                            defaultValue: "Check airline for baggage info",
                          })}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Return flight info */}
                  {deal.returnDate && (
                    <View style={styles.detailSection}>
                      <Text
                        style={[
                          styles.detailSectionTitle,
                          { color: colors.text },
                        ]}
                      >
                        <Ionicons name="return-down-back" size={14} />{" "}
                        {t("lowFare.returnFlight", {
                          defaultValue: "Return Flight",
                        })}
                      </Text>
                      <View style={styles.returnRow}>
                        <Text
                          style={[
                            styles.returnTime,
                            { color: colors.text },
                          ]}
                        >
                          {deal.returnDeparture} → {deal.returnArrival}
                        </Text>
                        <Text
                          style={[
                            styles.returnDate,
                            { color: colors.textMuted },
                          ]}
                        >
                          {formatDate(deal.returnDate!)}
                        </Text>
                        {deal.returnDuration && (
                          <Text
                            style={[
                              styles.returnDuration,
                              { color: colors.textMuted },
                            ]}
                          >
                            {deal.returnDuration}
                          </Text>
                        )}
                        {deal.returnAirline && (
                          <Text
                            style={[
                              styles.returnDate,
                              { color: colors.textMuted },
                            ]}
                          >
                            {deal.returnAirline}{" "}
                            {deal.returnFlightNumber || ""}
                          </Text>
                        )}
                        {(deal.returnStops ?? 0) > 0 && (
                          <Text style={[styles.stopsInfoText, { color: colors.primary }]}>
                            {deal.returnStops} stop{(deal.returnStops ?? 0) > 1 ? "s" : ""}
                            {deal.returnSegments?.map(s => s.arrivalAirport).slice(0, -1).join(", ")
                              ? ` via ${deal.returnSegments!.map(s => s.arrivalAirport).slice(0, -1).join(", ")}`
                              : ""}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Outbound segments detail */}
                  {(deal.outboundStops ?? 0) > 0 && deal.outboundSegments && (
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailSectionTitle, { color: colors.text }]}>
                        <Ionicons name="git-branch-outline" size={14} />{" "}
                        {t("lowFare.outboundRoute", { defaultValue: "Outbound Route" })}
                      </Text>
                      {deal.outboundSegments.map((seg, idx) => (
                        <View key={idx} style={styles.segmentRow}>
                          <Text style={[styles.segmentAirports, { color: colors.text }]}>
                            {seg.departureAirport} → {seg.arrivalAirport}
                          </Text>
                          <Text style={[styles.segmentInfo, { color: colors.textMuted }]}>
                            {seg.airline}{seg.flightNumber ? ` · ${seg.flightNumber}` : ""}{" "}
                            {seg.departureTime} → {seg.arrivalTime}
                            {seg.duration ? ` (${seg.duration})` : ""}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Notes */}
                  {deal.notes && (
                    <Text
                      style={[
                        styles.dealNotes,
                        { color: colors.textMuted },
                      ]}
                    >
                      {deal.notes}
                    </Text>
                  )}

                  {/* Booking button */}
                  {deal.bookingUrl && !deal.isExpired && (
                    <TouchableOpacity
                      style={[
                        styles.bookBtn,
                        { backgroundColor: colors.primary },
                      ]}
                      onPress={() => handleBooking(deal)}
                    >
                      <Text style={styles.bookBtnText}>
                        {t("lowFare.bookNow", {
                          defaultValue: "Book This Flight",
                        })}
                      </Text>
                      <Ionicons name="open-outline" size={16} color="#000" />
                    </TouchableOpacity>
                  )}

                  {/* Expired notice */}
                  {deal.isExpired && (
                    <View style={styles.expiredNotice}>
                      <Ionicons name="alert-circle" size={16} color="#FF3B30" />
                      <Text style={styles.expiredNoticeText}>
                        {t("lowFare.expiredNotice", { defaultValue: "This deal has expired and is no longer available" })}
                      </Text>
                    </View>
                  )}

                  {/* Plan Trip button */}
                  {onPlanTrip && !deal.isExpired && (
                    <TouchableOpacity
                      style={[
                        styles.planTripBtn,
                        { backgroundColor: colors.primary },
                      ]}
                      onPress={() => onPlanTrip(deal)}
                    >
                      <Ionicons name="sparkles" size={16} color="#000" />
                      <Text style={styles.planTripBtnText}>
                        {t("lowFare.planTrip", {
                          defaultValue: "Plan a Trip",
                        })}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Animated.View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {filteredDeals.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="airplane-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {t("lowFare.noDeals", {
              defaultValue: "No recommended deals match your preferences yet",
            })}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radarIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  filterRow: {
    marginBottom: 14,
  },
  filterRowContent: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
  },
  cardsContainer: {
    paddingHorizontal: 20,
    gap: 12,
    paddingRight: 32,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    overflow: "hidden",
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  dealTagBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  dealTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFF",
    textTransform: "uppercase",
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  routePoint: {
    alignItems: "flex-start",
    flex: 1,
  },
  iataCode: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cityName: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  routeLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  routeDash: {
    height: 1,
    width: 20,
  },
  timesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  timeBlock: {
    alignItems: "flex-start",
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  timeValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  dateValue: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },
  durationBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  durationText: {
    fontSize: 12,
    fontWeight: "500",
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  discountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  originalPrice: {
    fontSize: 14,
    textDecorationLine: "line-through",
    fontWeight: "500",
  },
  discountBadge: {
    backgroundColor: "#FF3B30",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  discountText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFF",
  },
  price: {
    fontSize: 28,
    fontWeight: "800",
  },
  priceNote: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  expandHint: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  expandedSection: {
    overflow: "hidden",
  },
  expandedContent: {
    paddingTop: 14,
  },
  detailSection: {
    marginBottom: 12,
  },
  detailSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  baggageRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  baggageItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  baggageText: {
    fontSize: 13,
    fontWeight: "600",
  },
  returnRow: {
    gap: 4,
  },
  returnTime: {
    fontSize: 15,
    fontWeight: "700",
  },
  returnDate: {
    fontSize: 12,
    fontWeight: "500",
  },
  returnDuration: {
    fontSize: 12,
    fontWeight: "500",
  },
  dealNotes: {
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 12,
  },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  bookBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#000",
  },
  planTripBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  planTripBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#000",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  stopsBadge: {
    fontSize: 9,
    fontWeight: "700",
    marginTop: 1,
  },
  stopsInfoText: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  segmentRow: {
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(0,0,0,0.08)",
  },
  segmentAirports: {
    fontSize: 13,
    fontWeight: "700",
  },
  segmentInfo: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  wishlistSummary: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  wishlistSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  wishlistSummaryTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  wishlistChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  wishlistChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  wishlistChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  expiredNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FF3B30" + "12",
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  expiredNoticeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FF3B30",
    flex: 1,
  },
});
