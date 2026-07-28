import React, { useState, useRef, useEffect } from "react";
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StatusBar,
    Keyboard,
    ScrollView,
    Animated,
    Alert,
    Modal,
} from "react-native";
import { useToken, useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import AIConsentModal from "@/components/AIConsentModal";
import { AtlasCardRenderer, type AtlasCardData } from "@/components/AtlasCards";
import { useTranslation } from "react-i18next";

// Animated typing dots component
const TypingIndicator = ({ colors }: { colors: any }) => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const animateDot = (dot: Animated.Value, delay: number) => {
            Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(dot, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: true,
                    }),
                    Animated.timing(dot, {
                        toValue: 0,
                        duration: 300,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        };

        animateDot(dot1, 0);
        animateDot(dot2, 150);
        animateDot(dot3, 300);
    }, []);

    const dotStyle = (anim: Animated.Value) => ({
        transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    });

    return (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotStyle(dot1)]} />
            <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotStyle(dot2)]} />
            <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotStyle(dot3)]} />
        </View>
    );
};

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    /**
     * Structured tool output emitted by the server. Rendered above the prose so
     * the answer leads with the data rather than describing it.
     */
    cards?: AtlasCardData[];
    /** Follow-up questions offered as tappable chips under the last reply. */
    suggestions?: string[];
}

// Helper to detect weather JSON block
const extractWeatherJson = (content: string): { weatherData: any; cleanContent: string } => {
    const jsonMatch = content.match(/<WEATHER_JSON>([\s\S]*?)<\/WEATHER_JSON>/);
    if (jsonMatch && jsonMatch[1]) {
        try {
            const weatherData = JSON.parse(jsonMatch[1]);
            const cleanContent = content.replace(/<WEATHER_JSON>[\s\S]*?<\/WEATHER_JSON>/, '').trim();
            return { weatherData, cleanContent };
        } catch (e) {
            console.error("Failed to parse weather JSON:", e);
        }
    }
    return { weatherData: null, cleanContent: content };
};

// Helper to detect restaurant JSON block
const extractRestaurantJson = (content: string): { restaurantData: any[] | null; cleanContent: string } => {
    const jsonMatch = content.match(/<RESTAURANT_JSON>([\s\S]*?)<\/RESTAURANT_JSON>/);
    if (jsonMatch && jsonMatch[1]) {
        try {
            const restaurantData = JSON.parse(jsonMatch[1]);
            const cleanContent = content.replace(/<RESTAURANT_JSON>[\s\S]*?<\/RESTAURANT_JSON>/, '').trim();
            return { restaurantData: Array.isArray(restaurantData) ? restaurantData : null, cleanContent };
        } catch (e) {
            console.error("Failed to parse restaurant JSON:", e);
        }
    }
    return { restaurantData: null, cleanContent: content };
};

