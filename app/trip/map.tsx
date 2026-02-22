import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, StatusBar, ScrollView, Dimensions, Animated } from "react-native";
import MapView, { Marker, Polyline, Callout, PROVIDER_DEFAULT } from "react-native-maps";
import { useQuery } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/ThemeContext";
import { useToken } from "@/lib/useAuthenticatedMutation";
import * as Location from "expo-location";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface GeocodedActivity {
    title: string;
    address: string;
    lat: number;
    lng: number;
    time: string;
    type: string;
    index: number;
}

interface GeocodedSight {
    name: string;
    lat: number;
    lng: number;
    neighborhoodOrArea?: string;
    bestTimeToVisit?: string;
    estDurationHours?: string;
}

interface RouteSegment {
    coordinates: { latitude: number; longitude: number }[];
}

// Fetch walking route between two points using OSRM (free, no API key)
async function fetchWalkingRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): Promise<{ latitude: number; longitude: number }[]> {
    try {
        const url =
            "https://router.project-osrm.org/route/v1/foot/" +
            from.lng + "," + from.lat + ";" + to.lng + "," + to.lat +
            "?overview=full&geometries=geojson";

        const response = await fetch(url);
        const data = await response.json();

        if (data.code === "Ok" && data.routes && data.routes.length > 0) {
            const coords = data.routes[0].geometry.coordinates;
            return coords.map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
        }
    } catch (e) {
        console.error("OSRM route fetch failed:", e);
    }
    // Fallback: straight line
    return [
        { latitude: from.lat, longitude: from.lng },
        { latitude: to.lat, longitude: to.lng },
    ];
}

// Geocode the destination city to get a center point + country code for constraining searches
async function geocodeDestination(
    destination: string
): Promise<{ lat: number; lng: number; countryCode: string } | null> {
    const headers = {
        "User-Agent": "PlaneraApp/1.0 (support@planeraai.app)",
        "Accept-Language": "en",
    };
    try {
        const response = await fetch(
            "https://nominatim.openstreetmap.org/search?format=json&q=" +
            encodeURIComponent(destination) + "&limit=1&addressdetails=1",
            { headers }
        );
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                countryCode: data[0].address?.country_code || "",
            };
        }
    } catch (e) {
        console.error("Destination geocode failed:", e);
    }
    return null;
}

