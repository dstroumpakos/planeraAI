import { useState } from "react";
import React from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, Image, StatusBar, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, DateData } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import { INTERESTS } from "@/lib/data";
import { useTheme } from "@/lib/ThemeContext";
import { useAuthenticatedMutation, useToken } from "@/lib/useAuthenticatedMutation";

import logoImage from "@/assets/images/appicon-1024x1024-01-1vb1vx.png";

// Local Experiences categories
const LOCAL_EXPERIENCES = [
    { id: "local-food", label: "Local food & street food", icon: "restaurant" as const },
    { id: "markets", label: "Traditional markets", icon: "storefront" as const },
    { id: "hidden-gems", label: "Hidden gems", icon: "compass" as const },
    { id: "workshops", label: "Cultural workshops", icon: "color-palette" as const },
    { id: "nature", label: "Nature & outdoor spots", icon: "leaf" as const },
    { id: "nightlife", label: "Nightlife & local bars", icon: "wine" as const },
    { id: "neighborhoods", label: "Neighborhood walks", icon: "walk" as const },
    { id: "festivals", label: "Festivals & seasonal events", icon: "calendar" as const },
];

// Popular destinations list
const DESTINATIONS = [
    { city: "Paris", country: "France", image: "🇫🇷" },
    { city: "Tokyo", country: "Japan", image: "🇯🇵" },
    { city: "New York", country: "USA", image: "🇺🇸" },
    { city: "London", country: "UK", image: "🇬🇧" },
    { city: "Rome", country: "Italy", image: "🇮🇹" },
    { city: "Barcelona", country: "Spain", image: "🇪🇸" },
    { city: "Dubai", country: "UAE", image: "🇦🇪" },
    { city: "Sydney", country: "Australia", image: "🇦🇺" },
    { city: "Amsterdam", country: "Netherlands", image: "🇳🇱" },
    { city: "Bangkok", country: "Thailand", image: "🇹🇭" },
    { city: "Berlin", country: "Germany", image: "🇩🇪" },
    { city: "Budapest", country: "Hungary", image: "🇭🇺" },
    { city: "Dubai", country: "UAE", image: "🇦🇪" },
    { city: "Florence", country: "Italy", image: "🇮🇹" },
    { city: "Hong Kong", country: "Hong Kong", image: "🇭🇰" },
    { city: "Istanbul", country: "Turkey", image: "🇹🇷" },
    { city: "Las Vegas", country: "USA", image: "🇺🇸" },
    { city: "Los Angeles", country: "USA", image: "🇺🇸" },
    { city: "Madrid", country: "Spain", image: "🇪🇸" },
    { city: "Mexico City", country: "Mexico", image: "🇲🇽" },
    { city: "Miami", country: "USA", image: "🇺🇸" },
    { city: "Milan", country: "Italy", image: "🇮🇹" },
    { city: "Moscow", country: "Russia", image: "🇷🇺" },
    { city: "Munich", country: "Germany", image: "🇩🇪" },
    { city: "New Delhi", country: "India", image: "🇮🇳" },
    { city: "Prague", country: "Czech Republic", image: "🇨🇿" },
    { city: "Rio de Janeiro", country: "Brazil", image: "🇧🇷" },
    { city: "San Francisco", country: "USA", image: "🇺🇸" },
    { city: "Seoul", country: "South Korea", image: "🇰🇷" },
    { city: "Shanghai", country: "China", image: "🇨🇳" },
    { city: "Singapore", country: "Singapore", image: "🇸🇬" },
    { city: "Toronto", country: "Canada", image: "🇨🇦" },
    { city: "Venice", country: "Italy", image: "🇮🇹" },
    { city: "Vienna", country: "Austria", image: "🇦🇹" },
    { city: "Zurich", country: "Switzerland", image: "🇨🇭" },
    { city: "Athens", country: "Greece", image: "🇬🇷" },
    { city: "Bali", country: "Indonesia", image: "🇮🇩" },
    { city: "Cairo", country: "Egypt", image: "🇪🇬" },
    { city: "Cape Town", country: "South Africa", image: "🇿🇦" },
    { city: "Cancun", country: "Mexico", image: "🇲🇽" },
    { city: "Copenhagen", country: "Denmark", image: "🇩🇰" },
    { city: "Dublin", country: "Ireland", image: "🇮🇪" },
    { city: "Lisbon", country: "Portugal", image: "🇵🇹" },
    { city: "Marrakech", country: "Morocco", image: "🇲🇦" },
    { city: "Phuket", country: "Thailand", image: "🇹🇭" },
    { city: "Reykjavik", country: "Iceland", image: "🇮🇸" },
    { city: "Stockholm", country: "Sweden", image: "🇸🇪" },
    { city: "Vancouver", country: "Canada", image: "🇨🇦" },
];

