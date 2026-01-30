import { View, Text, StyleSheet, TouchableOpacity, Image, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ActivityCardProps {
  activity: any;
  destination: string;
}

export default function ActivityCard({ activity, destination }: ActivityCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.flightInfo}>
          <Text style={styles.cardTitle}>{activity.title}</Text>
          <Text style={styles.cardSubtitle}>{activity.duration}</Text>
          <Text style={styles.activityDesc} numberOfLines={3}>{activity.description}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>€{activity.price}</Text>
            {activity.skipTheLine && (
              <View style={styles.skipLineBadge}>
                <Text style={styles.skipLineText}>Skip the Line</Text>
              </View>
            )}
          </View>
        </View>
        {activity.image ? (
          <Image source={{ uri: activity.image }} style={styles.activityThumbnail} />
        ) : (
          <View style={styles.activityThumbnailPlaceholder}>
            <Ionicons name="image-outline" size={24} color="#94A3B8" />
          </View>
        )}
      </View>
      {activity.bookingUrl && (
        <TouchableOpacity 
          style={styles.bookButton}
          onPress={() => Linking.openURL(activity.bookingUrl)}
        >
          <Text style={styles.bookButtonText}>Book Now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#F0F0F0",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  flightInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: "#666666",
    marginBottom: 8,
  },
  activityDesc: {
    fontSize: 13,
    color: "#666666",
    marginBottom: 8,
    lineHeight: 18,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  price: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFE500",
  },
  skipLineBadge: {
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  skipLineText: {
    fontSize: 11,
    color: "#0369A1",
    fontWeight: "600",
  },
  activityThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  activityThumbnailPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
  },
  bookButton: {
    backgroundColor: "#FFE500",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  bookButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A1A1A",
  },
});
