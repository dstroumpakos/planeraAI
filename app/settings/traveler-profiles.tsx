import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput, Modal, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "@/lib/ThemeContext";
import * as Haptics from "expo-haptics";
import { COUNTRIES } from "@/lib/data";

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

export default function TravelerProfiles() {
  const router = useRouter();
  const { colors, isDarkMode } = useTheme();
  const travelers = useQuery(api.travelers.list);
  const createTraveler = useMutation(api.travelers.create);
  const updateTraveler = useMutation(api.travelers.update);
  const removeTraveler = useMutation(api.travelers.remove);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<Id<"travelers"> | null>(null);
  const [form, setForm] = useState<TravelerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  const styles = createStyles(colors, isDarkMode);

  const handleAddNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleEdit = (traveler: any) => {
    setEditingId(traveler._id);
    setForm({
      firstName: traveler.firstName,
      lastName: traveler.lastName,
      dateOfBirth: traveler.dateOfBirth,
      gender: traveler.gender,
      passportNumber: traveler.passportNumber,
      passportIssuingCountry: traveler.passportIssuingCountry,
      passportExpiryDate: traveler.passportExpiryDate,
      email: traveler.email || "",
      phoneCountryCode: traveler.phoneCountryCode || "+1",
      phoneNumber: traveler.phoneNumber || "",
    });
    setShowModal(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleDelete = (id: Id<"travelers">, name: string) => {
    if (Platform.OS !== 'web') {
      Alert.alert(
        "Delete Traveler",
        `Are you sure you want to delete ${name}'s profile?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await removeTraveler({ id });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (error) {
                Alert.alert("Error", "Failed to delete traveler");
              }
            },
          },
        ]
      );
    } else {
      if (confirm(`Are you sure you want to delete ${name}'s profile?`)) {
        removeTraveler({ id });
      }
    }
  };

  const validateForm = (): string | null => {
    if (!form.firstName.trim()) return "First name is required";
    if (!form.lastName.trim()) return "Last name is required";
    if (!form.dateOfBirth) return "Date of birth is required";
    if (!form.gender) return "Gender is required";
    if (!form.passportNumber.trim()) return "Passport number is required";
    if (!form.passportIssuingCountry) return "Passport country is required";
    if (!form.passportExpiryDate) return "Passport expiry date is required";

    // Validate date formats
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(form.dateOfBirth)) return "Date of birth must be YYYY-MM-DD";
    if (!dobRegex.test(form.passportExpiryDate)) return "Passport expiry must be YYYY-MM-DD";

    // Check passport hasn't expired
    const expiryDate = new Date(form.passportExpiryDate);
    const today = new Date();
    if (expiryDate < today) return "Passport has expired";

    // Check DOB is reasonable
    const dob = new Date(form.dateOfBirth);
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 120);
    if (dob < minDate || dob > today) return "Invalid date of birth";

    return null;
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) {
      if (Platform.OS !== 'web') {
        Alert.alert("Missing Information", error);
      } else {
        alert(error);
      }
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateTraveler({
          id: editingId,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth,
          gender: form.gender as "male" | "female",
          passportNumber: form.passportNumber.trim(),
          passportIssuingCountry: form.passportIssuingCountry,
          passportExpiryDate: form.passportExpiryDate,
          email: form.email.trim() || undefined,
          phoneCountryCode: form.phoneCountryCode.trim() || undefined,
          phoneNumber: form.phoneNumber.trim() || undefined,
        });
      } else {
        await createTraveler({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth,
          gender: form.gender as "male" | "female",
          passportNumber: form.passportNumber.trim(),
          passportIssuingCountry: form.passportIssuingCountry,
          passportExpiryDate: form.passportExpiryDate,
          email: form.email.trim() || undefined,
          phoneCountryCode: form.phoneCountryCode.trim() || undefined,
          phoneNumber: form.phoneNumber.trim() || undefined,
        });
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (error) {
      if (Platform.OS !== 'web') {
        Alert.alert("Error", "Failed to save traveler");
      } else {
        alert("Failed to save traveler");
      }
    } finally {
      setSaving(false);
    }
  };

  const isProfileComplete = (traveler: any): boolean => {
    return !!(
      traveler.firstName &&
      traveler.lastName &&
      traveler.dateOfBirth &&
      traveler.gender &&
      traveler.passportNumber &&
      traveler.passportIssuingCountry &&
      traveler.passportExpiryDate &&
      new Date(traveler.passportExpiryDate) > new Date()
    );
  };

  const calculateAge = (dob: string): number => {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const getCountryName = (code: string): string => {
    return COUNTRIES.find(c => c.code === code)?.name || code;
  };

  if (!travelers) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Traveler Profiles</Text>
        <TouchableOpacity onPress={handleAddNew}>
          <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Add travelers who will be on your trips. Complete profiles are required for flight bookings.
        </Text>

        {travelers.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No Travelers Yet</Text>
            <Text style={styles.emptyText}>
              Add yourself and anyone who travels with you. Complete passport info is required for booking flights.
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddNew}>
              <Ionicons name="add" size={20} color="#000" />
              <Text style={styles.addButtonText}>Add Traveler</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {travelers.map((traveler) => {
              const complete = isProfileComplete(traveler);
              const age = calculateAge(traveler.dateOfBirth);
              
              return (
                <TouchableOpacity
                  key={traveler._id}
                  style={styles.travelerCard}
                  onPress={() => handleEdit(traveler)}
                >
                  <View style={styles.travelerHeader}>
                    <View style={styles.travelerInfo}>
                      <View style={[styles.avatar, { backgroundColor: complete ? colors.primary : colors.textSecondary }]}>
                        <Text style={styles.avatarText}>
                          {traveler.firstName[0]}{traveler.lastName[0]}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.travelerName}>
                          {traveler.firstName} {traveler.lastName}
                        </Text>
                        <Text style={styles.travelerMeta}>
                          {age} years old • {traveler.gender === "male" ? "Male" : "Female"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.travelerActions}>
                      {traveler.isDefault && (
                        <View style={styles.defaultBadge}>
                          <Text style={styles.defaultBadgeText}>Primary</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleDelete(traveler._id, traveler.firstName)}
                      >
                        <Ionicons name="trash-outline" size={18} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.passportSection}>
                    <View style={styles.passportRow}>
                      <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.passportText}>
                        {traveler.passportNumber} • {getCountryName(traveler.passportIssuingCountry)}
                      </Text>
                    </View>
                    <View style={styles.passportRow}>
                      <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.passportText}>
                        Expires: {traveler.passportExpiryDate}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.statusBadge, { backgroundColor: complete ? "#D1FAE5" : "#FEE2E2" }]}>
                    <Ionicons
                      name={complete ? "checkmark-circle" : "alert-circle"}
                      size={16}
                      color={complete ? "#059669" : "#DC2626"}
                    />
                    <Text style={[styles.statusText, { color: complete ? "#059669" : "#DC2626" }]}>
                      {complete ? "Booking Ready" : "Incomplete"}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.addMoreButton} onPress={handleAddNew}>
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={styles.addMoreText}>Add Another Traveler</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingId ? "Edit Traveler" : "Add Traveler"}
            </Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>Personal Information</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>First Name *</Text>
              <TextInput
                style={styles.input}
                value={form.firstName}
                onChangeText={(text) => setForm({ ...form, firstName: text })}
                placeholder="As shown on passport"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Last Name *</Text>
              <TextInput
                style={styles.input}
                value={form.lastName}
                onChangeText={(text) => setForm({ ...form, lastName: text })}
                placeholder="As shown on passport"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Date of Birth * (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={form.dateOfBirth}
                onChangeText={(text) => setForm({ ...form, dateOfBirth: text })}
                placeholder="1990-01-15"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Gender *</Text>
              <TouchableOpacity
                style={styles.selectInput}
                onPress={() => setShowGenderPicker(true)}
              >
                <Text style={form.gender ? styles.selectValue : styles.selectPlaceholder}>
                  {form.gender === "male" ? "Male" : form.gender === "female" ? "Female" : "Select gender"}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Passport Information</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Passport Number *</Text>
              <TextInput
                style={styles.input}
                value={form.passportNumber}
                onChangeText={(text) => setForm({ ...form, passportNumber: text.toUpperCase() })}
                placeholder="AB1234567"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Issuing Country *</Text>
              <TouchableOpacity
                style={styles.selectInput}
                onPress={() => setShowCountryPicker(true)}
              >
                <Text style={form.passportIssuingCountry ? styles.selectValue : styles.selectPlaceholder}>
                  {form.passportIssuingCountry ? getCountryName(form.passportIssuingCountry) : "Select country"}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Expiry Date * (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={form.passportExpiryDate}
                onChangeText={(text) => setForm({ ...form, passportExpiryDate: text })}
                placeholder="2030-12-31"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Contact (Optional)</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={form.email}
                onChangeText={(text) => setForm({ ...form, email: text })}
                placeholder="email@example.com"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone Number</Text>
              <View style={styles.phoneInputContainer}>
                <TextInput
                  style={styles.phoneCountryCode}
                  value={form.phoneCountryCode}
                  onChangeText={(text) => setForm({ ...form, phoneCountryCode: text })}
                  placeholder="+1"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="phone-pad"
                  maxLength={3}
                />
                <TextInput
                  style={styles.phoneNumber}
                  value={form.phoneNumber}
                  onChangeText={(text) => setForm({ ...form, phoneNumber: text })}
                  placeholder="555 555 5555"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>

        {/* Gender Picker Modal */}
        <Modal
          visible={showGenderPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowGenderPicker(false)}
        >
          <TouchableOpacity
            style={styles.pickerOverlay}
            activeOpacity={1}
            onPress={() => setShowGenderPicker(false)}
          >
            <View style={styles.pickerContainer}>
              <Text style={styles.pickerTitle}>Select Gender</Text>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={() => {
                  setForm({ ...form, gender: "male" });
                  setShowGenderPicker(false);
                }}
              >
                <Text style={styles.pickerOptionText}>Male</Text>
                {form.gender === "male" && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={() => {
                  setForm({ ...form, gender: "female" });
                  setShowGenderPicker(false);
                }}
              >
                <Text style={styles.pickerOptionText}>Female</Text>
                {form.gender === "female" && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

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
            <View style={[styles.pickerContainer, { maxHeight: 400 }]}>
              <Text style={styles.pickerTitle}>Select Country</Text>
              <ScrollView>
                {COUNTRIES.map((country) => (
                  <TouchableOpacity
                    key={country.code}
                    style={styles.pickerOption}
                    onPress={() => {
                      setForm({ ...form, passportIssuingCountry: country.code });
                      setShowCountryPicker(false);
                    }}
                  >
                    <Text style={styles.pickerOptionText}>{country.name}</Text>
                    {form.passportIssuingCountry === country.code && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 16,
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  travelerCard: {
    backgroundColor: isDarkMode ? "#1F1F1F" : "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  travelerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  travelerInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  travelerName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  travelerMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  travelerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  defaultBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#000",
  },
  deleteButton: {
    padding: 8,
  },
  passportSection: {
    backgroundColor: isDarkMode ? "#2A2A2A" : "#F9FAFB",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  passportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  passportText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "500",
  },
  addMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
    marginBottom: 40,
  },
  addMoreText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.primary,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  cancelText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  saveText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: isDarkMode ? "#1F1F1F" : "#F9FAFB",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectInput: {
    backgroundColor: isDarkMode ? "#1F1F1F" : "#F9FAFB",
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectValue: {
    fontSize: 16,
    color: colors.text,
  },
  selectPlaceholder: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  // Picker styles
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  pickerContainer: {
    backgroundColor: colors.background,
    borderRadius: 16,
    width: "100%",
    maxWidth: 340,
    padding: 16,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    marginBottom: 16,
  },
  pickerOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionText: {
    fontSize: 16,
    color: colors.text,
  },
  // Phone input styles
  phoneInputContainer: {
    flexDirection: "row",
    gap: 8,
  },
  phoneCountryCode: {
    width: 80,
    backgroundColor: isDarkMode ? "#1F1F1F" : "#F9FAFB",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: "center",
  },
  phoneNumber: {
    flex: 1,
    backgroundColor: isDarkMode ? "#1F1F1F" : "#F9FAFB",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
