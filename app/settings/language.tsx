import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";

export default function Language() {
    const router = useRouter();
    const settings = useQuery(api.users.getSettings);
    const updateAppSettings = useMutation(api.users.updateAppSettings);

    const [selectedLanguage, setSelectedLanguage] = useState("en");
    const [selectedCurrency, setSelectedCurrency] = useState("USD");

    useEffect(() => {
        if (settings) {
            setSelectedLanguage(settings.language || "en");
            setSelectedCurrency(settings.currency || "USD");
        }
    }, [settings]);

    const handleSave = async () => {
        try {
            await updateAppSettings({
                language: selectedLanguage,
                currency: selectedCurrency,
            });
            Alert.alert("Success", "Language and currency updated successfully!");
            router.back();
        } catch (error) {
            console.error("Update failed:", error);
            Alert.alert("Error", "Failed to update settings");
        }
    };

    if (settings === undefined) {
        return (
            <SafeAreaView style={styles.container}>
                <Text>Loading...</Text>
            </SafeAreaView>
        );
    }

    const languages = [
        { code: "en", name: "English", flag: "🇬🇧" },
        { code: "es", name: "Español", flag: "🇪🇸" },
        { code: "fr", name: "Français", flag: "🇫🇷" },
        { code: "de", name: "Deutsch", flag: "🇩🇪" },
        { code: "it", name: "Italiano", flag: "🇮🇹" },
        { code: "pt", name: "Português", flag: "🇵🇹" },
        { code: "nl", name: "Nederlands", flag: "🇳🇱" },
        { code: "pl", name: "Polski", flag: "🇵🇱" },
        { code: "ru", name: "Русский", flag: "🇷🇺" },
        { code: "ja", name: "日本語", flag: "🇯🇵" },
        { code: "zh", name: "中文", flag: "🇨🇳" },
        { code: "ar", name: "العربية", flag: "🇸🇦" },
    ];

    const currencies = [
        { code: "USD", name: "US Dollar", symbol: "$" },
        { code: "EUR", name: "Euro", symbol: "€" },
        { code: "GBP", name: "British Pound", symbol: "£" },
        { code: "JPY", name: "Japanese Yen", symbol: "¥" },
        { code: "AUD", name: "Australian Dollar", symbol: "A$" },
        { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
        { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
        { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
        { code: "INR", name: "Indian Rupee", symbol: "₹" },
        { code: "BRL", name: "Brazilian Real", symbol: "R$" },
    ];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#1B3F92" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Language & Currency</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content}>
                {/* Language Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Language</Text>
                    <View style={styles.listContainer}>
                        {languages.map((language) => (
                            <TouchableOpacity
                                key={language.code}
                                style={styles.listItem}
                                onPress={() => setSelectedLanguage(language.code)}
                            >
                                <Text style={styles.flag}>{language.flag}</Text>
                                <Text style={styles.listItemText}>{language.name}</Text>
                                {selectedLanguage === language.code && (
                                    <Ionicons name="checkmark-circle" size={24} color="#1B3F92" />
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Currency Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Currency</Text>
                    <View style={styles.listContainer}>
                        {currencies.map((currency) => (
                            <TouchableOpacity
                                key={currency.code}
                                style={styles.listItem}
                                onPress={() => setSelectedCurrency(currency.code)}
                            >
                                <Text style={styles.currencySymbol}>{currency.symbol}</Text>
                                <View style={styles.currencyInfo}>
                                    <Text style={styles.listItemText}>{currency.name}</Text>
                                    <Text style={styles.currencyCode}>{currency.code}</Text>
                                </View>
                                {selectedCurrency === currency.code && (
                                    <Ionicons name="checkmark-circle" size={24} color="#1B3F92" />
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F6F8',
    },
    header: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 20,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1B3F92',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#37474F',
        marginBottom: 12,
    },
    listContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F5F5F5',
    },
    flag: {
        fontSize: 24,
        marginRight: 12,
    },
    currencySymbol: {
        fontSize: 20,
        fontWeight: '600',
        color: '#1B3F92',
        width: 40,
        textAlign: 'center',
        marginRight: 12,
    },
    currencyInfo: {
        flex: 1,
    },
    listItemText: {
        fontSize: 16,
        color: '#37474F',
        flex: 1,
    },
    currencyCode: {
        fontSize: 13,
        color: '#78909C',
        marginTop: 2,
    },
    saveButton: {
        backgroundColor: '#1B3F92',
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        marginBottom: 40,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});
