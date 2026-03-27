import { useLocalSearchParams, useRouter } from "expo-router";
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

export default function DestinationPreviewScreen() {
    const router = useRouter();
    const { colors, isDarkMode } = useTheme();
    const { t } = useTranslation();
    const { token } = useToken();
    const { destination } = useLocalSearchParams<{ destination: string }>();
    const { image, loading } = useDestinationImage(destination);
    const trackDownload = useAction(api.images.trackUnsplashDownload);

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
                    <Text style={styles.heroTitle}>{destination}</Text>
                    <View style={styles.heroStats}>
                        <View style={styles.statItem}>
                            <Ionicons name="star" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>{avgRating.toFixed(1)}</Text>
                            <Text style={styles.statLabel}>{t('destinationPreview.rating')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Ionicons name="people" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>{tripCount}</Text>
                            <Text style={styles.statLabel}>{t('destinationPreview.tripsLabel')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Ionicons name="wallet" size={16} color={colors.primary} />
                            <Text style={styles.statValue}>€{Math.round(avgBudget)}</Text>
                            <Text style={styles.statLabel}>{t('destinationPreview.avgBudget')}</Text>
                        </View>
                    </View>
                </View>
            </View>
            </SafeAreaView>

            <ScrollView style={styles.contentSection} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
                <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.infoCardHeader}>
                        <Ionicons name="calendar" size={20} color={colors.primary} />
                        <Text style={[styles.infoCardTitle, { color: colors.text }]}>{t('destinationPreview.bestTimeToVisit')}</Text>
                    </View>
                    <Text style={[styles.infoCardText, { color: colors.textSecondary }]}>{destinationData.bestTime}</Text>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('destinationPreview.topHighlights')}</Text>
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
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('destinationPreview.perfectFor')}</Text>
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
                        <Text style={[styles.insightTitle, { color: colors.text }]}>{t('destinationPreview.fromOurTravelers')}</Text>
                    </View>
                    <Text style={[styles.insightText, { color: colors.textSecondary }]}>
                        {tripCount > 0 
                            ? t('destinationPreview.travelersExplored', { count: tripCount, destination, budget: Math.round(avgBudget), rating: avgRating.toFixed(1) })
                            : t('destinationPreview.beFirstToExplore', { destination })
                        }
                    </Text>
                </View>

                <View style={{ height: 120 }} />
            </ScrollView>

            <SafeAreaView edges={["bottom"]} style={[styles.ctaContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <View style={styles.ctaContent}>
                    <View style={styles.ctaPricing}>
                        <Text style={[styles.ctaLabel, { color: colors.textMuted }]}>{t('destinationPreview.from')}</Text>
                        <Text style={[styles.ctaPrice, { color: colors.text }]}>€{Math.round(avgBudget * 0.7)}</Text>
                        <Text style={[styles.ctaPerPerson, { color: colors.textMuted }]}>{t('destinationPreview.perPerson')}</Text>
                    </View>
                    <TouchableOpacity style={[styles.ctaButton, { backgroundColor: colors.primary }]} onPress={handleCreateTrip}>
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