// Weather Card Component
const WeatherCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    
    // Choose gradient based on condition/time
    const getTheme = (cond: string, day: boolean) => {
        const condition = (cond || "").toLowerCase();
        let colors = ['#4FACFE', '#00F2FE']; // Default day
        let icon: keyof typeof Ionicons.glyphMap = "sunny";
        
        if (!day) {
            colors = ['#141E30', '#243B55']; // Night
            icon = "moon";
        }
        
        if (condition.includes('rain') || condition.includes('drizzle') || condition.includes('shower')) {
            colors = ['#373B44', '#4286f4']; // Rain
            icon = "rainy";
        } else if (condition.includes('cloud') || condition.includes('overcast') || condition.includes('fog')) {
            colors = ['#BDC3C7', '#2C3E50']; // Cloudy
            icon = "cloudy";
        } else if (condition.includes('snow') || condition.includes('ice')) {
            colors = ['#E6DADA', '#274046']; // Snow
            icon = "snow";
        } else if (condition.includes('thunder') || condition.includes('storm')) {
            colors = ['#141E30', '#434343']; // Storm
            icon = "thunderstorm";
        } else if (condition.includes('clear') || condition.includes('sunny')) {
            if (!day) icon = "moon";
            else icon = "sunny";
        }

        return { gradientColors: colors, iconName: icon };
    };

    const isDay = data.isDay ?? true;
    const { gradientColors, iconName } = getTheme(data.condition, isDay);

    return (
        <LinearGradient
            colors={gradientColors as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={formatStyles.weatherGradientCard}
        >
            <View style={formatStyles.weatherMain}>
                <View>
                    <Text style={formatStyles.weatherLocation}>{data.location}</Text>
                    <Text style={formatStyles.weatherCondition}>{data.condition}</Text>
                </View>
                <Ionicons name={iconName} size={40} color="#FFF" />
            </View>
            
            <View style={formatStyles.weatherTempContainer}>
                <Text style={formatStyles.weatherBigTemp}>{data.temperature}°</Text>
            </View>

            <View style={formatStyles.weatherStats}>
                <View style={formatStyles.weatherStatItem}>
                    <Ionicons name="water-outline" size={16} color="#FFF" style={{opacity: 0.8}} />
                    <Text style={formatStyles.weatherStatText}>{data.humidity}% {t('atlas.humidity')}</Text>
                </View>
                <View style={formatStyles.weatherStatItem}>
                    <Ionicons name="speedometer-outline" size={16} color="#FFF" style={{opacity: 0.8}} />
                    <Text style={formatStyles.weatherStatText}>{data.windSpeed} km/h {t('atlas.wind')}</Text>
                </View>
            </View>

            {/* Forecast Section */}
            {data.forecast && Array.isArray(data.forecast) && data.forecast.length > 0 && (
                <View style={formatStyles.forecastContainer}>
                    <View style={formatStyles.forecastDivider} />
                    <View style={formatStyles.forecastRow}>
                        {data.forecast.slice(0, 5).map((day: any, i: number) => {
                             const { iconName: dayIcon } = getTheme(day.condition, true);
                             return (
                                <View key={i} style={formatStyles.forecastItem}>
                                    <Text style={formatStyles.forecastDay}>{day.day}</Text>
                                    <Ionicons name={dayIcon} size={20} color="#FFF" style={{marginVertical: 4}} />
                                    <View>
                                        <Text style={formatStyles.forecastHigh}>{day.high}°</Text>
                                        <Text style={formatStyles.forecastLow}>{day.low}°</Text>
                                    </View>
                                </View>
                             );
                        })}
                    </View>
                </View>
            )}
        </LinearGradient>
    );
};

