import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Image, Linking, Platform, Alert, Modal, TextInput, KeyboardAvoidingView } from "react-native";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect, useRef } from "react";
import { BlurView } from "expo-blur";
import { useDestinationImage } from "@/lib/useImages";
import ActivityCard from "@/components/ActivityCard";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useTheme } from "@/lib/ThemeContext";
import { LinearGradient } from "expo-linear-gradient";

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
    const trip = useQuery(api.trips.get, { tripId: id as Id<"trips"> });
    const updateTrip = useMutation(api.trips.update);
    const regenerateTrip = useMutation(api.trips.regenerate);
    const trackClick = useMutation(api.bookings.trackClick);
    const insights = useQuery(api.insights.getDestinationInsights, trip ? { destination: trip.destination } : "skip");
    const { image: destinationImage } = useDestinationImage(trip?.destination);
    const getDestinationImages = useAction(api.images.getDestinationImages);

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
                        {/* Destination Name */}
                        <Text style={styles.loadingDestination}>{trip.destination}</Text>
                        
                        {/* Animated Plane Icon */}
                        <View style={styles.loadingIconContainer}>
                            <Ionicons name="airplane" size={48} color="#FFE500" />
                        </View>
                        
                        {/* Status Text */}
                        <Text style={styles.loadingTitle}>Creating your perfect trip</Text>
                        <Text style={styles.loadingSubtitle}>
                            Finding the best flights, hotels & activities...
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
                                    name={loadingProgress > 20 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 20 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 20 && styles.loadingStepComplete]}>
                                    Searching flights
                                </Text>
                            </View>
                            <View style={styles.loadingStep}>
                                <Ionicons 
                                    name={loadingProgress > 45 ? "checkmark-circle" : "ellipse-outline"} 
                                    size={20} 
                                    color={loadingProgress > 45 ? "#10B981" : "rgba(255,255,255,0.5)"} 
                                />
                                <Text style={[styles.loadingStepText, loadingProgress > 45 && styles.loadingStepComplete]}>
                                    Finding accommodations
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

    const allAccommodations = trip.itinerary?.hotels || [];
    
    // Filter accommodations based on selected type
    const filteredAccommodations = accommodationType === 'all' 
        ? allAccommodations 
        : allAccommodations.filter((acc: any) => acc.type === accommodationType);
    
    // Get hotels and airbnbs counts
    const hotelsCount = allAccommodations.filter((acc: any) => acc.type === 'hotel' || !acc.type).length;
    const airbnbsCount = allAccommodations.filter((acc: any) => acc.type === 'airbnb').length;
    
    const selectedAccommodation = selectedHotelIndex !== null 
        ? allAccommodations[selectedHotelIndex] 
        : allAccommodations[0];
    
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
                            {trip.skipFlights ? (
                                <View style={[styles.card, styles.skippedCard]}>
                                    <View style={styles.skippedSection}>
                                        <View style={styles.skippedIconContainer}>
                                            <Ionicons name="airplane" size={32} color="#64748B" />
                                        </View>
                                        <Text style={styles.skippedTitle}>Flight Search Skipped</Text>
                                        <Text style={styles.skippedText}>
                                            {trip.itinerary?.flights?.message || "You've chosen to skip flight searches for this trip."}
                                        </Text>
                                        <View style={styles.skippedDivider} />
                                        <Text style={styles.skippedHint}>
                                            To enable flight booking, create a traveler profile in Settings with your passport details.
                                        </Text>
                                        <TouchableOpacity 
                                            style={styles.skippedButton}
                                            onPress={() => router.push('/settings/traveler-profiles')}
                                        >
                                            <Ionicons name="person-add-outline" size={18} color="#1A1A1A" />
                                            <Text style={styles.skippedButtonText}>Create Traveler Profile</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <>
                                    {trip.itinerary?.flights?.options?.map((flight: any, index: number) => (
                                        <View key={index} style={[styles.card, flight.isBestPrice && styles.bestPriceCard]}>
                                            {flight.isBestPrice && (
                                                <View style={styles.bestPriceBadge}>
                                                    <Text style={styles.bestPriceBadgeText}>Best Price</Text>
                                                </View>
                                            )}
                                            <View style={styles.flightHeader}>
                                                <View>
                                                    <Text style={styles.airlineName}>{flight.outbound.airline}</Text>
                                                    <Text style={styles.flightTime}>{flight.outbound.departure} - {flight.outbound.arrival}</Text>
                                                </View>
                                                <Text style={styles.flightPrice}>€{flight.pricePerPerson}</Text>
                                            </View>
                                            <View style={styles.flightRoute}>
                                                <Text style={styles.airportCode}>{trip.origin ? trip.origin.substring(0, 3).toUpperCase() : 'ORG'}</Text>
                                                <View style={styles.flightLineContainer}>
                                                    <View style={styles.flightLine} />
                                                    <Ionicons name="airplane" size={16} color="#64748B" style={styles.flightIcon} />
                                                </View>
                                                <Text style={styles.airportCode}>{trip.destination ? trip.destination.substring(0, 3).toUpperCase() : 'DST'}</Text>
                                            </View>
                                            <Text style={styles.flightDuration}>{flight.outbound.duration} • {flight.outbound.stops === 0 ? 'Direct' : `${flight.outbound.stops} Stop(s)`}</Text>
                                            
                                            <View style={styles.divider} />
                                            
                                            <View style={styles.flightHeader}>
                                                <View>
                                                    <Text style={styles.airlineName}>{flight.return.airline}</Text>
                                                    <Text style={styles.flightTime}>{flight.return.departure} - {flight.return.arrival}</Text>
                                                </View>
                                            </View>
                                            <View style={styles.flightRoute}>
                                                <Text style={styles.airportCode}>{trip.destination ? trip.destination.substring(0, 3).toUpperCase() : 'DST'}</Text>
                                                <View style={styles.flightLineContainer}>
                                                    <View style={styles.flightLine} />
                                                    <Ionicons name="airplane" size={16} color="#64748B" style={[styles.flightIcon, { transform: [{ rotate: '180deg' }] }]} />
                                                </View>
                                                <Text style={styles.airportCode}>{trip.origin ? trip.origin.substring(0, 3).toUpperCase() : 'ORG'}</Text>
                                            </View>
                                            <Text style={styles.flightDuration}>{flight.return.duration} • {flight.return.stops === 0 ? 'Direct' : `${flight.return.stops} Stop(s)`}</Text>
                                            
                                            {/* Book Flight Button - Navigate to booking flow for Duffel, or open URL for fallback */}
                                            <TouchableOpacity 
                                                style={styles.bookFlightButton}
                                                onPress={() => {
                                                    // Check if this is a Duffel flight (has offer ID)
                                                    if (flight.id && trip.itinerary?.flights?.dataSource === 'duffel') {
                                                        // Navigate to booking screen with passenger details form
                                                        router.push({
                                                            pathname: '/flight-booking',
                                                            params: {
                                                                offerId: flight.id,
                                                                tripId: id,
                                                                passengers: String(trip.travelers || 1),
                                                                flightInfo: JSON.stringify({
                                                                    outbound: flight.outbound,
                                                                    return: flight.return,
                                                                    pricePerPerson: flight.pricePerPerson,
                                                                    currency: flight.currency || 'EUR',
                                                                }),
                                                            },
                                                        });
                                                    } else if (flight.bookingUrl) {
                                                        // Fallback: open booking URL directly
                                                        Linking.openURL(flight.bookingUrl);
                                                    } else {
                                                        // No booking option available
                                                        if (Platform.OS !== 'web') {
                                                            Alert.alert('Booking Unavailable', 'No booking link available for this flight. Please search for this flight on your preferred booking site.');
                                                        }
                                                    }
                                                }}
                                            >
                                                <Text style={styles.bookFlightButtonText}>Book Flight</Text>
                                                <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                                            </TouchableOpacity>
                                        </View>
                                    ))}
                                    {(!trip.itinerary?.flights || 
                                        (trip.itinerary.flights.options && trip.itinerary.flights.options.length === 0) ||
                                        (Array.isArray(trip.itinerary.flights) && trip.itinerary.flights.length === 0)
                                    ) && (
                                        <Text style={styles.emptyText}>No flights found.</Text>
                                    )}
                                </>
                            )}
                        </View>
                    )}

                    {activeFilter === 'sights' && (
                        <View>
                            <Text style={styles.sectionTitle}>Top Sights & Activities</Text>
                            {trip.itinerary?.activities?.map((activity: any, index: number) => (
                                <ActivityCard key={index} activity={activity} destination={trip.destination} />
                            ))}
                            {(!trip.itinerary?.activities || trip.itinerary.activities.length === 0) && (
                                <Text style={styles.emptyText}>No activities found.</Text>
                            )}
                        </View>
                    )}

                    {activeFilter === 'stays' && (
                        <View>
                            <Text style={styles.sectionTitle}>Accommodations</Text>
                            {trip.skipHotel ? (
                                <View style={[styles.card, styles.skippedCard]}>
                                    <View style={styles.skippedSection}>
                                        <View style={styles.skippedIconContainer}>
                                            <Ionicons name="bed" size={32} color="#64748B" />
                                        </View>
                                        <Text style={styles.skippedTitle}>Hotel Search Skipped</Text>
                                        <Text style={styles.skippedText}>
                                            You've chosen to skip hotel searches for this trip. This could be because you already have accommodation booked or you're staying with friends/family.
                                        </Text>
                                        <View style={styles.skippedDivider} />
                                        <Text style={styles.skippedHint}>
                                            To enable hotel booking, create a traveler profile in Settings with your details.
                                        </Text>
                                        <TouchableOpacity 
                                            style={styles.skippedButton}
                                            onPress={() => router.push('/settings/traveler-profiles')}
                                        >
                                            <Ionicons name="person-add-outline" size={18} color="#1A1A1A" />
                                            <Text style={styles.skippedButtonText}>Create Traveler Profile</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <>
                                    {trip.itinerary?.hotels?.map((hotel: any, index: number) => (
                                        <View key={index} style={styles.card}>
                                            <View style={styles.row}>
                                                <View style={styles.flightInfo}>
                                                    <Text style={styles.cardTitle}>{hotel.name}</Text>
                                                    <Text style={styles.cardSubtitle}>{hotel.address}</Text>
                                                    <View style={styles.ratingContainer}>
                                                        <Ionicons name="star" size={14} color="#F59E0B" />
                                                        <Text style={styles.ratingText}>{hotel.rating} Stars</Text>
                                                    </View>
                                                    <Text style={styles.activityDesc} numberOfLines={3}>{hotel.description}</Text>
                                                    <Text style={styles.price}>€{hotel.price} / night</Text>
                                                </View>
                                            </View>
                                            <View style={styles.amenitiesContainer}>
                                                {hotel.amenities?.map((amenity: string, i: number) => (
                                                    <View key={i} style={styles.amenityBadge}>
                                                        <Text style={styles.amenityText}>{amenity}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        </View>
                                    ))}
                                    {(!trip.itinerary?.hotels || trip.itinerary.hotels.length === 0) && (
                                        <Text style={styles.emptyText}>No accommodations found.</Text>
                                    )}
                                </>
                            )}
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
                <View style={styles.fab}>
                    <TouchableOpacity style={styles.fabIconButton} onPress={() => setIsEditing(true)}>
                        <Ionicons name="pencil" size={20} color="#475569" />
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
                    style={styles.modalContainer}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
                >
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Edit Trip Details</Text>
                        <TouchableOpacity onPress={() => setIsEditing(false)}>
                            <Ionicons name="close" size={24} color="#1C1C1E" />
                        </TouchableOpacity>
                    </View>
                    
                    <ScrollView contentContainerStyle={styles.modalContent}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Destination</Text>
                            <View style={styles.lockedInput}>
                                <Text style={styles.lockedInputText}>{editForm.destination}</Text>
                                <Ionicons name="lock-closed" size={16} color="#94A3B8" />
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Dates</Text>
                            <View style={styles.datesContainer}>
                                <TouchableOpacity 
                                    style={styles.dateInputButton}
                                    onPress={() => {
                                        setSelectingDate('start');
                                        setShowCalendar(true);
                                    }}
                                >
                                    <Text style={styles.dateLabel}>START DATE</Text>
                                    <View style={styles.dateValueContainer}>
                                        <Ionicons name="calendar-outline" size={20} color="#1A1A1A" />
                                        <Text style={styles.dateValueText}>{formatDate(editForm.startDate)}</Text>
                                    </View>
                                </TouchableOpacity>
                                
                                <View style={styles.dateSeparator} />

                                <TouchableOpacity 
                                    style={styles.dateInputButton}
                                    onPress={() => {
                                        setSelectingDate('end');
                                        setShowCalendar(true);
                                    }}
                                >
                                    <Text style={styles.dateLabel}>END DATE</Text>
                                    <View style={styles.dateValueContainer}>
                                        <Ionicons name="calendar-outline" size={20} color="#1A1A1A" />
                                        <Text style={styles.dateValueText}>{formatDate(editForm.endDate)}</Text>
                                    </View>
                                </TouchableOpacity>
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
                                    <View style={styles.calendarModal}>
                                        <View style={styles.calendarHeader}>
                                            <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                                <Text style={styles.calendarHeaderText}>Cancel</Text>
                                            </TouchableOpacity>
                                            <Text style={styles.calendarHeaderTitle}>
                                                {selectingDate === 'start' ? 'Start Date' : 'End Date'}
                                            </Text>
                                            <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                                <Text style={styles.calendarHeaderText}>Done</Text>
                                            </TouchableOpacity>
                                        </View>
                                        <Calendar
                                            onDayPress={handleDayPress}
                                            markedDates={getMarkedDates()}
                                            minDate={new Date().toISOString().split('T')[0]}
                                            theme={{
                                                backgroundColor: '#FAF9F6',
                                                calendarBackground: '#FAF9F6',
                                                textSectionTitleColor: '#1A1A1A',
                                                textSectionTitleDisabledColor: '#9B9B9B',
                                                selectedDayBackgroundColor: '#FFE500',
                                                selectedDayTextColor: '#1A1A1A',
                                                todayTextColor: '#FFE500',
                                                dayTextColor: '#1A1A1A',
                                                textDisabledColor: '#9B9B9B',
                                                dotColor: '#FFE500',
                                                selectedDotColor: '#1A1A1A',
                                                arrowColor: '#1A1A1A',
                                                monthTextColor: '#1A1A1A',
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

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Budget (€) <Text style={{ color: '#EF4444' }}>*</Text></Text>
                            <TextInput
                                style={styles.input}
                                value={editForm.budget.toString()}
                                onChangeText={(text) => {
                                    const numValue = parseInt(text) || 0;
                                    setEditForm(prev => ({ ...prev, budget: numValue }));
                                }}
                                keyboardType="numeric"
                                placeholder="e.g. 2000"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Travelers</Text>
                            <TextInput
                                style={styles.input}
                                value={editForm.travelers.toString()}
                                onChangeText={(text) => {
                                    const numValue = parseInt(text) || 1;
                                    setEditForm(prev => ({ ...prev, travelers: numValue }));
                                }}
                                keyboardType="number-pad"
                                placeholder="Number of travelers"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Travel Style</Text>
                            <View style={styles.interestsContainer}>
                                {INTERESTS.map((interest) => (
                                    <TouchableOpacity
                                        key={interest}
                                        style={[
                                            styles.interestTag,
                                            editForm.interests.includes(interest) && styles.interestTagActive,
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
                                            color={editForm.interests.includes(interest) ? "#1A1A1A" : "#546E7A"}
                                        />
                                        <Text style={[
                                            styles.interestTagText,
                                            editForm.interests.includes(interest) && styles.interestTagTextActive,
                                        ]}>
                                            {interest}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <TouchableOpacity 
                            style={styles.saveButton}
                            onPress={handleSaveAndRegenerate}
                        >
                            <Text style={styles.saveButtonText}>Save & Regenerate</Text>
                        </TouchableOpacity>
                        <View style={{ height: 40 }} />
                    </ScrollView>
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
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: "#F1F5F9",
    },
    metaText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    metaDuration: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    metaDurationText: {
        fontSize: 12,
        color: "#94A3B8",
    },
    fabContainer: {
        position: "absolute",
        bottom: 24,
        left: 0,
        right: 0,
        alignItems: "center",
        paddingHorizontal: 24,
    },
    fab: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderRadius: 32,
        padding: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 24,
        elevation: 8,
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.2)",
    },
    saveTripButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F9F506",
        height: 48,
        borderRadius: 24,
        gap: 8,
        paddingHorizontal: 24,
    },
    saveTripText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    fabDivider: {
        width: 1,
        height: 24,
        backgroundColor: "#E2E8F0",
        marginHorizontal: 8,
    },
    fabIconButton: {
        width: 48,
        height: 48,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 24,
    },
    modalContainer: {
        flex: 1,
        backgroundColor: "#FAF9F6",
    },
    modalHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 16,
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
    },
    inputGroup: {
        marginBottom: 24,
    },
    label: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    lockedInput: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#F1F5F9",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    lockedInputText: {
        fontSize: 16,
        color: "#1A1A1A",
        fontWeight: "500",
    },
    datesContainer: {
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
    },
    dateInputButton: {
        flex: 1,
        backgroundColor: "white",
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    dateLabel: {
        fontSize: 12,
        fontWeight: "600",
        color: "#64748B",
        marginBottom: 8,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    dateValueContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dateValueText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    dateSeparator: {
        width: 1,
        height: 40,
        backgroundColor: "#E2E8F0",
    },
    calendarModalContainer: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        justifyContent: "flex-end",
    },
    calendarModal: {
        backgroundColor: "#FAF9F6",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 16,
        maxHeight: "80%",
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
        fontSize: 16,
        fontWeight: "600",
        color: "#FFE500",
    },
    calendarHeaderTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    interestsContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
    },
    interestTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 24,
        backgroundColor: "#FFE500",
        borderWidth: 1,
        borderColor: "#FFE500",
    },
    interestTagActive: {
        backgroundColor: "white",
        borderColor: "white",
    },
    interestTagText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    interestTagTextActive: {
        color: "#1A1A1A",
    },
    input: {
        backgroundColor: "white",
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        fontSize: 16,
        color: "#1A1A1A",
    },
    saveButton: {
        backgroundColor: "#FFE500",
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: "center",
        marginTop: 24,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 16,
        letterSpacing: 0.5,
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#F8F8F5",
    },
    generatingText: {
        marginTop: 16,
        fontSize: 18,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    generatingSubtext: {
        marginTop: 8,
        fontSize: 14,
        color: "#64748B",
    },
    errorText: {
        marginTop: 16,
        fontSize: 18,
        color: "#EF4444",
    },
    errorContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
        backgroundColor: "#F8F8F5",
    },
    errorTitle: {
        marginTop: 24,
        fontSize: 24,
        fontWeight: "700",
        color: "#1A1A1A",
        textAlign: "center",
    },
    errorMessage: {
        marginTop: 12,
        fontSize: 16,
        color: "#64748B",
        textAlign: "center",
        lineHeight: 24,
    },
    errorButton: {
        marginTop: 32,
        paddingHorizontal: 32,
        paddingVertical: 14,
        backgroundColor: "#1A1A1A",
        borderRadius: 12,
    },
    errorButtonText: {
        color: "white",
        fontSize: 16,
        fontWeight: "700",
    },
    card: {
        backgroundColor: "white",
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    skippedFlightsContainer: {
        alignItems: "center",
        padding: 24,
        gap: 12,
    },
    skippedFlightsTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    skippedFlightsText: {
        fontSize: 14,
        color: "#64748B",
        textAlign: "center",
        lineHeight: 20,
    },
    bestPriceBanner: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F0FDF4",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        marginBottom: 16,
        gap: 8,
    },
    bestPriceText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#15803D",
    },
    flightOptionsLabel: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
        marginBottom: 12,
    },
    flightOptionsScroll: {
        marginBottom: 20,
    },
    flightOptionCard: {
        width: 140,
        backgroundColor: "white",
        borderRadius: 14,
        padding: 14,
        marginRight: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        alignItems: "center",
    },
    flightOptionCardSelected: {
        borderColor: "#F9F506",
        backgroundColor: "#FEFCE8",
    },
    bestPriceBadge: {
        backgroundColor: "#15803D",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginBottom: 8,
    },
    bestPriceBadgeText: {
        fontSize: 10,
        fontWeight: "700",
        color: "white",
        textTransform: "uppercase",
    },
    flightOptionAirline: {
        fontSize: 12,
        fontWeight: "600",
        color: "#1A1A1A",
        textAlign: "center",
        marginBottom: 4,
    },
    flightOptionTime: {
        fontSize: 14,
        fontWeight: "500",
        color: "#1A1A1A",
        marginBottom: 4,
    },
    flightOptionPrice: {
        fontSize: 18,
        fontWeight: "800",
        color: "#1A1A1A",
        marginBottom: 4,
    },
    flightOptionStops: {
        fontSize: 11,
        color: "#64748B",
        fontWeight: "600",
        marginTop: 4,
    },
    selectedFlightDetails: {
        backgroundColor: "#F8FAFC",
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
    },
    routeDisplay: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "white",
        padding: 16,
        borderRadius: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    routePoint: {
        alignItems: "center",
        gap: 4,
        flex: 1,
    },
    routeAirport: {
        fontSize: 12,
        fontWeight: "600",
        color: "#1A1A1A",
        textAlign: "center",
    },
    routeLine: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
        marginHorizontal: 12,
    },
    routeDash: {
        height: 2,
        backgroundColor: "#CBD5E1",
        flex: 1,
        marginHorizontal: 4,
    },
    flightHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 20,
    },
    flightPrice: {
        fontSize: 24,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    luggageBadge: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F1F5F9",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
    },
    luggageText: {
        fontSize: 12,
        color: "#475569",
        fontWeight: "600",
    },
    dataSourceBadge: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FEF3C7",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginTop: 8,
        marginBottom: 12,
        gap: 6,
    },
    dataSourceText: {
        fontSize: 12,
        color: "#D97706",
        fontWeight: "600",
    },
    flightSegment: {
        marginBottom: 12,
    },
    segmentHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
    },
    segmentTitle: {
        fontSize: 12,
        fontWeight: "700",
        color: "#64748B",
        textTransform: "uppercase",
        letterSpacing: 1,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    flightInfo: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    cardSubtitle: {
        fontSize: 14,
        color: "#64748B",
    },
    duration: {
        fontSize: 14,
        color: "#64748B",
    },
    flightTimes: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: "#E2E8F0",
    },
    time: {
        fontSize: 16,
        fontWeight: "500",
        color: "#1A1A1A",
    },
    divider: {
        height: 1,
        backgroundColor: "#E2E8F0",
        marginVertical: 20,
    },
    baggageSection: {
        marginTop: 16,
    },
    baggageSectionTitle: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 12,
    },
    baggageOption: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "white",
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    baggageOptionLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    baggageOptionInfo: {
        flexDirection: "column",
        gap: 4,
    },
    baggageOptionTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    baggageOptionDesc: {
        fontSize: 12,
        color: "#64748B",
    },
    baggageOptionRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    baggagePrice: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    baggageOptionSelectable: {
        backgroundColor: "white",
        borderWidth: 1,
        borderColor: "#E2E8F0",
    },
    baggageOptionSelected: {
        backgroundColor: "#FEFCE8",
        borderColor: "#F9F506",
    },
    baggagePriceSelected: {
        color: "#1A1A1A",
    },
    baggageOptionTitleSelected: {
        color: "#1A1A1A",
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#94A3B8",
        alignItems: "center",
        justifyContent: "center",
    },
    checkboxSelected: {
        backgroundColor: "#F9F506",
        borderColor: "#F9F506",
    },
    baggageSummary: {
        alignItems: "center",
        marginTop: 12,
    },
    baggageSummaryText: {
        fontSize: 12,
        color: "#64748B",
        textAlign: "center",
    },
    includedBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    includedText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#15803D",
    },
    affiliateButton: {
        marginTop: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1A1A1A",
        paddingVertical: 12,
        borderRadius: 8,
        gap: 8,
    },
    affiliateButtonText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "600",
    },
    price: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    ratingContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 4,
    },
    ratingText: {
        fontSize: 12,
        color: "#1A1A1A",
    },
    addressText: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 4,
    },
    priceRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 8,
    },
    skipLineBadge: {
        backgroundColor: "#FEF3C7",
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    skipLineText: {
        fontSize: 10,
        fontWeight: "700",
        color: "#D97706",
        textTransform: "uppercase",
    },
    activityThumbnail: {
        width: 80,
        height: 80,
        borderRadius: 8,
        backgroundColor: "#E2E8F0",
    },
    bookButton: {
        marginTop: 16,
        backgroundColor: "#1A2433",
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: "center",
    },
    bookButtonText: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 14,
    },
    amenitiesContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 12,
    },
    amenityBadge: {
        backgroundColor: "#F1F5F9",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    amenityText: {
        fontSize: 12,
        color: "#475569",
    },
    transportHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
    },
    transportOption: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: "#E2E8F0",
    },
    transportMode: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    transportDesc: {
        fontSize: 12,
        color: "#64748B",
        marginTop: 2,
    },
    transportPrice: {
        fontSize: 12,
        fontWeight: "600",
        color: "#1A1A1A",
        marginTop: 4,
    },
    emptyText: {
        textAlign: "center",
        color: "#64748B",
        fontSize: 16,
        marginTop: 32,
    },
    restaurantHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    tripAdvisorLogo: {
        width: 100,
        height: 20,
        marginLeft: 8,
    },
    bestPriceCard: {
        borderColor: '#15803D',
        borderWidth: 1,
        backgroundColor: '#F0FDF4',
    },
    airlineName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    flightTime: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A1A1A',
        marginTop: 2,
    },
    flightRoute: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 12,
        marginBottom: 4,
    },
    airportCode: {
        fontSize: 14,
        fontWeight: '700',
        color: '#64748B',
    },
    flightLineContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 12,
    },
    flightLine: {
        height: 1,
        backgroundColor: '#CBD5E1',
        flex: 1,
    },
    flightIcon: {
        marginHorizontal: 8,
    },
    flightDuration: {
        fontSize: 12,
        color: '#64748B',
        textAlign: 'center',
    },
    bookFlightButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1A2433',
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 16,
        gap: 8,
    },
    bookFlightButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    activityThumbnailPlaceholder: {
        width: 80,
        height: 80,
        borderRadius: 8,
        backgroundColor: "#E2E8F0",
        alignItems: "center",
        justifyContent: "center",
    },
    skippedSection: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 32,
        paddingHorizontal: 16,
    },
    skippedCard: {
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderStyle: 'dashed',
    },
    skippedIconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    skippedTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#334155',
        marginTop: 8,
    },
    skippedText: {
        fontSize: 14,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
        maxWidth: 280,
    },
    skippedDivider: {
        width: 40,
        height: 1,
        backgroundColor: '#E2E8F0',
        marginVertical: 16,
    },
    skippedHint: {
        fontSize: 13,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 260,
    },
    skippedButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#FFE500',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
        marginTop: 16,
    },
    skippedButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1A1A1A',
    },
    // Empty transport styles
    emptyTransportCard: {
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderStyle: 'dashed',
    },
    emptyTransportContent: {
        alignItems: 'center',
        paddingVertical: 32,
        paddingHorizontal: 24,
    },
    emptyTransportTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#334155',
        marginTop: 12,
        textAlign: 'center',
    },
    emptyTransportText: {
        fontSize: 14,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
    // Transport card improvements
    transportCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    transportIconBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#1A1A1A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    transportContent: {
        flex: 1,
    },
    transportFeatures: {
        marginTop: 12,
    },
    // Enhanced insights styles
    insightsSection: {
        padding: 16,
        marginHorizontal: 16,
        marginBottom: 32,
        borderRadius: 16,
    },
    insightsHeader: {
        marginBottom: 16,
    },
    insightsTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    insightsSectionTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    insightsSubtitle: {
        fontSize: 13,
        marginLeft: 28,
    },
    insightsScrollContent: {
        paddingRight: 16,
    },
    insightsScroll: {
        marginBottom: 24,
    },
    insightCard: {
        width: 220,
        borderRadius: 12,
        padding: 14,
        marginRight: 12,
        borderWidth: 1,
        borderColor: '#FEF3C7',
    },
    insightHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    insightCategoryBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
    },
    insightCategoryText: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    verifiedBadge: {
        padding: 2,
    },
    insightContent: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 10,
    },
    insightFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    insightDate: {
        fontSize: 12,
    },
    insightLikes: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    insightLikesText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#F59E0B',
    },
    // Loading screen styles
    loadingContainer: {
        flex: 1,
        backgroundColor: '#1A1A1A',
    },
    loadingBackgroundImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    loadingContent: {
        flex: 1,
        justifyContent: 'space-between',
    },
    loadingBackButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        marginLeft: 16,
    },
    loadingCenterContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    loadingDestination: {
        fontSize: 36,
        fontWeight: '800',
        color: 'white',
        textAlign: 'center',
        marginBottom: 24,
    },
    loadingIconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'rgba(255,229,0,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    loadingTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: 'white',
        textAlign: 'center',
        marginBottom: 8,
    },
    loadingSubtitle: {
        fontSize: 16,
        color: 'rgba(255,255,255,0.7)',
        textAlign: 'center',
        marginBottom: 32,
    },
    progressBarBackground: {
        width: '100%',
        height: 8,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 4,
    },
    progressBarFill: {
        height: 8,
        backgroundColor: '#FFE500',
        borderRadius: 4,
    },
    progressText: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.7)',
        marginTop: 12,
    },
    progressBarContainer: {
        width: '100%',
        alignItems: 'center',
    },
    loadingSteps: {
        marginTop: 24,
    },
    loadingStep: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 12,
    },
    loadingStepText: {
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
    },
    loadingStepComplete: {
        color: '#FFE500',
    },
    loadingAttribution: {
        alignItems: 'center',
        paddingBottom: 32,
    },
    loadingAttributionText: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
    },
    imageIndicators: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
        marginBottom: 16,
    },
    imageIndicator: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.3)',
    },
    imageIndicatorActive: {
        backgroundColor: '#FFE500',
        width: 20,
    },
    // Header overlay styles
    headerImageOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingTop: 80,
        paddingBottom: 16,
        paddingHorizontal: 16,
    },
    headerTitleOverlay: {
        marginBottom: 8,
    },
    headerTitleOnImage: {
        fontSize: 28,
        fontWeight: '800',
        color: 'white',
        marginBottom: 8,
    },
    headerSubtitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    headerDateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    headerDateText: {
        fontSize: 13,
        color: 'white',
        fontWeight: '500',
    },
    headerTravelersBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    headerTravelersText: {
        fontSize: 13,
        color: 'white',
        fontWeight: '500',
    },
    // Transport additional styles
    transportTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A1A1A',
        marginBottom: 4,
    },
    transportOptionsContainer: {
        gap: 8,
    },
    transportOptionItem: {
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        padding: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    transportOptionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    transportOptionPrice: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    transportDayPass: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 4,
    },
    transportDescription: {
        fontSize: 14,
        color: '#64748B',
        lineHeight: 20,
        marginBottom: 8,
    },
    transportPriceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    transportPriceLabel: {
        fontSize: 12,
        color: '#94A3B8',
        fontWeight: '500',
    },
    transportPriceValue: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    transportFeatureBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 6,
    },
    transportFeatureText: {
        fontSize: 12,
        color: '#475569',
    },
    transportBookButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#FFE500',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
