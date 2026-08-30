import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('terms.title')}</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.lastUpdated}>{t('terms.lastUpdated')}</Text>

                <Text style={styles.sectionTitle}>{t('terms.eulaTitle')}</Text>

                <Text style={styles.paragraph}>
                    {t('terms.p1')}
                </Text>

                <Text style={styles.paragraph}>
                    {t('terms.p2intro')}
                </Text>

                <Text style={styles.heading}>{t('terms.h1')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h1p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h1p2')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h1p3')}
                </Text>

                <Text style={styles.heading}>{t('terms.h2')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h2p1')}
                </Text>

                <Text style={styles.heading}>{t('terms.h3')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h3p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h3p2')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h3b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h3b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h3b3')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h3p3')}
                </Text>

                <Text style={styles.heading}>{t('terms.h4')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h4p1')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b3')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b4')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b5')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h4b6')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h4p2')}
                </Text>

                <Text style={styles.heading}>{t('terms.h5')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h5p1')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b3')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b7')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h5p2')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b4')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b5')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h5b6')}</Text>

                <Text style={styles.heading}>{t('terms.h6')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h6p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h6p2')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h6b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h6b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h6b3')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h6p3')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h6p4')}
                </Text>

                <Text style={styles.heading}>{t('terms.h7')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h7p1')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b3')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b4')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b5')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h7b6')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h7p2')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h7p3')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h7p4')}
                </Text>

                <Text style={styles.heading}>{t('terms.h8')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h8p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h8p2')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h8p3')}
                </Text>

                <Text style={styles.heading}>{t('terms.h9')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h9p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h9p2')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h9b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h9b2')}</Text>

                <Text style={styles.heading}>{t('terms.h10')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h10p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h10p2')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h10b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h10b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h10b3')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h10b4')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h10p3')}
                </Text>

                <Text style={styles.heading}>{t('terms.h11')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h11p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h11p2')}
                </Text>

                <Text style={styles.heading}>{t('terms.h12')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h12p1')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h12b1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h12b2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h12b3')}</Text>

                <Text style={styles.heading}>{t('terms.h13')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h13p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h13p2')}
                </Text>

                <Text style={styles.heading}>{t('terms.h13aTitle')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h13aP1')}
                </Text>
                <Text style={styles.bulletPoint}>{t('terms.h13aB1')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h13aB2')}</Text>
                <Text style={styles.bulletPoint}>{t('terms.h13aB3')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h13aP2')}
                </Text>

                <Text style={styles.heading}>{t('terms.h14')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h14p1')}
                </Text>

                <Text style={styles.heading}>{t('terms.h15')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h15p1')}
                </Text>
                <Text style={styles.paragraph}>
                    {t('terms.h15p2')}
                </Text>

                <Text style={styles.heading}>{t('terms.h16')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h16p1')}
                </Text>

                <Text style={styles.heading}>{t('terms.h17')}</Text>
                <Text style={styles.paragraph}>
                    {t('terms.h17p1')}
                </Text>
                <Text style={styles.contactEmail}>{t('terms.h17Contact')}</Text>

                <Text style={styles.footer}>
                    {t('terms.footer')}
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
