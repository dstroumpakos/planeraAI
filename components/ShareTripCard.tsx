import React, { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Share,
  Alert,
  TouchableOpacity,
  ScrollView,
  Modal,
  Dimensions,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import ViewShot, { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { useAuthenticatedMutation, useToken } from "../lib/useAuthenticatedMutation";
import { useAction } from "convex/react";
import {
  generateTripCardId,
  formatShareDates,
  getTripDurationDays,
  getTravelStyle,
} from "../lib/tripCardUtils";
import { useTranslation } from "react-i18next";

// Logo asset (white text on transparent — works on dark backgrounds)
const logoAsset = require("@/assets/images/logo-a-stapr6.png");

// ── Design tokens (all in points, card renders at 360×640, captured at 3x → 1080×1920) ──
const S = 3; // Scale factor
const CARD_W = 1080 / S; // 360pt
const CARD_H = 1920 / S; // 640pt

// Colors — match app theme (Planera yellow + dark bg)
const AMBER = "#FFE500";
const WHITE = "#FFFFFF";
const DARK = "#121212";
const NAVY = "#1A1A1A";
const NAVY_LIGHT = "#2C2C2C";

// Font families
const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const SANS = Platform.select({ ios: "System", default: "sans-serif" });

// Slide types
type SlideKey = "cover" | "deal" | "itinerary" | "activities";

interface TripData {
  _id: Id<"trips">;
  destination: string;
  startDate: number;
  endDate: number;
  budgetTotal?: number;
  travelerCount?: number;
  perPersonBudget?: number;
  interests: string[];
  tripCardId?: string;
  shareCardPhoto?: {
    url: string;
    photographer: string;
    photographerUsername?: string;
  };
  // Multi-slide fields
  tripType?: string;
  dealFlightData?: any;
  itinerary?: any;
  origin?: string;
}

interface PhotoOption {
  url: string;
  thumbnailUrl: string;
  photographer: string;
  photographerUsername?: string;
  downloadLocation?: string;
}

export interface ShareTripCardHandle {
  generateAndShare: () => Promise<void>;
  saveToGallery: () => Promise<void>;
}

interface Props {
  trip: TripData;
  onShareStart?: () => void;
  onShareComplete?: () => void;
  onError?: (error: string) => void;
}

const { width: SCREEN_W } = Dimensions.get("window");
const PREVIEW_CARD_W = SCREEN_W * 0.62;
const PREVIEW_CARD_H = PREVIEW_CARD_W * (1920 / 1080);
const THUMB_SIZE = 56;
const PAGE_W = SCREEN_W; // width per page in carousel
const PREVIEW_SCALE = PREVIEW_CARD_W / CARD_W;

const ShareTripCard = forwardRef<ShareTripCardHandle, Props>(
  ({ trip, onShareStart, onShareComplete, onError }, ref) => {
    const slideRefs = useRef<Record<string, ViewShot | null>>({});
    const [photoData, setPhotoData] = useState(trip.shareCardPhoto);
    const [tripCardId, setTripCardId] = useState(trip.tripCardId);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [photoOptions, setPhotoOptions] = useState<PhotoOption[]>([]);
    const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
    const [loadingPhotos, setLoadingPhotos] = useState(false);
    const [activeSlide, setActiveSlide] = useState(0);
    const { t, i18n } = useTranslation();

    const { token } = useToken();
    const fetchSharePhotosAction = useAction(api.shareCardsAction.fetchShareCardPhotos as any);
    const updateShareCard = useAuthenticatedMutation(api.shareCards.updateShareCardData as any);
    const ensureTripCardIdMut = useAuthenticatedMutation(
      api.shareCards.ensureTripCardId as any
    );

    // ── Derived data ──
    const durationDays = getTripDurationDays(trip.startDate, trip.endDate);
    const travelStyle = getTravelStyle(trip.travelerCount);
    const dateStr = formatShareDates(trip.startDate, trip.endDate);
    const displayPhoto = photoData || trip.shareCardPhoto;
    const subtitle = `${durationDays} ${t("shareCard.days")} · ${travelStyle}`;

    // ── Multi-slide data extraction ──
    const hasDeal = trip.tripType === "deal" && !!(trip.dealFlightData || trip.itinerary?.flights);
    const days: any[] = trip.itinerary?.dayByDayItinerary || [];

    const dealFlight = useMemo(() => {
      const opts = trip.dealFlightData?.options || trip.itinerary?.flights?.options;
      return opts?.[0] || null;
    }, [trip.dealFlightData, trip.itinerary?.flights]);

    const topActivities = useMemo(() => {
      return days
        .flatMap((day: any) => (day.activities || []))
        .filter((a: any) => a.image)
        .slice(0, 4);
    }, [days]);

    const slideKeys = useMemo(() => {
      const keys: SlideKey[] = ["cover"];
      if (hasDeal && dealFlight) keys.push("deal");
      if (days.length > 0) keys.push("itinerary");
      if (topActivities.length >= 2) keys.push("activities");
      return keys;
    }, [hasDeal, dealFlight, days.length, topActivities.length]);

    // ── Handlers ──
    const ensureTripCard = useCallback(async () => {
      let cardId = tripCardId;
      if (!cardId && token) {
        const generated = generateTripCardId(trip.destination, trip.startDate);
        const confirmed = await ensureTripCardIdMut({
          tripId: trip._id,
          tripCardId: generated,
        });
        if (confirmed) {
          cardId = confirmed;
          setTripCardId(confirmed);
        } else {
          const retry = generateTripCardId(trip.destination, trip.startDate);
          const retryConfirmed = await ensureTripCardIdMut({
            tripId: trip._id,
            tripCardId: retry,
          });
          cardId = retryConfirmed || retry;
          setTripCardId(cardId);
        }
      }
      return cardId;
    }, [tripCardId, token, trip._id, trip.destination, trip.startDate]);

    const openPhotoPickerModal = useCallback(async () => {
      setModalVisible(true);
      setActiveSlide(0);
      setLoadingPhotos(true);
      try {
        await ensureTripCard();
        if (photoOptions.length > 0) {
          setLoadingPhotos(false);
          return;
        }
        if (token) {
          const photos = await fetchSharePhotosAction({ token, tripId: trip._id });
          if (photos && photos.length > 0) {
            setPhotoOptions(photos);
            if (trip.shareCardPhoto) {
              const idx = photos.findIndex(
                (p: PhotoOption) => p.url === trip.shareCardPhoto!.url
              );
              setSelectedPhotoIndex(idx >= 0 ? idx : 0);
            }
            const selected = photos[0];
            setPhotoData({
              url: selected.url,
              photographer: selected.photographer,
              photographerUsername: selected.photographerUsername,
            });
          }
        }
      } catch (err) {
        console.error("Error loading photos:", err);
      } finally {
        setLoadingPhotos(false);
      }
    }, [token, trip._id, trip.shareCardPhoto, photoOptions.length, ensureTripCard]);

    const selectPhoto = useCallback((index: number) => {
      setSelectedPhotoIndex(index);
      const photo = photoOptions[index];
      if (photo) {
        setPhotoData({
          url: photo.url,
          photographer: photo.photographer,
          photographerUsername: photo.photographerUsername,
        });
      }
    }, [photoOptions]);

    const captureSlide = useCallback(async (key: string): Promise<string | null> => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const slideRef = slideRefs.current[key];
      if (!slideRef) return null;
      try {
        const uri = await captureRef(slideRef, {
          format: "png",
          quality: 1.0,
          width: 1080,
          height: 1920,
        });
        return uri;
      } catch (err) {
        console.error(`Capture ${key} failed:`, err);
        return null;
      }
    }, []);

    const cacheSelectedPhoto = useCallback(async () => {
      if (!token || !photoData) return;
      const selected = photoOptions[selectedPhotoIndex];
      if (!selected) return;
      try {
        await updateShareCard({
          tripId: trip._id,
          shareCardPhoto: {
            url: photoData.url,
            photographer: photoData.photographer,
            photographerUsername: photoData.photographerUsername || undefined,
          },
        });
      } catch (err) {
        console.error("Failed to cache photo:", err);
      }
    }, [token, photoData, photoOptions, selectedPhotoIndex, trip._id]);

    const doShare = useCallback(async () => {
      try {
        setLoading(true);
        onShareStart?.();
        await cacheSelectedPhoto();

        const currentKey = slideKeys[activeSlide] || "cover";
        const uri = await captureSlide(currentKey);
        if (!uri) {
          onError?.(t("shareCard.generationFailed"));
          return;
        }

        const displayId = tripCardId || trip.tripCardId || "trip";
        const fileName = `planera-${displayId}-${currentKey}.png`;
        const source = new File(uri);
        const dest = new File(Paths.cache, fileName);
        if (dest.exists) dest.delete();
        source.copy(dest);

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(dest.uri, {
            mimeType: "image/png",
            dialogTitle: t("shareCard.shareTrip"),
            UTI: "public.png",
          });
        } else {
          const deepLink = `planera.app/trip/${displayId}`;
          await Share.share({
            message: `${t("tripDetail.checkOutTrip", { destination: trip.destination })}\n${deepLink}`,
          });
        }
        onShareComplete?.();
        setModalVisible(false);
      } catch (err: any) {
        if (err?.message !== "User did not share") {
          console.error("Share failed:", err);
          onError?.(t("shareCard.shareFailed"));
        }
      } finally {
        setLoading(false);
      }
    }, [cacheSelectedPhoto, captureSlide, activeSlide, slideKeys, tripCardId, trip, onShareStart, onShareComplete, onError, t]);

    const doSaveToGallery = useCallback(async () => {
      try {
        setLoading(true);
        onShareStart?.();
        await cacheSelectedPhoto();

        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(t("common.error"), t("shareCard.galleryPermission"));
          return;
        }

        let savedCount = 0;
        for (const key of slideKeys) {
          const uri = await captureSlide(key);
          if (uri) {
            await MediaLibrary.saveToLibraryAsync(uri);
            savedCount++;
          }
        }

        Alert.alert(
          t("common.success"),
          t("shareCard.savedAllToGallery", { count: savedCount })
        );
        onShareComplete?.();
        setModalVisible(false);
      } catch (err) {
        console.error("Save to gallery failed:", err);
        onError?.(t("shareCard.saveFailed"));
      } finally {
        setLoading(false);
      }
    }, [cacheSelectedPhoto, captureSlide, slideKeys, t, onShareStart, onShareComplete, onError]);

    const generateAndShare = useCallback(async () => {
      await openPhotoPickerModal();
    }, [openPhotoPickerModal]);

    const saveToGallery = useCallback(async () => {
      await openPhotoPickerModal();
    }, [openPhotoPickerModal]);

    useImperativeHandle(ref, () => ({
      generateAndShare,
      saveToGallery,
    }));

    // ── Helper: format deal date ──
    const formatDealDate = (dateStr: string) => {
      if (!dateStr) return "";
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const locale = i18n.language === "el" ? "el-GR" : i18n.language === "es" ? "es-ES" : i18n.language === "fr" ? "fr-FR" : i18n.language === "de" ? "de-DE" : i18n.language === "ar" ? "ar-SA" : "en-US";
        return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
      } catch {
        return dateStr;
      }
    };

    // ── Helper: get top activities per day (for itinerary slide) ──
    const itineraryDays = useMemo(() => {
      return days.slice(0, 4).map((day: any) => ({
        day: day.day || 1,
        title: day.title || "",
        activities: (day.activities || []).slice(0, 3).map((a: any) => a.title),
      }));
    }, [days]);

    // ── Render functions: shared between off-screen capture & preview carousel ──
    const renderCoverContent = () => (
      <>
        {displayPhoto ? (
          <Image source={{ uri: displayPhoto.url }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={[NAVY, NAVY_LIGHT, NAVY]} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        )}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.85)"]} locations={[0.35, 0.65, 1]} style={StyleSheet.absoluteFillObject} />
        <View style={styles.logoContainer}>
          <Image source={logoAsset} style={styles.logoImage} contentFit="contain" />
        </View>
        <View style={styles.bottomContent}>
          <Text style={styles.destinationText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>{trip.destination}</Text>
          <View style={styles.accentLine} />
          <Text style={styles.datesText}>{dateStr}</Text>
          <Text style={styles.subtitleText}>{subtitle}</Text>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>planeraai.app</Text>
          </View>
        </View>
        {displayPhoto && (
          <Text style={styles.creditText}>{displayPhoto.photographer} / Unsplash</Text>
        )}
      </>
    );

    const renderDealContent = () => (
      <>
        {displayPhoto ? (
          <Image source={{ uri: displayPhoto.url }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={[NAVY, NAVY_LIGHT, NAVY]} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        )}
        <LinearGradient colors={["rgba(0,0,0,0.75)", "rgba(0,0,0,0.85)", "rgba(0,0,0,0.80)"]} style={StyleSheet.absoluteFillObject} />
        <View style={styles.logoContainer}>
          <Image source={logoAsset} style={styles.logoImage} contentFit="contain" />
        </View>
        <View style={styles.dealContent}>
          <View style={styles.dealRoute}>
            <View style={styles.dealCityBlock}>
              <Text style={styles.dealCityName} numberOfLines={1}>{trip.origin || ""}</Text>
              <Text style={styles.dealCityCode}>{dealFlight?.outbound?.departureAirport || "—"}</Text>
            </View>
            <View style={styles.dealArrowContainer}>
              <View style={styles.dealArrowLine} />
              <Text style={styles.dealArrowIcon}>✈</Text>
              <View style={styles.dealArrowLine} />
            </View>
            <View style={styles.dealCityBlock}>
              <Text style={styles.dealCityCode}>{trip.destination}</Text>
              <Text style={styles.dealCityName} numberOfLines={1}>{dealFlight?.outbound?.arrivalAirport || "—"}</Text>
            </View>
          </View>
          {dealFlight?.outbound && (
            <View style={styles.dealFlightSection}>
              <Text style={styles.dealSectionLabel}>{t("shareCard.outbound").toUpperCase()}</Text>
              <View style={styles.dealFlightRow}>
                <Text style={styles.dealFlightDate}>{formatDealDate(dealFlight.outbound.departureDate || trip.dealFlightData?.outboundDate || new Date(trip.startDate).toISOString())}</Text>
              </View>
              <View style={styles.dealFlightRow}>
                <Text style={styles.dealFlightAirline}>{dealFlight.outbound.airline || ""}</Text>
                {dealFlight.outbound.flightNumber && (
                  <Text style={styles.dealFlightNumber}>{dealFlight.outbound.flightNumber}</Text>
                )}
              </View>
              <View style={styles.dealTimeRow}>
                <Text style={styles.dealTime}>{dealFlight.outbound.departure || ""}</Text>
                <Text style={styles.dealTimeSep}>↓</Text>
                <Text style={styles.dealTime}>{dealFlight.outbound.arrival || ""}</Text>
                {dealFlight.outbound.duration && (
                  <Text style={styles.dealDuration}>{dealFlight.outbound.duration}</Text>
                )}
              </View>
            </View>
          )}
          {dealFlight?.return && (
            <View style={styles.dealFlightSection}>
              <Text style={styles.dealSectionLabel}>{t("shareCard.return").toUpperCase()}</Text>
              <View style={styles.dealFlightRow}>
                <Text style={styles.dealFlightDate}>{formatDealDate(dealFlight.return.departureDate || trip.dealFlightData?.returnDate || new Date(trip.endDate).toISOString())}</Text>
              </View>
              <View style={styles.dealFlightRow}>
                <Text style={styles.dealFlightAirline}>{dealFlight.return.airline || ""}</Text>
                {dealFlight.return.flightNumber && (
                  <Text style={styles.dealFlightNumber}>{dealFlight.return.flightNumber}</Text>
                )}
              </View>
              <View style={styles.dealTimeRow}>
                <Text style={styles.dealTime}>{dealFlight.return.departure || ""}</Text>
                <Text style={styles.dealTimeSep}>↓</Text>
                <Text style={styles.dealTime}>{dealFlight.return.arrival || ""}</Text>
                {dealFlight.return.duration && (
                  <Text style={styles.dealDuration}>{dealFlight.return.duration}</Text>
                )}
              </View>
            </View>
          )}
          <View style={styles.dealPriceBlock}>
            <Text style={styles.dealPrice}>€{Math.round(dealFlight?.pricePerPerson || 0)}</Text>
            <Text style={styles.dealPriceLabel}>{t("shareCard.perPerson")}</Text>
          </View>
          <View style={styles.dealBadge}>
            <Text style={styles.dealBadgeText}>{t("shareCard.lowFareRadar").toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.brandRowAbsolute}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>planeraai.app</Text>
        </View>
        {displayPhoto && (
          <Text style={styles.creditText}>{displayPhoto.photographer} / Unsplash</Text>
        )}
      </>
    );

    // ── Derived: total activities count & top highlight names ──
    const totalActivities = useMemo(() => {
      return days.reduce((sum: number, day: any) => sum + (day.activities?.length || 0), 0);
    }, [days]);

    const topHighlights = useMemo(() => {
      return days
        .flatMap((day: any) => (day.activities || []))
        .map((a: any) => a.title)
        .filter(Boolean)
        .slice(0, 6);
    }, [days]);

    const renderItineraryContent = () => {
      // Build compact day cards: day number + top 2 activities each
      const dayCards = days.slice(0, 5).map((day: any, idx: number) => ({
        dayNum: idx + 1,
        activities: (day.activities || []).slice(0, 2).map((a: any) => a.title).filter(Boolean),
      }));

      return (
        <>
          {displayPhoto ? (
            <Image source={{ uri: displayPhoto.url }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <LinearGradient colors={[NAVY, NAVY_LIGHT, NAVY]} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          )}
          <LinearGradient colors={["rgba(0,0,0,0.80)", "rgba(0,0,0,0.88)", "rgba(0,0,0,0.82)"]} style={StyleSheet.absoluteFillObject} />
          <View style={styles.logoContainer}>
            <Image source={logoAsset} style={styles.logoImage} contentFit="contain" />
          </View>
          <View style={styles.itinContent}>
            <Text style={styles.itinHeader}>{t("shareCard.yourItinerary").toUpperCase()}</Text>
            <Text style={styles.itinSubheader}>{trip.destination}</Text>
            <View style={styles.accentLineCenter} />

            {/* Day-by-day cards */}
            <View style={styles.dayList}>
              {dayCards.map((dc) => (
                <View key={dc.dayNum} style={styles.dayCard}>
                  <View style={styles.dayNumBadge}>
                    <Text style={styles.dayNumText}>{dc.dayNum}</Text>
                  </View>
                  <View style={styles.dayCardBody}>
                    <Text style={styles.dayTitle}>{t("shareCard.day").toUpperCase()} {dc.dayNum}</Text>
                    {dc.activities.length > 0 ? dc.activities.map((title: string, i: number) => (
                      <Text key={i} style={styles.dayActivity} numberOfLines={1}>
                        {title}
                      </Text>
                    )) : (
                      <Text style={styles.dayActivity}>—</Text>
                    )}
                  </View>
                </View>
              ))}
              {days.length > 5 && (
                <Text style={styles.moreDays}>+{days.length - 5} {t("shareCard.moreDays")}</Text>
              )}
            </View>

            {/* Date range at bottom */}
            <Text style={styles.itinDateRange}>{dateStr}</Text>
          </View>
          <View style={styles.brandRowAbsolute}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>planeraai.app</Text>
          </View>
          {displayPhoto && (
            <Text style={styles.creditText}>{displayPhoto.photographer} / Unsplash</Text>
          )}
        </>
      );
    };

    const renderActivitiesContent = () => (
      <>
        {displayPhoto ? (
          <Image source={{ uri: displayPhoto.url }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={["#080E1A", "#101828", "#080E1A"]} style={StyleSheet.absoluteFillObject} />
        )}
        <LinearGradient colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0.80)", "rgba(0,0,0,0.75)"]} style={StyleSheet.absoluteFillObject} />
        <View style={styles.logoContainer}>
          <Image source={logoAsset} style={styles.logoImage} contentFit="contain" />
        </View>
        <View style={styles.actContent}>
          <Text style={styles.actHeader}>{t("shareCard.topExperiences").toUpperCase()}</Text>
          <View style={styles.accentLineCenter} />
          <View style={styles.actGrid}>
            {topActivities.map((activity: any, idx: number) => (
              <View key={idx} style={styles.actCell}>
                <Image source={{ uri: activity.image }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="memory-disk" />
                <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} locations={[0.5, 1]} style={StyleSheet.absoluteFillObject} />
                <Text style={styles.actCellText} numberOfLines={2}>{activity.title}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.brandRowAbsolute}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>planeraai.app</Text>
        </View>
        {displayPhoto && (
          <Text style={styles.creditText}>{displayPhoto.photographer} / Unsplash</Text>
        )}
      </>
    );

    return (
      <>
        {/* ═══ Off-screen slides for capture ═══ */}
        <View style={styles.offscreen} pointerEvents="none">

          {/* ── Slide: COVER ── */}
          <ViewShot
            ref={(r) => { slideRefs.current.cover = r; }}
            style={styles.card}
            options={{ format: "png", quality: 1.0, width: 1080, height: 1920 }}
          >
            {renderCoverContent()}
          </ViewShot>

          {/* ── Slide: FLIGHT DEAL ── */}
          {hasDeal && dealFlight && (
            <ViewShot
              ref={(r) => { slideRefs.current.deal = r; }}
              style={styles.card}
              options={{ format: "png", quality: 1.0, width: 1080, height: 1920 }}
            >
              {renderDealContent()}
            </ViewShot>
          )}

          {/* ── Slide: ITINERARY ── */}
          {days.length > 0 && (
            <ViewShot
              ref={(r) => { slideRefs.current.itinerary = r; }}
              style={styles.card}
              options={{ format: "png", quality: 1.0, width: 1080, height: 1920 }}
            >
              {renderItineraryContent()}
            </ViewShot>
          )}

          {/* ── Slide: TOP ACTIVITIES ── */}
          {topActivities.length >= 2 && (
            <ViewShot
              ref={(r) => { slideRefs.current.activities = r; }}
              style={styles.card}
              options={{ format: "png", quality: 1.0, width: 1080, height: 1920 }}
            >
              {renderActivitiesContent()}
            </ViewShot>
          )}
        </View>

        {/* ═══ Modal ═══ */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t("shareCard.choosePhoto")}</Text>
              <View style={{ width: 36 }} />
            </View>

            {/* ── Slide carousel ── */}
            <View style={styles.previewContainer}>
              <FlatList
                data={slideKeys}
                keyExtractor={(item) => item}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / PAGE_W);
                  setActiveSlide(Math.max(0, Math.min(idx, slideKeys.length - 1)));
                }}
                renderItem={({ item: key }) => (
                  <View style={{ width: PAGE_W, alignItems: "center", justifyContent: "center" }}>
                    <View style={[styles.previewCard, { width: PREVIEW_CARD_W, height: PREVIEW_CARD_H }]}>
                      <View style={[styles.card, { transform: [{ scale: PREVIEW_SCALE }], transformOrigin: "0% 0%" }]}>
                        {key === "cover" && renderCoverContent()}
                        {key === "deal" && dealFlight && renderDealContent()}
                        {key === "itinerary" && renderItineraryContent()}
                        {key === "activities" && renderActivitiesContent()}
                      </View>
                    </View>
                  </View>
                )}
              />

              {/* Page dots */}
              {slideKeys.length > 1 && (
                <View style={styles.pageDots}>
                  {slideKeys.map((key, idx) => (
                    <View key={key} style={[styles.pageDot, idx === activeSlide && styles.pageDotActive]} />
                  ))}
                </View>
              )}
            </View>

            {/* Photo thumbnails */}
            <View style={styles.thumbSection}>
              <Text style={styles.thumbSectionTitle}>{t("shareCard.selectPhoto")}</Text>
                {loadingPhotos ? (
                  <ActivityIndicator size="small" color={AMBER} style={{ marginTop: 16 }} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                    {photoOptions.map((photo, index) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => selectPhoto(index)}
                        style={[styles.thumbWrapper, selectedPhotoIndex === index && styles.thumbSelected]}
                      >
                        <Image source={{ uri: photo.thumbnailUrl }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory-disk" />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>

            {/* Action buttons */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.shareBtn} onPress={doShare} disabled={loading || loadingPhotos}>
                {loading ? (
                  <ActivityIndicator size="small" color={DARK} />
                ) : (
                  <Text style={styles.shareBtnText}>{t("shareCard.shareTrip")}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={doSaveToGallery} disabled={loading || loadingPhotos}>
                <Text style={styles.saveBtnText}>
                  {slideKeys.length > 1
                    ? t("shareCard.saveAllToGallery", { count: slideKeys.length })
                    : t("shareCard.saveToGallery")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }
);

ShareTripCard.displayName = "ShareTripCard";
export default ShareTripCard;

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -9999,
    top: -9999,
    opacity: 1,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  // ── Shared: Logo ──
  logoContainer: {
    position: "absolute",
    top: 54 / S,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
  logoImage: {
    width: 220 / S,
    height: 55 / S,
  },

  // ── Shared: Branding ──
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 36 / S,
  },
  brandRowAbsolute: {
    position: "absolute",
    bottom: 50 / S,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  brandDot: {
    width: 8 / S,
    height: 8 / S,
    borderRadius: 4 / S,
    backgroundColor: AMBER,
    marginRight: 10 / S,
  },
  brandText: {
    fontFamily: SANS,
    fontWeight: "500",
    fontSize: 20 / S,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 1.5 / S,
  },

  // ── Shared: Accent line ──
  accentLine: {
    width: 90 / S,
    height: 3 / S,
    backgroundColor: AMBER,
    marginTop: 22 / S,
    marginBottom: 22 / S,
    borderRadius: 2 / S,
  },
  accentLineCenter: {
    width: 70 / S,
    height: 3 / S,
    backgroundColor: AMBER,
    marginTop: 14 / S,
    marginBottom: 30 / S,
    borderRadius: 2 / S,
    alignSelf: "center",
  },

  // ── Cover slide ──
  bottomContent: {
    position: "absolute",
    bottom: 60 / S,
    left: 50 / S,
    right: 50 / S,
    alignItems: "center",
    zIndex: 2,
  },
  destinationText: {
    fontFamily: SERIF,
    fontWeight: "700",
    fontSize: 84 / S,
    color: WHITE,
    textAlign: "center",
    lineHeight: (84 * 1.15) / S,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 / S },
    textShadowRadius: 6 / S,
  },
  datesText: {
    fontFamily: SANS,
    fontSize: 28 / S,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    letterSpacing: 2 / S,
  },
  subtitleText: {
    fontFamily: SANS,
    fontSize: 22 / S,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    marginTop: 10 / S,
    letterSpacing: 1.5 / S,
  },
  creditText: {
    position: "absolute",
    top: 54 / S,
    right: 16 / S,
    fontFamily: SANS,
    fontSize: 12 / S,
    color: "rgba(255,255,255,0.35)",
    zIndex: 2,
  },

  // ── Deal slide ──
  dealContent: {
    position: "absolute",
    top: 100 / S,
    left: 30 / S,
    right: 30 / S,
    bottom: 60 / S,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  dealRoute: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 36 / S,
    width: "100%",
  },
  dealCityBlock: {
    alignItems: "center",
  },
  dealCityCode: {
    fontFamily: SERIF,
    fontWeight: "800",
    fontSize: 86 / S,
    color: WHITE,
    letterSpacing: 5 / S,
  },
  dealCityName: {
    fontFamily: SANS,
    fontSize: 32 / S,
    color: "rgba(255,255,255,0.5)",
    marginTop: 6 / S,
  },
  dealArrowContainer: {
    flexDirection: "column",
    alignItems: "center",
    marginVertical: 14 / S,
  },
  dealArrowLine: {
    width: 2 / S,
    height: 30 / S,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  dealArrowIcon: {
    fontFamily: SANS,
    fontSize: 56 / S,
    color: AMBER,
    marginVertical: 8 / S,
    transform: [{ rotate: "90deg" }],
  },
  dealFlightSection: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16 / S,
    padding: 28 / S,
    marginBottom: 18 / S,
    alignItems: "center",
  },
  dealSectionLabel: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 28 / S,
    color: AMBER,
    letterSpacing: 4 / S,
    marginBottom: 14 / S,
    textAlign: "center",
  },
  dealFlightRow: {
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 8 / S,
  },
  dealFlightDate: {
    fontFamily: SERIF,
    fontWeight: "600",
    fontSize: 38 / S,
    color: WHITE,
    textAlign: "center",
  },
  dealFlightAirline: {
    fontFamily: SANS,
    fontSize: 30 / S,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
  },
  dealFlightNumber: {
    fontFamily: SANS,
    fontSize: 30 / S,
    color: "rgba(255,255,255,0.4)",
    marginTop: 4 / S,
    textAlign: "center",
  },
  dealTimeRow: {
    flexDirection: "column",
    alignItems: "center",
    marginTop: 6 / S,
  },
  dealTime: {
    fontFamily: SERIF,
    fontWeight: "700",
    fontSize: 50 / S,
    color: WHITE,
    textAlign: "center",
  },
  dealTimeSep: {
    fontFamily: SANS,
    fontSize: 34 / S,
    color: "rgba(255,255,255,0.4)",
    marginVertical: 4 / S,
  },
  dealDuration: {
    fontFamily: SANS,
    fontSize: 28 / S,
    color: "rgba(255,255,255,0.35)",
    marginTop: 6 / S,
    textAlign: "center",
  },
  dealPriceBlock: {
    alignItems: "center",
    marginTop: 30 / S,
    marginBottom: 20 / S,
  },
  dealPrice: {
    fontFamily: SERIF,
    fontWeight: "800",
    fontSize: 140 / S,
    color: AMBER,
  },
  dealPriceLabel: {
    fontFamily: SANS,
    fontSize: 32 / S,
    color: "rgba(255,255,255,0.5)",
    marginTop: 4 / S,
  },
  dealBadge: {
    backgroundColor: "rgba(255,229,0,0.15)",
    paddingHorizontal: 30 / S,
    paddingVertical: 12 / S,
    borderRadius: 24 / S,
    borderWidth: 1.5 / S,
    borderColor: "rgba(255,229,0,0.3)",
  },
  dealBadgeText: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 28 / S,
    color: AMBER,
    letterSpacing: 3 / S,
  },

  // ── Itinerary / Highlights slide ──
  itinContent: {
    position: "absolute",
    top: 110 / S,
    left: 36 / S,
    right: 36 / S,
    bottom: 80 / S,
    zIndex: 2,
    alignItems: "center",
  },
  itinHeader: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 24 / S,
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 5 / S,
    textAlign: "center",
  },
  itinSubheader: {
    fontFamily: SERIF,
    fontWeight: "700",
    fontSize: 48 / S,
    color: WHITE,
    textAlign: "center",
    marginTop: 8 / S,
    marginBottom: 4 / S,
  },
  itinDateRange: {
    fontFamily: SANS,
    fontSize: 22 / S,
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    marginTop: "auto" as any,
  },
  dayList: {
    width: "100%",
    flex: 1,
    justifyContent: "center",
  },
  dayCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14 / S,
    marginBottom: 12 / S,
    paddingVertical: 16 / S,
    paddingHorizontal: 16 / S,
    borderWidth: 1 / S,
    borderColor: "rgba(255,255,255,0.08)",
  },
  dayNumBadge: {
    width: 48 / S,
    height: 48 / S,
    borderRadius: 24 / S,
    backgroundColor: AMBER,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 18 / S,
  },
  dayNumText: {
    fontFamily: SANS,
    fontWeight: "800",
    fontSize: 26 / S,
    color: DARK,
  },
  dayCardBody: {
    flex: 1,
  },
  dayTitle: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 20 / S,
    color: AMBER,
    letterSpacing: 2 / S,
    marginBottom: 4 / S,
  },
  dayActivity: {
    fontFamily: SANS,
    fontSize: 24 / S,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 34 / S,
  },
  moreDays: {
    fontFamily: SANS,
    fontSize: 22 / S,
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    marginTop: 8 / S,
  },

  // ── Activities slide ──
  actContent: {
    position: "absolute",
    top: 130 / S,
    left: 40 / S,
    right: 40 / S,
    bottom: 100 / S,
    zIndex: 2,
  },
  actHeader: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 28 / S,
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 4 / S,
    textAlign: "center",
  },
  actGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10 / S,
  },
  actCell: {
    width: "48.5%",
    height: "48%",
    borderRadius: 14 / S,
    overflow: "hidden",
  },
  actCellText: {
    position: "absolute",
    bottom: 12 / S,
    left: 12 / S,
    right: 12 / S,
    fontFamily: SANS,
    fontWeight: "600",
    fontSize: 20 / S,
    color: WHITE,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 / S },
    textShadowRadius: 4 / S,
  },

  // ── Modal styles ──
  modalContainer: {
    flex: 1,
    backgroundColor: "#111118",
    paddingTop: Platform.OS === "ios" ? 56 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseBtnText: {
    color: WHITE,
    fontSize: 18,
    fontWeight: "600",
  },
  modalTitle: {
    fontFamily: SANS,
    fontSize: 17,
    fontWeight: "600",
    color: WHITE,
  },

  // ── Carousel preview ──
  previewContainer: {
    flex: 1,
    justifyContent: "center",
  },
  previewCard: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  pageDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 12,
    gap: 6,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  pageDotActive: {
    width: 20,
    borderRadius: 3,
    backgroundColor: AMBER,
  },

  // ── Thumbnails ──
  thumbSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
  },
  thumbSectionTitle: {
    fontFamily: SANS,
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  thumbRow: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 4,
  },
  thumbWrapper: {
    width: THUMB_SIZE,
    height: THUMB_SIZE * 1.5,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbSelected: {
    borderColor: AMBER,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },

  // ── Action buttons ──
  modalActions: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
    gap: 10,
  },
  shareBtn: {
    height: 50,
    backgroundColor: AMBER,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  shareBtnText: {
    fontFamily: SANS,
    fontWeight: "700",
    fontSize: 16,
    color: DARK,
  },
  saveBtn: {
    height: 50,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  saveBtnText: {
    fontFamily: SANS,
    fontWeight: "600",
    fontSize: 16,
    color: WHITE,
  },
});
