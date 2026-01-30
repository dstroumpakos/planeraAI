import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput, Switch, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { INTERESTS } from "@/lib/data";
import { AIRPORTS } from "@/lib/airports";

export default function TravelPreferences() {
    const router = useRouter();
    const settings = useQuery(api.users.getSettings) as any;
    const updatePreferences = useMutation(api.users.updateTravelPreferences);

    const [homeAirport, setHomeAirport] = useState("");
    const [defaultBudget, setDefaultBudget] = useState("2000");
    const [defaultInterests, setDefaultInterests] = useState<string[]>([]);
    const [defaultSkipFlights, setDefaultSkipFlights] = useState(false);
    const [defaultSkipHotel, setDefaultSkipHotel] = useState(false);
    const [defaultPreferredFlightTime, setDefaultPreferredFlightTime] = useState("any");

    const [showAirportSuggestions, setShowAirportSuggestions] = useState(false);
    const [airportSuggestions, setAirportSuggestions] = useState<typeof AIRPORTS>([]);

    useEffect(() => {
        if (settings) {
            setHomeAirport(settings.homeAirport || "");
            setDefaultBudget(settings.defaultBudget?.toString() || "2000");
            // Use the mapped field names from getSettings
            setDefaultInterests(settings.interests || []);
            setDefaultSkipFlights(settings.skipFlights || false);
            setDefaultSkipHotel(settings.skipHotels || false);
            setDefaultPreferredFlightTime(settings.flightTimePreference || "any");
        }
    }, [settings]);

    const searchAirports = (query: string) => {
        if (!query || query.length < 2) {
            setAirportSuggestions([]);
            setShowAirportSuggestions(false);
            return;
        }
        
        const lowerQuery = query.toLowerCase();
        const results = AIRPORTS.filter(airport => 
            airport.city.toLowerCase().includes(lowerQuery) ||
            airport.country.toLowerCase().includes(lowerQuery) ||
            airport.code.toLowerCase().includes(lowerQuery) ||
            airport.name.toLowerCase().includes(lowerQuery)
        ).slice(0, 10);
        
        setAirportSuggestions(results);
        setShowAirportSuggestions(results.length > 0);
    };

    const selectAirport = (airport: typeof AIRPORTS[0]) => {
        setHomeAirport(`${airport.city}, ${airport.code}`);
        setShowAirportSuggestions(false);
        setAirportSuggestions([]);
    };

    const handleSave = async () => {
        try {
            await updatePreferences({
                homeAirport,
                defaultInterests,
                defaultSkipFlights,
                defaultSkipHotel,
                defaultPreferredFlightTime,
            });
            Alert.alert("Success", "Travel preferences updated successfully!");
            router.back();
        } catch (error) {
            console.error("Update failed:", error);
            Alert.alert("Error", "Failed to update travel preferences");
        }
    };

    const toggleInterest = (interest: string) => {
        if (defaultInterests.includes(interest)) {
            setDefaultInterests(defaultInterests.filter(i => i !== interest));
        } else {
            if (defaultInterests.length < 5) {
                setDefaultInterests([...defaultInterests, interest]);
            } else {
                Alert.alert("Limit Reached", "You can select up to 5 interests");
            }
        }
    };

    if (settings === undefined) {
        return (
            <SafeAreaView style={styles.container}>
                <ActivityIndicator size="large" color="#1A1A1A" />
            </SafeAreaView>
        );
    }

    const flightTimeOptions = [
        { value: "any", label: "Any Time", icon: "time-outline" },
        { value: "morning", label: "Morning", icon: "sunny-outline" },
        { value: "afternoon", label: "Afternoon", icon: "partly-sunny-outline" },
        { value: "evening", label: "Evening", icon: "moon-outline" },
        { value: "night", label: "Night", icon: "moon" },
    ];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Travel Preferences</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.description}>
                    These preferences will be automatically applied when you create a new trip.
                </Text>

                {/* Home Airport */}
                <View style={[styles.section, { zIndex: 10 }]}>
                    <Text style={styles.sectionTitle}>Home Airport</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="airplane-outline" size={20} color="#1A1A1A" style={styles.inputIcon} />
                        <TextInput
                            style={styles.input}
                            placeholder="e.g. San Francisco, CA"
                            value={homeAirport}
                            onChangeText={(text) => {
                                setHomeAirport(text);
                                searchAirports(text);
                            }}
                            onFocus={() => {
                                if (homeAirport.length >= 2) {
                                    searchAirports(homeAirport);
                                }
                            }}
                            placeholderTextColor="#9B9B9B"
                        />
                    </View>
                    {showAirportSuggestions && airportSuggestions.length > 0 && (
                        <View style={styles.suggestionsContainer}>
                            <ScrollView nestedScrollEnabled={true} keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
                                {airportSuggestions.map((airport, index) => (
                                    <TouchableOpacity
                                        key={`${airport.city}-${airport.country}-${index}`}
                                        style={styles.suggestionItem}
                                        onPress={() => selectAirport(airport)}
                                    >
                                        <Ionicons name="airplane" size={20} color="#FFE500" style={{ marginRight: 12 }} />
                                        <View>
                                            <Text style={styles.suggestionCity}>{airport.city} ({airport.code})</Text>
                                            <Text style={styles.suggestionDetails}>{airport.name}</Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    )}
                </View>

                {/* Default Budget */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Default Budget ($)</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="cash-outline" size={20} color="#1A1A1A" style={styles.inputIcon} />
                        <TextInput
                            style={styles.input}
                            placeholder="2000"
                            value={defaultBudget}
                            onChangeText={setDefaultBudget}
                            keyboardType="numeric"
                            placeholderTextColor="#9B9B9B"
                        />
                    </View>
                </View>

                {/* Default Interests */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Default Interests (Max 5)</Text>
                    <View style={styles.interestsContainer}>
                        {INTERESTS.map((interest) => (
                            <TouchableOpacity
                                key={interest}
                                style={[
                                    styles.interestChip,
                                    defaultInterests.includes(interest) && styles.interestChipActive
                                ]}
                                onPress={() => toggleInterest(interest)}
                            >
                                <Text style={[
                                    styles.interestText,
                                    defaultInterests.includes(interest) && styles.interestTextActive
                                ]}>
                                    {interest}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Flight Preferences */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Preferred Flight Time</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsRow}>
                        {flightTimeOptions.map((option) => (
                            <TouchableOpacity
                                key={option.value}
                                style={[
                                    styles.optionCard,
                                    defaultPreferredFlightTime === option.value && styles.optionCardActive,
                                ]}
                                onPress={() => setDefaultPreferredFlightTime(option.value)}
                            >
                                <Ionicons
                                    name={option.icon as any}
                                    size={24}
                                    color={defaultPreferredFlightTime === option.value ? "#1A1A1A" : "#9B9B9B"}
                                />
                                <Text
                                    style={[
                                        styles.optionText,
                                        defaultPreferredFlightTime === option.value && styles.optionTextActive,
                                    ]}
                                >
                                    {option.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                {/* Toggles */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Default Settings</Text>
                    
                    <View style={styles.toggleRow}>
                        <View style={styles.toggleInfo}>
                            <Text style={styles.toggleLabel}>Skip Flights</Text>
                            <Text style={styles.toggleDescription}>Don't search for flights by default</Text>
                        </View>
                        <Switch
                            value={defaultSkipFlights}
                            onValueChange={setDefaultSkipFlights}
                            trackColor={{ false: "#E2E8F0", true: "#FFE500" }}
                            thumbColor={Platform.OS === "ios" ? "#FFFFFF" : defaultSkipFlights ? "#FFFFFF" : "#F1F5F9"}
                        />
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.toggleRow}>
                        <View style={styles.toggleInfo}>
                            <Text style={styles.toggleLabel}>Skip Hotels</Text>
                            <Text style={styles.toggleDescription}>Don't search for hotels by default</Text>
                        </View>
                        <Switch
                            value={defaultSkipHotel}
                            onValueChange={setDefaultSkipHotel}
                            trackColor={{ false: "#E2E8F0", true: "#FFE500" }}
                            thumbColor={Platform.OS === "ios" ? "#FFFFFF" : defaultSkipHotel ? "#FFFFFF" : "#F1F5F9"}
                        />
                    </View>
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                    <Text style={styles.saveButtonText}>Save Preferences</Text>
                </TouchableOpacity>
                
                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FAF9F6",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: "#FAF9F6",
        borderBottomWidth: 1,
        borderBottomColor: "#E8E6E1",
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    content: {
        flex: 1,
        padding: 20,
    },
    description: {
        fontSize: 14,
        color: "#9B9B9B",
        marginBottom: 24,
        lineHeight: 20,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 12,
    },
    row: {
        flexDirection: "row",
        marginBottom: 24,
    },
    inputContainer: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        paddingHorizontal: 12,
        height: 48,
    },
    inputIcon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: "#1A1A1A",
    },
    interestsContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    interestChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: "#FFF8E1",
        borderWidth: 2,
        borderColor: "#FFE500",
    },
    interestChipActive: {
        backgroundColor: "#FFE500",
        borderColor: "#FFE500",
    },
    interestText: {
        fontSize: 14,
        color: "#1A1A1A",
        fontWeight: "600",
    },
    interestTextActive: {
        color: "#1A1A1A",
    },
    optionsRow: {
        flexDirection: "row",
        gap: 12,
    },
    optionCard: {
        padding: 16,
        backgroundColor: "#FFF8E1",
        borderRadius: 12,
        borderWidth: 2,
        borderColor: "#FFE500",
        alignItems: "center",
        minWidth: 100,
        marginRight: 12,
    },
    optionCardActive: {
        borderColor: "#FFE500",
        backgroundColor: "#FFE500",
    },
    optionText: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    optionTextActive: {
        color: "#1A1A1A",
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
    },
    toggleInfo: {
        flex: 1,
        marginRight: 16,
    },
    toggleLabel: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 4,
    },
    toggleDescription: {
        fontSize: 13,
        color: "#9B9B9B",
    },
    divider: {
        height: 1,
        backgroundColor: "#E8E6E1",
        marginVertical: 12,
    },
    saveButton: {
        backgroundColor: "#1A1A1A",
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: "center",
        marginTop: 8,
        shadowColor: "#FFE500",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: "700",
        color: "#FFFFFF",
    },
    suggestionsContainer: {
        position: 'absolute',
        top: 80,
        left: 0,
        right: 0,
        backgroundColor: "#FFF8E1",
        borderRadius: 12,
        zIndex: 1000,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        borderWidth: 1,
        borderColor: "#FFE500",
    },
    suggestionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: "#F5F5F3",
    },
    suggestionCity: {
        fontSize: 15,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    suggestionDetails: {
        fontSize: 12,
        color: "#9B9B9B",
        marginTop: 2,
    },
});