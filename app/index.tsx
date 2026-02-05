import { Text, View, StyleSheet, Image, TouchableOpacity, ActivityIndicator, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform, StatusBar } from "react-native";
import { useConvexAuth } from "@/lib/auth-components";
import { authClient } from "@/lib/auth-client";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { Redirect, useRouter } from "expo-router";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, LIGHT_COLORS } from "@/lib/ThemeContext";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Fallback colors for when theme is not available (e.g., during initial load)
const COLORS = LIGHT_COLORS;
const ENABLE_GOOGLE = false;

// Component to handle authenticated user redirect based on onboarding status
function AuthenticatedRedirect() {
    const { token } = useToken();
    // @ts-ignore
    const settings = useQuery(api.users.getSettings as any, { token: token || "skip" });

    // Still loading settings from Convex
    if (settings === undefined) {
        console.log("[Index] AuthenticatedRedirect: Loading settings...");
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Loading your profile...</Text>
            </View>
        );
    }

    console.log("[Index] AuthenticatedRedirect: Settings loaded, onboardingCompleted:", settings.onboardingCompleted);

    // If onboarding not completed, redirect to onboarding
    if (!settings.onboardingCompleted) {
        return <Redirect href="/onboarding" />;
    }

    // Otherwise go to tabs
    return <Redirect href="/(tabs)" />;
}

