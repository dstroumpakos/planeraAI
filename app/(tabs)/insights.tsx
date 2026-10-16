import React, { useState, useRef, useEffect } from "react";
import { BrandLoader } from "@/components/BrandLoader";
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
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import AIConsentModal from "@/components/AIConsentModal";
import { AtlasCardRenderer, type AtlasCardData } from "@/components/AtlasCards";
import { Image as ExpoImage } from "expo-image";
import { useReducedMotion } from "react-native-reanimated";
import { setAtlasBusy } from "@/lib/atlasActivity";
import { useTranslation } from "react-i18next";

// Atlas, the 3D character (rendered in Blender): a head-and-shoulders avatar for
// the chat, and a looping scene of him in the Planera office for the welcome screen.
const ATLAS_AVATAR = require("@/assets/images/atlas-avatar.png");
const ATLAS_OFFICE = require("@/assets/images/atlas-office.webp");

// Brand yellow is a fill; anything drawn on top of it uses ink, in both themes.
const YELLOW = "#FFE500";
const INK = "#1A1A1A";

// Animated typing dots component
const TypingIndicator = ({ color }: { color: string }) => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const animateDot = (dot: Animated.Value, delay: number) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
                    Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
                ])
            );

        const loops = [animateDot(dot1, 0), animateDot(dot2, 150), animateDot(dot3, 300)];
        loops.forEach((l) => l.start());
        return () => loops.forEach((l) => l.stop());
    }, []);

    const dotStyle = (anim: Animated.Value) => ({
        transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    });

    return (
        <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
            {[dot1, dot2, dot3].map((d, i) => (
                <Animated.View
                    key={i}
                    style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, dotStyle(d)]}
                />
            ))}
        </View>
    );
};

/** Atlas's face in a yellow disc; a soft ring pulses around it while he's thinking. */
const AtlasAvatar = ({ size, busy = false }: { size: number; busy?: boolean }) => {
    const pulse = useRef(new Animated.Value(0)).current;
    const reduceMotion = useReducedMotion();
    useEffect(() => {
        if (!busy || reduceMotion) {
            pulse.setValue(0);
            return;
        }
        const loop = Animated.loop(
            Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true })
        );
        loop.start();
        return () => loop.stop();
    }, [busy, reduceMotion]);

    return (
        <View style={{ width: size, height: size }}>
            {busy && (
                <Animated.View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: YELLOW,
                        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
                    }}
                />
            )}
            <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: YELLOW, overflow: "hidden" }}>
                <ExpoImage source={ATLAS_AVATAR} style={{ width: size, height: size }} contentFit="cover" />
            </View>
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
    /** Set on a failed turn: the question to re-ask when "Retry" is tapped. */
    retryText?: string;
}

/**
 * Replies saved before Atlas moved to structured cards carried their weather
 * and restaurant data inline as <WEATHER_JSON>/<RESTAURANT_JSON> blocks. Turn
 * those into cards so old threads opened from history still render properly.
 */
const extractLegacyCards = (content: string): { cards: AtlasCardData[]; text: string } => {
    const cards: AtlasCardData[] = [];
    let text = content;

    const weather = text.match(/<WEATHER_JSON>([\s\S]*?)<\/WEATHER_JSON>/);
    if (weather?.[1]) {
        try {
            cards.push({ type: "weather", data: JSON.parse(weather[1]) });
        } catch {}
        text = text.replace(weather[0], "");
    }

    const restaurants = text.match(/<RESTAURANT_JSON>([\s\S]*?)<\/RESTAURANT_JSON>/);
    if (restaurants?.[1]) {
        try {
            const parsed = JSON.parse(restaurants[1]);
            if (Array.isArray(parsed)) cards.push({ type: "restaurants", data: { restaurants: parsed } });
        } catch {}
        text = text.replace(restaurants[0], "");
    }

    return { cards, text: text.trim() };
};

/** Plain text for the clipboard: markdown emphasis and heading marks removed. */
const toPlainText = (content: string) =>
    content.replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2").replace(/^#{1,4}\s+/gm, "");

