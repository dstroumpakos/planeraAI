import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useDestinationImage } from "@/lib/useImages";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";

// Destination highlights data
const DESTINATION_HIGHLIGHTS: Record<string, { emoji: string; highlights: string[]; bestFor: string[]; bestTime: string }> = {
    "Paris": {
        emoji: "🗼",
        highlights: ["Eiffel Tower", "Louvre Museum", "Champs-Élysées", "Notre-Dame"],
        bestFor: ["Romance", "Art & Culture", "Food & Wine"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "Tokyo": {
        emoji: "🏯",
        highlights: ["Shibuya Crossing", "Senso-ji Temple", "Mount Fuji", "Akihabara"],
        bestFor: ["Culture", "Food", "Technology", "Shopping"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "New York": {
        emoji: "🗽",
        highlights: ["Times Square", "Central Park", "Statue of Liberty", "Broadway"],
        bestFor: ["Entertainment", "Shopping", "Food", "Art"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "London": {
        emoji: "🎡",
        highlights: ["Big Ben", "Tower Bridge", "British Museum", "Hyde Park"],
        bestFor: ["History", "Theatre", "Shopping", "Pubs"],
        bestTime: "May - Sep"
    },
    "Rome": {
        emoji: "🏛️",
        highlights: ["Colosseum", "Vatican City", "Trevi Fountain", "Pantheon"],
        bestFor: ["History", "Art", "Food", "Architecture"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Barcelona": {
        emoji: "⛪",
        highlights: ["Sagrada Familia", "Park Güell", "La Rambla", "Gothic Quarter"],
        bestFor: ["Architecture", "Beach", "Nightlife", "Food"],
        bestTime: "May - Jun, Sep - Oct"
    },
    "Dubai": {
        emoji: "🏙️",
        highlights: ["Burj Khalifa", "Dubai Mall", "Palm Jumeirah", "Desert Safari"],
        bestFor: ["Luxury", "Shopping", "Adventure", "Architecture"],
        bestTime: "Nov - Mar"
    },
    "Bali": {
        emoji: "🌴",
        highlights: ["Ubud Rice Terraces", "Uluwatu Temple", "Seminyak Beach", "Mount Batur"],
        bestFor: ["Relaxation", "Spirituality", "Nature", "Surfing"],
        bestTime: "Apr - Oct"
    },
    "Amsterdam": {
        emoji: "🚲",
        highlights: ["Anne Frank House", "Van Gogh Museum", "Canal Cruise", "Vondelpark"],
        bestFor: ["Art", "Cycling", "History", "Nightlife"],
        bestTime: "Apr - May, Sep - Nov"
    },
    "Sydney": {
        emoji: "🌉",
        highlights: ["Sydney Opera House", "Harbour Bridge", "Bondi Beach", "Taronga Zoo"],
        bestFor: ["Beach", "Wildlife", "Adventure", "Food"],
        bestTime: "Sep - Nov, Mar - May"
    },
};

const DEFAULT_HIGHLIGHTS = {
    emoji: "✈️",
    highlights: ["Local attractions", "Cultural sites", "Local cuisine", "Hidden gems"],
    bestFor: ["Adventure", "Culture", "Relaxation"],
    bestTime: "Check local weather"
};

export default function DestinationPreviewScreen() {
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { destination } = useLocalSearchParams<{ destination: string }>();
    const { image, loading } = useDestinationImage(destination);
    const trackDownload = useAction(api.images.trackUnsplashDownload);
    
    const avgBudget = parseFloat((useLocalSearchParams() as any).avgBudget) || 0;
    const avgRating = parseFloat((useLocalSearchParams() as any).avgRating) || 0;
    const tripCount = parseInt((useLocalSearchParams() as any).count) || 0;

    const destinationKey = Object.keys(DESTINATION_HIGHLIGHTS).find(
        key => destination.toLowerCase().includes(key.toLowerCase())
    );
    const destinationData = destinationKey 
        ? DESTINATION_HIGHLIGHTS[destinationKey] 
        : DEFAULT_HIGHLIGHTS;

    const handleCreateTrip = async () => {
        if (image?.downloadLocation) {
            try {
                await trackDownload({ downloadLocation: image.downloadLocation });
            } catch (error) {
                console.error("Error tracking download:", error);
            }
        }
        router.push({
            pathname: "/create-trip",
            params: { prefilledDestination: destination }
        });
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.heroSection}>
                {loading ? (
                    <View style={[styles.heroBackground, { backgroundColor: "#1A1A2E" }]}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : image ? (
                    <View style={styles.heroImageWrapper}>
                        <ImageWithAttribution
                            imageUrl={image.url}
                            photographerName={image.photographer}
                            photographerUrl={image.photographerUrl}
                            downloadLocation={image.downloadLocation}
                            onDownload={() => {
                                if (image.downloadLocation) {
                                    trackDownload({ downloadLocation: image.downloadLocation }).catch(console.error);
                                }
                            }}
                        />
                    </View>
                ) : (
                    <View style={[styles.heroBackground, { backgroundColor: "#1A1A2E" }]}>
                        <Text style={styles.heroEmoji}>{destinationData.emoji}</Text>
                    </View>
                )}
                <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={styles.heroGradient} />
                
                <SafeAreaView style={styles.headerOverlay}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                </SafeAreaView>

                <View style={styles.heroContent}>
                    <Text style={styles.heroTitle}>{destination}</Text>
                    <View style={styles.heroStats}>
                        <View style={styles.statItem}>
                            <Ionicons name="star" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>{avgRating.toFixed(1)}</Text>
                            <Text style={styles.statLabel}>rating</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Ionicons name="people" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>{tripCount}</Text>
                            <Text style={styles.statLabel}>trips</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Ionicons name="wallet" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>€{Math.round(avgBudget)}</Text>
                            <Text style={styles.statLabel}>avg budget</Text>
                        </View>
                    </View>
                </View>
            </View>

            <ScrollView style={styles.contentSection} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
                <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.infoCardHeader}>
                        <Ionicons name="calendar" size={20} color={colors.primary} />
                        <Text style={[styles.infoCardTitle, { color: colors.text }]}>Best Time to Visit</Text>
                    </View>
                    <Text style={[styles.infoCardText, { color: colors.textSecondary }]}>{destinationData.bestTime}</Text>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Highlights</Text>
                    <View style={styles.highlightsGrid}>
                        {destinationData.highlights.map((highlight, index) => (
                            <View key={index} style={[styles.highlightChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Ionicons name="location" size={14} color={colors.primary} />
                                <Text style={[styles.highlightText, { color: colors.text }]}>{highlight}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Perfect For</Text>
                    <View style={styles.tagsContainer}>
                        {destinationData.bestFor.map((tag, index) => (
                            <View key={index} style={[styles.tag, { backgroundColor: colors.primary }]}>
                                <Text style={[styles.tagText, { color: colors.text }]}>{tag}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <View style={[styles.insightCard, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6", borderColor: colors.primary }]}>
                    <View style={styles.insightHeader}>
                        <Ionicons name="bulb" size={24} color={colors.primary} />
                        <Text style={[styles.insightTitle, { color: colors.text }]}>From Our Travelers</Text>
                    </View>
                    <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                        {tripCount > 0 
                            ? `${tripCount} travelers have explored ${destination} with Planera. The average trip budget is €${Math.round(avgBudget)}, with an overall satisfaction rating of ${avgRating.toFixed(1)}/5.`
                            : `Be the first to explore ${destination} with Planera and share your experience!`
                        }
                    </Text>
                </View>

                <View style={{ height: 120 }} />
            </ScrollView>

            <SafeAreaView edges={["bottom"]} style={[styles.ctaContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <View style={styles.ctaContent}>
                    <View style={styles.ctaPricing}>
                        <Text style={[styles.ctaLabel, { color: colors.textMuted }]}>From</Text>
                        <Text style={[styles.ctaPrice, { color: colors.text }]}>€{Math.round(avgBudget * 0.7)}</Text>
                        <Text style={[styles.ctaPerPerson, { color: colors.textMuted }]}>/person</Text>
                    </View>
                    <TouchableOpacity style={[styles.ctaButton, { backgroundColor: colors.primary }]} onPress={handleCreateTrip}>
                        <Text style={[styles.ctaButtonText, { color: colors.text }]}>Plan My Trip</Text>
                        <Ionicons name="arrow-forward" size={20} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    heroSection: { height: 320, position: "relative" },
    heroImageWrapper: { flex: 1, overflow: "hidden" },
    heroImageContainer: { flex: 1, width: "100%", height: "100%" },
    heroBackground: { flex: 1, justifyContent: "center", alignItems: "center" },
    heroImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    heroEmoji: { fontSize: 100, opacity: 0.3 },
    heroGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 200 },
    headerOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
    backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center", marginLeft: 16, marginTop: 8 },
    heroContent: { position: "absolute", bottom: 24, left: 20, right: 20 },
    heroTitle: { fontSize: 36, fontWeight: "800", color: "#FFFFFF", marginBottom: 16 },
    heroStats: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 16, padding: 16 },
    statItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    statValue: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
    statLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" },
    statDivider: { width: 1, height: 24, backgroundColor: "rgba(255,255,255,0.2)" },
    contentSection: { flex: 1 },
    contentContainer: { padding: 20 },
    infoCard: { borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1 },
    infoCardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    infoCardTitle: { fontSize: 16, fontWeight: "700" },
    infoCardText: { fontSize: 15, marginLeft: 30 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
    highlightsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    highlightChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, gap: 8, borderWidth: 1 },
    highlightText: { fontSize: 14, fontWeight: "500" },
    tagsContainer: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tag: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
    tagText: { fontSize: 14, fontWeight: "600" },
    insightCard: { borderRadius: 16, padding: 20, borderWidth: 1 },
    insightHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    insightTitle: { fontSize: 16, fontWeight: "700" },
    insightText: { fontSize: 14, lineHeight: 22 },
    ctaContainer: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: 1 },
    ctaContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
    ctaPricing: { flexDirection: "row", alignItems: "baseline", gap: 4 },
    ctaLabel: { fontSize: 14 },
    ctaPrice: { fontSize: 24, fontWeight: "800" },
    ctaPerPerson: { fontSize: 14 },
    ctaButton: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, gap: 8 },
    ctaButtonText: { fontSize: 16, fontWeight: "700" },
});
