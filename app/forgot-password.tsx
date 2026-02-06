import React, { useState, useEffect, useRef } from "react";
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme, LIGHT_COLORS } from "@/lib/ThemeContext";

// Fallback colors
const COLORS = LIGHT_COLORS;

type Step = "email" | "verify" | "newPassword";

export default function ForgotPasswordScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    
    // Actions
    const requestCode = useAction(api.passwordReset.requestPasswordResetCode);
    const verifyCode = useAction(api.passwordReset.verifyPasswordResetCode);
    const confirmReset = useAction(api.passwordReset.confirmPasswordReset);
    
    // State
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    
    // Cooldown state for resend
    const [cooldown, setCooldown] = useState(0);
    const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    
    // Code input refs for auto-focus
    const codeInputRef = useRef<TextInput>(null);
    
    // Start cooldown timer
    const startCooldown = (seconds: number = 60) => {
        setCooldown(seconds);
        if (cooldownRef.current) {
            clearInterval(cooldownRef.current);
        }
        cooldownRef.current = setInterval(() => {
            setCooldown(prev => {
                if (prev <= 1) {
                    if (cooldownRef.current) {
                        clearInterval(cooldownRef.current);
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };
    
    // Cleanup cooldown timer
    useEffect(() => {
        return () => {
            if (cooldownRef.current) {
                clearInterval(cooldownRef.current);
            }
        };
    }, []);
    
    // Handle send code
    const handleSendCode = async () => {
        if (!email.trim()) {
            setError("Please enter your email address.");
            return;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            setError("Please enter a valid email address.");
            return;
        }
        
        setLoading(true);
        setError("");
        
        try {
            const result = await requestCode({ email: email.trim() });
            
            if (result.ok) {
                setSuccessMessage("If an account exists for this email, we sent a verification code.");
                setStep("verify");
                startCooldown(60);
                // Focus code input after transition
                setTimeout(() => {
                    codeInputRef.current?.focus();
                }, 100);
            } else {
                setError(result.message || "Please try again later.");
            }
        } catch (err: any) {
            console.error("[ForgotPassword] Error sending code:", err);
            setError("An error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };
    
    // Handle verify code
    const handleVerifyCode = async () => {
        if (!code.trim() || code.trim().length !== 6) {
            setError("Please enter the 6-digit code.");
            return;
        }
        
        setLoading(true);
        setError("");
        
        try {
            const result = await verifyCode({ 
                email: email.trim(), 
                code: code.trim() 
            });
            
            if (result.success) {
                setSuccessMessage("");
                setStep("newPassword");
            } else {
                setError(result.error || "Invalid code. Please try again.");
            }
        } catch (err: any) {
            console.error("[ForgotPassword] Error verifying code:", err);
            setError("An error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };
    
    // Handle resend code
    const handleResendCode = async () => {
        if (cooldown > 0) return;
        
        setLoading(true);
        setError("");
        
        try {
            const result = await requestCode({ email: email.trim() });
            
            if (result.ok) {
                setSuccessMessage("A new code has been sent to your email.");
                setCode("");
                startCooldown(60);
            } else {
                setError(result.message || "Please try again later.");
            }
        } catch (err: any) {
            console.error("[ForgotPassword] Error resending code:", err);
            setError("An error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };
    
    // Handle set new password
    const handleSetPassword = async () => {
        if (!newPassword || !confirmPassword) {
            setError("Please fill in both password fields.");
            return;
        }
        
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        
        setLoading(true);
        setError("");
        
        try {
            const result = await confirmReset({
                email: email.trim(),
                code: code.trim(),
                newPassword,
            });
            
            if (result.success) {
                Alert.alert(
                    "Password Reset Successful",
                    "Your password has been updated. Please sign in with your new password.",
                    [
                        {
                            text: "Sign In",
                            onPress: () => {
                                console.log("[ForgotPassword] Navigating to login screen...");
                                router.replace("/");
                            },
                        },
                    ],
                    { cancelable: false }
                );
                // Also navigate after a short delay as fallback
                setTimeout(() => {
                    router.replace("/");
                }, 3000);
            } else {
                setError(result.error || "Failed to reset password. Please try again.");
            }
        } catch (err: any) {
            console.error("[ForgotPassword] Error setting password:", err);
            setError("An error occurred. Please try again.");
        } finally {
            setLoading(false);
        }
    };
    
    // Go back to previous step
    const handleBack = () => {
        setError("");
        setSuccessMessage("");
        
        if (step === "verify") {
            setStep("email");
            setCode("");
        } else if (step === "newPassword") {
            setStep("verify");
            setNewPassword("");
            setConfirmPassword("");
        } else {
            router.back();
        }
    };
    
    // Render step indicator
    const renderStepIndicator = () => (
        <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, step === "email" && styles.stepDotActive]} />
            <View style={[styles.stepLine, step !== "email" && styles.stepLineActive]} />
            <View style={[styles.stepDot, step === "verify" && styles.stepDotActive]} />
            <View style={[styles.stepLine, step === "newPassword" && styles.stepLineActive]} />
            <View style={[styles.stepDot, step === "newPassword" && styles.stepDotActive]} />
        </View>
    );
    
    // Render email step
    const renderEmailStep = () => (
        <View style={styles.stepContent}>
            <View style={styles.iconContainer}>
                <Ionicons name="mail-outline" size={48} color={colors.primary} />
            </View>
            
            <Text style={[styles.title, { color: colors.text }]}>Forgot Password?</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Enter your email address and we'll send you a code to reset your password.
            </Text>
            
            <TextInput
                style={[styles.input, { 
                    backgroundColor: colors.card, 
                    borderColor: colors.border,
                    color: colors.text 
                }]}
                placeholder="Email address"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoFocus
                editable={!loading}
            />
            
            <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={handleSendCode}
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color={colors.text} />
                ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.text }]}>Send Code</Text>
                )}
            </TouchableOpacity>
        </View>
    );
    
    // Render verify step
    const renderVerifyStep = () => (
        <View style={styles.stepContent}>
            <View style={styles.iconContainer}>
                <Ionicons name="keypad-outline" size={48} color={colors.primary} />
            </View>
            
            <Text style={[styles.title, { color: colors.text }]}>Enter Code</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                We sent a 6-digit code to {email}
            </Text>
            
            {successMessage && (
                <View style={[styles.successBox, { backgroundColor: `${colors.primary}15` }]}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    <Text style={[styles.successText, { color: colors.primary }]}>{successMessage}</Text>
                </View>
            )}
            
            <TextInput
                ref={codeInputRef}
                style={[styles.codeInput, { 
                    backgroundColor: colors.card, 
                    borderColor: colors.border,
                    color: colors.text 
                }]}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
                value={code}
                onChangeText={(text) => setCode(text.replace(/[^0-9]/g, "").slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
            />
            
            <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={handleVerifyCode}
                disabled={loading || code.length !== 6}
            >
                {loading ? (
                    <ActivityIndicator color={colors.text} />
                ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.text }]}>Verify Code</Text>
                )}
            </TouchableOpacity>
            
            <TouchableOpacity
                style={styles.resendButton}
                onPress={handleResendCode}
                disabled={cooldown > 0 || loading}
            >
                <Text style={[
                    styles.resendText, 
                    { color: cooldown > 0 ? colors.textMuted : colors.primary }
                ]}>
                    {cooldown > 0 
                        ? `Resend code in ${cooldown}s` 
                        : "Resend code"}
                </Text>
            </TouchableOpacity>
        </View>
    );
    
    // Render new password step
    const renderNewPasswordStep = () => (
        <View style={styles.stepContent}>
            <View style={styles.iconContainer}>
                <Ionicons name="lock-closed-outline" size={48} color={colors.primary} />
            </View>
            
            <Text style={[styles.title, { color: colors.text }]}>Set New Password</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Create a strong password with at least 8 characters.
            </Text>
            
            <TextInput
                style={[styles.input, { 
                    backgroundColor: colors.card, 
                    borderColor: colors.border,
                    color: colors.text 
                }]}
                placeholder="New password"
                placeholderTextColor={colors.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoFocus
                editable={!loading}
            />
            
            <TextInput
                style={[styles.input, { 
                    backgroundColor: colors.card, 
                    borderColor: colors.border,
                    color: colors.text 
                }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                editable={!loading}
            />
            
            <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={handleSetPassword}
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color={colors.text} />
                ) : (
                    <Text style={[styles.primaryButtonText, { color: colors.text }]}>Set New Password</Text>
                )}
            </TouchableOpacity>
        </View>
    );
    
    return (
        <>
            <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <KeyboardAvoidingView
                    style={styles.keyboardView}
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.headerTitle, { color: colors.text }]}>Reset Password</Text>
                        <View style={{ width: 40 }} />
                    </View>
                    
                    {renderStepIndicator()}
                    
                    <ScrollView 
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Error message */}
                        {error && (
                            <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                                <Ionicons name="alert-circle" size={20} color="#DC2626" />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        )}
                        
                        {/* Step content */}
                        {step === "email" && renderEmailStep()}
                        {step === "verify" && renderVerifyStep()}
                        {step === "newPassword" && renderNewPasswordStep()}
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    backButton: {
        width: 40,
        height: 40,
        justifyContent: "center",
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: "600",
    },
    stepIndicator: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 48,
        marginBottom: 24,
    },
    stepDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: COLORS.border,
    },
    stepDotActive: {
        backgroundColor: COLORS.primary,
    },
    stepLine: {
        flex: 1,
        height: 2,
        backgroundColor: COLORS.border,
        marginHorizontal: 4,
    },
    stepLineActive: {
        backgroundColor: COLORS.primary,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 24,
        paddingBottom: 40,
    },
    stepContent: {
        alignItems: "center",
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: `${COLORS.primary}15`,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: "700",
        textAlign: "center",
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 15,
        textAlign: "center",
        lineHeight: 22,
        marginBottom: 32,
    },
    input: {
        width: "100%",
        height: 52,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        marginBottom: 16,
    },
    codeInput: {
        width: "100%",
        height: 64,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 32,
        fontWeight: "700",
        textAlign: "center",
        letterSpacing: 12,
        marginBottom: 16,
    },
    primaryButton: {
        width: "100%",
        height: 52,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
    },
    primaryButtonText: {
        fontSize: 17,
        fontWeight: "600",
    },
    resendButton: {
        marginTop: 20,
        padding: 12,
    },
    resendText: {
        fontSize: 15,
        fontWeight: "500",
    },
    errorBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    errorText: {
        flex: 1,
        fontSize: 14,
        color: "#DC2626",
    },
    successBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        width: "100%",
    },
    successText: {
        flex: 1,
        fontSize: 14,
    },
});
