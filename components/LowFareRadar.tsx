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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
  const [allExpanded, setAllExpanded] = useState(false);
  const animValues = useRef<Record<string, Animated.Value>>({});
  const flightAnimValues = useRef<Record<string, Animated.Value>>({});
  const lastActiveIndexRef = useRef<number>(-1);

  const playFlightAnim = (id: string) => {
    const v = getFlightAnim(id);
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 800,
      delay: 80,
      useNativeDriver: true,
    }).start();
  };

  const getFlightAnim = (id: string) => {
    if (!flightAnimValues.current[id]) {
      const v = new Animated.Value(0);
      flightAnimValues.current[id] = v;
      // Fire once when the card first mounts
      setTimeout(() => {
        Animated.timing(v, {
          toValue: 1,
          duration: 800,
          delay: 120,
          useNativeDriver: true,
        }).start();
      }, 0);
    }
    return flightAnimValues.current[id];
  };

  if (!deals || deals.length === 0) return null;

  const filteredDeals =
    filter === "recommended"
      ? deals.filter((d) => d.isRecommended || d.matchesPreference)
      : filter === "wishlist"
        ? deals.filter((d) => d.matchesWishlist && (!wishlistFilter || d.destinationCity.toLowerCase() === wishlistFilter.toLowerCase()))
        : deals;

  const getAnimValue = (id: string) => {
    if (!animValues.current[id]) {
      animValues.current[id] = new Animated.Value(allExpanded ? 1 : 0);
    }
    return animValues.current[id];
  };

  const toggleExpand = (_id: string) => {
    const next = !allExpanded;
    setAllExpanded(next);
    Object.values(animValues.current).forEach((v) => {
      Animated.timing(v, {
        toValue: next ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      }).start();
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

  const getPriceChange = (deal: FlightDeal) => {
    if (!deal.originalPrice || deal.originalPrice === deal.price) return null;
    const percent = Math.round(
      Math.abs(deal.originalPrice - deal.price) / deal.originalPrice * 100
    );
    if (deal.price < deal.originalPrice) return { type: "drop" as const, percent };
    return { type: "increase" as const, percent };
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
          <LinearGradient
            colors={[colors.primary, "#34C759"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.radarIcon}
          >
            <Ionicons name="pulse" size={18} color="#000" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.title, { color: colors.text }]}>
                {t("lowFare.title", { defaultValue: "Low Fare Radar" })}
              </Text>
              <View style={[styles.liveDotWrap, { backgroundColor: "#34C75920" }]}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            </View>
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
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 12));
          if (idx !== lastActiveIndexRef.current) {
            lastActiveIndexRef.current = idx;
            const deal = filteredDeals[idx];
            if (deal) playFlightAnim(deal._id);
          }
        }}
      >
        {filteredDeals.map((deal) => {
          const priceChange = getPriceChange(deal);
          const animValue = getAnimValue(deal._id);
          const isExpanded = allExpanded;
          const flightAnim = getFlightAnim(deal._id);
          const planeTranslateX = flightAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [-26, 0],
          });
          const planeOpacity = flightAnim.interpolate({
            inputRange: [0, 0.4, 1],
            outputRange: [0, 1, 1],
          });

          const expandedHeight = animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [
              0,
              260 +
                ((deal.outboundStops ?? 0) + (deal.returnStops ?? 0)) * 60,
            ],
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
                  <View style={[styles.routeBar, { backgroundColor: colors.primary + "30" }]}>
                    <View style={[styles.routeBarFill, { backgroundColor: colors.primary }]} />
                  </View>
                  <Animated.View
                    style={[
                      styles.planeChip,
                      { backgroundColor: colors.primary, transform: [{ translateX: planeTranslateX }], opacity: planeOpacity },
                    ]}
                  >
                    <Ionicons name="airplane" size={14} color="#000" />
                  </Animated.View>
                  <View style={[styles.routeBar, { backgroundColor: colors.primary + "30" }]}>
                    <View style={[styles.routeBarFill, { backgroundColor: colors.primary, alignSelf: "flex-end" }]} />
                  </View>
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

              {/* Stops indicator under route */}
              {(deal.outboundStops ?? 0) > 0 && (
                <View style={styles.stopsRow}>
                  <Ionicons name="git-branch-outline" size={11} color={colors.primary} />
                  <Text style={[styles.stopsRowText, { color: colors.primary }]}>
                    {deal.outboundStops} stop{(deal.outboundStops ?? 0) > 1 ? "s" : ""}
                  </Text>
                </View>
              )}

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

              {/* Return flight (always visible, below outbound) */}
              {deal.returnDate && (
                <View style={styles.returnSection}>
                  <View style={styles.returnLabelRow}>
                    <Ionicons name="return-down-back" size={12} color={colors.textMuted} />
                    <Text style={[styles.returnLabel, { color: colors.textMuted }]}>
                      {t("lowFare.returnFlight", { defaultValue: "Return Flight" })}
                    </Text>
                  </View>

                  {/* Route */}
                  <View style={styles.routeRow}>
                    <View style={styles.routePoint}>
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
                    <View style={styles.routeLine}>
                      <View style={[styles.routeBar, { backgroundColor: colors.primary + "30" }]}>
                        <View style={[styles.routeBarFill, { backgroundColor: colors.primary }]} />
                      </View>
                      <Animated.View
                        style={[
                          styles.planeChip,
                          {
                            backgroundColor: colors.primary,
                            transform: [{ translateX: Animated.multiply(planeTranslateX, -1) }],
                            opacity: planeOpacity,
                          },
                        ]}
                      >
                        <Ionicons name="airplane" size={14} color="#000" style={{ transform: [{ scaleX: -1 }] }} />
                      </Animated.View>
                      <View style={[styles.routeBar, { backgroundColor: colors.primary + "30" }]}>
                        <View style={[styles.routeBarFill, { backgroundColor: colors.primary, alignSelf: "flex-end" }]} />
                      </View>
                    </View>
                    <View style={[styles.routePoint, { alignItems: "flex-end" }]}>
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
                  </View>

                  {(deal.returnStops ?? 0) > 0 && (
                    <View style={styles.stopsRow}>
                      <Ionicons name="git-branch-outline" size={11} color={colors.primary} />
                      <Text style={[styles.stopsRowText, { color: colors.primary }]}>
                        {deal.returnStops} stop{(deal.returnStops ?? 0) > 1 ? "s" : ""}
                      </Text>
                    </View>
                  )}

                  {/* Times */}
                  <View style={styles.timesRow}>
                    <View style={styles.timeBlock}>
                      <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                        {t("lowFare.depart", { defaultValue: "Depart" })}
                      </Text>
                      <Text style={[styles.timeValue, { color: colors.text }]}>
                        {deal.returnDeparture}
                      </Text>
                      <Text style={[styles.dateValue, { color: colors.textMuted }]}>
                        {formatDate(deal.returnDate!)}
                      </Text>
                    </View>
                    {deal.returnDuration && (
                      <View style={styles.durationBlock}>
                        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                        <Text style={[styles.durationText, { color: colors.textMuted }]}>
                          {deal.returnDuration}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.timeBlock, { alignItems: "flex-end" }]}>
                      <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
                        {t("lowFare.arrive", { defaultValue: "Arrive" })}
                      </Text>
                      <Text style={[styles.timeValue, { color: colors.text }]}>
                        {deal.returnArrival}
                      </Text>
                      <Text style={[styles.dateValue, { color: colors.textMuted }]}>
                        {deal.returnAirline || deal.airline}
                        {deal.returnFlightNumber ? ` ${deal.returnFlightNumber}` : ""}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Price Row */}
              <View style={styles.priceRow}>
                <View style={{ flex: 1 }}>
                  {priceChange && priceChange.type === "drop" && (
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
                        <Ionicons name="trending-down" size={12} color="#FFF" />
                        <Text style={styles.discountText}>-{priceChange.percent}%</Text>
                      </View>
                    </View>
                  )}
                  {priceChange && priceChange.type === "increase" && (
                    <View style={styles.discountRow}>
                      <Text
                        style={[
                          styles.previousPrice,
                          { color: colors.textMuted },
                        ]}
                      >
                        {getCurrencySymbol(deal.currency)}
                        {deal.originalPrice}
                      </Text>
                      <View style={styles.increaseBadge}>
                        <Ionicons name="trending-up" size={12} color="#FFF" />
                        <Text style={styles.increaseText}>+{priceChange.percent}%</Text>
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
                <View style={[styles.expandHint, { backgroundColor: colors.text + "12", borderRadius: 19 }]}>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.text}
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

                  {/* Return flight info — styled like outbound */}


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

                  {/* Return segments detail */}
                  {(deal.returnStops ?? 0) > 0 && deal.returnSegments && deal.returnSegments.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailSectionTitle, { color: colors.text }]}>
                        <Ionicons name="git-branch-outline" size={14} />{" "}
                        {t("lowFare.returnRoute", { defaultValue: "Return Route" })}
                      </Text>
                      {deal.returnSegments.map((seg, idx) => (
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
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radarIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#34C759",
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 4 },
    }),
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  liveDotWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34C759",
  },
  liveText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#34C759",
    letterSpacing: 0.6,
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
    paddingVertical: 9,
    borderRadius: 22,
    gap: 6,
    borderWidth: 1,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "700",
  },
  cardsContainer: {
    paddingHorizontal: 20,
    gap: 14,
    paddingRight: 32,
    paddingVertical: 4,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
    }),
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  dealTagBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  dealTagText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFF",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  routePoint: {
    alignItems: "flex-start",
    flex: 1,
  },
  iataCode: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  cityName: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  routeLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
  },
  routeBar: {
    height: 2,
    width: 22,
    borderRadius: 1,
    overflow: "hidden",
  },
  routeBarFill: {
    height: 2,
    width: "60%",
    borderRadius: 1,
  },
  planeChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  stopsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginBottom: 10,
  },
  stopsRowText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  timesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(127,127,127,0.12)",
  },
  timeBlock: {
    alignItems: "flex-start",
  },
  timeLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 3,
    opacity: 0.75,
  },
  timeValue: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  dateValue: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  durationBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(127,127,127,0.10)",
  },
  durationText: {
    fontSize: 11,
    fontWeight: "700",
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(127,127,127,0.12)",
  },
  discountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  originalPrice: {
    fontSize: 13,
    textDecorationLine: "line-through",
    fontWeight: "600",
  },
  discountBadge: {
    backgroundColor: "#34C759",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  discountText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFF",
    letterSpacing: 0.3,
  },
  previousPrice: {
    fontSize: 13,
    fontWeight: "600",
  },
  increaseBadge: {
    backgroundColor: "#FF9500",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  increaseText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFF",
    letterSpacing: 0.3,
  },
  price: {
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  priceNote: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  expandHint: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  expandedSection: {
    overflow: "hidden",
  },
  expandedContent: {
    paddingTop: 16,
  },
  detailSection: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(127,127,127,0.10)",
  },
  detailSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    opacity: 0.85,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  baggageText: {
    fontSize: 13,
    fontWeight: "700",
  },
  returnRow: {
    gap: 4,
  },
  returnSection: {
    marginTop: 4,
    marginBottom: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(127,127,127,0.10)",
  },
  returnLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  returnLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
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
    lineHeight: 17,
  },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  bookBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.2,
  },
  planTripBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 10,
  },
  planTripBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.2,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  stopsBadge: {
    fontSize: 9,
    fontWeight: "800",
    marginTop: 1,
  },
  stopsInfoText: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  segmentRow: {
    marginBottom: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(127,127,127,0.20)",
  },
  segmentAirports: {
    fontSize: 13,
    fontWeight: "800",
  },
  segmentInfo: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  wishlistSummary: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  wishlistSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  wishlistSummaryTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  wishlistChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  wishlistChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  wishlistChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  expiredNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FF3B30" + "12",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  expiredNoticeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FF3B30",
    flex: 1,
  },
});
