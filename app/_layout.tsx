// Root Layout - CRITICAL FILE FOR APP STARTUP
// This file MUST have a default export that renders properly

import { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ThemeProvider } from "@/lib/ThemeContext";
import { ConvexNativeAuthProvider } from "@/lib/ConvexAuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { authClient } from "@/lib/auth-client";

// Prevent splash screen from auto-hiding before app is ready
SplashScreen.preventAutoHideAsync();

// Environment validation - safe at module scope (just reads process.env)
function validateEnvironment(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!process.env.EXPO_PUBLIC_CONVEX_URL) {
        errors.push("EXPO_PUBLIC_CONVEX_URL is not set");
    }
    
    if (!process.env.EXPO_PUBLIC_CONVEX_SITE_URL) {
        errors.push("EXPO_PUBLIC_CONVEX_SITE_URL is not set");
    }
    
    return {
        valid: errors.length === 0,
        errors,
    };
}

// Error screen for missing environment
function EnvironmentError({ errors }: { errors: string[] }) {
    return (
        <View style={envStyles.container}>
            <Text style={envStyles.title}>Configuration Error</Text>
            <Text style={envStyles.subtitle}>
                The app is missing required configuration:
            </Text>
            {errors.map((error, index) => (
                <Text key={index} style={envStyles.error}>
                    • {error}
                </Text>
            ))}
            <Text style={envStyles.hint}>
                Please check your environment variables.
            </Text>
        </View>
    );
}

const envStyles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        backgroundColor: "#FAF9F6",
    },
    title: {
        fontSize: 24,
        fontWeight: "bold",
        color: "#1a1a1a",
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 16,
        color: "#666",
        marginBottom: 16,
        textAlign: "center",
    },
    error: {
        fontSize: 14,
        color: "#d32f2f",
        marginBottom: 8,
    },
    hint: {
        fontSize: 14,
        color: "#666",
        marginTop: 16,
        textAlign: "center",
    },
});

// Loading screen component - matches splash background to prevent flash
function LoadingScreen() {
    return (
        <View style={{ flex: 1, backgroundColor: "#FAF9F6" }} />
    );
}

// Inner app component that handles initialization
function AppContent() {
    const [envCheck, setEnvCheck] = useState<{ valid: boolean; errors: string[] } | null>(null);
    const [convex, setConvex] = useState<ConvexReactClient | null>(null);
    const [initError, setInitError] = useState<string | null>(null);
    const [appReady, setAppReady] = useState(false);
    const initRef = useRef(false);

    useEffect(() => {
        // Prevent double initialization in strict mode
        if (initRef.current) return;
        initRef.current = true;
        
        if (__DEV__) {
            console.log("[BOOT] RootLayout initializing...");
        }
        
        // Validate environment
        const result = validateEnvironment();
        setEnvCheck(result);
        
        if (!result.valid) {
            if (__DEV__) {
                console.error("[BOOT] Environment validation failed:", result.errors);
            }
            setAppReady(true);
            return;
        }

        // Initialize auth client FIRST and WAIT for completion
        (async () => {
            try {
                console.log("[BOOT] Initializing auth client...");
                await authClient.init();
                console.log("[BOOT] Auth client initialized - token loaded from SecureStore");
                
                // CRITICAL: Create Convex client AFTER auth is initialized
                // This ensures the token is available when fetchAccessToken is called
                try {
                    const client = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
                        unsavedChangesWarning: false,
                    });
                    setConvex(client);
                    if (__DEV__) {
                        console.log("[BOOT] Convex client created successfully after auth init");
                    }
                } catch (error) {
                    console.error("[BOOT] Failed to create Convex client:", error);
                    setInitError(error instanceof Error ? error.message : "Unknown error");
                }
            } catch (error) {
                console.error("[BOOT] Failed to initialize auth client:", error);
                setInitError("Auth initialization failed");
            } finally {
                setAppReady(true);
            }
        })();
    }, []);

    // Hide splash screen once app is ready
    useEffect(() => {
        if (appReady) {
            SplashScreen.hideAsync();
        }
    }, [appReady]);

    // Show loading while checking environment
    if (envCheck === null || (envCheck.valid && convex === null && !initError)) {
        return <LoadingScreen />;
    }

    // Show error if environment is invalid
    if (!envCheck.valid) {
        return <EnvironmentError errors={envCheck.errors} />;
    }

    // Show error if Convex client failed to create
    if (initError || !convex) {
        return <EnvironmentError errors={[initError || "Failed to initialize app"]} />;
    }

    // Render app with providers
    return (
        <ConvexNativeAuthProvider client={convex}>
            <ThemeProvider>
                <Stack screenOptions={{ headerShown: false }} />
            </ThemeProvider>
        </ConvexNativeAuthProvider>
    );
}

// CRITICAL: Default export is required for Expo Router
export default function RootLayout() {
    return (
        <ErrorBoundary>
            <AppContent />
        </ErrorBoundary>
    );
}
