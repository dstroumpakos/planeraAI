import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Alert, TextInput, Modal, FlatList, Keyboard } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToken, useAuthenticatedMutation } from "@/lib/useAuthenticatedMutation";
import { useTheme } from "@/lib/ThemeContext";
import { useTranslation } from "react-i18next";
import { useState, useMemo, useCallback } from "react";
import { CITY_TRANSLATIONS, COUNTRY_TRANSLATIONS } from "@/lib/destinationTranslations";

const PRIORITY_OPTIONS = [
  { id: "dream", icon: "sparkles", color: "#F59E0B" },
  { id: "planned", icon: "calendar", color: "#3B82F6" },
  { id: "someday", icon: "time", color: "#8B5CF6" },
];

export default function Wishlist() {
  const router = useRouter();
  const { token } = useToken();
  const { isDarkMode, colors } = useTheme();
  const { t } = useTranslation();

  const wishlistData = useQuery(api.wishlist.getWishlist as any, token ? { token } : "skip");
  const addToWishlist = useAuthenticatedMutation(api.wishlist.addToWishlist as any);
  const removeFromWishlist = useAuthenticatedMutation(api.wishlist.removeFromWishlist as any);
  const updateItem = useAuthenticatedMutation(api.wishlist.updateWishlistItem as any);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newDestination, setNewDestination] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPriority, setNewPriority] = useState<"dream" | "planned" | "someday">("someday");
  const [filter, setFilter] = useState<string>("all");
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false);

  const { i18n } = useTranslation();
  const lang = i18n.language;

  const getLocalizedName = useCallback((englishName: string, translations: Record<string, Record<string, string>>) => {
    const entry = translations[englishName];
    if (!entry) return englishName;
    if (lang === "en") return englishName;
    return entry[lang] || englishName;
  }, [lang]);

  const filterSuggestions = useCallback((input: string, translations: Record<string, Record<string, string>>) => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.length < 1) return [];
    const results: { english: string; display: string }[] = [];
    for (const [englishName, langs] of Object.entries(translations)) {
      const display = lang === "en" ? englishName : (langs[lang] || englishName);
      if (
        englishName.toLowerCase().startsWith(trimmed) ||
        display.toLowerCase().startsWith(trimmed) ||
        Object.values(langs).some(v => v.toLowerCase().startsWith(trimmed))
      ) {
        results.push({ english: englishName, display });
      }
      if (results.length >= 8) break;
    }
    return results;
  }, [lang]);

  const citySuggestions = useMemo(() =>
    showCitySuggestions ? filterSuggestions(newDestination, CITY_TRANSLATIONS) : [],
    [newDestination, showCitySuggestions, filterSuggestions]
  );

  const countrySuggestions = useMemo(() =>
    showCountrySuggestions ? filterSuggestions(newCountry, COUNTRY_TRANSLATIONS) : [],
    [newCountry, showCountrySuggestions, filterSuggestions]
  );

  const items = wishlistData?.items || [];
  const filtered = filter === "all" ? items : items.filter((i: any) => i.priority === filter);

  const handleAdd = async () => {
    if (!newDestination.trim()) {
      Alert.alert(t("common.error"), t("wishlist.enterDestination"));
      return;
    }

    // Translate localized city/country names to English
    const resolveEnglishName = (input: string, translations: Record<string, Record<string, string>>): string => {
      const lower = input.trim().toLowerCase();
      for (const [englishName, langs] of Object.entries(translations)) {
        if (englishName.toLowerCase() === lower) return englishName;
        if (Object.values(langs).some(v => v.toLowerCase() === lower)) return englishName;
      }
      return input.trim();
    };

    const destination = resolveEnglishName(newDestination, CITY_TRANSLATIONS);
    const country = newCountry.trim() ? resolveEnglishName(newCountry, COUNTRY_TRANSLATIONS) : undefined;

    const result = await addToWishlist({
      destination,
      country,
      notes: newNotes.trim() || undefined,
      priority: newPriority,
    });
    if (result?.success === false) {
      if (result.reason === "limit_reached") {
        Alert.alert(t("wishlist.limitReached"), t("wishlist.upgradeToPremium"));
      } else if (result.reason === "already_in_wishlist") {
        Alert.alert(t("common.error"), t("wishlist.alreadyAdded"));
      }
      return;
    }
    resetForm();
    setShowAddModal(false);
  };

  const handleRemove = (id: string) => {
    Alert.alert(t("wishlist.removeTitle"), t("wishlist.removeConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => removeFromWishlist({ id }),
      },
    ]);
  };

  const handleToggleDealAlert = async (item: any) => {
    await updateItem({ id: item._id, dealAlertEnabled: !item.dealAlertEnabled });
  };

  const resetForm = () => {
    setNewDestination("");
    setNewCountry("");
    setNewNotes("");
    setNewPriority("someday");
    setShowCitySuggestions(false);
    setShowCountrySuggestions(false);
  };

  const getPriorityInfo = (priority: string) =>
    PRIORITY_OPTIONS.find((p) => p.id === priority) || PRIORITY_OPTIONS[2];

  const styles = createStyles(colors, isDarkMode);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("wishlist.title")}</Text>
          <TouchableOpacity onPress={() => setShowAddModal(true)}>
            <Ionicons name="add-circle" size={28} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Limit indicator */}
        {wishlistData?.limit && (
          <View style={styles.limitBar}>
            <Text style={styles.limitText}>
              {t("wishlist.slots", { used: wishlistData.count, total: wishlistData.limit })}
            </Text>
            {!wishlistData.isPremium && (
              <TouchableOpacity onPress={() => router.push("/subscription")}>
                <Text style={styles.upgradeLink}>{t("wishlist.getUnlimited")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Filter tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          <TouchableOpacity
            style={[styles.filterTab, filter === "all" && styles.filterTabActive]}
            onPress={() => setFilter("all")}
          >
            <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>{t("achievements.all")}</Text>
          </TouchableOpacity>
          {PRIORITY_OPTIONS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.filterTab, filter === p.id && styles.filterTabActive]}
              onPress={() => setFilter(p.id)}
            >
              <Ionicons name={p.icon as any} size={14} color={filter === p.id ? colors.text : colors.textMuted} />
              <Text style={[styles.filterText, filter === p.id && styles.filterTextActive]}>
                {t(`wishlist.${p.id}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{t("wishlist.empty")}</Text>
              <Text style={styles.emptySubtitle}>{t("wishlist.emptySubtitle")}</Text>
            </View>
          ) : (
            filtered.map((item: any) => {
              const priorityInfo = getPriorityInfo(item.priority);
              return (
                <View key={item._id} style={styles.wishlistCard}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.priorityBadge, { backgroundColor: priorityInfo.color + "20" }]}>
                      <Ionicons name={priorityInfo.icon as any} size={14} color={priorityInfo.color} />
                      <Text style={[styles.priorityText, { color: priorityInfo.color }]}>
                        {t(`wishlist.${item.priority}`)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleRemove(item._id)}>
                      <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.destination}>{item.destination}</Text>
                  {item.country && <Text style={styles.country}>{item.country}</Text>}
                  {item.notes && <Text style={styles.notes}>{item.notes}</Text>}
                  <View style={styles.cardFooter}>
                    <TouchableOpacity
                      style={[styles.dealAlertToggle, item.dealAlertEnabled && styles.dealAlertActive]}
                      onPress={() => handleToggleDealAlert(item)}
                    >
                      <Ionicons
                        name={item.dealAlertEnabled ? "notifications" : "notifications-outline"}
                        size={14}
                        color={item.dealAlertEnabled ? colors.primary : colors.textMuted}
                      />
                      <Text style={[styles.dealAlertText, item.dealAlertEnabled && { color: colors.primary }]}>
                        {t("wishlist.dealAlerts")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.planButton}
                      onPress={() =>
                        router.push({
                          pathname: "/create-trip",
                          params: { prefilledDestination: item.destination },
                        } as any)
                      }
                    >
                      <Text style={styles.planButtonText}>{t("wishlist.planTrip")}</Text>
                      <Ionicons name="arrow-forward" size={14} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Add Modal */}
        <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
          <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t("wishlist.addDestination")}</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              <Text style={styles.fieldLabel}>{t("wishlist.destinationName")}</Text>
              <View style={{ zIndex: 2 }}>
                <TextInput
                  style={styles.input}
                  placeholder={t("wishlist.destinationPlaceholder")}
                  placeholderTextColor={colors.textMuted}
                  value={newDestination}
                  onChangeText={(text) => {
                    setNewDestination(text);
                    setShowCitySuggestions(true);
                  }}
                  onFocus={() => setShowCitySuggestions(true)}
                />
                {citySuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {citySuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.english}
                        style={styles.suggestionItem}
                        onPress={() => {
                          setNewDestination(item.display);
                          setShowCitySuggestions(false);
                          Keyboard.dismiss();
                        }}
                      >
                        <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                        <Text style={styles.suggestionText}>{item.display}</Text>
                        {item.display !== item.english && (
                          <Text style={styles.suggestionSubtext}>{item.english}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <Text style={styles.fieldLabel}>{t("wishlist.countryOptional")}</Text>
              <View style={{ zIndex: 1 }}>
                <TextInput
                  style={styles.input}
                  placeholder={t("wishlist.countryPlaceholder")}
                  placeholderTextColor={colors.textMuted}
                  value={newCountry}
                  onChangeText={(text) => {
                    setNewCountry(text);
                    setShowCountrySuggestions(true);
                  }}
                  onFocus={() => setShowCountrySuggestions(true)}
                />
                {countrySuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {countrySuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.english}
                        style={styles.suggestionItem}
                        onPress={() => {
                          setNewCountry(item.display);
                          setShowCountrySuggestions(false);
                          Keyboard.dismiss();
                        }}
                      >
                        <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
                        <Text style={styles.suggestionText}>{item.display}</Text>
                        {item.display !== item.english && (
                          <Text style={styles.suggestionSubtext}>{item.english}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <Text style={styles.fieldLabel}>{t("wishlist.priority")}</Text>
              <View style={styles.priorityRow}>
                {PRIORITY_OPTIONS.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.priorityOption, newPriority === p.id && { borderColor: p.color, backgroundColor: p.color + "15" }]}
                    onPress={() => setNewPriority(p.id as any)}
                  >
                    <Ionicons name={p.icon as any} size={18} color={newPriority === p.id ? p.color : colors.textMuted} />
                    <Text style={[styles.priorityOptionText, newPriority === p.id && { color: p.color }]}>
                      {t(`wishlist.${p.id}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t("wishlist.notesOptional")}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t("wishlist.notesPlaceholder")}
                placeholderTextColor={colors.textMuted}
                value={newNotes}
                onChangeText={setNewNotes}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
                <Ionicons name="heart" size={18} color={colors.text} />
                <Text style={styles.addButtonText}>{t("wishlist.addToWishlist")}</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },

    limitBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    limitText: { fontSize: 13, color: colors.textSecondary },
    upgradeLink: { fontSize: 13, color: colors.primary, fontWeight: "600" },

    filterScroll: { maxHeight: 44, marginBottom: 8 },
    filterContent: { paddingHorizontal: 16, gap: 8 },
    filterTab: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    filterTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { fontSize: 13, color: colors.textMuted, fontWeight: "500" },
    filterTextActive: { color: colors.text, fontWeight: "600" },

    content: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

    emptyState: { alignItems: "center", paddingVertical: 60, gap: 8 },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    emptySubtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", paddingHorizontal: 40 },

    wishlistCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    priorityBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    priorityText: { fontSize: 12, fontWeight: "600" },
    destination: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 2 },
    country: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
    notes: { fontSize: 13, color: colors.textMuted, marginBottom: 8, fontStyle: "italic" },
    cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
    dealAlertToggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
    dealAlertActive: {},
    dealAlertText: { fontSize: 12, color: colors.textMuted },
    planButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
    },
    planButtonText: { fontSize: 13, fontWeight: "600", color: colors.text },

    // Add modal
    modalContainer: { flex: 1 },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    modalContent: { padding: 16 },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 8, marginTop: 16 },
    input: {
      backgroundColor: colors.inputBackground,
      borderRadius: 12,
      padding: 14,
      fontSize: 16,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    textArea: { minHeight: 80, textAlignVertical: "top" },
    priorityRow: { flexDirection: "row", gap: 10 },
    priorityOption: {
      flex: 1,
      alignItems: "center",
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    priorityOptionText: { fontSize: 12, fontWeight: "500", color: colors.textMuted },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      marginTop: 24,
    },
    addButtonText: { fontSize: 16, fontWeight: "700", color: colors.text },
    suggestionsContainer: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 4,
      maxHeight: 200,
      overflow: "hidden",
    },
    suggestionItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    suggestionText: {
      fontSize: 15,
      color: colors.text,
      fontWeight: "500",
      flex: 1,
    },
    suggestionSubtext: {
      fontSize: 12,
      color: colors.textMuted,
    },
  });