export default function Index() {
    const { colors } = useTheme();
    const { isAuthenticated, isLoading } = useConvexAuth();
    const [currentStep, setCurrentStep] = useState(0); // 0: splash, 1: onboarding, 2: auth
    const [isEmailAuth, setIsEmailAuth] = useState(false);
    const [isSignUp, setIsSignUp] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [oauthLoading, setOauthLoading] = useState<string | null>(null);
    const router = useRouter();

    // Debug log auth state
    useEffect(() => {
        console.log("[Index] Auth state - isAuthenticated:", isAuthenticated, "isLoading:", isLoading);
    }, [isAuthenticated, isLoading]);

    // Add timeout for auth loading
    useEffect(() => {
        const timer = setTimeout(() => {
            if (oauthLoading === "anonymous") {
                console.log("Auth loading timeout - forcing redirect");
                setOauthLoading(null);
            }
        }, 10000);
        return () => clearTimeout(timer);
    }, [oauthLoading]);

    const handleEmailAuth = async () => {
        if (!email || !password || (isSignUp && !name)) {
            Alert.alert("Error", "Please fill in all fields");
            return;
        }

        setLoading(true);
        try {
            if (isSignUp) {
                const result = await authClient.signUp.email({ email, password, name });
                if (result.error) {
                    // Check if user already exists
                    if (result.error.message?.includes("already exists") || result.error.message?.includes("already registered")) {
                        Alert.alert("Account Exists", "An account with this email already exists. Please sign in instead.");
                        setIsSignUp(false);
                    } else {
                        Alert.alert("Error", result.error.message || "Sign up failed");
                    }
                } else {
                    // Sign-up successful - redirect to onboarding after brief delay
                    console.log("[Index] Email Sign-Up successful, redirecting to onboarding...");
                    setTimeout(() => {
                        router.replace("/onboarding");
                    }, 1000);
                }
            } else {
                const result = await authClient.signIn.email({ email, password });
                if (result.error) {
                    // Check if account doesn't exist
                    if (result.error.message?.includes("not found") || result.error.message?.includes("Invalid credentials")) {
                        Alert.alert("Account Not Found", "No account found with this email. Would you like to create one?", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Sign Up", onPress: () => setIsSignUp(true) }
                        ]);
                    } else {
                        Alert.alert("Error", result.error.message || "Sign in failed");
                    }
                } else {
                    // Sign-in successful - redirect after brief delay to let auth state update
                    console.log("[Index] Email Sign-In successful, redirecting...");
                    setTimeout(() => {
                        router.replace("/(tabs)");
                    }, 1000);
                }
            }
        } catch (error: any) {
            Alert.alert("Error", error.message || "Authentication failed");
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setOauthLoading("google");
        try {
            // Use native Google Sign-In on mobile
            const result = await authClient.signIn.google();
            if (result.error) {
                // Don't show error for cancellation
                if (result.error.message !== "Sign-in cancelled") {
                    Alert.alert("Error", result.error.message || "Google sign in failed");
                }
                setOauthLoading(null);
            } else {
                // Success - navigate after a brief delay to let auth state update
                console.log("[Index] Google Sign-In successful, redirecting...");
                setTimeout(() => {
                    router.replace("/(tabs)");
                }, 2000);  // Increased to 2 seconds
            }
        } catch (error: any) {
            Alert.alert("Error", error.message || "Google sign in failed");
            setOauthLoading(null);
        }
    };

    const handleAppleSignIn = async () => {
        // Apple Sign-In only available on iOS
        if (Platform.OS !== "ios") {
            Alert.alert("Not Available", "Apple Sign-In is only available on iOS devices");
            return;
        }
        
        setOauthLoading("apple");
        try {
            // Use native Apple Sign-In
            const result = await authClient.signIn.apple();
            if (result.error) {
                // Don't show error for cancellation
                if (result.error.message !== "Sign-in cancelled") {
                    Alert.alert("Error", result.error.message || "Apple sign in failed");
                }
                setOauthLoading(null);
            } else {
                // Success - wait a bit longer to ensure token is stored
                console.log("[Index] Apple Sign-In successful, waiting before redirecting...");
                setTimeout(() => {
                    console.log("[Index] Now redirecting to main app");
                    router.replace("/(tabs)");
                }, 2000);  // Increased to 2 seconds
            }
        } catch (error: any) {
            Alert.alert("Error", error.message || "Apple sign in failed");
            setOauthLoading(null);
        }
    };

    const handleAnonymousSignIn = async () => {
        setOauthLoading("anonymous");
        try {
            const result = await authClient.signIn.anonymous();
            if (result.error) {
                Alert.alert("Error", result.error.message || "Anonymous sign in failed");
                setOauthLoading(null);
            } else {
                // Success - navigate after a brief delay to let auth state update
                console.log("[Index] Anonymous Sign-In successful, redirecting...");
                setTimeout(() => {
                    router.replace("/onboarding");
                }, 2000);  // Increased to 2 seconds
            }
        } catch (error: any) {
            Alert.alert("Error", error.message || "Anonymous sign in failed");
            setOauthLoading(null);
        }
    };

    const onboardingData = [
        {
            title: "Plan Smarter,\nTravel Further",
            subtitle: "Experience the future of travel planning with our intelligent tools.",
            features: [
                { icon: "help-circle", title: "AI Trip Planner", desc: "Generate personalized itineraries in seconds based on your unique interests." },
                { icon: "git-compare", title: "Multi-City Routing", desc: "Seamlessly connect destinations with the most efficient travel paths." },
                { icon: "star", title: "Smart Recommendations", desc: "Discover hidden gems and top-rated spots curated just for you." },
            ]
        }
    ];

    // Splash Screen
    const renderSplash = () => (
        <View style={styles.splashContainer}>
            <View style={styles.splashContent}>
                <View style={styles.logoContainer}>
                    <View style={styles.logoIconWrapper}>
                        <Image 
                            source={require("@/assets/images/appicon-1024x1024-01-s9s9iw.png")} 
                            style={styles.logoImage}
                        />
                    </View>
                </View>
                <Text style={styles.splashTitle}>PLANERA</Text>
                <Text style={styles.splashSubtitle}>AI-Powered Journeys, tailored{"\n"}just for you.</Text>
            </View>
            
            <View style={styles.splashBottom}>
                <TouchableOpacity 
                    style={styles.getStartedButton}
                    onPress={() => setCurrentStep(1)}
                >
                    <Text style={styles.getStartedText}>Get Started</Text>
                    <Ionicons name="arrow-forward" size={20} color={colors.text} />
                </TouchableOpacity>
                
                <TouchableOpacity onPress={() => setCurrentStep(2)}>
                    <Text style={styles.loginLink}>
                        Already have an account? <Text style={styles.loginLinkBold}>Log in</Text>
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    // Onboarding Screen - Just show features before auth
    const renderOnboarding = () => (
        <View style={styles.onboardingContainer}>
            <Text style={styles.onboardingBrand}>PLANERA</Text>
            
            <View style={styles.onboardingContent}>
                <Text style={styles.onboardingTitle}>{onboardingData[0].title}</Text>
                <Text style={styles.onboardingSubtitle}>{onboardingData[0].subtitle}</Text>
                
                <View style={styles.featuresContainer}>
                    {onboardingData[0].features.map((feature, index) => (
                        <View key={index} style={styles.featureCard}>
                            <View style={styles.featureIconWrapper}>
                                <Ionicons name={feature.icon as any} size={24} color={colors.text} />
                            </View>
                            <View style={styles.featureTextContainer}>
                                <Text style={styles.featureTitle}>{feature.title}</Text>
                                <Text style={styles.featureDesc}>{feature.desc}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            </View>
            
            <View style={styles.onboardingBottom}>
                <TouchableOpacity 
                    style={styles.nextButton}
                    onPress={() => setCurrentStep(2)}
                >
                    <Text style={styles.nextButtonText}>Continue</Text>
                    <Ionicons name="arrow-forward" size={20} color={colors.text} />
                </TouchableOpacity>
            </View>
        </View>
    );

    // Auth Screen
    const renderAuth = () => (
        <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.authKeyboard}
        >
            <ScrollView contentContainerStyle={styles.authScrollContent}>
                
                {/* Hero Image */}
                <View style={styles.authHeroContainer}>
                    <Image 
                        source={require("@/assets/images/logo-a-9d8eag.png")}
                        style={styles.authHeroImageFile}
                        resizeMode="contain"
                    />
                </View>
                
                <Text style={styles.authTitle}>Unlock Smart Travel</Text>
                <Text style={styles.authSubtitle}>Plan complex trips in seconds with AI-powered routing.</Text>
                
                {isEmailAuth ? (
                    <View style={styles.formContainer}>
                        {isSignUp && (
                            <TextInput
                                style={styles.input}
                                placeholder="Full Name"
                                placeholderTextColor={colors.textMuted}
                                value={name}
                                onChangeText={setName}
                                autoCapitalize="words"
                            />
                        )}
                        <TextInput
                            style={styles.input}
                            placeholder="Email"
                            placeholderTextColor={colors.textMuted}
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Password"
                            placeholderTextColor={colors.textMuted}
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />
                        
                        <TouchableOpacity 
                            style={styles.primaryButton} 
                            onPress={handleEmailAuth}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color={colors.text} />
                            ) : (
                                <Text style={styles.primaryButtonText}>
                                    {isSignUp ? "Create Account" : "Sign In"}
                                </Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)} style={styles.switchButton}>
                            <Text style={styles.switchText}>
                                {isSignUp ? "Already have an account? " : "Don't have an account? "}
                                <Text style={styles.switchTextBold}>{isSignUp ? "Sign In" : "Sign Up"}</Text>
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => setIsEmailAuth(false)} style={styles.backButton}>
                            <Ionicons name="arrow-back" size={16} color={colors.textSecondary} />
                            <Text style={styles.backText}>Back to options</Text>
                        </TouchableOpacity>
                    </View>
             ) : (
          <View style={styles.authOptionsContainer}>
                  {ENABLE_GOOGLE && (
  <TouchableOpacity
    style={styles.socialButton}
    onPress={handleGoogleSignIn}
    disabled={oauthLoading !== null}
  >
    {oauthLoading === "google" ? (
      <ActivityIndicator color={colors.text} />
    ) : (
      <>
        <View style={styles.googleIcon}>
          <Text style={styles.googleG}>G</Text>
        </View>
        <Text style={styles.socialButtonText}>Continue with Google</Text>
      </>
    )}
  </TouchableOpacity>
)}


                        {/* Apple Sign-In - Only show on iOS */}
                        {Platform.OS === "ios" && (
                            <TouchableOpacity 
                                style={styles.socialButton} 
                                onPress={handleAppleSignIn}
                                disabled={oauthLoading !== null}
                            >
                                {oauthLoading === "apple" ? (
                                    <ActivityIndicator color={colors.text} />
                                ) : (
                                    <>
                                        <Ionicons name="logo-apple" size={20} color={colors.text} style={styles.socialIcon} />
                                        <Text style={styles.socialButtonText}>Continue with Apple</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity 
                            style={styles.primaryButton} 
                            onPress={() => setIsEmailAuth(true)}
                        >
                            <Ionicons name="mail-outline" size={20} color={colors.text} style={styles.socialIcon} />
                            <Text style={styles.primaryButtonText}>Sign Up with Email</Text>
                        </TouchableOpacity>



                        <TouchableOpacity onPress={() => { setIsEmailAuth(true); setIsSignUp(false); }}>
                            <Text style={styles.memberText}>
                                Already a member? <Text style={styles.memberTextBold}>Log In</Text>
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
                
                <Text style={styles.termsText}>
                    By continuing, you agree to our <Text style={styles.termsLink} onPress={() => router.push("/terms")}>Terms of Service</Text> and{"\n"}<Text style={styles.termsLink} onPress={() => router.push("/privacy")}>Privacy Policy</Text>.
                </Text>
            </ScrollView>
        </KeyboardAvoidingView>
    );

    // Show loading screen while auth state is being determined
    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading...</Text>
            </View>
        );
    }

    // If authenticated, show the redirect logic (checks onboarding status)
    if (isAuthenticated) {
        return <AuthenticatedRedirect />;
    }

    // Not authenticated - show splash/onboarding/auth screens
    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={styles.safeArea}>
                {currentStep === 0 && renderSplash()}
                {currentStep === 1 && renderOnboarding()}
                {currentStep === 2 && renderAuth()}
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    safeArea: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: COLORS.background,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: COLORS.textSecondary,
    },
    
    // Splash Styles
    splashContainer: {
        flex: 1,
        justifyContent: "space-between",
        paddingHorizontal: 24,
        paddingVertical: 40,
    },
    splashContent: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    logoContainer: {
        marginBottom: 24,
    },
    logoIconWrapper: {
        width: 100,
        height: 100,
        borderRadius: 24,
        backgroundColor: COLORS.white,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
        overflow: "hidden",
    },
    logoImage: {
        width: 100,
        height: 100,
        borderRadius: 24,
    },
    logoSparkle: {
        position: "absolute",
        top: 8,
        right: 8,
    },
    splashTitle: {
        fontSize: 36,
        fontWeight: "900",
        color: COLORS.text,
        letterSpacing: 4,
        marginBottom: 16,
    },
    splashSubtitle: {
        fontSize: 16,
        color: COLORS.textSecondary,
        textAlign: "center",
        lineHeight: 24,
    },
    splashBottom: {
        gap: 20,
    },
    getStartedButton: {
        backgroundColor: COLORS.primary,
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    getStartedText: {
        fontSize: 18,
        fontWeight: "700",
        color: COLORS.text,
    },
    loginLink: {
        fontSize: 14,
        color: COLORS.textSecondary,
        textAlign: "center",
    },
    loginLinkBold: {
        fontWeight: "700",
        color: COLORS.text,
    },
    
    // Onboarding Styles
    onboardingContainer: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 20,
    },
    onboardingBrand: {
        fontSize: 14,
        fontWeight: "700",
        color: COLORS.textSecondary,
        letterSpacing: 3,
        textAlign: "center",
        marginBottom: 24,
    },
    onboardingContent: {
        flex: 1,
    },
    onboardingTitle: {
        fontSize: 32,
        fontWeight: "800",
        color: COLORS.text,
        marginBottom: 12,
        lineHeight: 40,
    },
    onboardingSubtitle: {
        fontSize: 16,
        color: COLORS.textSecondary,
        marginBottom: 32,
        lineHeight: 24,
    },
    featuresContainer: {
        gap: 16,
    },
    featureCard: {
        backgroundColor: COLORS.white,
        borderRadius: 16,
        padding: 20,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    featureIconWrapper: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: COLORS.primary,
        justifyContent: "center",
        alignItems: "center",
    },
    featureTextContainer: {
        flex: 1,
    },
    featureTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: COLORS.text,
        marginBottom: 4,
    },
    featureDesc: {
        fontSize: 14,
        color: COLORS.textSecondary,
        lineHeight: 20,
    },
    onboardingBottom: {
        paddingVertical: 24,
        gap: 24,
    },
    dotsContainer: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 8,
    },
    dot: {
        height: 8,
        borderRadius: 4,
    },
    dotActive: {
        width: 24,
        backgroundColor: COLORS.primary,
    },
    dotInactive: {
        width: 8,
        backgroundColor: COLORS.border,
    },
    nextButton: {
        backgroundColor: COLORS.primary,
        paddingVertical: 18,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    nextButtonText: {
        fontSize: 18,
        fontWeight: "700",
        color: COLORS.text,
    },
    
    // Auth Styles
    authKeyboard: {
        flex: 1,
    },
    authScrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 0,
        paddingBottom: 24,
    },
    authBrand: {
        fontSize: 14,
        fontWeight: "700",
        color: COLORS.textSecondary,
        letterSpacing: 3,
        textAlign: "center",
        marginBottom: 24,
    },
    authHeroContainer: {
        marginBottom: 12,
        alignItems: "center",
    },
    authHeroImageFile: {
        width: 280,
        height: 280,
        borderRadius: 20,
    },
    authTitle: {
        fontSize: 28,
        fontWeight: "800",
        color: COLORS.text,
        textAlign: "center",
        marginBottom: 4,
    },
    authSubtitle: {
        fontSize: 16,
        color: COLORS.textSecondary,
        textAlign: "center",
        marginBottom: 20,
        lineHeight: 24,
    },
    authOptionsContainer: {
        gap: 12,
    },
    formContainer: {
        gap: 12,
    },
    input: {
        backgroundColor: COLORS.white,
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 20,
        fontSize: 16,
        color: COLORS.text,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    socialButton: {
        backgroundColor: COLORS.white,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    googleIcon: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: COLORS.white,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    googleG: {
        fontSize: 16,
        fontWeight: "700",
        color: "#4285F4",
    },
    socialIcon: {
        marginRight: 12,
    },
    socialButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: COLORS.text,
    },
    primaryButton: {
        backgroundColor: COLORS.primary,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    primaryButtonText: {
        fontSize: 16,
        fontWeight: "700",
        color: COLORS.text,
    },
    guestButton: {
        backgroundColor: "transparent",
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderStyle: "dashed",
    },
    guestButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: COLORS.textSecondary,
    },
    memberText: {
        fontSize: 14,
        color: COLORS.textSecondary,
        textAlign: "center",
        marginTop: 8,
    },
    memberTextBold: {
        fontWeight: "700",
        color: COLORS.text,
        textDecorationLine: "underline",
    },
    switchButton: {
        alignItems: "center",
        marginTop: 8,
    },
    switchText: {
        color: COLORS.textSecondary,
        fontSize: 14,
    },
    switchTextBold: {
        color: COLORS.text,
        fontWeight: "700",
    },
    backButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 8,
        gap: 6,
    },
    backText: {
        color: COLORS.textSecondary,
        fontSize: 14,
    },
    termsText: {
        color: COLORS.textMuted,
        fontSize: 12,
        textAlign: "center",
        marginTop: 32,
        lineHeight: 18,
    },
    termsLink: {
        color: COLORS.textSecondary,
        textDecorationLine: "underline",
    },
});
