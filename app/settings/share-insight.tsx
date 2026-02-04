import React, { useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Alert,
    Platform,
    StatusBar,
    KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";
import { Id } from "@/convex/_generated/dataModel";

const INSIGHT_CATEGORIES = [
    { id: "food", label: "Food & Drink", icon: "restaurant", description: "Restaurants, cafes, local cuisine" },
    { id: "transport", label: "Transport", icon: "bus", description: "Getting around the city" },
    { id: "neighborhoods", label: "Neighborhoods", icon: "map", description: "Best areas to explore" },
    { id: "timing", label: "Best Time", icon: "time", description: "When to visit places" },
    { id: "hidden_gem", label: "Hidden Gems", icon: "diamond", description: "Off-the-beaten-path spots" },
    { id: "avoid", label: "What to Avoid", icon: "warning", description: "Tourist traps & scams" },
    { id: "other", label: "Other", icon: "information-circle", description: "General tips" },
];

interface CompletedTrip {
    _id: Id<"trips">;
    destination: string;
    startDate: number;
    endDate: number;
    travelers: number;
}

export default function ShareInsightPage() {
    const router = useRouter();
    const { token } = useToken();
    const { colors, isDarkMode } = useTheme();
    
    const completedTrips: CompletedTrip[] | undefined = useQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api as any).insights.getCompletedTrips,
        token ? { token } : "skip"
    );
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createInsight = useMutation((api as any).insights.create);
    
    const [step, setStep] = useState<"trip" | "category" | "content">("trip");
    const [selectedTrip, setSelectedTrip] = useState<CompletedTrip | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [content, setContent] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
        });
    };

    const handleSelectTrip = (trip: CompletedTrip) => {
        setSelectedTrip(trip);
        setStep("category");
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const handleSelectCategory = (categoryId: string) => {
        setSelectedCategory(categoryId);
        setStep("content");
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const handleBack = () => {
        if (step === "content") {
            setStep("category");
        } else if (step === "category") {
            setStep("trip");
        } else {
            router.back();
        }
    };

    const handleSubmit = async () => {
        if (!selectedTrip || !selectedCategory || !content.trim()) {
            Alert.alert("Missing Information", "Please complete all fields before submitting.");
            return;
        }

        if (content.trim().length < 20) {
            Alert.alert("Too Short", "Please write at least 20 characters to help other travelers.");
            return;
        }

        setIsSubmitting(true);

        try {
            await createInsight({
                destination: selectedTrip.destination,
                content: content.trim(),
                category: selectedCategory as any,
                verified: true,
            });
            
            if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            
            Alert.alert(
                "Thank You! 🎉",
                "Your insight has been submitted and will help other travelers discover amazing experiences.",
                [{ text: "Done", onPress: () => router.back() }]
            );
        } catch (error) {
            console.error(error);
            Alert.alert("Error", "Failed to share insight. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const getStepProgress = () => {
        if (step === "trip") return 1;
        if (step === "category") return 2;
        return 3;
    };

    const styles = createStyles(colors, isDarkMode);

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent />
            <SafeAreaView style={styles.container} edges={['top']}>
                <KeyboardAvoidingView 
                    style={{ flex: 1 }} 
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                            <Ionicons name="chevron-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <View style={styles.headerCenter}>
                            <Text style={styles.headerTitle}>Share Insight</Text>
                            <Text style={styles.headerSubtitle}>Step {getStepProgress()} of 3</Text>
                        </View>
                        <View style={{ width: 40 }} />
                    </View>

                    {/* Progress Bar */}
                    <View style={styles.progressContainer}>
                        <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${(getStepProgress() / 3) * 100}%` }]} />
                        </View>
                    </View>

                    <ScrollView 
                        style={styles.content} 
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Step 1: Select Trip */}
                        {step === "trip" && (
                            <>
                                <View style={styles.stepHeader}>
                                    <View style={[styles.stepIconContainer, { backgroundColor: colors.primary }]}>
                                        <Ionicons name="airplane" size={28} color={colors.text} />
                                    </View>
                                    <Text style={styles.stepTitle}>Select Your Trip</Text>
                                    <Text style={styles.stepSubtitle}>
                                        Choose a completed trip to share your experience
                                    </Text>
                                </View>

                                {completedTrips && completedTrips.length > 0 ? (
                                    <View style={styles.tripsList}>
                                        {completedTrips.map((trip: CompletedTrip) => (
                                            <TouchableOpacity
                                                key={trip._id}
                                                style={styles.tripCard}
                                                onPress={() => handleSelectTrip(trip)}
                                                activeOpacity={0.7}
                                            >
                                                <View style={styles.tripCardContent}>
                                                    <View style={styles.tripIconContainer}>
                                                        <Ionicons name="location" size={22} color={colors.primary} />
                                                    </View>
                                                    <View style={styles.tripInfo}>
                                                        <Text style={styles.tripDestination}>{trip.destination}</Text>
                                                        <Text style={styles.tripDates}>
                                                            {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                                                        </Text>
                                                        <View style={styles.tripMeta}>
                                                            <Ionicons name="people" size={14} color={colors.textMuted} />
                                                            <Text style={styles.tripMetaText}>
                                                                {trip.travelers} traveler{trip.travelers !== 1 ? 's' : ''}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : (
                                    <View style={styles.emptyState}>
                                        <Ionicons name="airplane-outline" size={64} color={colors.textMuted} />
                                        <Text style={styles.emptyTitle}>No Completed Trips</Text>
                                        <Text style={styles.emptySubtitle}>
                                            Complete a trip first to share your travel insights with others.
                                        </Text>
                                    </View>
                                )}
                            </>
                        )}

                        {/* Step 2: Select Category */}
                        {step === "category" && (
                            <>
                                <View style={styles.stepHeader}>
                                    <View style={[styles.stepIconContainer, { backgroundColor: colors.primary }]}>
                                        <Ionicons name="grid" size={28} color={colors.text} />
                                    </View>
                                    <Text style={styles.stepTitle}>Choose a Category</Text>
                                    <Text style={styles.stepSubtitle}>
                                        What type of insight are you sharing about {selectedTrip?.destination}?
                                    </Text>
                                </View>

                                <View style={styles.categoriesGrid}>
                                    {INSIGHT_CATEGORIES.map((category) => (
                                        <TouchableOpacity
                                            key={category.id}
                                            style={[
                                                styles.categoryCard,
                                                selectedCategory === category.id && styles.categoryCardSelected,
                                            ]}
                                            onPress={() => handleSelectCategory(category.id)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={[
                                                styles.categoryIconContainer,
                                                selectedCategory === category.id && styles.categoryIconSelected,
                                            ]}>
                                                <Ionicons 
                                                    name={category.icon as any} 
                                                    size={24} 
                                                    color={selectedCategory === category.id ? colors.text : colors.primary} 
                                                />
                                            </View>
                                            <Text style={[
                                                styles.categoryLabel,
                                                selectedCategory === category.id && styles.categoryLabelSelected,
                                            ]}>
                                                {category.label}
                                            </Text>
                                            <Text style={styles.categoryDescription}>{category.description}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </>
                        )}

                        {/* Step 3: Write Content */}
                        {step === "content" && (
                            <>
                                <View style={styles.stepHeader}>
                                    <View style={[styles.stepIconContainer, { backgroundColor: colors.primary }]}>
                                        <Ionicons name="create" size={28} color={colors.text} />
                                    </View>
                                    <Text style={styles.stepTitle}>Share Your Insight</Text>
                                    <Text style={styles.stepSubtitle}>
                                        {INSIGHT_CATEGORIES.find(c => c.id === selectedCategory)?.label} tip for {selectedTrip?.destination}
                                    </Text>
                                </View>

                                <View style={styles.contentForm}>
                                    <View style={styles.selectedInfo}>
                                        <View style={styles.selectedInfoItem}>
                                            <Ionicons name="location" size={16} color={colors.primary} />
                                            <Text style={styles.selectedInfoText}>{selectedTrip?.destination}</Text>
                                        </View>
                                        <View style={styles.selectedInfoItem}>
                                            <Ionicons 
                                                name={INSIGHT_CATEGORIES.find(c => c.id === selectedCategory)?.icon as any} 
                                                size={16} 
                                                color={colors.primary} 
                                            />
                                            <Text style={styles.selectedInfoText}>
                                                {INSIGHT_CATEGORIES.find(c => c.id === selectedCategory)?.label}
                                            </Text>
                                        </View>
                                    </View>

                                    <Text style={styles.inputLabel}>Your Experience & Tips</Text>
                                    <TextInput
                                        style={styles.textArea}
                                        placeholder={`Share what you learned about ${INSIGHT_CATEGORIES.find(c => c.id === selectedCategory)?.label.toLowerCase()} in ${selectedTrip?.destination}...\n\nExample: "The best time to visit the main market is early morning around 7am - you'll avoid crowds and get the freshest produce!"`}
                                        placeholderTextColor={colors.textMuted}
                                        value={content}
                                        onChangeText={setContent}
                                        multiline
                                        numberOfLines={8}
                                        textAlignVertical="top"
                                    />
                                    <Text style={styles.charCount}>
                                        {content.length} characters {content.length < 20 && "(minimum 20)"}
                                    </Text>

                                    <View style={styles.tipsBox}>
                                        <Ionicons name="bulb" size={20} color={colors.primary} />
                                        <Text style={styles.tipsText}>
                                            Great insights are specific, actionable, and help travelers avoid mistakes or discover hidden gems!
                                        </Text>
                                    </View>
                                </View>
                            </>
                        )}
                    </ScrollView>

                    {/* Bottom Button */}
                    {step === "content" && (
                        <View style={styles.bottomBar}>
                            <TouchableOpacity
                                style={[
                                    styles.submitButton,
                                    (!content.trim() || content.trim().length < 20 || isSubmitting) && styles.submitButtonDisabled,
                                ]}
                                onPress={handleSubmit}
                                disabled={!content.trim() || content.trim().length < 20 || isSubmitting}
                            >
                                {isSubmitting ? (
                                    <Text style={styles.submitButtonText}>Submitting...</Text>
                                ) : (
                                    <>
                                        <Ionicons name="paper-plane" size={20} color={colors.text} />
                                        <Text style={styles.submitButtonText}>Share Insight</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </KeyboardAvoidingView>
            </SafeAreaView>
        </>
    );
}

const createStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backButton: {
        width: 40,
        height: 40,
        justifyContent: "center",
        alignItems: "center",
    },
    headerCenter: {
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: "600",
        color: colors.text,
    },
    headerSubtitle: {
        fontSize: 12,
        color: colors.textMuted,
        marginTop: 2,
    },
    progressContainer: {
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    progressTrack: {
        height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        backgroundColor: colors.primary,
        borderRadius: 2,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 100,
    },
    stepHeader: {
        alignItems: "center",
        marginBottom: 32,
    },
    stepIconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 16,
    },
    stepTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: colors.text,
        marginBottom: 8,
    },
    stepSubtitle: {
        fontSize: 15,
        color: colors.textMuted,
        textAlign: "center",
        lineHeight: 22,
    },
    // Trip List Styles
    tripsList: {
        gap: 12,
    },
    tripCard: {
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
    },
    tripCardContent: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
    },
    tripIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.15)' : '#FFF8E1',
        justifyContent: "center",
        alignItems: "center",
        marginRight: 14,
    },
    tripInfo: {
        flex: 1,
    },
    tripDestination: {
        fontSize: 17,
        fontWeight: "600",
        color: colors.text,
        marginBottom: 4,
    },
    tripDates: {
        fontSize: 14,
        color: colors.textMuted,
        marginBottom: 4,
    },
    tripMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    tripMetaText: {
        fontSize: 13,
        color: colors.textMuted,
    },
    // Category Grid Styles
    categoriesGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
    },
    categoryCard: {
        width: "47%",
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        alignItems: "center",
    },
    categoryCardSelected: {
        borderColor: colors.primary,
        borderWidth: 2,
        backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.1)' : '#FFFEF0',
    },
    categoryIconContainer: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.15)' : '#FFF8E1',
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 12,
    },
    categoryIconSelected: {
        backgroundColor: colors.primary,
    },
    categoryLabel: {
        fontSize: 15,
        fontWeight: "600",
        color: colors.text,
        marginBottom: 4,
        textAlign: "center",
    },
    categoryLabelSelected: {
        color: colors.primary,
    },
    categoryDescription: {
        fontSize: 12,
        color: colors.textMuted,
        textAlign: "center",
    },
    // Content Form Styles
    contentForm: {
        gap: 16,
    },
    selectedInfo: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 8,
    },
    selectedInfoItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.15)' : '#FFF8E1',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    selectedInfoText: {
        fontSize: 14,
        fontWeight: "500",
        color: colors.text,
    },
    inputLabel: {
        fontSize: 16,
        fontWeight: "600",
        color: colors.text,
        marginBottom: 8,
    },
    textArea: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        padding: 16,
        fontSize: 16,
        color: colors.text,
        minHeight: 180,
        lineHeight: 24,
    },
    charCount: {
        fontSize: 13,
        color: colors.textMuted,
        textAlign: "right",
    },
    tipsBox: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.1)' : '#FFFEF5',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : '#FFF3CD',
    },
    tipsText: {
        flex: 1,
        fontSize: 14,
        color: colors.textMuted,
        lineHeight: 20,
    },
    // Empty State Styles
    emptyState: {
        alignItems: "center",
        paddingVertical: 40,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: "600",
        color: colors.text,
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 15,
        color: colors.textMuted,
        textAlign: "center",
        lineHeight: 22,
    },
    // Bottom Bar Styles
    bottomBar: {
        padding: 20,
        paddingBottom: 34,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
    },
    submitButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor: colors.primary,
        paddingVertical: 16,
        borderRadius: 16,
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        fontSize: 17,
        fontWeight: "600",
        color: colors.text,
    },
});