export default function CreateTripScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { colors, isDarkMode } = useTheme();
    const prefilledDestination = params.prefilledDestination as string | undefined;
    
    // @ts-ignore
    const createTrip = useAuthenticatedMutation(api.trips.create as any);
    const { token } = useToken();
    // @ts-ignore
    const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" }) as any;
    // V1: Traveler profiles disabled - removed travelers query
    
    const [loading, setLoading] = useState(false);
    const [showCalendar, setShowCalendar] = useState(false);
    const [selectingDate, setSelectingDate] = useState<'start' | 'end'>('start');
    const [showLoadingScreen, setShowLoadingScreen] = useState(false);
    const [showErrorScreen, setShowErrorScreen] = useState(false);
    const [isCreditsError, setIsCreditsError] = useState(false);
    
    // Time picker state for arrival/departure times
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [selectingTime, setSelectingTime] = useState<'arrival' | 'departure'>('arrival');
    const [tempTime, setTempTime] = useState(new Date());

    const [errorMessage, setErrorMessage] = useState("");
    const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
    const [destinationSuggestions, setDestinationSuggestions] = useState<typeof DESTINATIONS>([]);

    const [formData, setFormData] = useState({
        destination: prefilledDestination || "",
        origin: "San Francisco, CA",
        startDate: new Date().getTime(),
        endDate: new Date().getTime() + 7 * 24 * 60 * 60 * 1000,
         // V1: budgetTotal is the primary budget field
        budgetTotal: 2000,
        // V1: travelerCount is the primary traveler count field (1-12)
        travelerCount: 1,
        interests: [] as string[],
        localExperiences: [] as string[],
        skipFlights: false,
        skipHotel: false,
        preferredFlightTime: "any" as "any" | "morning" | "afternoon" | "evening" | "night",
        // Arrival/Departure times (optional, ISO string in destination timezone)
        arrivalTime: null as string | null,
        departureTime: null as string | null,
    });

        // V1: Compute per-person budget on the fly
    const perPersonBudget = Math.round(formData.budgetTotal / formData.travelerCount);


    // Apply user preferences when loaded
    React.useEffect(() => {
        if (userSettings) {
            setFormData(prev => ({
                ...prev,
                origin: userSettings.homeAirport || prev.origin,
                budgetTotal: userSettings.defaultBudget || prev.budgetTotal,
                travelerCount: userSettings.defaultTravelers || prev.travelerCount,
                interests: userSettings.interests && userSettings.interests.length > 0 ? userSettings.interests : prev.interests,
                skipFlights: userSettings.skipFlights ?? prev.skipFlights,
                skipHotel: userSettings.skipHotels ?? prev.skipHotel,
                preferredFlightTime: (userSettings.flightTimePreference as any) || prev.preferredFlightTime,
            }));
        }
    }, [userSettings]);

    // Detect device location on mount - DISABLED
    // Origin is now prefilled by another system
    React.useEffect(() => {
        // Location detection disabled - origin is prefilled externally
    }, []);

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    };

    const searchDestinations = (query: string) => {
        if (query.length < 2) {
            setShowDestinationSuggestions(false);
            setDestinationSuggestions([]);
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = DESTINATIONS.filter(dest => 
            dest.city.toLowerCase().includes(lowerQuery) ||
            dest.country.toLowerCase().includes(lowerQuery)
        ).slice(0, 8);

        setDestinationSuggestions(filtered);
        setShowDestinationSuggestions(filtered.length > 0);
    };

    const selectDestination = (destination: typeof DESTINATIONS[0]) => {
        setFormData({ ...formData, destination: `${destination.city}, ${destination.country}` });
        setShowDestinationSuggestions(false);
        setDestinationSuggestions([]);
    };

    const formatDateForCalendar = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toISOString().split('T')[0];
    };

    // Format time for display (e.g., "3:30 PM")
    const formatTime = (isoString: string | null) => {
        if (!isoString) return "Not set";
        const date = new Date(isoString);
        return date.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
        });
    };

    // Handle time picker change
    const handleTimeChange = (event: any, selectedDate?: Date) => {
        if (Platform.OS === 'android') {
            setShowTimePicker(false);
        }
        
        if (selectedDate) {
            setTempTime(selectedDate);
            
            if (Platform.OS === 'android') {
                // On Android, apply immediately when picker closes
                applySelectedTime(selectedDate);
            }
        }
    };

    // Apply selected time to form data
    const applySelectedTime = (time: Date) => {
        // Combine the appropriate date with the selected time
        const baseTimestamp = selectingTime === 'arrival' ? formData.startDate : formData.endDate;
        const baseDate = new Date(baseTimestamp);
        
        // Create ISO string with the base date and selected time
        const combined = new Date(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            baseDate.getDate(),
            time.getHours(),
            time.getMinutes(),
            0, 0
        );
        
        const isoString = combined.toISOString();
        
        if (selectingTime === 'arrival') {
            setFormData({ ...formData, arrivalTime: isoString });
        } else {
            setFormData({ ...formData, departureTime: isoString });
        }
    };

    // Confirm time selection (iOS)
    const confirmTimeSelection = () => {
        applySelectedTime(tempTime);
        setShowTimePicker(false);
    };

    // Clear time selection
    const clearTime = (type: 'arrival' | 'departure') => {
        if (type === 'arrival') {
            setFormData({ ...formData, arrivalTime: null });
        } else {
            setFormData({ ...formData, departureTime: null });
        }
    };

    const getMarkedDates = () => {
        const startStr = formatDateForCalendar(formData.startDate);
        const endStr = formatDateForCalendar(formData.endDate);
        
        const marked: any = {};
        
        marked[startStr] = {
            startingDay: true,
            color: '#FFE500',
            textColor: 'white',
        };
        
        marked[endStr] = {
            endingDay: true,
            color: '#FFE500',
            textColor: 'white',
        };
        
        const start = new Date(formData.startDate);
        const end = new Date(formData.endDate);
        const current = new Date(start);
        current.setDate(current.getDate() + 1);
        
        while (current < end) {
            const dateStr = current.toISOString().split('T')[0];
            marked[dateStr] = {
                color: '#FFF8E1',
                textColor: '#9B9B9B',
            };
            current.setDate(current.getDate() + 1);
        }
        
        return marked;
    };

    const handleDayPress = (day: DateData) => {
        const selectedTimestamp = new Date(day.dateString).getTime();
        
        if (selectingDate === 'start') {
            if (selectedTimestamp >= formData.endDate) {
                setFormData({
                    ...formData,
                    startDate: selectedTimestamp,
                    endDate: selectedTimestamp + 7 * 24 * 60 * 60 * 1000,
                });
            } else {
                setFormData({ ...formData, startDate: selectedTimestamp });
            }
        } else {
            if (selectedTimestamp <= formData.startDate) {
                Alert.alert("Invalid Date", "End date must be after start date");
                return;
            }
            setFormData({ ...formData, endDate: selectedTimestamp });
        }
        setShowCalendar(false);
    };

     // V1: Traveler profiles disabled - removed getSelectedTravelersWithAges and areAllTravelersReady

    const handleSubmit = async () => {
        if (!formData.destination) {
            Alert.alert("Error", "Please enter a destination");
            return;
        }

        if (!formData.skipFlights && !formData.origin) {
            Alert.alert("Error", "Please enter an origin city");
            return;
        }

          // V1: Validate travelerCount (1-12)
        if (formData.travelerCount < 1 || formData.travelerCount > 12) {
            Alert.alert("Error", "Number of travelers must be between 1 and 12");
            return;
        }

       // V1: Validate budgetTotal
        if (!formData.budgetTotal || isNaN(Number(formData.budgetTotal)) || Number(formData.budgetTotal) <= 0) {
            Alert.alert("Error", "Please enter a valid budget amount");
            return;
        }

        setLoading(true);
        setShowLoadingScreen(true);

        try {
            const tripId = await createTrip({
                destination: formData.destination,
                origin: formData.origin,
                startDate: Number(formData.startDate),
                endDate: Number(formData.endDate),
                // V1: Use new field names
                budgetTotal: Number(formData.budgetTotal),
                travelerCount: Number(formData.travelerCount),
                interests: formData.interests,
                localExperiences: formData.localExperiences,
                skipFlights: formData.skipFlights,
                skipHotel: formData.skipHotel,
                preferredFlightTime: formData.preferredFlightTime,
                // Arrival/Departure times for time-aware itineraries
                arrivalTime: formData.arrivalTime || undefined,
                departureTime: formData.departureTime || undefined,
            });
            
            router.push(`/trip/${tripId}`);
            // Reset states after navigation
            setTimeout(() => {
                setLoading(false);
                setShowLoadingScreen(false);
            }, 500);
        } catch (error: any) {
            console.error("Error creating trip:", error);
            
            // Extract error message
            const errorMsg = error.message || "Failed to create trip. Please try again.";
            // Clean up Convex error prefix if present
            const cleanMessage = errorMsg.replace("Uncaught Error: ", "").replace("Error: ", "");
            
            // Check if this is a credits/plan error
            const isNoCredits = cleanMessage.toLowerCase().includes("credit") || 
                               cleanMessage.toLowerCase().includes("subscribe") ||
                               cleanMessage.toLowerCase().includes("premium") ||
                               cleanMessage.toLowerCase().includes("purchase");
            
            setIsCreditsError(isNoCredits);
            setErrorMessage(isNoCredits 
                ? "You've used all your trip credits. Get more credits or upgrade to Premium for unlimited trips."
                : cleanMessage
            );
            setLoading(false);
            setShowLoadingScreen(false);
            setShowErrorScreen(true);
        }
    };

    const toggleInterest = (interest: string) => {
        if (formData.interests.includes(interest)) {
            setFormData({ ...formData, interests: formData.interests.filter((i) => i !== interest) });
        } else {
            setFormData({ ...formData, interests: [...formData.interests, interest] });
        }
    };

    const toggleLocalExperience = (experienceId: string) => {
        if (formData.localExperiences.includes(experienceId)) {
            setFormData({ ...formData, localExperiences: formData.localExperiences.filter((e) => e !== experienceId) });
        } else {
            setFormData({ ...formData, localExperiences: [...formData.localExperiences, experienceId] });
        }
    };

    if (showLoadingScreen) {
        return (
            <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 24 }} />
                <Text style={[styles.loadingTitle, { color: colors.text }]}>Generating your trip...</Text>
                <Text style={[styles.loadingDestination, { color: colors.primary }]}>{formData.destination}</Text>
                <Text style={[styles.loadingSubtitle, { color: colors.textMuted }]}>This usually takes a few seconds.</Text>
            </SafeAreaView>
        );
    }

    if (showErrorScreen) {
        return (
            <SafeAreaView style={[styles.errorContainer, { backgroundColor: colors.background }]}>
                <View style={styles.errorContent}>
                    <Ionicons 
                        name={isCreditsError ? "wallet" : "alert-circle"} 
                        size={64} 
                        color={isCreditsError ? colors.primary : colors.error} 
                        style={{ marginBottom: 24 }} 
                    />
                    <Text style={[styles.errorTitle, { color: colors.text }]}>
                        {isCreditsError ? "No Trip Credits" : "Trip Generation Failed"}
                    </Text>
                    <Text style={[styles.errorMessage, { color: colors.textMuted }]}>{errorMessage}</Text>
                    
                    {isCreditsError ? (
                        <>
                            <TouchableOpacity 
                                style={[styles.errorButton, { backgroundColor: colors.primary }]}
                                onPress={() => {
                                    setShowErrorScreen(false);
                                    setErrorMessage("");
                                    setIsCreditsError(false);
                                    router.push("/subscription");
                                }}
                            >
                                <Text style={[styles.errorButtonText, { color: "#1A1A1A" }]}>Get More Trips</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.errorButtonSecondary, { borderColor: colors.border }]}
                                onPress={() => {
                                    setShowErrorScreen(false);
                                    setErrorMessage("");
                                    setIsCreditsError(false);
                                }}
                            >
                                <Text style={[styles.errorButtonSecondaryText, { color: colors.text }]}>Go Back</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <TouchableOpacity 
                            style={[styles.errorButton, { backgroundColor: colors.text }]}
                            onPress={() => {
                                setShowErrorScreen(false);
                                setErrorMessage("");
                            }}
                        >
                            <Text style={[styles.errorButtonText, { color: colors.background }]}>Go Back</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        );
    }

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {/* Header */}
                <View style={styles.headerSection}>
                    <View style={styles.headerTop}>
                        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: colors.secondary }]}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <View style={styles.logoContainer}>
                            <Image source={logoImage} style={styles.headerLogo} resizeMode="contain" />
                            <Text style={[styles.headerLogoText, { color: colors.text }]}>PLANERA</Text>
                        </View>
                        <View style={{ width: 44 }} />
                    </View>
                    
                    <View style={styles.titleSection}>
                        <Text style={[styles.titleMain, { color: colors.text }]}>Design your</Text>
                        <Text style={[styles.titleHighlight, { color: colors.text, borderBottomColor: colors.primary }]}>perfect escape</Text>
                        <Text style={[styles.subtitle, { color: colors.textMuted }]}>Let AI craft your itinerary.</Text>
                    </View>
                </View>

                {/* From/To Section */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <View style={styles.locationSection}>
                        <View style={styles.locationItem}>
                            <Text style={[styles.locationLabel, { color: colors.textMuted }]}>FROM</Text>
                            <View style={styles.locationContent}>
                                <Ionicons name="location" size={24} color={colors.text} />
                                <TextInput
                                    style={[styles.locationText, { color: colors.text }]}
                                    placeholder="Where from?"
                                    placeholderTextColor={colors.textMuted}
                                    value={formData.origin}
                                    onChangeText={(text) => setFormData({ ...formData, origin: text })}
                                />
                            </View>
                        </View>

                        <TouchableOpacity style={styles.swapButton}>
                            <Ionicons name="swap-vertical" size={20} color={colors.textMuted} />
                        </TouchableOpacity>

                        <View style={styles.locationItem}>
                            <Text style={[styles.locationLabel, { color: colors.textMuted }]}>TO</Text>
                            <View style={styles.locationContent}>
                                <Ionicons name="location" size={24} color={colors.error} />
                                <TextInput
                                    style={[styles.destinationInput, { color: colors.text }]}
                                    placeholder="Where to?"
                                    placeholderTextColor={colors.textMuted}
                                    value={formData.destination}
                                    onChangeText={(text) => {
                                        setFormData({ ...formData, destination: text });
                                        searchDestinations(text);
                                    }}
                                    onFocus={() => {
                                        if (formData.destination.length >= 2) {
                                            searchDestinations(formData.destination);
                                        }
                                    }}
                                />
                            </View>
                            
                            {showDestinationSuggestions && destinationSuggestions.length > 0 && (
                                <View style={[styles.suggestionsContainer, { backgroundColor: colors.secondary }]}>
                                    <ScrollView nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
                                        {destinationSuggestions.map((dest, index) => (
                                            <TouchableOpacity
                                                key={`${dest.city}-${dest.country}-${index}`}
                                                style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
                                                onPress={() => selectDestination(dest)}
                                            >
                                                <Text style={{ fontSize: 18, marginRight: 12 }}>{dest.image}</Text>
                                                <View>
                                                    <Text style={[styles.suggestionCity, { color: colors.text }]}>{dest.city}</Text>
                                                    <Text style={[styles.suggestionDetails, { color: colors.textMuted }]}>{dest.country}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    </View>

                    <TouchableOpacity style={[styles.multiCityButton, { backgroundColor: colors.inputBackground, borderColor: colors.border }]} disabled={true}>
                        <View style={styles.multiCityContent}>
                            <Ionicons name="git-merge-outline" size={20} color={colors.text} />
                            <Text style={[styles.multiCityText, { color: colors.text }]}>Multi-City Trip</Text>
                        </View>
                        <View style={[styles.comingSoonBadge, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.comingSoonText, { color: colors.text }]}>COMING SOON</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Dates Section */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>DATES</Text>
                    <View style={[styles.datesContainer, { backgroundColor: colors.secondary }]}>
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingDate('start');
                                setShowCalendar(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>START DATE</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(formData.startDate)}</Text>
                            </View>
                        </TouchableOpacity>
                        
                        <View style={[styles.dateSeparator, { backgroundColor: colors.border }]} />

                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingDate('end');
                                setShowCalendar(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>END DATE</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(formData.endDate)}</Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Flight Times Section (Optional) - Affects itinerary timing */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <View style={styles.sectionHeaderRow}>
                        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>FLIGHT TIMES</Text>
                        <View style={[styles.optionalBadge, { backgroundColor: colors.secondary }]}>
                            <Text style={[styles.optionalText, { color: colors.textMuted }]}>OPTIONAL</Text>
                        </View>
                    </View>
                    <Text style={[styles.sectionHelpText, { color: colors.textSecondary }]}>
                        Add your flight times to get a time-aware itinerary. Activities will be scheduled around your arrival and departure.
                    </Text>
                    
                    <View style={[styles.datesContainer, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                        {/* Arrival Time */}
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingTime('arrival');
                                // Initialize temp time based on existing arrival time or default to 3:00 PM
                                const defaultTime = formData.arrivalTime 
                                    ? new Date(formData.arrivalTime) 
                                    : new Date(new Date().setHours(15, 0, 0, 0));
                                setTempTime(defaultTime);
                                setShowTimePicker(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>ARRIVAL AT DESTINATION</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="airplane" size={20} color={colors.text} style={{ transform: [{ rotate: '45deg' }] }} />
                                <Text style={[styles.dateValueText, { color: formData.arrivalTime ? colors.text : colors.textMuted }]}>
                                    {formData.arrivalTime ? formatTime(formData.arrivalTime) : "Tap to set"}
                                </Text>
                                {formData.arrivalTime && (
                                    <TouchableOpacity 
                                        onPress={(e) => { e.stopPropagation(); clearTime('arrival'); }}
                                        style={styles.clearTimeButton}
                                    >
                                        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </TouchableOpacity>
                        
                        <View style={[styles.dateSeparator, { backgroundColor: colors.border }]} />

                        {/* Departure Time */}
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingTime('departure');
                                // Initialize temp time based on existing departure time or default to 6:00 PM
                                const defaultTime = formData.departureTime 
                                    ? new Date(formData.departureTime) 
                                    : new Date(new Date().setHours(18, 0, 0, 0));
                                setTempTime(defaultTime);
                                setShowTimePicker(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>DEPARTURE FROM DESTINATION</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="airplane" size={20} color={colors.text} style={{ transform: [{ rotate: '-45deg' }] }} />
                                <Text style={[styles.dateValueText, { color: formData.departureTime ? colors.text : colors.textMuted }]}>
                                    {formData.departureTime ? formatTime(formData.departureTime) : "Tap to set"}
                                </Text>
                                {formData.departureTime && (
                                    <TouchableOpacity 
                                        onPress={(e) => { e.stopPropagation(); clearTime('departure'); }}
                                        style={styles.clearTimeButton}
                                    >
                                        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </TouchableOpacity>
                    </View>
                    
                    {/* Help text explaining the impact */}
                    {(formData.arrivalTime || formData.departureTime) && (
                        <View style={[styles.timeImpactInfo, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                            <Text style={[styles.timeImpactText, { color: colors.textSecondary }]}>
                                {formData.arrivalTime && !formData.departureTime && 
                                    "Your first day's activities will start after your arrival time."}
                                {!formData.arrivalTime && formData.departureTime && 
                                    "Your last day's activities will end 3 hours before your departure."}
                                {formData.arrivalTime && formData.departureTime && 
                                    "Your itinerary will be adjusted to fit your travel schedule."}
                            </Text>
                        </View>
                    )}
                </View>

  {/* Who's Going Section - V1: Simple Traveler Count (Profiles Disabled) */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>NUMBER OF TRAVELERS <Text style={{ color: colors.error }}>*</Text></Text>
                    {/* V1: Simple stepper for traveler count */}
                    <View style={[styles.numberInputContainer, { backgroundColor: colors.secondary }]}>
                        <View style={styles.counterContainer}>
                            <TouchableOpacity 
                                style={[styles.counterButton, { backgroundColor: colors.card }]}
                                onPress={() => setFormData(prev => ({ 
                                    ...prev, 
                                    travelerCount: Math.max(1, prev.travelerCount - 1) 
                                }))}
                                disabled={formData.travelerCount <= 1}
                            >
                                <Ionicons name="remove" size={24} color={formData.travelerCount <= 1 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            <Text style={[styles.counterValue, { color: colors.text }]}>{formData.travelerCount}</Text>
                            <TouchableOpacity 
                                style={[styles.counterButton, { backgroundColor: colors.card }]}
                                onPress={() => setFormData(prev => ({ 
                                    ...prev, 
                                    travelerCount: Math.min(12, prev.travelerCount + 1) 
                                }))}
                                disabled={formData.travelerCount >= 12}
                            >
                                <Ionicons name="add" size={24} color={formData.travelerCount >= 12 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Budget Section */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>TOTAL BUDGET (EUR) <Text style={{ color: colors.error }}>*</Text></Text>
                    <View style={[styles.budgetInputContainer, { backgroundColor: colors.secondary }]}>
                        <Text style={[styles.currencySymbol, { color: colors.text }]}>€</Text>
                        <TextInput
                            style={[styles.budgetInput, { color: colors.text }]}
                            value={formData.budgetTotal.toString()}
                            onChangeText={(text) => {
                                const value = parseInt(text.replace(/[^0-9]/g, '')) || 0;
                                setFormData({ ...formData, budgetTotal: value });
                            }}
                            keyboardType="numeric"
                            placeholder="Enter total budget"
                            placeholderTextColor={colors.textMuted}
                        />
                    </View>
                       {/* V1: Show per-person budget breakdown */}
                    <View style={[styles.perPersonBudgetContainer, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                        <Ionicons name="person-outline" size={18} color={colors.primary} />
                        <Text style={[styles.perPersonBudgetText, { color: colors.text }]}>
                            Estimated budget per person: <Text style={{ fontWeight: '700', color: colors.primary }}>€{perPersonBudget}</Text>
                        </Text>
                    </View>
                </View>

                {/* Travel Style Section */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Travel Style</Text>
                    <View style={styles.interestsContainer}>
                        {INTERESTS.map((interest) => (
                            <TouchableOpacity
                                key={interest}
                                style={[
                                    styles.interestTag,
                                    { backgroundColor: colors.secondary, borderColor: colors.primary },
                                    formData.interests.includes(interest) && { backgroundColor: colors.primary },
                                ]}
                                onPress={() => toggleInterest(interest)}
                            >
                                <Ionicons 
                                    name={
                                        interest === "Adventure" ? "trail-sign" : 
                                        interest === "Culinary" ? "restaurant" : 
                                        interest === "Culture" ? "library" :
                                        interest === "Relaxation" ? "cafe" :
                                        interest === "Nightlife" ? "wine" :
                                        interest === "Nature" ? "leaf" :
                                        interest === "History" ? "book" :
                                        interest === "Shopping" ? "cart" :
                                        interest === "Luxury" ? "diamond" :
                                        "people"
                                    } 
                                    size={20} 
                                    color={formData.interests.includes(interest) ? colors.text : colors.primary}
                                />
                                <Text style={[
                                    styles.interestTagText,
                                    { color: colors.text },
                                ]}>
                                    {interest}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Local Experiences Section (Optional) */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Local Experiences</Text>
                    <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                        Experience the destination like a local (optional)
                    </Text>
                    <View style={styles.localExperiencesContainer}>
                        {LOCAL_EXPERIENCES.map((experience) => (
                            <TouchableOpacity
                                key={experience.id}
                                style={[
                                    styles.localExperienceTag,
                                    { backgroundColor: colors.secondary, borderColor: colors.primary },
                                    formData.localExperiences.includes(experience.id) && { backgroundColor: colors.primary },
                                ]}
                                onPress={() => toggleLocalExperience(experience.id)}
                            >
                                <Ionicons 
                                    name={experience.icon}
                                    size={18} 
                                    color={formData.localExperiences.includes(experience.id) ? colors.text : colors.primary}
                                />
                                <Text style={[
                                    styles.localExperienceTagText,
                                    { color: colors.text },
                                ]}>
                                    {experience.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Generate Button */}
                <TouchableOpacity 
                    style={[styles.generateButton, { backgroundColor: colors.text }, loading && styles.disabledButton]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={colors.background} />
                    ) : (
                        <>
                            <Text style={[styles.generateButtonText, { color: colors.background }]}>Generate with Planera AI</Text>
                            <View style={[styles.sparkleIcon, { backgroundColor: colors.primary }]}>
                                <Ionicons name="sparkles" size={20} color={colors.text} />
                            </View>
                        </>
                    )}
                </TouchableOpacity>

                {/* Calendar Modal */}
                <Modal
                    visible={showCalendar}
                    animationType="slide"
                    transparent={true}
                    onRequestClose={() => setShowCalendar(false)}
                >
                    <View style={styles.modalOverlay}>
                        <View style={[styles.calendarModal, { backgroundColor: colors.card }]}>
                            <View style={[styles.calendarHeader, { borderBottomColor: colors.border }]}>
                                <Text style={[styles.calendarTitle, { color: colors.text }]}>
                                    Select {selectingDate === 'start' ? 'Departure' : 'Return'} Date
                                </Text>
                                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                    <Ionicons name="close" size={24} color={colors.text} />
                                </TouchableOpacity>
                            </View>
                            
                            <Calendar
                                current={formatDateForCalendar(selectingDate === 'start' ? formData.startDate : formData.endDate)}
                                minDate={selectingDate === 'start' ? formatDateForCalendar(Date.now()) : formatDateForCalendar(formData.startDate + 24 * 60 * 60 * 1000)}
                                onDayPress={handleDayPress}
                                markingType={'period'}
                                markedDates={getMarkedDates()}
                                theme={{
                                    backgroundColor: colors.card,
                                    calendarBackground: colors.card,
                                    textSectionTitleColor: colors.primary,
                                    selectedDayBackgroundColor: colors.primary,
                                    selectedDayTextColor: colors.text,
                                    todayTextColor: colors.primary,
                                    dayTextColor: colors.text,
                                    textDisabledColor: colors.border,
                                    dotColor: colors.primary,
                                    selectedDotColor: colors.text,
                                    arrowColor: colors.primary,
                                    monthTextColor: colors.text,
                                    textDayFontWeight: '500',
                                    textMonthFontWeight: '700',
                                    textDayHeaderFontWeight: '600',
                                    textDayFontSize: 16,
                                    textMonthFontSize: 18,
                                    textDayHeaderFontSize: 14,
                                }}
                                style={styles.calendar}
                            />
                        </View>
                    </View>
                </Modal>

                {/* Time Picker Modal for Arrival/Departure times */}
                {Platform.OS === 'ios' ? (
                    <Modal
                        visible={showTimePicker}
                        animationType="slide"
                        transparent={true}
                        onRequestClose={() => setShowTimePicker(false)}
                    >
                        <View style={styles.modalOverlay}>
                            <View style={[styles.calendarModal, { backgroundColor: colors.card }]}>
                                <View style={[styles.calendarHeader, { borderBottomColor: colors.border }]}>
                                    <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                                        <Text style={[styles.cancelButtonText, { color: colors.error }]}>Cancel</Text>
                                    </TouchableOpacity>
                                    <Text style={[styles.calendarTitle, { color: colors.text }]}>
                                        {selectingTime === 'arrival' ? 'Arrival Time' : 'Departure Time'}
                                    </Text>
                                    <TouchableOpacity onPress={confirmTimeSelection}>
                                        <Text style={[styles.doneButtonText, { color: colors.primary }]}>Done</Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.timePickerContainer}>
                                    <Text style={[styles.timePickerLabel, { color: colors.textMuted }]}>
                                        {selectingTime === 'arrival' 
                                            ? 'What time will you arrive at your destination?' 
                                            : 'What time is your departure flight?'}
                                    </Text>
                                    <DateTimePicker
                                        value={tempTime}
                                        mode="time"
                                        display="spinner"
                                        onChange={handleTimeChange}
                                        textColor={colors.text}
                                        style={{ height: 200 }}
                                    />
                                    <Text style={[styles.timePickerHint, { color: colors.textSecondary }]}>
                                        {selectingTime === 'arrival' 
                                            ? 'Your first day activities will be scheduled after this time.' 
                                            : 'Your last day will end ~3 hours before this time.'}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </Modal>
                ) : (
                    showTimePicker && (
                        <DateTimePicker
                            value={tempTime}
                            mode="time"
                            display="default"
                            onChange={handleTimeChange}
                        />
                    )
                )}
            </ScrollView>
        </SafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FAF9F6",
    },
    content: {
        paddingBottom: 40,
    },
    headerSection: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 24,
    },
    headerTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        justifyContent: "center",
        alignItems: "center",
    },
    logoContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
    },
    headerLogo: {
        width: 56,
        height: 56,
        marginRight: -14,
    },
    headerLogoText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
        letterSpacing: 1,
    },
    settingsButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        justifyContent: "center",
        alignItems: "center",
    },
    titleSection: {
        marginBottom: 8,
    },
    titleMain: {
        fontSize: 32,
        fontWeight: "400",
        color: "#1A1A1A",
        lineHeight: 40,
    },
    titleHighlight: {
        fontSize: 40,
        fontWeight: "800",
        color: "#1A1A1A",
        lineHeight: 48,
        marginBottom: 8,
        borderBottomWidth: 4,
        borderBottomColor: "#FFE500",
        paddingBottom: 4,
        alignSelf: "flex-start",
    },
    subtitle: {
        fontSize: 16,
        color: "#9B9B9B",
        fontWeight: "500",
    },
    card: {
        backgroundColor: "white",
        borderRadius: 20,
        padding: 20,
        marginHorizontal: 20,
        marginBottom: 16,
        shadowColor: "#1A1A1A",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        letterSpacing: 1,
        marginBottom: 12,
        textTransform: "uppercase",
    },
    sectionHelpText: {
        fontSize: 13,
        color: "#9B9B9B",
        lineHeight: 18,
    },
    optionalBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
    },
    optionalText: {
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
    clearTimeButton: {
        marginLeft: 8,
        padding: 2,
    },
    timeImpactInfo: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 12,
        borderRadius: 8,
    },
    timeImpactText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
    },
    timePickerContainer: {
        padding: 20,
        alignItems: "center",
    },
    timePickerLabel: {
        fontSize: 15,
        textAlign: "center",
        marginBottom: 16,
    },
    timePickerHint: {
        fontSize: 13,
        textAlign: "center",
        marginTop: 16,
        paddingHorizontal: 20,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: "500",
    },
    doneButtonText: {
        fontSize: 16,
        fontWeight: "600",
    },
    locationSection: {
        gap: 12,
    },
    locationItem: {
        gap: 8,
    },
    locationLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        letterSpacing: 1,
        textTransform: "uppercase",
    },
    locationContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    locationText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    destinationInput: {
        flex: 1,
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
        padding: 0,
    },
    swapButton: {
        alignSelf: "center",
        padding: 8,
    },
    suggestionsContainer: {
        backgroundColor: "#FFF8E1",
        borderRadius: 12,
        marginTop: 8,
        maxHeight: 200,
        overflow: "hidden",
    },
    suggestionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#F5F5F3",
    },
    suggestionCity: {
        fontSize: 15,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    suggestionDetails: {
        fontSize: 13,
        color: "#9B9B9B",
        marginTop: 2,
    },
    skipFlightsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#E8E6E1',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: '#1A1A1A',
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        backgroundColor: '#FFE500',
        borderColor: '#FFE500',
    },
    skipFlightsText: {
        fontSize: 14,
        color: '#1A1A1A',
        fontWeight: '500',
    },
    multiCityButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#F9F9F9',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E5E5',
    },
    multiCityContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    multiCityText: {
        fontSize: 15,
        color: '#1A1A1A',
        fontWeight: '600',
    },
    comingSoonBadge: {
        backgroundColor: '#FFE500',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    comingSoonText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    datesContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        padding: 4,
    },
    dateInputButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    dateSeparator: {
        width: 1,
        height: "60%",
        backgroundColor: "#E8E6E1",
    },
    dateLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    dateValueContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dateValueText: {
        fontSize: 15,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    numberInputContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    inputLabel: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    counterContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
    },
    counterButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "white",
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    counterValue: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
        minWidth: 24,
        textAlign: "center",
    },
    budgetInputContainer: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    currencySymbol: {
        fontSize: 20,
        fontWeight: "600",
        color: "#1A1A1A",
        marginRight: 8,
    },
    budgetInput: {
        flex: 1,
        fontSize: 24,
        fontWeight: '600',
        color: '#1A1A1A',
        padding: 0,
    },
     perPersonBudgetContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
    },
    perPersonBudgetText: {
        fontSize: 14,
        fontWeight: '500',
    },
    interestsContainer: {
        flexDirection: "row",
        gap: 12,
        flexWrap: "wrap",
    },
    interestTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        borderWidth: 2,
        borderColor: "#FFE500",
    },
    interestTagActive: {
        backgroundColor: "#FFE500",
        borderColor: "#FFE500",
    },
    interestTagText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    interestTagTextActive: {
        color: "#1A1A1A",
    },
    sectionSubtitle: {
        fontSize: 14,
        fontWeight: "500",
        marginBottom: 16,
        marginTop: -4,
    },
    localExperiencesContainer: {
        flexDirection: "row",
        gap: 10,
        flexWrap: "wrap",
    },
    localExperienceTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: "#FFF8E1",
        borderWidth: 2,
        borderColor: "#FFE500",
    },
    localExperienceTagText: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    generateButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        marginHorizontal: 20,
        marginTop: 24,
        paddingVertical: 18,
        backgroundColor: "#1A1A1A",
        borderRadius: 18,
        shadowColor: "#FFE500",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    disabledButton: {
        opacity: 0.7,
    },
    generateButtonText: {
        fontSize: 17,
        fontWeight: "700",
        color: "white",
    },
    sparkleIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: "#FFE500",
        justifyContent: "center",
        alignItems: "center",
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(26, 26, 26, 0.2)",
        justifyContent: "flex-end",
    },
    calendarModal: {
        backgroundColor: "white",
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingBottom: 40,
    },
    calendarHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: "#E8E6E1",
    },
    calendarTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    calendar: {
        marginHorizontal: 10,
    },
    loadingContainer: {
        flex: 1,
        backgroundColor: "#FAF9F6",
        alignItems: "center",
        justifyContent: "center",
    },
    loadingTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 8,
        textAlign: "center",
    },
    loadingDestination: {
        fontSize: 24,
        fontWeight: "800",
        color: "#FFE500",
        marginBottom: 16,
        textAlign: "center",
    },
    loadingSubtitle: {
        fontSize: 16,
        color: "#9B9B9B",
        textAlign: "center",
    },
    errorContainer: {
        flex: 1,
        backgroundColor: "#FAF9F6",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    errorContent: {
        alignItems: "center",
        maxWidth: 320,
    },
    errorTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 12,
        textAlign: "center",
    },
    errorMessage: {
        fontSize: 16,
        color: "#9B9B9B",
        textAlign: "center",
        marginBottom: 32,
        lineHeight: 24,
    },
    errorButton: {
        paddingVertical: 14,
        paddingHorizontal: 32,
        backgroundColor: "#1A1A1A",
        borderRadius: 12,
        minWidth: 200,
        alignItems: "center",
    },
    errorButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: "white",
    },
    errorButtonSecondary: {
        paddingVertical: 14,
        paddingHorizontal: 32,
        backgroundColor: "transparent",
        borderRadius: 12,
        minWidth: 200,
        alignItems: "center",
        borderWidth: 1,
        marginTop: 12,
    },
    errorButtonSecondaryText: {
        fontSize: 16,
        fontWeight: "600",
    },
    // Traveler selection styles
    sectionHeaderRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    manageTravelersLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    manageTravelersText: {
        fontSize: 13,
        fontWeight: "600",
    },
    addTravelerPrompt: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        gap: 12,
    },
    addTravelerPromptText: {
        flex: 1,
    },
    addTravelerTitle: {
        fontSize: 15,
        fontWeight: "600",
        marginBottom: 2,
    },
    addTravelerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    travelersList: {
        gap: 10,
    },
    travelerSelectItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        gap: 12,
    },
    travelerCheckbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        justifyContent: "center",
        alignItems: "center",
    },
    travelerSelectInfo: {
        flex: 1,
    },
    travelerNameRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 2,
    },
    travelerSelectName: {
        fontSize: 15,
        fontWeight: "600",
    },
    primaryBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    primaryBadgeText: {
        fontSize: 10,
        fontWeight: "600",
        color: "#000",
    },
    travelerMetaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    travelerSelectMeta: {
        fontSize: 13,
    },
    incompleteWarning: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    incompleteText: {
        fontSize: 12,
        color: "#DC2626",
        fontWeight: "500",
    },
    addAnotherTraveler: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        gap: 8,
        marginTop: 4,
    },
    addAnotherText: {
        fontSize: 14,
        fontWeight: "600",
    },
    passengerSummary: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderRadius: 10,
        marginTop: 12,
        gap: 8,
        borderWidth: 1,
    },
    passengerSummaryText: {
        fontSize: 13,
        fontWeight: "500",
    },
});
