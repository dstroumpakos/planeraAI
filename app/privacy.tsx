import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

const COLORS = {
    primary: "#FFE500",
    background: "#FAF9F6",
    text: "#1A1A1A",
    textSecondary: "#6B6B6B",
    textMuted: "#9B9B9B",
    border: "#E8E6E1",
};

export default function PrivacyPolicy() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Privacy Policy</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.updated}>Last updated: February 2026</Text>

                <Text style={styles.intro}>
                    Planera respects your privacy and is committed to protecting your personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the Planera mobile application and related services.
                </Text>

                <Section title="1. Who We Are">
                    <Text style={styles.text}>Planera is an AI-powered travel planning platform that provides personalized travel itineraries and recommendations. Planera does not operate as a travel agency and does not process travel bookings directly.</Text>
                    <Text style={styles.contact}>📧 privacy@planeraai.app</Text>
                </Section>

                <Section title="2. Information We Collect">
                    <Text style={styles.subtitle}>2.1 Information You Provide</Text>
                    <Text style={styles.text}>We may collect information you voluntarily provide, including:</Text>
                    <Text style={styles.bullet}>• Name or username</Text>
                    <Text style={styles.bullet}>• Email address</Text>
                    <Text style={styles.bullet}>• Account login details</Text>
                    <Text style={styles.bullet}>• Travel preferences (destinations, dates, budget, interests)</Text>
                    <Text style={styles.bullet}>• Feedback, reviews, or support messages</Text>

                    <Text style={styles.subtitle}>2.2 Automatically Collected Information</Text>
                    <Text style={styles.text}>When you use the Service, we may automatically collect limited technical data such as crash logs and basic diagnostics to improve app stability and performance.</Text>

                    <Text style={styles.subtitle}>2.3 Third-Party Data</Text>
                    <Text style={styles.text}>Planera may receive limited data from third-party services (such as analytics, authentication, or payment providers), in accordance with their privacy policies.</Text>
                </Section>

                <Section title="3. How We Use Your Information">
                    <Text style={styles.text}>We use your information to:</Text>
                    <Text style={styles.bullet}>• Provide and improve the Service</Text>
                    <Text style={styles.bullet}>• Generate personalized AI-based travel plans</Text>
                    <Text style={styles.bullet}>• Communicate with you (support, updates, important notices)</Text>
                    <Text style={styles.bullet}>• Monitor usage and improve performance</Text>
                    <Text style={styles.bullet}>• Ensure security and prevent fraud</Text>
                    <Text style={styles.text}>We do not sell your personal data.</Text>
                </Section>

                <Section title="4. AI & Automated Processing — Third-Party AI Service">
                    <Text style={styles.text}>Planera uses AI systems provided by OpenAI, Inc. (San Francisco, CA, USA) to generate personalized travel itineraries, recommend sights and attractions, and power the Atlas travel assistant.</Text>

                    <Text style={styles.subtitle}>4.1 What Data Is Sent to OpenAI</Text>
                    <Text style={styles.text}>When you use AI-powered features, the following data may be transmitted to OpenAI's API:</Text>
                    <Text style={styles.bullet}>• Trip destinations and origin city</Text>
                    <Text style={styles.bullet}>• Trip dates, arrival time, and departure time</Text>
                    <Text style={styles.bullet}>• Budget amount and number of travelers</Text>
                    <Text style={styles.bullet}>• Travel interests and local experience preferences</Text>
                    <Text style={styles.bullet}>• Messages you send to the Atlas travel assistant</Text>

                    <Text style={styles.subtitle}>4.2 What Data Is NOT Sent to OpenAI</Text>
                    <Text style={styles.text}>We do not send the following personal data to OpenAI or any other third-party AI service:</Text>
                    <Text style={styles.bullet}>• Your name, email address, or account credentials</Text>
                    <Text style={styles.bullet}>• Payment or billing information</Text>
                    <Text style={styles.bullet}>• Profile picture or photos</Text>

                    <Text style={styles.subtitle}>4.3 Purpose and Safeguards</Text>
                    <Text style={styles.text}>Data is sent to OpenAI solely to generate AI-powered travel content. OpenAI processes data in accordance with their API data usage policy and does not use API inputs to train their models. AI outputs are automated and informational only — no automated decisions produce legal or similarly significant effects, and you remain in full control of your travel decisions.</Text>

                    <Text style={styles.subtitle}>4.4 Your Consent</Text>
                    <Text style={styles.text}>Before any data is sent to OpenAI, Planera will request your explicit consent. You may grant or withdraw this consent at any time via Settings → Travel Preferences. If you decline consent, AI-powered features (trip generation, sights recommendations, and Atlas chat) will be unavailable, but all other app features will continue to work normally.</Text>
                </Section>

                <Section title="5. Sharing of Information">
                    <Text style={styles.text}>We may share your information only:</Text>
                    <Text style={styles.bullet}>• With OpenAI, Inc. — to provide AI-powered travel planning features (see Section 4 above)</Text>
                    <Text style={styles.bullet}>• With trusted service providers (hosting, analytics, email, payments)</Text>
                    <Text style={styles.bullet}>• To comply with legal obligations</Text>
                    <Text style={styles.bullet}>• To protect our rights, users, or the security of the Service</Text>
                    <Text style={styles.text}>All third-party partners are required to handle data securely and lawfully. OpenAI's data processing is governed by their API data usage policy, which does not permit use of API data for model training.</Text>
                </Section>

                <Section title="6. Third-Party Links & Services">
                    <Text style={styles.text}>Planera may contain links to third-party websites or services (e.g. airlines, hotels, booking platforms).</Text>
                    <Text style={styles.text}>We are not responsible for the privacy practices or content of third-party services. You should review their privacy policies before providing personal data.</Text>
                </Section>

                <Section title="7. Data Retention">
                    <Text style={styles.text}>We retain personal data only for as long as necessary to:</Text>
                    <Text style={styles.bullet}>• Provide the Service</Text>
                    <Text style={styles.bullet}>• Comply with legal obligations</Text>
                    <Text style={styles.bullet}>• Resolve disputes and enforce agreements</Text>
                    <Text style={styles.text}>You may request deletion of your account and associated personal data by contacting us at privacy@planeraai.app.</Text>
                </Section>

                <Section title="8. Data Security">
                    <Text style={styles.text}>We implement appropriate technical and organizational measures to protect your personal data.</Text>
                    <Text style={styles.text}>However, no system is completely secure, and we cannot guarantee absolute security.</Text>
                </Section>

                <Section title="9. Your Rights (GDPR)">
                    <Text style={styles.text}>If you are located in the European Economic Area (EEA), you have the right to:</Text>
                    <Text style={styles.bullet}>• Access your personal data</Text>
                    <Text style={styles.bullet}>• Request correction or deletion</Text>
                    <Text style={styles.bullet}>• Restrict or object to processing</Text>
                    <Text style={styles.bullet}>• Request data portability</Text>
                    <Text style={styles.bullet}>• Withdraw consent at any time</Text>
                    <Text style={styles.text}>To exercise your rights, contact us at privacy@planeraai.app.</Text>
                </Section>

                <Section title="10. Children's Privacy">
                    <Text style={styles.text}>Planera is not intended for users under the age of 18. We do not knowingly collect personal data from children.</Text>
                </Section>

                <Section title="11. International Data Transfers">
                    <Text style={styles.text}>Your data may be processed or stored on servers located outside your country. We ensure appropriate safeguards are in place in accordance with applicable data protection laws.</Text>
                </Section>

                <Section title="12. Changes to This Privacy Policy">
                    <Text style={styles.text}>We may update this Privacy Policy from time to time. Any changes will be posted within the Service.</Text>
                    <Text style={styles.text}>Continued use of Planera after updates constitutes acceptance of the revised Privacy Policy.</Text>
                </Section>

                <Section title="13. Contact Us">
                    <Text style={styles.text}>If you have any questions or concerns about this Privacy Policy or your data, contact us at:</Text>
                    <Text style={styles.contact}>📧 privacy@planeraai.app</Text>
                </Section>

                <Text style={styles.footer}>Planera – Your journey, planned with intelligence.</Text>
            </ScrollView>
        </SafeAreaView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
        backgroundColor: COLORS.background,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 24,
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
        paddingHorizontal: 24,
        paddingVertical: 24,
        paddingBottom: 40,
    },
    updated: {
        fontSize: 12,
        color: COLORS.textMuted,
        marginBottom: 24,
        fontStyle: "italic",
    },
    intro: {
        fontSize: 14,
        color: COLORS.textSecondary,
        lineHeight: 22,
        marginBottom: 24,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: COLORS.text,
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 14,
        fontWeight: "600",
        color: COLORS.text,
        marginBottom: 8,
        marginTop: 12,
    },
    text: {
        fontSize: 14,
        color: COLORS.textSecondary,
        lineHeight: 22,
        marginBottom: 12,
    },
    bullet: {
        fontSize: 14,
        color: COLORS.textSecondary,
        lineHeight: 22,
        marginBottom: 6,
        marginLeft: 8,
    },
    contact: {
        fontSize: 14,
        color: COLORS.text,
        fontWeight: "600",
        marginTop: 8,
    },
    footer: {
        fontSize: 14,
        color: COLORS.textSecondary,
        textAlign: "center",
        marginTop: 32,
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        lineHeight: 22,
    },
});
