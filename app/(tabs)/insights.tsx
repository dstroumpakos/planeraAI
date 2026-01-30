import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { useConvexAuth } from "@/lib/auth-components";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "@/lib/ThemeContext";

const CATEGORIES = [
  { id: "food", label: "Food & Drink", icon: "restaurant" },
  { id: "transport", label: "Transport", icon: "bus" },
  { id: "neighborhoods", label: "Neighborhoods", icon: "map" },
  { id: "timing", label: "Best Time", icon: "time" },
  { id: "hidden_gem", label: "Hidden Gems", icon: "diamond" },
  { id: "avoid", label: "What to Avoid", icon: "warning" },
  { id: "other", label: "Other", icon: "information-circle" },
];

export default function InsightsScreen() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [tripToVerify, setTripToVerify] = useState<any>(null);
  const [shareView, setShareView] = useState<"trips" | "form">("trips");
  
  // Form State
  const [selectedTrip, setSelectedTrip] = useState<{
    _id: Id<"trips">;
    destination: string;
    startDate: number;
    endDate: number;
    travelers: number;
  } | null>(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("other");

  // Get user's completed trips - only when authenticated
  const completedTrips = useQuery(
    api.insights.getCompletedTrips,
    isAuthenticated ? {} : "skip"
  );

  const createInsight = useMutation(api.insights.create);
  const dismissTrip = useMutation(api.insights.dismissTrip);

  // Show loading state while auth is initializing
  if (isAuthLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.authContainer}>
          <Ionicons name="bulb-outline" size={64} color={colors.primary} />
          <Text style={[styles.authTitle, { color: colors.text }]}>Traveler Insights</Text>
          <Text style={[styles.authSubtitle, { color: colors.textMuted }]}>
            Sign in to browse and share travel tips with other travelers
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmit = async () => {
    if (!selectedTrip || !content) {
      Alert.alert("Error", "Please select a trip and write your insight");
      return;
    }

    try {
      await createInsight({
        destination: selectedTrip.destination,
        content,
        category: category as any,
        verified: true, // Always verified since they must select from completed trips
      });
      resetForm();
      Alert.alert("Success", "Thank you for sharing your insight! It will help other travelers.");
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to share insight");
    }
  };

  const resetForm = () => {
    setSelectedTrip(null);
    setContent("");
    setCategory("other");
  };

  const handleVerifyTrip = (confirmed: boolean) => {
    if (confirmed && tripToVerify) {
      setSelectedTrip(tripToVerify);
      setTripToVerify(null);
      setShareView("form");
    } else if (tripToVerify) {
      // Dismiss the trip when user clicks "No, not yet"
      dismissTrip({ tripId: tripToVerify._id });
      setTripToVerify(null);
    } else {
      setTripToVerify(null);
    }
  };

  const handleBackFromForm = () => {
    setShareView("trips");
    resetForm();
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  };

  const renderTripItem = ({ item }: { item: typeof completedTrips extends (infer T)[] | undefined ? T : never }) => {
    if (!item) return null;
    const isSelected = selectedTrip?._id === item._id;
    
    return (
      <TouchableOpacity 
        style={[
          styles.tripCard, 
          { backgroundColor: colors.card, borderColor: colors.border },
          isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }
        ]}
        onPress={() => setTripToVerify(item)}
      >
        <View style={[styles.tripIconContainer, { backgroundColor: colors.secondary }]}>
          <Ionicons name="airplane" size={24} color={isSelected ? colors.text : colors.primary} />
        </View>
        <View style={styles.tripInfo}>
          <Text style={[styles.tripDestination, { color: colors.text }]}>
            {item.destination}
          </Text>
          <Text style={[styles.tripDates, { color: colors.textMuted }, isSelected && { color: colors.text }]}>
            {formatDate(item.startDate)} - {formatDate(item.endDate)}
          </Text>
        </View>
        {isSelected && (
          <Ionicons name="checkmark-circle" size={24} color={colors.text} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={handleBackFromForm}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Share Your Tips</Text>
        <View style={{ width: 24 }} />
      </View>

      {shareView === "trips" ? (
        <ScrollView style={[styles.shareContainer, { backgroundColor: colors.background }]} contentContainerStyle={styles.shareContent}>
          {completedTrips === undefined ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : completedTrips.length === 0 ? (
            <View style={[styles.noTripsContainer, { backgroundColor: colors.card }]}>
              <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.noTripsText, { color: colors.text }]}>No completed trips yet</Text>
              <Text style={[styles.noTripsSubtext, { color: colors.textMuted }]}>
                Once you complete a trip, you'll be able to share your insights here
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Completed Trips</Text>
              <FlatList
                data={completedTrips}
                renderItem={renderTripItem}
                keyExtractor={(item) => item._id}
                scrollEnabled={false}
                contentContainerStyle={styles.tripsListContent}
              />
            </>
          )}
        </ScrollView>
      ) : shareView === "form" ? (
        <ScrollView style={[styles.shareContainer, { backgroundColor: colors.background }]} contentContainerStyle={styles.shareContent}>
          {selectedTrip && (
            <>
              <Text style={[styles.selectedTripLabel, { color: colors.textMuted }]}>
                Sharing insights for: <Text style={[styles.selectedTripName, { color: colors.primary }]}>{selectedTrip.destination}</Text>
              </Text>

              <View style={[styles.insightFormContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.label, { color: colors.text }]}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryChip,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border },
                        category === cat.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                      onPress={() => setCategory(cat.id)}
                    >
                      <Ionicons
                        name={cat.icon as any}
                        size={16}
                        color={category === cat.id ? colors.text : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.categoryChipText,
                          { color: colors.textMuted },
                          category === cat.id && { color: colors.text },
                        ]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[styles.label, { color: colors.text }]}>Your Insight</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
                  placeholder="Share your experience, tips, or recommendations..."
                  placeholderTextColor={colors.textMuted}
                  value={content}
                  onChangeText={setContent}
                  multiline
                />

                <TouchableOpacity style={[styles.submitButton, { backgroundColor: colors.primary }]} onPress={handleSubmit}>
                  <Ionicons name="send" size={18} color={colors.text} />
                  <Text style={[styles.submitButtonText, { color: colors.text }]}>Share Insight</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      ) : null}

      {/* Trip Verification Modal */}
      <Modal
        visible={!!tripToVerify}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setTripToVerify(null)}
      >
        <View style={styles.verifyModalOverlay}>
          <View style={[styles.verifyModalContent, { backgroundColor: colors.background }]}>
            {/* Status Bar Placeholder */}
            <View style={{ height: insets.top }} />
            
            {/* Header */}
            <View style={styles.verifyHeader}>
              <TouchableOpacity 
                style={styles.verifyCloseButton}
                onPress={() => setTripToVerify(null)}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.verifyHeaderTitle, { color: colors.text }]}>Trip Feedback</Text>
              <View style={{ width: 48 }} /> 
            </View>

            <ScrollView contentContainerStyle={styles.verifyScrollContent}>
              {/* Trip Card with Image */}
              {tripToVerify && (
                <View style={[styles.verifyTripCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.verifyTripImageContainer}>
                    <Image
                      source={{ uri: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=200&h=200&fit=crop" }}
                      style={styles.verifyTripImage}
                    />
                  </View>
                  <View style={styles.verifyTripInfo}>
                    <Text style={[styles.verifyTripDestination, { color: colors.text }]}>{tripToVerify.destination}</Text>
                    <Text style={[styles.verifyTripDetails, { color: colors.textMuted }]}>
                      {formatDate(tripToVerify.startDate)} - {formatDate(tripToVerify.endDate)} • {tripToVerify.travelers} Travelers
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={24} color={colors.text} />
                </View>
              )}

              {/* Main Prompt */}
              <View style={styles.verifyPromptContainer}>
                <View style={[styles.verifyIconContainer, { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : 'rgba(255, 217, 0, 0.2)' }]}>
                  <Ionicons name="sparkles" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.verifyTitle, { color: colors.text }]}>
                  Have you taken{"\n"}this trip?
                </Text>
                <Text style={[styles.verifySubtitle, { color: colors.textMuted }]}>
                  Help Planera AI build better itineraries for your future adventures.
                </Text>
              </View>

              <View style={{ flex: 1 }} />

              {/* Action Buttons */}
              <View style={[styles.verifyActions, { paddingBottom: Math.max(insets.bottom, 32) }]}>
                <TouchableOpacity 
                  style={[styles.verifyYesButton, { backgroundColor: colors.primary }]}
                  onPress={() => handleVerifyTrip(true)}
                >
                  <Text style={[styles.verifyYesButtonText, { color: colors.text }]}>Yes, I have</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.verifyNoButton, { borderColor: colors.border }]}
                  onPress={() => handleVerifyTrip(false)}
                >
                  <Text style={[styles.verifyNoButtonText, { color: colors.text }]}>No, not yet</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFBF0",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F0E6D3",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#181710",
  },
  addButton: {
    backgroundColor: "#F5A623",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F5F5F5",
    gap: 8,
  },
  tabActive: {
    backgroundColor: "#FFF8E7",
    borderWidth: 1,
    borderColor: "#F5A623",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#999",
  },
  tabTextActive: {
    color: "#F5A623",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    margin: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#333",
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#333",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  verifiedText: {
    fontSize: 12,
    color: "#4CAF50",
    marginLeft: 4,
    fontWeight: "500",
  },
  destinationText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  contentText: {
    fontSize: 15,
    color: "#555",
    lineHeight: 22,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
    paddingTop: 12,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  likeCount: {
    marginLeft: 6,
    color: "#666",
    fontSize: 14,
  },
  dateText: {
    color: "#999",
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    marginTop: 16,
    color: "#666",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySubtext: {
    marginTop: 8,
    color: "#999",
    fontSize: 14,
    textAlign: "center",
  },
  shareContainer: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  shareContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 20,
  },
  shareHeader: {
    alignItems: "center",
    marginBottom: 32,
  },
  shareTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#181710",
    marginTop: 12,
    textAlign: "center",
  },
  shareSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#181710",
    marginBottom: 16,
  },
  noTripsContainer: {
    alignItems: "center",
    padding: 40,
    backgroundColor: "#FFF",
    borderRadius: 16,
    marginTop: 20,
  },
  noTripsText: {
    marginTop: 16,
    color: "#181710",
    fontSize: 18,
    fontWeight: "600",
  },
  noTripsSubtext: {
    marginTop: 8,
    color: "#666",
    fontSize: 14,
    textAlign: "center",
  },
  tripsListContent: {
    gap: 12,
  },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  tripCardSelected: {
    backgroundColor: "#FFD900",
    borderColor: "#FFD900",
  },
  tripIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF8E7",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  tripInfo: {
    flex: 1,
  },
  tripDestination: {
    fontSize: 16,
    fontWeight: "600",
    color: "#181710",
  },
  tripTextSelected: {
    color: "#181710",
  },
  tripDates: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
  },
  tripDatesSelected: {
    color: "#181710",
  },
  insightFormContainer: {
    marginTop: 32,
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#E7E5DA",
  },
  selectedTripLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
  },
  selectedTripName: {
    fontWeight: "700",
    color: "#F5A623",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  modalSafeArea: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  modalContent: {
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 16,
    color: "#181710",
  },
  input: {
    backgroundColor: "#F5F4F0",
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    color: "#333",
    borderWidth: 1,
    borderColor: "#E7E5DA",
  },
  textArea: {
    height: 120,
    textAlignVertical: "top",
  },
  categoryScroll: {
    flexDirection: "row",
    marginBottom: 8,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F5F4F0",
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E7E5DA",
  },
  categoryChipSelected: {
    backgroundColor: "#FFD900",
    borderColor: "#FFD900",
  },
  categoryChipText: {
    marginLeft: 6,
    fontWeight: "500",
    color: "#666",
    fontSize: 13,
  },
  categoryChipTextSelected: {
    color: "#181710",
    fontWeight: "600",
  },
  submitButton: {
    backgroundColor: "#FFD900",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
    shadowColor: "#FFD900",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  submitButtonText: {
    color: "#181710",
    fontSize: 16,
    fontWeight: "bold",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  authContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#181710",
    marginTop: 24,
  },
  authSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 12,
    lineHeight: 24,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFD900",
    marginLeft: 4,
  },
  // Verification Modal Styles
  verifyModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  verifyModalContent: {
    backgroundColor: "#FFFBF0",
    height: "100%",
    width: "100%",
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: "hidden",
  },
  verifyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  verifyCloseButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  verifyHeaderTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#181710",
    textAlign: "center",
  },
  verifyScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  verifyTripCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 12,
    paddingRight: 16,
    marginBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  verifyTripImageContainer: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    marginRight: 16,
  },
  verifyTripImage: {
    width: "100%",
    height: "100%",
  },
  verifyTripInfo: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  verifyTripDestination: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#181710",
  },
  verifyTripDetails: {
    fontSize: 13,
    fontWeight: "500",
    color: "#999",
  },
  verifyPromptContainer: {
    alignItems: "center",
    marginTop: 16,
    marginBottom: 32,
  },
  verifyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255, 217, 0, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  verifyTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#181710",
    textAlign: "center",
    lineHeight: 38,
    marginBottom: 12,
  },
  verifySubtitle: {
    fontSize: 15,
    color: "#757575",
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 260,
  },
  verifyActions: {
    width: "100%",
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  verifyYesButton: {
    width: "100%",
    height: 56,
    backgroundColor: "#FFD900",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#FFD900",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  verifyYesButtonText: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#181710",
  },
  verifyNoButton: {
    width: "100%",
    height: 56,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  verifyNoButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#181710",
  },
});
