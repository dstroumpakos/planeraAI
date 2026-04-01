import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  StatusBar,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { useConvexAuth } from "@/lib/auth-components";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { LanguagePickerModal } from "@/components/LanguagePickerModal";
import { FirstTripPopup } from "@/components/FirstTripGuide";
import { LowFareRadar } from "@/components/LowFareRadar";
import StreakWidget from "@/components/StreakWidget";
import AchievementUnlocked from "@/components/AchievementUnlocked";

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { colors, isDarkMode } = useTheme();
  const { token, isLoading: tokenLoading } = useToken();
  const { t, i18n } = useTranslation();
  const [destinationImages, setDestinationImages] = useState<Record<string, any>>({});
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showFirstTripGuide, setShowFirstTripGuide] = useState(false);
  const markGuideSeen = useMutation(api.users.markFirstTripGuideSeen as any);
  const checkIn = useMutation(api.streaks.checkIn as any);
  const trackBookingClick = useMutation(api.lowFareRadar.trackBookingClick as any);
  const [checkedIn, setCheckedIn] = useState(false);

  // Debug logging
  useEffect(() => {
    console.log("[HomeScreen] Token status:", {
      tokenPresent: !!token,
      tokenLoading,
      authLoading,
      isAuthenticated,
    });
  }, [token, tokenLoading, authLoading, isAuthenticated]);

  const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" });

  // Show language picker for first-time users or users who haven't set language yet
  useEffect(() => {
    if (userSettings !== undefined && !userSettings?.language) {
      setShowLanguagePicker(true);
    }
  }, [userSettings]);

  const userPlan = useQuery(api.users.getPlan as any, { token: token || "skip" });
  const trips = useQuery(api.trips.list as any, { token: token || "skip" });
  const trendingDestinations = useQuery(api.trips.getTrendingDestinations);
  const lowFareData = useQuery(api.lowFareRadar.getDealsForUser as any, { token: token || "skip" });
  const lowFareDeals = lowFareData?.deals || (Array.isArray(lowFareData) ? lowFareData : []);
  const homeIata = lowFareData?.homeIata || null;
  const wishlistDestinations = lowFareData?.wishlistDestinations || [];
  const surpriseDeal = useQuery(api.lowFareRadar.surpriseMe as any, {});

  // Show first trip guide for new users who haven't seen it
  useEffect(() => {
    if (
      userSettings !== undefined &&
      trips !== undefined &&
      !userSettings?.hasSeenFirstTripGuide &&
      (!trips || trips.length === 0) &&
      !showLanguagePicker
    ) {
      setShowFirstTripGuide(true);
    }
  }, [userSettings, trips, showLanguagePicker]);
  const getImages = useAction(api.images.getDestinationImages);
  const ensureUserPlan = useMutation(api.users.ensureUserPlan as any);

  // Ensure user plan exists when authenticated
  useEffect(() => {
    if (token && isAuthenticated) {
      ensureUserPlan({ token }).catch((err: any) => {
        console.error("[HomeScreen] Failed to ensure user plan:", err);
      });
    }
  }, [token, isAuthenticated]);

  // Auto check-in for streaks
  useEffect(() => {
    if (token && isAuthenticated && !checkedIn) {
      setCheckedIn(true);
      checkIn({ token }).catch((err: any) => {
        console.error("[HomeScreen] Streak check-in failed:", err);
      });
    }
  }, [token, isAuthenticated, checkedIn]);

  const getProfileImageUrl = useQuery(
    api.users.getProfileImageUrl as any,
    token && userSettings?.profilePicture
      ? { storageId: userSettings.profilePicture, token } 
      : "skip"
  );

  const fetchImages = useCallback(async () => {
    const imageMap: Record<string, any> = {};
    if (!trendingDestinations) return;
    for (const destination of trendingDestinations) {
      try {
        const images = await getImages({ destination: destination.destination });
        if (images && images.length > 0) {
          imageMap[destination.destination] = images[0];
        }
      } catch (error) {
        console.error(`Failed to fetch images for ${destination.destination}:`, error);
      }
    }
    setDestinationImages(imageMap);
  }, [trendingDestinations]);

  useEffect(() => {
    if (trendingDestinations && trendingDestinations.length > 0) {
      fetchImages();
    }
  }, [trendingDestinations]);

  useEffect(() => {
    if (getProfileImageUrl) {
      setProfileImageUrl(getProfileImageUrl);
    }
  }, [getProfileImageUrl]);

  if (authLoading || tokenLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Check if we have a token instead of relying on isAuthenticated
  if (!token) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.authContainer}>
          <Text style={[styles.authText, { color: colors.textMuted }]}>{t("home.pleaseLogIn")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const userName = userSettings?.name?.split(" ")[0] || t("home.traveler");

  const getGreeting = () => {
    const hour = new Date().getHours();
    let greeting = "";
    
    if (hour < 12) {
      greeting = t("home.goodMorning");
    } else if (hour < 18) {
      greeting = t("home.goodAfternoon");
    } else if (hour < 21) {
      greeting = t("home.goodEvening");
    } else {
      greeting = t("home.goodNight");
    }
    
    return `${greeting}, ${userName}`;
  };

  const getCreditDisplay = () => {
    if (!userPlan) return null;
    
    if (userPlan.isSubscriptionActive) {
      return (
        <View style={[styles.creditBadge, { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
          <Ionicons name="infinite" size={16} color={colors.text} />
          <Text style={[styles.creditText, { color: colors.text }]}>{t("home.unlimited")}</Text>
        </View>
      );
    }

    return (
      <View style={[styles.creditBadge, { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
        <Ionicons name="ticket-outline" size={16} color={colors.text} />
        <Text style={[styles.creditText, { color: colors.text }]}>{t("home.credits", { count: userPlan.tripCredits })}</Text>
      </View>
    );
  };

  return (
    <>
      <LanguagePickerModal
        visible={showLanguagePicker}
        onDismiss={() => setShowLanguagePicker(false)}
      />
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
      <FirstTripPopup
        visible={showFirstTripGuide}
        onDismiss={() => {
          setShowFirstTripGuide(false);
          if (token) {
            markGuideSeen({ token }).catch((err: any) => {
              console.error("[HomeScreen] Failed to mark guide seen:", err);
            });
          }
        }}
      />
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.avatarContainer}>
              {profileImageUrl ? (
                <Image
                  source={{ uri: profileImageUrl }}
                  style={styles.profileImage}
                  cachePolicy="disk"
                  transition={200}
                />
              ) : (
                <Ionicons name="person-circle" size={44} color={colors.textMuted} />
              )}
              <View style={[styles.onlineBadge, { backgroundColor: colors.primary, borderColor: colors.background }]} />
            </View>
            <View style={styles.headerRight}>
              <StreakWidget />
              <TouchableOpacity 
                style={styles.creditContainer}
                onPress={() => router.push("/subscription")}
              >
                {getCreditDisplay()}
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.greetingSub, { color: colors.textMuted }]}>{getGreeting()}</Text>
          <Text style={[styles.greetingMain, { color: colors.text }]}>{t("home.readyForJourney")}</Text>
        </View>

        {/* Search Bar */}
        <TouchableOpacity 
          style={[styles.searchContainer, { backgroundColor: colors.card }]}
          onPress={() => router.push("/create-trip")}
          activeOpacity={0.7}
        >
          <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <Text style={[styles.searchPlaceholder, { color: colors.textMuted }]}>{t("home.whereToGo")}</Text>
          <View style={[styles.searchButton, { backgroundColor: colors.primary }]}>
            <Ionicons name="arrow-forward" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>

        {/* Feature Cards */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.featuresScroll}
          contentContainerStyle={styles.featuresContent}
        >
          <TouchableOpacity 
            style={[styles.featureCard, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => router.push("/create-trip")}
          >
            <View style={[styles.featureIcon, styles.featureIconPrimary]}>
              <Ionicons name="sparkles" size={20} color="#000000" />
            </View>
            <Text style={[styles.featureText, { color: "#000000" }]}>{t("home.aiTripPlanner")}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.featureCard, { backgroundColor: "#FF6B35", borderColor: "#FF6B35" }]}
            onPress={() => {
              if (surpriseDeal) {
                router.push({
                  pathname: "/deal-trip",
                  params: {
                    dealId: surpriseDeal._id,
                    origin: surpriseDeal.origin,
                    originCity: surpriseDeal.originCity,
                    destination: surpriseDeal.destination,
                    destinationCity: surpriseDeal.destinationCity,
                    airline: surpriseDeal.airline,
                    outboundDate: surpriseDeal.outboundDate,
                    outboundDeparture: surpriseDeal.outboundDeparture,
                    outboundArrival: surpriseDeal.outboundArrival,
                    returnDate: surpriseDeal.returnDate || "",
                    returnDeparture: surpriseDeal.returnDeparture || "",
                    returnArrival: surpriseDeal.returnArrival || "",
                    returnAirline: surpriseDeal.returnAirline || "",
                    price: String(surpriseDeal.price),
                    totalPrice: surpriseDeal.totalPrice ? String(surpriseDeal.totalPrice) : "",
                    currency: surpriseDeal.currency,
                    outboundStops: String(surpriseDeal.outboundStops ?? 0),
                    returnStops: String(surpriseDeal.returnStops ?? 0),
                    outboundSegments: surpriseDeal.outboundSegments ? JSON.stringify(surpriseDeal.outboundSegments) : "",
                    returnSegments: surpriseDeal.returnSegments ? JSON.stringify(surpriseDeal.returnSegments) : "",
                  },
                });
              }
            }}
          >
            <View style={[styles.featureIcon, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
              <Ionicons name="dice-outline" size={20} color="#FFFFFF" />
            </View>
            <Text style={[styles.featureText, { color: "#FFFFFF" }]}>{t("home.surpriseMe")}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.featureIcon, { backgroundColor: colors.secondary }]}>
              <Ionicons name="map-outline" size={20} color={colors.text} />
            </View>
            <Text style={[styles.featureText, { color: colors.text }]}>{t("home.multiCityRoute")}</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Low Fare Radar */}
        {lowFareDeals && lowFareDeals.length > 0 && (
          <LowFareRadar
            deals={lowFareDeals}
            homeIata={homeIata}
            wishlistDestinations={wishlistDestinations}
            onPlanTrip={(deal) => {
              router.push({
                pathname: "/deal-trip",
                params: {
                  dealId: deal._id,
                  origin: deal.origin,
                  originCity: deal.originCity,
                  destination: deal.destination,
                  destinationCity: deal.destinationCity,
                  airline: deal.airline,
                  outboundDate: deal.outboundDate,
                  outboundDeparture: deal.outboundDeparture,
                  outboundArrival: deal.outboundArrival,
                  returnDate: deal.returnDate || "",
                  returnDeparture: deal.returnDeparture || "",
                  returnArrival: deal.returnArrival || "",
                  returnAirline: deal.returnAirline || "",
                  price: String(deal.price),
                  totalPrice: deal.totalPrice ? String(deal.totalPrice) : "",
                  currency: deal.currency,
                  outboundStops: String(deal.outboundStops ?? 0),
                  returnStops: String(deal.returnStops ?? 0),
                  outboundSegments: deal.outboundSegments ? JSON.stringify(deal.outboundSegments) : "",
                  returnSegments: deal.returnSegments ? JSON.stringify(deal.returnSegments) : "",
                },
              });
            }}
            onPlanFromWishlist={(destination) => {
              router.push({
                pathname: "/create-trip",
                params: { prefilledDestination: destination },
              } as any);
            }}
            onBookingClick={(dealId) => {
              trackBookingClick({ dealId }).catch(() => {});
            }}
          />
        )}

        {/* Trending Destinations Section */}
        {trendingDestinations && trendingDestinations.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("home.trendingNow")}</Text>
              <TouchableOpacity onPress={() => router.push("/destinations")}>
                <Text style={[styles.viewAllText, { color: colors.textMuted }]}>{t("common.viewAll")}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.trendingScroll}
              contentContainerStyle={styles.trendingContent}
            >
              {trendingDestinations.map((destination: any, index: number) => (
                <TouchableOpacity 
                  key={index}
                  style={[styles.trendingCard, { backgroundColor: colors.lightGray }]}
                  onPress={() => router.push({
                    pathname: "/destination-preview",
                    params: {
                      destination: destination.destination,
                      avgBudget: destination.avgBudget.toString(),
                      avgRating: destination.avgRating.toString(),
                      count: destination.count.toString(),
                    }
                  })}
                  activeOpacity={0.9}
                >
                  {destinationImages[destination.destination] ? (
                    <ImageWithAttribution
                      imageUrl={destinationImages[destination.destination].url}
                      photographerName={destinationImages[destination.destination].photographer}
                      photographerUrl={destinationImages[destination.destination].photographerUrl}
                      photoUrl={destinationImages[destination.destination].attribution}
                    />
                  ) : (
                    <View style={[styles.trendingImagePlaceholder, { backgroundColor: colors.secondary }]}>
                      <Text style={styles.trendingEmoji}>✈️</Text>
                    </View>
                  )}
                  
                  <View style={styles.trendingOverlay}>
                    <View style={styles.ratingBadge}>
                      <Ionicons name="star" size={12} color={colors.primary} />
                      <Text style={[styles.ratingText, { color: "#000000" }]}>{destination.avgRating.toFixed(1)}</Text>
                    </View>
                    
                    <View style={styles.trendingCardContent}>
                      <Text style={styles.trendingName}>{destination.destination}</Text>
                      <View style={styles.trendingLocationRow}>
                        <Ionicons name="location-sharp" size={12} color="#FFFFFF" />
                        <Text style={styles.trendingCountry}>{t("home.popularDestination")}</Text>
                      </View>
                      <View style={styles.trendingFooter}>
                        <View>
                          <Text style={[styles.trendingPriceLabel, { color: "#000000" }]}>{t("home.estTotal")}</Text>
                          <Text style={[styles.trendingPrice, { color: colors.primary }]}>€{Math.round(destination.avgBudget)}</Text>
                          <Text style={[styles.trendingPriceSubtitle, { color: "#000000" }]}>{t("home.basedOnBudget")}</Text>
                        </View>
                        <View style={styles.trendingArrow}>
                          <Ionicons name="arrow-forward" size={16} color="#000000" />
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* My Trips Section */}
        {trips && trips.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("home.myTrips")}</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/trips")}>
                <Text style={[styles.viewAllText, { color: colors.textMuted }]}>{t("common.viewAll")}</Text>
              </TouchableOpacity>
            </View>

            {trips.slice(0, 2).map((trip: any) => (
              <TouchableOpacity 
                key={trip._id}
                style={[styles.tripCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/trip/${trip._id}`)}
              >
                <View style={[styles.tripIconContainer, { backgroundColor: colors.primary }]}>
                  <Ionicons name="airplane" size={24} color={colors.text} />
                </View>
                <View style={styles.tripInfo}>
                  <Text style={[styles.tripDestination, { color: colors.text }]}>{trip.destination}</Text>
                  <Text style={[styles.tripDates, { color: colors.textMuted }]}>
                    {new Date(trip.startDate).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} - {new Date(trip.endDate).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
    <AchievementUnlocked />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  authContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  authText: {
    fontSize: 16,
    textAlign: "center",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    marginBottom: 24,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarContainer: {
    position: "relative",
    width: 44,
    height: 44,
  },
  profileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  onlineBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  headerTexts: {
    justifyContent: "center",
  },
  greetingSub: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 2,
  },
  greetingMain: {
    fontSize: 18,
    fontWeight: "700",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  creditContainer: {
    justifyContent: "center",
  },
  creditBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
  },
  creditText: {
    fontSize: 14,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 30,
    padding: 8,
    marginHorizontal: 20,
    marginBottom: 24,
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.05)",
    elevation: 3,
  },
  searchIcon: {
    marginLeft: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    height: 40,
  },
  searchPlaceholder: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  featuresScroll: {
    marginBottom: 32,
  },
  featuresContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    gap: 8,
    borderWidth: 1,
    boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.05)",
    elevation: 2,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  featureIconPrimary: {
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  featureText: {
    fontSize: 14,
    fontWeight: "600",
  },
  sectionContainer: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "500",
  },
  trendingScroll: {
    paddingLeft: 20,
  },
  trendingContent: {
    paddingRight: 20,
    gap: 16,
  },
  trendingCard: {
    width: 260,
    height: 340,
    borderRadius: 24,
    overflow: "hidden",
    position: "relative",
  },
  trendingImageContainer: {
    width: "100%",
    height: "100%",
  },
  trendingImage: {
    width: "100%",
    height: "100%",
  },
  trendingImagePlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  trendingEmoji: {
    fontSize: 64,
  },
  trendingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  ratingBadge: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
  },
  trendingCardContent: {
    width: "100%",
    paddingBottom: 30,
  },
  trendingName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  trendingLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  trendingCountry: {
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    fontWeight: "500",
  },
  trendingFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  trendingPrice: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F5A623",
  },
  trendingPriceLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 4,
  },
  trendingPriceSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  trendingArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  tripIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  tripInfo: {
    flex: 1,
  },
  tripDestination: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  tripDates: {
    fontSize: 14,
  },
});