/** Renders **bold** / __bold__ anywhere inside a line. */
const InlineText = ({ text, style, boldStyle }: { text: string; style: any; boldStyle?: any }) => {
    const parts = text.split(/(\*\*.+?\*\*|__.+?__)/g).filter(Boolean);
    return (
        <Text style={style}>
            {parts.map((part, i) =>
                (part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")) ? (
                    <Text key={i} style={[{ fontWeight: "700" }, boldStyle]}>
                        {part.slice(2, -2)}
                    </Text>
                ) : (
                    part
                )
            )}
        </Text>
    );
};

// Lightweight markdown for Atlas prose: headings, bullets, numbered steps, bold.
const FormattedMessage = ({ content, colors }: { content: string; colors: any }) => {
    const lines = content.split("\n");
    const elements: React.ReactNode[] = [];
    let lastWasBlank = false;

    lines.forEach((raw, index) => {
        const line = raw.trim();
        const key = `l-${index}`;

        if (!line) {
            if (!lastWasBlank && elements.length > 0) elements.push(<View key={key} style={{ height: 6 }} />);
            lastWasBlank = true;
            return;
        }
        lastWasBlank = false;

        // "### Heading", or a short line that only introduces what follows ("Tips:")
        const heading = line.match(/^#{1,4}\s+(.+)/);
        const isLabel = line.endsWith(":") && line.length < 50 && !/^([•\-–]|\*(?!\*)|\d+\.)/.test(line);
        if (heading || isLabel) {
            elements.push(
                <InlineText
                    key={key}
                    text={heading ? heading[1] : line}
                    style={[fmt.heading, { color: colors.text }]}
                />
            );
            return;
        }

        // Bullets. A leading "**" is bold text, not a bullet.
        const bullet = line.match(/^(?:[•\-–]|\*(?!\*))\s+(.+)/);
        if (bullet) {
            elements.push(
                <View key={key} style={fmt.bulletRow}>
                    <View style={[fmt.bulletDot, { backgroundColor: colors.text }]} />
                    <InlineText text={bullet[1]} style={[fmt.body, { color: colors.text, flex: 1 }]} />
                </View>
            );
            return;
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.+)/);
        if (numbered) {
            elements.push(
                <View key={key} style={fmt.numberRow}>
                    <View style={fmt.numberBadge}>
                        <Text style={fmt.numberText}>{numbered[1]}</Text>
                    </View>
                    <InlineText text={numbered[2]} style={[fmt.body, { color: colors.text, flex: 1 }]} />
                </View>
            );
            return;
        }

        elements.push(<InlineText key={key} text={line} style={[fmt.body, fmt.paragraph, { color: colors.text }]} />);
    });

    return <View>{elements}</View>;
};

const fmt = StyleSheet.create({
    heading: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2, marginTop: 6, marginBottom: 6 },
    body: { fontSize: 15.5, lineHeight: 23 },
    paragraph: { marginBottom: 4 },
    bulletRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6, paddingRight: 4 },
    bulletDot: { width: 5, height: 5, borderRadius: 3, marginTop: 9, marginRight: 10, marginLeft: 2 },
    numberRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
    numberBadge: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: YELLOW,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 10,
        marginTop: 1,
    },
    numberText: { fontSize: 12, fontWeight: "800", color: INK },
});

// Prompts that lean on what only Atlas knows: the user's own trips, home
// airport and saved travellers.
const PERSONAL_PROMPTS = [
    { labelKey: "atlas.myTripWeather", icon: "partly-sunny" as const },
    { labelKey: "atlas.dealsFromMe", icon: "pricetag" as const },
    { labelKey: "atlas.passportPrompt", icon: "id-card" as const },
];