// Haversine distance in km between two points
function haversineDistance(
    lat1: number, lng1: number,
    lat2: number, lng2: number
): number {
    const R = 6371; // km
    const toRad = (deg: number) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Max radius (km) from destination center — results beyond this are discarded
const MAX_DISTANCE_KM = 80;

// Try multiple geocoding strategies
async function geocodeActivity(
    activity: any,
    destination: string,
    index: number,
    destCenter?: { lat: number; lng: number; countryCode: string } | null
): Promise<GeocodedActivity | null> {
    const headers = {
        "User-Agent": "PlaneraApp/1.0 (support@planeraai.app)",
        "Accept-Language": "en",
    };

    // Build a viewbox ±0.5° around destination center (~55 km) to bias results
    let viewboxParam = "";
    let countryParam = "";
    if (destCenter) {
        const delta = 0.5;
        viewboxParam = `&viewbox=${destCenter.lng - delta},${destCenter.lat + delta},${destCenter.lng + delta},${destCenter.lat - delta}&bounded=1`;
        if (destCenter.countryCode) {
            countryParam = `&countrycodes=${destCenter.countryCode}`;
        }
    }

    // Strategy: first try bounded queries, then relax bounded but keep country filter
    const queryStrategies = [
        // 1. Full address + destination (bounded to destination area)
        activity.address ? { q: activity.address + ", " + destination, bounded: true } : null,
        // 2. Title + destination (bounded to destination area)
        { q: activity.title + ", " + destination, bounded: true },
        // 3. Simplified title + destination (bounded)
        { q: activity.title?.split(" ").slice(0, 3).join(" ") + ", " + destination, bounded: true },
        // 4. Title + destination without bounding box but with country filter
        { q: activity.title + ", " + destination, bounded: false },
        // 5. Simplified title + destination — country filter only
        { q: activity.title?.split(" ").slice(0, 3).join(" ") + ", " + destination, bounded: false },
    ].filter(Boolean) as { q: string; bounded: boolean }[];

    for (const strategy of queryStrategies) {
        try {
            let url = "https://nominatim.openstreetmap.org/search?format=json&q=" +
                encodeURIComponent(strategy.q) + "&limit=3";
            // Always add country filter so results stay in the right country
            if (countryParam) url += countryParam;
            // Add viewbox+bounded only for bounded strategies
            if (strategy.bounded && viewboxParam) url += viewboxParam;

            const response = await fetch(url, { headers });
            const data = await response.json();

            if (data && data.length > 0) {
                // Pick the result closest to the destination center
                let best = data[0];
                if (destCenter && data.length > 1) {
                    let bestDist = Infinity;
                    for (const result of data) {
                        const dist = haversineDistance(
                            destCenter.lat, destCenter.lng,
                            parseFloat(result.lat), parseFloat(result.lon)
                        );
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = result;
                        }
                    }
                }

                const resultLat = parseFloat(best.lat);
                const resultLng = parseFloat(best.lon);

                // Validate the result is within MAX_DISTANCE_KM of the destination
                if (destCenter) {
                    const dist = haversineDistance(destCenter.lat, destCenter.lng, resultLat, resultLng);
                    if (dist > MAX_DISTANCE_KM) {
                        // Result is too far from destination, skip it
                        await new Promise(r => setTimeout(r, 1100));
                        continue;
                    }
                }

                return {
                    title: activity.title || "Activity " + (index + 1),
                    address: activity.address || "",
                    lat: resultLat,
                    lng: resultLng,
                    time: activity.startTime || activity.time || "",
                    type: activity.type || "attraction",
                    index,
                };
            }
            // Nominatim rate limit: 1 req/sec
            await new Promise(r => setTimeout(r, 1100));
        } catch (e) {
            console.error("Geocode attempt failed for: " + strategy.q, e);
        }
    }

    return null;
}

function getMarkerIcon(type: string): string {
    switch (type) {
        case "restaurant":
        case "meal":
        case "food":
            return "restaurant";
        case "museum":
        case "gallery":
            return "color-palette";
        case "hotel":
        case "accommodation":
            return "bed";
        case "shopping":
            return "bag-handle";
        case "beach":
            return "sunny";
        case "transport":
        case "transfer":
            return "car";
        default:
            return "location";
    }
}

function getMarkerColor(type: string): string {
    switch (type) {
        case "restaurant":
        case "meal":
        case "food":
            return "#FF6B6B";
        case "museum":
        case "gallery":
            return "#A78BFA";
        case "hotel":
        case "accommodation":
            return "#60A5FA";
        case "shopping":
            return "#F472B6";
        case "beach":
            return "#FBBF24";
        default:
            return "#1A1A1A";
    }
}

