import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, Alert, ActivityIndicator, KeyboardAvoidingView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { INTERESTS } from "@/lib/data";
import { AIRPORTS } from "@/lib/airports";
import * as Haptics from "expo-haptics";
import { useToken } from "@/lib/useAuthenticatedMutation";
import { useTranslation } from "react-i18next";

type OnboardingStep = "welcome" | "preferences" | "referral";

export default function Onboarding() {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [saving, setSaving] = useState(false);
  
  // Travel preferences
  const [homeAirport, setHomeAirport] = useState("");
  const [defaultBudget, setDefaultBudget] = useState("2000");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [flightTimePreference, setFlightTimePreference] = useState("any");
  const [skipFlights, setSkipFlights] = useState(false);
  const [skipHotels, setSkipHotels] = useState(false);
  
  // Referral code
  const [referralCode, setReferralCode] = useState("");
  const [referralApplying, setReferralApplying] = useState(false);
  const [referralResult, setReferralResult] = useState<{ success: boolean; reason?: string } | null>(null);
  
  // Airport autocomplete
  const [showAirportSuggestions, setShowAirportSuggestions] = useState(false);
  const [airportSuggestions, setAirportSuggestions] = useState<typeof AIRPORTS>([]);
  
  // Mutations
  const saveTravelPreferences = useMutation(api.users.saveTravelPreferences);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const applyReferral = useMutation(api.referrals.applyReferralCode);
  const { token } = useToken();

  const hapticFeedback = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const getStepNumber = (): number => {
    switch (step) {
      case "welcome": return 1;
      case "preferences": return 2;
      case "referral": return 3;
      default: return 1;
    }
  };

  const getTotalSteps = (): number => {
    return 3; // welcome, preferences, referral
  };

  const searchAirports = (query: string) => {
    if (!query || query.length < 2) {
      setAirportSuggestions([]);
      setShowAirportSuggestions(false);
      return;
    }
    
    const lowerQuery = query.toLowerCase();
    const results = AIRPORTS.filter(airport => 
      airport.city.toLowerCase().includes(lowerQuery) ||
      airport.country.toLowerCase().includes(lowerQuery) ||
      airport.code.toLowerCase().includes(lowerQuery) ||
      airport.name.toLowerCase().includes(lowerQuery)
    ).slice(0, 10);
    
    setAirportSuggestions(results);
    setShowAirportSuggestions(results.length > 0);
  };

  const selectAirport = (airport: typeof AIRPORTS[0]) => {
    setHomeAirport(`${airport.city}, ${airport.code}`);
    setShowAirportSuggestions(false);
    setAirportSuggestions([]);
    hapticFeedback();
  };

  const toggleInterest = (interest: string) => {
    hapticFeedback();
    if (selectedInterests.includes(interest)) {
      setSelectedInterests(selectedInterests.filter(i => i !== interest));
    } else {
      if (selectedInterests.length < 5) {
        setSelectedInterests([...selectedInterests, interest]);
      } else {
        if (Platform.OS !== "web") {
          Alert.alert(t('onboarding.maxReached'), t('onboarding.maxInterests'));
        } else {
          alert(t('onboarding.maxInterests'));
        }
      }
    }
  };

  const handleFinishOnboarding = async () => {
    setSaving(true);
    try {
      await saveTravelPreferences({
        token: token || "",
        homeAirport,
        defaultBudget: parseInt(defaultBudget) || undefined,
        interests: selectedInterests,
        flightTimePreference,
        skipFlights,
        skipHotels,
      });

      hapticFeedback();
      setStep("referral");
    } catch (error) {
      console.error("Error saving preferences:", error);
      if (Platform.OS !== "web") {
        Alert.alert(t('common.error'), t('onboarding.failedSavePreferences'));
      } else {
        alert(t('onboarding.failedSavePreferences'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApplyReferral = async () => {
    if (!referralCode.trim()) return;
    setReferralApplying(true);
    setReferralResult(null);
    try {
      const result = await applyReferral({
        token: token || "",
        code: referralCode.trim(),
      });
      setReferralResult(result);
      if (result.success) {
        hapticFeedback();
      }
    } catch (error) {
      setReferralResult({ success: false, reason: "error" });
    } finally {
      setReferralApplying(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    setSaving(true);
    try {
      await completeOnboarding({ token: token || "" });
      hapticFeedback();
      router.replace("/(tabs)");
    } catch (error) {
      console.error("Error completing onboarding:", error);
    } finally {
      setSaving(false);
    }
  };

  // Progress indicator component
  const ProgressIndicator = () => (
    <View style={styles.progressContainer}>
      <Text style={styles.progressText}>{t('onboarding.stepOf', { current: getStepNumber(), total: getTotalSteps() })}</Text>
      <View style={styles.progressBarContainer}>
        {Array.from({ length: getTotalSteps() }, (_, i) => i + 1).map((num) => (
          <View
            key={num}
            style={[
              styles.progressBar,
              num <= getStepNumber() && styles.progressBarActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
  // WELCOME SCREEN
  if (step === "welcome") {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
        <SafeAreaView style={styles.container}>
        <View style={styles.welcomeContent}>
          <View style={styles.logoContainer}>
            <View style={styles.logoInner}>
              <Ionicons name="airplane" size={48} color="#1A1A1A" />
            </View>
          </View>
          
          <Text style={styles.welcomeTitle}>{t('onboarding.welcomeToPlanera')}</Text>
          <Text style={styles.welcomeSubtitle}>
            {t('onboarding.letsSetup')}
          </Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="information-circle" size={22} color="#1A1A1A" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>{t('onboarding.whyWeNeedThis')}</Text>
              <Text style={styles.infoText}>
                {t('onboarding.whyWeNeedExplanation')}
              </Text>
            </View>
          </View>
          
          <View style={{ flex: 1 }} />
          
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="compass-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>{t('onboarding.createTravelerProfile')}</Text>
            </View>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="options-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>{t('onboarding.setTravelPreferences')}</Text>
            </View>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="sparkles-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>{t('onboarding.getPersonalizedTrips')}</Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              hapticFeedback();
              setStep("preferences");
            }}
          >
            <Text style={styles.primaryButtonText}>{t('onboarding.startSetup')}</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      </>
    );
  }

  // PREFERENCES SCREEN
  if (step === "preferences") {
    const flightTimeOptions = [
      { value: "any", label: t('onboarding.anyTime'), icon: "time-outline" as const },
      { value: "morning", label: t('onboarding.morning'), icon: "sunny-outline" as const },
      { value: "afternoon", label: t('onboarding.afternoon'), icon: "partly-sunny-outline" as const },
      { value: "evening", label: t('onboarding.evening'), icon: "moon-outline" as const },
    ];

    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
        <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => setStep("welcome")}>
              <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
            </TouchableOpacity>
            <ProgressIndicator />
            <View style={{ width: 40 }} />
          </View>
          
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.preferencesHeader}>
              <View style={styles.preferencesIconContainer}>
                <Ionicons name="options" size={28} color="#1A1A1A" />
              </View>
              <Text style={styles.stepTitle}>{t('onboarding.travelPreferences')}</Text>
              <Text style={styles.stepSubtitle}>
                {t('onboarding.autoApplied')}
              </Text>
            </View>
            
            {/* Home Airport */}
            <View style={[styles.formSection, { zIndex: 10 }]}>
              <Text style={styles.sectionLabel}>{t('onboarding.defaultLocation')}</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('onboarding.homeAirport')}</Text>
                <View style={styles.inputWithIconContainer}>
                  <Ionicons name="airplane-outline" size={20} color="#6B7280" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithIcon}
                    placeholder={t('onboarding.homeAirportPlaceholder')}
                    value={homeAirport}
                    onChangeText={(text) => {
                      setHomeAirport(text);
                      searchAirports(text);
                    }}
                    onFocus={() => {
                      if (homeAirport.length >= 2) {
                        searchAirports(homeAirport);
                      }
                    }}
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
                {showAirportSuggestions && airportSuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    <ScrollView nestedScrollEnabled={true} keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
                      {airportSuggestions.map((airport, index) => (
                        <TouchableOpacity
                          key={`${airport.code}-${index}`}
                          style={styles.suggestionItem}
                          onPress={() => selectAirport(airport)}
                        >
                          <Ionicons name="airplane" size={18} color="#FFE500" style={styles.suggestionIcon} />
                          <View>
                            <Text style={styles.suggestionCity}>{airport.city} ({airport.code})</Text>
                            <Text style={styles.suggestionDetails}>{airport.name}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
            
            {/* Budget */}
            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>{t('onboarding.defaults')}</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('onboarding.budgetLabel')}</Text>
                <View style={styles.inputWithIconContainer}>
                  <Ionicons name="cash-outline" size={20} color="#6B7280" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithIcon}
                    placeholder="2000"
                    value={defaultBudget}
                    onChangeText={setDefaultBudget}
                    keyboardType="numeric"
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
              </View>
            </View>
            
            {/* Interests */}
            <View style={styles.formSection}>
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>{t('onboarding.defaultInterests')}</Text>
                <Text style={styles.sectionLabelHint}>{t('onboarding.selectedOf5', { count: selectedInterests.length })}</Text>
              </View>
              <View style={styles.interestsContainer}>
                {INTERESTS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest);
                  return (
                    <TouchableOpacity
                      key={interest}
                      style={[styles.interestChip, isSelected && styles.interestChipActive]}
                      onPress={() => toggleInterest(interest)}
                    >
                      <Text style={[styles.interestText, isSelected && styles.interestTextActive]}>
                        {interest}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark" size={16} color="#1A1A1A" style={{ marginLeft: 4 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            
            {/* Flight Time Preference - Hidden in V1 */}
            {/* <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>PREFERRED FLIGHT TIME</Text>
              {skippedProfile && (
                <View style={styles.lockedNotice}>
                  <Ionicons name="lock-closed" size={14} color="#94A3B8" />
                  <Text style={styles.lockedNoticeText}>Create a traveler profile to enable flight preferences</Text>
                </View>
              )}
              <View style={[styles.flightTimeRow, skippedProfile && styles.disabledSection]}>
                {flightTimeOptions.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.flightTimeCard, flightTimePreference === option.value && styles.flightTimeCardActive, skippedProfile && styles.flightTimeCardDisabled]}
                    onPress={() => {
                      if (!skippedProfile) {
                        hapticFeedback();
                        setFlightTimePreference(option.value);
                      }
                    }}
                    disabled={skippedProfile}
                  >
                    <Ionicons
                      name={option.icon}
                      size={22}
                      color={skippedProfile ? "#CBD5E1" : (flightTimePreference === option.value ? "#1A1A1A" : "#6B7280")}
                    />
                    <Text style={[styles.flightTimeText, flightTimePreference === option.value && styles.flightTimeTextActive, skippedProfile && styles.flightTimeTextDisabled]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View> */}
            
            {/* Search Settings - Hidden in V1 */}
            {/* <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>DEFAULT SEARCH SETTINGS</Text>
              
              {skippedProfile && (
                <View style={styles.lockedBanner}>
                  <Ionicons name="lock-closed" size={18} color="#92400E" />
                  <View style={styles.lockedBannerText}>
                    <Text style={styles.lockedBannerTitle}>Flights & Hotels Disabled</Text>
                    <Text style={styles.lockedBannerDesc}>Create a traveler profile in Settings to enable booking features</Text>
                  </View>
                </View>
              )}
              
              <View style={styles.settingsCard}>
                <View style={[styles.toggleRow, skippedProfile && styles.toggleRowLocked]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleHeader}>
                      <Ionicons name="airplane-outline" size={20} color={skippedProfile ? "#94A3B8" : "#1A1A1A"} />
                      <Text style={[styles.toggleLabel, skippedProfile && styles.toggleLabelLocked]}>Skip Flights</Text>
                      {skippedProfile && <Ionicons name="lock-closed" size={14} color="#94A3B8" style={{ marginLeft: 6 }} />}
                    </View>
                    <Text style={[styles.toggleDescription, skippedProfile && styles.toggleDescriptionLocked]}>
                      {skippedProfile ? "Locked - requires traveler profile" : "Don't search for flights by default"}
                    </Text>
                  </View>
                  <Switch
                    value={skipFlights}
                    onValueChange={skippedProfile ? undefined : setSkipFlights}
                    trackColor={{ false: "#E2E8F0", true: skippedProfile ? "#CBD5E1" : "#FFE500" }}
                    thumbColor={Platform.OS === "ios" ? "#FFFFFF" : skipFlights ? "#FFFFFF" : "#F1F5F9"}
                    disabled={skippedProfile}
                  />
                </View>
                
                <View style={styles.divider} />
                
                <View style={[styles.toggleRow, skippedProfile && styles.toggleRowLocked]}>
                  <View style={styles.toggleInfo}>
                    <View style={styles.toggleHeader}>
                      <Ionicons name="bed-outline" size={20} color={skippedProfile ? "#94A3B8" : "#1A1A1A"} />
                      <Text style={[styles.toggleLabel, skippedProfile && styles.toggleLabelLocked]}>Skip Hotels</Text>
                      {skippedProfile && <Ionicons name="lock-closed" size={14} color="#94A3B8" style={{ marginLeft: 6 }} />}
                    </View>
                    <Text style={[styles.toggleDescription, skippedProfile && styles.toggleDescriptionLocked]}>
                      {skippedProfile ? "Locked - requires traveler profile" : "Don't search for hotels by default"}
                    </Text>
                  </View>
                  <Switch
                    value={skipHotels}
                    onValueChange={skippedProfile ? undefined : setSkipHotels}
                    trackColor={{ false: "#E2E8F0", true: skippedProfile ? "#CBD5E1" : "#FFE500" }}
                    thumbColor={Platform.OS === "ios" ? "#FFFFFF" : skipHotels ? "#FFFFFF" : "#F1F5F9"}
                    disabled={skippedProfile}
                  />
                </View>
              </View>
            </View> */}
            
            <View style={{ height: 120 }} />
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
              onPress={handleFinishOnboarding}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>{t('onboarding.saveAndContinue')}</Text>
                  <Ionicons name="arrow-forward" size={20} color="#FFF" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </>
    );
  }

  // REFERRAL CODE SCREEN
  if (step === "referral") {
    const getReferralMessage = () => {
      if (!referralResult) return null;
      if (referralResult.success) return { text: t('referrals.codeApplied'), type: 'success' as const };
      switch (referralResult.reason) {
        case 'already_used': return { text: t('referrals.alreadyUsed'), type: 'error' as const };
        case 'code_not_found': return { text: t('referrals.codeNotFound'), type: 'error' as const };
        case 'self_referral': return { text: t('referrals.selfReferral'), type: 'error' as const };
        default: return { text: t('referrals.invalidCode'), type: 'error' as const };
      }
    };
    const referralMessage = getReferralMessage();

    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => setStep("preferences")}>
              <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
            </TouchableOpacity>
            <ProgressIndicator />
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.preferencesHeader}>
              <View style={styles.preferencesIconContainer}>
                <Ionicons name="gift" size={28} color="#1A1A1A" />
              </View>
              <Text style={styles.stepTitle}>{t('onboarding.referralTitle')}</Text>
              <Text style={styles.stepSubtitle}>
                {t('onboarding.referralSubtitle')}
              </Text>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>{t('onboarding.referralCodeLabel')}</Text>
              <View style={styles.referralInputRow}>
                <TextInput
                  style={[styles.input, styles.referralInput]}
                  placeholder={t('referrals.enterCode')}
                  value={referralCode}
                  onChangeText={(text) => {
                    setReferralCode(text.toUpperCase());
                    setReferralResult(null);
                  }}
                  placeholderTextColor="#9B9B9B"
                  autoCapitalize="characters"
                  maxLength={10}
                />
                <TouchableOpacity
                  style={[styles.referralApplyButton, (!referralCode.trim() || referralApplying) && styles.primaryButtonDisabled]}
                  onPress={handleApplyReferral}
                  disabled={!referralCode.trim() || referralApplying || referralResult?.success === true}
                >
                  {referralApplying ? (
                    <ActivityIndicator color="#1A1A1A" size="small" />
                  ) : (
                    <Text style={styles.referralApplyText}>{t('referrals.apply')}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {referralMessage && (
                <View style={[styles.referralFeedback, referralMessage.type === 'success' ? styles.referralSuccess : styles.referralError]}>
                  <Ionicons
                    name={referralMessage.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
                    size={18}
                    color={referralMessage.type === 'success' ? '#16A34A' : '#DC2626'}
                  />
                  <Text style={[styles.referralFeedbackText, referralMessage.type === 'success' ? styles.referralSuccessText : styles.referralErrorText]}>
                    {referralMessage.text}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoIconContainer}>
                <Ionicons name="sparkles" size={22} color="#1A1A1A" />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>{t('onboarding.referralBenefitTitle')}</Text>
                <Text style={styles.infoText}>
                  {t('onboarding.referralBenefitDesc')}
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryButton, styles.finishButton, saving && styles.primaryButtonDisabled]}
              onPress={handleCompleteOnboarding}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                  <Text style={styles.primaryButtonText}>{t('onboarding.letsGo')}</Text>
                </>
              )}
            </TouchableOpacity>
            {!referralCode.trim() && !referralResult?.success && (
              <TouchableOpacity
                style={styles.skipButton}
                onPress={handleCompleteOnboarding}
                disabled={saving}
              >
                <Text style={styles.skipButtonText}>{t('onboarding.skipReferral')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FAF9F6",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FAF9F6",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  progressContainer: {
    alignItems: "center",
  },
  progressText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 6,
  },
  progressBarContainer: {
    flexDirection: "row",
    gap: 6,
  },
  progressBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E8E6E1",
  },
  progressBarActive: {
    backgroundColor: "#FFE500",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  footer: {
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 20 : 20,
    backgroundColor: "#FAF9F6",
    borderTopWidth: 1,
    borderTopColor: "#E8E6E1",
  },
  
  // Welcome Screen
  welcomeContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    alignSelf: "center",
    shadowColor: "#FFE500",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  logoInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#1A1A1A",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#FFF8E1",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FFE082",
  },
  infoIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: "#78716C",
    lineHeight: 18,
  },
  featuresList: {
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F5F5F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  featureText: {
    fontSize: 15,
    color: "#1A1A1A",
    fontWeight: "500",
  },
  
  // Buttons
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  finishButton: {
    backgroundColor: "#1A1A1A",
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  
  // Step screens
  stepTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  stepSubtitle: {
    fontSize: 15,
    color: "#6B7280",
    marginBottom: 24,
    lineHeight: 22,
  },
  
  // Choice cards
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#E8E6E1",
  },
  choiceCardActive: {
    borderColor: "#FFE500",
    backgroundColor: "#FFFDF5",
  },
  choiceLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  choiceIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#F5F5F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  choiceIconContainerActive: {
    backgroundColor: "#FFE500",
  },
  choiceTextContainer: {
    flex: 1,
  },
  choiceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  choiceTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  choiceHelper: {
    fontSize: 13,
    color: "#6B7280",
  },
  recommendedBadge: {
    backgroundColor: "#FFE500",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recommendedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#1A1A1A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    justifyContent: "center",
    alignItems: "center",
  },
  radioOuterActive: {
    borderColor: "#FFE500",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFE500",
  },
  noteCard: {
    flexDirection: "row",
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    alignItems: "flex-start",
    gap: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
  
  // Profile header
  profileHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  profileAvatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  preferencesHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  preferencesIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  
  // Form sections
  formSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9B9B9B",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sectionLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionLabelHint: {
    fontSize: 12,
    color: "#6B7280",
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputRow: {
    flexDirection: "row",
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A1A1A",
    marginBottom: 8,
  },
  required: {
    color: "#DC2626",
  },
  input: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  inputWithIconContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  inputIcon: {
    marginLeft: 14,
  },
  inputWithIcon: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: "#1A1A1A",
  },
  selectInput: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  selectInputInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: {
    fontSize: 16,
    color: "#1A1A1A",
  },
  selectPlaceholder: {
    fontSize: 16,
    color: "#9B9B9B",
  },
  
  // Gender selection
  genderRow: {
    flexDirection: "row",
    gap: 12,
  },
  genderOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    backgroundColor: "#FFF",
    borderRadius: 12,
    gap: 8,
    borderWidth: 2,
    borderColor: "#E8E6E1",
  },
  genderOptionActive: {
    backgroundColor: "#FFE500",
    borderColor: "#FFE500",
  },
  genderText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
  },
  genderTextActive: {
    color: "#1A1A1A",
  },
  
  // Picker modals
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  pickerContainer: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    width: "100%",
    maxWidth: 360,
    maxHeight: "80%",
    overflow: "hidden",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E6E1",
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F0",
    margin: 16,
    marginTop: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: "#1A1A1A",
  },
  pickerList: {
    maxHeight: 300,
  },
  pickerOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F3",
  },
  pickerOptionActive: {
    backgroundColor: "#FFFDF5",
  },
  pickerOptionText: {
    fontSize: 16,
    color: "#1A1A1A",
  },
  pickerOptionTextActive: {
    fontWeight: "600",
  },
  
  // Traveler cards
  travelerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  travelerCardLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  travelerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  travelerAvatarSecondary: {
    backgroundColor: "#E8E6E1",
  },
  travelerAvatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  travelerCardInfo: {
    flex: 1,
  },
  travelerName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A1A1A",
    marginBottom: 2,
  },
  travelerMeta: {
    fontSize: 13,
    color: "#6B7280",
  },
  primaryTravelerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFE500",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  primaryTravelerBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  addTravelerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFE500",
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 18,
    marginTop: 8,
    backgroundColor: "#FFFDF5",
    gap: 10,
  },
  addTravelerIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFE500",
    justifyContent: "center",
    alignItems: "center",
  },
  addTravelerText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: "#FAF9F6",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E6E1",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  modalCancel: {
    fontSize: 16,
    color: "#6B7280",
  },
  modalSave: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  modalBody: {
    flex: 1,
    padding: 20,
  },
  
  // Suggestions
  suggestionsContainer: {
    position: "absolute",
    top: 75,
    left: 0,
    right: 0,
    backgroundColor: "#FFF",
    borderRadius: 12,
    zIndex: 1000,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: "#FFE500",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F3",
  },
  suggestionIcon: {
    marginRight: 12,
  },
  suggestionCity: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  suggestionDetails: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
  },
  
  // Interests
  interestsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  interestChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#E8E6E1",
  },
  interestChipActive: {
    backgroundColor: "#FFE500",
    borderColor: "#FFE500",
  },
  interestText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
  },
  interestTextActive: {
    color: "#1A1A1A",
  },
  
  // Flight time
  flightTimeRow: {
    flexDirection: "row",
    gap: 8,
  },
  flightTimeCard: {
    flex: 1,
    padding: 14,
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E8E6E1",
    alignItems: "center",
  },
  flightTimeCardActive: {
    borderColor: "#FFE500",
    backgroundColor: "#FFE500",
  },
  flightTimeText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
  },
  flightTimeTextActive: {
    color: "#1A1A1A",
  },
  
  // Settings card
  settingsCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  toggleDescription: {
    fontSize: 13,
    color: "#6B7280",
    marginLeft: 28,
  },
  divider: {
    height: 1,
    backgroundColor: "#E8E6E1",
    marginHorizontal: 14,
  },
  // Phone input styles
  phoneInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  phoneCountryCode: {
    width: 80,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#E8E6E1",
    textAlign: "center",
  },
  phoneNumberInput: {
    flex: 1,
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A1A",
    borderWidth: 1,
    borderColor: "#E8E6E1",
  },
  lockedNotice: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 6,
  },
  lockedNoticeText: {
    fontSize: 13,
    color: "#94A3B8",
  },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFF8E1",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#FFE082",
    gap: 12,
  },
  lockedBannerText: {
    flex: 1,
  },
  lockedBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400E",
    marginBottom: 2,
  },
  lockedBannerDesc: {
    fontSize: 13,
    color: "#A16207",
    lineHeight: 18,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFF8E1",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#FFE082",
    gap: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
  disabledSection: {
    opacity: 0.5,
  },
  flightTimeCardDisabled: {
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  flightTimeTextDisabled: {
    color: "#CBD5E1",
  },
  toggleRowLocked: {
    opacity: 0.6,
  },
  toggleLabelLocked: {
    color: "#94A3B8",
  },
  toggleDescriptionLocked: {
    color: "#CBD5E1",
  },
  
  // Referral screen
  referralInputRow: {
    flexDirection: "row",
    gap: 10,
  },
  referralInput: {
    flex: 1,
    letterSpacing: 2,
    fontWeight: "700",
    fontSize: 18,
    textAlign: "center",
  },
  referralApplyButton: {
    backgroundColor: "#FFE500",
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 80,
  },
  referralApplyText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  referralFeedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  referralSuccess: {
    backgroundColor: "#F0FDF4",
  },
  referralError: {
    backgroundColor: "#FEF2F2",
  },
  referralFeedbackText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  referralSuccessText: {
    color: "#16A34A",
  },
  referralErrorText: {
    color: "#DC2626",
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
  },
});