// Restaurant Card Component
const RestaurantCard = ({ restaurants, colors, isDarkMode }: { restaurants: any[]; colors: any; isDarkMode: boolean }) => {
    const { t } = useTranslation();
    const getRatingStars = (rating: number) => {
        const full = Math.floor(rating);
        const half = rating % 1 >= 0.3;
        const stars: React.ReactNode[] = [];
        for (let i = 0; i < full; i++) {
            stars.push(<Ionicons key={`f${i}`} name="star" size={12} color="#FF8C00" />);
        }
        if (half) {
            stars.push(<Ionicons key="h" name="star-half" size={12} color="#FF8C00" />);
        }
        return stars;
    };

    return (
        <View style={restaurantStyles.container}>
            <View style={restaurantStyles.header}>
                <Ionicons name="restaurant" size={20} color={colors.primary} />
                <Text style={[restaurantStyles.headerText, { color: colors.text }]}>
                    {t('atlas.topRestaurants')}
                </Text>
                <View style={[restaurantStyles.badge, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.2)' : '#FFF3CD' }]}>
                    <Text style={[restaurantStyles.badgeText, { color: colors.primary }]}>TripAdvisor</Text>
                </View>
            </View>
            {restaurants.map((r: any, i: number) => (
                <View
                    key={i}
                    style={[
                        restaurantStyles.card,
                        { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#F8F9FA', borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : '#E9ECEF' },
                    ]}
                >
                    <View style={restaurantStyles.cardTop}>
                        <View style={{ flex: 1 }}>
                            <Text style={[restaurantStyles.name, { color: colors.text }]} numberOfLines={1}>
                                {r.name}
                            </Text>
                            <Text style={[restaurantStyles.cuisine, { color: colors.textMuted }]} numberOfLines={1}>
                                {r.cuisine}
                            </Text>
                        </View>
                        <View style={[restaurantStyles.priceBadge, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.15)' : '#FFF8E1' }]}>
                            <Text style={[restaurantStyles.priceText, { color: colors.primary }]}>{r.priceRange}</Text>
                        </View>
                    </View>
                    <View style={restaurantStyles.cardBottom}>
                        <View style={restaurantStyles.ratingRow}>
                            <View style={{ flexDirection: 'row', gap: 1 }}>{getRatingStars(r.rating)}</View>
                            <Text style={[restaurantStyles.ratingNum, { color: colors.textMuted }]}>
                                {r.rating} ({r.reviewCount.toLocaleString()})
                            </Text>
                        </View>
                        <View style={restaurantStyles.addressRow}>
                            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                            <Text style={[restaurantStyles.address, { color: colors.textMuted }]} numberOfLines={1}>
                                {r.address}
                            </Text>
                        </View>
                    </View>
                </View>
            ))}
        </View>
    );
};

const restaurantStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
    },
    headerText: {
        fontSize: 16,
        fontWeight: '700',
        flex: 1,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    card: {
        borderRadius: 12,
        padding: 14,
        marginBottom: 8,
        borderWidth: 1,
    },
    cardTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    name: {
        fontSize: 15,
        fontWeight: '600',
    },
    cuisine: {
        fontSize: 13,
        marginTop: 2,
    },
    priceBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        marginLeft: 8,
    },
    priceText: {
        fontSize: 12,
        fontWeight: '700',
    },
    cardBottom: {
        gap: 6,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    ratingNum: {
        fontSize: 12,
        fontWeight: '500',
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    address: {
        fontSize: 12,
        flex: 1,
    },
});

// Parse and format message content with rich formatting
const FormattedMessage = ({ content, colors, isDarkMode }: { content: string; colors: any; isDarkMode: boolean }) => {
    const { weatherData, cleanContent: afterWeather } = extractWeatherJson(content);
    const { restaurantData, cleanContent } = extractRestaurantJson(afterWeather);
    
    // Split content into sections
    const lines = cleanContent.split('\n');
    const elements: React.ReactNode[] = [];
    let currentSection: string[] = [];
    let sectionTitle = '';
    let key = 0;

    const flushSection = () => {
        if (currentSection.length > 0 || sectionTitle) {
            elements.push(
                <View key={key++} style={formatStyles.section}>
                    {sectionTitle && (
                        <Text style={[formatStyles.sectionTitle, { color: colors.text }]}>
                            {sectionTitle}
                        </Text>
                    )}
                    {currentSection.map((line, i) => renderLine(line, i))}
                </View>
            );
            currentSection = [];
            sectionTitle = '';
        }
    };

    const renderLine = (line: string, index: number) => {
        const trimmed = line.trim();
        
        // Empty line
        if (!trimmed) {
            return <View key={`line-${index}`} style={{ height: 8 }} />;
        }
        
        // Bullet point
        if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
            const bulletContent = trimmed.replace(/^[•\-\*]\s*/, '');
            // Check if it has bold part (before colon)
            const colonIndex = bulletContent.indexOf(':');
            
            return (
                <View key={`line-${index}`} style={formatStyles.bulletContainer}>
                    <View style={[formatStyles.bulletDot, { backgroundColor: colors.primary }]} />
                    <Text style={[formatStyles.bulletText, { color: colors.text }]}>
                        {colonIndex > -1 ? (
                            <>
                                <Text style={formatStyles.bulletBold}>{bulletContent.slice(0, colonIndex + 1)}</Text>
                                {bulletContent.slice(colonIndex + 1)}
                            </>
                        ) : bulletContent}
                    </Text>
                </View>
            );
        }
        
        // Numbered list
        const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
        if (numberedMatch) {
            return (
                <View key={`line-${index}`} style={formatStyles.numberedContainer}>
                    <View style={[formatStyles.numberBadge, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.2)' : '#FFF3CD' }]}>
                        <Text style={[formatStyles.numberText, { color: colors.primary }]}>{numberedMatch[1]}</Text>
                    </View>
                    <Text style={[formatStyles.numberedText, { color: colors.text }]}>{numberedMatch[2]}</Text>
                </View>
            );
        }
        
        // Bold text (between ** or __)
        const boldPattern = /\*\*(.+?)\*\*|__(.+?)__/g;
        if (boldPattern.test(trimmed)) {
            const parts = trimmed.split(/(\*\*.+?\*\*|__.+?__)/g);
            return (
                <Text key={`line-${index}`} style={[formatStyles.paragraph, { color: colors.text }]}>
                    {parts.map((part, i) => {
                        if (part.startsWith('**') || part.startsWith('__')) {
                            return <Text key={i} style={formatStyles.boldText}>{part.slice(2, -2)}</Text>;
                        }
                        return part;
                    })}
                </Text>
            );
        }
        
        // Regular paragraph
        return (
            <Text key={`line-${index}`} style={[formatStyles.paragraph, { color: colors.text }]}>
                {trimmed}
            </Text>
        );
    };

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        
        // Check for section headers (ending with :)
        if (trimmed.endsWith(':') && !trimmed.startsWith('-') && !trimmed.startsWith('•') && trimmed.length < 50) {
            flushSection();
            sectionTitle = trimmed;
        } else {
            currentSection.push(line);
        }
    });
    
    flushSection();

    // Check if we have any special cards to render
    const hasWeather = !!weatherData;
    const hasRestaurants = restaurantData && restaurantData.length > 0;

    if (hasWeather || hasRestaurants) {
        return (
            <View>
                {hasWeather && <WeatherCard data={weatherData} />}
                {hasRestaurants && <RestaurantCard restaurants={restaurantData!} colors={colors} isDarkMode={isDarkMode} />}
                {elements}
            </View>
        );
    }

    // NOTE: this used to fall back to scraping a temperature out of the prose
    // ("24°C" → mini weather card) when no JSON block was present. Cards now
    // arrive as structured data from the server and are rendered by the caller,
    // so that heuristic would double up the card on every weather answer — and
    // it fired on any number followed by a degree sign, weather or not.
    return <View>{elements}</View>;
};

