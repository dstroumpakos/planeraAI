import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Switch, Platform, Alert, ActivityIndicator, KeyboardAvoidingView, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";
import { INTERESTS, COUNTRIES } from "@/lib/data";
import { AIRPORTS } from "@/lib/airports";
import * as Haptics from "expo-haptics";

type OnboardingStep = "welcome" | "traveler-choice" | "my-profile" | "add-travelers" | "preferences";
type TravelerChoice = "just-me" | "me-others" | "skip-profile";

interface TravelerForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "";
  passportNumber: string;
  passportIssuingCountry: string;
  passportExpiryDate: string;
  email: string;
  phoneCountryCode: string;
  phoneNumber: string;
}

const emptyForm: TravelerForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  passportNumber: "",
  passportIssuingCountry: "",
  passportExpiryDate: "",
  email: "",
  phoneCountryCode: "+1",
  phoneNumber: "",
};

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [travelerChoice, setTravelerChoice] = useState<TravelerChoice>("just-me");
  const [myProfile, setMyProfile] = useState<TravelerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  
  // Additional travelers
  const [additionalTravelers, setAdditionalTravelers] = useState<TravelerForm[]>([]);
  const [travelerForm, setTravelerForm] = useState<TravelerForm>(emptyForm);
  const [showTravelerModal, setShowTravelerModal] = useState(false);
  const [travelerCountrySearch, setTravelerCountrySearch] = useState("");
  const [showTravelerCountryPicker, setShowTravelerCountryPicker] = useState(false);
  const [showTravelerGenderPicker, setShowTravelerGenderPicker] = useState(false);
  
  // Travel preferences
  const [homeAirport, setHomeAirport] = useState("");
  const [defaultBudget, setDefaultBudget] = useState("2000");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [flightTimePreference, setFlightTimePreference] = useState("any");
  const [skipFlights, setSkipFlights] = useState(false);
  const [skipHotels, setSkipHotels] = useState(false);
  
  // Track if user skipped profile creation
  const [skippedProfile, setSkippedProfile] = useState(false);
  
  // Airport autocomplete
  const [showAirportSuggestions, setShowAirportSuggestions] = useState(false);
  const [airportSuggestions, setAirportSuggestions] = useState<typeof AIRPORTS>([]);
  
  // Mutations
  const createTraveler = useMutation(api.travelers.create);
  const saveTravelPreferences = useMutation(api.users.saveTravelPreferences);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  
  // Query existing travelers
  const existingTravelers = useQuery(api.travelers.list);

  const hapticFeedback = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const getStepNumber = (): number => {
    switch (step) {
      case "welcome": return 1;
      case "traveler-choice": return 1;
      case "my-profile": return 2;
      case "add-travelers": return 2;
      case "preferences": return skippedProfile ? 2 : 3;
      default: return 1;
    }
  };

  const getCountryName = (code: string): string => {
    return COUNTRIES.find(c => c.code === code)?.name || code;
  };

  const filteredCountries = COUNTRIES.filter(country =>
    country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    country.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const filteredTravelerCountries = COUNTRIES.filter(country =>
    country.name.toLowerCase().includes(travelerCountrySearch.toLowerCase()) ||
    country.code.toLowerCase().includes(travelerCountrySearch.toLowerCase())
  );

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

  const validateProfileForm = (form: TravelerForm): string | null => {
    if (!form.firstName.trim()) return "First name is required";
    if (!form.lastName.trim()) return "Last name is required";
    if (!form.dateOfBirth) return "Date of birth is required";
    if (!form.gender) return "Gender is required";
    if (!form.passportNumber.trim()) return "Passport number is required";
    if (!form.passportIssuingCountry) return "Passport issuing country is required";
    if (!form.passportExpiryDate) return "Passport expiry date is required";

    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(form.dateOfBirth)) return "Date of birth format: YYYY-MM-DD";
    if (!dobRegex.test(form.passportExpiryDate)) return "Passport expiry format: YYYY-MM-DD";

    const expiryDate = new Date(form.passportExpiryDate);
    const today = new Date();
    if (expiryDate < today) return "Passport has expired";

    const dob = new Date(form.dateOfBirth);
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 120);
    if (dob < minDate || dob > today) return "Invalid date of birth";

    return null;
  };

  const handleSaveMyProfile = async () => {
    const error = validateProfileForm(myProfile);
    if (error) {
      if (Platform.OS !== "web") {
        Alert.alert("Missing Information", error);
      } else {
        alert(error);
      }
      return;
    }

    setSaving(true);
    try {
      await createTraveler({
        firstName: myProfile.firstName.trim(),
        lastName: myProfile.lastName.trim(),
        dateOfBirth: myProfile.dateOfBirth,
        gender: myProfile.gender as "male" | "female",
        passportNumber: myProfile.passportNumber.trim(),
        passportIssuingCountry: myProfile.passportIssuingCountry,
        passportExpiryDate: myProfile.passportExpiryDate,
        email: myProfile.email.trim() || undefined,
        phoneCountryCode: myProfile.phoneCountryCode.trim() || undefined,
        phoneNumber: myProfile.phoneNumber.trim() || undefined,
        isDefault: true,
      });

      hapticFeedback();
      
      if (travelerChoice === "me-others") {
        setStep("add-travelers");
      } else {
        setStep("preferences");
      }
    } catch (error) {
      console.error("Error saving profile:", error);
      if (Platform.OS !== "web") {
        Alert.alert("Error", "Failed to save profile. Please try again.");
      } else {
        alert("Failed to save profile. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddTraveler = async () => {
    const error = validateProfileForm(travelerForm);
    if (error) {
      if (Platform.OS !== "web") {
        Alert.alert("Missing Information", error);
      } else {
        alert(error);
      }
      return;
    }

    setSaving(true);
    try {
      await createTraveler({
        firstName: travelerForm.firstName.trim(),
        lastName: travelerForm.lastName.trim(),
        dateOfBirth: travelerForm.dateOfBirth,
        gender: travelerForm.gender as "male" | "female",
        passportNumber: travelerForm.passportNumber.trim(),
        passportIssuingCountry: travelerForm.passportIssuingCountry,
        passportExpiryDate: travelerForm.passportExpiryDate,
        email: travelerForm.email.trim() || undefined,
        phoneCountryCode: travelerForm.phoneCountryCode.trim() || undefined,
        phoneNumber: travelerForm.phoneNumber.trim() || undefined,
        isDefault: false,
      });

      setAdditionalTravelers([...additionalTravelers, travelerForm]);
      setTravelerForm(emptyForm);
      setShowTravelerModal(false);
      hapticFeedback();
    } catch (error) {
      console.error("Error adding traveler:", error);
      if (Platform.OS !== "web") {
        Alert.alert("Error", "Failed to add traveler. Please try again.");
      } else {
        alert("Failed to add traveler. Please try again.");
      }
    } finally {
      setSaving(false);
    }
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
          Alert.alert("Maximum Reached", "You can select up to 5 interests");
        } else {
          alert("You can select up to 5 interests");
        }
      }
    }
  };

  const handleFinishOnboarding = async () => {
    setSaving(true);
    try {
      await saveTravelPreferences({
        homeAirport,
        defaultBudget: parseInt(defaultBudget) || undefined,
        interests: selectedInterests,
        flightTimePreference,
        skipFlights,
        skipHotels,
      });

      await completeOnboarding();

      hapticFeedback();
      router.replace("/(tabs)");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      if (Platform.OS !== "web") {
        Alert.alert("Error", "Failed to save preferences. Please try again.");
      } else {
        alert("Failed to save preferences. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  // Progress indicator component
  const ProgressIndicator = () => (
    <View style={styles.progressContainer}>
      <Text style={styles.progressText}>Step {getStepNumber()} of 3</Text>
      <View style={styles.progressBarContainer}>
        {[1, 2, 3].map((num) => (
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
      <SafeAreaView style={styles.container}>
        <View style={styles.welcomeContent}>
          <View style={styles.logoContainer}>
            <View style={styles.logoInner}>
              <Ionicons name="airplane" size={48} color="#1A1A1A" />
            </View>
          </View>
          
          <Text style={styles.welcomeTitle}>Welcome to Planera</Text>
          <Text style={styles.welcomeSubtitle}>
            Let's set things up so your trips are accurate and personalized.
          </Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="information-circle" size={22} color="#1A1A1A" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>Why we need this</Text>
              <Text style={styles.infoText}>
                Airlines require correct traveler details for booking. Your preferences help us tailor every trip to your style. You can edit everything anytime.
              </Text>
            </View>
          </View>
          
          <View style={{ flex: 1 }} />
          
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="person-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>Create your traveler profile</Text>
            </View>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="settings-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>Set travel preferences</Text>
            </View>
            <View style={styles.featureItem}>
              <View style={styles.featureIcon}>
                <Ionicons name="sparkles-outline" size={18} color="#1A1A1A" />
              </View>
              <Text style={styles.featureText}>Get personalized trips</Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              hapticFeedback();
              setStep("traveler-choice");
            }}
          >
            <Text style={styles.primaryButtonText}>Start Setup</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // TRAVELER CHOICE SCREEN
  if (step === "traveler-choice") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep("welcome")}>
            <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <ProgressIndicator />
          <View style={{ width: 40 }} />
        </View>
        
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepTitle}>Who's traveling?</Text>
          <Text style={styles.stepSubtitle}>
            This helps us set up the right profiles for your trips
          </Text>
          
          <TouchableOpacity
            style={[styles.choiceCard, travelerChoice === "just-me" && styles.choiceCardActive]}
            onPress={() => {
              hapticFeedback();
              setTravelerChoice("just-me");
              setSkippedProfile(false);
            }}
          >
            <View style={styles.choiceLeft}>
              <View style={[styles.choiceIconContainer, travelerChoice === "just-me" && styles.choiceIconContainerActive]}>
                <Ionicons name="person" size={28} color={travelerChoice === "just-me" ? "#1A1A1A" : "#6B7280"} />
              </View>
              <View style={styles.choiceTextContainer}>
                <View style={styles.choiceTitleRow}>
                  <Text style={styles.choiceTitle}>Just me</Text>
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>Recommended</Text>
                  </View>
                </View>
                <Text style={styles.choiceHelper}>Create your personal traveler profile</Text>
              </View>
            </View>
            <View style={[styles.radioOuter, travelerChoice === "just-me" && styles.radioOuterActive]}>
              {travelerChoice === "just-me" && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.choiceCard, travelerChoice === "me-others" && styles.choiceCardActive]}
            onPress={() => {
              hapticFeedback();
              setTravelerChoice("me-others");
              setSkippedProfile(false);
            }}
          >
            <View style={styles.choiceLeft}>
              <View style={[styles.choiceIconContainer, travelerChoice === "me-others" && styles.choiceIconContainerActive]}>
                <Ionicons name="people" size={28} color={travelerChoice === "me-others" ? "#1A1A1A" : "#6B7280"} />
              </View>
              <View style={styles.choiceTextContainer}>
                <Text style={styles.choiceTitle}>Me + others</Text>
                <Text style={styles.choiceHelper}>Add family or friends you often book for</Text>
              </View>
            </View>
            <View style={[styles.radioOuter, travelerChoice === "me-others" && styles.radioOuterActive]}>
              {travelerChoice === "me-others" && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.choiceCard, travelerChoice === "skip-profile" && styles.choiceCardActive]}
            onPress={() => {
              hapticFeedback();
              setTravelerChoice("skip-profile");
              setSkippedProfile(true);
              // Auto-enable skip flights and hotels when skipping profile
              setSkipFlights(true);
              setSkipHotels(true);
            }}
          >
            <View style={styles.choiceLeft}>
              <View style={[styles.choiceIconContainer, travelerChoice === "skip-profile" && styles.choiceIconContainerActive]}>
                <Ionicons name="flash" size={28} color={travelerChoice === "skip-profile" ? "#1A1A1A" : "#6B7280"} />
              </View>
              <View style={styles.choiceTextContainer}>
                <Text style={styles.choiceTitle}>Skip for now</Text>
                <Text style={styles.choiceHelper}>Explore destinations without booking flights or hotels</Text>
              </View>
            </View>
            <View style={[styles.radioOuter, travelerChoice === "skip-profile" && styles.radioOuterActive]}>
              {travelerChoice === "skip-profile" && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>

          {travelerChoice === "skip-profile" && (
            <View style={styles.warningCard}>
              <Ionicons name="information-circle" size={20} color="#92400E" />
              <Text style={styles.warningText}>
                Without a traveler profile, flight and hotel searches will be skipped. You can add your profile later in Settings to enable these features.
              </Text>
            </View>
          )}

          <View style={styles.noteCard}>
            <Ionicons name="bulb-outline" size={20} color="#92400E" />
            <Text style={styles.noteText}>
              {travelerChoice === "skip-profile" 
                ? "You can create a traveler profile anytime from your Settings."
                : "You'll always create your profile first. Additional travelers can be added after."
              }
            </Text>
          </View>
        </ScrollView>
        
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              hapticFeedback();
              if (travelerChoice === "skip-profile") {
                setStep("preferences");
              } else {
                setStep("my-profile");
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // MY PROFILE SCREEN
  if (step === "my-profile") {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => setStep("traveler-choice")}>
              <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
            </TouchableOpacity>
            <ProgressIndicator />
            <View style={{ width: 40 }} />
          </View>
          
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.profileHeader}>
              <View style={styles.profileAvatarLarge}>
                <Ionicons name="person" size={32} color="#1A1A1A" />
              </View>
              <Text style={styles.stepTitle}>My Traveler Profile</Text>
              <Text style={styles.stepSubtitle}>Enter your details as shown on your passport</Text>
            </View>
            
            {/* Personal Information */}
            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              
              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputLabel}>First Name <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={myProfile.firstName}
                    onChangeText={(text) => setMyProfile({ ...myProfile, firstName: text })}
                    placeholder="John"
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.inputLabel}>Last Name <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={myProfile.lastName}
                    onChangeText={(text) => setMyProfile({ ...myProfile, lastName: text })}
                    placeholder="Smith"
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Date of Birth <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={myProfile.dateOfBirth}
                  onChangeText={(text) => setMyProfile({ ...myProfile, dateOfBirth: text })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Gender <Text style={styles.required}>*</Text></Text>
                <View style={styles.genderRow}>
                  <TouchableOpacity
                    style={[styles.genderOption, myProfile.gender === "male" && styles.genderOptionActive]}
                    onPress={() => {
                      hapticFeedback();
                      setMyProfile({ ...myProfile, gender: "male" });
                    }}
                  >
                    <Ionicons name="male" size={20} color={myProfile.gender === "male" ? "#1A1A1A" : "#6B7280"} />
                    <Text style={[styles.genderText, myProfile.gender === "male" && styles.genderTextActive]}>Male</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.genderOption, myProfile.gender === "female" && styles.genderOptionActive]}
                    onPress={() => {
                      hapticFeedback();
                      setMyProfile({ ...myProfile, gender: "female" });
                    }}
                  >
                    <Ionicons name="female" size={20} color={myProfile.gender === "female" ? "#1A1A1A" : "#6B7280"} />
                    <Text style={[styles.genderText, myProfile.gender === "female" && styles.genderTextActive]}>Female</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            
            {/* Passport Information */}
            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>PASSPORT INFORMATION</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Passport Number <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={myProfile.passportNumber}
                  onChangeText={(text) => setMyProfile({ ...myProfile, passportNumber: text.toUpperCase() })}
                  placeholder="AB1234567"
                  placeholderTextColor="#9B9B9B"
                  autoCapitalize="characters"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Issuing Country <Text style={styles.required}>*</Text></Text>
                <TouchableOpacity
                  style={styles.selectInput}
                  onPress={() => setShowCountryPicker(true)}
                >
                  <View style={styles.selectInputInner}>
                    <Ionicons name="flag-outline" size={20} color="#6B7280" />
                    <Text style={myProfile.passportIssuingCountry ? styles.selectValue : styles.selectPlaceholder}>
                      {myProfile.passportIssuingCountry ? getCountryName(myProfile.passportIssuingCountry) : "Select country"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={20} color="#6B7280" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Expiry Date <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={myProfile.passportExpiryDate}
                  onChangeText={(text) => setMyProfile({ ...myProfile, passportExpiryDate: text })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            
            {/* Contact Information */}
            <View style={styles.formSection}>
              <Text style={styles.sectionLabel}>CONTACT (OPTIONAL)</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={myProfile.email}
                  onChangeText={(text) => setMyProfile({ ...myProfile, email: text })}
                  placeholder="email@example.com"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Phone Number</Text>
                <View style={styles.phoneInputRow}>
                  <TextInput
                    style={styles.phoneCountryCode}
                    value={myProfile.phoneCountryCode}
                    onChangeText={(text) => setMyProfile({ ...myProfile, phoneCountryCode: text })}
                    placeholder="+1"
                    placeholderTextColor="#9B9B9B"
                    keyboardType="phone-pad"
                    maxLength={5}
                  />
                  <TextInput
                    style={styles.phoneNumberInput}
                    value={myProfile.phoneNumber}
                    onChangeText={(text) => setMyProfile({ ...myProfile, phoneNumber: text })}
                    placeholder="555 123 4567"
                    placeholderTextColor="#9B9B9B"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
            </View>
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
              onPress={handleSaveMyProfile}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Save & Continue</Text>
                  <Ionicons name="arrow-forward" size={20} color="#FFF" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        
        {/* Country Picker Modal */}
        <Modal
          visible={showCountryPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCountryPicker(false)}
        >
          <TouchableOpacity
            style={styles.pickerOverlay}
            activeOpacity={1}
            onPress={() => setShowCountryPicker(false)}
          >
            <View style={styles.pickerContainer} onStartShouldSetResponder={() => true}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Country</Text>
                <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                  <Ionicons name="close" size={24} color="#1A1A1A" />
                </TouchableOpacity>
              </View>
              <View style={styles.searchInputContainer}>
                <Ionicons name="search" size={20} color="#6B7280" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search countries..."
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  placeholderTextColor="#9B9B9B"
                  autoFocus
                />
              </View>
              <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
                {filteredCountries.map((country) => (
                  <TouchableOpacity
                    key={country.code}
                    style={[styles.pickerOption, myProfile.passportIssuingCountry === country.code && styles.pickerOptionActive]}
                    onPress={() => {
                      setMyProfile({ ...myProfile, passportIssuingCountry: country.code });
                      setShowCountryPicker(false);
                      setCountrySearch("");
                      hapticFeedback();
                    }}
                  >
                    <Text style={[styles.pickerOptionText, myProfile.passportIssuingCountry === country.code && styles.pickerOptionTextActive]}>
                      {country.name}
                    </Text>
                    {myProfile.passportIssuingCountry === country.code && (
                      <Ionicons name="checkmark-circle" size={22} color="#FFE500" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    );
  }

  // ADD TRAVELERS SCREEN
  if (step === "add-travelers") {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => setStep("my-profile")}>
              <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
            </TouchableOpacity>
            <ProgressIndicator />
            <View style={{ width: 40 }} />
          </View>
          
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.stepTitle}>Add Travelers</Text>
            <Text style={styles.stepSubtitle}>
              Add family or friends you often travel with
            </Text>
            
            {/* Primary traveler (locked) */}
            <View style={styles.travelerCard}>
              <View style={styles.travelerCardLeft}>
                <View style={styles.travelerAvatar}>
                  <Text style={styles.travelerAvatarText}>
                    {myProfile.firstName[0]}{myProfile.lastName[0]}
                  </Text>
                </View>
                <View style={styles.travelerCardInfo}>
                  <Text style={styles.travelerName}>{myProfile.firstName} {myProfile.lastName}</Text>
                  <Text style={styles.travelerMeta}>Primary Traveler</Text>
                </View>
              </View>
              <View style={styles.primaryTravelerBadge}>
                <Ionicons name="star" size={14} color="#1A1A1A" />
                <Text style={styles.primaryTravelerBadgeText}>Me</Text>
              </View>
            </View>
            
            {/* Additional travelers */}
            {additionalTravelers.map((traveler, index) => (
              <View key={index} style={styles.travelerCard}>
                <View style={styles.travelerCardLeft}>
                  <View style={[styles.travelerAvatar, styles.travelerAvatarSecondary]}>
                    <Text style={styles.travelerAvatarText}>
                      {traveler.firstName[0]}{traveler.lastName[0]}
                    </Text>
                  </View>
                  <View style={styles.travelerCardInfo}>
                    <Text style={styles.travelerName}>{traveler.firstName} {traveler.lastName}</Text>
                    <Text style={styles.travelerMeta}>Additional Traveler</Text>
                  </View>
                </View>
                <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
              </View>
            ))}
            
            {/* Add another traveler button */}
            <TouchableOpacity
              style={styles.addTravelerButton}
              onPress={() => {
                hapticFeedback();
                setTravelerForm(emptyForm);
                setShowTravelerModal(true);
              }}
            >
              <View style={styles.addTravelerIconContainer}>
                <Ionicons name="add" size={24} color="#1A1A1A" />
              </View>
              <Text style={styles.addTravelerText}>Add Another Traveler</Text>
            </TouchableOpacity>
            
            <View style={{ height: 100 }} />
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                hapticFeedback();
                setStep("preferences");
              }}
            >
              <Text style={styles.primaryButtonText}>Continue to Preferences</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        
        {/* Add Traveler Modal */}
        <Modal
          visible={showTravelerModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowTravelerModal(false)}
        >
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowTravelerModal(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Traveler</Text>
              <TouchableOpacity onPress={handleAddTraveler} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color="#FFE500" />
                ) : (
                  <Text style={styles.modalSave}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              
              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputLabel}>First Name <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={travelerForm.firstName}
                    onChangeText={(text) => setTravelerForm({ ...travelerForm, firstName: text })}
                    placeholder="John"
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.inputLabel}>Last Name <Text style={styles.required}>*</Text></Text>
                  <TextInput
                    style={styles.input}
                    value={travelerForm.lastName}
                    onChangeText={(text) => setTravelerForm({ ...travelerForm, lastName: text })}
                    placeholder="Smith"
                    placeholderTextColor="#9B9B9B"
                  />
                </View>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Date of Birth <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={travelerForm.dateOfBirth}
                  onChangeText={(text) => setTravelerForm({ ...travelerForm, dateOfBirth: text })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Gender <Text style={styles.required}>*</Text></Text>
                <View style={styles.genderRow}>
                  <TouchableOpacity
                    style={[styles.genderOption, travelerForm.gender === "male" && styles.genderOptionActive]}
                    onPress={() => setTravelerForm({ ...travelerForm, gender: "male" })}
                  >
                    <Ionicons name="male" size={20} color={travelerForm.gender === "male" ? "#1A1A1A" : "#6B7280"} />
                    <Text style={[styles.genderText, travelerForm.gender === "male" && styles.genderTextActive]}>Male</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.genderOption, travelerForm.gender === "female" && styles.genderOptionActive]}
                    onPress={() => setTravelerForm({ ...travelerForm, gender: "female" })}
                  >
                    <Ionicons name="female" size={20} color={travelerForm.gender === "female" ? "#1A1A1A" : "#6B7280"} />
                    <Text style={[styles.genderText, travelerForm.gender === "female" && styles.genderTextActive]}>Female</Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>PASSPORT INFORMATION</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Passport Number <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={travelerForm.passportNumber}
                  onChangeText={(text) => setTravelerForm({ ...travelerForm, passportNumber: text.toUpperCase() })}
                  placeholder="AB1234567"
                  placeholderTextColor="#9B9B9B"
                  autoCapitalize="characters"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Issuing Country <Text style={styles.required}>*</Text></Text>
                <TouchableOpacity
                  style={styles.selectInput}
                  onPress={() => setShowTravelerCountryPicker(true)}
                >
                  <View style={styles.selectInputInner}>
                    <Ionicons name="flag-outline" size={20} color="#6B7280" />
                    <Text style={travelerForm.passportIssuingCountry ? styles.selectValue : styles.selectPlaceholder}>
                      {travelerForm.passportIssuingCountry ? getCountryName(travelerForm.passportIssuingCountry) : "Select country"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={20} color="#6B7280" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Expiry Date <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={travelerForm.passportExpiryDate}
                  onChangeText={(text) => setTravelerForm({ ...travelerForm, passportExpiryDate: text })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>CONTACT (OPTIONAL)</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={travelerForm.email}
                  onChangeText={(text) => setTravelerForm({ ...travelerForm, email: text })}
                  placeholder="email@example.com"
                  placeholderTextColor="#9B9B9B"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Phone Number</Text>
                <View style={styles.phoneInputRow}>
                  <TextInput
                    style={styles.phoneCountryCode}
                    value={travelerForm.phoneCountryCode}
                    onChangeText={(text) => setTravelerForm({ ...travelerForm, phoneCountryCode: text })}
                    placeholder="+1"
                    placeholderTextColor="#9B9B9B"
                    keyboardType="phone-pad"
                    maxLength={5}
                  />
                  <TextInput
                    style={styles.phoneNumberInput}
                    value={travelerForm.phoneNumber}
                    onChangeText={(text) => setTravelerForm({ ...travelerForm, phoneNumber: text })}
                    placeholder="555 123 4567"
                    placeholderTextColor="#9B9B9B"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
              
              <View style={{ height: 40 }} />
            </ScrollView>
            
            {/* Country Picker for Traveler Modal */}
            <Modal
              visible={showTravelerCountryPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowTravelerCountryPicker(false)}
            >
              <TouchableOpacity
                style={styles.pickerOverlay}
                activeOpacity={1}
                onPress={() => setShowTravelerCountryPicker(false)}
              >
                <View style={styles.pickerContainer} onStartShouldSetResponder={() => true}>
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select Country</Text>
                    <TouchableOpacity onPress={() => setShowTravelerCountryPicker(false)}>
                      <Ionicons name="close" size={24} color="#1A1A1A" />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={20} color="#6B7280" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search countries..."
                      value={travelerCountrySearch}
                      onChangeText={setTravelerCountrySearch}
                      placeholderTextColor="#9B9B9B"
                    />
                  </View>
                  <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
                    {filteredTravelerCountries.map((country) => (
                      <TouchableOpacity
                        key={country.code}
                        style={[styles.pickerOption, travelerForm.passportIssuingCountry === country.code && styles.pickerOptionActive]}
                        onPress={() => {
                          setTravelerForm({ ...travelerForm, passportIssuingCountry: country.code });
                          setShowTravelerCountryPicker(false);
                          setTravelerCountrySearch("");
                          hapticFeedback();
                        }}
                      >
                        <Text style={[styles.pickerOptionText, travelerForm.passportIssuingCountry === country.code && styles.pickerOptionTextActive]}>
                          {country.name}
                        </Text>
                        {travelerForm.passportIssuingCountry === country.code && (
                          <Ionicons name="checkmark-circle" size={22} color="#FFE500" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );
  }

  // PREFERENCES SCREEN
  if (step === "preferences") {
    const flightTimeOptions = [
      { value: "any", label: "Any Time", icon: "time-outline" as const },
      { value: "morning", label: "Morning", icon: "sunny-outline" as const },
      { value: "afternoon", label: "Afternoon", icon: "partly-sunny-outline" as const },
      { value: "evening", label: "Evening", icon: "moon-outline" as const },
    ];

    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => travelerChoice === "me-others" ? setStep("add-travelers") : setStep("my-profile")}>
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
              <Text style={styles.stepTitle}>Travel Preferences</Text>
              <Text style={styles.stepSubtitle}>
                These will be automatically applied when you create a new trip
              </Text>
            </View>
            
            {/* Home Airport */}
            <View style={[styles.formSection, { zIndex: 10 }]}>
              <Text style={styles.sectionLabel}>DEFAULT LOCATION</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Home Airport</Text>
                <View style={styles.inputWithIconContainer}>
                  <Ionicons name="airplane-outline" size={20} color="#6B7280" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputWithIcon}
                    placeholder="e.g. Athens, ATH"
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
              <Text style={styles.sectionLabel}>DEFAULTS</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Budget ($)</Text>
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
                <Text style={styles.sectionLabel}>DEFAULT INTERESTS</Text>
                <Text style={styles.sectionLabelHint}>{selectedInterests.length}/5 selected</Text>
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
            
            {/* Flight Time Preference */}
            <View style={styles.formSection}>
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
            </View>
            
            {/* Search Settings */}
            <View style={styles.formSection}>
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
            </View>
            
            <View style={{ height: 120 }} />
          </ScrollView>
          
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryButton, styles.finishButton, saving && styles.primaryButtonDisabled]}
              onPress={handleFinishOnboarding}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                  <Text style={styles.primaryButtonText}>Save & Go to Home</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
});
