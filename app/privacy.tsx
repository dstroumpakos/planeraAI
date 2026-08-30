import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('privacy.title')}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.updated}>{t('privacy.lastUpdated')}</Text>

                <Text style={styles.intro}>
                    {t('privacy.intro')}
                </Text>

                <Section title={t('privacy.s1Title')}>
                    <Text style={styles.text}>{t('privacy.s1Text')}</Text>
                    <Text style={styles.contact}>{t('privacy.s1Contact')}</Text>
                </Section>

                <Section title={t('privacy.s2Title')}>
                    <Text style={styles.subtitle}>{t('privacy.s2_1Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s2_1Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b4')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b5')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b6')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s2_1b7')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s2_2Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s2_2Text')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s2_3Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s2_3Text')}</Text>
                </Section>

                <Section title={t('privacy.s3Title')}>
                    <Text style={styles.text}>{t('privacy.s3Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b4')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b5')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b6')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s3b7')}</Text>
                    <Text style={styles.text}>{t('privacy.s3NoSell')}</Text>
                </Section>

                <Section title={t('privacy.s4Title')}>
                    <Text style={styles.text}>{t('privacy.s4Text')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s4_1Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s4_1Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b4')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b5')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b6')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_1b7')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s4_2Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s4_2Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_2b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_2b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_2b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s4_2b4')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s4_3Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s4_3Text')}</Text>

                    <Text style={styles.subtitle}>{t('privacy.s4_4Title')}</Text>
                    <Text style={styles.text}>{t('privacy.s4_4Text')}</Text>
                </Section>

                <Section title={t('privacy.s5Title')}>
                    <Text style={styles.text}>{t('privacy.s5Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s5b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s5b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s5b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s5b4')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s5b5')}</Text>
                    <Text style={styles.text}>{t('privacy.s5Text2')}</Text>
                </Section>

                <Section title={t('privacy.s6Title')}>
                    <Text style={styles.text}>{t('privacy.s6p1')}</Text>
                    <Text style={styles.text}>{t('privacy.s6p2')}</Text>
                    <Text style={styles.text}>{t('privacy.s6p3')}</Text>
                </Section>

                <Section title={t('privacy.s7Title')}>
                    <Text style={styles.text}>{t('privacy.s7Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s7b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s7b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s7b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s7b4')}</Text>
                    <Text style={styles.text}>{t('privacy.s7Text2')}</Text>
                </Section>

                <Section title={t('privacy.s8Title')}>
                    <Text style={styles.text}>{t('privacy.s8p1')}</Text>
                    <Text style={styles.text}>{t('privacy.s8p2')}</Text>
                </Section>

                <Section title={t('privacy.s9Title')}>
                    <Text style={styles.text}>{t('privacy.s9Text')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s9b1')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s9b2')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s9b3')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s9b4')}</Text>
                    <Text style={styles.bullet}>{t('privacy.s9b5')}</Text>
                    <Text style={styles.text}>{t('privacy.s9Text2')}</Text>
                </Section>

                <Section title={t('privacy.s10Title')}>
                    <Text style={styles.text}>{t('privacy.s10Text')}</Text>
                </Section>

                <Section title={t('privacy.s11Title')}>
                    <Text style={styles.text}>{t('privacy.s11Text')}</Text>
                </Section>

                <Section title={t('privacy.s12aTitle')}>
                    <Text style={styles.text}>{t('privacy.s12aP1')}</Text>
                    <Text style={styles.text}>{t('privacy.s12aP2')}</Text>
                    <Text style={styles.text}>{t('privacy.s12aP3')}</Text>
                </Section>

                <Section title={t('privacy.s12bTitle')}>
                    <Text style={styles.text}>{t('privacy.s12bP1')}</Text>
                    <Text style={styles.text}>{t('privacy.s12bP2')}</Text>
                    <Text style={styles.text}>{t('privacy.s12bP3')}</Text>
                </Section>

                <Section title={t('privacy.s12Title')}>
                    <Text style={styles.text}>{t('privacy.s12p1')}</Text>
                    <Text style={styles.text}>{t('privacy.s12p2')}</Text>
                </Section>

                <Section title={t('privacy.s13Title')}>
                    <Text style={styles.text}>{t('privacy.s13Text')}</Text>
                    <Text style={styles.contact}>{t('privacy.s13Contact')}</Text>
                </Section>

                <Text style={styles.footer}>{t('privacy.footer')}</Text>
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
