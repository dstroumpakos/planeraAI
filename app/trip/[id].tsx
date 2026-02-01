import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Image, Linking, Platform, Alert, Modal, TextInput, KeyboardAvoidingView, Keyboard, StatusBar } from "react-native";
import { useQuery, useMutation, useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect, useRef } from "react";
import { BlurView } from "expo-blur";
import { useDestinationImage } from "@/lib/useImages";
import ActivityCard from "@/components/ActivityCard";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useTheme } from "@/lib/ThemeContext";
import { LinearGradient } from "expo-linear-gradient";
import { useAuthenticatedMutation, useToken } from "@/lib/useAuthenticatedMutation";

import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar } from 'react-native-calendars';
import { INTERESTS } from "@/lib/data";

// Cart item type for local state
interface CartItem {
    name: string;
    day?: number;
    skipTheLine?: boolean;
}

// Airport code to full name mapping
const AIRPORT_NAMES: Record<string, string> = {
    // Greece
    "ATH": "Athens International Airport (ATH)",
    "SKG": "Thessaloniki Airport (SKG)",
    "HER": "Heraklion Airport (HER)",
    "RHO": "Rhodes Airport (RHO)",
    "CFU": "Corfu Airport (CFU)",
    "CHQ": "Chania Airport (CHQ)",
    "JMK": "Mykonos Airport (JMK)",
    "JTR": "Santorini Airport (JTR)",
    "KGS": "Kos Airport (KGS)",
    "ZTH": "Zakynthos Airport (ZTH)",
    // UK
    "LHR": "London Heathrow (LHR)",
    "LGW": "London Gatwick (LGW)",
    "STN": "London Stansted (STN)",
    "LTN": "London Luton (LTN)",
    "MAN": "Manchester Airport (MAN)",
    "BHX": "Birmingham Airport (BHX)",
    "EDI": "Edinburgh Airport (EDI)",
    // France
    "CDG": "Paris Charles de Gaulle (CDG)",
    "ORY": "Paris Orly (ORY)",
    "NCE": "Nice Côte d'Azur (NCE)",
    "LYS": "Lyon Airport (LYS)",
    "MRS": "Marseille Airport (MRS)",
    // Germany
    "FRA": "Frankfurt Airport (FRA)",
    "MUC": "Munich Airport (MUC)",
    "BER": "Berlin Brandenburg (BER)",
    "DUS": "Düsseldorf Airport (DUS)",
    "HAM": "Hamburg Airport (HAM)",
    // Italy
    "FCO": "Rome Fiumicino (FCO)",
    "MXP": "Milan Malpensa (MXP)",
    "VCE": "Venice Marco Polo (VCE)",
    "NAP": "Naples Airport (NAP)",
    "BGY": "Milan Bergamo (BGY)",
    // Spain
    "MAD": "Madrid Barajas (MAD)",
    "BCN": "Barcelona El Prat (BCN)",
    "PMI": "Palma de Mallorca (PMI)",
    "AGP": "Málaga Airport (AGP)",
    "ALC": "Alicante Airport (ALC)",
    "IBZ": "Ibiza Airport (IBZ)",
    // Netherlands
    "AMS": "Amsterdam Schiphol (AMS)",
    // Belgium
    "BRU": "Brussels Airport (BRU)",
    // Portugal
    "LIS": "Lisbon Airport (LIS)",
    "OPO": "Porto Airport (OPO)",
    "FAO": "Faro Airport (FAO)",
    // Turkey
    "IST": "Istanbul Airport (IST)",
    "SAW": "Istanbul Sabiha Gökçen (SAW)",
    "AYT": "Antalya Airport (AYT)",
    // UAE
    "DXB": "Dubai International (DXB)",
    "AUH": "Abu Dhabi Airport (AUH)",
    // USA
    "JFK": "New York JFK (JFK)",
    "LAX": "Los Angeles LAX (LAX)",
    "ORD": "Chicago O'Hare (ORD)",
    "MIA": "Miami International (MIA)",
    "SFO": "San Francisco (SFO)",
    "ATL": "Atlanta Hartsfield (ATL)",
    // Other popular
    "DUB": "Dublin Airport (DUB)",
    "ZRH": "Zurich Airport (ZRH)",
    "VIE": "Vienna Airport (VIE)",
    "PRG": "Prague Airport (PRG)",
    "BUD": "Budapest Airport (BUD)",
    "WAW": "Warsaw Chopin (WAW)",
    "CPH": "Copenhagen Airport (CPH)",
    "ARN": "Stockholm Arlanda (ARN)",
    "OSL": "Oslo Gardermoen (OSL)",
    "HEL": "Helsinki Airport (HEL)",
    "SIN": "Singapore Changi (SIN)",
    "HKG": "Hong Kong International (HKG)",
    "NRT": "Tokyo Narita (NRT)",
    "ICN": "Seoul Incheon (ICN)",
    "SYD": "Sydney Airport (SYD)",
    "MEL": "Melbourne Airport (MEL)",
    "YYZ": "Toronto Pearson (YYZ)",
    "YVR": "Vancouver Airport (YVR)",
};

// City name to airport code mapping (for reverse lookup)
const CITY_TO_AIRPORT: Record<string, string> = {
    // Greece
    "athens": "ATH",
    "thessaloniki": "SKG",
    "heraklion": "HER",
    "rhodes": "RHO",
    "corfu": "CFU",
    "chania": "CHQ",
    "mykonos": "JMK",
    "santorini": "JTR",
    "kos": "KGS",
    "zakynthos": "ZTH",
    // UK
    "london": "LHR",
    "manchester": "MAN",
    "birmingham": "BHX",
    "edinburgh": "EDI",
    // France
    "paris": "CDG",
    "nice": "NCE",
    "lyon": "LYS",
    "marseille": "MRS",
    // Germany
    "frankfurt": "FRA",
    "munich": "MUC",
    "berlin": "BER",
    "dusseldorf": "DUS",
    "düsseldorf": "DUS",
    "hamburg": "HAM",
    // Italy
    "rome": "FCO",
    "milan": "MXP",
    "venice": "VCE",
    "naples": "NAP",
    // Spain
    "madrid": "MAD",
    "barcelona": "BCN",
    "palma": "PMI",
    "mallorca": "PMI",
    "malaga": "AGP",
    "málaga": "AGP",
    "alicante": "ALC",
    "ibiza": "IBZ",
    // Netherlands
    "amsterdam": "AMS",
    // Belgium
    "brussels": "BRU",
    // Portugal
    "lisbon": "LIS",
    "porto": "OPO",
    "faro": "FAO",
    // Turkey
    "istanbul": "IST",
    "antalya": "AYT",
    // UAE
    "dubai": "DXB",
    "abu dhabi": "AUH",
    // USA
    "new york": "JFK",
    "los angeles": "LAX",
    "chicago": "ORD",
    "miami": "MIA",
    "san francisco": "SFO",
    "atlanta": "ATL",
    // Other
    "dublin": "DUB",
    "zurich": "ZRH",
    "vienna": "VIE",
    "prague": "PRG",
    "budapest": "BUD",
    "warsaw": "WAW",
    "copenhagen": "CPH",
    "stockholm": "ARN",
    "oslo": "OSL",
    "helsinki": "HEL",
    "singapore": "SIN",
    "hong kong": "HKG",
    "tokyo": "NRT",
    "seoul": "ICN",
    "sydney": "SYD",
    "melbourne": "MEL",
    "toronto": "YYZ",
    "vancouver": "YVR",
};

// Helper function to get full airport name
const getAirportName = (codeOrCity: string | undefined): string => {
    if (!codeOrCity) return "Unknown";
    
    // Check if it's a known airport code (exact match)
    const upperCode = codeOrCity.toUpperCase().trim();
    if (AIRPORT_NAMES[upperCode]) {
        return AIRPORT_NAMES[upperCode];
    }
    
    // Check if the string contains an airport code in parentheses
    const codeMatch = codeOrCity.match(/\(([A-Z]{3})\)/);
    if (codeMatch && AIRPORT_NAMES[codeMatch[1]]) {
        return AIRPORT_NAMES[codeMatch[1]];
    }
    
    // Try to find a city name match
    const lowerInput = codeOrCity.toLowerCase().trim();
    
    // Direct city match
    if (CITY_TO_AIRPORT[lowerInput]) {
        return AIRPORT_NAMES[CITY_TO_AIRPORT[lowerInput]];
    }
    
    // Check if input contains a known city name
    for (const [city, code] of Object.entries(CITY_TO_AIRPORT)) {
        if (lowerInput.includes(city)) {
            return AIRPORT_NAMES[code];
        }
    }
    
    // Return the original value if no mapping found
    return codeOrCity;
};