const formatStyles = StyleSheet.create({
    section: {
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 6,
        marginTop: 4,
    },
    paragraph: {
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 4,
    },
    boldText: {
        fontWeight: '700',
    },
    bulletContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 6,
        paddingLeft: 4,
    },
    bulletDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 8,
        marginRight: 10,
    },
    bulletText: {
        flex: 1,
        fontSize: 15,
        lineHeight: 22,
    },
    bulletBold: {
        fontWeight: '600',
    },
    numberedContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    numberBadge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    numberText: {
        fontSize: 13,
        fontWeight: '700',
    },
    numberedText: {
        flex: 1,
        fontSize: 15,
        lineHeight: 22,
        paddingTop: 2,
    },
    weatherGradientCard: {
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        overflow: 'hidden',
    },
    weatherMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    weatherLocation: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        textShadowColor: 'rgba(0,0,0,0.2)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
    },
    weatherCondition: {
        color: '#FFF',
        fontSize: 14,
        marginTop: 4,
        opacity: 0.9,
    },
    weatherTempContainer: {
        marginTop: 10,
    },
    weatherBigTemp: {
        color: '#FFF',
        fontSize: 56,
        fontWeight: '200',
        textShadowColor: 'rgba(0,0,0,0.2)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    weatherStats: {
        flexDirection: 'row',
        marginTop: 15,
        gap: 16,
    },
    weatherStatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 12,
        gap: 6,
    },
    weatherStatText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: '600',
    },
    // Forecast Styles
    forecastContainer: {
        marginTop: 16,
    },
    forecastDivider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.2)',
        marginBottom: 16,
    },
    forecastRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    forecastItem: {
        alignItems: 'center',
        gap: 2,
    },
    forecastDay: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 2,
    },
    forecastHigh: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: 'bold',
    },
    forecastLow: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 12,
        fontWeight: '500',
    },
});

const EXAMPLE_PROMPTS = [
    // The first three lead with what Atlas can now do that it couldn't before:
    // resolve "my trip" from the user's own data, read their deal radar, and
    // answer with live rates.
    { labelKey: "atlas.myTripWeather", icon: "airplane" as const },
    { labelKey: "atlas.dealsFromMe", icon: "pricetag" as const },
    { labelKey: "atlas.currencyJapan", icon: "swap-horizontal" as const },
    { labelKey: "atlas.visaJapan", icon: "document-text" as const },
    { labelKey: "atlas.weatherRome", icon: "partly-sunny" as const },
    { labelKey: "atlas.restaurantsParis", icon: "restaurant" as const },
    { labelKey: "atlas.holidaysSpain", icon: "flag" as const },
    { labelKey: "atlas.cashKorea", icon: "cash" as const },
    { labelKey: "atlas.vaccinesThailand", icon: "medkit" as const },
    { labelKey: "atlas.bestTimeBali", icon: "calendar" as const },
];

