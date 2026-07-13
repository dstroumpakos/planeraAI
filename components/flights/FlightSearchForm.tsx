import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar, DateData } from "react-native-calendars";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/ThemeContext";
import { AIRPORTS } from "@/lib/airports";
import type {
  FlightSearchInput,
  SortBy,
  StopsFilter,
  TravelClass,
} from "@/types/flights";

interface Props {
  initial?: Partial<FlightSearchInput>;
  loading?: boolean;
  onSubmit: (input: FlightSearchInput) => void;
}

const STOPS: { value: StopsFilter; labelKey: string; fallback: string }[] = [
  { value: "any", labelKey: "flights.stopsAny", fallback: "Any" },
  { value: "nonstop", labelKey: "flights.nonstop", fallback: "Nonstop" },
  { value: "one_stop_or_fewer", labelKey: "flights.oneStopOrFewer", fallback: "≤1 stop" },
];

const TRAVEL_CLASSES: { value: TravelClass; labelKey: string; fallback: string }[] = [
  { value: "economy", labelKey: "flights.classEconomy", fallback: "Economy" },
  { value: "premium_economy", labelKey: "flights.classPremium", fallback: "Premium" },
  { value: "business", labelKey: "flights.classBusiness", fallback: "Business" },
  { value: "first", labelKey: "flights.classFirst", fallback: "First" },
];

const SORTS: { value: SortBy; labelKey: string; fallback: string }[] = [
  { value: "top", labelKey: "flights.sortTop", fallback: "Best" },
  { value: "price", labelKey: "flights.sortPrice", fallback: "Cheapest" },
  { value: "duration", labelKey: "flights.sortDuration", fallback: "Fastest" },
  { value: "departure_time", labelKey: "flights.sortDeparture", fallback: "Departure" },
  { value: "arrival_time", labelKey: "flights.sortArrival", fallback: "Arrival" },
  { value: "emissions", labelKey: "flights.sortEmissions", fallback: "Emissions" },
];

const MAX_PASSENGERS = 9;

type Airport = (typeof AIRPORTS)[number];

/** "Athens (ATH)" display for a known IATA code, or the raw code. */
function displayForCode(code?: string): string {
  if (!code) return "";
  const a = AIRPORTS.find((x) => x.code === code.toUpperCase());
  return a ? `${a.city} (${a.code})` : code.toUpperCase();
}

/** Extract an IATA code from free text: "Athens (ATH)" → "ATH", "ath" → "ATH". */
function codeFromText(text: string): string | null {
  const paren = text.toUpperCase().match(/\(([A-Z]{3})\)/);
  if (paren) return paren[1];
  const bare = text.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(bare)) return bare;
  const match = AIRPORTS.find(
    (a) => a.city.toLowerCase() === text.trim().toLowerCase()
  );
  return match?.code ?? null;
}

function filterAirports(query: string): Airport[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: Airport[] = [];
  const contains: Airport[] = [];
  for (const a of AIRPORTS) {
    const city = a.city.toLowerCase();
    const code = a.code.toLowerCase();
    const name = a.name.toLowerCase();
    const country = a.country.toLowerCase();
    if (city.startsWith(q) || code.startsWith(q)) starts.push(a);
    else if (city.includes(q) || name.includes(q) || country.includes(q)) contains.push(a);
    if (starts.length >= 6) break;
  }
  return [...starts, ...contains].slice(0, 6);
}

