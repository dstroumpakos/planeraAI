import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { useConvexAuth } from "@/lib/auth-components";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/lib/ThemeContext";

export default function DestinationsScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { colors } = useTheme();
  const [destinationImages, setDestinationImages] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState("");

  const allDestinations = useQuery(api.trips.getAllDestinations);
  const getImages = useAction(api.images.getDestinationImages);

  const fetchImages = useCallback(async () => {
    const imageMap: Record<string, any> = {};
    if (!allDestinations) return;
    for (const destination of allDestinations) {
      try {
        const images = await getImages({ destination: destination.destination });
        if (images && images.length > 0) {
          imageMap[destination.destination] = images[0];
        }
      } catch (error) {
        console.error(`Failed to fetch images for ${destination.destination}:`, error);
      }
    }
    setDestinationImages(imageMap);
  }, [allDestinations]);

  useEffect(() => {
    if (allDestinations && allDestinations.length > 0) {
      fetchImages();
    }
  }, [allDestinations]);

  // Filter destinations based on search
  const filteredDestinations = allDestinations?.filter((dest) =>
    dest.destination.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  if (authLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.authContainer}>
          <Text style={[styles.authText, { color: colors.textMuted }]}>Please log in to view destinations</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={[styles.backButton, { backgroundColor: colors.card }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>All Destinations</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card }]}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search destinations..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Destinations List */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {!allDestinations ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading destinations...</Text>
          </View>
        ) : filteredDestinations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="globe-outline" size={64} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Destinations Found</Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {searchQuery ? "Try a different search term" : "Start planning trips to see destinations here"}
            </Text>
          </View>
        ) : (
          filteredDestinations.map((destination, index) => (
            <TouchableOpacity
              key={index}
              style={styles.destinationCard}
              onPress={() => router.push({
                pathname: "/destination-preview",
                params: {
                  destination: destination.destination,
                  avgBudget: destination.avgBudget.toString(),
                  avgRating: destination.avgRating.toString(),
                  count: destination.count.toString(),
                }
              })}
              activeOpacity={0.9}
            >
              <View style={styles.cardImageContainer}>
                {destinationImages[destination.destination] ? (
                  <ImageWithAttribution
                    imageUrl={destinationImages[destination.destination].url}
                    photographerName={destinationImages[destination.destination].photographer}
                    photographerUrl={destinationImages[destination.destination].photographerUrl}
                    position="top"
                  />
                ) : (
                  <View style={[styles.imagePlaceholder, { backgroundColor: colors.secondary }]}>
                    <Text style={styles.placeholderEmoji}>✈️</Text>
                  </View>
                )}
                
                {/* Gradient Overlay */}
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.8)"]}
                  style={styles.cardGradient}
                />
                
                {/* Content Overlay */}
                <View style={styles.cardOverlay}>
                  {/* Header: Title and Rating */}
                  <View style={styles.cardHeader}>
                    <Text style={styles.destinationName} numberOfLines={1}>
                      {destination.destination}
                    </Text>
                    <View style={styles.ratingBadge}>
                      <Ionicons name="star" size={14} color="#FFD700" />
                      <Text style={styles.ratingText}>
                        {destination.avgRating.toFixed(1)}
                      </Text>
                    </View>
                  </View>

                  {/* Stats Row */}
                  <View style={styles.cardStats}>
                    <View style={styles.statItem}>
                      <Ionicons name="airplane-outline" size={14} color="rgba(255,255,255,0.8)" />
                      <Text style={styles.statText}>
                        {destination.count} {destination.count === 1 ? "trip" : "trips"}
                      </Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Ionicons name="wallet-outline" size={14} color="rgba(255,255,255,0.8)" />
                      <Text style={styles.statText}>
                        ~${Math.round(destination.avgBudget).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {/* Interests */}
                  {destination.interests.length > 0 && (
                    <View style={styles.interestsContainer}>
                      {destination.interests.slice(0, 3).map((interest, i) => (
                        <View key={i} style={styles.interestTag}>
                          <Text style={styles.interestText}>{interest}</Text>
                        </View>
                      ))}
                      {destination.interests.length > 3 && (
                        <View style={styles.interestTag}>
                          <Text style={styles.interestText}>+{destination.interests.length - 3}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  authContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  authText: {
    fontSize: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 44,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  destinationCard: {
    borderRadius: 20,
    marginBottom: 16,
    overflow: "hidden",
  },
  cardImageContainer: {
    height: 220,
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderEmoji: {
    fontSize: 48,
  },
  cardGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "70%",
  },
  cardOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  destinationName: {
    fontSize: 22,
    fontWeight: "700",
    flex: 1,
    marginRight: 12,
    color: "#FFFFFF",
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  cardStats: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 12,
  },
  statText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
  },
  interestsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  interestTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  interestText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#FFFFFF",
  },
});
