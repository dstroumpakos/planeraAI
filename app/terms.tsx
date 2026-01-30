import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

// Planera Colors
const COLORS = {
    primary: "#FFE500",
    background: "#FAF9F6",
    text: "#1A1A1A",
    textSecondary: "#6B6B6B",
    textMuted: "#9B9B9B",
    white: "#FFFFFF",
    border: "#E8E6E1",
};

export default function TermsScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Terms & Conditions</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.lastUpdated}>Last updated: January 2026</Text>

                <Text style={styles.sectionTitle}>Planera – Terms & Conditions</Text>

                <Text style={styles.paragraph}>
                    Welcome to <Text style={styles.bold}>Planera</Text>. These Terms & Conditions ("Terms") govern your access to and use of the Planera mobile application, website, and related services (collectively, the "Service"). By accessing or using Planera, you agree to be bound by these Terms. If you do not agree, please do not use the Service.
                </Text>

                <Text style={styles.heading}>1. About Planera</Text>
                <Text style={styles.paragraph}>
                    Planera is an AI-powered travel planning platform that generates personalized travel itineraries and suggestions (including destinations, activities, flights, accommodations, and transportation options). Planera <Text style={styles.bold}>does not operate as a travel agency</Text> and <Text style={styles.bold}>does not sell, own, or control</Text> travel products or services.
                </Text>
                <Text style={styles.paragraph}>
                    All bookings, payments, and contractual relationships are made <Text style={styles.bold}>directly with third‑party providers</Text> (such as airlines, hotels, booking platforms, or experience providers).
                </Text>

                <Text style={styles.heading}>2. Eligibility</Text>
                <Text style={styles.paragraph}>
                    You must be at least <Text style={styles.bold}>18 years old</Text> to use Planera. By using the Service, you represent and warrant that you meet this requirement and that you have the legal capacity to enter into these Terms.
                </Text>

                <Text style={styles.heading}>3. User Accounts</Text>
                <Text style={styles.paragraph}>
                    To access certain features, you may be required to create an account.
                </Text>
                <Text style={styles.paragraph}>
                    You agree to:
                </Text>
                <Text style={styles.bulletPoint}>• Provide accurate and up‑to‑date information</Text>
                <Text style={styles.bulletPoint}>• Keep your login credentials secure</Text>
                <Text style={styles.bulletPoint}>• Be fully responsible for all activity under your account</Text>
                <Text style={styles.paragraph}>
                    Planera reserves the right to suspend or terminate accounts that violate these Terms.
                </Text>

                <Text style={styles.heading}>4. Use of the Service</Text>
                <Text style={styles.paragraph}>
                    You agree not to:
                </Text>
                <Text style={styles.bulletPoint}>• Use Planera for unlawful or fraudulent purposes</Text>
                <Text style={styles.bulletPoint}>• Attempt to interfere with or disrupt the Service or its systems</Text>
                <Text style={styles.bulletPoint}>• Copy, reverse‑engineer, or exploit the Service without authorization</Text>
                <Text style={styles.bulletPoint}>• Use automated systems (bots, scrapers) without prior written permission</Text>
                <Text style={styles.paragraph}>
                    Planera may modify, suspend, or discontinue any part of the Service at any time.
                </Text>

                <Text style={styles.heading}>5. AI‑Generated Content Disclaimer</Text>
                <Text style={styles.paragraph}>
                    The itineraries, recommendations, prices, availability, and travel information provided by Planera are <Text style={styles.bold}>AI‑generated and informational only</Text>.
                </Text>
                <Text style={styles.bulletPoint}>• Information may be incomplete, outdated, or inaccurate</Text>
                <Text style={styles.bulletPoint}>• Prices and availability are not guaranteed</Text>
                <Text style={styles.bulletPoint}>• Travel conditions, visa rules, safety regulations, and local laws may change</Text>
                <Text style={styles.paragraph}>
                    You are solely responsible for:
                </Text>
                <Text style={styles.bulletPoint}>• Verifying all travel details before booking</Text>
                <Text style={styles.bulletPoint}>• Ensuring compliance with visa, health, and entry requirements</Text>
                <Text style={styles.bulletPoint}>• Making final travel decisions</Text>

                <Text style={styles.heading}>6. Third‑Party Services & Links</Text>
                <Text style={styles.paragraph}>
                    Planera integrates or links to third‑party services. These services are governed by their own terms and privacy policies.
                </Text>
                <Text style={styles.paragraph}>
                    Planera:
                </Text>
                <Text style={styles.bulletPoint}>• Is not responsible for third‑party content, availability, pricing, or services</Text>
                <Text style={styles.bulletPoint}>• Does not guarantee bookings, refunds, or customer support from third parties</Text>
                <Text style={styles.paragraph}>
                    Any disputes must be resolved directly with the relevant provider.
                </Text>

                <Text style={styles.heading}>7. Payments & Subscriptions</Text>
                <Text style={styles.paragraph}>
                    If Planera offers paid features or subscriptions:
                </Text>
                <Text style={styles.bulletPoint}>• Fees will be clearly displayed before purchase</Text>
                <Text style={styles.bulletPoint}>• Payments are processed via third‑party payment providers</Text>
                <Text style={styles.bulletPoint}>• Subscriptions may renew automatically unless canceled</Text>
                <Text style={styles.paragraph}>
                    Refund policies (if any) will be stated at the point of purchase.
                </Text>

                <Text style={styles.heading}>8. Intellectual Property</Text>
                <Text style={styles.paragraph}>
                    All content, branding, software, design, and AI outputs provided by Planera are the intellectual property of <Text style={styles.bold}>Planera</Text> or its licensors.
                </Text>
                <Text style={styles.paragraph}>
                    You are granted a <Text style={styles.bold}>limited, non‑exclusive, non‑transferable license</Text> to use the Service for personal, non‑commercial purposes.
                </Text>
                <Text style={styles.paragraph}>
                    You may not reproduce, distribute, or exploit Planera content without prior written consent.
                </Text>

                <Text style={styles.heading}>9. User Content</Text>
                <Text style={styles.paragraph}>
                    If you submit content (such as reviews, feedback, or suggestions), you grant Planera a worldwide, royalty‑free license to use, display, and improve the Service based on that content.
                </Text>
                <Text style={styles.paragraph}>
                    You confirm that your content:
                </Text>
                <Text style={styles.bulletPoint}>• Does not violate any laws or third‑party rights</Text>
                <Text style={styles.bulletPoint}>• Is not misleading, abusive, or defamatory</Text>

                <Text style={styles.heading}>10. Limitation of Liability</Text>
                <Text style={styles.paragraph}>
                    To the maximum extent permitted by law:
                </Text>
                <Text style={styles.paragraph}>
                    Planera shall <Text style={styles.bold}>not be liable</Text> for:
                </Text>
                <Text style={styles.bulletPoint}>• Travel disruptions, cancellations, delays, or losses</Text>
                <Text style={styles.bulletPoint}>• Injuries, damages, or expenses related to travel</Text>
                <Text style={styles.bulletPoint}>• Errors or omissions in AI‑generated content</Text>
                <Text style={styles.bulletPoint}>• Acts or omissions of third‑party providers</Text>
                <Text style={styles.paragraph}>
                    Use of the Service is at your own risk.
                </Text>

                <Text style={styles.heading}>11. Disclaimer of Warranties</Text>
                <Text style={styles.paragraph}>
                    The Service is provided <Text style={styles.bold}>"as is" and "as available"</Text>, without warranties of any kind, express or implied.
                </Text>
                <Text style={styles.paragraph}>
                    Planera does not guarantee uninterrupted access, accuracy, or suitability for your specific travel needs.
                </Text>

                <Text style={styles.heading}>12. Indemnification</Text>
                <Text style={styles.paragraph}>
                    You agree to indemnify and hold harmless Planera from any claims, damages, or expenses arising out of:
                </Text>
                <Text style={styles.bulletPoint}>• Your use of the Service</Text>
                <Text style={styles.bulletPoint}>• Your violation of these Terms</Text>
                <Text style={styles.bulletPoint}>• Your interactions with third‑party providers</Text>

                <Text style={styles.heading}>13. Termination</Text>
                <Text style={styles.paragraph}>
                    Planera may suspend or terminate your access at any time if you breach these Terms or misuse the Service.
                </Text>
                <Text style={styles.paragraph}>
                    Upon termination, your right to use the Service will immediately cease.
                </Text>

                <Text style={styles.heading}>14. Privacy</Text>
                <Text style={styles.paragraph}>
                    Your use of Planera is also governed by our <Text style={styles.bold}>Privacy Policy</Text>, which explains how we collect, use, and protect your data.
                </Text>

                <Text style={styles.heading}>15. Governing Law</Text>
                <Text style={styles.paragraph}>
                    These Terms shall be governed by and construed in accordance with the laws of <Text style={styles.bold}>Greece</Text>, without regard to conflict of law principles.
                </Text>
                <Text style={styles.paragraph}>
                    Any disputes shall be subject to the exclusive jurisdiction of the competent courts.
                </Text>

                <Text style={styles.heading}>16. Changes to These Terms</Text>
                <Text style={styles.paragraph}>
                    Planera may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the revised Terms.
                </Text>

                <Text style={styles.heading}>17. Contact</Text>
                <Text style={styles.paragraph}>
                    For questions or support, contact us at:
                </Text>
                <Text style={styles.contactEmail}>📧 support@planeraai.app</Text>

                <Text style={styles.footer}>
                    <Text style={styles.bold}>Planera</Text> – Travel smarter. Plan better.
                </Text>

                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "700",
        color: COLORS.text,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    lastUpdated: {
        fontSize: 12,
        color: COLORS.textMuted,
        marginBottom: 24,
        fontStyle: "italic",
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: "800",
        color: COLORS.text,
        marginBottom: 16,
    },
    heading: {
        fontSize: 16,
        fontWeight: "700",
        color: COLORS.text,
        marginTop: 20,
        marginBottom: 12,
    },
    paragraph: {
        fontSize: 14,
        lineHeight: 22,
        color: COLORS.textSecondary,
        marginBottom: 12,
    },
    bulletPoint: {
        fontSize: 14,
        lineHeight: 22,
        color: COLORS.textSecondary,
        marginLeft: 16,
        marginBottom: 8,
    },
    bold: {
        fontWeight: "700",
        color: COLORS.text,
    },
    contactEmail: {
        fontSize: 14,
        color: COLORS.primary,
        fontWeight: "600",
        marginTop: 8,
        marginBottom: 24,
    },
    footer: {
        fontSize: 14,
        color: COLORS.textMuted,
        textAlign: "center",
        marginTop: 32,
        marginBottom: 16,
        lineHeight: 22,
    },
});
