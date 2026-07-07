import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useDestinationImage } from "@/lib/useImages";
import { ImageWithAttribution } from "@/components/ImageWithAttribution";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { resolveIATA } from "@/lib/destinationAirports";

// Destination highlights data
const DESTINATION_HIGHLIGHTS: Record<string, { emoji: string; highlights: string[]; bestFor: string[]; bestTime: string }> = {
    // Western Europe
    "Paris": {
        emoji: "🗼",
        highlights: ["Eiffel Tower", "Louvre Museum", "Champs-Élysées", "Notre-Dame"],
        bestFor: ["Romance", "Art & Culture", "Food & Wine"],
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
    "Amsterdam": {
        emoji: "🚲",
        highlights: ["Anne Frank House", "Van Gogh Museum", "Canal Cruise", "Vondelpark"],
        bestFor: ["Art", "Cycling", "History", "Nightlife"],
        bestTime: "Apr - May, Sep - Nov"
    },
    "Berlin": {
        emoji: "🐻",
        highlights: ["Brandenburg Gate", "Berlin Wall", "Museum Island", "Kreuzberg"],
        bestFor: ["History", "Nightlife", "Art", "Street Food"],
        bestTime: "May - Sep"
    },
    "Madrid": {
        emoji: "🏟️",
        highlights: ["Prado Museum", "Retiro Park", "Royal Palace", "Plaza Mayor"],
        bestFor: ["Art", "Nightlife", "Food", "Football"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Milan": {
        emoji: "👗",
        highlights: ["Duomo", "The Last Supper", "Galleria Vittorio Emanuele", "Navigli"],
        bestFor: ["Fashion", "Art", "Design", "Food"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Florence": {
        emoji: "🌻",
        highlights: ["Uffizi Gallery", "Ponte Vecchio", "Duomo", "Piazzale Michelangelo"],
        bestFor: ["Art", "Architecture", "Wine", "History"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Venice": {
        emoji: "🚣",
        highlights: ["Grand Canal", "St. Mark's Square", "Rialto Bridge", "Burano Island"],
        bestFor: ["Romance", "Architecture", "Gondola Rides", "Art"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "Munich": {
        emoji: "🍺",
        highlights: ["Marienplatz", "Englischer Garten", "Neuschwanstein Castle", "Hofbräuhaus"],
        bestFor: ["Beer", "Culture", "History", "Alps"],
        bestTime: "Jun - Oct"
    },
    "Lisbon": {
        emoji: "🚋",
        highlights: ["Belém Tower", "Tram 28", "Alfama", "Pastéis de Nata"],
        bestFor: ["History", "Food", "Nightlife", "Beach"],
        bestTime: "Mar - Oct"
    },
    "Porto": {
        emoji: "🍷",
        highlights: ["Ribeira District", "Port Wine Cellars", "Livraria Lello", "Dom Luís Bridge"],
        bestFor: ["Wine", "Food", "Architecture", "River Cruises"],
        bestTime: "May - Sep"
    },
    "Dublin": {
        emoji: "🍀",
        highlights: ["Trinity College", "Temple Bar", "Guinness Storehouse", "St. Patrick's Cathedral"],
        bestFor: ["Pubs", "History", "Literature", "Music"],
        bestTime: "May - Sep"
    },
    "Vienna": {
        emoji: "🎵",
        highlights: ["Schönbrunn Palace", "St. Stephen's Cathedral", "Naschmarkt", "Opera House"],
        bestFor: ["Classical Music", "Palaces", "Coffee Culture", "Art"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Zurich": {
        emoji: "⛰️",
        highlights: ["Old Town", "Lake Zurich", "Kunsthaus", "Bahnhofstrasse"],
        bestFor: ["Nature", "Luxury", "Chocolate", "Banking"],
        bestTime: "Jun - Sep"
    },
    "Brussels": {
        emoji: "🧇",
        highlights: ["Grand Place", "Atomium", "Manneken Pis", "Chocolate Shops"],
        bestFor: ["Food", "Beer", "Art Nouveau", "EU Politics"],
        bestTime: "May - Sep"
    },
    "Nice": {
        emoji: "🏖️",
        highlights: ["Promenade des Anglais", "Old Town", "Castle Hill", "Matisse Museum"],
        bestFor: ["Beach", "French Riviera", "Art", "Food"],
        bestTime: "May - Oct"
    },
    "Edinburgh": {
        emoji: "🏰",
        highlights: ["Edinburgh Castle", "Royal Mile", "Arthur's Seat", "Holyrood Palace"],
        bestFor: ["History", "Festivals", "Whisky", "Architecture"],
        bestTime: "May - Sep"
    },
    "Seville": {
        emoji: "💃",
        highlights: ["Alcázar", "Plaza de España", "Flamenco Shows", "Giralda Tower"],
        bestFor: ["Flamenco", "Architecture", "Tapas", "History"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Monaco": {
        emoji: "🎰",
        highlights: ["Monte Carlo Casino", "Prince's Palace", "Oceanographic Museum", "Grand Prix Circuit"],
        bestFor: ["Luxury", "Gambling", "Yachts", "Fine Dining"],
        bestTime: "May - Sep"
    },
    // Scandinavia
    "Copenhagen": {
        emoji: "🧜‍♀️",
        highlights: ["Tivoli Gardens", "Nyhavn", "Little Mermaid", "Christiania"],
        bestFor: ["Design", "Food", "Cycling", "Hygge"],
        bestTime: "May - Sep"
    },
    "Stockholm": {
        emoji: "👑",
        highlights: ["Gamla Stan", "Vasa Museum", "ABBA Museum", "Archipelago"],
        bestFor: ["Design", "History", "Nature", "Fika"],
        bestTime: "May - Sep"
    },
    "Oslo": {
        emoji: "🏔️",
        highlights: ["Viking Ship Museum", "Opera House", "Vigeland Park", "Fjords"],
        bestFor: ["Nature", "Museums", "Hiking", "Vikings"],
        bestTime: "May - Sep"
    },
    "Helsinki": {
        emoji: "🧖",
        highlights: ["Suomenlinna", "Helsinki Cathedral", "Market Square", "Saunas"],
        bestFor: ["Design", "Sauna Culture", "Nature", "Architecture"],
        bestTime: "Jun - Aug"
    },
    "Reykjavik": {
        emoji: "🌋",
        highlights: ["Blue Lagoon", "Northern Lights", "Golden Circle", "Hallgrímskirkja"],
        bestFor: ["Nature", "Hot Springs", "Northern Lights", "Volcanos"],
        bestTime: "Jun - Aug (summer), Oct - Mar (Northern Lights)"
    },
    // Eastern Europe
    "Prague": {
        emoji: "🏰",
        highlights: ["Charles Bridge", "Prague Castle", "Old Town Square", "Astronomical Clock"],
        bestFor: ["Architecture", "Beer", "History", "Nightlife"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Budapest": {
        emoji: "♨️",
        highlights: ["Parliament", "Széchenyi Baths", "Buda Castle", "Ruin Bars"],
        bestFor: ["Thermal Baths", "Nightlife", "Architecture", "Food"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Kraków": {
        emoji: "🐉",
        highlights: ["Wawel Castle", "Main Market Square", "Kazimierz", "Wieliczka Salt Mine"],
        bestFor: ["History", "Food", "Nightlife", "Architecture"],
        bestTime: "May - Sep"
    },
    "Dubrovnik": {
        emoji: "🏰",
        highlights: ["City Walls", "Old Town", "Lokrum Island", "Fort Lovrijenac"],
        bestFor: ["History", "Beach", "Game of Thrones", "Seafood"],
        bestTime: "May - Jun, Sep - Oct"
    },
    "Tallinn": {
        emoji: "🏛️",
        highlights: ["Old Town", "Alexander Nevsky Cathedral", "Telliskivi", "Kadriorg Palace"],
        bestFor: ["Medieval History", "Digital Culture", "Nightlife", "Food"],
        bestTime: "May - Sep"
    },
    // Greece
    "Athens": {
        emoji: "🏛️",
        highlights: ["Acropolis", "Parthenon", "Plaka", "Temple of Olympian Zeus"],
        bestFor: ["History", "Archaeology", "Food", "Nightlife"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "Santorini": {
        emoji: "🌅",
        highlights: ["Oia Sunset", "Blue Domes", "Red Beach", "Akrotiri"],
        bestFor: ["Romance", "Sunsets", "Wine", "Photography"],
        bestTime: "Apr - Jun, Sep - Oct"
    },
    "Mykonos": {
        emoji: "🎉",
        highlights: ["Windmills", "Little Venice", "Paradise Beach", "Delos Island"],
        bestFor: ["Nightlife", "Beach", "Party", "LGBT-Friendly"],
        bestTime: "Jun - Sep"
    },
    "Crete": {
        emoji: "🏖️",
        highlights: ["Knossos Palace", "Samaria Gorge", "Elafonisi Beach", "Chania Old Town"],
        bestFor: ["History", "Beach", "Hiking", "Food"],
        bestTime: "May - Oct"
    },
    // Turkey & Middle East
    "Istanbul": {
        emoji: "🕌",
        highlights: ["Hagia Sophia", "Grand Bazaar", "Blue Mosque", "Bosphorus Cruise"],
        bestFor: ["History", "Shopping", "Food", "Culture"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "Cappadocia": {
        emoji: "🎈",
        highlights: ["Hot Air Balloons", "Fairy Chimneys", "Underground Cities", "Göreme"],
        bestFor: ["Adventure", "Photography", "Hiking", "Unique Landscapes"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "Dubai": {
        emoji: "🏙️",
        highlights: ["Burj Khalifa", "Dubai Mall", "Palm Jumeirah", "Desert Safari"],
        bestFor: ["Luxury", "Shopping", "Adventure", "Architecture"],
        bestTime: "Nov - Mar"
    },
    "Tel Aviv": {
        emoji: "🏖️",
        highlights: ["Beaches", "Carmel Market", "Jaffa Old City", "White City Bauhaus"],
        bestFor: ["Beach", "Nightlife", "Food", "Culture"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Petra": {
        emoji: "🏜️",
        highlights: ["The Treasury", "The Siq", "Monastery", "Royal Tombs"],
        bestFor: ["Archaeology", "Hiking", "Photography", "History"],
        bestTime: "Mar - May, Sep - Nov"
    },
    // Africa
    "Marrakech": {
        emoji: "🕌",
        highlights: ["Jemaa el-Fnaa", "Majorelle Garden", "Souks", "Bahia Palace"],
        bestFor: ["Shopping", "Culture", "Food", "Architecture"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Cairo": {
        emoji: "🏜️",
        highlights: ["Pyramids of Giza", "Sphinx", "Egyptian Museum", "Khan el-Khalili"],
        bestFor: ["History", "Archaeology", "Food", "Culture"],
        bestTime: "Oct - Apr"
    },
    "Cape Town": {
        emoji: "🏔️",
        highlights: ["Table Mountain", "Cape of Good Hope", "V&A Waterfront", "Robben Island"],
        bestFor: ["Nature", "Wine", "Adventure", "Wildlife"],
        bestTime: "Nov - Mar"
    },
    // East Asia
    "Tokyo": {
        emoji: "🏯",
        highlights: ["Shibuya Crossing", "Senso-ji Temple", "Mount Fuji", "Akihabara"],
        bestFor: ["Culture", "Food", "Technology", "Shopping"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Kyoto": {
        emoji: "⛩️",
        highlights: ["Fushimi Inari", "Arashiyama Bamboo", "Kinkaku-ji", "Geisha District"],
        bestFor: ["Temples", "Traditional Culture", "Cherry Blossoms", "Tea Ceremony"],
        bestTime: "Mar - May, Oct - Nov"
    },
    "Seoul": {
        emoji: "🎭",
        highlights: ["Gyeongbokgung Palace", "Myeongdong", "N Seoul Tower", "Bukchon Village"],
        bestFor: ["K-Pop", "Food", "Shopping", "Technology"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Hong Kong": {
        emoji: "🌃",
        highlights: ["Victoria Peak", "Star Ferry", "Temple Street", "Big Buddha"],
        bestFor: ["Food", "Skyline", "Shopping", "Culture"],
        bestTime: "Oct - Dec"
    },
    // Southeast Asia
    "Bangkok": {
        emoji: "🛕",
        highlights: ["Grand Palace", "Floating Markets", "Khao San Road", "Chatuchak Market"],
        bestFor: ["Food", "Temples", "Nightlife", "Shopping"],
        bestTime: "Nov - Feb"
    },
    "Bali": {
        emoji: "🌴",
        highlights: ["Ubud Rice Terraces", "Uluwatu Temple", "Seminyak Beach", "Mount Batur"],
        bestFor: ["Relaxation", "Spirituality", "Nature", "Surfing"],
        bestTime: "Apr - Oct"
    },
    "Singapore": {
        emoji: "🦁",
        highlights: ["Marina Bay Sands", "Gardens by the Bay", "Chinatown", "Sentosa Island"],
        bestFor: ["Food", "Shopping", "Architecture", "Family"],
        bestTime: "Feb - Apr"
    },
    "Hanoi": {
        emoji: "🏮",
        highlights: ["Old Quarter", "Hoan Kiem Lake", "Ho Chi Minh Mausoleum", "Street Food"],
        bestFor: ["Food", "Culture", "History", "Motorbike Tours"],
        bestTime: "Oct - Dec, Mar - Apr"
    },
    "Siem Reap": {
        emoji: "🛕",
        highlights: ["Angkor Wat", "Bayon Temple", "Ta Prohm", "Floating Villages"],
        bestFor: ["Archaeology", "Temples", "History", "Adventure"],
        bestTime: "Nov - Mar"
    },
    // South Asia
    "Jaipur": {
        emoji: "🏰",
        highlights: ["Hawa Mahal", "Amber Fort", "City Palace", "Jantar Mantar"],
        bestFor: ["Architecture", "History", "Shopping", "Photography"],
        bestTime: "Oct - Mar"
    },
    "Maldives": {
        emoji: "🏝️",
        highlights: ["Overwater Bungalows", "Snorkeling", "Coral Reefs", "Whale Sharks"],
        bestFor: ["Beach", "Diving", "Luxury", "Romance"],
        bestTime: "Nov - Apr"
    },
    // Oceania
    "Sydney": {
        emoji: "🌉",
        highlights: ["Sydney Opera House", "Harbour Bridge", "Bondi Beach", "Taronga Zoo"],
        bestFor: ["Beach", "Wildlife", "Adventure", "Food"],
        bestTime: "Sep - Nov, Mar - May"
    },
    "Melbourne": {
        emoji: "☕",
        highlights: ["Laneways", "Great Ocean Road", "Federation Square", "Coffee Culture"],
        bestFor: ["Coffee", "Art", "Food", "Sports"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Queenstown": {
        emoji: "🏔️",
        highlights: ["Bungee Jumping", "Milford Sound", "Ski Fields", "Lake Wakatipu"],
        bestFor: ["Adventure", "Nature", "Skiing", "Lord of the Rings"],
        bestTime: "Dec - Feb (summer), Jun - Aug (ski)"
    },
    // North America
    "New York": {
        emoji: "🗽",
        highlights: ["Times Square", "Central Park", "Statue of Liberty", "Broadway"],
        bestFor: ["Entertainment", "Shopping", "Food", "Art"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "San Francisco": {
        emoji: "🌉",
        highlights: ["Golden Gate Bridge", "Alcatraz", "Fisherman's Wharf", "Cable Cars"],
        bestFor: ["Tech", "Food", "Views", "Culture"],
        bestTime: "Sep - Nov"
    },
    "Las Vegas": {
        emoji: "🎰",
        highlights: ["The Strip", "Grand Canyon", "Shows", "Casinos"],
        bestFor: ["Entertainment", "Nightlife", "Shows", "Desert"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Miami": {
        emoji: "🌴",
        highlights: ["South Beach", "Art Deco District", "Little Havana", "Everglades"],
        bestFor: ["Beach", "Nightlife", "Latin Culture", "Art"],
        bestTime: "Dec - May"
    },
    "Honolulu": {
        emoji: "🏄",
        highlights: ["Waikiki Beach", "Diamond Head", "Pearl Harbor", "North Shore"],
        bestFor: ["Beach", "Surfing", "Nature", "Relaxation"],
        bestTime: "Apr - Jun, Sep - Nov"
    },
    "New Orleans": {
        emoji: "🎺",
        highlights: ["French Quarter", "Bourbon Street", "Jazz Clubs", "Beignets"],
        bestFor: ["Music", "Food", "Nightlife", "Culture"],
        bestTime: "Feb - May"
    },
    // Caribbean & Latin America
    "Cancun": {
        emoji: "🏖️",
        highlights: ["Chichén Itzá", "Isla Mujeres", "Cenotes", "Hotel Zone"],
        bestFor: ["Beach", "History", "Diving", "Party"],
        bestTime: "Dec - Apr"
    },
    "Havana": {
        emoji: "🚗",
        highlights: ["Old Havana", "Malecón", "Classic Cars", "Revolution Square"],
        bestFor: ["History", "Music", "Culture", "Architecture"],
        bestTime: "Nov - Apr"
    },
    "Rio de Janeiro": {
        emoji: "🗻",
        highlights: ["Christ the Redeemer", "Copacabana", "Sugarloaf Mountain", "Carnival"],
        bestFor: ["Beach", "Carnival", "Nature", "Nightlife"],
        bestTime: "Dec - Mar"
    },
    "Buenos Aires": {
        emoji: "💃",
        highlights: ["La Boca", "Recoleta Cemetery", "Tango Shows", "San Telmo Market"],
        bestFor: ["Tango", "Steak", "Wine", "Culture"],
        bestTime: "Mar - May, Sep - Nov"
    },
    "Cusco": {
        emoji: "🦙",
        highlights: ["Machu Picchu", "Sacred Valley", "Plaza de Armas", "Sacsayhuamán"],
        bestFor: ["History", "Hiking", "Culture", "Adventure"],
        bestTime: "May - Sep"
    },
    "Medellín": {
        emoji: "🌺",
        highlights: ["Communa 13", "Botero Plaza", "Cable Cars", "Guatapé"],
        bestFor: ["Culture", "Nightlife", "Innovation", "Nature"],
        bestTime: "Dec - Mar, Jun - Sep"
    },
    "Cartagena": {
        emoji: "🏰",
        highlights: ["Old Walled City", "Rosario Islands", "San Felipe Castle", "Getsemaní"],
        bestFor: ["History", "Beach", "Architecture", "Food"],
        bestTime: "Dec - Apr"
    },
};

const DEFAULT_HIGHLIGHTS = {
    emoji: "✈️",
    highlights: ["Local attractions", "Cultural sites", "Local cuisine", "Hidden gems"],
    bestFor: ["Adventure", "Culture", "Relaxation"],
    bestTime: "Check local weather"
};

type CurrentWeather = {
    location: string;
    temperature: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    description: string;
    weatherCode: number;
    isDay: boolean;
    todayMax: number;
    todayMin: number;
};

// Map a WMO weather code to an Ionicons glyph (see open-meteo.com/en/docs).
function weatherIconFor(code: number, isDay: boolean): keyof typeof Ionicons.glyphMap {
    if (code === 0) return isDay ? "sunny" : "moon";
    if (code === 1 || code === 2) return isDay ? "partly-sunny" : "cloudy-night";
    if (code === 3 || code === 45 || code === 48) return "cloud";
    if (code >= 51 && code <= 67) return "rainy";
    if (code >= 71 && code <= 77) return "snow";
    if (code >= 80 && code <= 82) return "rainy";
    if (code === 85 || code === 86) return "snow";
    if (code >= 95) return "thunderstorm";
    return "partly-sunny";
}

// Map a WMO weather code to an i18n condition key (localized on the client so
// the label matches the app language instead of the API's English string).
function weatherConditionKey(code: number): string {
    if (code === 0) return "weatherClear";
    if (code === 1) return "weatherMainlyClear";
    if (code === 2) return "weatherPartlyCloudy";
    if (code === 3) return "weatherOvercast";
    if (code === 45 || code === 48) return "weatherFog";
    if (code >= 51 && code <= 57) return "weatherDrizzle";
    if (code >= 61 && code <= 67) return "weatherRain";
    if (code >= 71 && code <= 77) return "weatherSnow";
    if (code >= 80 && code <= 82) return "weatherRainShowers";
    if (code === 85 || code === 86) return "weatherSnow";
    if (code >= 95) return "weatherThunderstorm";
    return "";
}

// Sky-gradient palette for the weather card — warmer/brighter by day, deep
// indigo at night. Purely cosmetic, gives the card a premium "weather app" feel.
function weatherGradient(isDay: boolean): [string, string] {
    return isDay ? ["#3B82F6", "#6366F1"] : ["#1E293B", "#4338CA"];
}

export default function DestinationPreviewScreen() {
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const { token } = useToken();
    const { destination } = useLocalSearchParams<{ destination: string }>();
    const { image, loading } = useDestinationImage(destination);
    const trackDownload = useAction(api.images.trackUnsplashDownload);

    // Current weather for the destination (Open-Meteo via Convex action).
    const getCurrentWeather = useAction(api.atlas.getCurrentWeather);
    const [weather, setWeather] = useState<CurrentWeather | null>(null);
    const [weatherLoading, setWeatherLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        if (!destination) {
            setWeatherLoading(false);
            return;
        }
        setWeatherLoading(true);
        getCurrentWeather({ destination })
            .then((result) => {
                if (!cancelled) setWeather(result);
            })
            .catch((error) => {
                console.error("Failed to load weather:", error);
                if (!cancelled) setWeather(null);
            })
            .finally(() => {
                if (!cancelled) setWeatherLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [destination]);

    // Curated destination facts (avg daily spend + typical stay length).
    const facts = useQuery(
        api.trips.getDestinationFacts as any,
        destination ? { destination } : "skip",
    );

    // Real, AI-generated top sights for this destination (cached backend-side).
    const sightsData = useQuery(
        api.sights.getDestinationSights as any,
        destination ? { destination, language: i18n.language } : "skip",
    );
    const generateDestinationSights = useAction(api.sightsAction.generateDestinationSights);
    const sightsRequestedRef = useRef<Set<string>>(new Set());

    // When nothing is cached yet, kick off generation once per destination.
    useEffect(() => {
        if (!destination || !token) return;
        if (sightsData === null && !sightsRequestedRef.current.has(destination)) {
            sightsRequestedRef.current.add(destination);
            generateDestinationSights({ token, destination, language: i18n.language }).catch((error) => {
                console.error("Failed to generate sights:", error);
                sightsRequestedRef.current.delete(destination); // allow a retry later
            });
        }
    }, [destination, sightsData, token, i18n.language]);

    // Watch destination state
    const isWatching = useQuery(api.watchedDestinations.isWatching as any,
        token ? { token, destination: destination || "" } : "skip"
    );
    const watchMutation = useAuthenticatedMutation(api.watchedDestinations.watch as any);
    const unwatchMutation = useAuthenticatedMutation(api.watchedDestinations.unwatch as any);

    const handleToggleWatch = async () => {
        if (!destination) return;
        if (isWatching) {
            await unwatchMutation({ destination });
        } else {
            await watchMutation({ destination });
        }
    };
    
    const avgBudget = parseFloat((useLocalSearchParams() as any).avgBudget) || 0;
    const tripCount = parseInt((useLocalSearchParams() as any).count) || 0;

    const destinationKey = Object.keys(DESTINATION_HIGHLIGHTS).find(
        key => destination.toLowerCase().includes(key.toLowerCase())
    );
    const destinationData = destinationKey 
        ? DESTINATION_HIGHLIGHTS[destinationKey] 
        : DEFAULT_HIGHLIGHTS;

    // City portion of the destination (e.g. "Paris, France" -> "Paris").
    const destinationCity = (destination || "").split(",")[0].trim();

    // Highlights: prefer real AI-generated sight names; for curated cities fall
    // back to the built-in list; otherwise show a loading state — never the
    // generic "Local attractions" placeholders.
    const realHighlights: string[] | null = sightsData?.sights?.length
        ? sightsData.sights.slice(0, 6).map((s: any) => s.name)
        : null;
    const isCuratedDestination = destinationKey != null;
    const highlightsToShow: string[] | null =
        realHighlights ?? (isCuratedDestination ? destinationData.highlights : null);

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

    // Open the flight search prefilled with this destination as the arrival.
    const handleSearchFlights = () => {
        if (!destination) return;
        const arrivalId = resolveIATA(destination); // "" when no airport resolves
        router.push({
            pathname: "/flights/search",
            params: {
                arrivalCityName: destinationCity || destination,
                ...(arrivalId ? { arrivalId } : {}),
            },
        });
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={styles.safeContainer} edges={["top"]}>
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
                            photoUrl={image.attribution}
                            position="top"
                        />
                    </View>
                ) : (
                    <View style={[styles.heroBackground, { backgroundColor: "#1A1A2E" }]}>
                        <Text style={styles.heroEmoji}>{destinationData.emoji}</Text>
                    </View>
                )}
                <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={styles.heroGradient} pointerEvents="none" />
                
                <SafeAreaView style={styles.headerOverlay} pointerEvents="box-none">
                    <View style={styles.headerRow}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                        </TouchableOpacity>
                        {token && (
                            <TouchableOpacity style={styles.watchButton} onPress={handleToggleWatch}>
                                <Ionicons 
                                    name={isWatching ? "notifications" : "notifications-outline"} 
                                    size={22} 
                                    color={isWatching ? colors.primary : "#FFFFFF"} 
                                />
                            </TouchableOpacity>
                        )}
                    </View>
                </SafeAreaView>

                <View style={styles.heroContent}>
                    <View style={[styles.heroBadge, { backgroundColor: colors.primary }]}>
                        <Ionicons name="trending-up" size={13} color="#000000" />
                        <Text style={styles.heroBadgeText}>{t('home.popularDestination')}</Text>
                    </View>
                    <Text style={styles.heroTitle}>{destination}</Text>
                    <View style={styles.heroStats}>
                        <View style={styles.statItem}>
                            <Ionicons name="people" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>{tripCount}</Text>
                            <Text style={styles.statLabel}>{t('destinationPreview.tripsLabel')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        {facts?.avgTripSpend != null ? (
                            <View style={styles.statItem}>
                                <Ionicons name="wallet" size={16} color={colors.primary} />
                                <Text style={styles.statValue}>€{Math.round(facts.avgTripSpend)}</Text>
                                <Text style={styles.statLabel}>{t('home.perTripShort')}</Text>
                            </View>
                        ) : (
                            <View style={styles.statItem}>
                                <Ionicons name="wallet" size={16} color={colors.primary} />
                                <Text style={styles.statValue}>€{Math.round(avgBudget)}</Text>
                                <Text style={styles.statLabel}>{t('destinationPreview.avgBudget')}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </View>
            </SafeAreaView>

            <ScrollView style={styles.contentSection} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
                {weatherLoading && (
                    <View style={[styles.weatherLoadingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={[styles.infoCardText, { color: colors.textSecondary, marginLeft: 10 }]}>
                            {t('destinationPreview.loadingWeather')}
                        </Text>
                    </View>
                )}
                {!weatherLoading && weather && (
                    <LinearGradient
                        colors={weatherGradient(weather.isDay)}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.weatherCard}
                    >
                        <View style={styles.weatherHeaderRow}>
                            <Ionicons name="partly-sunny" size={15} color="rgba(255,255,255,0.9)" />
                            <Text style={styles.weatherHeaderText}>{t('destinationPreview.currentWeather')}</Text>
                        </View>
                        <View style={styles.weatherMainRow}>
                            <View style={styles.weatherTempBlock}>
                                <Text style={styles.weatherTemp}>{weather.temperature}°</Text>
                                <Text style={styles.weatherDescription}>
                                    {weatherConditionKey(weather.weatherCode)
                                        ? t(`destinationPreview.${weatherConditionKey(weather.weatherCode)}`)
                                        : weather.description}
                                </Text>
                            </View>
                            <Ionicons
                                name={weatherIconFor(weather.weatherCode, weather.isDay)}
                                size={68}
                                color="#FFFFFF"
                            />
                        </View>
                        <View style={styles.weatherPillRow}>
                            <View style={styles.weatherPill}>
                                <Ionicons name="thermometer-outline" size={14} color="#FFFFFF" />
                                <Text style={styles.weatherPillText}>{t('destinationPreview.feelsLike')} {weather.feelsLike}°</Text>
                            </View>
                            <View style={styles.weatherPill}>
                                <Ionicons name="swap-vertical-outline" size={14} color="#FFFFFF" />
                                <Text style={styles.weatherPillText}>{weather.todayMax}° / {weather.todayMin}°</Text>
                            </View>
                            <View style={styles.weatherPill}>
                                <Ionicons name="water-outline" size={14} color="#FFFFFF" />
                                <Text style={styles.weatherPillText}>{weather.humidity}%</Text>
                            </View>
                            <View style={styles.weatherPill}>
                                <Ionicons name="speedometer-outline" size={14} color="#FFFFFF" />
                                <Text style={styles.weatherPillText}>{weather.windSpeed} km/h</Text>
                            </View>
                        </View>
                    </LinearGradient>
                )}

                <View style={styles.snapshotRow}>
                    <View style={[styles.snapshotCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={[styles.snapshotIcon, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6" }]}>
                            <Ionicons name="calendar" size={18} color={colors.primary} />
                        </View>
                        <Text style={[styles.snapshotLabel, { color: colors.textMuted }]}>{t('destinationPreview.bestTimeToVisit')}</Text>
                        <Text style={[styles.snapshotValue, { color: colors.text }]}>{destinationData.bestTime}</Text>
                    </View>
                    {facts?.avgStayDays != null && (
                        <View style={[styles.snapshotCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={[styles.snapshotIcon, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6" }]}>
                                <Ionicons name="time" size={18} color={colors.primary} />
                            </View>
                            <Text style={[styles.snapshotLabel, { color: colors.textMuted }]}>{t('destinationPreview.averageStay')}</Text>
                            <Text style={[styles.snapshotValue, { color: colors.text }]}>
                                ~{facts.avgStayDays} {t('destinationPreview.daysUnit')}
                            </Text>
                        </View>
                    )}
                </View>

                <TouchableOpacity
                    style={[styles.flightSearchButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={handleSearchFlights}
                    activeOpacity={0.85}
                >
                    <View style={[styles.flightSearchIcon, { backgroundColor: colors.primary }]}>
                        <Ionicons name="airplane" size={20} color={colors.text} />
                    </View>
                    <View style={styles.flightSearchTextBlock}>
                        <Text style={[styles.flightSearchTitle, { color: colors.text }]}>{t('destinationPreview.searchFlights')}</Text>
                        <Text style={[styles.flightSearchSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                            {t('destinationPreview.flightsSubtitle', { destination: destinationCity || destination })}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </TouchableOpacity>

                <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                        <View style={[styles.sectionIconTile, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6" }]}>
                            <Ionicons name="star" size={16} color={colors.primary} />
                        </View>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('destinationPreview.topHighlights')}</Text>
                    </View>
                    {highlightsToShow ? (
                        <View style={styles.highlightsGrid}>
                            {highlightsToShow.map((highlight, index) => (
                                <View key={index} style={[styles.highlightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <View style={[styles.highlightNum, { backgroundColor: colors.primary }]}>
                                        <Text style={styles.highlightNumText}>{index + 1}</Text>
                                    </View>
                                    <Text style={[styles.highlightCardText, { color: colors.text }]} numberOfLines={2}>{highlight}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <View style={[styles.highlightsLoading, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[styles.infoCardText, { color: colors.textSecondary, marginLeft: 10 }]}>
                                {t('destinationPreview.loadingHighlights')}
                            </Text>
                        </View>
                    )}
                </View>

                <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                        <View style={[styles.sectionIconTile, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6" }]}>
                            <Ionicons name="heart" size={16} color={colors.primary} />
                        </View>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('destinationPreview.perfectFor')}</Text>
                    </View>
                    <View style={styles.tagsContainer}>
                        {destinationData.bestFor.map((tag, index) => (
                            <View key={index} style={[styles.tagPill, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6", borderColor: colors.primary }]}>
                                <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                                <Text style={[styles.tagPillText, { color: colors.text }]}>{tag}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <View style={[styles.socialCard, { backgroundColor: isDarkMode ? colors.secondary : "#FFF9E6", borderColor: colors.primary }]}>
                    <View style={styles.socialHeader}>
                        <View style={styles.avatarCluster}>
                            {[0, 1, 2].map((i) => (
                                <View
                                    key={i}
                                    style={[
                                        styles.avatar,
                                        {
                                            backgroundColor: colors.primary,
                                            borderColor: isDarkMode ? colors.secondary : "#FFF9E6",
                                            marginLeft: i === 0 ? 0 : -10,
                                        },
                                    ]}
                                >
                                    <Ionicons name="person" size={13} color="#000000" />
                                </View>
                            ))}
                        </View>
                        <Text style={[styles.socialTitle, { color: colors.text }]}>{t('destinationPreview.fromOurTravelers')}</Text>
                    </View>
                    <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                        {tripCount > 0
                            ? t('destinationPreview.travelersExplored', { count: tripCount, destination, budget: Math.round(avgBudget) })
                            : t('destinationPreview.beFirstToExplore', { destination })
                        }
                    </Text>
                </View>

                <View style={{ height: 170 }} />
            </ScrollView>

            <SafeAreaView edges={["bottom"]} style={[styles.ctaContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <View style={styles.ctaInner}>
                    <View style={styles.ctaTopRow}>
                        <View style={styles.ctaPricing}>
                            <View style={styles.ctaPriceRow}>
                                <Text style={[styles.ctaLabel, { color: colors.textMuted }]}>{t('destinationPreview.from')}</Text>
                                <Text style={[styles.ctaPrice, { color: colors.text }]}>
                                    €{facts?.avgTripSpend != null
                                        ? Math.round(facts.avgTripSpend)
                                        : Math.round(avgBudget * 0.7)}
                                </Text>
                                <Text style={[styles.ctaPerPerson, { color: colors.textMuted }]}>{t('destinationPreview.perPerson')}</Text>
                            </View>
                            <Text style={[styles.ctaSubNote, { color: colors.textMuted }]}>{t('destinationPreview.estimatedCost')}</Text>
                        </View>
                        <View style={styles.ctaNoteRow}>
                            <Ionicons name="sparkles" size={12} color={colors.primary} />
                            <Text style={[styles.ctaNote, { color: colors.textMuted }]} numberOfLines={2}>{t('destinationPreview.planNote')}</Text>
                        </View>
                    </View>
                    <TouchableOpacity style={[styles.ctaButtonFull, { backgroundColor: colors.primary }]} onPress={handleCreateTrip} activeOpacity={0.9}>
                        <Text style={[styles.ctaButtonText, { color: colors.text }]}>{t('destinationPreview.planMyTrip')}</Text>
                        <Ionicons name="arrow-forward" size={20} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeContainer: { flex: 1 },
    heroSection: { height: 320, position: "relative" },
    heroImageWrapper: { flex: 1, overflow: "hidden" },
    heroImageContainer: { flex: 1, width: "100%", height: "100%" },
    heroBackground: { flex: 1, justifyContent: "center", alignItems: "center" },
    heroImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    heroEmoji: { fontSize: 100, opacity: 0.3 },
    heroGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 200 },
    headerOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
    backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
    watchButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
    heroContent: { position: "absolute", bottom: 24, left: 20, right: 20 },
    heroBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, marginBottom: 12 },
    heroBadgeText: { color: "#000000", fontSize: 12, fontWeight: "700" },
    heroTitle: { fontSize: 36, fontWeight: "800", color: "#FFFFFF", marginBottom: 16 },
    heroStats: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 16, padding: 16 },
    statItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    statValue: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
    statLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" },
    statDivider: { width: 1, height: 24, backgroundColor: "rgba(255,255,255,0.2)" },
    contentSection: { flex: 1 },
    contentContainer: { padding: 20 },
    infoCard: { borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1 },
    // Weather card (premium gradient)
    weatherCard: { borderRadius: 20, padding: 18, marginBottom: 16, overflow: "hidden" },
    weatherLoadingCard: { flexDirection: "row", alignItems: "center", borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1 },
    weatherHeaderRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
    weatherHeaderText: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.9)", letterSpacing: 0.3, textTransform: "uppercase" },
    weatherMainRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    weatherTempBlock: { flex: 1 },
    weatherTemp: { fontSize: 52, fontWeight: "800", color: "#FFFFFF", lineHeight: 58 },
    weatherDescription: { fontSize: 15, fontWeight: "500", color: "rgba(255,255,255,0.9)", marginTop: 2 },
    weatherPillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    weatherPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
    weatherPillText: { fontSize: 12.5, fontWeight: "600", color: "#FFFFFF" },
    // Trip snapshot (2-column)
    snapshotRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
    snapshotCard: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1 },
    snapshotIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center", marginBottom: 10 },
    snapshotLabel: { fontSize: 12, fontWeight: "500", marginBottom: 4 },
    snapshotValue: { fontSize: 15, fontWeight: "700" },
    // Flight search button
    flightSearchButton: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, padding: 14, marginBottom: 24, borderWidth: 1 },
    flightSearchIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
    flightSearchTextBlock: { flex: 1 },
    flightSearchTitle: { fontSize: 16, fontWeight: "700" },
    flightSearchSubtitle: { fontSize: 13, marginTop: 2 },
    infoCardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    infoCardTitle: { fontSize: 16, fontWeight: "700" },
    infoCardText: { fontSize: 15, marginLeft: 30 },
    section: { marginBottom: 24 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
    sectionIconTile: { width: 30, height: 30, borderRadius: 9, justifyContent: "center", alignItems: "center" },
    sectionTitle: { fontSize: 18, fontWeight: "700" },
    // Highlights — numbered 2-column cards
    highlightsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    highlightsLoading: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1 },
    highlightCard: { flexDirection: "row", alignItems: "center", gap: 10, flexBasis: "47%", flexGrow: 1, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
    highlightNum: { width: 26, height: 26, borderRadius: 13, justifyContent: "center", alignItems: "center" },
    highlightNumText: { fontSize: 13, fontWeight: "800", color: "#000000" },
    highlightCardText: { flex: 1, fontSize: 14, fontWeight: "600" },
    // Perfect for — soft tinted pills
    tagsContainer: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tagPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
    tagPillText: { fontSize: 14, fontWeight: "600" },
    // Social proof card
    socialCard: { borderRadius: 16, padding: 20, borderWidth: 1 },
    socialHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    avatarCluster: { flexDirection: "row", alignItems: "center" },
    avatar: { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center", borderWidth: 2 },
    socialTitle: { fontSize: 16, fontWeight: "700" },
    insightText: { fontSize: 14, lineHeight: 22 },
    ctaContainer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        borderTopWidth: 1,
        // Lift the bar above scrolling content so it reads as a floating footer
        // instead of text bleeding into the cards behind it.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 16,
    },
    ctaInner: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
    ctaTopRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 12 },
    ctaPricing: { flexShrink: 0 },
    ctaPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
    ctaLabel: { fontSize: 14 },
    ctaPrice: { fontSize: 24, fontWeight: "800" },
    ctaPerPerson: { fontSize: 14 },
    ctaSubNote: { fontSize: 11, marginTop: 2 },
    ctaNoteRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, flexShrink: 1, paddingBottom: 3 },
    ctaNote: { fontSize: 12, fontWeight: "500", flexShrink: 1, textAlign: "right" },
    ctaButtonFull: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 16, gap: 8 },
    ctaButtonText: { fontSize: 17, fontWeight: "700" },
});
