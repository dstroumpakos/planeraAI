import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { DEALS } from "@/lib/data";

// NOTE: Using fixed width for hotel cards instead of Dimensions
// This avoids top-level native API calls

export default function DealDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    
    const deal = DEALS.find(d => d.id === id);

    const openBookingLink = (query: string) => {
        // Example affiliate link
        const url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query)}`;
        Linking.openURL(url);
    };

    if (!deal) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
                    </TouchableOpacity>
                </View>
                <View style={styles.centerContent}>
                    <Text>Deal not found</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Hero Image */}
                <View style={styles.imageContainer}>
                    <Image source={{ uri: deal.image }} style={styles.heroImage} />
                    <TouchableOpacity 
                        style={styles.backButtonAbsolute} 
                        onPress={() => router.back()}
                    >
                        <View style={styles.backButtonCircle}>
                            <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
                        </View>
                    </TouchableOpacity>
                    <View style={styles.discountBadge}>
                        <Text style={styles.discountText}>{deal.discount}</Text>
                    </View>
                </View>

                <View style={styles.content}>
                    {/* Header */}
                    <View style={styles.headerSection}>
                        <Text style={styles.destination}>{deal.destination}</Text>
                        <View style={styles.priceRow}>
                            <Text style={styles.originalPrice}>${deal.originalPrice}</Text>
                            <Text style={styles.price}>${deal.price}</Text>
                            <Text style={styles.perPerson}>/ person</Text>
                        </View>
                        <View style={styles.dateRow}>
                            <Ionicons name="calendar-outline" size={16} color="#8E8E93" />
                            <Text style={styles.dateText}>{deal.dates}</Text>
                        </View>
                        <Text style={styles.description}>{deal.description}</Text>
                    </View>

                    {/* Flights */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Flights</Text>
                        <View style={styles.card}>
                            {/* Outbound */}
                            <View style={styles.flightRow}>
                                <View style={styles.flightInfo}>
                                    <Text style={styles.airline}>{deal.flights.outbound.airline}</Text>
                                    <Text style={styles.flightNumber}>{deal.flights.outbound.flightNumber}</Text>
                                </View>
                                <View style={styles.flightRoute}>
                                    <Text style={styles.time}>{deal.flights.outbound.departure}</Text>
                                    <View style={styles.durationLine}>
                                        <Text style={styles.duration}>{deal.flights.outbound.duration}</Text>
                                        <View style={styles.line} />
                                    </View>
                                    <Text style={styles.time}>{deal.flights.outbound.arrival}</Text>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            {/* Return */}
                            <View style={styles.flightRow}>
                                <View style={styles.flightInfo}>
                                    <Text style={styles.airline}>{deal.flights.return.airline}</Text>
                                    <Text style={styles.flightNumber}>{deal.flights.return.flightNumber}</Text>
                                </View>
                                <View style={styles.flightRoute}>
                                    <Text style={styles.time}>{deal.flights.return.departure}</Text>
                                    <View style={styles.durationLine}>
                                        <Text style={styles.duration}>{deal.flights.return.duration}</Text>
                                        <View style={styles.line} />
                                    </View>
                                    <Text style={styles.time}>{deal.flights.return.arrival}</Text>
                                </View>
                            </View>

                            <View style={styles.luggageContainer}>
                                <Ionicons name="briefcase-outline" size={16} color="#007AFF" />
                                <Text style={styles.luggageText}>{deal.flights.luggage}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Accommodation */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Accommodation Options</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hotelList}>
                            {deal.hotels.map((hotel, index) => (
                                <View key={index} style={styles.hotelCard}>
                                    <Image source={{ uri: hotel.image }} style={styles.hotelImage} />
                                    <View style={styles.hotelContent}>
                                        <Text style={styles.hotelName} numberOfLines={1}>{hotel.name}</Text>
                                        <View style={styles.ratingRow}>
                                            <Ionicons name="star" size={14} color="#FFD700" />
                                            <Text style={styles.rating}>{hotel.rating}</Text>
                                            <Text style={styles.hotelPrice}>{hotel.price}</Text>
                                        </View>
                                        <Text style={styles.hotelAddress} numberOfLines={1}>{hotel.address}</Text>
                                        
                                        <TouchableOpacity 
                                            style={styles.miniBookButton}
                                            onPress={() => openBookingLink(hotel.name + " " + deal.destination)}
                                        >
                                            <Text style={styles.miniBookButtonText}>View Deal</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                    </View>

                    {/* Itinerary Preview */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Itinerary Highlights</Text>
                        {deal.itinerary.map((day) => (
                            <View key={day.day} style={styles.dayContainer}>
                                <Text style={styles.dayTitle}>Day {day.day}</Text>
                                {day.activities.map((activity, index) => (
                                    <View key={index} style={styles.activityRow}>
                                        <Text style={styles.activityTime}>{activity.time}</Text>
                                        <View style={styles.activityContent}>
                                            <Text style={styles.activityTitle}>{activity.title}</Text>
                                            <Text style={styles.activityDesc}>{activity.description}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                </View>
            </ScrollView>

            {/* Bottom Action Bar */}
            <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
                <View style={styles.priceContainer}>
                    <Text style={styles.totalPriceLabel}>Total Price</Text>
                    <Text style={styles.totalPrice}>${deal.price}</Text>
                </View>
                <TouchableOpacity 
                    style={styles.bookButton}
                    onPress={() => openBookingLink(deal.destination)}
                >
                    <Text style={styles.bookButtonText}>Book This Deal</Text>
                </TouchableOpacity>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#F2F2F7",
    },
    scrollContent: {
        paddingBottom: 100,
    },
    imageContainer: {
        height: 300,
        width: "100%",
        position: "relative",
    },
    heroImage: {
        width: "100%",
        height: "100%",
    },
    backButtonAbsolute: {
        position: "absolute",
        top: 60,
        left: 20,
        zIndex: 10,
    },
    backButtonCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "white",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    discountBadge: {
        position: "absolute",
        bottom: 20,
        right: 20,
        backgroundColor: "#FF3B30",
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    discountText: {
        color: "white",
        fontWeight: "bold",
        fontSize: 16,
    },
    content: {
        flex: 1,
        marginTop: -20,
        backgroundColor: "#F2F2F7",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
    },
    headerSection: {
        marginBottom: 24,
    },
    destination: {
        fontSize: 28,
        fontWeight: "bold",
        color: "#1C1C1E",
        marginBottom: 8,
    },
    priceRow: {
        flexDirection: "row",
        alignItems: "baseline",
        marginBottom: 8,
    },
    originalPrice: {
        fontSize: 18,
        color: "#8E8E93",
        textDecorationLine: "line-through",
        marginRight: 8,
    },
    price: {
        fontSize: 24,
        fontWeight: "bold",
        color: "#007AFF",
    },
    perPerson: {
        fontSize: 16,
        color: "#8E8E93",
        marginLeft: 4,
    },
    dateRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12,
        gap: 6,
    },
    dateText: {
        fontSize: 16,
        color: "#8E8E93",
    },
    description: {
        fontSize: 16,
        color: "#3A3A3C",
        lineHeight: 24,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: "bold",
        color: "#1C1C1E",
        marginBottom: 16,
    },
    card: {
        backgroundColor: "white",
        borderRadius: 16,
        padding: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    flightRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    flightInfo: {
        flex: 1,
    },
    airline: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1C1C1E",
    },
    flightNumber: {
        fontSize: 14,
        color: "#8E8E93",
        marginTop: 2,
    },
    flightRoute: {
        flex: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
    },
    time: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1C1C1E",
    },
    durationLine: {
        alignItems: "center",
        width: 80,
    },
    duration: {
        fontSize: 12,
        color: "#8E8E93",
        marginBottom: 4,
    },
    line: {
        height: 2,
        backgroundColor: "#E5E5EA",
        width: "100%",
    },
    divider: {
        height: 1,
        backgroundColor: "#E5E5EA",
        marginVertical: 16,
    },
    luggageContainer: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F2F2F7",
        alignSelf: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        gap: 6,
    },
    luggageText: {
        fontSize: 14,
        color: "#007AFF",
        fontWeight: "500",
    },
    hotelList: {
        paddingRight: 20,
        gap: 16,
    },
    hotelCard: {
        width: "100%",
        backgroundColor: "white",
        borderRadius: 16,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    hotelImage: {
        width: "100%",
        height: 150,
    },
    hotelContent: {
        padding: 12,
    },
    hotelName: {
        fontSize: 16,
        fontWeight: "bold",
        color: "#1C1C1E",
        marginBottom: 4,
    },
    ratingRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 4,
        gap: 4,
    },
    rating: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1C1C1E",
    },
    hotelPrice: {
        fontSize: 14,
        color: "#8E8E93",
        marginLeft: "auto",
    },
    hotelAddress: {
        fontSize: 14,
        color: "#8E8E93",
    },
    dayContainer: {
        marginBottom: 20,
    },
    dayTitle: {
        fontSize: 18,
        fontWeight: "600",
        color: "#1C1C1E",
        marginBottom: 12,
    },
    activityRow: {
        flexDirection: "row",
        marginBottom: 16,
    },
    activityTime: {
        width: 80,
        fontSize: 14,
        fontWeight: "600",
        color: "#007AFF",
    },
    activityContent: {
        flex: 1,
    },
    activityTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1C1C1E",
        marginBottom: 4,
    },
    activityDesc: {
        fontSize: 14,
        color: "#8E8E93",
        lineHeight: 20,
    },
    bottomBar: {
        backgroundColor: "white",
        borderTopWidth: 1,
        borderTopColor: "#E5E5EA",
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    priceContainer: {
        flex: 1,
    },
    totalPriceLabel: {
        fontSize: 12,
        color: "#8E8E93",
        marginBottom: 2,
    },
    totalPrice: {
        fontSize: 24,
        fontWeight: "bold",
        color: "#007AFF",
    },
    bookButton: {
        backgroundColor: "#007AFF",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 24,
    },
    bookButtonText: {
        color: "white",
        fontWeight: "bold",
        fontSize: 16,
    },
    header: {
        padding: 16,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "#F2F2F7",
        alignItems: "center",
        justifyContent: "center",
    },
    centerContent: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    miniBookButton: {
        marginTop: 8,
        backgroundColor: "#E1F0FF",
        paddingVertical: 6,
        borderRadius: 6,
        alignItems: "center",
    },
    miniBookButtonText: {
        color: "#007AFF",
        fontSize: 12,
        fontWeight: "600",
    },
});
