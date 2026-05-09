import { useEffect, useRef, useState } from "react";
import { Platform, AppState, Alert } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useMutation, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useRouter } from "expo-router";
import i18n from "@/lib/i18n";

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
                i18n.t('settings.pushNotifications.permissionTitle'),
                i18n.t('settings.pushNotifications.permissionBody'),
                [
                    { text: i18n.t('settings.pushNotifications.notNow'), style: "cancel", onPress: () => resolve(false) },
                    { text: i18n.t('settings.pushNotifications.enable'), onPress: () => resolve(true) },
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
    const convex = useConvex();
    const registerToken = useMutation((api as any).notifications.registerPushToken);
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const notificationListener = useRef<Notifications.EventSubscription | null>(null);
    const responseListener = useRef<Notifications.EventSubscription | null>(null);

    useEffect(() => {
        if (!token || token === "skip") return;

        // Handle a notification tap → route the user to the right screen.
        // For deal pushes we fetch the live deal so the user lands on the
        // deal-trip screen with the flight already selected (locked card).
        const handleNotificationTap = async (data: any) => {
            console.log("[Notifications] User tapped notification:", data);
            try {
                // Fire-and-forget tap analytics for deal broadcasts
                if (data?.broadcastId && token) {
                    convex
                        .mutation((api as any).lowFareRadar.trackBroadcastTap, {
                            token,
                            broadcastId: data.broadcastId,
                        })
                        .catch((err: any) => console.warn("[Notifications] trackBroadcastTap failed:", err));
                }

                if (data?.screen === "trip" && data?.tripId) {
                    router.push(`/trip/${data.tripId}` as any);
                    return;
                }
                if (data?.screen === "create-trip") {
                    router.push("/create-trip" as any);
                    return;
                }
                if (data?.screen === "deal-trip" && data?.dealId) {
                    // Fetch the deal so we can pre-fill the locked flight card
                    const deal: any = await convex
                        .query((api as any).lowFareRadar.get, { id: data.dealId })
                        .catch(() => null);
                    if (!deal) {
                        // Deal removed/expired — fall back to home so user isn't stuck
                        router.push("/(tabs)" as any);
                        return;
                    }
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
                    } as any);
                }
            } catch (err) {
                console.error("[Notifications] Failed to handle tap:", err);
            }
        };

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

        // Cold start: if the app was launched FROM a notification tap, replay it
        // (the response listener doesn't fire for the launch notification).
        Notifications.getLastNotificationResponseAsync().then((response) => {
            if (response?.notification?.request?.content?.data) {
                handleNotificationTap(response.notification.request.content.data);
            }
        });

        // Listener for notifications received while app is in foreground
        notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
            console.log("[Notifications] Received in foreground:", notification.request.content.title);
        });

        // Listener for when user taps on a notification (warm/background)
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            handleNotificationTap(response.notification.request.content.data);
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
            title: i18n.t('settings.pushNotifications.nearbyTitle', { title: activity.title }),
            body: activity.description
                ? `${activity.description}`
                : i18n.t('settings.pushNotifications.nearbyBody', { time: activity.time || '' }),
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
        ? ` ${i18n.t('settings.pushNotifications.walkingTime', { minutes: activity.walkingMinutes })}`
        : "";

    await Notifications.scheduleNotificationAsync({
        content: {
            title: i18n.t('settings.pushNotifications.nextActivityTitle', { title: activity.title, minutes: minutesBefore }),
            body: `${i18n.t('settings.pushNotifications.nextActivityBody', { time: activity.time })}${walkingText}`,
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
