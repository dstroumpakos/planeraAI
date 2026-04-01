import { useEffect, useRef } from "react";
import * as Location from "expo-location";
import {
    scheduleNearbyActivityNotification,
    scheduleNextActivityReminder,
    cancelAllScheduledNotifications,
    getDistanceMeters,
} from "./useNotifications";

interface TripActivity {
    title: string;
    time?: string;
    startTime?: string;
    address?: string;
    type?: string;
    description?: string;
    travelFromPrevious?: {
        walkingMinutes?: number;
        distanceKm?: number;
    };
}

interface TripDay {
    day: number;
    title?: string;
    activities?: TripActivity[];
}

/**
 * Geocode an activity title/address using Nominatim.
 * Returns null if geocoding fails.
 */
async function geocodeActivity(
    activity: TripActivity,
    destination: string
): Promise<{ lat: number; lng: number } | null> {
    const queries = [
        activity.address ? `${activity.address}, ${destination}` : null,
        `${activity.title}, ${destination}`,
        activity.title,
    ].filter(Boolean);

    for (const query of queries) {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query!)}&limit=1`,
                { headers: { "User-Agent": "PlaneraAI/1.0" } }
            );
            const data = await res.json();
            if (data?.[0]) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                };
            }
        } catch {
            // Try next query
        }
    }
    return null;
}

/**
 * Hook that provides Phase 3 location-based notifications for an active trip.
 * 
 * - Schedules local "next activity" reminders 30 min before each activity today
 * - Watches user location and alerts when near an activity (within 300m)
 * - Reports arrival/departure status to the server so cron notifications are gated
 * 
 * Only activates when the trip includes today's date.
 */
export function useLocationNotifications(
    trip: {
        _id?: string;
        destination: string;
        startDate: number;
        endDate: number;
        itinerary?: { dayByDayItinerary?: TripDay[] };
    } | null | undefined,
    enabled: boolean = true,
    onLocationStatus?: (atDestination: boolean, coords?: { latitude: number; longitude: number }) => void,
) {
    const notifiedActivities = useRef(new Set<string>());
    const locationSub = useRef<Location.LocationSubscription | null>(null);
    const geocodedRef = useRef<Array<{ title: string; lat: number; lng: number; time?: string; description?: string }>>([]);

    useEffect(() => {
        if (!trip || !enabled) return;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        // Check if trip is active today
        const tripStart = trip.startDate;
        const tripEnd = trip.endDate;
        if (todayStart < tripStart || todayStart > tripEnd) return;

        // Calculate which day of the trip we're on (1-based)
        const dayIndex = Math.floor((todayStart - tripStart) / (24 * 60 * 60 * 1000));
        const days = trip.itinerary?.dayByDayItinerary;
        if (!days || !days[dayIndex]) return;

        const todayActivities = days[dayIndex].activities || [];
        if (todayActivities.length === 0) return;

        let cancelled = false;

        async function setup() {
            // 0. Check if the user is actually at the destination (within 50 km)
            //    Only send local trip notifications when the device is physically there.
            const { status: locStatus } = await Location.getForegroundPermissionsAsync();
            if (locStatus !== "granted") {
                console.log("[LocationNotif] No location permission — skipping destination check");
                return;
            }

            let userLocation: Location.LocationObject | null = null;
            try {
                userLocation = await Location.getLastKnownPositionAsync();
                if (!userLocation) {
                    userLocation = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Low,
                    });
                }
            } catch (e) {
                console.log("[LocationNotif] Could not get user location:", e);
                return;
            }

            if (!userLocation) {
                console.log("[LocationNotif] No user location available — skipping");
                return;
            }

            // Geocode the destination to get its center coordinates
            const destCoords = await geocodeActivity(
                { title: trip!.destination },
                trip!.destination
            );

            if (!destCoords) {
                console.log("[LocationNotif] Could not geocode destination — skipping");
                return;
            }

            const distanceToDestination = getDistanceMeters(
                userLocation.coords.latitude,
                userLocation.coords.longitude,
                destCoords.lat,
                destCoords.lng
            );

            const MAX_DESTINATION_RADIUS_M = 50_000; // 50 km
            if (distanceToDestination > MAX_DESTINATION_RADIUS_M) {
                console.log(
                    `[LocationNotif] User is ${Math.round(distanceToDestination / 1000)} km from ${trip!.destination} — too far, skipping notifications`
                );
                // Report to server: user is NOT at destination
                onLocationStatus?.(false, {
                    latitude: userLocation.coords.latitude,
                    longitude: userLocation.coords.longitude,
                });
                return;
            }

            console.log(
                `[LocationNotif] User is ${Math.round(distanceToDestination / 1000)} km from ${trip!.destination} — activating notifications`
            );

            // Report to server: user IS at destination
            onLocationStatus?.(true, {
                latitude: userLocation.coords.latitude,
                longitude: userLocation.coords.longitude,
            });

            // 1. Schedule time-based "next activity" reminders
            for (const activity of todayActivities) {
                if (cancelled) return;
                const time = activity.startTime || activity.time;
                if (!time) continue;

                // Convert time formats like "9:00 AM" or "09:00" to 24h
                const time24 = convertTo24h(time);
                if (!time24) continue;

                await scheduleNextActivityReminder(
                    {
                        title: activity.title || "Activity",
                        time: time24,
                        walkingMinutes: activity.travelFromPrevious?.walkingMinutes,
                    },
                    30 // 30 minutes before
                );
            }

            // 2. Geocode activities for proximity detection
            const geocoded: typeof geocodedRef.current = [];
            for (const activity of todayActivities) {
                if (cancelled) return;
                const coords = await geocodeActivity(activity, trip!.destination);
                if (coords) {
                    geocoded.push({
                        title: activity.title || "Activity",
                        lat: coords.lat,
                        lng: coords.lng,
                        time: activity.startTime || activity.time,
                        description: activity.description,
                    });
                }
                // Respect Nominatim rate limit
                await new Promise((r) => setTimeout(r, 1100));
            }
            geocodedRef.current = geocoded;

            if (cancelled || geocoded.length === 0) return;

            // 3. Start foreground location watching for proximity alerts
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status !== "granted") return;

            locationSub.current = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.Balanced,
                    timeInterval: 60000, // Check every 60 seconds
                    distanceInterval: 100, // Or when moved 100m
                },
                (location) => {
                    const { latitude, longitude } = location.coords;

                    for (const act of geocodedRef.current) {
                        // Skip if already notified
                        if (notifiedActivities.current.has(act.title)) continue;

                        const distance = getDistanceMeters(latitude, longitude, act.lat, act.lng);
                        if (distance <= 300) {
                            notifiedActivities.current.add(act.title);
                            scheduleNearbyActivityNotification({
                                title: act.title,
                                lat: act.lat,
                                lng: act.lng,
                                description: act.description,
                                time: act.time,
                            });
                        }
                    }
                }
            );
        }

        setup();

        return () => {
            cancelled = true;
            if (locationSub.current) {
                locationSub.current.remove();
                locationSub.current = null;
            }
            cancelAllScheduledNotifications();
        };
    }, [trip?.startDate, trip?.endDate, trip?.destination, enabled]);
}

/**
 * Convert various time formats to 24h "HH:MM" format.
 * Handles: "9:00 AM", "09:00", "2:30 PM", "14:30"
 */
function convertTo24h(time: string): string | null {
    if (!time) return null;

    // Already 24h format "HH:MM"
    const match24 = time.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        return `${match24[1].padStart(2, "0")}:${match24[2]}`;
    }

    // 12h format "H:MM AM/PM"
    const match12 = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
        let hours = parseInt(match12[1]);
        const minutes = match12[2];
        const period = match12[3].toUpperCase();

        if (period === "PM" && hours !== 12) hours += 12;
        if (period === "AM" && hours === 12) hours = 0;

        return `${hours.toString().padStart(2, "0")}:${minutes}`;
    }

    return null;
}
