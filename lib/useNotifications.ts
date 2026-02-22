import { useEffect, useRef, useState } from "react";
import { Platform, AppState, Alert } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useRouter } from "expo-router";

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

/**
 * Register for push notifications and return the Expo push token.
 * Returns null if permissions are denied or device is a simulator.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
    // Push notifications don't work on simulators
    if (!Device.isDevice) {
        console.log("[Notifications] Not a physical device, skipping push registration");
        return null;
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request if not already granted — show explanation first
    if (existingStatus !== "granted") {
        // Show a pre-permission alert explaining why we need notifications
        const userAccepted = await new Promise<boolean>((resolve) => {
            Alert.alert(
                "Stay in the Loop",
                "Planera sends you helpful reminders before your trip (countdown, daily briefing) and alerts when you're near a planned activity. We'll never spam you.",
                [
                    { text: "Not Now", style: "cancel", onPress: () => resolve(false) },
                    { text: "Enable", onPress: () => resolve(true) },
                ]
            );
        });

        if (!userAccepted) {
            console.log("[Notifications] User declined pre-permission prompt");
            return null;
        }

        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== "granted") {
        console.log("[Notifications] Permission not granted");
        return null;
    }

    // Get Expo push token
    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) {
            console.warn("[Notifications] No EAS project ID found");
            return null;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId,
        });

        console.log("[Notifications] Push token:", tokenData.data);

        // Android requires notification channel
        if (Platform.OS === "android") {
            await Notifications.setNotificationChannelAsync("default", {
                name: "Default",
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: "#FFE500",
            });

            await Notifications.setNotificationChannelAsync("trip-reminders", {
                name: "Trip Reminders",
                description: "Countdown and daily briefing notifications for your trips",
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: "#FFE500",
            });

            await Notifications.setNotificationChannelAsync("nearby", {
                name: "Nearby Places",
                description: "Notifications when you're near interesting places on your trip",
                importance: Notifications.AndroidImportance.DEFAULT,
            });
        }

        return tokenData.data;
    } catch (error) {
        console.error("[Notifications] Failed to get push token:", error);
        return null;
    }
}

/**
 * Hook that manages push notification registration and listeners.
 * Should be used once at the root of the authenticated app.
 */
export function useNotifications() {
    const router = useRouter();
    const { token } = useToken();
    const registerToken = useMutation((api as any).notifications.registerPushToken);
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const notificationListener = useRef<Notifications.EventSubscription | null>(null);
    const responseListener = useRef<Notifications.EventSubscription | null>(null);

    useEffect(() => {
        if (!token || token === "skip") return;

        // Register for push notifications
        registerForPushNotificationsAsync().then(async (pushToken) => {
            if (pushToken) {
                setExpoPushToken(pushToken);
                try {
                    await registerToken({
                        token,
                        pushToken,
                        platform: Platform.OS,
                        deviceName: Device.deviceName || undefined,
                    });
                    console.log("[Notifications] Token registered with backend");
                } catch (e) {
                    console.error("[Notifications] Failed to register token:", e);
                }
            }
        });

        // Listener for notifications received while app is in foreground
        notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
            console.log("[Notifications] Received in foreground:", notification.request.content.title);
        });

        // Listener for when user taps on a notification
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            const data = response.notification.request.content.data;
            console.log("[Notifications] User tapped notification:", data);

            // Navigate based on notification data
            if (data?.screen === "trip" && data?.tripId) {
                router.push(`/trip/${data.tripId}` as any);
            } else if (data?.screen === "create-trip") {
                router.push("/create-trip" as any);
            }
        });

        return () => {
            if (notificationListener.current) {
                notificationListener.current.remove();
            }
            if (responseListener.current) {
                responseListener.current.remove();
            }
        };
    }, [token]);

    return { expoPushToken };
}

// ─── Phase 3: Location-based local notifications ───

interface NearbyActivity {
    title: string;
    lat: number;
    lng: number;
    description?: string;
    time?: string;
    type?: string;
}

/**
 * Schedule a local notification for when the user is near an activity.
 * Uses distance-based checks rather than OS geofencing for simplicity.
 */
export async function scheduleNearbyActivityNotification(
    activity: NearbyActivity,
    distanceMeters: number = 300
) {
    // Schedule an immediate local notification
    await Notifications.scheduleNotificationAsync({
        content: {
            title: `You're near ${activity.title}! 📍`,
            body: activity.description
                ? `${activity.description}`
                : `This stop is on your itinerary${activity.time ? " at " + activity.time : ""}. Enjoy!`,
            data: { type: "nearby", activityTitle: activity.title },
            sound: "default",
            ...(Platform.OS === "android" && { channelId: "nearby" }),
        },
        trigger: null, // Immediate
    });
}

/**
 * Schedule a "next activity" reminder as a local notification.
 */
export async function scheduleNextActivityReminder(
    activity: { title: string; time: string; walkingMinutes?: number },
    minutesBefore: number = 30
) {
    const [hours, minutes] = activity.time.split(":").map(Number);
    if (isNaN(hours) || isNaN(minutes)) return;

    const now = new Date();
    const activityTime = new Date();
    activityTime.setHours(hours, minutes, 0, 0);

    // Calculate notification time (minutesBefore the activity)
    const notifTime = new Date(activityTime.getTime() - minutesBefore * 60 * 1000);

    // Only schedule if it's in the future
    if (notifTime.getTime() <= now.getTime()) return;

    const secondsUntil = Math.floor((notifTime.getTime() - now.getTime()) / 1000);

    const walkingText = activity.walkingMinutes
        ? ` It's about a ${activity.walkingMinutes} min walk from here.`
        : "";

    await Notifications.scheduleNotificationAsync({
        content: {
            title: `${activity.title} in ${minutesBefore} min 🚶`,
            body: `Your next stop starts at ${activity.time}.${walkingText}`,
            data: { type: "next_activity", activityTitle: activity.title },
            sound: "default",
            ...(Platform.OS === "android" && { channelId: "trip-reminders" }),
        },
        trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: secondsUntil,
        },
    });
}

/**
 * Cancel all scheduled local notifications (e.g., when leaving trip view).
 */
export async function cancelAllScheduledNotifications() {
    await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get the distance in meters between two lat/lng points (Haversine formula).
 */
export function getDistanceMeters(
    lat1: number, lng1: number,
    lat2: number, lng2: number
): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
