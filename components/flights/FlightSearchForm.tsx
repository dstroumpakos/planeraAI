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
import type { FlightSearchInput, StopsFilter } from "@/types/flights";

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
  const [stops, setStops] = useState<StopsFilter>(initial?.stops ?? "any");
  const [maxPrice, setMaxPrice] = useState(
    initial?.maxPrice != null ? String(initial.maxPrice) : ""
  );
  const [currency] = useState(initial?.currency ?? "EUR");

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
      stops,
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

      {/* Passengers */}
      <View>
        <Text style={styles.label}>{t("flights.passengers", { defaultValue: "Passengers" })}</Text>
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
            style={[styles.stepperBtn, adults >= 9 && { opacity: 0.4 }]}
            onPress={() => setAdults(Math.min(9, adults + 1))}
            disabled={adults >= 9}
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
