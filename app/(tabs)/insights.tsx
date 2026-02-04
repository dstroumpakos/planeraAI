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
} from "react-native";
import { useToken, useAuthenticatedAction } from "@/lib/useAuthenticatedMutation";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";

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

// Helper to extract weather info from text (fallback)
const detectWeatherInResponse = (text: string) => {
    // Simple regex to find temperature patterns like "24°C" or "75°F"
    const tempMatch = text.match(/(\d+)[°º](?:C|F)?/);
    // detect city
    const cityMatch = text.match(/in\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/);
    
    return {
        hasWeather: !!tempMatch,
        temp: tempMatch ? tempMatch[1] : null,
        city: cityMatch ? cityMatch[1] : null
    };
};

// Weather Card Component
const WeatherCard = ({ data }: { data: any }) => {
    const { colors } = useTheme();
    
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
                    <Text style={formatStyles.weatherStatText}>{data.humidity}% Humidity</Text>
                </View>
                <View style={formatStyles.weatherStatItem}>
                    <Ionicons name="speedometer-outline" size={16} color="#FFF" style={{opacity: 0.8}} />
                    <Text style={formatStyles.weatherStatText}>{data.windSpeed} km/h Wind</Text>
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

// Parse and format message content with rich formatting
const FormattedMessage = ({ content, colors, isDarkMode }: { content: string; colors: any; isDarkMode: boolean }) => {
    const { weatherData, cleanContent } = extractWeatherJson(content);
    
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

    // If weather data JSON detected, render the new card
    if (weatherData) {
        return (
            <View>
                <WeatherCard data={weatherData} />
                {elements}
            </View>
        );
    }
    
    // Fallback to old regex detection if no JSON block (backward compatibility)
    const oldWeatherInfo = detectWeatherInResponse(content);
    if (oldWeatherInfo.hasWeather && oldWeatherInfo.temp && !weatherData) {
        return (
            <View>
                <View style={[formatStyles.weatherCard, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.1)' : '#FFF8E1' }]}>
                    <View style={formatStyles.weatherHeader}>
                        <Ionicons name="partly-sunny" size={28} color={colors.primary} />
                        <View style={formatStyles.weatherInfo}>
                            <Text style={[formatStyles.weatherTemp, { color: colors.text }]}>{oldWeatherInfo.temp}°C</Text>
                            {oldWeatherInfo.city && (
                                <Text style={[formatStyles.weatherCity, { color: colors.textMuted }]}>{oldWeatherInfo.city}</Text>
                            )}
                        </View>
                    </View>
                </View>
                {elements}
            </View>
        );
    }

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
    weatherCard: {
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
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
    weatherHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    weatherInfo: {
        marginLeft: 12,
    },
    weatherTemp: {
        fontSize: 24,
        fontWeight: '700',
    },
    weatherCity: {
        fontSize: 13,
        marginTop: 2,
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
    { text: "Do I need a visa for Japan?", icon: "document-text" as const },
    { text: "Weather in Rome right now", icon: "partly-sunny" as const },
    { text: "Is cash needed in South Korea?", icon: "cash" as const },
    { text: "Vaccines needed for Thailand", icon: "medkit" as const },
    { text: "Best time to visit Bali?", icon: "calendar" as const },
    { text: "Tipping customs in the USA", icon: "restaurant" as const },
];

export default function AtlasScreen() {
    const { token, isLoading: tokenLoading } = useToken();
    const { colors, isDarkMode } = useTheme();
    const insets = useSafeAreaInsets();
    const flatListRef = useRef<FlatList>(null);
    const atlasChat = useAuthenticatedAction(api.atlas.chat, token);
    
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    useEffect(() => {
        const keyboardDidShow = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
        const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
        return () => {
            keyboardDidShow.remove();
            keyboardDidHide.remove();
        };
    }, []);

    const sendMessage = async (text?: string) => {
        const messageText = text || inputText.trim();
        if (!messageText || isLoading) return;

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
            // Prepare messages for the Convex action
            const chatMessages = [...messages, userMessage].map(msg => ({
                role: msg.role as "user" | "assistant",
                content: msg.content,
            }));
            
            const response = await atlasChat({ messages: chatMessages });
            
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: response as string,
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Atlas error:", error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "I'm sorry, I couldn't process your request. Please try again.",
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const renderMessage = ({ item }: { item: Message }) => {
        const isUser = item.role === "user";
        
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
                        <FormattedMessage content={item.content} colors={colors} isDarkMode={isDarkMode} />
                    )}
                </View>
            </View>
        );
    };

    const renderExamplePrompt = (prompt: { text: string; icon: keyof typeof Ionicons.glyphMap }, index: number) => (
        <TouchableOpacity
            key={index}
            style={[styles.examplePrompt, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => sendMessage(prompt.text)}
            activeOpacity={0.7}
        >
            <View style={[styles.examplePromptIcon, { backgroundColor: isDarkMode ? 'rgba(255,229,0,0.15)' : '#FFF8E1' }]}>
                <Ionicons name={prompt.icon} size={18} color={colors.primary} />
            </View>
            <Text style={[styles.examplePromptText, { color: colors.text }]} numberOfLines={2}>
                {prompt.text}
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
                        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading...</Text>
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
                        <Text style={[styles.authTitle, { color: colors.text }]}>Atlas</Text>
                        <Text style={[styles.authSubtitle, { color: colors.textMuted }]}>
                            Sign in to access your travel information assistant
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
                        <View>
                            <Text style={[styles.headerTitle, { color: colors.text }]}>Atlas</Text>
                            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>Your travel information assistant</Text>
                        </View>
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
                            <Text style={[styles.welcomeTitle, { color: colors.text }]}>Hi, I'm Atlas!</Text>
                            <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
                                I can help with travel information like visas, weather, local customs, and more. What would you like to know?
                            </Text>
                            
                            <Text style={[styles.exampleTitle, { color: colors.text }]}>Try asking about:</Text>
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
                            <Text style={[styles.typingText, { color: colors.textMuted }]}>Atlas is thinking...</Text>
                        </View>
                    )}

                    {/* Input Area */}
                    <View style={[
                        styles.inputContainer, 
                        { 
                            backgroundColor: colors.background,
                            borderTopColor: colors.border,
                            paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 80),
                        }
                    ]}>
                        <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <TextInput
                                style={[styles.input, { color: colors.text }]}
                                placeholder="Ask about visas, weather, customs..."
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