const TOPICS = [
    { titleKey: "atlas.topics.entry", promptKey: "atlas.visaJapan", icon: "document-text" as const, tint: "#5B6CFF" },
    { titleKey: "atlas.topics.money", promptKey: "atlas.currencyJapan", icon: "cash" as const, tint: "#22A45D" },
    { titleKey: "atlas.topics.weather", promptKey: "atlas.weatherRome", icon: "sunny" as const, tint: "#1E9BF0" },
    { titleKey: "atlas.topics.food", promptKey: "atlas.restaurantsParis", icon: "restaurant" as const, tint: "#FF6B35" },
    { titleKey: "atlas.topics.holidays", promptKey: "atlas.holidaysSpain", icon: "flag" as const, tint: "#DD2A7B" },
    { titleKey: "atlas.topics.health", promptKey: "atlas.vaccinesThailand", icon: "medkit" as const, tint: "#E5484D" },
];

export default function AtlasScreen() {
    const { token, isLoading: tokenLoading } = useToken();
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const flatListRef = useRef<FlatList>(null);
    const atlasChat = useAuthenticatedAction(api.atlas.chat, token);

    // AI data consent (Apple guideline 5.1.1/5.1.2)
    // @ts-ignore
    const userSettings = useQuery(api.users.getSettings as any, { token: token || "skip" }) as any;
    const updateAiConsent = useMutation(api.users.updateAiConsent);
    const [showAiConsentModal, setShowAiConsentModal] = useState(false);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    // The consent modal re-sends through a sendMessage closure that still holds
    // the pre-consent settings; this lets that re-send through.
    const consentGrantedRef = useRef(false);

    const [messages, setMessages] = useState<Message[]>([]);
    // Mirrors `messages` so a send (or retry) always builds history from the
    // latest transcript, not the one captured when its closure was created.
    const messagesRef = useRef<Message[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Lets the tab bar's Atlas figure spin its globe while a reply is pending.
    useEffect(() => {
        setAtlasBusy(isLoading);
    }, [isLoading]);
    useEffect(() => () => setAtlasBusy(false), []);

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
    // The three most recent threads, shown on the welcome screen only.
    const recentConversations = useQuery(
        api.atlasDb.listConversations as any,
        token && messages.length === 0 ? { token, limit: 3 } : "skip"
    ) as any[] | undefined;
    const deleteConversation = useMutation(api.atlasDb.deleteConversation as any);

    const openConversation = useQuery(
        api.atlasDb.getConversation as any,
        token && pendingOpenId ? { token, conversationId: pendingOpenId } : "skip"
    ) as any;

    useEffect(() => {
        const keyboardDidShow = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
        const keyboardDidHide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
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

    const tap = () => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

    /** Reset to an empty thread; the next reply mints a new conversation id. */
    const startNewChat = () => {
        setMessages([]);
        setConversationId(null);
        setInputText("");
        tap();
    };

    const sendMessage = async (text?: string) => {
        const messageText = text || inputText.trim();
        if (!messageText || isLoading) return;

        // Check AI data consent before sending to OpenAI (Apple guideline 5.1.1/5.1.2)
        if (userSettings && userSettings.aiDataConsent !== true && !consentGrantedRef.current) {
            setPendingMessage(messageText);
            setShowAiConsentModal(true);
            return;
        }

        tap();

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: messageText,
            timestamp: new Date(),
        };

        const history = [...messagesRef.current, userMessage];
        messagesRef.current = history;
        setMessages(history);
        setInputText("");
        setIsLoading(true);

        try {
            // Only the tail is sent — the server trims again, but there is no
            // reason to pay upload cost for turns it will discard. Failed turns
            // are left out so the model never sees our own error copy.
            const chatMessages = history
                .filter((msg) => !msg.retryText)
                .slice(-12)
                .map((msg) => ({
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
                setMessages((prev) => [
                    ...prev,
                    {
                        id: (Date.now() + 1).toString(),
                        role: "assistant",
                        content: t("atlas.rateLimited", { minutes }),
                        timestamp: new Date(),
                    },
                ]);
                return;
            }

            if (response?.conversationId) {
                setConversationId(response.conversationId);
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: response?.text ?? "",
                    timestamp: new Date(),
                    cards: Array.isArray(response?.cards) ? response.cards : [],
                    suggestions: Array.isArray(response?.suggestions) ? response.suggestions : [],
                },
            ]);
        } catch (error) {
            console.error("Atlas error:", error);
            setMessages((prev) => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: t("atlas.errorProcessing"),
                    timestamp: new Date(),
                    retryText: messageText,
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    /** Drop the failed turn (question + error) and ask again. */
    const retry = (failed: Message) => {
        const idx = messagesRef.current.findIndex((m) => m.id === failed.id);
        if (idx < 0 || !failed.retryText) return;
        const trimmed = messagesRef.current.slice(0, Math.max(0, idx - 1));
        messagesRef.current = trimmed;
        setMessages(trimmed);
        sendMessage(failed.retryText);
    };

    const copyReply = async (item: Message) => {
        try {
            await Clipboard.setStringAsync(toPlainText(item.content));
            tap();
            setCopiedId(item.id);
            setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1600);
        } catch (e) {
            console.error("Copy failed:", e);
        }
    };

    const formatWhen = (ts: number) => {
        const d = new Date(ts);
        const sameDay = d.toDateString() === new Date().toDateString();
        try {
            return new Intl.DateTimeFormat(
                i18n.language,
                sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }
            ).format(d);
        } catch {
            return d.toLocaleDateString();
        }
    };

    const confirmDelete = (c: any) => {
        Alert.alert(t("atlas.deleteChat"), t("atlas.deleteChatConfirm"), [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("common.delete"),
                style: "destructive",
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
        ]);
    };

    const styles = createStyles(colors, isDarkMode);

    const AtlasLabel = ({ busy = false }: { busy?: boolean }) => (
        <View style={styles.atlasLabelRow}>
            <AtlasAvatar size={26} busy={busy} />
            <Text style={[styles.atlasLabelText, { color: colors.text }]}>{t("atlas.atlas")}</Text>
        </View>
    );

    const renderMessage = ({ item, index }: { item: Message; index: number }) => {
        if (item.role === "user") {
            return (
                <View style={styles.userRow}>
                    <View style={styles.userBubble}>
                        <Text style={styles.userText}>{item.content}</Text>
                    </View>
                </View>
            );
        }

        const legacy = extractLegacyCards(item.content);
        const cards = [...(item.cards ?? []), ...legacy.cards];
        // Chips only make sense on the newest reply — older ones would offer
        // follow-ups to a question the conversation has already moved past.
        const isLast = index === messages.length - 1;
        const suggestions = isLast && !isLoading ? item.suggestions ?? [] : [];
        const copied = copiedId === item.id;

        return (
            <View style={styles.assistantRow}>
                <AtlasLabel />

                {cards.map((card, i) => (
                    <AtlasCardRenderer key={`c-${i}`} card={card} />
                ))}

                {item.retryText ? (
                    <View style={[styles.errorBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
                        <Text style={[styles.errorText, { color: colors.textSecondary }]}>{legacy.text}</Text>
                        {isLast && !isLoading && (
                            <TouchableOpacity style={styles.retryButton} onPress={() => retry(item)} activeOpacity={0.8}>
                                <Ionicons name="refresh" size={14} color={INK} />
                                <Text style={styles.retryText}>{t("common.retry")}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                ) : (
                    !!legacy.text && <FormattedMessage content={legacy.text} colors={colors} />
                )}

                {!!legacy.text && !item.retryText && (
                    <View style={styles.actionsRow}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => copyReply(item)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel={t("atlas.copy")}
                        >
                            <Ionicons
                                name={copied ? "checkmark" : "copy-outline"}
                                size={14}
                                color={copied ? "#22A45D" : colors.textMuted}
                            />
                            <Text style={[styles.actionText, { color: copied ? "#22A45D" : colors.textMuted }]}>
                                {copied ? t("atlas.copied") : t("atlas.copy")}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {suggestions.length > 0 && (
                    <View style={styles.suggestions}>
                        {suggestions.map((s, i) => (
                            <TouchableOpacity
                                key={`s-${i}`}
                                style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                                onPress={() => sendMessage(s)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="return-down-forward" size={14} color={colors.textMuted} />
                                <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={2}>
                                    {s}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>
        );
    };

    const renderWelcome = () => (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.welcomeContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {/* Atlas in the Planera office (looping) */}
            <ExpoImage
                source={ATLAS_OFFICE}
                style={styles.heroScene}
                contentFit="cover"
                autoplay={!reduceMotion}
                accessibilityLabel={t("atlas.atlas")}
            />

            <Text style={[styles.heroTitle, { color: colors.text }]}>{t("atlas.heroTitle")}</Text>
            <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>{t("atlas.heroSubtitle")}</Text>

            {/* Personal prompts — the questions only Atlas can answer */}
            <LinearGradient
                colors={["#0B1736", "#1D3170"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.personalCard}
            >
                <View style={styles.personalHeader}>
                    <View style={styles.personalBadge}>
                        <Ionicons name="sparkles" size={16} color={INK} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.personalTitle}>{t("atlas.forYou")}</Text>
                        <Text style={styles.personalSubtitle}>{t("atlas.forYouSubtitle")}</Text>
                    </View>
                </View>
                {PERSONAL_PROMPTS.map((p, i) => (
                    <TouchableOpacity
                        key={p.labelKey}
                        style={[styles.personalRow, i === 0 && { borderTopWidth: 0 }]}
                        onPress={() => sendMessage(t(p.labelKey))}
                        activeOpacity={0.7}
                    >
                        <Ionicons name={p.icon} size={18} color={YELLOW} />
                        <Text style={styles.personalRowText} numberOfLines={2}>
                            {t(p.labelKey)}
                        </Text>
                        <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.55)" />
                    </TouchableOpacity>
                ))}
            </LinearGradient>

            {/* Topic grid */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("atlas.exploreTopics")}</Text>
            <View style={styles.topicGrid}>
                {TOPICS.map((topic) => (
                    <TouchableOpacity
                        key={topic.titleKey}
                        style={[styles.topicTile, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => sendMessage(t(topic.promptKey))}
                        activeOpacity={0.75}
                    >
                        <View style={[styles.topicIcon, { backgroundColor: `${topic.tint}1F` }]}>
                            <Ionicons name={topic.icon} size={18} color={topic.tint} />
                        </View>
                        <Text style={[styles.topicTitle, { color: colors.text }]} numberOfLines={1}>
                            {t(topic.titleKey)}
                        </Text>
                        <Text style={[styles.topicPrompt, { color: colors.textMuted }]} numberOfLines={2}>
                            {t(topic.promptKey)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Recent threads */}
            {!!recentConversations && recentConversations.length > 0 && (
                <>
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                            {t("atlas.recentChats")}
                        </Text>
                        <TouchableOpacity onPress={() => setShowHistory(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Text style={[styles.viewAll, { color: colors.textSecondary }]}>{t("common.viewAll")}</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={[styles.recentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {recentConversations.map((c: any, i: number) => (
                            <TouchableOpacity
                                key={c._id}
                                style={[
                                    styles.recentRow,
                                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                                ]}
                                onPress={() => setPendingOpenId(c._id)}
                                activeOpacity={0.7}
                            >
                                <View style={[styles.recentIcon, { backgroundColor: colors.lightGray }]}>
                                    {pendingOpenId === c._id ? (
                                        <ActivityIndicator size="small" color={colors.textMuted} />
                                    ) : (
                                        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textSecondary} />
                                    )}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.recentTitle, { color: colors.text }]} numberOfLines={1}>
                                        {c.title}
                                    </Text>
                                    <Text style={[styles.recentMeta, { color: colors.textMuted }]}>
                                        {formatWhen(c.updatedAt)} · {c.messageCount} {t("atlas.messages")}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </>
            )}

            <View style={styles.disclaimerRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} />
                <Text style={[styles.disclaimerText, { color: colors.textMuted }]}>{t("atlas.disclaimer")}</Text>
            </View>
        </ScrollView>
    );

    // Show loading state while token is loading
    if (tokenLoading) {
        return (
            <>
                <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
                <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                    <View style={styles.centerFill}>
                        <BrandLoader />
                        <Text style={[styles.loadingText, { color: colors.textMuted }]}>{t("common.loading")}</Text>
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
                    <View style={[styles.centerFill, { padding: 40 }]}>
                        <AtlasAvatar size={96} />
                        <Text style={[styles.authTitle, { color: colors.text }]}>{t("atlas.atlas")}</Text>
                        <Text style={[styles.authSubtitle, { color: colors.textMuted }]}>{t("atlas.signInToAccess")}</Text>
                    </View>
                </SafeAreaView>
            </>
        );
    }

    const canSend = !!inputText.trim() && !isLoading;

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
                {/* Header */}
                <View style={styles.header}>
                    <AtlasAvatar size={42} busy={isLoading} />
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.headerTitle, { color: colors.text }]}>{t("atlas.atlas")}</Text>
                        <View style={styles.statusRow}>
                            <View style={styles.statusDot} />
                            <Text style={[styles.statusText, { color: colors.textMuted }]} numberOfLines={1}>
                                {t("atlas.liveStatus")}
                            </Text>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.headerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => setShowHistory(true)}
                        accessibilityLabel={t("atlas.history")}
                    >
                        <Ionicons name="time-outline" size={19} color={colors.text} />
                    </TouchableOpacity>
                    {messages.length > 0 && (
                        <TouchableOpacity
                            style={[styles.headerButton, styles.headerButtonPrimary]}
                            onPress={startNewChat}
                            accessibilityLabel={t("atlas.newChat")}
                        >
                            <Ionicons name="add" size={22} color={INK} />
                        </TouchableOpacity>
                    )}
                </View>

                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    keyboardVerticalOffset={0}
                >
                    {messages.length === 0 ? (
                        renderWelcome()
                    ) : (
                        <FlatList
                            ref={flatListRef}
                            data={messages}
                            renderItem={renderMessage}
                            extraData={[isLoading, copiedId]}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.messagesContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                            ListFooterComponent={
                                isLoading ? (
                                    <View style={styles.assistantRow}>
                                        <AtlasLabel busy />
                                        <View style={styles.thinkingRow}>
                                            <TypingIndicator color={colors.textMuted} />
                                            <Text style={[styles.thinkingText, { color: colors.textMuted }]}>
                                                {t("atlas.thinking")}
                                            </Text>
                                        </View>
                                    </View>
                                ) : null
                            }
                        />
                    )}

                    {/* Composer */}
                    <View
                        style={[
                            styles.composerWrap,
                            {
                                backgroundColor: colors.background,
                                paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12) + 84,
                            },
                        ]}
                    >
                        {/* Soft fade so content scrolls under the composer instead of hitting a hard edge */}
                        <LinearGradient
                            pointerEvents="none"
                            colors={[`${colors.background}00`, colors.background]}
                            style={styles.composerFade}
                        />
                        <View
                            style={[
                                styles.composer,
                                {
                                    backgroundColor: colors.card,
                                    borderColor: colors.border,
                                    shadowOpacity: isDarkMode ? 0 : 0.08,
                                },
                            ]}
                        >
                            <TextInput
                                style={[styles.input, { color: colors.text }]}
                                placeholder={t("atlas.askPlaceholder")}
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
                                    { backgroundColor: canSend ? YELLOW : colors.lightGray },
                                ]}
                                onPress={() => sendMessage()}
                                disabled={!canSend}
                                accessibilityLabel={t("common.continue")}
                            >
                                {isLoading ? (
                                    <ActivityIndicator size="small" color={colors.textMuted} />
                                ) : (
                                    <Ionicons name="arrow-up" size={20} color={canSend ? INK : colors.textMuted} />
                                )}
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
                    <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowHistory(false)} />
                    <View style={[styles.historySheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
                        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
                        <View style={styles.historyHeader}>
                            <Text style={[styles.historyTitle, { color: colors.text }]}>{t("atlas.history")}</Text>
                            <TouchableOpacity
                                style={[styles.headerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                                onPress={() => setShowHistory(false)}
                                accessibilityLabel={t("common.close")}
                            >
                                <Ionicons name="close" size={20} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={styles.newChatRow}
                            onPress={() => {
                                startNewChat();
                                setShowHistory(false);
                            }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="add" size={20} color={INK} />
                            <Text style={styles.newChatText}>{t("atlas.newChat")}</Text>
                        </TouchableOpacity>

                        {conversations === undefined ? (
                            <View style={styles.historyEmpty}>
                                <ActivityIndicator color={colors.textMuted} />
                            </View>
                        ) : conversations.length === 0 ? (
                            <View style={styles.historyEmpty}>
                                <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
                                <Text style={[styles.historyEmptyText, { color: colors.textMuted }]}>{t("atlas.noHistory")}</Text>
                            </View>
                        ) : (
                            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                                {conversations.map((c: any) => {
                                    const active = conversationId === c._id;
                                    return (
                                        <View
                                            key={c._id}
                                            style={[
                                                styles.historyRow,
                                                {
                                                    backgroundColor: active ? colors.secondary : colors.card,
                                                    borderColor: colors.border,
                                                },
                                            ]}
                                        >
                                            <TouchableOpacity
                                                style={styles.historyRowMain}
                                                onPress={() => setPendingOpenId(c._id)}
                                                activeOpacity={0.7}
                                            >
                                                <View style={[styles.recentIcon, { backgroundColor: colors.lightGray }]}>
                                                    {pendingOpenId === c._id ? (
                                                        <ActivityIndicator size="small" color={colors.textMuted} />
                                                    ) : (
                                                        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textSecondary} />
                                                    )}
                                                </View>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={[styles.recentTitle, { color: colors.text }]} numberOfLines={1}>
                                                        {c.title}
                                                    </Text>
                                                    <Text style={[styles.recentMeta, { color: colors.textMuted }]}>
                                                        {formatWhen(c.updatedAt)} · {c.messageCount} {t("atlas.messages")}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                onPress={() => confirmDelete(c)}
                                                style={{ padding: 10 }}
                                                accessibilityLabel={t("atlas.deleteChat")}
                                            >
                                                <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                                            </TouchableOpacity>
                                        </View>
                                    );
                                })}
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
                        consentGrantedRef.current = true;
                        setShowAiConsentModal(false);
                        // Re-send the pending message after consent
                        if (pendingMessage) {
                            const msg = pendingMessage;
                            setPendingMessage(null);
                            setTimeout(() => sendMessage(msg), 300);
                        }
                    } catch (e) {
                        console.error("Failed to save AI consent:", e);
                    }
                }}
                onDecline={() => {
                    setShowAiConsentModal(false);
                    setPendingMessage(null);
                    Alert.alert(t("atlas.aiDisabled"), t("atlas.aiDisabledMsg"));
                }}
            />
        </>
    );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
    StyleSheet.create({
        container: { flex: 1 },
        centerFill: { flex: 1, justifyContent: "center", alignItems: "center" },
        loadingText: { marginTop: 16, fontSize: 16 },
        authTitle: { fontSize: 28, fontWeight: "800", marginTop: 20, letterSpacing: -0.6 },
        authSubtitle: { fontSize: 16, textAlign: "center", marginTop: 10, lineHeight: 23 },

        // Header
        header: {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 12,
        },
        headerTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
        statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
        statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#34C759" },
        statusText: { fontSize: 12, fontWeight: "500" },
        headerButton: {
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
        },
        headerButtonPrimary: { backgroundColor: YELLOW, borderColor: YELLOW },

        // Welcome
        welcomeContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
        heroScene: {
            width: "100%",
            aspectRatio: 4 / 3,
            borderRadius: 24,
            marginBottom: 18,
            backgroundColor: colors.card,
        },
        heroTitle: { fontSize: 32, fontWeight: "800", letterSpacing: -1, lineHeight: 38 },
        heroSubtitle: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 20 },
        personalCard: { borderRadius: 24, padding: 18, paddingBottom: 6, marginBottom: 28 },
        personalHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
        personalBadge: {
            width: 36,
            height: 36,
            borderRadius: 12,
            backgroundColor: YELLOW,
            alignItems: "center",
            justifyContent: "center",
        },
        personalTitle: { color: "#FFF", fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
        personalSubtitle: { color: "rgba(255,255,255,0.65)", fontSize: 12.5, marginTop: 2, lineHeight: 17 },
        personalRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 14,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: "rgba(255,255,255,0.15)",
        },
        personalRowText: { flex: 1, color: "#FFF", fontSize: 15, fontWeight: "600" },
        sectionHeader: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 28,
            marginBottom: 12,
        },
        sectionTitle: { fontSize: 19, fontWeight: "800", letterSpacing: -0.4, marginBottom: 12 },
        viewAll: { fontSize: 14, fontWeight: "600" },
        topicGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
        topicTile: {
            width: "48.5%",
            minHeight: 128,
            borderRadius: 20,
            borderWidth: 1,
            padding: 14,
        },
        topicIcon: {
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
        },
        topicTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
        topicPrompt: { fontSize: 12.5, lineHeight: 17, marginTop: 4 },
        recentCard: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14 },
        recentRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
        recentIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
        recentTitle: { fontSize: 14.5, fontWeight: "600" },
        recentMeta: { fontSize: 12, marginTop: 2 },
        disclaimerRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 24, paddingHorizontal: 4 },
        disclaimerText: { flex: 1, fontSize: 11.5, lineHeight: 16 },

        // Transcript
        messagesContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
        userRow: { alignItems: "flex-end", marginBottom: 20, paddingLeft: 48 },
        userBubble: {
            backgroundColor: YELLOW,
            borderRadius: 22,
            borderBottomRightRadius: 6,
            paddingHorizontal: 16,
            paddingVertical: 11,
        },
        userText: { color: INK, fontSize: 15.5, lineHeight: 22, fontWeight: "500" },
        assistantRow: { marginBottom: 24 },
        atlasLabelRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
        atlasLabelText: { fontSize: 13, fontWeight: "700" },
        thinkingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
        thinkingText: { fontSize: 14 },
        actionsRow: { flexDirection: "row", marginTop: 6 },
        actionButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
        actionText: { fontSize: 12, fontWeight: "600" },
        suggestions: { marginTop: 14, gap: 8, alignItems: "flex-start" },
        suggestionChip: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 16,
            borderWidth: 1,
            paddingVertical: 10,
            paddingHorizontal: 14,
            maxWidth: "100%",
        },
        suggestionText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
        errorBox: {
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            borderRadius: 16,
            borderWidth: 1,
            padding: 12,
        },
        errorText: { flex: 1, minWidth: 160, fontSize: 14, lineHeight: 20 },
        retryButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            backgroundColor: YELLOW,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 7,
        },
        retryText: { color: INK, fontSize: 13, fontWeight: "700" },

        // Composer
        composerWrap: { paddingHorizontal: 16, paddingTop: 6 },
        composerFade: { position: "absolute", left: 0, right: 0, top: -24, height: 24 },
        composer: {
            flexDirection: "row",
            alignItems: "flex-end",
            borderRadius: 26,
            borderWidth: 1,
            paddingLeft: 18,
            paddingRight: 6,
            paddingVertical: 6,
            minHeight: 52,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 6 },
            shadowRadius: 16,
            elevation: isDarkMode ? 0 : 3,
        },
        input: {
            flex: 1,
            fontSize: 16,
            maxHeight: 110,
            paddingTop: Platform.OS === "ios" ? 10 : 8,
            paddingBottom: Platform.OS === "ios" ? 10 : 8,
        },
        sendButton: {
            width: 40,
            height: 40,
            borderRadius: 20,
            justifyContent: "center",
            alignItems: "center",
            marginLeft: 8,
        },

        // History sheet
        historyBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
        historySheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8 },
        sheetHandle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: 6 },
        historyHeader: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
        },
        historyTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
        newChatRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            backgroundColor: YELLOW,
            borderRadius: 16,
            paddingVertical: 13,
            marginBottom: 14,
        },
        newChatText: { color: INK, fontSize: 15, fontWeight: "700" },
        historyEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
        historyEmptyText: { fontSize: 14 },
        historyRow: {
            flexDirection: "row",
            alignItems: "center",
            borderRadius: 16,
            borderWidth: 1,
            paddingLeft: 12,
            paddingRight: 2,
            marginBottom: 8,
        },
        historyRowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
    });
