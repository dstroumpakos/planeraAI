import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  StatusBar,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useConvexAuth } from "@/lib/auth-components";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useHideTabBarOnScroll } from "@/lib/tabBarVisibility";
import { LanguagePickerModal } from "@/components/LanguagePickerModal";
import { FirstTripPopup } from "@/components/FirstTripGuide";
import { LowFareRadar } from "@/components/LowFareRadar";
import StreakWidget from "@/components/StreakWidget";
import AchievementUnlocked from "@/components/AchievementUnlocked";
import AirplaneIntro from "@/components/AirplaneIntro";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing } from "react-native-reanimated";

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { colors, isDarkMode } = useTheme();
  const hideOnScroll = useHideTabBarOnScroll();
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

  // One-shot airplane intro: flies up and slides INTO the search field when Home
  // first appears. We capture the field's full window rect so a replica of it can
  // sit above the plane and "swallow" it at the end.
  const searchRef = useRef<any>(null);
  const introMeasured = useRef(false);
  const [introRect, setIntroRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [introDone, setIntroDone] = useState(false);
  // Gold glow pulse on the search field as the plane slides into it.
  const fieldGlow = useSharedValue(0);
  const fieldGlowStyle = useAnimatedStyle(() => ({
    opacity: fieldGlow.value * 0.6,
    transform: [{ scale: 0.94 + fieldGlow.value * 0.12 }],
  }));
  const triggerFieldGlow = useCallback(() => {
    fieldGlow.value = withSequence(
      withTiming(1, { duration: 160 }),
      withTiming(0, { duration: 720, easing: Easing.out(Easing.quad) })
    );
  }, []);
  const handleSearchLayout = useCallback(() => {
    if (introMeasured.current) return;
    // Measure on the next frame so window coordinates are final. Only lock in
    // once we get valid coords, so a too-early layout pass can retry.
    requestAnimationFrame(() => {
      searchRef.current?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0 && !introMeasured.current) {
          introMeasured.current = true;
          setIntroRect({ x, y, w, h });
        }
      });
    });
  }, []);

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
      checkIn({ token })
        .then((result: any) => {
          if (result?.creditsAwarded > 0) {
            Alert.alert(
              t("streaks.rewardTitle", { count: result.milestone }),
              t("streaks.rewardMessage", { count: result.creditsAwarded })
            );
          }
        })
        .catch((err: any) => {
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
        onScroll={hideOnScroll}
        scrollEventThrottle={16}
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
          ref={searchRef}
          onLayout={handleSearchLayout}
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

        {/* Feature Cards - Instagram story style */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.featuresScroll}
          contentContainerStyle={styles.featuresContent}
        >
          <TouchableOpacity
            style={styles.storyButton}
            onPress={() => router.push("/create-trip")}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#FEDA77", "#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.storyRing}
            >
              <View style={[styles.storyAvatar, { backgroundColor: colors.primary }]}>
                <Ionicons name="sparkles" size={26} color="#000000" />
              </View>
            </LinearGradient>
            <Text
              style={[styles.storyLabel, { color: colors.text }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("home.aiTripPlanner")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.storyButton}
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
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#FEDA77", "#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.storyRing}
            >
              <View style={[styles.storyAvatar, { backgroundColor: "#FF6B35" }]}>
                <Ionicons name="dice-outline" size={26} color="#FFFFFF" />
              </View>
            </LinearGradient>
            <Text
              style={[styles.storyLabel, { color: colors.text }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("home.surpriseMe")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.storyButton}
            onPress={() => router.push("/flights/search" as any)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#FEDA77", "#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.storyRing}
            >
              <View style={[styles.storyAvatar, { backgroundColor: "#1E7BD4" }]}>
                <Ionicons name="airplane-outline" size={26} color="#FFFFFF" />
              </View>
            </LinearGradient>
            <Text
              style={[styles.storyLabel, { color: colors.text }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("home.flightSearch", { defaultValue: "Flight Search" })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.storyButton}
            onPress={() => router.push("/worldprint" as any)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#FEDA77", "#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.storyRing}
            >
              <View style={[styles.storyAvatar, { backgroundColor: "#0B1736" }]}>
                <Ionicons name="globe-outline" size={26} color="#FFFFFF" />
              </View>
            </LinearGradient>
            <Text
              style={[styles.storyLabel, { color: colors.text }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("home.worldprint", { defaultValue: "WorldPrint" })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.storyButton} activeOpacity={0.8} disabled>
            <View>
              <LinearGradient
                colors={["#FEDA77", "#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.storyRing}
              >
                <View style={[styles.storyAvatar, { backgroundColor: colors.card, opacity: 0.85 }]}>
                  <Ionicons name="map-outline" size={26} color={colors.text} />
                </View>
              </LinearGradient>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>
                  {t("home.comingSoon", { defaultValue: "Coming soon" })}
                </Text>
              </View>
            </View>
            <Text
              style={[styles.storyLabel, { color: colors.text }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("home.multiCityRoute")}
            </Text>
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

        {/* Explore destinations ("Where can I go?") */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push({ pathname: "/flights/explore", params: homeIata ? { homeIata } : {} } as any)}
          style={{ marginHorizontal: 20, marginBottom: 24 }}
        >
          <LinearGradient
            colors={[colors.primary, "#34C759"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 20 }}
          >
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.15)", justifyContent: "center", alignItems: "center" }}>
              <Ionicons name="compass" size={24} color="#000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: "#000", letterSpacing: -0.3 }}>
                {t("explore.homeCardTitle", { defaultValue: "Where can I go?" })}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "rgba(0,0,0,0.7)", marginTop: 2 }}>
                {t("explore.homeCardSubtitle", { defaultValue: "Find destinations you can afford" })}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#000" />
          </LinearGradient>
        </TouchableOpacity>

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
                    <View style={styles.trendingCardContent}>
                      <Text style={styles.trendingName}>{destination.destination}</Text>
                      <View style={styles.trendingLocationRow}>
                        <Ionicons name="location-sharp" size={12} color="#FFFFFF" />
                        <Text style={styles.trendingCountry}>{t("home.popularDestination")}</Text>
                      </View>
                      <View style={styles.trendingFooter}>
                        {destination.avgTripSpend != null ? (
                          <View>
                            <Text style={[styles.trendingPriceLabel, { color: "#FFFFFF" }]}>{t("home.avgTripSpend")}</Text>
                            <Text style={[styles.trendingPrice, { color: colors.primary }]}>€{Math.round(destination.avgTripSpend)}</Text>
                            <Text style={[styles.trendingPriceSubtitle, { color: "#FFFFFF" }]}>{t("home.perPersonTrip")}</Text>
                          </View>
                        ) : (
                          <View />
                        )}
                        <View style={styles.trendingArrow}>
                          <Ionicons name="arrow-forward" size={16} color="#000000" />
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {trendingDestinations.some((d: any) => d.avgTripSpend != null) && (
              <Text style={[styles.trendingSource, { color: colors.textMuted }]}>
                {trendingDestinations.some((d: any) => d.spendSource === "unwto")
                  ? t("home.spendSource")
                  : t("home.spendSourceEstimate")}
              </Text>
            )}
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
    {/* Airplane intro: flies on top of the content, then slides INTO the search
        field — a replica of the field sits above the plane and swallows it. */}
    {introRect && !introDone && (
      <>
        <AirplaneIntro
          targetX={introRect.x + introRect.w / 2}
          targetY={introRect.y + introRect.h / 2}
          color={colors.primary}
          imageSource={require("@/assets/images/airplane-intro.png")}
          onArrive={triggerFieldGlow}
          onDone={() => setIntroDone(true)}
        />
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: introRect.x, top: introRect.y, width: introRect.w, height: introRect.h }}
        >
          {/* Gold glow halo that pulses when the plane slides into the field. */}
          <Animated.View
            style={[
              {
                position: "absolute",
                top: -14,
                left: -14,
                right: -14,
                bottom: -14,
                borderRadius: 38,
                backgroundColor: colors.primary,
                shadowColor: colors.primary,
                shadowOpacity: 1,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 0 },
              },
              fieldGlowStyle,
            ]}
          />
          {/* Replica of the search field (sits above the plane so it's swallowed). */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", borderRadius: 30, padding: 8, backgroundColor: colors.card }}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
            <Text style={[styles.searchPlaceholder, { color: colors.textMuted }]}>{t("home.whereToGo")}</Text>
            <View style={[styles.searchButton, { backgroundColor: colors.primary }]}>
              <Ionicons name="arrow-forward" size={20} color={colors.text} />
            </View>
          </View>
        </View>
      </>
    )}
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
    paddingTop: 6,
    gap: 14,
    alignItems: "flex-start",
  },
  storyButton: {
    width: 92,
    alignItems: "center",
    paddingTop: 8,
  },
  storyRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
  },
  storyAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  storyLabel: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  comingSoonBadge: {
    position: "absolute",
    top: -6,
    right: 0,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    minWidth: 28,
    alignItems: "center",
    zIndex: 2,
    elevation: 3,
  },
  comingSoonText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
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
  trendingSource: {
    fontSize: 11,
    paddingHorizontal: 20,
    marginTop: 10,
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
    justifyContent: "flex-end",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.1)",
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
    fontWeight: "700",
    marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  trendingPriceSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