export default function TripMap() {
    const { id, day: dayParam } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { token } = useToken();
    const mapRef = useRef<MapView>(null);
    const sightsCacheRef = useRef<Record<string, GeocodedSight[]>>({});
    const [retryCount, setRetryCount] = useState(0);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [locationPermission, setLocationPermission] = useState<boolean | null>(null);

    // @ts-ignore
    const trip = useQuery(token ? (api.trips.get as any) : "skip", token ? { token, tripId: id as Id<"trips"> } : "skip");
    // @ts-ignore
    const topSights = useQuery(id ? (api.sights.getTopSights as any) : "skip", id ? { tripId: id as Id<"trips"> } : "skip");

    const [selectedDay, setSelectedDay] = useState<number>(dayParam ? parseInt(dayParam as string, 10) : 1);
    const [geocodedActivities, setGeocodedActivities] = useState<GeocodedActivity[]>([]);
    const [geocodedSights, setGeocodedSights] = useState<GeocodedSight[]>([]);
    const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
    const [isBuilding, setIsBuilding] = useState(false);
    const [buildPhase, setBuildPhase] = useState<string | null>(null); // floating status text
    const [isLoadingSights, setIsLoadingSights] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const itinerary = trip?.itinerary;
    const days: any[] = itinerary?.dayByDayItinerary || [];
    const currentDay = days.find((d: any) => d.day === selectedDay) || days[0];
    const totalActivities = currentDay?.activities?.length || 0;

    // Request location permission and get user location
    const requestLocation = useCallback(async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") {
                setLocationPermission(false);
                return;
            }
            setLocationPermission(true);
            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
            setUserLocation({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
            });
            // Animate map to user location
            if (mapRef.current) {
                mapRef.current.animateToRegion({
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }, 800);
            }
        } catch (e) {
            console.error("Failed to get location:", e);
            setLocationPermission(false);
        }
    }, []);

    // Geocode activities + fetch walking routes — progressive (pins drop live on map)
    useEffect(() => {
        if (!currentDay?.activities?.length || !trip?.destination) return;

        let cancelled = false;
        setIsBuilding(true);
        setError(null);
        setGeocodedActivities([]);
        setRouteSegments([]);
        setBuildPhase("Finding destination...");

        const geocodeAndRoute = async () => {
            const results: GeocodedActivity[] = [];
            const destination = trip.destination;
            const totalActs = currentDay.activities.length;

            // Phase 0: Geocode the destination to get center + country code
            const destCenter = await geocodeDestination(destination);
            if (destCenter) {
                console.log(`📍 Destination center: ${destCenter.lat}, ${destCenter.lng} (${destCenter.countryCode})`);
                // Fly to destination immediately
                if (mapRef.current) {
                    mapRef.current.animateToRegion({
                        latitude: destCenter.lat,
                        longitude: destCenter.lng,
                        latitudeDelta: 0.06,
                        longitudeDelta: 0.06,
                    }, 600);
                }
            }
            await new Promise(r => setTimeout(r, 1100)); // Rate limit

            // Phase 1: Geocode activities one-by-one — each pin appears immediately
            for (let i = 0; i < totalActs; i++) {
                if (cancelled) return;
                const activity = currentDay.activities[i];
                setBuildPhase(`Placing pin ${i + 1} of ${totalActs}...`);

                if (i > 0) await new Promise(r => setTimeout(r, 1100));

                const result = await geocodeActivity(activity, destination, i, destCenter);
                if (result) {
                    results.push(result);
                    // Push pin onto map immediately
                    setGeocodedActivities([...results]);
                    // Fit map to show all current pins
                    if (mapRef.current) {
                        mapRef.current.fitToCoordinates(
                            results.map(r => ({ latitude: r.lat, longitude: r.lng })),
                            { edgePadding: { top: 120, right: 60, bottom: 250, left: 60 }, animated: true }
                        );
                    }
                }
            }

            if (cancelled) return;

            if (results.length === 0) {
                setError("We couldn't find locations for these activities. The place names may be too specific or unavailable in our map database.");
                setIsBuilding(false);
                setBuildPhase(null);
                return;
            }

            // Phase 2: Draw walking routes one-by-one between consecutive pins
            const totalRoutes = results.length - 1;
            const segments: RouteSegment[] = [];
            for (let i = 0; i < totalRoutes; i++) {
                if (cancelled) return;
                setBuildPhase(`Drawing route ${i + 1} of ${totalRoutes}...`);
                const from = results[i];
                const to = results[i + 1];
                const coordinates = await fetchWalkingRoute(
                    { lat: from.lat, lng: from.lng },
                    { lat: to.lat, lng: to.lng }
                );
                segments.push({ coordinates });
                // Draw route segment immediately
                setRouteSegments([...segments]);
                if (i < totalRoutes - 1) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            if (!cancelled) {
                setBuildPhase("Route complete ✓");
                setIsBuilding(false);
                // Clear the pill after 2 seconds
                setTimeout(() => { if (!cancelled) setBuildPhase(null); }, 2000);
            }
        };

        geocodeAndRoute();
        return () => { cancelled = true; };
    }, [selectedDay, currentDay, trip?.destination, retryCount]);

    // Separate effect: Geocode sights in background, cached by destination
    // Only runs when topSights data arrives — NOT on day switch
    useEffect(() => {
        if (!topSights?.sights?.length || !trip?.destination) return;

        const destination = trip.destination;
        const cacheKey = destination.toLowerCase().trim();

        // Check in-memory cache first — instant restore across day switches
        if (sightsCacheRef.current[cacheKey]?.length > 0) {
            console.log(`🌟 Sight pins restored from cache (${sightsCacheRef.current[cacheKey].length} pins)`);
            setGeocodedSights(sightsCacheRef.current[cacheKey]);
            setIsLoadingSights(false);
            return;
        }

        let cancelled = false;
        setIsLoadingSights(true);

        const geocodeSights = async () => {
            console.log(`🌟 Starting sight geocoding: ${topSights.sights.length} sights available`);

            const sightsToProcess = topSights.sights.slice(0, 10); // Limit to 10 for performance

            // Separate sights with stored coordinates from those needing geocoding
            const sightsWithCoords: GeocodedSight[] = [];
            const sightsNeedingGeocode: { sight: any; index: number }[] = [];

            for (let i = 0; i < sightsToProcess.length; i++) {
                const sight = sightsToProcess[i];
                if (sight.latitude && sight.longitude) {
                    sightsWithCoords.push({
                        name: sight.name,
                        lat: sight.latitude,
                        lng: sight.longitude,
                        neighborhoodOrArea: sight.neighborhoodOrArea,
                        bestTimeToVisit: sight.bestTimeToVisit,
                        estDurationHours: sight.estDurationHours,
                    });
                } else {
                    sightsNeedingGeocode.push({ sight, index: i });
                }
            }

            console.log(`🌟 ${sightsWithCoords.length} sights have stored coords, ${sightsNeedingGeocode.length} need geocoding`);

            // Geocode remaining sights that don't have coordinates
            if (sightsNeedingGeocode.length > 0) {
                const destCenter = await geocodeDestination(destination);
                await new Promise(r => setTimeout(r, 1100));

                for (let i = 0; i < sightsNeedingGeocode.length; i++) {
                    if (cancelled) return;
                    const { sight, index } = sightsNeedingGeocode[i];
                    if (i > 0) await new Promise(r => setTimeout(r, 1100)); // Rate limit
                    const result = await geocodeActivity(
                        { title: sight.name, address: sight.neighborhoodOrArea || "" },
                        destination,
                        index,
                        destCenter
                    );
                    if (result) {
                        sightsWithCoords.push({
                            name: sight.name,
                            lat: result.lat,
                            lng: result.lng,
                            neighborhoodOrArea: sight.neighborhoodOrArea,
                            bestTimeToVisit: sight.bestTimeToVisit,
                            estDurationHours: sight.estDurationHours,
                        });
                    }
                }
            }

            if (!cancelled && sightsWithCoords.length > 0) {
                console.log(`🌟 Sight geocoding complete: ${sightsWithCoords.length} pins — cached`);
                sightsCacheRef.current[cacheKey] = sightsWithCoords;
                setGeocodedSights(sightsWithCoords);
                setIsLoadingSights(false);
            } else if (!cancelled) {
                setIsLoadingSights(false);
            }
        };

        geocodeSights();
        return () => { cancelled = true; };
    }, [topSights, trip?.destination]);

    // Fit map to markers once loaded (activities + sights)
    const fitMapToMarkers = useCallback(() => {
        const allCoords = [
            ...geocodedActivities.map(a => ({ latitude: a.lat, longitude: a.lng })),
            ...geocodedSights.map(s => ({ latitude: s.lat, longitude: s.lng })),
        ];
        if (allCoords.length > 0 && mapRef.current) {
            mapRef.current.fitToCoordinates(allCoords, {
                edgePadding: { top: 80, right: 60, bottom: 200, left: 60 },
                animated: true,
            });
        }
    }, [geocodedActivities, geocodedSights]);

    // Re-fit map when sight pins arrive
    useEffect(() => {
        if (geocodedSights.length > 0 && !isBuilding) {
            fitMapToMarkers();
        }
    }, [geocodedSights, isBuilding]);

    if (!trip) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.fullCenter}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

            {/* Map fills entire screen — route builds live on it */}
            <View style={styles.mapContainer}>
                {error ? (
                    <View style={[styles.errorContainer, { backgroundColor: isDarkMode ? colors.background : "#F5F4EF" }]}>
                        <View style={[styles.errorCard, { backgroundColor: colors.card }]}>
                            <View style={[styles.errorIconWrap, { backgroundColor: "#FEE2E2" }]}>
                                <Ionicons name="location-outline" size={32} color="#EF4444" />
                            </View>
                            <Text style={[styles.errorTitle, { color: colors.text }]}>
                                Location not found
                            </Text>
                            <Text style={[styles.errorBody, { color: colors.textMuted }]}>
                                {error}
                            </Text>
                            <TouchableOpacity
                                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                                onPress={() => setRetryCount(c => c + 1)}
                            >
                                <Ionicons name="refresh" size={18} color="#1A1A1A" />
                                <Text style={styles.retryButtonText}>Try again</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <MapView
                        ref={mapRef}
                        style={styles.map}
                        provider={PROVIDER_DEFAULT}
                        showsUserLocation={locationPermission === true}
                        showsMyLocationButton={false}
                        showsCompass={false}
                        showsScale={false}
                        onMapReady={fitMapToMarkers}
                    >
                        {/* Route polylines */}
                        {routeSegments.map((segment, i) => (
                            <Polyline
                                key={"route-" + i}
                                coordinates={segment.coordinates}
                                strokeColor={isDarkMode ? "#FFE500" : "#1A1A1A"}
                                strokeWidth={3}
                                lineDashPattern={[8, 6]}
                            />
                        ))}

                        {/* Activity markers */}
                        {geocodedActivities.map((a, i) => (
                            <Marker
                                key={"marker-" + i}
                                coordinate={{ latitude: a.lat, longitude: a.lng }}
                                title={(i + 1) + ". " + a.title}
                                description={a.time ? a.time + (a.address ? " · " + a.address : "") : a.address || undefined}
                            >
                                <View style={styles.markerOuter}>
                                    <View style={[styles.markerContainer, { backgroundColor: "#1A1A1A" }]}>
                                        <Text style={[styles.markerText, { color: "#FFFFFF" }]}>{i + 1}</Text>
                                    </View>
                                    <View style={[styles.markerArrow, { borderTopColor: "#1A1A1A" }]} />
                                </View>
                                <Callout tooltip={false}>
                                    <View style={styles.calloutContainer}>
                                        <Text style={styles.calloutTitle}>{a.title}</Text>
                                        {a.time ? <Text style={styles.calloutTime}>{a.time}</Text> : null}
                                        {a.address ? <Text style={styles.calloutAddress}>{a.address}</Text> : null}
                                    </View>
                                </Callout>
                            </Marker>
                        ))}

                        {/* Sight pins (not included in routes) */}
                        {geocodedSights.map((s, i) => (
                            <Marker
                                key={"sight-" + i}
                                coordinate={{ latitude: s.lat, longitude: s.lng }}
                                title={s.name}
                                description={[s.neighborhoodOrArea, s.bestTimeToVisit ? "Best: " + s.bestTimeToVisit : null, s.estDurationHours ? s.estDurationHours + "h" : null].filter(Boolean).join(" · ")}
                            >
                                <View style={styles.markerOuter}>
                                    <View style={[styles.sightMarkerContainer]}>
                                        <Ionicons name="star" size={12} color="#FFFFFF" />
                                    </View>
                                    <View style={[styles.markerArrow, { borderTopColor: "#6366F1" }]} />
                                </View>
                                <Callout tooltip={false}>
                                    <View style={styles.calloutContainer}>
                                        <Text style={styles.calloutTitle}>{s.name}</Text>
                                        {s.neighborhoodOrArea ? <Text style={styles.calloutAddress}>{s.neighborhoodOrArea}</Text> : null}
                                        {s.bestTimeToVisit ? <Text style={styles.calloutTime}>Best time: {s.bestTimeToVisit}</Text> : null}
                                    </View>
                                </Callout>
                            </Marker>
                        ))}
                    </MapView>
                )}
            </View>

            {/* Floating build status pill */}
            {buildPhase && (
                <View style={[styles.buildPill, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}> 
                    {isBuilding && <ActivityIndicator size="small" color={colors.primary} />}
                    {!isBuilding && <Ionicons name="checkmark-circle" size={16} color="#22C55E" />}
                    <Text style={[styles.buildPillText, { color: colors.text }]}>{buildPhase}</Text>
                </View>
            )}

            {/* Locate Me button */}
            {!error && (
                <TouchableOpacity
                    style={[styles.locateButton, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}
                    onPress={requestLocation}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name={locationPermission === true ? "navigate" : "navigate-outline"}
                        size={20}
                        color={locationPermission === true ? colors.primary : colors.text}
                    />
                </TouchableOpacity>
            )}

            {/* Loading sights indicator */}
            {isLoadingSights && !isBuilding && (
                <View style={[styles.sightsLoadingBadge, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}>
                    <ActivityIndicator size="small" color="#6366F1" />
                    <Text style={[styles.sightsLoadingText, { color: colors.textSecondary }]}>Loading sights...</Text>
                </View>
            )}

            {/* Floating Header overlay on top of map */}
            <SafeAreaView edges={["top"]} style={styles.floatingHeaderSafe} pointerEvents="box-none">
                <View style={styles.floatingHeaderRow} pointerEvents="box-none">
                    <TouchableOpacity
                        style={[styles.backButton, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}
                        onPress={() => router.back()}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <View style={[styles.headerPill, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}>
                        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                            {trip.destination}
                        </Text>
                        <View style={styles.headerDot} />
                        <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
                            Day {selectedDay}
                        </Text>
                    </View>
                    <View style={{ width: 44 }} />
                </View>
            </SafeAreaView>

            {/* Bottom Sheet with Day Selector + Activities */}
            {!error && (
                <View style={[styles.bottomSheet, { backgroundColor: isDarkMode ? colors.card : "#FFFFFF" }]}>
                    {/* Drag handle */}
                    <View style={styles.sheetHandle}>
                        <View style={[styles.handleBar, { backgroundColor: colors.border }]} />
                    </View>

                    {/* Day pills */}
                    {days.length > 1 && (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.dayPillRow}
                            style={styles.dayPillScroll}
                        >
                            {days.map((day: any) => {
                                const isActive = day.day === selectedDay;
                                return (
                                    <TouchableOpacity
                                        key={day.day}
                                        style={[
                                            styles.dayPill,
                                            isActive
                                                ? { backgroundColor: "#1A1A1A" }
                                                : { backgroundColor: isDarkMode ? colors.inputBackground : "#F5F4EF" },
                                        ]}
                                        onPress={() => setSelectedDay(day.day)}
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                styles.dayPillText,
                                                { color: isActive ? "#FFFFFF" : colors.textMuted },
                                            ]}
                                        >
                                            Day {day.day}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    )}

                    {/* Activity list */}
                    <ScrollView
                        style={styles.activityList}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.activityListContent}
                    >
                        {geocodedActivities.map((a, i) => {
                            const isLast = i === geocodedActivities.length - 1;
                            return (
                                <View key={i} style={styles.activityRow}>
                                    {/* Timeline */}
                                    <View style={styles.timelineCol}>
                                        <View style={[styles.timelineDot, { backgroundColor: "#1A1A1A" }]}>
                                            <Text style={styles.timelineDotText}>{i + 1}</Text>
                                        </View>
                                        {!isLast && (
                                            <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />
                                        )}
                                    </View>
                                    {/* Content */}
                                    <View style={[styles.activityContent, !isLast && styles.activityContentSpacing]}>
                                        <View style={styles.activityHeader}>
                                            <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={2}>
                                                {a.title}
                                            </Text>
                                            {a.time ? (
                                                <View style={[styles.timeBadge, { backgroundColor: isDarkMode ? colors.inputBackground : "#F5F4EF" }]}>
                                                    <Text style={[styles.timeBadgeText, { color: colors.textSecondary }]}>
                                                        {a.time}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                        {a.address ? (
                                            <Text style={[styles.activityAddress, { color: colors.textMuted }]} numberOfLines={1}>
                                                {a.address}
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>
                            );
                        })}
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    fullCenter: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    // ─── Locate Me Button ───
    locateButton: {
        position: "absolute",
        right: 16,
        top: 110,
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
        zIndex: 10,
    },
    sightsLoadingBadge: {
        position: "absolute",
        right: 16,
        top: 162,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
        zIndex: 10,
        gap: 6,
    },
    sightsLoadingText: {
        fontSize: 12,
        fontWeight: "500",
    },
    // ─── Build status pill ───
    buildPill: {
        position: "absolute",
        top: 110,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 24,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
        zIndex: 20,
        gap: 8,
    },
    buildPillText: {
        fontSize: 14,
        fontWeight: "600",
        letterSpacing: -0.2,
    },
    // ─── Floating Header ───
    floatingHeaderSafe: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    floatingHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: 8,
        gap: 10,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },
    headerPill: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        height: 44,
        borderRadius: 22,
        paddingHorizontal: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: -0.3,
    },
    headerDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#D1D1D6",
        marginHorizontal: 8,
    },
    headerSubtitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    // ─── Map ───
    mapContainer: {
        flex: 1,
    },
    map: {
        flex: 1,
    },
    // ─── Error ───
    errorContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
    },
    errorCard: {
        alignItems: "center",
        padding: 32,
        borderRadius: 24,
        width: "100%",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
        elevation: 3,
    },
    errorIconWrap: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: "700",
        letterSpacing: -0.3,
        marginBottom: 8,
    },
    errorBody: {
        fontSize: 14,
        textAlign: "center",
        lineHeight: 20,
        marginBottom: 20,
    },
    retryButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 14,
    },
    retryButtonText: {
        fontSize: 15,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    // ─── Custom marker ───
    markerOuter: {
        alignItems: "center",
    },
    markerContainer: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2.5,
        borderColor: "white",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 5,
    },
    sightMarkerContainer: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#6366F1",
        borderWidth: 2,
        borderColor: "white",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    markerText: {
        fontSize: 13,
        fontWeight: "800",
    },
    markerArrow: {
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderTopWidth: 7,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        marginTop: -1,
    },
    // ─── Callout ───
    calloutContainer: {
        minWidth: 160,
        maxWidth: 260,
        padding: 12,
    },
    calloutTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 3,
    },
    calloutTime: {
        fontSize: 13,
        fontWeight: "600",
        color: "#D4A017",
        marginTop: 2,
    },
    calloutAddress: {
        fontSize: 12,
        color: "#6B6B6B",
        marginTop: 3,
    },
    // ─── Bottom Sheet ───
    bottomSheet: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "45%",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 8,
        paddingBottom: Platform.OS === "ios" ? 34 : 16,
    },
    sheetHandle: {
        alignItems: "center",
        paddingTop: 10,
        paddingBottom: 4,
    },
    handleBar: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    // ─── Day pills ───
    dayPillScroll: {
        flexGrow: 0,
    },
    dayPillRow: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        gap: 8,
    },
    dayPill: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 12,
    },
    dayPillText: {
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: -0.2,
    },
    // ─── Activity list ───
    activityList: {
        flex: 1,
    },
    activityListContent: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    activityRow: {
        flexDirection: "row",
    },
    timelineCol: {
        width: 32,
        alignItems: "center",
    },
    timelineDot: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 2,
    },
    timelineDotText: {
        fontSize: 12,
        fontWeight: "800",
        color: "#FFFFFF",
    },
    timelineLine: {
        width: 2,
        flex: 1,
        marginVertical: 4,
        borderRadius: 1,
    },
    activityContent: {
        flex: 1,
        marginLeft: 12,
        paddingTop: 2,
    },
    activityContentSpacing: {
        paddingBottom: 16,
    },
    activityHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
    },
    activityTitle: {
        fontSize: 15,
        fontWeight: "600",
        letterSpacing: -0.2,
        flex: 1,
        lineHeight: 20,
    },
    timeBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    timeBadgeText: {
        fontSize: 13,
        fontWeight: "600",
    },
    activityAddress: {
        fontSize: 13,
        marginTop: 3,
        lineHeight: 18,
    },
});
