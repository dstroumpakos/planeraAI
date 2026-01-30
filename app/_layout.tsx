// Root Layout - CRITICAL FILE FOR APP STARTUP
// This file MUST have a default export that renders properly

import { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { ConvexReactClient } from "convex/react";
import { Stack } from "expo-router";
import { ThemeProvider } from "@/lib/ThemeContext";
import { ConvexNativeAuthProvider } from "@/lib/ConvexAuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
        backgroundColor: "#FFF8E7",
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

// Loading screen component
function LoadingScreen() {
    return (
        <View style={{ flex: 1, backgroundColor: "#FFF8E7", justifyContent: "center", alignItems: "center" }}>
            <Text style={{ color: "#666", fontSize: 16 }}>Loading...</Text>
        </View>
    );
}

// Inner app component that handles initialization
function AppContent() {
    const [envCheck, setEnvCheck] = useState<{ valid: boolean; errors: string[] } | null>(null);
    const [convex, setConvex] = useState<ConvexReactClient | null>(null);
    const [initError, setInitError] = useState<string | null>(null);
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
            return;
        }
        
        // Create Convex client inside useEffect (after mount)
        try {
            const client = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
                unsavedChangesWarning: false,
            });
            setConvex(client);
            if (__DEV__) {
                console.log("[BOOT] Convex client created successfully");
            }
        } catch (error) {
            console.error("[BOOT] Failed to create Convex client:", error);
            setInitError(error instanceof Error ? error.message : "Unknown error");
        }
    }, []);

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