export default function AtlasScreen() {
    const { token, isLoading: tokenLoading } = useToken();
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const insets = useSafeAreaInsets();
    const flatListRef = useRef<FlatList>(null);
    const atlasChat = useAuthenticatedAction(api.atlas.chat, token);
    
    // AI data consent (Apple guideline 5.1.1/5.1.2)
    // @ts-ignore
    const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" }) as any;
    const updateAiConsent = useMutation(api.users.updateAiConsent);
    const [showAiConsentModal, setShowAiConsentModal] = useState(false);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    // Server-side thread this tab is appending to. Null until the first reply
    // comes back (or until a past thread is opened from history).
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    // Set when a past thread is tapped; drives the getConversation fetch below.
    const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

    // Thread list for the history sheet. Only fetched while the sheet is open.
    const conversations = useQuery(
        api.atlasDb.listConversations as any,
        token && showHistory ? { token, limit: 30 } : "skip"
    ) as any[] | undefined;
    const deleteConversation = useMutation(api.atlasDb.deleteConversation as any);

    const openConversation = useQuery(
        api.atlasDb.getConversation as any,
        token && pendingOpenId ? { token, conversationId: pendingOpenId } : "skip"
    ) as any;

    useEffect(() => {
        const keyboardDidShow = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
        const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
        return () => {
            keyboardDidShow.remove();
            keyboardDidHide.remove();
        };
    }, []);

    // Hydrate the transcript once a past thread's messages arrive.
    useEffect(() => {
        if (!pendingOpenId || !openConversation) return;
        setMessages(
            (openConversation.messages ?? []).map((m: any) => ({
                id: m._id,
                role: m.role,
                content: m.content,
                timestamp: new Date(m.createdAt),
                cards: Array.isArray(m.cards) ? m.cards : [],
                suggestions: Array.isArray(m.suggestions) ? m.suggestions : [],
            }))
        );
        setConversationId(openConversation._id);
        setPendingOpenId(null);
        setShowHistory(false);
    }, [pendingOpenId, openConversation]);

    /** Reset to an empty thread; the next reply mints a new conversation id. */
    const startNewChat = () => {
        setMessages([]);
        setConversationId(null);
        setInputText("");
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const sendMessage = async (text?: string) => {
        const messageText = text || inputText.trim();
        if (!messageText || isLoading) return;

        // Check AI data consent before sending to OpenAI (Apple guideline 5.1.1/5.1.2)
        if (userSettings && userSettings.aiDataConsent !== true) {
            setPendingMessage(messageText);
            setShowAiConsentModal(true);
            return;
        }

        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: messageText,
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInputText("");
        setIsLoading(true);

        try {
            // Only the tail is sent — the server trims again, but there is no
            // reason to pay upload cost for turns it will discard.
            const chatMessages = [...messages, userMessage].slice(-12).map(msg => ({
                role: msg.role as "user" | "assistant",
                content: msg.content,
            }));

            const response = await atlasChat({
                messages: chatMessages,
                // Held as a plain string in component state; the server
                // re-validates ownership before appending to it.
                conversationId: (conversationId ?? undefined) as any,
                language: i18n.language?.split("-")[0] || "en",
                // Opt in to the rich response. Without this the action returns
                // the legacy bare string that older shipped builds expect.
                structured: true,
            }) as any;

            if (response?.rateLimited) {
                // The server encodes the retry delay as RATE_LIMITED:<minutes>
                // so the copy can be localised on this side.
                const minutes = parseInt(String(response.text).split(":")[1] ?? "60", 10);
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: t('atlas.rateLimited', { minutes }),
                    timestamp: new Date(),
                }]);
                return;
            }

            if (response?.conversationId) {
                setConversationId(response.conversationId);
            }

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: response?.text ?? "",
                timestamp: new Date(),
                cards: Array.isArray(response?.cards) ? response.cards : [],
                suggestions: Array.isArray(response?.suggestions) ? response.suggestions : [],
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Atlas error:", error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: t('atlas.errorProcessing'),
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const renderMessage = ({ item, index }: { item: Message; index: number }) => {
        const isUser = item.role === "user";
        const cards = item.cards ?? [];
        // Chips only make sense on the newest reply — older ones would offer
        // follow-ups to a question the conversation has already moved past.
        const isLast = index === messages.length - 1;
        const suggestions = !isUser && isLast && !isLoading ? (item.suggestions ?? []) : [];

        return (
            <View style={[
                styles.messageContainer,
                isUser ? styles.userMessageContainer : styles.assistantMessageContainer,
            ]}>
                {!isUser && (
                    <View style={[styles.avatarContainer, { backgroundColor: colors.primary }]}>
                        <Ionicons name="globe" size={16} color={colors.text} />
                    </View>
                )}
                <View style={{ flexShrink: 1 }}>
                    <View style={[
                        styles.messageBubble,
                        isUser
                            ? [styles.userBubble, { backgroundColor: colors.primary }]
                            : [styles.assistantBubble, { backgroundColor: colors.card, borderColor: colors.border }],
                    ]}>
                        {isUser ? (
                            <Text style={[styles.messageText, { color: colors.text }]}>
                                {item.content}
                            </Text>
                        ) : (
                            <>
                                {cards.map((card, i) => {
                                    // Weather and restaurants keep their existing
                                    // bespoke components; everything else goes
                                    // through the shared renderer.
                                    if (card.type === "weather") {
                                        return <WeatherCard key={`c-${i}`} data={card.data} />;
                                    }
                                    if (card.type === "restaurants") {
                                        return (
                                            <RestaurantCard
                                                key={`c-${i}`}
                                                restaurants={card.data?.restaurants ?? []}
                                                colors={colors}
                                                isDarkMode={isDarkMode}
                                            />
                                        );
                                    }
                                    return <AtlasCardRenderer key={`c-${i}`} card={card} />;
                                })}
                                <FormattedMessage content={item.content} colors={colors} isDarkMode={isDarkMode} />
                            </>
                        )}
                    </View>

                    {suggestions.length > 0 && (
                        <View style={styles.suggestionsRow}>
                            {suggestions.map((s, i) => (
                                <TouchableOpacity
                                    key={`s-${i}`}
                                    style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                                    onPress={() => sendMessage(s)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={1}>
                                        {s}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </View>
            </View>
        );
    };

    const renderExamplePrompt = (prompt: { labelKey: string; icon: keyof typeof Ionicons.glyphMap }, index: number) => (
        <TouchableOpacity
            key={index}
            style={[styles.examplePrompt, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => sendMessage(t(prompt.labelKey))}
            activeOpacity={0.7}
        >
            <View style={[styles.examplePromptIcon, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.15)' : '#FFF8E1' }]}>
                <Ionicons name={prompt.icon} size={18} color={colors.primary} />
            </View>
            <Text style={[styles.examplePromptText, { color: colors.text }]} numberOfLines={2}>
                {t(prompt.labelKey)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    const styles = createStyles(colors, isDarkMode);

    // Show loading state while token is loading
    if (tokenLoading) {
        return (
            <>
                <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
                <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={[styles.loadingText, { color: colors.textMuted }]}>{t('common.loading')}</Text>
                    </View>
                </SafeAreaView>
            </>
        );
    }

    // Show sign-in prompt if not authenticated
    if (!token) {
        return (
            <>
                <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
                <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                    <View style={styles.authContainer}>
                        <Ionicons name="globe-outline" size={64} color={colors.primary} />
                        <Text style={[styles.authTitle, { color: colors.text }]}>{t('atlas.atlas')}</Text>
                        <Text style={[styles.authSubtitle, { color: colors.textMuted }]}>
                            {t('atlas.signInToAccess')}
                        </Text>
                    </View>
                </SafeAreaView>
            </>
        );
    }

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <View style={styles.headerContent}>
                        <View style={[styles.headerIcon, { backgroundColor: colors.primary }]}>
                            <Ionicons name="globe" size={24} color={colors.text} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.headerTitle, { color: colors.text }]}>{t('atlas.atlas')}</Text>
                            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>{t('atlas.travelAssistant')}</Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.headerButton, { borderColor: colors.border }]}
                            onPress={() => setShowHistory(true)}
                            accessibilityLabel={t('atlas.history')}
                        >
                            <Ionicons name="time-outline" size={20} color={colors.text} />
                        </TouchableOpacity>
                        {messages.length > 0 && (
                            <TouchableOpacity
                                style={[styles.headerButton, { borderColor: colors.border }]}
                                onPress={startNewChat}
                                accessibilityLabel={t('atlas.newChat')}
                            >
                                <Ionicons name="create-outline" size={20} color={colors.text} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                <KeyboardAvoidingView 
                    style={styles.chatContainer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    keyboardVerticalOffset={0}
                >
                    {messages.length === 0 ? (
                        // Welcome Screen
                        <ScrollView 
                            style={styles.welcomeScrollView}
                            contentContainerStyle={styles.welcomeContainer}
                            showsVerticalScrollIndicator={false}
                        >
                            <View style={[styles.welcomeIconContainer, { backgroundColor: isDarkMode ? 'rgba(255, 229, 0, 0.15)' : '#FFF8E1' }]}>
                                <Ionicons name="globe" size={48} color={colors.primary} />
                            </View>
                            <Text style={[styles.welcomeTitle, { color: colors.text }]}>{t('atlas.hiImAtlas')}</Text>
                            <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
                                {t('atlas.canHelpWith')}
                            </Text>
                            
                            <Text style={[styles.exampleTitle, { color: colors.text }]}>{t('atlas.tryAsking')}</Text>
                            <View style={styles.examplePromptsContainer}>
                                {EXAMPLE_PROMPTS.map((prompt, index) => renderExamplePrompt(prompt, index))}
                            </View>
                        </ScrollView>
                    ) : (
                        // Chat Messages
                        <FlatList
                            ref={flatListRef}
                            data={messages}
                            renderItem={renderMessage}
                            extraData={isLoading}
                            keyExtractor={item => item.id}
                            contentContainerStyle={[styles.messagesContent, { paddingBottom: 16 }]}
                            showsVerticalScrollIndicator={false}
                            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                        />
                    )}

                    {/* Typing Indicator */}
                    {isLoading && (
                        <View style={[styles.typingContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={[styles.avatarContainer, { backgroundColor: colors.primary }]}>
                                <Ionicons name="globe" size={16} color={colors.text} />
                            </View>
                            <View style={{ marginLeft: 4 }}>
                                <TypingIndicator colors={colors} />
                            </View>
                            <Text style={[styles.typingText, { color: colors.textMuted }]}>{t('atlas.thinking')}</Text>
                        </View>
                    )}

                    {/* Input Area */}
                    <View style={[
                        styles.inputContainer, 
                        { 
                            backgroundColor: colors.background,
                            borderTopColor: colors.border,
                            paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12) + 84,
                        }
                    ]}>
                        <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <TextInput
                                style={[styles.input, { color: colors.text }]}
                                placeholder={t('atlas.askPlaceholder')}
                                placeholderTextColor={colors.textMuted}
                                value={inputText}
                                onChangeText={setInputText}
                                multiline
                                maxLength={500}
                                editable={!isLoading}
                            />
                            <TouchableOpacity
                                style={[
                                    styles.sendButton,
                                    { backgroundColor: inputText.trim() && !isLoading ? colors.primary : colors.border },
                                ]}
                                onPress={() => sendMessage()}
                                disabled={!inputText.trim() || isLoading}
                            >
                                <Ionicons 
                                    name="send" 
                                    size={18} 
                                    color={inputText.trim() && !isLoading ? colors.text : colors.textMuted} 
                                />
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>

            {/* Conversation history */}
            <Modal
                visible={showHistory}
                animationType="slide"
                transparent
                onRequestClose={() => setShowHistory(false)}
            >
                <View style={styles.historyBackdrop}>
                    <View style={[styles.historySheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
                        <View style={[styles.historyHeader, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.historyTitle, { color: colors.text }]}>{t('atlas.history')}</Text>
                            <TouchableOpacity onPress={() => setShowHistory(false)}>
                                <Ionicons name="close" size={24} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {conversations === undefined ? (
                            <View style={styles.historyEmpty}>
                                <ActivityIndicator color={colors.primary} />
                            </View>
                        ) : conversations.length === 0 ? (
                            <View style={styles.historyEmpty}>
                                <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
                                <Text style={[styles.historyEmptyText, { color: colors.textMuted }]}>
                                    {t('atlas.noHistory')}
                                </Text>
                            </View>
                        ) : (
                            <ScrollView style={{ maxHeight: 420 }}>
                                {conversations.map((c: any) => (
                                    <View
                                        key={c._id}
                                        style={[styles.historyRow, { borderBottomColor: colors.border }]}
                                    >
                                        <TouchableOpacity
                                            style={{ flex: 1 }}
                                            onPress={() => setPendingOpenId(c._id)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={[styles.historyRowTitle, { color: colors.text }]} numberOfLines={1}>
                                                {c.title}
                                            </Text>
                                            <Text style={[styles.historyRowMeta, { color: colors.textMuted }]}>
                                                {new Date(c.updatedAt).toLocaleDateString()} · {c.messageCount} {t('atlas.messages')}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                Alert.alert(
                                                    t('atlas.deleteChat'),
                                                    t('atlas.deleteChatConfirm'),
                                                    [
                                                        { text: t('common.cancel'), style: 'cancel' },
                                                        {
                                                            text: t('common.delete'),
                                                            style: 'destructive',
                                                            onPress: async () => {
                                                                try {
                                                                    await deleteConversation({ token: token || "", conversationId: c._id });
                                                                    // Clear the transcript if the open thread was the one removed.
                                                                    if (conversationId === c._id) {
                                                                        setMessages([]);
                                                                        setConversationId(null);
                                                                    }
                                                                } catch (e) {
                                                                    console.error("Failed to delete conversation:", e);
                                                                }
                                                            },
                                                        },
                                                    ]
                                                );
                                            }}
                                            style={{ padding: 8 }}
                                        >
                                            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            {/* AI Data Consent Modal */}
            <AIConsentModal
                visible={showAiConsentModal}
                colors={colors}
                onAccept={async () => {
                    try {
                        await updateAiConsent({ token: token || "", aiDataConsent: true });
                        setShowAiConsentModal(false);
                        // Re-send the pending message after consent
                        if (pendingMessage) {
                            const msg = pendingMessage;
                            setPendingMessage(null);
                            // Small delay to let userSettings re-query
                            setTimeout(() => sendMessage(msg), 300);
                        }
                    } catch (e) {
                        console.error("Failed to save AI consent:", e);
                    }
                }}
                onDecline={() => {
                    setShowAiConsentModal(false);
                    setPendingMessage(null);
                    Alert.alert(
                        t('atlas.aiDisabled'),
                        t('atlas.aiDisabledMsg'),
                    );
                }}
            />
        </>
    );
}

const createStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
    },
    authContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    authTitle: {
        fontSize: 28,
        fontWeight: "bold",
        marginTop: 24,
    },
    authSubtitle: {
        fontSize: 16,
        textAlign: "center",
        marginTop: 12,
        lineHeight: 24,
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    headerContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    headerIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: "center",
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: "bold",
    },
    headerSubtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    headerButton: {
        width: 38,
        height: 38,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    suggestionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
        marginLeft: 4,
    },
    suggestionChip: {
        borderRadius: 16,
        borderWidth: 1,
        paddingVertical: 7,
        paddingHorizontal: 12,
        maxWidth: '100%',
    },
    suggestionText: {
        fontSize: 12,
        fontWeight: '600',
    },
    historyBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    historySheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    historyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    historyTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    historyEmpty: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        gap: 12,
    },
    historyEmptyText: {
        fontSize: 14,
    },
    historyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    historyRowTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    historyRowMeta: {
        fontSize: 12,
        marginTop: 3,
    },
    chatContainer: {
        flex: 1,
    },
    welcomeScrollView: {
        flex: 1,
    },
    welcomeContainer: {
        alignItems: "center",
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 40,
    },
    welcomeIconContainer: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 24,
    },
    welcomeTitle: {
        fontSize: 24,
        fontWeight: "bold",
        marginBottom: 12,
    },
    welcomeSubtitle: {
        fontSize: 15,
        textAlign: "center",
        lineHeight: 22,
        marginBottom: 32,
    },
    exampleTitle: {
        fontSize: 14,
        fontWeight: "600",
        marginBottom: 16,
    },
    examplePromptsContainer: {
        width: "100%",
        gap: 10,
    },
    examplePrompt: {
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
    },
    examplePromptIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 12,
    },
    examplePromptText: {
        flex: 1,
        fontSize: 15,
        fontWeight: "500",
    },
    messagesContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    messageContainer: {
        flexDirection: "row",
        marginBottom: 16,
        alignItems: "flex-end",
    },
    userMessageContainer: {
        justifyContent: "flex-end",
    },
    assistantMessageContainer: {
        justifyContent: "flex-start",
    },
    avatarContainer: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 8,
    },
    messageBubble: {
        maxWidth: "85%",
        padding: 14,
        borderRadius: 18,
    },
    userBubble: {
        borderBottomRightRadius: 6,
    },
    assistantBubble: {
        borderBottomLeftRadius: 6,
        borderWidth: 1,
    },
    messageText: {
        fontSize: 15,
        lineHeight: 22,
    },
    typingContainer: {
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 12,
        paddingRight: 16,
        borderRadius: 18,
        borderBottomLeftRadius: 6,
        borderWidth: 1,
        alignSelf: "flex-start",
    },
    typingText: {
        fontSize: 13,
        marginLeft: 10,
        fontStyle: "italic",
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    inputWrapper: {
        flexDirection: "row",
        alignItems: "flex-end",
        borderRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
        minHeight: 48,
    },
    input: {
        flex: 1,
        fontSize: 16,
        maxHeight: 100,
        paddingVertical: 8,
    },
    sendButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: "center",
        alignItems: "center",
        marginLeft: 8,
    },
});