export default function TripDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { token } = useToken();
    const trip = useQuery(token ? (api.trips.get as any) : "skip", token ? { token, tripId: id as Id<"trips"> } : "skip");
    const updateTrip = useAuthenticatedMutation(api.trips.update as any);
    const regenerateTrip = useAuthenticatedMutation(api.trips.regenerate as any);
    const trackClick = useMutation(api.bookings.trackClick);
    const insights = useQuery(api.insights.getDestinationInsights, trip ? { destination: trip.destination } : "skip");
    const { image: destinationImage } = useDestinationImage(trip?.destination);
    const getDestinationImages = useAction(api.images.getDestinationImages);
     
    // V1: AI-generated Top 5 Sights (replaces Viator activities)
    const topSights = useQuery(api.sights.getTopSights, trip ? { tripId: id as Id<"trips"> } : "skip");
    const generateTopSights = useMutation(api.sights.generateTopSights);
    const [generatingSights, setGeneratingSights] = useState(false);


    // Loading screen state
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [loadingImages, setLoadingImages] = useState<Array<{url: string; photographer: string}>>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const imageInterval = useRef<ReturnType<typeof setInterval> | null>(null);

    const [selectedHotelIndex, setSelectedHotelIndex] = useState<number | null>(null);
    const [accommodationType, setAccommodationType] = useState<'all' | 'hotel' | 'airbnb'>('all');
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({
        destination: "",
        origin: "",
        startDate: 0,
        endDate: 0,
        budget: 0,
        travelers: 1,
        interests: [] as string[],
    });
    const [showCalendar, setShowCalendar] = useState(false);
    const [selectingDate, setSelectingDate] = useState<'start' | 'end'>('start');
    const [regenerationCount, setRegenerationCount] = useState(0);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<'start' | 'end'>('start');
    const [addingToCart, setAddingToCart] = useState<string | null>(null); // Track which item is being added
    const [selectedFlightIndex, setSelectedFlightIndex] = useState<number>(0);
    const [checkedBaggageSelected, setCheckedBaggageSelected] = useState<boolean>(false);
    const [activeFilter, setActiveFilter] = useState<'all' | 'flights' | 'food' | 'sights' | 'stays' | 'transportation'>('all');

    useEffect(() => {
        if (trip) {
            // Convert old string budget to number
            let budgetValue = 0;
            if (typeof trip.budget === "number") {
                budgetValue = trip.budget;
            } else if (typeof trip.budget === "string") {
                // Convert old string format to numbers
                const budgetMap: Record<string, number> = {
                    "Low": 1000,
                    "Medium": 2000,
                    "High": 4000,
                    "Luxury": 8000,
                };
                budgetValue = budgetMap[trip.budget] || 2000;
            }
            
            setEditForm({
                destination: trip.destination,
                origin: trip.origin || "",
                startDate: trip.startDate,
                endDate: trip.endDate,
                budget: budgetValue,
                travelers: trip.travelers || 1,
                interests: Array.isArray(trip.interests) ? trip.interests : [],
            });
        }
    }, [trip]);

    const handleSaveAndRegenerate = async () => {
        if (!trip) return;
        
        if (regenerationCount >= 1) {
            Alert.alert("Limit Reached", "You can only regenerate your trip once.");
            return;
        }
        
        await updateTrip({
            tripId: trip._id,
            destination: editForm.destination,
            origin: editForm.origin,
            startDate: editForm.startDate,
            endDate: editForm.endDate,
            budget: editForm.budget,
            travelers: editForm.travelers,
            interests: editForm.interests,
        });
        await regenerateTrip({ tripId: trip._id });
        setRegenerationCount(regenerationCount + 1);
        setIsEditing(false);
    };

    const formatDate = (date: number) => {
        return new Date(date).toLocaleDateString();
    };

    const formatDateForCalendar = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toISOString().split('T')[0];
    };

    const toggleInterest = (interest: string) => {
        if (editForm.interests.includes(interest)) {
            setEditForm({ ...editForm, interests: editForm.interests.filter((i) => i !== interest) });
        } else {
            setEditForm({ ...editForm, interests: [...editForm.interests, interest] });
        }
    };

    const handleDayPress = (day: any) => {
        const newDate = new Date(day.dateString);
        const timestamp = newDate.getTime();
        
        if (selectingDate === 'start') {
            setEditForm(prev => ({
                ...prev,
                startDate: timestamp,
            }));
        } else {
            setEditForm(prev => ({
                ...prev,
                endDate: timestamp,
            }));
        }
        setShowCalendar(false);
    };

    const getMarkedDates = () => {
        const startStr = formatDateForCalendar(editForm.startDate);
        const endStr = formatDateForCalendar(editForm.endDate);
        
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
        
        const start = new Date(editForm.startDate);
        const end = new Date(editForm.endDate);
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

    // Fetch destination images for loading screen
    useEffect(() => {
        if (trip?.status === "generating" && trip?.destination) {
            // Fetch images for the destination
            getDestinationImages({ destination: trip.destination, count: 5 })
                .then((images) => {
                    if (images && images.length > 0) {
                        setLoadingImages(images.map((img: { url: string; photographer: string }) => ({
                            url: img.url,
                            photographer: img.photographer
                        })));
                    }
                })
                .catch(console.error);

            // Start progress animation
            setLoadingProgress(0);
            progressInterval.current = setInterval(() => {
                setLoadingProgress(prev => {
                    if (prev >= 95) return prev; // Cap at 95% until done
                    return prev + Math.random() * 3;
                });
            }, 500);

            return () => {
                if (progressInterval.current) clearInterval(progressInterval.current);
            };
        }
    }, [trip?.status, trip?.destination]);

    // Cycle through images
    useEffect(() => {
        if (loadingImages.length > 1) {
            imageInterval.current = setInterval(() => {
                setCurrentImageIndex(prev => (prev + 1) % loadingImages.length);
            }, 3000);

            return () => {
                if (imageInterval.current) clearInterval(imageInterval.current);
            };
        }
    }, [loadingImages.length]);

    if (trip === undefined) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!trip) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text }}>Trip not found</Text>
            </View>
        );
    }

    if (trip.status === "generating") {
        const currentImage = loadingImages[currentImageIndex];
        
        return (
            <View style={styles.loadingContainer}>
                {/* Background Image Slideshow */}
                {currentImage ? (
                    <Image 
                        source={{ uri: currentImage.url }} 
                        style={styles.loadingBackgroundImage}
                        blurRadius={Platform.OS === 'ios' ? 1 : 0.5}
                    />
                ) : (
                    <View style={[styles.loadingBackgroundImage, { backgroundColor: '#1A1A1A' }]} />
                )}
                
                {/* Dark Overlay */}
                <LinearGradient
                    colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']}
                    style={styles.loadingOverlay}
                />
                
                {/* Content */}
                <SafeAreaView style={styles.loadingContent}>
                    {/* Back Button */}
                    <TouchableOpacity 
                        style={styles.loadingBackButton} 
                        onPress={() => router.back()}
                    >
                        <Ionicons name="chevron-back" size={24} color="white" />
                    </TouchableOpacity>
                    
                    {/* Center Content */}
                    <View style={styles.loadingCenterContent}>
                        {/* Trip Title with Route */}
                        <View style={styles.loadingTitleContainer}>
                            <Text style={styles.loadingDestination}>{trip.origin || "Unknown"}</Text>
                            <Ionicons name="arrow-down" size={20} color="#FFE500" style={styles.loadingArrow} />
                            <Text style={styles.loadingDestination}>{trip.destination}</Text>
                        </View>
                        
                        {/* Trip Details */}
                        <View style={styles.loadingTripDetails}>
                            <Text style={styles.loadingTripDetailText}>
                                {trip.travelers || 1} traveler{(trip.travelers || 1) !== 1 ? 's' : ''} • {Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24))} days
                            </Text>
                        </View>
                        
                        {/* Animated Plane Icon */}
                        <View style={styles.loadingIconContainer}>
                            <Ionicons name="airplane" size={48} color="#FFE500" />
                        </View>
                        
                        {/* Status Text */}
                        <Text style={styles.loadingTitle}>Creating your perfect trip</Text>
                        <Text style={styles.loadingSubtitle}>
                            Building your itinerary...
                        </Text>
                        
                        {/* Progress Bar */}
                        <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBackground}>
                                <View 
                                    style={[
                                        styles.progressBarFill, 
                                        { width: `${Math.min(loadingProgress, 100)}%` }
                                    ]} 
                                />
                            </View>
                            <Text style={styles.progressText}>{Math.round(loadingProgress)}%</Text>
                        </View>
                        
                        {/* Loading Steps */}
                        <View style={styles.loadingSteps}>
                            <View style={styles.loadingStep}>
                                <Ionicons 
                                    name={loadingProgress > 33 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 33 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 33 && styles.loadingStepComplete]}>
                                    Creating itinerary
                                </Text>
                            </View>
                            <View style={styles.loadingStep}>
                                <Ionicons 
                                    name={loadingProgress > 66 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 66 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 66 && styles.loadingStepComplete]}>
                                    Adding activities
                                </Text>
                            </View>
                            <View style={styles.loadingStep}>
                                <Ionicons 
                                    name={loadingProgress > 70 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 70 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 70 && styles.loadingStepComplete]}>
                                    Curating activities
                                </Text>
                            </View>
                            <View style={styles.loadingStep}>
                                <Ionicons 
                                    name={loadingProgress > 90 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 90 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 90 && styles.loadingStepComplete]}>
                                    Building your itinerary
                                </Text>
                            </View>
                        </View>
                    </View>
                    
                    {/* Photo Attribution */}
                    {currentImage && (
                        <View style={styles.loadingAttribution}>
                            <Text style={styles.loadingAttributionText}>
                                Photo by {currentImage.photographer} on Unsplash
                            </Text>
                        </View>
                    )}
                </SafeAreaView>
                
                {/* Image Indicators */}
                {loadingImages.length > 1 && (
                    <View style={styles.imageIndicators}>
                        {loadingImages.map((_, index) => (
                            <View 
                                key={index} 
                                style={[
                                    styles.imageIndicator,
                                    currentImageIndex === index && styles.imageIndicatorActive
                                ]} 
                            />
                        ))}
                    </View>
                )}
            </View>
        );
    }

    if (trip.status === "failed") {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={64} color={colors.error} />
                    <Text style={[styles.errorTitle, { color: colors.text }]}>Failed to Generate Trip</Text>
                    <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
                        We encountered an error while generating your itinerary. Please try again.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.errorButton, { backgroundColor: colors.primary }]}
                        onPress={() => router.back()}
                    >
                        <Text style={[styles.errorButtonText, { color: colors.text }]}>Go Back</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const { itinerary } = trip;

    // Calculate duration in days
    const duration = Math.ceil((trip.endDate - trip.startDate) / (1000 * 60 * 60 * 24));
    const travelers = trip.travelers || 1;

    const allAccommodations = Array.isArray(trip.itinerary?.hotels) ? trip.itinerary.hotels : [];
    
    // Filter accommodations based on selected type
    const filteredAccommodations = accommodationType === 'all' 
        ? allAccommodations 
        : allAccommodations.filter((acc: any) => acc.type === accommodationType);
    
    // Get hotels and airbnbs counts
    const hotelsCount = allAccommodations.filter((acc: any) => acc.type === 'hotel' || !acc.type).length;
    const airbnbsCount = allAccommodations.filter((acc: any) => acc.type === 'airbnb').length;
    
    const selectedAccommodation = selectedHotelIndex !== null && allAccommodations.length > 0
        ? allAccommodations[selectedHotelIndex] 
        : (allAccommodations.length > 0 ? allAccommodations[0] : null);
    
    // Get selected flight from options if available
    const flightOptions = itinerary?.flights?.options;
    const selectedFlight = flightOptions && Array.isArray(flightOptions) 
        ? flightOptions[selectedFlightIndex] || flightOptions[0]
        : null;
    
    // Calculate flight price based on selected flight
    const flightPricePerPerson = selectedFlight 
        ? selectedFlight.pricePerPerson 
        : (itinerary?.flights?.pricePerPerson || (itinerary?.flights?.price ? itinerary.flights.price / travelers : 0));
    
    // Get baggage price from selected flight (default €30 per person for checked bag)
    // Only charge if baggage is not already included AND user selected it
    const checkedBaggagePrice = selectedFlight?.checkedBaggagePrice || 30;
    const baggageIncluded = selectedFlight?.checkedBaggageIncluded || false;
    const totalBaggageCost = (!baggageIncluded && checkedBaggageSelected) ? checkedBaggagePrice * travelers : 0;
    
    const accommodationPricePerNight = selectedAccommodation?.pricePerNight || 0;
    const dailyExpensesPerPerson = itinerary?.estimatedDailyExpenses || 50; // Fallback

    const totalFlightCost = flightPricePerPerson * travelers;
    const totalAccommodationCost = accommodationPricePerNight * duration;
    const totalDailyExpenses = dailyExpensesPerPerson * travelers * duration;
    
    const grandTotal = totalFlightCost + totalBaggageCost + totalAccommodationCost + totalDailyExpenses;
    const pricePerPerson = grandTotal / travelers;

    const openMap = (query: string) => {
        const url = Platform.select({
            ios: `maps:0,0?q=${encodeURIComponent(query)}`,
            android: `geo:0,0?q=${encodeURIComponent(query)}`,
            web: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
        });
        if (url) Linking.openURL(url);
    };

    const openAffiliateLink = async (type: 'flight' | 'hotel', query: string) => {
        // In a real app, you would use your actual affiliate IDs and endpoints
        // Examples: Skyscanner, Booking.com, Expedia, etc.
        let url = "";
        if (type === 'flight') {
            url = `https://www.skyscanner.com/transport/flights?q=${encodeURIComponent(query)}`;
        } else {
            url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query)}`;
        }

        // Track the click
        try {
            await trackClick({
                tripId: id as Id<"trips">,
                type: type,
                item: query,
                url: url
            });
        } catch (e) {
            console.error("Failed to track click", e);
        }

        // Show alert to confirm tracking (User Flow Requirement)
        Alert.alert(
            "Redirecting to Supplier",
            "We are taking you to the booking page. Your booking will be tracked for rewards!",
            [
                { 
                    text: "Continue", 
                    onPress: () => Linking.openURL(url)
                },
                {
                    text: "Cancel",
                    style: "cancel"
                }
            ]
        );
    };

    const handleBookTrip = () => {
        // For now, we'll link to a general travel booking site or a specific package deal
        // In a real app, this would likely add items to a cart or redirect to a checkout flow
        const query = `${trip.origin} to ${trip.destination} package`;
        const url = `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(trip.destination)}`;
        Linking.openURL(url);
    };

    const handleRegenerate = () => {
        // In a real app, this would trigger a re-generation of the itinerary
        // For now, we'll just show an alert or navigate back to create-trip with pre-filled data
        Alert.alert(
            "Regenerate Trip",
            "Do you want to regenerate this itinerary? This will create a new version of your trip.",
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Regenerate", 
                    onPress: () => {
                        // Navigate to create-trip with params to pre-fill
                        router.push({
                            pathname: "/create-trip",
                            params: {
                                destination: trip.destination,
                                startDate: trip.startDate,
                                endDate: trip.endDate,
                                budget: trip.budget,
                                travelers: trip.travelers,
                                origin: trip.origin,
                                regenerate: "true" // Flag to indicate regeneration
                            }
                        });
                    } 
                }
            ]
        );
    };

    const renderFlights = () => {
        // Check if flights were skipped
        if (itinerary.flights?.skipped) {
            return (
                <View style={styles.card}>
                    <View style={styles.skippedFlightsContainer}>
                        <Ionicons name="airplane" size={32} color="#5EEAD4" />
                        <Text style={styles.skippedFlightsTitle}>Flights Not Included</Text>
                        <Text style={styles.skippedFlightsText}>
                            {itinerary.flights.message || "You indicated you already have flights booked."}
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.viewMapButton} onPress={() => openMap(trip.destination)}>
                        <Ionicons name="map" size={20} color="#F9F506" />
                        <Text style={styles.viewMapText}>View Map</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        // Handle new multiple options format
        if (itinerary.flights?.options && Array.isArray(itinerary.flights.options)) {
            const flightOptions = itinerary.flights.options;
            const selectedFlight = flightOptions[selectedFlightIndex] || flightOptions[0];
            const bestPrice = itinerary.flights.bestPrice;
            
            return (
                <View style={styles.card}>
                    <View style={styles.bestPriceBanner}>
                        <Ionicons name="pricetag" size={16} color="#10B981" />
                        <Text style={styles.bestPriceText}>Best price from €{Math.round(bestPrice)}/person</Text>
                    </View>
                    
                    <Text style={styles.flightOptionsLabel}>Select your flight:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flightOptionsScroll}>
                        {flightOptions.map((option: any, index: number) => (
                            <TouchableOpacity
                                key={option.id || index}
                                style={[
                                    styles.flightOptionCard,
                                    selectedFlightIndex === index && styles.flightOptionCardSelected,
                                ]}
                                onPress={() => setSelectedFlightIndex(index)}
                            >
                                {option.isBestPrice && (
                                    <View style={styles.bestPriceBadge}>
                                        <Text style={styles.bestPriceBadgeText}>Best Price</Text>
                                    </View>
                                )}
                                <Text style={styles.flightOptionAirline}>{option.outbound.airline}</Text>
                                <Text style={styles.flightOptionTime}>{option.outbound.departure}</Text>
                                <Text style={styles.flightOptionPrice}>€{Math.round(option.pricePerPerson)}</Text>
                                <Text style={styles.flightOptionStops}>
                                    {option.outbound.stops === 0 ? 'Direct' : `${option.outbound.stops} stop`}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                    
                    <View style={styles.selectedFlightDetails}>
                        {/* Route Display */}
                        <View style={styles.routeDisplay}>
                            <View style={styles.routePoint}>
                                <Ionicons name="location" size={18} color="#14B8A6" />
                                <Text style={styles.routeAirport}>{getAirportName(trip.origin)}</Text>
                            </View>
                            <View style={styles.routeLine}>
                                <View style={styles.routeDash} />
                                <Ionicons name="airplane" size={16} color="#5EEAD4" />
                                <View style={styles.routeDash} />
                            </View>
                            <View style={styles.routePoint}>
                                <Ionicons name="location" size={18} color="#F59E0B" />
                                <Text style={styles.routeAirport}>{getAirportName(selectedFlight.arrivalAirport || trip.destination)}</Text>
                            </View>
                        </View>

                        <View style={styles.flightHeader}>
                            <Text style={styles.flightPrice}>€{Math.round(selectedFlight.pricePerPerson)}/person</Text>
                            <View style={styles.luggageBadge}>
                                <Ionicons name="briefcase-outline" size={14} color="#14B8A6" />
                                <Text style={styles.luggageText}>{selectedFlight.luggage}</Text>
                            </View>
                        </View>
                        
                        {itinerary.flights.dataSource === "ai-generated" && (
                            <View style={styles.dataSourceBadge}>
                                <Ionicons name="sparkles" size={14} color="#FF9500" />
                                <Text style={styles.dataSourceText}>AI-Generated Flight Data</Text>
                            </View>
                        )}
                        
                        <View style={styles.flightSegment}>
                            <View style={styles.segmentHeader}>
                                <Ionicons name="airplane" size={20} color="#14B8A6" />
                                <Text style={styles.segmentTitle}>Outbound</Text>
                            </View>
                            <View style={styles.row}>
                                <View style={styles.flightInfo}>
                                    <Text style={styles.cardTitle}>{selectedFlight.outbound.airline}</Text>
                                    <Text style={styles.cardSubtitle}>{selectedFlight.outbound.flightNumber}</Text>
                                </View>
                                <Text style={styles.duration}>{selectedFlight.outbound.duration}</Text>
                            </View>
                            <View style={styles.flightTimes}>
                                <Text style={styles.time}>{selectedFlight.outbound.departure}</Text>
                                <Ionicons name="arrow-forward" size={16} color="#8E8E93" />
                                <Text style={styles.time}>{selectedFlight.outbound.arrival}</Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.flightSegment}>
                            <View style={styles.segmentHeader}>
                                <Ionicons name="airplane" size={20} color="#14B8A6" style={{ transform: [{ rotate: '180deg' }] }} />
                                <Text style={styles.segmentTitle}>Return</Text>
                            </View>
                            <View style={styles.row}>
                                <View style={styles.flightInfo}>
                                    <Text style={styles.cardTitle}>{selectedFlight.return.airline}</Text>
                                    <Text style={styles.cardSubtitle}>{selectedFlight.return.flightNumber}</Text>
                                </View>
                                <Text style={styles.duration}>{selectedFlight.return.duration}</Text>
                            </View>
                            <View style={styles.flightTimes}>
                                <Text style={styles.time}>{selectedFlight.return.departure}</Text>
                                <Ionicons name="arrow-forward" size={16} color="#8E8E93" />
                                <Text style={styles.time}>{selectedFlight.return.arrival}</Text>
                            </View>
                        </View>

                        {/* Baggage Options */}
                        <View style={styles.baggageSection}>
                            <Text style={styles.baggageSectionTitle}>Baggage Options</Text>
                            
                            {/* Included Cabin Bag */}
                            <View style={styles.baggageOption}>
                                <View style={styles.baggageOptionLeft}>
                                    <Ionicons name="briefcase-outline" size={20} color="#14B8A6" />
                                    <View style={styles.baggageOptionInfo}>
                                        <Text style={styles.baggageOptionTitle}>Cabin Bag (8kg)</Text>
                                        <Text style={styles.baggageOptionDesc}>Included in fare</Text>
                                    </View>
                                </View>
                                <View style={styles.includedBadge}>
                                    <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                                    <Text style={styles.includedText}>Included</Text>
                                </View>
                            </View>

                            {/* Checked Baggage - Show as included or as option */}
                            {selectedFlight.checkedBaggageIncluded ? (
                                <View style={styles.baggageOption}>
                                    <View style={styles.baggageOptionLeft}>
                                        <Ionicons name="bag-handle-outline" size={20} color="#14B8A6" />
                                        <View style={styles.baggageOptionInfo}>
                                            <Text style={styles.baggageOptionTitle}>Checked Bag (23kg)</Text>
                                            <Text style={styles.baggageOptionDesc}>Included in fare</Text>
                                        </View>
                                    </View>
                                    <View style={styles.includedBadge}>
                                        <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                                        <Text style={styles.includedText}>Included</Text>
                                    </View>
                                </View>
                            ) : (
                                <TouchableOpacity 
                                    style={[
                                        styles.baggageOption,
                                        styles.baggageOptionSelectable,
                                        checkedBaggageSelected && styles.baggageOptionSelected
                                    ]}
                                    onPress={() => setCheckedBaggageSelected(!checkedBaggageSelected)}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.baggageOptionLeft}>
                                        <Ionicons name="bag-handle-outline" size={20} color={checkedBaggageSelected ? "#14B8A6" : "#546E7A"} />
                                        <View style={styles.baggageOptionInfo}>
                                            <Text style={[styles.baggageOptionTitle, checkedBaggageSelected && styles.baggageOptionTitleSelected]}>
                                                Checked Bag (23kg)
                                            </Text>
                                            <Text style={styles.baggageOptionDesc}>Per person, round trip</Text>
                                        </View>
                                    </View>
                                    <View style={styles.baggageOptionRight}>
                                        <Text style={[styles.baggagePrice, checkedBaggageSelected && styles.baggagePriceSelected]}>
                                            +€{selectedFlight.checkedBaggagePrice || 30}
                                        </Text>
                                        <View style={[styles.checkbox, checkedBaggageSelected && styles.checkboxSelected]}>
                                            {checkedBaggageSelected && (
                                                <Ionicons name="checkmark" size={16} color="white" />
                                            )}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            )}

                            {checkedBaggageSelected && !selectedFlight.checkedBaggageIncluded && (
                                <View style={styles.baggageSummary}>
                                    <Text style={styles.baggageSummaryText}>
                                        Checked baggage for {travelers} traveler{travelers > 1 ? 's' : ''}: €{(selectedFlight.checkedBaggagePrice || 30) * travelers}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>

                    <TouchableOpacity 
                        style={styles.affiliateButton}
                        onPress={() => selectedFlight.bookingUrl ? Linking.openURL(selectedFlight.bookingUrl) : openAffiliateLink('flight', `${trip.origin} to ${trip.destination}`)}
                    >
                        <Text style={styles.affiliateButtonText}>Book This Flight</Text>
                        <Ionicons name="open-outline" size={16} color="#14B8A6" />
                    </TouchableOpacity>
                </View>
            );
        }

        // Legacy array format
        if (Array.isArray(itinerary.flights)) {
            return (
                <View style={styles.card}>
                    {itinerary.flights.map((flight: any, index: number) => (
                        <View key={index} style={styles.row}>
                            <View style={styles.flightInfo}>
                                <Text style={styles.cardTitle}>{flight.airline}</Text>
                                <Text style={styles.cardSubtitle}>{flight.flightNumber}</Text>
                            </View>
                            <Text style={styles.price}>€{flight.price}</Text>
                        </View>
                    ))}
                </View>
            );
        }

        // No flights available
        if (!itinerary.flights || !itinerary.flights.outbound) {
            return (
                <View style={styles.card}>
                    <Text style={styles.cardSubtitle}>Flight details unavailable</Text>
                </View>
            );
        }

        // Old single flight format
        return (
            <View style={styles.card}>
                <View style={styles.flightHeader}>
                    <Text style={styles.flightPrice}>€{flightPricePerPerson}/person</Text>
                    <View style={styles.luggageBadge}>
                        <Ionicons name="briefcase-outline" size={14} color="#14B8A6" />
                        <Text style={styles.luggageText}>{itinerary.flights.luggage}</Text>
                    </View>
                </View>
                
                {itinerary.flights.dataSource === "ai-generated" && (
                    <View style={styles.dataSourceBadge}>
                        <Ionicons name="sparkles" size={14} color="#FF9500" />
                        <Text style={styles.dataSourceText}>AI-Generated Flight Data</Text>
                    </View>
                )}
                
                <View style={styles.flightSegment}>
                    <View style={styles.segmentHeader}>
                        <Ionicons name="airplane" size={20} color="#14B8A6" />
                        <Text style={styles.segmentTitle}>Outbound</Text>
                    </View>
                    <View style={styles.row}>
                        <View style={styles.flightInfo}>
                            <Text style={styles.cardTitle}>{itinerary.flights.outbound.airline}</Text>
                            <Text style={styles.cardSubtitle}>{itinerary.flights.outbound.flightNumber}</Text>
                        </View>
                        <Text style={styles.duration}>{itinerary.flights.outbound.duration}</Text>
                    </View>
                    <View style={styles.flightTimes}>
                        <Text style={styles.time}>{itinerary.flights.outbound.departure}</Text>
                        <Ionicons name="arrow-forward" size={16} color="#8E8E93" />
                        <Text style={styles.time}>{itinerary.flights.outbound.arrival}</Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.flightSegment}>
                    <View style={styles.segmentHeader}>
                        <Ionicons name="airplane" size={20} color="#14B8A6" style={{ transform: [{ rotate: '180deg' }] }} />
                        <Text style={styles.segmentTitle}>Return</Text>
                    </View>
                    <View style={styles.row}>
                        <View style={styles.flightInfo}>
                            <Text style={styles.cardTitle}>{itinerary.flights.return.airline}</Text>
                            <Text style={styles.cardSubtitle}>{itinerary.flights.return.flightNumber}</Text>
                        </View>
                        <Text style={styles.duration}>{itinerary.flights.return.duration}</Text>
                    </View>
                    <View style={styles.flightTimes}>
                        <Text style={styles.time}>{itinerary.flights.return.departure}</Text>
                        <Ionicons name="arrow-forward" size={16} color="#8E8E93" />
                        <Text style={styles.time}>{itinerary.flights.return.arrival}</Text>
                    </View>
                </View>

                <TouchableOpacity 
                    style={styles.affiliateButton}
                    onPress={() => openAffiliateLink('flight', `${trip.origin} to ${trip.destination}`)}
                >
                    <Text style={styles.affiliateButtonText}>Check Flight Availability</Text>
                    <Ionicons name="open-outline" size={16} color="#14B8A6" />
                </TouchableOpacity>
            </View>
        );
    };

    // User has full access if they have premium subscription OR have used trip credits
    const isPremium = trip.hasFullAccess ?? trip.userPlan === "premium";

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header - Minimal with just back button */}
            <SafeAreaView style={[styles.header, { backgroundColor: 'transparent', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, borderBottomWidth: 0 }]}>
                <View style={styles.headerContent}>
                    <TouchableOpacity style={[styles.iconButton, { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 20 }]} onPress={() => router.back()}>
                        <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <View style={[styles.aiBadge, { backgroundColor: 'rgba(255,255,255,0.9)' }]}>
                        <Ionicons name="sparkles" size={12} color="#FFE500" />
                        <Text style={[styles.aiBadgeText, { color: '#1A1A1A' }]}>AI Generated</Text>
                    </View>
                </View>
            </SafeAreaView>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Map Preview with Title Overlay */}
                <View style={styles.mapPreviewContainer} pointerEvents="box-none">
                    {destinationImage ? (
                        <ImageWithAttribution
                            imageUrl={destinationImage.url}
                            photographerName={destinationImage.photographer}
                            photographerUrl={destinationImage.photographerUrl}
                            photoUrl={destinationImage.attribution}
                        />
                    ) : (
                        <Image 
                            source={{ uri: `https://images.pexels.com/photos/1285625/pexels-photo-1285625.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop&q=80&query=${encodeURIComponent(trip.destination)}` }} 
                            style={styles.mapImage} 
                        />
                    )}
                    {/* Title Overlay on Image */}
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.7)']}
                        style={styles.headerImageOverlay}
                    >
                        <View style={styles.headerTitleOverlay}>
                            <Text style={styles.headerTitleOnImage}>{trip.destination}</Text>
                            <View style={styles.headerSubtitleRow}>
                                <View style={styles.headerDateBadge}>
                                    <Ionicons name="calendar-outline" size={14} color="white" />
                                    <Text style={styles.headerDateText}>
                                        {new Date(trip.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(trip.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </Text>
                                </View>
                                <View style={styles.headerTravelersBadge}>
                                    <Ionicons name="people-outline" size={14} color="white" />
                                    <Text style={styles.headerTravelersText}>{trip.travelers || 1} traveler{(trip.travelers || 1) > 1 ? 's' : ''}</Text>
                                </View>
                            </View>
                        </View>
                    </LinearGradient>
                    <TouchableOpacity style={[styles.viewMapButton, { backgroundColor: colors.card }]} onPress={() => openMap(trip.destination)}>
                        <Ionicons name="map" size={20} color={colors.primary} />
                        <Text style={[styles.viewMapText, { color: colors.text }]}>View Map</Text>
                    </TouchableOpacity>
                </View>

                {/* Filter Chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContainer}>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'all' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('all')}
                    >
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'all' && { color: colors.card }]}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'flights' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('flights')}
                    >
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'flights' && { color: colors.card }]}>Flights</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'food' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('food')}
                    >
                        <Ionicons name="restaurant" size={18} color={activeFilter === 'food' ? colors.card : colors.textMuted} />
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'food' && { color: colors.card }]}>Food</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'sights' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('sights')}
                    >
                        <Ionicons name="ticket" size={18} color={activeFilter === 'sights' ? colors.card : colors.textMuted} />
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'sights' && { color: colors.card }]}>Sights</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'stays' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('stays')}
                    >
                        <Ionicons name="bed" size={18} color={activeFilter === 'stays' ? colors.card : colors.textMuted} />
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'stays' && { color: colors.card }]}>Stays</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.filterChip, { backgroundColor: colors.card, borderColor: colors.border }, activeFilter === 'transportation' && { backgroundColor: colors.text, borderColor: colors.text }]}
                        onPress={() => setActiveFilter('transportation')}
                    >
                        <Ionicons name="car" size={18} color={activeFilter === 'transportation' ? colors.card : colors.textMuted} />
                        <Text style={[styles.filterText, { color: colors.textMuted }, activeFilter === 'transportation' && { color: colors.card }]}>Transport</Text>
                    </TouchableOpacity>
                </ScrollView>

                {/* Content based on active filter */}
                <View style={styles.itineraryContainer}>
                    {activeFilter === 'all' && trip.itinerary?.dayByDayItinerary?.map((day: any, index: number) => (
                        <View key={index} style={styles.daySection}>
                            <View style={styles.dayHeader}>
                                <View>
                                    <Text style={[styles.dayTitle, { color: colors.text }]}>Day {day.day}</Text>
                                    <Text style={[styles.daySubtitle, { color: colors.textMuted }]}>{day.title || `Explore ${trip.destination}`}</Text>
                                </View>
                                <View style={[styles.energyBadge, { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.2)' : 'rgba(249, 245, 6, 0.2)' }]}>
                                    <Text style={[styles.energyText, { color: colors.primary }]}>HIGH ENERGY</Text>
                                </View>
                            </View>

                            {day.activities.map((activity: any, actIndex: number) => (
                                <View key={actIndex} style={styles.timelineItem}>
                                    <View style={styles.timelineLeft}>
                                        <View style={[styles.timelineIconContainer, { backgroundColor: colors.secondary }]}>
                                            <Ionicons 
                                                name={
                                                    activity.type === 'restaurant' ? 'restaurant' :
                                                    activity.type === 'museum' ? 'easel' :
                                                    activity.type === 'attraction' ? 'ticket' :
                                                    'location'
                                                } 
                                                size={20} 
                                                color={colors.text} 
                                            />
                                        </View>
                                        <Text style={[styles.timelineTime, { color: colors.textMuted }]}>{activity.time}</Text>
                                        {actIndex < day.activities.length - 1 && <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />}
                                    </View>
                                    <TouchableOpacity style={[styles.timelineCard, { backgroundColor: colors.card }]}>
                                        <View style={styles.timelineCardContent}>
                                            <View style={{flex: 1}}>
                                                <Text style={[styles.activityTitle, { color: colors.text }]}>{activity.title}</Text>
                                                <Text style={[styles.activityDesc, { color: colors.textMuted }]} numberOfLines={2}>{activity.description}</Text>
                                                <View style={styles.activityMeta}>
                                                    <View style={[styles.metaBadge, { backgroundColor: colors.secondary }]}>
                                                        <Text style={[styles.metaText, { color: colors.text }]}>{activity.type || 'Activity'}</Text>
                                                    </View>
                                                    <View style={styles.metaDuration}>
                                                        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                                                        <Text style={[styles.metaDurationText, { color: colors.textMuted }]}>{activity.duration || '1h'}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    ))}

                    {activeFilter === 'food' && (
                        <View>
                            <Text style={styles.sectionTitle}>Top Restaurants</Text>
                            {trip.itinerary?.restaurants?.map((restaurant: any, index: number) => (
                                <View key={index} style={styles.card}>
                                    <View style={styles.row}>
                                        <View style={styles.flightInfo}>
                                            <View style={styles.restaurantHeader}>
                                                <Text style={styles.cardTitle}>{restaurant.name}</Text>
                                                {restaurant.tripAdvisorUrl && (
                                                    <Image 
                                                        source={{ uri: "https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg" }} 
                                                        style={styles.tripAdvisorLogo}
                                                        resizeMode="contain"
                                                    />
                                                )}
                                            </View>
                                            <Text style={styles.cardSubtitle}>{restaurant.cuisine} • {restaurant.priceRange}</Text>
                                            <View style={styles.ratingContainer}>
                                                <Ionicons name="star" size={14} color="#F59E0B" />
                                                <Text style={styles.ratingText}>{restaurant.rating} ({restaurant.reviewCount} reviews)</Text>
                                            </View>
                                            <Text style={styles.addressText}>{restaurant.address}</Text>
                                        </View>
                                        {restaurant.tripAdvisorUrl && (
                                            <TouchableOpacity onPress={() => Linking.openURL(restaurant.tripAdvisorUrl)}>
                                                <Ionicons name="open-outline" size={24} color="#1A1A1A" />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            ))}
                            {(!trip.itinerary?.restaurants || trip.itinerary.restaurants.length === 0) && (
                                <Text style={styles.emptyText}>No restaurants found.</Text>
                            )}
                        </View>
                    )}

                    {activeFilter === 'flights' && (
                        <View>
                            <Text style={styles.sectionTitle}>Available Flights</Text>
                            <View style={[styles.card, styles.skippedCard]}>
                                <View style={styles.skippedSection}>
                                    <View style={styles.skippedIconContainer}>
                                        <Ionicons name="airplane" size={32} color={colors.primary} />
                                    </View>
                                    <Text style={styles.skippedTitle}>Coming in Next Updates</Text>
                                    <Text style={styles.skippedText}>
                                        Flight booking and search will be available soon. We're working hard to bring you the best flight options!
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    {activeFilter === 'sights' && (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Top 5 Sights</Text>
                            
                            {/* V1: AI-generated Top 5 Sights (Viator disabled) */}
                            {topSights === undefined ? (
                                <View style={[styles.loadingContainer, { backgroundColor: colors.card }]}>
                                    <ActivityIndicator size="small" color={colors.primary} />
                                    <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading sights...</Text>
                                </View>
                            ) : topSights && topSights.sights && topSights.sights.length > 0 ? (
                                <>
                                    {topSights.sights.map((sight: any, index: number) => (
                                        <View key={index} style={[styles.card, { backgroundColor: colors.card }]}>
                                            <View style={styles.sightHeader}>
                                                <View style={[styles.sightNumber, { backgroundColor: colors.primary }]}>
                                                    <Text style={[styles.sightNumberText, { color: colors.text }]}>{index + 1}</Text>
                                                </View>
                                                <Text style={[styles.cardTitle, { color: colors.text, flex: 1 }]}>{sight.name}</Text>
                                            </View>
                                            <Text style={[styles.activityDesc, { color: colors.textMuted }]}>{sight.shortDescription}</Text>
                                            <View style={styles.sightMeta}>
                                                {sight.neighborhoodOrArea && (
                                                    <View style={[styles.metaBadge, { backgroundColor: colors.secondary }]}>
                                                        <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                                                        <Text style={[styles.metaText, { color: colors.textMuted }]}>{sight.neighborhoodOrArea}</Text>
                                                    </View>
                                                )}
                                                {sight.bestTimeToVisit && (
                                                    <View style={[styles.metaBadge, { backgroundColor: colors.secondary }]}>
                                                        <Ionicons name="sunny-outline" size={12} color={colors.textMuted} />
                                                        <Text style={[styles.metaText, { color: colors.textMuted }]}>{sight.bestTimeToVisit}</Text>
                                                    </View>
                                                )}
                                                {sight.estDurationHours && (
                                                    <View style={[styles.metaBadge, { backgroundColor: colors.secondary }]}>
                                                        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                                                        <Text style={[styles.metaText, { color: colors.textMuted }]}>{sight.estDurationHours}</Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                    ))}
                                    {/* AI Disclaimer */}
                                    <View style={[styles.aiDisclaimer, { backgroundColor: colors.secondary }]}>
                                        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                                        <Text style={[styles.aiDisclaimerText, { color: colors.textMuted }]}>
                                            Suggestions are AI-generated. Confirm details locally.
                                        </Text>
                                    </View>
                                </>
                            ) : (
                                <View style={[styles.emptySightsContainer, { backgroundColor: colors.card }]}>
                                    <Ionicons name="telescope-outline" size={48} color={colors.textMuted} />
                                    <Text style={[styles.emptySightsTitle, { color: colors.text }]}>Discover Top Sights</Text>
                                    <Text style={[styles.emptySightsText, { color: colors.textMuted }]}>
                                        Get AI-powered recommendations for the best sights to see in {trip?.destination}.
                                    </Text>
                                    <TouchableOpacity 
                                        style={[styles.generateSightsButton, { backgroundColor: colors.primary }]}
                                        onPress={async () => {
                                            if (!trip) return;
                                            setGeneratingSights(true);
                                            try {
                                                await generateTopSights({ tripId: trip._id });
                                            } catch (error) {
                                                console.error("Failed to generate sights:", error);
                                                if (Platform.OS !== 'web') {
                                                    Alert.alert("Error", "Failed to generate sights. Please try again.");
                                                }
                                            } finally {
                                                setGeneratingSights(false);
                                            }
                                        }}
                                        disabled={generatingSights}
                                    >
                                        {generatingSights ? (
                                            <ActivityIndicator size="small" color={colors.text} />
                                        ) : (
                                            <>
                                                <Ionicons name="sparkles" size={18} color={colors.text} />
                                                <Text style={[styles.generateSightsButtonText, { color: colors.text }]}>Generate Top 5 Sights</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            )}
                        </>
                    )}

                    {activeFilter === 'stays' && (
                        <View>
                            <Text style={styles.sectionTitle}>Accommodations</Text>
                            <View style={[styles.card, styles.skippedCard]}>
                                <View style={styles.skippedSection}>
                                    <View style={styles.skippedIconContainer}>
                                        <Ionicons name="bed" size={32} color={colors.primary} />
                                    </View>
                                    <Text style={styles.skippedTitle}>Coming in Next Updates</Text>
                                    <Text style={styles.skippedText}>
                                        Hotel and accommodation booking will be available soon. We're working hard to bring you the best options!
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    {activeFilter === 'transportation' && (
                        <View>
                            <Text style={styles.sectionTitle}>Getting Around</Text>
                            {trip.itinerary?.transportation?.map((option: any, index: number) => (
                                <View key={index} style={styles.card}>
                                    <View style={styles.row}>
                                        <View style={styles.flightInfo}>
                                            <View style={styles.transportHeader}>
                                                <Ionicons 
                                                    name={
                                                        option.type === 'car_rental' ? 'car' :
                                                        option.type === 'taxi' ? 'car-sport' :
                                                        option.type === 'rideshare' ? 'phone-portrait' :
                                                        'bus'
                                                    } 
                                                    size={24} 
                                                    color="#1A1A1A" 
                                                />
                                                <Text style={styles.cardTitle}>
                                                    {option.provider} {option.service ? `- ${option.service}` : ''}
                                                </Text>
                                            </View>
                                            
                                            {option.type === 'public_transport' ? (
                                                <View>
                                                    {option.options?.map((opt: any, i: number) => (
                                                        <View key={i} style={styles.transportOption}>
                                                            <Text style={styles.transportMode}>{opt.mode}</Text>
                                                            <Text style={styles.transportDesc}>{opt.description}</Text>
                                                            <Text style={styles.transportPrice}>
                                                                Single: €{opt.singleTicketPrice} | Day Pass: €{opt.dayPassPrice}
                                                            </Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            ) : (
                                                <View>
                                                    <Text style={styles.cardSubtitle}>{option.description}</Text>
                                                    <Text style={styles.price}>
                                                        {option.estimatedPrice ? `€${option.estimatedPrice}` : `€${option.pricePerDay}/day`}
                                                    </Text>
                                                    {option.features && (
                                                        <View style={styles.amenitiesContainer}>
                                                            {option.features.map((feature: string, i: number) => (
                                                                <View key={i} style={styles.amenityBadge}>
                                                                    <Text style={styles.amenityText}>{feature}</Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    )}
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                    {option.bookingUrl && (
                                        <TouchableOpacity 
                                            style={styles.bookButton}
                                            onPress={() => Linking.openURL(option.bookingUrl)}
                                        >
                                            <Text style={styles.bookButtonText}>Book Now</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))}
                            {(!trip.itinerary?.transportation || trip.itinerary.transportation.length === 0) && (
                                <View style={styles.card}>
                                    <View style={styles.skippedSection}>
                                        <Ionicons name="car-outline" size={32} color="#94A3B8" />
                                        <Text style={styles.skippedTitle}>Transportation Info</Text>
                                        <Text style={styles.skippedText}>
                                            Local transportation options for {trip.destination} will appear here.
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    )}
                </View>
            </ScrollView>

            {/* Traveler Insights Section */}
            {insights && insights.length > 0 && (
                <View style={styles.insightsSection}>
                    <Text style={styles.sectionTitle}>Traveler Insights</Text>
                    <Text style={styles.insightsSubtitle}>Tips from travelers who visited {trip.destination}</Text>
                    <ScrollView 
                        horizontal 
                        showsHorizontalScrollIndicator={false}
                        style={styles.insightsScroll}
                    >
                        {insights.map((insight: any) => (
                            <View key={insight._id} style={styles.insightCard}>
                                <View style={styles.insightHeader}>
                                    <View style={styles.insightCategoryBadge}>
                                        <Ionicons 
                                            name={
                                                insight.category === 'food' ? 'restaurant' :
                                                insight.category === 'transport' ? 'bus' :
                                                insight.category === 'hidden_gem' ? 'diamond' :
                                                insight.category === 'avoid' ? 'warning' :
                                                'bulb'
                                            }
                                            size={14} 
                                            color="#92400E"
                                        />
                                        <Text style={styles.insightCategoryText}>
                                            {insight.category.replace('_', ' ')}
                                        </Text>
                                    </View>
                                    <View style={styles.insightLikes}>
                                        <Ionicons name="heart" size={14} color="#F59E0B" />
                                        <Text style={styles.insightLikesText}>{insight.likes}</Text>
                                    </View>
                                </View>
                                <Text style={styles.insightContent} numberOfLines={4}>
                                    {insight.content}
                                </Text>
                                <Text style={styles.insightDate}>
                                    {new Date(insight.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                </Text>
                            </View>
                        ))}
                    </ScrollView>
                </View>
            )}

            {/* Floating Action Bar */}
            <View style={styles.fabContainer}>
                <View style={[styles.fab, { backgroundColor: colors.primary }]}>
                    <TouchableOpacity style={styles.fabIconButton} onPress={() => setIsEditing(true)}>
                        <Ionicons name="pencil" size={20} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            <Modal 
                visible={isEditing} 
                animationType="slide" 
                transparent={false}
                onRequestClose={() => setIsEditing(false)}
            >
                <KeyboardAvoidingView 
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={[styles.modalContainer, { backgroundColor: colors.background }]}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
                >
                    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                        <View style={[styles.modalHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                            <TouchableOpacity onPress={() => setIsEditing(false)}>
                                <Ionicons name="chevron-back" size={24} color={colors.text} />
                            </TouchableOpacity>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Trip</Text>
                            <View style={{ width: 24 }} />
                        </View>
                        
                        <ScrollView contentContainerStyle={[styles.modalContent, { backgroundColor: colors.background }]}>
                            {/* Trip Basics Section */}
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Trip Basics</Text>
                                
                                <View style={[styles.card, styles.inputGroup, { backgroundColor: colors.card }]}>
                                    <Text style={[styles.label, { color: colors.text }]}>Destination</Text>
                                    <View style={[styles.lockedInput, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                                        <Text style={[styles.lockedInputText, { color: colors.textMuted }]}>{editForm.destination}</Text>
                                        <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                                    </View>
                                </View>

                                <View style={[styles.card, styles.inputGroup, { backgroundColor: colors.card }]}>
                                    <Text style={[styles.label, { color: colors.text }]}>Dates</Text>
                                    <View style={styles.datesContainer}>
                                        <TouchableOpacity 
                                            style={[styles.dateInputButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                                            onPress={() => {
                                                setSelectingDate('start');
                                                setShowCalendar(true);
                                            }}
                                        >
                                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>START DATE</Text>
                                            <View style={styles.dateValueContainer}>
                                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(editForm.startDate)}</Text>
                                            </View>
                                        </TouchableOpacity>
                                        
                                        <View style={[styles.dateSeparator, { backgroundColor: colors.border }]} />

                                        <TouchableOpacity 
                                            style={[styles.dateInputButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                                            onPress={() => {
                                                setSelectingDate('end');
                                                setShowCalendar(true);
                                            }}
                                        >
                                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>END DATE</Text>
                                            <View style={styles.dateValueContainer}>
                                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(editForm.endDate)}</Text>
                                            </View>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>

                            {showCalendar && (
                                <Modal
                                    visible={showCalendar}
                                    transparent={true}
                                    animationType="slide"
                                    onRequestClose={() => setShowCalendar(false)}
                                >
                                    <View style={styles.calendarModalContainer}>
                                        <View style={[styles.calendarModal, { backgroundColor: colors.card }]}>
                                            <View style={[styles.calendarHeader, { borderBottomColor: colors.border }]}>
                                                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                                    <Text style={[styles.calendarHeaderText, { color: colors.primary }]}>Cancel</Text>
                                                </TouchableOpacity>
                                                <Text style={[styles.calendarHeaderTitle, { color: colors.text }]}>
                                                    {selectingDate === 'start' ? 'Start Date' : 'End Date'}
                                                </Text>
                                                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                                    <Text style={[styles.calendarHeaderText, { color: colors.primary }]}>Done</Text>
                                                </TouchableOpacity>
                                            </View>
                                            <Calendar
                                                onDayPress={handleDayPress}
                                                markedDates={getMarkedDates()}
                                                minDate={new Date().toISOString().split('T')[0]}
                                                theme={{
                                                    backgroundColor: colors.background,
                                                    calendarBackground: colors.background,
                                                    textSectionTitleColor: colors.text,
                                                    textSectionTitleDisabledColor: colors.textMuted,
                                                    selectedDayBackgroundColor: colors.primary,
                                                    selectedDayTextColor: colors.text,
                                                    todayTextColor: colors.primary,
                                                    dayTextColor: colors.text,
                                                    textDisabledColor: colors.textMuted,
                                                    dotColor: colors.primary,
                                                    selectedDotColor: colors.text,
                                                    arrowColor: colors.text,
                                                    monthTextColor: colors.text,
                                                    textMonthFontWeight: '700',
                                                    textDayFontSize: 14,
                                                    textMonthFontSize: 16,
                                                    textDayHeaderFontSize: 12,
                                                }}
                                            />
                                        </View>
                                    </View>
                                </Modal>
                            )}

                            {/* Budget Section */}
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Budget & Travelers</Text>
                                
                                <View style={[styles.card, styles.inputGroup, { backgroundColor: colors.card }]}>
                                    <Text style={[styles.label, { color: colors.text }]}>Budget (€)</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                                        value={editForm.budget.toString()}
                                        onChangeText={(text) => {
                                            const numValue = parseInt(text) || 0;
                                            setEditForm(prev => ({ ...prev, budget: numValue }));
                                        }}
                                        keyboardType="numeric"
                                        placeholder="e.g. 2000"
                                        placeholderTextColor={colors.textMuted}
                                    />
                                </View>

                                <View style={[styles.card, styles.inputGroup, { backgroundColor: colors.card }]}>
                                    <Text style={[styles.label, { color: colors.text }]}>Travelers</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                                        value={editForm.travelers.toString()}
                                        onChangeText={(text) => {
                                            const numValue = parseInt(text) || 1;
                                            setEditForm(prev => ({ ...prev, travelers: numValue }));
                                        }}
                                        keyboardType="number-pad"
                                        placeholder="Number of travelers"
                                        placeholderTextColor={colors.textMuted}
                                    />
                                </View>
                            </View>

                            {/* Travel Style Section */}
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Travel Style</Text>
                                
                                <View style={[styles.card, styles.inputGroup, { backgroundColor: colors.card }]}>
                                    <View style={styles.interestsContainer}>
                                        {INTERESTS.map((interest) => (
                                            <TouchableOpacity
                                                key={interest}
                                                style={[
                                                    styles.interestTag,
                                                    { backgroundColor: colors.secondary, borderColor: colors.border },
                                                    editForm.interests.includes(interest) && { backgroundColor: colors.primary, borderColor: colors.primary },
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
                                                        interest === "Family" ? "people" :
                                                        "sparkles"
                                                    } 
                                                    size={20} 
                                                    color={editForm.interests.includes(interest) ? "white" : colors.textMuted}
                                                />
                                                <Text style={[
                                                    styles.interestTagText,
                                                    { color: colors.textMuted },
                                                    editForm.interests.includes(interest) && { color: "white" },
                                                ]}>
                                                    {interest}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            </View>

                            <TouchableOpacity 
                                style={[styles.saveButton, styles.card, { backgroundColor: colors.primary }]}
                                onPress={handleSaveAndRegenerate}
                            >
                                <Ionicons name="checkmark" size={20} color={colors.text} style={{ marginRight: 8 }} />
                                <Text style={[styles.saveButtonText, { color: colors.text }]}>Save & Regenerate</Text>
                            </TouchableOpacity>
                            <View style={{ height: 40 }} />
                        </ScrollView>
                    </SafeAreaView>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#F8F8F5",
    },
    header: {
        backgroundColor: "white",
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },
    headerContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
        textAlign: "center",
    },
    aiBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(255,255,255,0.9)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginTop: 4,
    },
    aiBadgeText: {
        fontSize: 12,
        fontWeight: "600",
    },
    scrollContent: {
        paddingBottom: 32,
    },
    iconButton: {
        width: 40,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
    },
    headerContainer: {
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingVertical: 24,
        gap: 8,
    },
    mapPreviewContainer: {
        height: 224,
        width: "100%",
        position: "relative",
    },
    mapImage: {
        width: "100%",
        height: "100%",
        resizeMode: "cover",
    },
    viewMapButton: {
        position: "absolute",
        bottom: 16,
        right: 16,
        backgroundColor: "white",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 4,
    },
    viewMapText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    filterContainer: {
        paddingHorizontal: 16,
        paddingVertical: 24,
        gap: 12,
    },
    filterChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: "white",
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    filterChipActive: {
        backgroundColor: "#1A1A1A",
        borderColor: "#1A1A1A",
    },
    filterText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#64748B",
    },
    filterTextActive: {
        color: "white",
    },
    itineraryContainer: {
        paddingHorizontal: 16,
    },
    daySection: {
        marginBottom: 32,
    },
    dayHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    dayTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    daySubtitle: {
        fontSize: 14,
        fontWeight: "500",
        color: "#64748B",
    },
    energyBadge: {
        backgroundColor: "rgba(249, 245, 6, 0.2)",
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    energyText: {
        fontSize: 10,
        fontWeight: "700",
        color: "#1A1A1A",
        letterSpacing: 0.5,
    },
    timelineItem: {
        flexDirection: "row",
        gap: 16,
        marginBottom: 24,
    },
    timelineLeft: {
        alignItems: "center",
        width: 48,
    },
    timelineIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "white",
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 2,
        borderColor: "rgba(255, 255, 255, 0.2)",
        zIndex: 1,
    },
    timelineTime: {
        marginTop: 8,
        fontSize: 12,
        fontWeight: "600",
        color: "#8E8E93",
    },
    timelineLine: {
        position: "absolute",
        top: 40,
        bottom: -24,
        width: 2,
        backgroundColor: "#E2E8F0",
        zIndex: 0,
    },
    timelineCard: {
        flex: 1,
        backgroundColor: "white",
        borderRadius: 16,
        padding: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    timelineCardContent: {
        flexDirection: "row",
        gap: 12,
    },
    activityTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 4,
    },
    activityDesc: {
        fontSize: 14,
        color: "#64748B",
        lineHeight: 20,
        marginBottom: 12,
    },
    activityMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    metaBadge: {
         flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    metaText: {
          fontSize: 11,
    },
   loadingContainer: {
        flex: 1,
        backgroundColor: "#000000",
    },
    loadingtext: {
        fontSize: 14,
    },
    // Loading screen styles
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    loadingBackgroundImage: {
        ...StyleSheet.absoluteFillObject,
        width: "100%",
        height: "100%",
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    loadingContent: {
        flex: 1,
        justifyContent: "space-between",
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 40,
    },
    loadingBackButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "rgba(255,255,255,0.2)",
        alignItems: "center",
        justifyContent: "center",
    },
    loadingCenterContent: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    loadingTitleContainer: {
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        marginBottom: 8,
    },
    loadingDestination: {
        fontSize: 28,
        fontWeight: "700",
        color: "white",
        textAlign: "center",
    },
    loadingArrow: {
        marginVertical: 2,
    },
    loadingTripDetails: {
        marginBottom: 24,
    },
    loadingTripDetailText: {
        fontSize: 14,
        color: "rgba(255,255,255,0.8)",
        textAlign: "center",
    },
    loadingIconContainer: {
        marginBottom: 24,
    },
    loadingTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "white",
        textAlign: "center",
        marginBottom: 8,
    },
    loadingSubtitle: {
        fontSize: 14,
        color: "rgba(255,255,255,0.8)",
        textAlign: "center",
        marginBottom: 32,
    },
    progressBarContainer: {
        width: "100%",
        marginBottom: 32,
    },
    progressBarBackground: {
        height: 6,
        backgroundColor: "rgba(255,255,255,0.2)",
        borderRadius: 3,
        overflow: "hidden",
        marginBottom: 12,
    },
    progressBarFill: {
        height: "100%",
        backgroundColor: "#FFE500",
        borderRadius: 3,
    },
    progressText: {
        textAlign: "center",
        color: "white",
        fontSize: 14,
        fontWeight: "600",
    },
    loadingSteps: {
        gap: 16,
    },
    loadingStep: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    loadingStepText: {
        color: "rgba(255,255,255,0.7)",
        fontSize: 12,
    },
    loadingStepComplete: {
        color: "#10B981",
    },
    loadingAttribution: {
        marginTop: 20,
    },
    loadingAttributionText: {
        color: "rgba(255,255,255,0.6)",
        fontSize: 11,
        textAlign: "center",
    },
    imageIndicators: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        paddingBottom: 24,
    },
    imageIndicator: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "rgba(255,255,255,0.4)",
    },
    imageIndicatorActive: {
        backgroundColor: "white",
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    // Error styles
    errorContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    errorTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginTop: 16,
        marginBottom: 8,
    },
    errorMessage: {
        fontSize: 14,
        textAlign: "center",
        marginBottom: 24,
        lineHeight: 20,
    },
    errorButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    errorButtonText: {
        fontWeight: "600",
        textAlign: "center",
    },
    // Card styles
    card: {
        backgroundColor: "white",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    skippedCard: {
        backgroundColor: "#F0F9FF",
    },
    skippedFlightsContainer: {
        alignItems: "center",
        paddingVertical: 24,
        gap: 12,
    },
    skippedFlightsTitle: {
        fontSize: 16,
        fontWeight: "600",
    },
    skippedFlightsText: {
        fontSize: 13,
        textAlign: "center",
        color: "#64748B",
    },
    // Additional styles
    sectionTitle: {
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 16,
        color: "#1A1A1A",
    },
    emptyText: {
        textAlign: "center",
        color: "#94A3B8",
        fontSize: 14,
        marginVertical: 24,
    },
    emptySightsContainer: {
        alignItems: "center",
        paddingVertical: 32,
        borderRadius: 12,
    },
    emptySightsTitle: {
        fontSize: 18,
        fontWeight: "600",
        marginTop: 16,
        marginBottom: 8,
    },
    emptySightsText: {
        fontSize: 14,
        textAlign: "center",
        marginBottom: 20,
    },
    generateSightsButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    generateSightsButtonText: {
        fontSize: 14,
        fontWeight: "600",
    },
    loadingText: {
        fontSize: 12,
    },
    aiDisclaimer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderRadius: 8,
        marginTop: 16,
    },
    aiDisclaimerText: {
        fontSize: 12,
        flex: 1,
    },
    // Flight-related styles
    bestPriceBanner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: "#DCFCE7",
        borderRadius: 8,
        marginBottom: 16,
    },
    bestPriceText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#15803D",
    },
    flightOptionsLabel: {
        fontSize: 14,
        fontWeight: "600",
        marginBottom: 12,
    },
    flightOptionsScroll: {
        marginBottom: 16,
    },
    flightOptionCard: {
        backgroundColor: "white",
        borderRadius: 12,
        padding: 12,
        marginRight: 12,
        borderWidth: 2,
        borderColor: "#E2E8F0",
        minWidth: 140,
    },
    flightOptionCardSelected: {
        borderColor: "#14B8A6",
        backgroundColor: "#F0FDFA",
    },
    bestPriceBadge: {
        backgroundColor: "#10B981",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        alignSelf: "flex-start",
        marginBottom: 8,
    },
    bestPriceBadgeText: {
        color: "white",
        fontSize: 10,
        fontWeight: "700",
    },
    flightOptionAirline: {
        fontSize: 12,
        fontWeight: "600",
    },
    flightOptionTime: {
        fontSize: 12,
        color: "#64748B",
    },
    flightOptionPrice: {
        fontSize: 13,
        fontWeight: "700",
        color: "#14B8A6",
    },
    flightOptionStops: {
        fontSize: 11,
        color: "#94A3B8",
    },
    selectedFlightDetails: {
        backgroundColor: "#F8FAFC",
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
    },
    routeDisplay: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 16,
    },
    routePoint: {
        alignItems: "center",
        gap: 8,
        flex: 1,
    },
    routeAirport: {
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
    routeLine: {
        flex: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 8,
    },
    routeDash: {
        flex: 1,
        height: 2,
        backgroundColor: "#E2E8F0",
    },
    flightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    flightPrice: {
        fontSize: 16,
        fontWeight: "700",
        color: "#14B8A6",
    },
    luggageBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(20, 184, 166, 0.1)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    luggageText: {
        fontSize: 11,
        fontWeight: "600",
        color: "#14B8A6",
    },
    dataSourceBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(255, 149, 0, 0.1)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginBottom: 12,
    },
    dataSourceText: {
        fontSize: 11,
        fontWeight: "600",
        color: "#FF9500",
    },
    flightSegment: {
        marginBottom: 16,
    },
    segmentHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
    },
    segmentTitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    flightInfo: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 4,
    },
    cardSubtitle: {
        fontSize: 12,
        color: "#64748B",
    },
    duration: {
        fontSize: 12,
        color: "#94A3B8",
    },
    flightTimes: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: "#E2E8F0",
    },
    time: {
        fontSize: 12,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    divider: {
        height: 1,
        backgroundColor: "#E2E8F0",
        marginVertical: 12,
    },
    baggageSection: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: "#E2E8F0",
    },
    baggageSectionTitle: {
        fontSize: 14,
        fontWeight: "600",
        marginBottom: 12,
    },
    baggageOption: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
    },
    baggageCheckbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: "#E2E8F0",
        alignItems: "center",
        justifyContent: "center",
    },
    baggageLabel: {
        flex: 1,
        fontSize: 13,
        color: "#1A1A1A",
    },
    baggagePrice: {
        fontSize: 13,
        fontWeight: "600",
        color: "#14B8A6",
    },
    baggageCostInfo: {
        backgroundColor: "rgba(251, 191, 36, 0.1)",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        marginTop: 8,
    },
    baggageCostText: {
        fontSize: 12,
        color: "#B45309",
    },
    affiliateButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: "#14B8A6",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 16,
    },
    affiliateButtonText: {
        color: "white",
        fontSize: 14,
        fontWeight: "600",
    },
    // Baggage option styles
    baggageOptionLeft: {
        flex: 1,
    },
    baggageOptionInfo: {
        flex: 1,
    },
    baggageOptionTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    baggageOptionTitleSelected: {
        color: "#14B8A6",
    },
    baggageOptionDesc: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 4,
    },
    includedBadge: {
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    includedText: {
        fontSize: 11,
        fontWeight: "600",
        color: "#22C55E",
    },
    baggageOptionSelectable: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: "#E2E8F0",
        marginBottom: 8,
    },
    baggageOptionSelected: {
        borderColor: "#14B8A6",
        backgroundColor: "#F0FDFA",
    },
    baggageOptionRight: {
        alignItems: "flex-end",
        justifyContent: "center",
    },
    baggagePriceSelected: {
        color: "#14B8A6",
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: "#E2E8F0",
        alignItems: "center",
        justifyContent: "center",
    },
    checkboxSelected: {
        borderColor: "#14B8A6",
        backgroundColor: "#14B8A6",
    },
    baggageSummary: {
        backgroundColor: "#F8FAFC",
        padding: 12,
        borderRadius: 8,
        marginTop: 12,
    },
    baggageSummaryText: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    // Flight price style (standalone)
    price: {
        fontSize: 14,
        fontWeight: "700",
        color: "#14B8A6",
    },
    // Header image overlay styles
    headerImageOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        justifyContent: "flex-end",
        padding: 16,
    },
    headerTitleOverlay: {
        paddingBottom: 16,
    },
    headerTitleOnImage: {
        fontSize: 32,
        fontWeight: "700",
        color: "white",
        marginBottom: 12,
    },
    headerSubtitleRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    headerDateBadge: {
        backgroundColor: "rgba(255, 255, 255, 0.15)",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    headerDateText: {
        fontSize: 12,
        fontWeight: "600",
        color: "white",
    },
    headerTravelersBadge: {
        backgroundColor: "rgba(255, 255, 255, 0.15)",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    headerTravelersText: {
        fontSize: 12,
        fontWeight: "600",
        color: "white",
    },
    // Meta styles for activities
    metaDuration: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    metaDurationText: {
        fontSize: 12,
        fontWeight: "500",
    },
    // Restaurant styles
    restaurantHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
    },
    tripAdvisorLogo: {
        width: 80,
        height: 20,
        resizeMode: "contain",
    },
    ratingContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginVertical: 8,
    },
    ratingText: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    addressText: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 4,
    },
    // Skipped section styles
    skippedSection: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 32,
    },
    skippedIconContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: "#F1F5F9",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 12,
    },
    skippedTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 8,
    },
    skippedText: {
        fontSize: 13,
        color: "#64748B",
        textAlign: "center",
        marginHorizontal: 16,
    },
    skippedDivider: {
        height: 1,
        backgroundColor: "#E2E8F0",
        marginTop: 12,
    },
    // Additional missing styles
    skippedHint: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 8,
    },
    skippedButton: {
        backgroundColor: "#14B8A6",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 6,
        marginTop: 16,
    },
    skippedButtonText: {
        fontSize: 13,
        fontWeight: "600",
        color: "white",
    },
    bestPriceCard: {
        borderColor: "#15803D",
        borderWidth: 2,
        backgroundColor: "rgba(34, 197, 94, 0.05)",
    },
    airlineName: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    flightTime: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 4,
    },
    flightRoute: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginVertical: 8,
    },
    airportCode: {
        fontSize: 11,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    flightLineContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 8,
    },
    flightLine: {
        flex: 1,
        height: 1,
        backgroundColor: "#E2E8F0",
    },
    flightIcon: {
        width: 16,
        height: 16,
    },
    flightDuration: {
        fontSize: 12,
        color: "#94A3B8",
        marginTop: 4,
    },
    bookFlightButton: {
        backgroundColor: "#14B8A6",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 12,
        alignItems: "center",
    },
    bookFlightButtonText: {
        color: "white",
        fontSize: 14,
        fontWeight: "600",
    },
    sightHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
    },
    sightNumber: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    sightNumberText: {
        fontSize: 12,
        fontWeight: "700",
    },
    sightMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 8,
    },
    amenitiesContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
    },
    amenityBadge: {
        backgroundColor: "rgba(100, 116, 139, 0.1)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    amenityText: {
        fontSize: 11,
        color: "#475569",
    },
    transportHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
    },
    transportOption: {
        backgroundColor: "#F8FAFC",
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    transportMode: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    transportDesc: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 4,
    },
    transportPrice: {
        fontSize: 12,
        fontWeight: "600",
        color: "#14B8A6",
        marginTop: 6,
    },
    bookButton: {
        backgroundColor: "#14B8A6",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 6,
        marginTop: 8,
        alignItems: "center",
    },
    bookButtonText: {
        color: "white",
        fontSize: 13,
        fontWeight: "600",
    },
    // Insights section styles
    insightsSection: {
        paddingHorizontal: 16,
        paddingVertical: 24,
        backgroundColor: "#F8FAFC",
    },
    insightsSubtitle: {
        fontSize: 14,
        color: "#64748B",
        marginBottom: 16,
    },
    insightsScroll: {
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    insightCard: {
        backgroundColor: "white",
        borderRadius: 12,
        padding: 12,
        marginRight: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        minWidth: 280,
    },
    insightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    insightCategoryBadge: {
        backgroundColor: "rgba(100, 116, 139, 0.1)",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    insightCategoryText: {
        fontSize: 11,
        fontWeight: "600",
        color: "#475569",
        textTransform: "capitalize",
    },
    insightLikes: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    insightLikesText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#EF4444",
    },
    insightContent: {
        fontSize: 13,
        color: "#1A1A1A",
        lineHeight: 18,
        marginVertical: 8,
    },
    insightDate: {
        fontSize: 11,
        color: "#94A3B8",
    },
    // FAB styles
    fabContainer: {
        position: "absolute",
        bottom: 24,
        right: 24,
    },
    fab: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: "#14B8A6",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    fabIconButton: {
        width: 100,
        height: 100,
        alignItems: "center",
        justifyContent: "center",
    },
    // Modal styles
    modalContainer: {
        flex: 1,
        backgroundColor: "#F8F8F5",
    },
    modalHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "white",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    modalContent: {
        paddingHorizontal: 16,
        paddingVertical: 24,
        backgroundColor: "#F8F8F5",
    },
    sectionContainer: {
        marginBottom: 32,
    },
    sectionLabel: {
        fontSize: 14,
        fontWeight: "600",
        color: "#64748B",
        marginBottom: 12,
        marginLeft: 4,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    // Input styles
    inputGroup: {
        marginBottom: 12,
    },
    label: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 8,
    },
    lockedInput: {
        backgroundColor: "#F1F5F9",
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    lockedInputText: {
        fontSize: 14,
        color: "#64748B",
        fontWeight: "500",
    },
    input: {
        backgroundColor: "white",
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        fontSize: 14,
        color: "#1A1A1A",
    },
    datesContainer: {
        flexDirection: "row",
        gap: 12,
    },
    dateInputButton: {
        flex: 1,
        backgroundColor: "white",
        borderWidth: 1,
        borderColor: "#E2E8F0",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    dateLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#94A3B8",
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    dateValueContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    dateValueText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    dateSeparator: {
        alignSelf: "center",
        width: 1,
        height: 50,
        backgroundColor: "#E2E8F0",
    },
    calendarModalContainer: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        justifyContent: "flex-end",
    },
    calendarModal: {
        backgroundColor: "white",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        maxHeight: "90%",
    },
    calendarHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },
    calendarHeaderText: {
        fontSize: 13,
        fontWeight: "600",
        color: "#14B8A6",
    },
    calendarHeaderTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    saveButton: {
        backgroundColor: "#14B8A6",
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        marginTop: 16,
        shadowColor: "#14B8A6",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 4,
    },
    saveButtonText: {
        color: "white",
        fontSize: 15,
        fontWeight: "700",
    },
    // Interests and other styles
    interestsContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    interestTag: {
        backgroundColor: "#F1F5F9",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    interestTagActive: {
        backgroundColor: "#14B8A6",
        borderColor: "#14B8A6",
    },
    interestTagText: {
        fontSize: 13,
        color: "#64748B",
        fontWeight: "500",
    },
    interestTagTextActive: {
        color: "white",
    },
    section: {
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
    },
});