function toDateString(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

export const FlightSearchForm: React.FC<Props> = ({ initial, loading, onSubmit }) => {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();

  const defaultOutbound = initial?.outboundDate || toDateString(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
  const defaultReturn = initial?.returnDate || addDays(defaultOutbound, 7);

  const [fromText, setFromText] = useState(displayForCode(initial?.departureId));
  const [toText, setToText] = useState(displayForCode(initial?.arrivalId));
  const [activeField, setActiveField] = useState<"from" | "to" | null>(null);
  const [outboundDate, setOutboundDate] = useState(defaultOutbound);
  const [returnDate, setReturnDate] = useState(defaultReturn);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectingDate, setSelectingDate] = useState<"out" | "ret">("out");
  const [adults, setAdults] = useState(initial?.adults ?? 1);
  const [children, setChildren] = useState(initial?.children ?? 0);
  const [infantsInSeat, setInfantsInSeat] = useState(initial?.infantsInSeat ?? 0);
  const [infantsOnLap, setInfantsOnLap] = useState(initial?.infantsOnLap ?? 0);
  const [stops, setStops] = useState<StopsFilter>(initial?.stops ?? "any");
  const [travelClass, setTravelClass] = useState<TravelClass>(
    initial?.travelClass ?? "economy"
  );
  const [sortBy, setSortBy] = useState<SortBy>(initial?.sortBy ?? "top");
  const [carryOnBags, setCarryOnBags] = useState(initial?.carryOnBags ?? 0);
  const [checkedBags, setCheckedBags] = useState(initial?.checkedBags ?? 0);
  const [showCheapest, setShowCheapest] = useState(
    initial?.showCheapestFlights ?? false
  );
  const [showHidden, setShowHidden] = useState(initial?.showHiddenFlights ?? false);
  const [hideSeparate, setHideSeparate] = useState(
    initial?.hideSeparateTickets ?? false
  );
  const [showMore, setShowMore] = useState(false);
  const [maxPrice, setMaxPrice] = useState(
    initial?.maxPrice != null ? String(initial.maxPrice) : ""
  );
  const [currency] = useState(initial?.currency ?? "EUR");

  // Passenger totals: Google caps a search at 9 travelers, and bag counts
  // cannot exceed the number of seated passengers.
  const totalPassengers = adults + children + infantsInSeat + infantsOnLap;
  const seatedPassengers = adults + children + infantsInSeat;
  const canAddPassenger = totalPassengers < MAX_PASSENGERS;
  // Keep bag counts valid if the seated-passenger count drops below them.
  useEffect(() => {
    if (carryOnBags > seatedPassengers) setCarryOnBags(seatedPassengers);
    if (checkedBags > seatedPassengers) setCheckedBags(seatedPassengers);
  }, [seatedPassengers]); // eslint-disable-line react-hooks/exhaustive-deps

  // The home-airport prefill arrives async (user settings query); apply it as
  // long as the user hasn't typed into the field themselves.
  const fromTouched = useRef(false);
  useEffect(() => {
    if (initial?.departureId && !fromTouched.current && !fromText) {
      setFromText(displayForCode(initial.departureId));
    }
  }, [initial?.departureId]);

  const suggestions = useMemo(() => {
    if (activeField === "from") return filterAirports(fromText);
    if (activeField === "to") return filterAirports(toText);
    return [];
  }, [activeField, fromText, toText]);

  const fromCode = codeFromText(fromText);
  const toCode = codeFromText(toText);
  const canSubmit = Boolean(fromCode && toCode && outboundDate && returnDate && !loading);

  const pickSuggestion = (a: Airport) => {
    if (activeField === "from") {
      fromTouched.current = true;
      setFromText(`${a.city} (${a.code})`);
    } else if (activeField === "to") {
      setToText(`${a.city} (${a.code})`);
    }
    setActiveField(null);
  };

  // Delay closing so a tap on a suggestion lands before the dropdown unmounts.
  const closeSuggestionsSoon = () => {
    setTimeout(() => setActiveField((f) => (f ? null : f)), 180);
  };

  const swap = () => {
    fromTouched.current = true;
    setFromText(toText);
    setToText(fromText);
  };

  const formatDay = (dateStr: string) => {
    if (!dateStr) return t("flights.selectDate", { defaultValue: "Select date" });
    return new Date(dateStr).toLocaleDateString(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  const openCalendar = (which: "out" | "ret") => {
    setSelectingDate(which);
    setCalendarOpen(true);
  };

  const onDayPress = (day: DateData) => {
    if (selectingDate === "out") {
      setOutboundDate(day.dateString);
      if (returnDate && day.dateString >= returnDate) {
        setReturnDate(addDays(day.dateString, 7));
      }
      setSelectingDate("ret");
    } else {
      if (day.dateString <= outboundDate) {
        setOutboundDate(day.dateString);
        setSelectingDate("ret");
        return;
      }
      setReturnDate(day.dateString);
      setCalendarOpen(false);
    }
  };

  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    if (!outboundDate) return marks;
    marks[outboundDate] = {
      startingDay: true,
      color: colors.primary,
      textColor: "#000000",
    };
    if (returnDate && returnDate > outboundDate) {
      let cursor = addDays(outboundDate, 1);
      while (cursor < returnDate) {
        marks[cursor] = { color: colors.primary + "35", textColor: colors.text };
        cursor = addDays(cursor, 1);
      }
      marks[returnDate] = {
        endingDay: true,
        color: colors.primary,
        textColor: "#000000",
      };
    } else {
      marks[outboundDate].endingDay = true;
    }
    return marks;
  }, [outboundDate, returnDate, colors]);

  const submit = () => {
    if (!fromCode || !toCode || !outboundDate || !returnDate) return;
    onSubmit({
      departureId: fromCode,
      arrivalId: toCode,
      outboundDate,
      returnDate,
      type: "round_trip",
      currency,
      adults,
      children: children || undefined,
      infantsInSeat: infantsInSeat || undefined,
      infantsOnLap: infantsOnLap || undefined,
      stops,
      travelClass,
      sortBy,
      carryOnBags: carryOnBags || undefined,
      checkedBags: checkedBags || undefined,
      showCheapestFlights: showCheapest || undefined,
      showHiddenFlights: showHidden || undefined,
      hideSeparateTickets: hideSeparate || undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
  };

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 20,
      padding: 16,
      gap: 12,
    },
    pillRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.primary + "22",
    },
    pillText: { color: colors.text, fontSize: 12, fontWeight: "700" },
    label: { color: colors.textSecondary, fontSize: 12, marginBottom: 4, fontWeight: "600" },
    routeWrap: { gap: 8 },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
    },
    inputRowActive: { borderColor: colors.primary },
    input: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: 15 },
    swapBtn: {
      position: "absolute",
      right: 14,
      top: "50%",
      marginTop: -16,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 3,
      elevation: 3,
    },
    suggestions: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      overflow: "hidden",
    },
    suggestionItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    suggestionCity: { color: colors.text, fontSize: 14, fontWeight: "600" },
    suggestionSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    suggestionCode: {
      marginLeft: "auto",
      color: colors.primary,
      fontWeight: "700",
      fontSize: 13,
    },
    row: { flexDirection: "row", gap: 10 },
    col: { flex: 1 },
    dateBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    dateText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    stepperRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    stepperBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperValue: { color: colors.text, fontWeight: "700", fontSize: 16 },
    chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lightGray,
    },
    chipActive: { backgroundColor: colors.primary },
    chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
    chipTextActive: { color: "#000000" },
    priceInput: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 14,
    },
    moreToggle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    moreToggleText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
    moreSection: { gap: 12, marginTop: 2 },
    smallStepperRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    smallStepperLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
    smallStepperSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    smallStepperControls: { flexDirection: "row", alignItems: "center", gap: 14 },
    toggleChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.lightGray,
    },
    submitWrap: { borderRadius: 16, overflow: "hidden", marginTop: 4 },
    submit: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 16,
    },
    submitText: { color: "#1A1A1A", fontWeight: "800", fontSize: 16 },
    disclaimer: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalCard: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 16,
      paddingBottom: 32,
      gap: 10,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
    modalClose: { color: colors.primary, fontWeight: "700", fontSize: 15 },
    modalHint: { color: colors.textMuted, fontSize: 12 },
  });

  const renderStepper = (
    label: string,
    sub: string | null,
    value: number,
    onChange: (n: number) => void,
    min: number,
    max: number
  ) => (
    <View style={styles.smallStepperRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.smallStepperLabel}>{label}</Text>
        {sub ? <Text style={styles.smallStepperSub}>{sub}</Text> : null}
      </View>
      <View style={styles.smallStepperControls}>
        <TouchableOpacity
          style={[styles.stepperBtn, value <= min && { opacity: 0.4 }]}
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          <Ionicons name="remove" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          style={[styles.stepperBtn, value >= max && { opacity: 0.4 }]}
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          <Ionicons name="add" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSuggestions = () =>
    suggestions.length > 0 && (
      <View style={styles.suggestions}>
        {suggestions.map((a) => (
          <TouchableOpacity
            key={a.code}
            style={styles.suggestionItem}
            onPress={() => pickSuggestion(a)}
            activeOpacity={0.7}
          >
            <Ionicons name="airplane-outline" size={16} color={colors.textMuted} />
            <View>
              <Text style={styles.suggestionCity}>{a.city}</Text>
              <Text style={styles.suggestionSub} numberOfLines={1}>
                {a.name}, {a.country}
              </Text>
            </View>
            <Text style={styles.suggestionCode}>{a.code}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );

  return (
    <View style={styles.card}>
      {/* Round trip pill */}
      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Ionicons name="repeat" size={13} color={colors.text} />
          <Text style={styles.pillText}>
            {t("lowFare.roundTrip", { defaultValue: "Round trip" })}
          </Text>
        </View>
      </View>

      {/* From / To with swap */}
      <View>
        <View style={styles.routeWrap}>
          <View>
            <Text style={styles.label}>{t("flights.from", { defaultValue: "From" })}</Text>
            <View style={[styles.inputRow, activeField === "from" && styles.inputRowActive]}>
              <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                value={fromText}
                onChangeText={(v) => {
                  fromTouched.current = true;
                  setFromText(v);
                }}
                onFocus={() => setActiveField("from")}
                onBlur={closeSuggestionsSoon}
                placeholder={t("flights.cityOrAirport", { defaultValue: "City or airport" })}
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            {activeField === "from" && renderSuggestions()}
          </View>
          <View>
            <Text style={styles.label}>{t("flights.to", { defaultValue: "To" })}</Text>
            <View style={[styles.inputRow, activeField === "to" && styles.inputRowActive]}>
              <Ionicons name="location-outline" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                value={toText}
                onChangeText={setToText}
                onFocus={() => setActiveField("to")}
                onBlur={closeSuggestionsSoon}
                placeholder={t("flights.cityOrAirport", { defaultValue: "City or airport" })}
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            {activeField === "to" && renderSuggestions()}
          </View>
        </View>
        {activeField === null && (
          <TouchableOpacity style={styles.swapBtn} onPress={swap} activeOpacity={0.8}>
            <Ionicons name="swap-vertical" size={16} color="#000000" />
          </TouchableOpacity>
        )}
      </View>

      {/* Dates */}
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>{t("flights.outbound", { defaultValue: "Outbound" })}</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => openCalendar("out")} activeOpacity={0.7}>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={styles.dateText}>{formatDay(outboundDate)}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>{t("flights.return", { defaultValue: "Return" })}</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => openCalendar("ret")} activeOpacity={0.7}>
            <Ionicons name="calendar" size={16} color={colors.primary} />
            <Text style={styles.dateText}>{formatDay(returnDate)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Passengers (adults) */}
      <View>
        <Text style={styles.label}>
          {totalPassengers > adults
            ? t("flights.adults", { defaultValue: "Adults" })
            : t("flights.passengers", { defaultValue: "Passengers" })}
        </Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            style={[styles.stepperBtn, adults <= 1 && { opacity: 0.4 }]}
            onPress={() => setAdults(Math.max(1, adults - 1))}
            disabled={adults <= 1}
          >
            <Ionicons name="remove" size={18} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="people-outline" size={16} color={colors.textMuted} />
            <Text style={styles.stepperValue}>{adults}</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.stepperBtn,
              (adults >= 9 || !canAddPassenger) && { opacity: 0.4 },
            ]}
            onPress={() => setAdults(Math.min(9, adults + 1))}
            disabled={adults >= 9 || !canAddPassenger}
          >
            <Ionicons name="add" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stops + max price */}
      <View style={styles.row}>
        <View style={[styles.col, { flex: 1.4 }]}>
          <Text style={styles.label}>{t("flights.stops", { defaultValue: "Stops" })}</Text>
          <View style={styles.chipRow}>
            {STOPS.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[styles.chip, stops === s.value && styles.chipActive]}
                onPress={() => setStops(s.value)}
              >
                <Text style={[styles.chipText, stops === s.value && styles.chipTextActive]}>
                  {t(s.labelKey, { defaultValue: s.fallback })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>
            {t("flights.maxPriceLabel", { currency, defaultValue: `Max price (${currency})` })}
          </Text>
          <TextInput
            style={styles.priceInput}
            value={maxPrice}
            onChangeText={setMaxPrice}
            keyboardType="number-pad"
            placeholder="—"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      {/* More filters toggle */}
      <TouchableOpacity
        style={styles.moreToggle}
        onPress={() => setShowMore((s) => !s)}
        activeOpacity={0.7}
      >
        <Text style={styles.moreToggleText}>
          {t("flights.moreFilters", { defaultValue: "More filters" })}
        </Text>
        <Ionicons
          name={showMore ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.primary}
        />
      </TouchableOpacity>

      {showMore && (
        <View style={styles.moreSection}>
          {/* Cabin class */}
          <View>
            <Text style={styles.label}>
              {t("flights.cabinClass", { defaultValue: "Cabin class" })}
            </Text>
            <View style={styles.chipRow}>
              {TRAVEL_CLASSES.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.chip, travelClass === c.value && styles.chipActive]}
                  onPress={() => setTravelClass(c.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      travelClass === c.value && styles.chipTextActive,
                    ]}
                  >
                    {t(c.labelKey, { defaultValue: c.fallback })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Sort by */}
          <View>
            <Text style={styles.label}>
              {t("flights.sortBy", { defaultValue: "Sort by" })}
            </Text>
            <View style={styles.chipRow}>
              {SORTS.map((s) => (
                <TouchableOpacity
                  key={s.value}
                  style={[styles.chip, sortBy === s.value && styles.chipActive]}
                  onPress={() => setSortBy(s.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      sortBy === s.value && styles.chipTextActive,
                    ]}
                  >
                    {t(s.labelKey, { defaultValue: s.fallback })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Extra passenger types */}
          <View>
            <Text style={styles.label}>
              {t("flights.morePassengers", { defaultValue: "More passengers" })}
            </Text>
            <View style={{ gap: 8 }}>
              {renderStepper(
                t("flights.children", { defaultValue: "Children" }),
                t("flights.childrenAge", { defaultValue: "Aged 2–11" }),
                children,
                setChildren,
                0,
                children + (MAX_PASSENGERS - totalPassengers)
              )}
              {renderStepper(
                t("flights.infantsInSeat", { defaultValue: "Infants in seat" }),
                null,
                infantsInSeat,
                setInfantsInSeat,
                0,
                infantsInSeat + (MAX_PASSENGERS - totalPassengers)
              )}
              {renderStepper(
                t("flights.infantsOnLap", { defaultValue: "Infants on lap" }),
                null,
                infantsOnLap,
                setInfantsOnLap,
                0,
                infantsOnLap + (MAX_PASSENGERS - totalPassengers)
              )}
            </View>
          </View>

          {/* Bags */}
          <View>
            <Text style={styles.label}>
              {t("flights.bags", { defaultValue: "Bags" })}
            </Text>
            <View style={{ gap: 8 }}>
              {renderStepper(
                t("flights.carryOnBags", { defaultValue: "Carry-on bags" }),
                null,
                carryOnBags,
                setCarryOnBags,
                0,
                seatedPassengers
              )}
              {renderStepper(
                t("flights.checkedBags", { defaultValue: "Checked bags" }),
                null,
                checkedBags,
                setCheckedBags,
                0,
                seatedPassengers
              )}
            </View>
          </View>

          {/* Boolean flags */}
          <View>
            <Text style={styles.label}>
              {t("flights.options", { defaultValue: "Options" })}
            </Text>
            <View style={styles.chipRow}>
              {(
                [
                  {
                    active: showCheapest,
                    toggle: () => setShowCheapest((v) => !v),
                    icon: "pricetag-outline" as const,
                    label: t("flights.showCheapest", { defaultValue: "Cheapest flights" }),
                  },
                  {
                    active: showHidden,
                    toggle: () => setShowHidden((v) => !v),
                    icon: "eye-outline" as const,
                    label: t("flights.showHidden", { defaultValue: "Show hidden" }),
                  },
                  {
                    active: hideSeparate,
                    toggle: () => setHideSeparate((v) => !v),
                    icon: "git-branch-outline" as const,
                    label: t("flights.hideSelfTransfer", { defaultValue: "Hide self-transfer" }),
                  },
                ]
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.toggleChip, opt.active && styles.chipActive]}
                  onPress={opt.toggle}
                >
                  <Ionicons
                    name={opt.active ? "checkmark-circle" : opt.icon}
                    size={14}
                    color={opt.active ? "#000000" : colors.textMuted}
                  />
                  <Text
                    style={[styles.chipText, opt.active && styles.chipTextActive]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* CTA */}
      <TouchableOpacity
        style={[styles.submitWrap, !canSubmit && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!canSubmit}
        activeOpacity={0.9}
      >
        <LinearGradient
          colors={[colors.primary, "#34C759"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.submit}
        >
          <Ionicons name="search" size={18} color="#1A1A1A" />
          <Text style={styles.submitText}>
            {loading
              ? t("flights.searching", { defaultValue: "Searching…" })
              : t("flights.findFlights", { defaultValue: "Find flights" })}
          </Text>
        </LinearGradient>
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        {t("flights.searchDisclaimer", {
          defaultValue:
            "Planera helps you discover flight options. Booking and payment are completed directly with external providers. Prices and availability may change.",
        })}
      </Text>

      {/* Date range calendar */}
      <Modal
        visible={calendarOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCalendarOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setCalendarOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {t("flights.selectDates", { defaultValue: "Select your dates" })}
              </Text>
              <TouchableOpacity onPress={() => setCalendarOpen(false)}>
                <Text style={styles.modalClose}>{t("common.done", { defaultValue: "Done" })}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>
              {selectingDate === "out"
                ? t("flights.outbound", { defaultValue: "Outbound" })
                : t("flights.return", { defaultValue: "Return" })}
            </Text>
            <Calendar
              initialDate={selectingDate === "out" ? outboundDate : returnDate || outboundDate}
              minDate={selectingDate === "ret" ? addDays(outboundDate, 1) : toDateString(new Date())}
              onDayPress={onDayPress}
              markingType="period"
              markedDates={markedDates}
              theme={{
                backgroundColor: colors.card,
                calendarBackground: colors.card,
                textSectionTitleColor: colors.primary,
                selectedDayBackgroundColor: colors.primary,
                selectedDayTextColor: colors.text,
                todayTextColor: colors.primary,
                dayTextColor: colors.text,
                textDisabledColor: colors.border,
                arrowColor: colors.primary,
                monthTextColor: colors.text,
                textDayFontWeight: "500",
                textMonthFontWeight: "700",
                textDayHeaderFontWeight: "600",
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
