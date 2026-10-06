import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import React from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, Image, StatusBar, Platform, PanResponder, KeyboardAvoidingView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, DateData } from 'react-native-calendars';
import DateTimePicker from '@react-native-community/datetimepicker';
import { INTERESTS } from "@/lib/data";
import { useTheme } from "@/lib/ThemeContext";
import { useAuthenticatedMutation, useToken } from "@/lib/useAuthenticatedMutation";
import AIConsentModal from "@/components/AIConsentModal";
import { useTranslation } from "react-i18next";
import { TripGuideTooltip, GuideStep } from "@/components/FirstTripGuide";
import { CITY_TRANSLATIONS, COUNTRY_TRANSLATIONS, normalizeDestinationToEnglish } from "@/lib/destinationTranslations";
import { canonicalHomeAirport, resolveHomeIata, airportCityName } from "@/lib/homeAirport";
import { resolveAirport } from "@/lib/destinationAirports";
import { isSameOriginDestination, SAME_ROUTE_ERROR } from "@/lib/sameRoute";
import { countTripDays, maxEndDate, MAX_TRIP_DAYS } from "@/lib/tripDays";

import logoImage from "@/assets/images/appicon-1024x1024-01-1vb1vx.png";

// Local Experiences categories
const LOCAL_EXPERIENCES = [
    { id: "local-food", labelKey: "createTrip.localFood", icon: "restaurant" as const },
    { id: "markets", labelKey: "createTrip.traditionalMarkets", icon: "storefront" as const },
    { id: "hidden-gems", labelKey: "createTrip.hiddenGems", icon: "compass" as const },
    { id: "workshops", labelKey: "createTrip.culturalWorkshops", icon: "color-palette" as const },
    { id: "nature", labelKey: "createTrip.natureOutdoor", icon: "leaf" as const },
    { id: "nightlife", labelKey: "createTrip.nightlife", icon: "wine" as const },
    { id: "neighborhoods", labelKey: "createTrip.neighborhoodWalks", icon: "walk" as const },
    { id: "festivals", labelKey: "createTrip.festivals", icon: "calendar" as const },
];

// Popular destinations list
const DESTINATIONS = [
    // Western Europe
    { city: "Paris", country: "France", image: "🇫🇷" },
    { city: "London", country: "UK", image: "🇬🇧" },
    { city: "Rome", country: "Italy", image: "🇮🇹" },
    { city: "Barcelona", country: "Spain", image: "🇪🇸" },
    { city: "Amsterdam", country: "Netherlands", image: "🇳🇱" },
    { city: "Berlin", country: "Germany", image: "🇩🇪" },
    { city: "Madrid", country: "Spain", image: "🇪🇸" },
    { city: "Milan", country: "Italy", image: "🇮🇹" },
    { city: "Florence", country: "Italy", image: "🇮🇹" },
    { city: "Venice", country: "Italy", image: "🇮🇹" },
    { city: "Munich", country: "Germany", image: "🇩🇪" },
    { city: "Lisbon", country: "Portugal", image: "🇵🇹" },
    { city: "Porto", country: "Portugal", image: "🇵🇹" },
    { city: "Dublin", country: "Ireland", image: "🇮🇪" },
    { city: "Vienna", country: "Austria", image: "🇦🇹" },
    { city: "Zurich", country: "Switzerland", image: "🇨🇭" },
    { city: "Geneva", country: "Switzerland", image: "🇨🇭" },
    { city: "Brussels", country: "Belgium", image: "🇧🇪" },
    { city: "Nice", country: "France", image: "🇫🇷" },
    { city: "Lyon", country: "France", image: "🇫🇷" },
    { city: "Marseille", country: "France", image: "🇫🇷" },
    { city: "Seville", country: "Spain", image: "🇪🇸" },
    { city: "Valencia", country: "Spain", image: "🇪🇸" },
    { city: "Malaga", country: "Spain", image: "🇪🇸" },
    { city: "Ibiza", country: "Spain", image: "🇪🇸" },
    { city: "Palma de Mallorca", country: "Spain", image: "🇪🇸" },
    { city: "Naples", country: "Italy", image: "🇮🇹" },
    { city: "Amalfi", country: "Italy", image: "🇮🇹" },
    { city: "Cinque Terre", country: "Italy", image: "🇮🇹" },
    { city: "Edinburgh", country: "UK", image: "🇬🇧" },
    { city: "Manchester", country: "UK", image: "🇬🇧" },
    { city: "Hamburg", country: "Germany", image: "🇩🇪" },
    { city: "Düsseldorf", country: "Germany", image: "🇩🇪" },
    { city: "Cologne", country: "Germany", image: "🇩🇪" },
    { city: "Luxembourg City", country: "Luxembourg", image: "🇱🇺" },
    { city: "Monaco", country: "Monaco", image: "🇲🇨" },
    { city: "Valletta", country: "Malta", image: "🇲🇹" },
    { city: "Gozo", country: "Malta", image: "🇲🇹" },
    { city: "Andorra la Vella", country: "Andorra", image: "🇦🇩" },
    { city: "San Marino", country: "San Marino", image: "🇸🇲" },
    { city: "Bordeaux", country: "France", image: "🇫🇷" },
    { city: "Strasbourg", country: "France", image: "🇫🇷" },
    { city: "Toulouse", country: "France", image: "🇫🇷" },
    { city: "Montpellier", country: "France", image: "🇫🇷" },
    { city: "Cannes", country: "France", image: "🇫🇷" },
    { city: "Corsica", country: "France", image: "🇫🇷" },
    { city: "Granada", country: "Spain", image: "🇪🇸" },
    { city: "Bilbao", country: "Spain", image: "🇪🇸" },
    { city: "San Sebastián", country: "Spain", image: "🇪🇸" },
    { city: "Tenerife", country: "Spain", image: "🇪🇸" },
    { city: "Gran Canaria", country: "Spain", image: "🇪🇸" },
    { city: "Lanzarote", country: "Spain", image: "🇪🇸" },
    { city: "Fuerteventura", country: "Spain", image: "🇪🇸" },
    { city: "Menorca", country: "Spain", image: "🇪🇸" },
    { city: "Sardinia", country: "Italy", image: "🇮🇹" },
    { city: "Sicily", country: "Italy", image: "🇮🇹" },
    { city: "Bologna", country: "Italy", image: "🇮🇹" },
    { city: "Turin", country: "Italy", image: "🇮🇹" },
    { city: "Verona", country: "Italy", image: "🇮🇹" },
    { city: "Genoa", country: "Italy", image: "🇮🇹" },
    { city: "Bari", country: "Italy", image: "🇮🇹" },
    { city: "Puglia", country: "Italy", image: "🇮🇹" },
    { city: "Lake Como", country: "Italy", image: "🇮🇹" },
    { city: "Frankfurt", country: "Germany", image: "🇩🇪" },
    { city: "Dresden", country: "Germany", image: "🇩🇪" },
    { city: "Stuttgart", country: "Germany", image: "🇩🇪" },
    { city: "Nuremberg", country: "Germany", image: "🇩🇪" },
    { city: "Leipzig", country: "Germany", image: "🇩🇪" },
    { city: "Salzburg", country: "Austria", image: "🇦🇹" },
    { city: "Innsbruck", country: "Austria", image: "🇦🇹" },
    { city: "Graz", country: "Austria", image: "🇦🇹" },
    { city: "The Hague", country: "Netherlands", image: "🇳🇱" },
    { city: "Rotterdam", country: "Netherlands", image: "🇳🇱" },
    { city: "Utrecht", country: "Netherlands", image: "🇳🇱" },
    { city: "Bruges", country: "Belgium", image: "🇧🇪" },
    { city: "Ghent", country: "Belgium", image: "🇧🇪" },
    { city: "Antwerp", country: "Belgium", image: "🇧🇪" },
    { city: "Bath", country: "UK", image: "🇬🇧" },
    { city: "Liverpool", country: "UK", image: "🇬🇧" },
    { city: "York", country: "UK", image: "🇬🇧" },
    { city: "Oxford", country: "UK", image: "🇬🇧" },
    { city: "Cambridge", country: "UK", image: "🇬🇧" },
    { city: "Glasgow", country: "UK", image: "🇬🇧" },
    { city: "Belfast", country: "UK", image: "🇬🇧" },
    { city: "Cardiff", country: "UK", image: "🇬🇧" },
    { city: "Galway", country: "Ireland", image: "🇮🇪" },
    { city: "Cork", country: "Ireland", image: "🇮🇪" },
    { city: "Algarve", country: "Portugal", image: "🇵🇹" },
    { city: "Madeira", country: "Portugal", image: "🇵🇹" },
    { city: "Azores", country: "Portugal", image: "🇵🇹" },
    { city: "Lucerne", country: "Switzerland", image: "🇨🇭" },
    { city: "Interlaken", country: "Switzerland", image: "🇨🇭" },
    { city: "Bern", country: "Switzerland", image: "🇨🇭" },
    // Scandinavia
    { city: "Copenhagen", country: "Denmark", image: "🇩🇰" },
    { city: "Stockholm", country: "Sweden", image: "🇸🇪" },
    { city: "Oslo", country: "Norway", image: "🇳🇴" },
    { city: "Helsinki", country: "Finland", image: "🇫🇮" },
    { city: "Reykjavik", country: "Iceland", image: "🇮🇸" },
    { city: "Bergen", country: "Norway", image: "🇳🇴" },
    { city: "Gothenburg", country: "Sweden", image: "🇸🇪" },
    { city: "Tromsø", country: "Norway", image: "🇳🇴" },
    // Eastern Europe
    { city: "Prague", country: "Czech Republic", image: "🇨🇿" },
    { city: "Budapest", country: "Hungary", image: "🇭🇺" },
    { city: "Warsaw", country: "Poland", image: "🇵🇱" },
    { city: "Kraków", country: "Poland", image: "🇵🇱" },
    { city: "Bucharest", country: "Romania", image: "🇷🇴" },
    { city: "Sofia", country: "Bulgaria", image: "🇧🇬" },
    { city: "Zagreb", country: "Croatia", image: "🇭🇷" },
    { city: "Dubrovnik", country: "Croatia", image: "🇭🇷" },
    { city: "Split", country: "Croatia", image: "🇭🇷" },
    { city: "Ljubljana", country: "Slovenia", image: "🇸🇮" },
    { city: "Belgrade", country: "Serbia", image: "🇷🇸" },
    { city: "Bratislava", country: "Slovakia", image: "🇸🇰" },
    { city: "Košice", country: "Slovakia", image: "🇸🇰" },
    { city: "Tallinn", country: "Estonia", image: "🇪🇪" },
    { city: "Riga", country: "Latvia", image: "🇱🇻" },
    { city: "Vilnius", country: "Lithuania", image: "🇱🇹" },
    { city: "Sarajevo", country: "Bosnia & Herzegovina", image: "🇧🇦" },
    { city: "Mostar", country: "Bosnia & Herzegovina", image: "🇧🇦" },
    { city: "Tirana", country: "Albania", image: "🇦🇱" },
    { city: "Podgorica", country: "Montenegro", image: "🇲🇪" },
    { city: "Kotor", country: "Montenegro", image: "🇲🇪" },
    { city: "Budva", country: "Montenegro", image: "🇲🇪" },
    { city: "Skopje", country: "North Macedonia", image: "🇲🇰" },
    { city: "Ohrid", country: "North Macedonia", image: "🇲🇰" },
    { city: "Pristina", country: "Kosovo", image: "🇽🇰" },
    { city: "Gdańsk", country: "Poland", image: "🇵🇱" },
    { city: "Wrocław", country: "Poland", image: "🇵🇱" },
    { city: "Poznań", country: "Poland", image: "🇵🇱" },
    { city: "Brno", country: "Czech Republic", image: "🇨🇿" },
    { city: "Český Krumlov", country: "Czech Republic", image: "🇨🇿" },
    { city: "Debrecen", country: "Hungary", image: "🇭🇺" },
    { city: "Cluj-Napoca", country: "Romania", image: "🇷🇴" },
    { city: "Transylvania", country: "Romania", image: "🇷🇴" },
    { city: "Sibiu", country: "Romania", image: "🇷🇴" },
    { city: "Timișoara", country: "Romania", image: "🇷🇴" },
    { city: "Plovdiv", country: "Bulgaria", image: "🇧🇬" },
    { city: "Varna", country: "Bulgaria", image: "🇧🇬" },
    { city: "Pula", country: "Croatia", image: "🇭🇷" },
    { city: "Zadar", country: "Croatia", image: "🇭🇷" },
    { city: "Hvar", country: "Croatia", image: "🇭🇷" },
    { city: "Lake Bled", country: "Slovenia", image: "🇸🇮" },
    { city: "Niš", country: "Serbia", image: "🇷🇸" },
    { city: "Novi Sad", country: "Serbia", image: "🇷🇸" },
    { city: "Tbilisi", country: "Georgia", image: "🇬🇪" },
    { city: "Batumi", country: "Georgia", image: "🇬🇪" },
    { city: "Yerevan", country: "Armenia", image: "🇦🇲" },
    { city: "Baku", country: "Azerbaijan", image: "🇦🇿" },
    { city: "Nicosia", country: "Cyprus", image: "🇨🇾" },
    { city: "Paphos", country: "Cyprus", image: "🇨🇾" },
    { city: "Limassol", country: "Cyprus", image: "🇨🇾" },
    { city: "Larnaca", country: "Cyprus", image: "🇨🇾" },
    // Greece
    { city: "Athens", country: "Greece", image: "🇬🇷" },
    { city: "Santorini", country: "Greece", image: "🇬🇷" },
    { city: "Mykonos", country: "Greece", image: "🇬🇷" },
    { city: "Crete", country: "Greece", image: "🇬🇷" },
    { city: "Rhodes", country: "Greece", image: "🇬🇷" },
    { city: "Corfu", country: "Greece", image: "🇬🇷" },
    { city: "Thessaloniki", country: "Greece", image: "🇬🇷" },
    { city: "Zakynthos", country: "Greece", image: "🇬🇷" },
    { city: "Kos", country: "Greece", image: "🇬🇷" },
    { city: "Paros", country: "Greece", image: "🇬🇷" },
    { city: "Naxos", country: "Greece", image: "🇬🇷" },
    { city: "Milos", country: "Greece", image: "🇬🇷" },
    { city: "Kefalonia", country: "Greece", image: "🇬🇷" },
    { city: "Lefkada", country: "Greece", image: "🇬🇷" },
    { city: "Skiathos", country: "Greece", image: "🇬🇷" },
    { city: "Chania", country: "Greece", image: "🇬🇷" },
    { city: "Heraklion", country: "Greece", image: "🇬🇷" },
    { city: "Meteora", country: "Greece", image: "🇬🇷" },
    { city: "Nafplio", country: "Greece", image: "🇬🇷" },
    { city: "Hydra", country: "Greece", image: "🇬🇷" },
    { city: "Samos", country: "Greece", image: "🇬🇷" },
    { city: "Karpathos", country: "Greece", image: "🇬🇷" },
    // Turkey & Middle East
    { city: "Istanbul", country: "Turkey", image: "🇹🇷" },
    { city: "Antalya", country: "Turkey", image: "🇹🇷" },
    { city: "Cappadocia", country: "Turkey", image: "🇹🇷" },
    { city: "Bodrum", country: "Turkey", image: "🇹🇷" },
    { city: "Izmir", country: "Turkey", image: "🇹🇷" },
    { city: "Fethiye", country: "Turkey", image: "🇹🇷" },
    { city: "Pamukkale", country: "Turkey", image: "🇹🇷" },
    { city: "Ephesus", country: "Turkey", image: "🇹🇷" },
    { city: "Trabzon", country: "Turkey", image: "🇹🇷" },
    { city: "Dubai", country: "UAE", image: "🇦🇪" },
    { city: "Abu Dhabi", country: "UAE", image: "🇦🇪" },
    { city: "Doha", country: "Qatar", image: "🇶🇦" },
    { city: "Tel Aviv", country: "Israel", image: "🇮🇱" },
    { city: "Jerusalem", country: "Israel", image: "🇮🇱" },
    { city: "Amman", country: "Jordan", image: "🇯🇴" },
    { city: "Petra", country: "Jordan", image: "🇯🇴" },
    { city: "Dead Sea", country: "Jordan", image: "🇯🇴" },
    { city: "Muscat", country: "Oman", image: "🇴🇲" },
    { city: "Riyadh", country: "Saudi Arabia", image: "🇸🇦" },
    { city: "Jeddah", country: "Saudi Arabia", image: "🇸🇦" },
    { city: "AlUla", country: "Saudi Arabia", image: "🇸🇦" },
    { city: "Bahrain", country: "Bahrain", image: "🇧🇭" },
    { city: "Kuwait City", country: "Kuwait", image: "🇰🇼" },
    { city: "Beirut", country: "Lebanon", image: "🇱🇧" },
    // North Africa
    { city: "Marrakech", country: "Morocco", image: "🇲🇦" },
    { city: "Fez", country: "Morocco", image: "🇲🇦" },
    { city: "Cairo", country: "Egypt", image: "🇪🇬" },
    { city: "Hurghada", country: "Egypt", image: "🇪🇬" },
    { city: "Tunis", country: "Tunisia", image: "🇹🇳" },
    { city: "Djerba", country: "Tunisia", image: "🇹🇳" },
    { city: "Algiers", country: "Algeria", image: "🇩🇿" },
    // Sub-Saharan Africa
    { city: "Cape Town", country: "South Africa", image: "🇿🇦" },
    { city: "Johannesburg", country: "South Africa", image: "🇿🇦" },
    { city: "Durban", country: "South Africa", image: "🇿🇦" },
    { city: "Kruger National Park", country: "South Africa", image: "🇿🇦" },
    { city: "Nairobi", country: "Kenya", image: "🇰🇪" },
    { city: "Mombasa", country: "Kenya", image: "🇰🇪" },
    { city: "Masai Mara", country: "Kenya", image: "🇰🇪" },
    { city: "Zanzibar", country: "Tanzania", image: "🇹🇿" },
    { city: "Dar es Salaam", country: "Tanzania", image: "🇹🇿" },
    { city: "Serengeti", country: "Tanzania", image: "🇹🇿" },
    { city: "Kilimanjaro", country: "Tanzania", image: "🇹🇿" },
    { city: "Lagos", country: "Nigeria", image: "🇳🇬" },
    { city: "Accra", country: "Ghana", image: "🇬🇭" },
    { city: "Addis Ababa", country: "Ethiopia", image: "🇪🇹" },
    { city: "Victoria Falls", country: "Zimbabwe", image: "🇿🇼" },
    { city: "Windhoek", country: "Namibia", image: "🇳🇦" },
    { city: "Dakar", country: "Senegal", image: "🇸🇳" },
    { city: "Kigali", country: "Rwanda", image: "🇷🇼" },
    { city: "Mauritius", country: "Mauritius", image: "🇲🇺" },
    { city: "Seychelles", country: "Seychelles", image: "🇸🇨" },
    { city: "Casablanca", country: "Morocco", image: "🇲🇦" },
    { city: "Chefchaouen", country: "Morocco", image: "🇲🇦" },
    { city: "Essaouira", country: "Morocco", image: "🇲🇦" },
    { city: "Luxor", country: "Egypt", image: "🇪🇬" },
    { city: "Sharm El Sheikh", country: "Egypt", image: "🇪🇬" },
    { city: "Alexandria", country: "Egypt", image: "🇪🇬" },
    // East Asia
    { city: "Tokyo", country: "Japan", image: "🇯🇵" },
    { city: "Kyoto", country: "Japan", image: "🇯🇵" },
    { city: "Osaka", country: "Japan", image: "🇯🇵" },
    { city: "Seoul", country: "South Korea", image: "🇰🇷" },
    { city: "Busan", country: "South Korea", image: "🇰🇷" },
    { city: "Shanghai", country: "China", image: "🇨🇳" },
    { city: "Beijing", country: "China", image: "🇨🇳" },
    { city: "Hong Kong", country: "Hong Kong", image: "🇭🇰" },
    { city: "Taipei", country: "Taiwan", image: "🇹🇼" },
    // Southeast Asia
    { city: "Bangkok", country: "Thailand", image: "🇹🇭" },
    { city: "Phuket", country: "Thailand", image: "🇹🇭" },
    { city: "Chiang Mai", country: "Thailand", image: "🇹🇭" },
    { city: "Bali", country: "Indonesia", image: "🇮🇩" },
    { city: "Jakarta", country: "Indonesia", image: "🇮🇩" },
    { city: "Singapore", country: "Singapore", image: "🇸🇬" },
    { city: "Kuala Lumpur", country: "Malaysia", image: "🇲🇾" },
    { city: "Ho Chi Minh City", country: "Vietnam", image: "🇻🇳" },
    { city: "Hanoi", country: "Vietnam", image: "🇻🇳" },
    { city: "Manila", country: "Philippines", image: "🇵🇭" },
    { city: "Siem Reap", country: "Cambodia", image: "🇰🇭" },
    { city: "Phnom Penh", country: "Cambodia", image: "🇰🇭" },
    { city: "Luang Prabang", country: "Laos", image: "🇱🇦" },
    { city: "Yangon", country: "Myanmar", image: "🇲🇲" },
    { city: "Penang", country: "Malaysia", image: "🇲🇾" },
    { city: "Langkawi", country: "Malaysia", image: "🇲🇾" },
    { city: "Boracay", country: "Philippines", image: "🇵🇭" },
    { city: "Cebu", country: "Philippines", image: "🇵🇭" },
    { city: "Palawan", country: "Philippines", image: "🇵🇭" },
    { city: "Da Nang", country: "Vietnam", image: "🇻🇳" },
    { city: "Hoi An", country: "Vietnam", image: "🇻🇳" },
    { city: "Ha Long Bay", country: "Vietnam", image: "🇻🇳" },
    { city: "Lombok", country: "Indonesia", image: "🇮🇩" },
    { city: "Yogyakarta", country: "Indonesia", image: "🇮🇩" },
    // South Asia
    { city: "New Delhi", country: "India", image: "🇮🇳" },
    { city: "Mumbai", country: "India", image: "🇮🇳" },
    { city: "Goa", country: "India", image: "🇮🇳" },
    { city: "Jaipur", country: "India", image: "🇮🇳" },
    { city: "Colombo", country: "Sri Lanka", image: "🇱🇰" },
    { city: "Ella", country: "Sri Lanka", image: "🇱🇰" },
    { city: "Kathmandu", country: "Nepal", image: "🇳🇵" },
    { city: "Pokhara", country: "Nepal", image: "🇳🇵" },
    { city: "Maldives", country: "Maldives", image: "🇲🇻" },
    { city: "Udaipur", country: "India", image: "🇮🇳" },
    { city: "Varanasi", country: "India", image: "🇮🇳" },
    { city: "Kerala", country: "India", image: "🇮🇳" },
    { city: "Agra", country: "India", image: "🇮🇳" },
    { city: "Rishikesh", country: "India", image: "🇮🇳" },
    { city: "Bhutan", country: "Bhutan", image: "🇧🇹" },
    // Oceania
    { city: "Sydney", country: "Australia", image: "🇦🇺" },
    { city: "Melbourne", country: "Australia", image: "🇦🇺" },
    { city: "Brisbane", country: "Australia", image: "🇦🇺" },
    { city: "Perth", country: "Australia", image: "🇦🇺" },
    { city: "Auckland", country: "New Zealand", image: "🇳🇿" },
    { city: "Queenstown", country: "New Zealand", image: "🇳🇿" },
    { city: "Fiji", country: "Fiji", image: "🇫🇯" },
    { city: "Bora Bora", country: "French Polynesia", image: "🇵🇫" },
    { city: "Tahiti", country: "French Polynesia", image: "🇵🇫" },
    { city: "Gold Coast", country: "Australia", image: "🇦🇺" },
    { city: "Adelaide", country: "Australia", image: "🇦🇺" },
    { city: "Cairns", country: "Australia", image: "🇦🇺" },
    { city: "Great Barrier Reef", country: "Australia", image: "🇦🇺" },
    { city: "Wellington", country: "New Zealand", image: "🇳🇿" },
    { city: "Rotorua", country: "New Zealand", image: "🇳🇿" },
    { city: "Christchurch", country: "New Zealand", image: "🇳🇿" },
    // North America
    { city: "New York", country: "USA", image: "🇺🇸" },
    { city: "Los Angeles", country: "USA", image: "🇺🇸" },
    { city: "San Francisco", country: "USA", image: "🇺🇸" },
    { city: "Miami", country: "USA", image: "🇺🇸" },
    { city: "Las Vegas", country: "USA", image: "🇺🇸" },
    { city: "Chicago", country: "USA", image: "🇺🇸" },
    { city: "Washington D.C.", country: "USA", image: "🇺🇸" },
    { city: "Boston", country: "USA", image: "🇺🇸" },
    { city: "Seattle", country: "USA", image: "🇺🇸" },
    { city: "Honolulu", country: "USA", image: "🇺🇸" },
    { city: "New Orleans", country: "USA", image: "🇺🇸" },
    { city: "Nashville", country: "USA", image: "🇺🇸" },
    { city: "Austin", country: "USA", image: "🇺🇸" },
    { city: "San Diego", country: "USA", image: "🇺🇸" },
    { city: "Orlando", country: "USA", image: "🇺🇸" },
    { city: "Denver", country: "USA", image: "🇺🇸" },
    { city: "Portland", country: "USA", image: "🇺🇸" },
    { city: "Philadelphia", country: "USA", image: "🇺🇸" },
    { city: "Savannah", country: "USA", image: "🇺🇸" },
    { city: "Aspen", country: "USA", image: "🇺🇸" },
    { city: "Key West", country: "USA", image: "🇺🇸" },
    { city: "Maui", country: "USA", image: "🇺🇸" },
    { city: "Toronto", country: "Canada", image: "🇨🇦" },
    { city: "Vancouver", country: "Canada", image: "🇨🇦" },
    { city: "Montreal", country: "Canada", image: "🇨🇦" },
    { city: "Quebec City", country: "Canada", image: "🇨🇦" },
    { city: "Calgary", country: "Canada", image: "🇨🇦" },
    { city: "Banff", country: "Canada", image: "🇨🇦" },
    { city: "Ottawa", country: "Canada", image: "🇨🇦" },
    // Caribbean & Central America
    { city: "Cancun", country: "Mexico", image: "🇲🇽" },
    { city: "Mexico City", country: "Mexico", image: "🇲🇽" },
    { city: "Playa del Carmen", country: "Mexico", image: "🇲🇽" },
    { city: "Tulum", country: "Mexico", image: "🇲🇽" },
    { city: "Havana", country: "Cuba", image: "🇨🇺" },
    { city: "San Juan", country: "Puerto Rico", image: "🇵🇷" },
    { city: "Punta Cana", country: "Dominican Republic", image: "🇩🇴" },
    { city: "Nassau", country: "Bahamas", image: "🇧🇸" },
    { city: "Jamaica", country: "Jamaica", image: "🇯🇲" },
    { city: "Costa Rica", country: "Costa Rica", image: "🇨🇷" },
    { city: "Panama City", country: "Panama", image: "🇵🇦" },
    // South America
    { city: "Rio de Janeiro", country: "Brazil", image: "🇧🇷" },
    { city: "São Paulo", country: "Brazil", image: "🇧🇷" },
    { city: "Buenos Aires", country: "Argentina", image: "🇦🇷" },
    { city: "Lima", country: "Peru", image: "🇵🇪" },
    { city: "Cusco", country: "Peru", image: "🇵🇪" },
    { city: "Bogotá", country: "Colombia", image: "🇨🇴" },
    { city: "Medellín", country: "Colombia", image: "🇨🇴" },
    { city: "Cartagena", country: "Colombia", image: "🇨🇴" },
    { city: "Santiago", country: "Chile", image: "🇨🇱" },
    { city: "Quito", country: "Ecuador", image: "🇪🇨" },
    { city: "Galápagos Islands", country: "Ecuador", image: "🇪🇨" },
    { city: "Montevideo", country: "Uruguay", image: "🇺🇾" },
    { city: "La Paz", country: "Bolivia", image: "🇧🇴" },
    { city: "Patagonia", country: "Argentina", image: "🇦🇷" },
    { city: "Bariloche", country: "Argentina", image: "🇦🇷" },
    { city: "Mendoza", country: "Argentina", image: "🇦🇷" },
    { city: "Salvador", country: "Brazil", image: "🇧🇷" },
    { city: "Florianópolis", country: "Brazil", image: "🇧🇷" },
    // Caribbean extras
    { city: "Oaxaca", country: "Mexico", image: "🇲🇽" },
    { city: "Puerto Vallarta", country: "Mexico", image: "🇲🇽" },
    { city: "Guadalajara", country: "Mexico", image: "🇲🇽" },
    { city: "Los Cabos", country: "Mexico", image: "🇲🇽" },
    { city: "Aruba", country: "Aruba", image: "🇦🇼" },
    { city: "Curaçao", country: "Curaçao", image: "🇨🇼" },
    { city: "Barbados", country: "Barbados", image: "🇧🇧" },
    { city: "St. Lucia", country: "Saint Lucia", image: "🇱🇨" },
    { city: "Antigua", country: "Antigua & Barbuda", image: "🇦🇬" },
    { city: "Trinidad", country: "Trinidad & Tobago", image: "🇹🇹" },
    { city: "Bermuda", country: "Bermuda", image: "🇧🇲" },
    { city: "Cayman Islands", country: "Cayman Islands", image: "🇰🇾" },
    { city: "Guatemala City", country: "Guatemala", image: "🇬🇹" },
    { city: "Belize City", country: "Belize", image: "🇧🇿" },
    // Russia & Central Asia
    { city: "Moscow", country: "Russia", image: "🇷🇺" },
    { city: "St. Petersburg", country: "Russia", image: "🇷🇺" },
    { city: "Tashkent", country: "Uzbekistan", image: "🇺🇿" },
    { city: "Samarkand", country: "Uzbekistan", image: "🇺🇿" },
    // East Asia extras
    { city: "Hiroshima", country: "Japan", image: "🇯🇵" },
    { city: "Nara", country: "Japan", image: "🇯🇵" },
    { city: "Hakone", country: "Japan", image: "🇯🇵" },
    { city: "Sapporo", country: "Japan", image: "🇯🇵" },
    { city: "Okinawa", country: "Japan", image: "🇯🇵" },
    { city: "Jeju Island", country: "South Korea", image: "🇰🇷" },
    { city: "Guangzhou", country: "China", image: "🇨🇳" },
    { city: "Chengdu", country: "China", image: "🇨🇳" },
    { city: "Xi'an", country: "China", image: "🇨🇳" },
    { city: "Macau", country: "Macau", image: "🇲🇴" },
    { city: "Ulaanbaatar", country: "Mongolia", image: "🇲🇳" },
];


// ─── Step builder ───────────────────────────────────────────────────────────
// The create flow is five short steps instead of one long scroll. Everything
// below is presentation: the payload sent to `trips.create` is unchanged.
const TOTAL_STEPS = 5;
const MAX_VIBES = 3;
const BUDGET_MIN = 300;
const BUDGET_MAX = 12000;
const GOLD = "#C09329";
const GOLD_SOFT = "rgba(192,147,41,0.55)";
const CHEAP_GREEN = "#1FA463";
/** Stable empty object so an unpriced month doesn't churn memo dependencies. */
const EMPTY_FARES: Record<string, number> = {};

/** Perforation dot positions, as a percentage along each edge of a stamp. */
const PERF_H = [4, 16, 28, 40, 52, 64, 76, 88, 96];
const PERF_V = [6, 20, 34, 48, 62, 76, 90];

/** Six vibes, each mapping onto an INTERESTS value the generator already takes. */
const VIBES = [
    { id: "Culture", hintKey: "createTrip.vibeCultureHint", icon: "library" as const },
    { id: "Culinary", hintKey: "createTrip.vibeFoodHint", icon: "restaurant" as const },
    { id: "Relaxation", hintKey: "createTrip.vibeSlowHint", icon: "cafe" as const },
    { id: "Nightlife", hintKey: "createTrip.vibeNightHint", icon: "wine" as const },
    { id: "Nature", hintKey: "createTrip.vibeOutdoorsHint", icon: "leaf" as const },
    { id: "Shopping", hintKey: "createTrip.vibeShoppingHint", icon: "cart" as const },
];

const LENGTH_PRESETS = [
    { key: "createTrip.lenWeekend", nights: 2 },
    { key: "createTrip.lenFive", nights: 4 },
    { key: "createTrip.lenWeek", nights: 6 },
    { key: "createTrip.lenTwoWeeks", nights: 13 },
];

const PARTY_PRESETS = [
    { key: "createTrip.partySolo", count: 1 },
    { key: "createTrip.partyCouple", count: 2 },
    { key: "createTrip.partyFamily", count: 4 },
    { key: "createTrip.partyGroup", count: 6 },
];

const TIERS = [
    { id: "budget", labelKey: "createTrip.budget" },
    { id: "moderate", labelKey: "createTrip.moderate" },
    { id: "high", labelKey: "createTrip.high" },
    { id: "premium", labelKey: "createTrip.premium" },
];

/** Local flavour is the optional second tier, revealed once a vibe is picked. */
const FLAVOUR_IDS = ["hidden-gems", "markets", "workshops", "neighborhoods"];

/** Which builder step each first-trip guide tip belongs to. */
const GUIDE_STEP_INDEX: Record<string, number> = {
    destination: 1, dates: 2, travelers: 3, budget: 3, interests: 4, generate: 5,
};

/**
 * Map the ten INTERESTS values onto the six vibe cards the builder shows.
 * Anything without a card is dropped rather than held as an invisible pick.
 */
const INTEREST_TO_VIBE: Record<string, string> = {
    Adventure: "Nature",
    History: "Culture",
    Culinary: "Culinary",
    Culture: "Culture",
    Relaxation: "Relaxation",
    Nightlife: "Nightlife",
    Nature: "Nature",
    Shopping: "Shopping",
};

function toVibeIds(values: string[]): string[] {
    const out: string[] = [];
    for (const value of values || []) {
        const mapped = INTEREST_TO_VIBE[value];
        if (mapped && !out.includes(mapped)) out.push(mapped);
    }
    return out.slice(0, MAX_VIBES);
}

function splitDestination(value: string): [string, string] {
    const parts = String(value || "").split(",").map((s) => s.trim());
    return [parts[0] || "", parts[1] || ""];
}

/** "Rome, Italy" → "Ρώμη, Ιταλία" for display. The stored value stays English. */
function localDestinationLabel(value: string, lang: string): string {
    const [city, country] = splitDestination(value);
    const localCity = (CITY_TRANSLATIONS[city] as any)?.[lang] || city;
    const localCountry = country ? ((COUNTRY_TRANSLATIONS[country] as any)?.[lang] || country) : "";
    return localCountry ? `${localCity}, ${localCountry}` : localCity;
}

export default function CreateTripScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { colors, isDarkMode } = useTheme();
    const { t, i18n } = useTranslation();
    const prefilledDestination = params.prefilledDestination as string | undefined;
    const prefilledStartDate = params.prefilledStartDate as string | undefined;
    const prefilledEndDate = params.prefilledEndDate as string | undefined;
    const prefilledBudget = params.prefilledBudget as string | undefined;
    const prefilledTravelers = params.prefilledTravelers as string | undefined;
    const prefilledInterests = params.prefilledInterests as string | undefined;
    const prefilledArrivalTime = params.prefilledArrivalTime as string | undefined;
    const prefilledDepartureTime = params.prefilledDepartureTime as string | undefined;
    
    // @ts-ignore
    const createTrip = useAuthenticatedMutation(api.trips.create as any);
    const markGuideSeen = useMutation(api.users.markFirstTripGuideSeen as any);
    const { token } = useToken();
    // @ts-ignore
    const userSettings = useQuery(api.users.getSettings as any, token ? { token } : "skip") as any;
    // @ts-ignore
    const userPlan = useQuery(api.users.getPlan as any, token ? { token } : "skip") as any;
    // V1: Traveler profiles disabled - removed travelers query
    
    const [loading, setLoading] = useState(false);
    const [showCalendar, setShowCalendar] = useState(false);
    const [selectingDate, setSelectingDate] = useState<'start' | 'end'>('start');
    const [showLoadingScreen, setShowLoadingScreen] = useState(false);
    const [showErrorScreen, setShowErrorScreen] = useState(false);
    const [isCreditsError, setIsCreditsError] = useState(false);
    const [showAiConsentModal, setShowAiConsentModal] = useState(false);
    
    // AI data consent
    const updateAiConsent = useMutation(api.users.updateAiConsent);
    
    // Time picker state for arrival/departure times
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [selectingTime, setSelectingTime] = useState<'arrival' | 'departure'>('arrival');
    const [tempTime, setTempTime] = useState(new Date());

    const [errorMessage, setErrorMessage] = useState("");
    const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
    const [destinationSuggestions, setDestinationSuggestions] = useState<typeof DESTINATIONS>([]);

    // ─── First-trip guide state ───
    const isFromGuide = params.fromGuide === "true";
    const [guideStep, setGuideStep] = useState(isFromGuide ? 0 : -1);
    const scrollRef = useRef<ScrollView>(null);
    const sectionRefs = useRef<Record<string, View | null>>({});

    const GUIDE_STEPS: GuideStep[] = [
        { key: "destination", title: t("firstTripGuide.tipDestTitle"), description: t("firstTripGuide.tipDestDesc") },
        { key: "dates", title: t("firstTripGuide.tipDatesTitle"), description: t("firstTripGuide.tipDatesDesc") },
        { key: "travelers", title: t("firstTripGuide.tipTravelersTitle"), description: t("firstTripGuide.tipTravelersDesc") },
        { key: "budget", title: t("firstTripGuide.tipBudgetTitle"), description: t("firstTripGuide.tipBudgetDesc") },
        { key: "interests", title: t("firstTripGuide.tipInterestsTitle"), description: t("firstTripGuide.tipInterestsDesc") },
        { key: "generate", title: t("firstTripGuide.tipGenerateTitle"), description: t("firstTripGuide.tipGenerateDesc") },
    ];

    const guideActive = guideStep >= 0 && guideStep < GUIDE_STEPS.length;
    const currentGuideKey = guideActive ? GUIDE_STEPS[guideStep].key : null;

    const scrollToSection = useCallback((key: string) => {
        const ref = sectionRefs.current[key];
        if (ref && scrollRef.current) {
            ref.measureLayout(
                (scrollRef.current as any).getInnerViewRef() as any,
                (_x: number, y: number) => {
                    scrollRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: true });
                },
                () => {}
            );
        }
    }, []);

    const advanceGuide = useCallback(() => {
        const next = guideStep + 1;
        if (next < GUIDE_STEPS.length) {
            setGuideStep(next);
            const target = GUIDE_STEP_INDEX[GUIDE_STEPS[next].key];
            if (target) setStep(target);
        } else {
            setGuideStep(-1); // guide complete
        }
    }, [guideStep, GUIDE_STEPS, scrollToSection]);

    const dismissGuide = useCallback(() => {
        setGuideStep(-1);
    }, []);

    // Auto-scroll to first step on mount
    useEffect(() => {
        if (isFromGuide && guideStep === 0) {
            setTimeout(() => scrollToSection("destination"), 500);
        }
    }, []);

    const getHighlightStyle = (key: string) => {
        if (currentGuideKey === key) {
            return {
                borderWidth: 2,
                borderColor: colors.primary,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 8,
            };
        }
        return {};
    };

    const [formData, setFormData] = useState({
        destination: prefilledDestination || "",
        origin: "San Francisco, CA",
        startDate: prefilledStartDate ? Number(prefilledStartDate) : new Date().getTime(),
        endDate: prefilledEndDate ? Number(prefilledEndDate) : new Date().getTime() + 7 * 24 * 60 * 60 * 1000,
         // V1: budgetTotal is the primary budget field
        budgetTotal: prefilledBudget ? Number(prefilledBudget) : 2000,
        // V1: travelerCount is the primary traveler count field (1-12)
        travelerCount: prefilledTravelers ? Number(prefilledTravelers) : 1,
        interests: prefilledInterests ? toVibeIds(prefilledInterests.split(",").filter(Boolean)) : [] as string[],
        localExperiences: [] as string[],
        skipFlights: false,
        skipHotel: false,
        preferredFlightTime: "any" as "any" | "morning" | "afternoon" | "evening" | "night",
        // Arrival/Departure times (optional, ISO string in destination timezone).
        // Prefilled when the trip is being created off a real flight booking —
        // the caller has already encoded them the same way applySelectedTime
        // does (local wall-clock hours carried on a UTC instant).
        arrivalTime: (prefilledArrivalTime || null) as string | null,
        departureTime: (prefilledDepartureTime || null) as string | null,
    });

        // V1: Compute per-person budget on the fly
    const perPersonBudget = Math.round(formData.budgetTotal / formData.travelerCount);

    // Compute trip days and budget tier for display
    const tripDays = countTripDays(formData.startDate, formData.endDate);
    const dailyBudgetPerPerson = Math.round(perPersonBudget / tripDays);
    const budgetTier = dailyBudgetPerPerson > 300
        ? { label: t('createTrip.premium'), icon: 'diamond' as const, color: '#9B59B6', description: t('createTrip.premiumDesc') }
        : dailyBudgetPerPerson >= 150
        ? { label: t('createTrip.high'), icon: 'star' as const, color: '#E67E22', description: t('createTrip.highDesc') }
        : dailyBudgetPerPerson > 60
        ? { label: t('createTrip.moderate'), icon: 'thumbs-up' as const, color: '#3498DB', description: t('createTrip.moderateDesc') }
        : { label: t('createTrip.budget'), icon: 'wallet' as const, color: '#27AE60', description: t('createTrip.budgetDesc') };


    // Apply user preferences when loaded
    React.useEffect(() => {
        if (userSettings) {
            setFormData(prev => ({
                ...prev,
                // Older accounts saved the base airport in their own language
                // ("Αθήνα"). Prefill the canonical English label so the field
                // reads "Athens, Greece ATH" and flight search can use it.
                origin:
                    canonicalHomeAirport(userSettings.homeAirport)?.label ||
                    userSettings.homeAirport ||
                    prev.origin,
                budgetTotal: userSettings.defaultBudget || prev.budgetTotal,
                travelerCount: userSettings.defaultTravelers || prev.travelerCount,
                // Only vibes the step can actually show. A saved interest outside
                // the six (Luxury, Family, ...) used to occupy a slot invisibly,
                // so the grid looked empty but refused the third pick.
                interests: userSettings.interests && userSettings.interests.length > 0
                    ? toVibeIds(userSettings.interests)
                    : prev.interests,
                skipFlights: userSettings.skipFlights ?? prev.skipFlights,
                skipHotel: userSettings.skipHotels ?? prev.skipHotel,
                preferredFlightTime: (userSettings.flightTimePreference as any) || prev.preferredFlightTime,
            }));
        }
    }, [userSettings]);

    // Detect device location on mount - DISABLED
    // Origin is now prefilled by another system
    React.useEffect(() => {
        // Location detection disabled - origin is prefilled externally
    }, []);

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString(i18n.language, { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    };

    const searchDestinations = (query: string) => {
        if (query.length < 2) {
            setShowDestinationSuggestions(false);
            setDestinationSuggestions([]);
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = DESTINATIONS.filter(dest => {
            // Match English names
            if (dest.city.toLowerCase().includes(lowerQuery) ||
                dest.country.toLowerCase().includes(lowerQuery)) return true;
            // Match translated city names (all languages)
            const cityTrans = CITY_TRANSLATIONS[dest.city];
            if (cityTrans && Object.values(cityTrans).some(v => v.toLowerCase().includes(lowerQuery))) return true;
            // Match translated country names (all languages)
            const countryTrans = COUNTRY_TRANSLATIONS[dest.country];
            if (countryTrans && Object.values(countryTrans).some(v => v.toLowerCase().includes(lowerQuery))) return true;
            return false;
        }).slice(0, 8);

        setDestinationSuggestions(filtered);
        setShowDestinationSuggestions(filtered.length > 0);
    };

    const selectDestination = (destination: typeof DESTINATIONS[0]) => {
        const canonical = `${destination.city}, ${destination.country}`;
        setFormData({ ...formData, destination: canonical });
        // The field shows the name in the user's language; the value stays English.
        setDestQuery(localDestinationLabel(canonical, i18n.language));
        setShowDestinationSuggestions(false);
        setDestinationSuggestions([]);
    };

    const pickRandomDestination = () => {
        const randomIndex = Math.floor(Math.random() * DESTINATIONS.length);
        const dest = DESTINATIONS[randomIndex];
        const canonical = `${dest.city}, ${dest.country}`;
        setFormData({ ...formData, destination: canonical });
        setDestQuery(localDestinationLabel(canonical, i18n.language));
        setShowDestinationSuggestions(false);
        setDestinationSuggestions([]);
    };

    const formatDateForCalendar = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toISOString().split('T')[0];
    };

    // Format time for display (e.g., "3:30 PM")
    const formatTime = (isoString: string | null) => {
        if (!isoString) return t('createTrip.notSet');
        const date = new Date(isoString);
        return date.toLocaleTimeString(i18n.language, { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true,
            timeZone: 'UTC'
        });
    };

    // Handle time picker change
    const handleTimeChange = (event: any, selectedDate?: Date) => {
        if (Platform.OS === 'android') {
            setShowTimePicker(false);
        }
        
        if (selectedDate) {
            setTempTime(selectedDate);
            
            if (Platform.OS === 'android') {
                // On Android, apply immediately when picker closes
                applySelectedTime(selectedDate);
            }
        }
    };

    // Apply selected time to form data
    const applySelectedTime = (time: Date) => {
        // Combine the appropriate date with the selected time
        const baseTimestamp = selectingTime === 'arrival' ? formData.startDate : formData.endDate;
        const baseDate = new Date(baseTimestamp);
        
        // Use Date.UTC so the ISO string preserves the user's intended local hours
        // This ensures the server reads the same hours the user picked (timezone-neutral)
        const combined = new Date(Date.UTC(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            baseDate.getDate(),
            time.getHours(),
            time.getMinutes(),
            0, 0
        ));
        
        const isoString = combined.toISOString();
        
        if (selectingTime === 'arrival') {
            setFormData({ ...formData, arrivalTime: isoString });
        } else {
            setFormData({ ...formData, departureTime: isoString });
        }
    };

    // Confirm time selection (iOS)
    const confirmTimeSelection = () => {
        applySelectedTime(tempTime);
        setShowTimePicker(false);
    };

    // Clear time selection
    const clearTime = (type: 'arrival' | 'departure') => {
        if (type === 'arrival') {
            setFormData({ ...formData, arrivalTime: null });
        } else {
            setFormData({ ...formData, departureTime: null });
        }
    };

    const getMarkedDates = () => {
        const startStr = formatDateForCalendar(formData.startDate);
        const endStr = formatDateForCalendar(formData.endDate);
        
        const marked: any = {};
        
        marked[startStr] = {
            startingDay: true,
            color: '#FFE500',
            textColor: 'white',
        };
        
        marked[endStr] = {
            endingDay: true,
            color: '#FFE500',
            textColor: 'white',
        };
        
        const start = new Date(formData.startDate);
        const end = new Date(formData.endDate);
        const current = new Date(start);
        current.setDate(current.getDate() + 1);
        
        while (current < end) {
            const dateStr = current.toISOString().split('T')[0];
            marked[dateStr] = {
                color: '#FFF8E1',
                textColor: '#9B9B9B',
            };
            current.setDate(current.getDate() + 1);
        }
        
        return marked;
    };

    const handleDayPress = (day: DateData) => {
        const selectedTimestamp = new Date(day.dateString).getTime();
        
        if (selectingDate === 'start') {
            if (selectedTimestamp >= formData.endDate) {
                // Auto-set end date to start + 7 days, but cap at 15
                const autoEnd = selectedTimestamp + 7 * 24 * 60 * 60 * 1000;
                setFormData({
                    ...formData,
                    startDate: selectedTimestamp,
                    endDate: autoEnd,
                });
            } else {
                // Check if existing end date would exceed the max trip length
                const daysDiff = countTripDays(selectedTimestamp, formData.endDate);
                if (daysDiff > MAX_TRIP_DAYS) {
                    setFormData({
                        ...formData,
                        startDate: selectedTimestamp,
                        endDate: maxEndDate(selectedTimestamp),
                    });
                } else {
                    setFormData({ ...formData, startDate: selectedTimestamp });
                }
            }
        } else {
            if (selectedTimestamp <= formData.startDate) {
                Alert.alert(t('createTrip.invalidDate'), t('createTrip.endAfterStart'));
                return;
            }
            const daysDiff = countTripDays(formData.startDate, selectedTimestamp);
            if (daysDiff > MAX_TRIP_DAYS) {
                Alert.alert(t('createTrip.tripTooLong'), t('createTrip.tripTooLongReturn'));
                return;
            }
            setFormData({ ...formData, endDate: selectedTimestamp });
        }
        setShowCalendar(false);
    };

     // V1: Traveler profiles disabled - removed getSelectedTravelersWithAges and areAllTravelersReady

    // ─────────────────────────────────────────────────────────────────────────
    // Step builder — state, data and helpers
    // ─────────────────────────────────────────────────────────────────────────
    const [step, setStep] = useState(1);
    const [destQuery, setDestQuery] = useState(
        prefilledDestination ? localDestinationLabel(prefilledDestination, i18n.language) : ""
    );
    const [editingOrigin, setEditingOrigin] = useState(false);
    const [editingBudget, setEditingBudget] = useState(false);
    const [budgetDraft, setBudgetDraft] = useState("");
    const [showTimesSection, setShowTimesSection] = useState(
        !!(prefilledArrivalTime || prefilledDepartureTime)
    );
    const [awaitingEnd, setAwaitingEnd] = useState(false);
    const [tileImages, setTileImages] = useState<Record<string, { url: string; photographer: string; downloadLocation?: string }>>({});
    const [tickerIndex, setTickerIndex] = useState(0);
    // Fares are scanned per visible month and cached by route+month, so paging
    // the calendar re-prices what you're actually looking at and paging back is
    // free. Key: "FCO|2026-05".
    const [faresByMonth, setFaresByMonth] = useState<Record<string, Record<string, number>>>({});
    const [visibleMonth, setVisibleMonth] = useState(() => new Date().toISOString().slice(0, 7));
    const [loadingFareKey, setLoadingFareKey] = useState<string | null>(null);
    const [askText, setAskText] = useState("");
    const [parsingAsk, setParsingAsk] = useState(false);
    const trackWidthRef = useRef(0);

    // Public proof + trending, both already cron-computed singletons.
    const landingStats = useQuery(api.publicStats.getLandingStats, {}) as any;
    const recentTrips = useQuery(api.publicStats.getRecentPublicTrips, {}) as any;
    const trending = useQuery(api.trips.getTrendingDestinations, {}) as any;
    const getDestinationImages = useAction(api.images.getDestinationImages);
    const trackUnsplashDownload = useAction(api.images.trackUnsplashDownload);
    const parseTripRequest = useAction(api.atlasParseTrip.parseTripRequest);
    const runFlightCalendar = useAction(api.flightCalendar.flightCalendar);

    const localCity = useCallback(
        (city: string) => (CITY_TRANSLATIONS[city] as any)?.[i18n.language] || city,
        [i18n.language]
    );
    const localCountry = useCallback(
        (country: string) => (COUNTRY_TRANSLATIONS[country] as any)?.[i18n.language] || country,
        [i18n.language]
    );
    const localDestination = useCallback(
        (value: string) => localDestinationLabel(value, i18n.language),
        [i18n.language]
    );

    const formatMoney = useCallback(
        (value: number) => {
            try {
                return new Intl.NumberFormat(i18n.language, {
                    style: "currency",
                    currency: "EUR",
                    maximumFractionDigits: 0,
                }).format(value);
            } catch {
                return `€${Math.round(value)}`;
            }
        },
        [i18n.language]
    );

    /**
     * Leaving the destination field commits it. The field keeps showing the name
     * in the user's own language; `formData.destination` always holds the
     * canonical English "City, Country" the generator and flight search need —
     * the same display/value split `canonicalHomeAirport` gives the origin.
     */
    const commitDestination = useCallback(() => {
        setShowDestinationSuggestions(false);
        const raw = destQuery.trim();
        if (!raw) {
            setFormData((prev) => ({ ...prev, destination: "" }));
            return;
        }
        const lower = raw.toLowerCase();
        const match =
            DESTINATIONS.find((d) => `${d.city}, ${d.country}`.toLowerCase() === lower) ||
            DESTINATIONS.find((d) => d.city.toLowerCase() === lower) ||
            DESTINATIONS.find((d) => {
                const trans = CITY_TRANSLATIONS[d.city];
                return trans ? Object.values(trans).some((v) => v.toLowerCase() === lower) : false;
            }) ||
            DESTINATIONS.find((d) => d.city.toLowerCase().startsWith(lower) && lower.length >= 3);

        if (match) {
            setFormData((prev) => ({ ...prev, destination: `${match.city}, ${match.country}` }));
            setDestQuery(`${localCity(match.city)}, ${localCountry(match.country)}`);
            return;
        }
        // Not in the list: still send English rather than the typed script.
        setFormData((prev) => ({ ...prev, destination: normalizeDestinationToEnglish(raw) }));
    }, [destQuery, localCity, localCountry]);

    /**
     * "Just say it" — one line of natural language becomes a filled-in trip.
     * Atlas returns already-validated fields (see convex/atlasParseTrip.ts), so
     * anything it couldn't read simply keeps the value the form already had.
     */
    const runAsk = async () => {
        const text = askText.trim();
        if (!text || parsingAsk || !token) return;
        setParsingAsk(true);
        try {
            const res: any = await parseTripRequest({
                token,
                text,
                language: i18n.language,
                origin: formData.origin,
            });
            if (!res?.ok) {
                Alert.alert(t("createTrip.askFailedTitle"), t("createTrip.askFailedMsg"));
                return;
            }
            setFormData((prev) => {
                const start = res.startDate ?? prev.startDate;
                let end = res.endDate ?? null;
                if (end === null) {
                    // Keep the length the user already had when only a start came back.
                    end = res.startDate ? res.startDate + (prev.endDate - prev.startDate) : prev.endDate;
                }
                return {
                    ...prev,
                    destination: res.destination || prev.destination,
                    startDate: start,
                    endDate: Math.max(end, start + 24 * 60 * 60 * 1000),
                    travelerCount: res.travelerCount ?? prev.travelerCount,
                    budgetTotal: res.budgetTotal ?? prev.budgetTotal,
                    interests: Array.isArray(res.interests) && res.interests.length > 0 ? res.interests : prev.interests,
                };
            });
            if (res.destination) setDestQuery(localDestinationLabel(res.destination, i18n.language));
            setAskText("");
            setAwaitingEnd(false);
            // Enough to review; otherwise drop them on the step that's still missing.
            setStep(res.destination && res.startDate ? TOTAL_STEPS : 2);
        } catch (error) {
            console.error("[CreateTrip] ask parse failed", error);
            Alert.alert(t("createTrip.askFailedTitle"), t("createTrip.askFailedMsg"));
        } finally {
            setParsingAsk(false);
        }
    };

    // Rotating "someone just planned" line, from the anonymised public feed.
    const tickerLine = useMemo(() => {
        if (!Array.isArray(recentTrips) || recentTrips.length === 0) return "";
        const item = recentTrips[tickerIndex % recentTrips.length];
        if (!item?.destination) return "";
        return t("createTrip.recentlyPlanned", { destination: localDestination(item.destination) });
    }, [recentTrips, tickerIndex, localDestination, t]);

    useEffect(() => {
        if (!Array.isArray(recentTrips) || recentTrips.length < 2) return;
        const timer = setInterval(() => setTickerIndex((i) => i + 1), 3800);
        return () => clearInterval(timer);
    }, [recentTrips]);

    // Four trending destinations, rendered as stamps.
    const stamps = useMemo(() => (Array.isArray(trending) ? trending.slice(0, 4) : []), [trending]);

    useEffect(() => {
        if (stamps.length === 0) return;
        let cancelled = false;
        (async () => {
            for (const item of stamps) {
                if (cancelled || tileImages[item.destination]) continue;
                try {
                    const res: any = await getDestinationImages({ destination: item.destination, count: 1 });
                    const photo = Array.isArray(res) ? res[0] : res?.images?.[0];
                    if (photo?.url && !cancelled) {
                        setTileImages((prev) => ({
                            ...prev,
                            [item.destination]: {
                                url: photo.url,
                                photographer: photo.photographer || "",
                                downloadLocation: photo.downloadLocation,
                            },
                        }));
                    }
                } catch {
                    // Stamp keeps its flat placeholder — never blocks the step.
                }
            }
        })();
        return () => { cancelled = true; };
    }, [stamps]);

    const routeKey = useMemo(() => {
        const departureId = resolveHomeIata(formData.origin);
        const arrivalId = resolveAirport(formData.destination)?.iata;
        if (!departureId || !arrivalId || departureId === arrivalId) return null;
        return { departureId, arrivalId };
    }, [formData.origin, formData.destination]);

    const fareKey = routeKey ? `${routeKey.arrivalId}|${visibleMonth}` : null;
    const cheapDates = (fareKey && faresByMonth[fareKey]) || EMPTY_FARES;

    /**
     * Indicative fares for the month on screen. `flightCalendar` scans a rolling
     * ~14-day window by default, so a month needs `startOffsetDays` + 3 windows
     * — three searchapi calls on a cache miss, 12h cached server-side and kept
     * per month here so paging back and forth costs nothing.
     */
    useEffect(() => {
        if (step !== 2 || !token || !routeKey || !fareKey) return;
        if (faresByMonth[fareKey]) return;
        const monthStart = new Date(`${visibleMonth}-01T12:00:00`).getTime();
        const offsetDays = Math.round((monthStart - Date.now()) / (24 * 60 * 60 * 1000));
        if (offsetDays > 300) return; // too far out for the engine to price usefully
        let cancelled = false;
        setLoadingFareKey(fareKey);
        (async () => {
            try {
                const res: any = await runFlightCalendar({
                    token,
                    input: { departureId: routeKey.departureId, arrivalId: routeKey.arrivalId, currency: "EUR" },
                    startOffsetDays: Math.max(0, offsetDays),
                    windows: 3,
                    maxDates: 31,
                });
                if (cancelled) return;
                const map: Record<string, number> = {};
                for (const d of res?.dates || []) {
                    if (d?.date && typeof d.price === "number") map[d.date] = d.price;
                }
                setFaresByMonth((prev) => ({ ...prev, [fareKey]: map }));
            } catch {
                // No calendar for this route or month — remember that, so a failed
                // month doesn't refetch on every render.
                if (!cancelled) setFaresByMonth((prev) => ({ ...prev, [fareKey]: {} }));
            } finally {
                if (!cancelled) setLoadingFareKey(null);
            }
        })();
        return () => { cancelled = true; };
    }, [step, token, routeKey, fareKey, visibleMonth]);

    const faresLoading = !!fareKey && loadingFareKey === fareKey;
    const visibleMonthLabel = useMemo(() => {
        try {
            return new Date(`${visibleMonth}-01T12:00:00`).toLocaleDateString(i18n.language, { month: "long" });
        } catch {
            return visibleMonth;
        }
    }, [visibleMonth, i18n.language]);

    const cheapestFare = useMemo(() => {
        const values = Object.values(cheapDates);
        return values.length ? Math.min(...values) : null;
    }, [cheapDates]);

    const cheapestHint = useMemo(() => {
        const entries = Object.entries(cheapDates);
        if (entries.length < 3) return "";
        const sorted = [...entries].sort((a, b) => a[1] - b[1]);
        const [cheapDate, cheapPrice] = sorted[0];
        const median = sorted[Math.floor(sorted.length / 2)][1];
        if (!median || cheapPrice >= median) return "";
        const saving = Math.round(((median - cheapPrice) / median) * 100);
        if (saving < 8) return "";
        const label = new Date(`${cheapDate}T12:00:00`).toLocaleDateString(i18n.language, {
            weekday: "short",
            day: "numeric",
            month: "short",
        });
        return t("createTrip.cheaperOn", { date: label, percent: saving });
    }, [cheapDates, i18n.language, t]);

    /** Move the trip onto the cheapest departure, keeping its length. */
    const applyCheapestDate = () => {
        const entries = Object.entries(cheapDates);
        if (entries.length === 0) return;
        const [cheapDate] = entries.sort((a, b) => a[1] - b[1])[0];
        const ts = new Date(`${cheapDate}T12:00:00`).getTime();
        if (!Number.isFinite(ts)) return;
        setFormData((prev) => ({
            ...prev,
            startDate: ts,
            endDate: ts + (prev.endDate - prev.startDate),
        }));
        setAwaitingEnd(false);
    };

    const applyLengthPreset = (nights: number) => {
        setFormData((prev) => ({ ...prev, endDate: prev.startDate + nights * 24 * 60 * 60 * 1000 }));
        setAwaitingEnd(false);
    };

    /** Inline range picking: first tap sets the start, second the end. */
    const handleRangePress = (day: DateData) => {
        const ts = new Date(`${day.dateString}T12:00:00`).getTime();
        if (!awaitingEnd) {
            setFormData((prev) => ({ ...prev, startDate: ts, endDate: ts }));
            setAwaitingEnd(true);
            return;
        }
        if (ts <= formData.startDate) {
            setFormData((prev) => ({ ...prev, startDate: ts, endDate: ts }));
            return;
        }
        if (countTripDays(formData.startDate, ts) > MAX_TRIP_DAYS) {
            Alert.alert(t("createTrip.tripTooLong"), t("createTrip.tripTooLongMsg"));
            return;
        }
        setFormData((prev) => ({ ...prev, endDate: ts }));
        setAwaitingEnd(false);
    };

    const sameDay = (a: number, b: number) => {
        const x = new Date(a); const y = new Date(b);
        return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
    };

    /** Day cell with the indicative fare under the number. */
    const renderDay = ({ date, state }: any) => {
        if (!date) return <View style={styles.dayCell} />;
        const ts = new Date(`${date.dateString}T12:00:00`).getTime();
        const disabled = state === "disabled";
        const isStart = sameDay(ts, formData.startDate);
        const isEnd = sameDay(ts, formData.endDate);
        const inRange = !isStart && !isEnd && ts > formData.startDate && ts < formData.endDate;
        const price = cheapDates[date.dateString];
        const isCheapest = price != null && cheapestFare != null && price <= cheapestFare * 1.02;
        return (
            <TouchableOpacity
                disabled={disabled}
                activeOpacity={0.7}
                onPress={() => handleRangePress(date)}
                style={[
                    styles.dayCell,
                    inRange && { backgroundColor: colors.secondary },
                    (isStart || isEnd) && { backgroundColor: colors.primary, borderRadius: 10 },
                ]}
            >
                <Text
                    style={[
                        styles.dayNumber,
                        { color: disabled ? colors.border : colors.text },
                        (isStart || isEnd) && { color: "#1A1A1A", fontWeight: "800" },
                    ]}
                >
                    {date.day}
                </Text>
                {!disabled && price != null && (
                    <Text
                        style={[
                            styles.dayPrice,
                            { color: isCheapest ? CHEAP_GREEN : colors.textMuted },
                            (isStart || isEnd) && { color: "rgba(26,26,26,0.7)" },
                        ]}
                        numberOfLines={1}
                    >
                        {formatMoney(Math.round(price))}
                    </Text>
                )}
            </TouchableOpacity>
        );
    };

    const getMarkedDatesWithFares = () => {
        const marked: any = getMarkedDates();
        for (const [date, price] of Object.entries(cheapDates)) {
            const cheapest = Math.min(...Object.values(cheapDates));
            if (price > cheapest * 1.05) continue;
            marked[date] = { ...(marked[date] || {}), marked: true, dotColor: "#1FA463" };
        }
        return marked;
    };

    const budgetRatio = Math.max(
        0,
        Math.min(1, (formData.budgetTotal - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN))
    );

    const setBudgetFromX = (x: number) => {
        const width = trackWidthRef.current;
        if (!width) return;
        const ratio = Math.max(0, Math.min(1, x / width));
        const raw = BUDGET_MIN + ratio * (BUDGET_MAX - BUDGET_MIN);
        const snapped = Math.round(raw / 50) * 50;
        setFormData((prev) => ({ ...prev, budgetTotal: snapped }));
    };

    const budgetPan = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: (evt) => setBudgetFromX(evt.nativeEvent.locationX),
            onPanResponderMove: (evt) => setBudgetFromX(evt.nativeEvent.locationX),
        })
    ).current;

    const commitBudgetDraft = () => {
        const value = parseInt(budgetDraft.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(value) && value > 0) {
            setFormData((prev) => ({ ...prev, budgetTotal: value }));
        }
        setEditingBudget(false);
    };

    const budgetTierId =
        dailyBudgetPerPerson > 300 ? "premium" : dailyBudgetPerPerson >= 150 ? "high" : dailyBudgetPerPerson > 60 ? "moderate" : "budget";

    /**
     * Destination-aware vibe order. `getTrendingDestinations` already ships an
     * `interests` array per destination, aggregated by the same cron that feeds
     * the trending list — no new backend for the ranking.
     */
    const destinationInterests: string[] = useMemo(() => {
        if (!Array.isArray(trending) || !formData.destination) return [];
        const target = formData.destination.toLowerCase();
        const row = trending.find((d: any) => {
            const dd = String(d.destination || "").toLowerCase();
            return dd === target || dd.split(",")[0].trim() === target.split(",")[0].trim();
        });
        return Array.isArray(row?.interests) ? row.interests : [];
    }, [trending, formData.destination]);

    const orderedVibes = useMemo(() => {
        if (destinationInterests.length === 0) return VIBES;
        const rank = (id: string) => {
            const i = destinationInterests.indexOf(id);
            return i === -1 ? 99 : i;
        };
        return [...VIBES].sort((a, b) => rank(a.id) - rank(b.id));
    }, [destinationInterests]);

    const suggestedVibes = useMemo(
        () => orderedVibes.filter((v) => destinationInterests.includes(v.id)).slice(0, MAX_VIBES),
        [orderedVibes, destinationInterests]
    );

    const applySuggestedMix = () => {
        setFormData((prev) => ({ ...prev, interests: suggestedVibes.map((v) => v.id) }));
    };

    const toggleVibe = (id: string) => {
        setFormData((prev) => {
            if (prev.interests.includes(id)) {
                return { ...prev, interests: prev.interests.filter((i) => i !== id) };
            }
            if (prev.interests.length >= MAX_VIBES) return prev;
            return { ...prev, interests: [...prev.interests, id] };
        });
    };

    const creditsLabel = useMemo(() => {
        if (!userPlan) return "";
        if (userPlan.isSubscriptionActive) return t("createTrip.creditsUnlimited");
        const left = userPlan.tripCredits ?? 0;
        return t("createTrip.creditsLeft", { count: left });
    }, [userPlan, t]);

    const handleSubmit = async (options?: { skipConsentCheck?: boolean }) => {
        if (!formData.destination) {
            Alert.alert(t('common.error'), t('createTrip.pleaseEnterDestination'));
            return;
        }

        if (!formData.skipFlights && !formData.origin) {
            Alert.alert(t('common.error'), t('createTrip.pleaseEnterOrigin'));
            return;
        }

        // Origin and destination must be different places (also enforced server-side).
        if (isSameOriginDestination(formData.origin, formData.destination)) {
            Alert.alert(t('common.error'), t('createTrip.sameOriginDestination'));
            return;
        }

        // Check AI data consent before proceeding (Apple guideline 5.1.1/5.1.2)
        if (!options?.skipConsentCheck && userSettings && userSettings.aiDataConsent !== true) {
            setShowAiConsentModal(true);
            return;
        }

          // V1: Validate travelerCount (1-12)
        if (formData.travelerCount < 1 || formData.travelerCount > 12) {
            Alert.alert(t('common.error'), t('createTrip.travelersBetween'));
            return;
        }

        // Validate trip duration
        const submitTripDays = countTripDays(formData.startDate, formData.endDate);
        if (submitTripDays > MAX_TRIP_DAYS) {
            Alert.alert(t('createTrip.tripTooLong'), t('createTrip.tripTooLongMsg'));
            return;
        }

       // V1: Validate budgetTotal
        if (!formData.budgetTotal || isNaN(Number(formData.budgetTotal)) || Number(formData.budgetTotal) <= 0) {
            Alert.alert(t('common.error'), t('createTrip.validBudget'));
            return;
        }

        // Client-side credit check to avoid server error (Apple guideline 2.1)
        if (userPlan) {
            const isSubActive = userPlan.isSubscriptionActive === true;
            const tripCredits = userPlan.tripCredits ?? 0;
            const tripsGenerated = userPlan.tripsGenerated ?? 0;
            const hasFreeTrial = tripsGenerated < 1;

            if (!isSubActive && tripCredits <= 0 && !hasFreeTrial) {
                Alert.alert(
                    t('createTrip.noTripCredits'),
                    t('createTrip.noCreditsAlert'),
                    [
                        { text: t('common.cancel'), style: "cancel" },
                        {
                            text: t('createTrip.viewOptions'),
                            onPress: () => router.push("/subscription"),
                        },
                    ]
                );
                return;
            }
        }

        setLoading(true);
        setShowLoadingScreen(true);

        try {
            const tripId = await createTrip({
                destination: formData.destination,
                origin: formData.origin,
                startDate: Number(formData.startDate),
                endDate: Number(formData.endDate),
                // V1: Use new field names
                budgetTotal: Number(formData.budgetTotal),
                travelerCount: Number(formData.travelerCount),
                interests: formData.interests,
                localExperiences: formData.localExperiences,
                skipFlights: formData.skipFlights,
                skipHotel: formData.skipHotel,
                preferredFlightTime: formData.preferredFlightTime,
                // Arrival/Departure times for time-aware itineraries
                arrivalTime: formData.arrivalTime || undefined,
                departureTime: formData.departureTime || undefined,
                // Language preference for AI-generated content
                language: i18n.language || "en",
                // Platform the trip was generated from (ios/android)
                platform: Platform.OS,
            });
            
            // Mark first-trip guide as seen so it never shows again
            if (token) {
                markGuideSeen({ token }).catch(() => {});
            }
            
            router.push(`/trip/${tripId}`);
            // Reset states after navigation
            setTimeout(() => {
                setLoading(false);
                setShowLoadingScreen(false);
            }, 500);
        } catch (error: any) {
            console.error("Error creating trip:", error);
            
            // Extract error message
            const errorMsg = error.message || "Failed to create trip. Please try again.";
            // Clean up Convex error prefix if present
            const cleanMessage = errorMsg.replace("Uncaught Error: ", "").replace("Error: ", "");
            
            // Check if this is a credits/plan error
            const isNoCredits = cleanMessage.toLowerCase().includes("credit") || 
                               cleanMessage.toLowerCase().includes("subscribe") ||
                               cleanMessage.toLowerCase().includes("premium") ||
                               cleanMessage.toLowerCase().includes("purchase");
            
            const isSameRoute = cleanMessage.includes(SAME_ROUTE_ERROR);

            setIsCreditsError(isNoCredits);
            setErrorMessage(isNoCredits 
                ? t('createTrip.usedAllCredits')
                : isSameRoute
                    ? t('createTrip.sameOriginDestination')
                    : cleanMessage
            );
            setLoading(false);
            setShowLoadingScreen(false);
            setShowErrorScreen(true);
        }
    };

    const toggleInterest = (interest: string) => {
        if (formData.interests.includes(interest)) {
            setFormData({ ...formData, interests: formData.interests.filter((i) => i !== interest) });
        } else {
            setFormData({ ...formData, interests: [...formData.interests, interest] });
        }
    };

    const toggleLocalExperience = (experienceId: string) => {
        if (formData.localExperiences.includes(experienceId)) {
            setFormData({ ...formData, localExperiences: formData.localExperiences.filter((e) => e !== experienceId) });
        } else {
            setFormData({ ...formData, localExperiences: [...formData.localExperiences, experienceId] });
        }
    };

    if (showLoadingScreen) {
        return (
            <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 24 }} />
                <Text style={[styles.loadingTitle, { color: colors.text }]}>{t('createTrip.aiDesigning')}</Text>
                <Text style={[styles.loadingDestination, { color: colors.primary }]}>{formData.destination}</Text>
                <Text style={[styles.loadingSubtitle, { color: colors.textMuted }]}>{t('createTrip.analyzingPreferences')}</Text>
            </SafeAreaView>
        );
    }

    if (showErrorScreen) {
        return (
            <SafeAreaView style={[styles.errorContainer, { backgroundColor: colors.background }]}>
                <View style={styles.errorContent}>
                    <Ionicons 
                        name={isCreditsError ? "wallet" : "alert-circle"} 
                        size={64} 
                        color={isCreditsError ? colors.primary : colors.error} 
                        style={{ marginBottom: 24 }} 
                    />
                    <Text style={[styles.errorTitle, { color: colors.text }]}>
                        {isCreditsError ? t('createTrip.noTripCredits') : t('createTrip.tripGenerationFailed')}
                    </Text>
                    <Text style={[styles.errorMessage, { color: colors.textMuted }]}>{errorMessage}</Text>
                    
                    {isCreditsError ? (
                        <>
                            <TouchableOpacity 
                                style={[styles.errorButton, { backgroundColor: colors.primary }]}
                                onPress={() => {
                                    setShowErrorScreen(false);
                                    setErrorMessage("");
                                    setIsCreditsError(false);
                                    router.push("/subscription");
                                }}
                            >
                                <Text style={[styles.errorButtonText, { color: "#1A1A1A" }]}>{t('createTrip.getMoreTrips')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.errorButtonSecondary, { borderColor: colors.border }]}
                                onPress={() => {
                                    setShowErrorScreen(false);
                                    setErrorMessage("");
                                    setIsCreditsError(false);
                                }}
                            >
                                <Text style={[styles.errorButtonSecondaryText, { color: colors.text }]}>{t('common.goBack')}</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <TouchableOpacity 
                            style={[styles.errorButton, { backgroundColor: colors.text }]}
                            onPress={() => {
                                setShowErrorScreen(false);
                                setErrorMessage("");
                            }}
                        >
                            <Text style={[styles.errorButtonText, { color: colors.background }]}>{t('common.goBack')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step builder render
    // ─────────────────────────────────────────────────────────────────────────
    const stepValid = (n: number) => {
        if (n === 1) return !!formData.destination.trim();
        if (n === 2) return countTripDays(formData.startDate, formData.endDate) <= MAX_TRIP_DAYS && formData.endDate > formData.startDate;
        if (n === 3) return formData.travelerCount >= 1 && formData.travelerCount <= 12 && formData.budgetTotal > 0;
        return true;
    };

    const goNext = () => {
        if (!stepValid(step)) return;
        if (step < TOTAL_STEPS) {
            setStep(step + 1);
            scrollRef.current?.scrollTo({ y: 0, animated: false });
        }
    };
    const goBack = () => {
        if (step > 1) {
            setStep(step - 1);
            scrollRef.current?.scrollTo({ y: 0, animated: false });
        } else {
            router.back();
        }
    };

    const originIata = resolveHomeIata(formData.origin);
    const originCity = airportCityName(originIata) || formData.origin.split(",")[0];
    const destAirport = resolveAirport(formData.destination);
    const tripDaysNow = countTripDays(formData.startDate, formData.endDate);
    const nightsNow = Math.max(0, tripDaysNow - 1);

    const rangeLabel = `${new Date(formData.startDate).toLocaleDateString(i18n.language, { weekday: "short", day: "numeric" })} → ${new Date(formData.endDate).toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" })}`;

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.stepHeader}>
                    <TouchableOpacity onPress={goBack} style={[styles.backButton, { backgroundColor: colors.secondary }]}>
                        <Ionicons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.stepHeaderTitle, { color: colors.text }]}>{t("createTrip.newTrip")}</Text>
                    <Text style={[styles.stepCount, { color: colors.textMuted }]}>{step} / {TOTAL_STEPS}</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                    <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${(step / TOTAL_STEPS) * 100}%` }]} />
                </View>

                <KeyboardAvoidingView
                    style={styles.keyboardWrap}
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                >
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.stepContent}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    automaticallyAdjustKeyboardInsets
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Step 1 · where ─────────────────────────────────── */}
                    {step === 1 && (
                        <View style={styles.stepBody}>
                            {!!landingStats?.tripsCount && (
                                <View style={styles.proofBlock}>
                                    <View style={styles.proofRow}>
                                        <View style={styles.liveDot} />
                                        <Text style={[styles.proofNum, { color: colors.text }]}>
                                            {landingStats.tripsCount.toLocaleString(i18n.language)}
                                        </Text>
                                        <Text style={[styles.proofText, { color: colors.textSecondary }]}>{t("createTrip.totalTrips")}</Text>
                                    </View>
                                    {!!tickerLine && (
                                        <Text style={[styles.proofTicker, { color: colors.textMuted }]} numberOfLines={1}>{tickerLine}</Text>
                                    )}
                                </View>
                            )}

                            <Text style={[styles.stepTitle, { color: colors.text }]}>{t("createTrip.q1")}</Text>

                            <View style={[styles.destField, { backgroundColor: colors.card, borderColor: formData.destination ? colors.primary : colors.border }]}>
                                <Ionicons name="location" size={20} color={colors.error} />
                                <TextInput
                                    style={[styles.destInput, { color: colors.text }]}
                                    placeholder={t("createTrip.whereTo")}
                                    placeholderTextColor={colors.textMuted}
                                    value={destQuery}
                                    onChangeText={(text) => {
                                        setDestQuery(text);
                                        setFormData((prev) => ({ ...prev, destination: "" }));
                                        searchDestinations(text);
                                    }}
                                    onBlur={commitDestination}
                                    returnKeyType="done"
                                    onSubmitEditing={commitDestination}
                                />
                                {!!formData.destination && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                            </View>

                            {/* Localised label above, canonical value below — the value is what we send. */}
                            {!!formData.destination && destQuery.trim() !== formData.destination && (
                                <View style={styles.sentAsRow}>
                                    <Ionicons name="paper-plane-outline" size={12} color={colors.textMuted} />
                                    <Text style={[styles.sentAsLabel, { color: colors.textMuted }]}>{t("createTrip.sentAs")}</Text>
                                    <Text style={[styles.sentAsValue, { color: colors.textSecondary, backgroundColor: colors.secondary }]}>{formData.destination}</Text>
                                </View>
                            )}

                            {showDestinationSuggestions && destinationSuggestions.length > 0 && (
                                <View style={[styles.suggestionsContainer, { backgroundColor: colors.secondary }]}>
                                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                        {destinationSuggestions.map((dest, index) => (
                                            <TouchableOpacity
                                                key={`${dest.city}-${dest.country}-${index}`}
                                                style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
                                                onPress={() => selectDestination(dest)}
                                            >
                                                <Text style={{ fontSize: 18, marginRight: 12 }}>{dest.image}</Text>
                                                <View>
                                                    <Text style={[styles.suggestionCity, { color: colors.text }]}>{localCity(dest.city)}</Text>
                                                    <Text style={[styles.suggestionDetails, { color: colors.textMuted }]}>{localCountry(dest.country)}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {editingOrigin ? (
                                <View style={[styles.destField, { backgroundColor: colors.card, borderColor: colors.text }]}>
                                    <Ionicons name="airplane" size={18} color={colors.text} />
                                    <TextInput
                                        style={[styles.destInput, { color: colors.text }]}
                                        placeholder={t("createTrip.whereFrom")}
                                        placeholderTextColor={colors.textMuted}
                                        value={formData.origin}
                                        autoFocus
                                        onChangeText={(text) => setFormData((prev) => ({ ...prev, origin: text }))}
                                        onBlur={() => {
                                            const canon = canonicalHomeAirport(formData.origin);
                                            if (canon?.label) setFormData((prev) => ({ ...prev, origin: canon.label }));
                                            setEditingOrigin(false);
                                        }}
                                        returnKeyType="done"
                                    />
                                </View>
                            ) : (
                                <TouchableOpacity style={[styles.originChip, { backgroundColor: colors.secondary }]} onPress={() => setEditingOrigin(true)} activeOpacity={0.7}>
                                    <Ionicons name="airplane" size={16} color={colors.textSecondary} />
                                    <Text style={[styles.originText, { color: colors.text }]} numberOfLines={1}>
                                        {t("createTrip.from")} {originCity}
                                    </Text>
                                    {!!originIata && (
                                        <Text style={[styles.originPill, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}>{originIata}</Text>
                                    )}
                                    <Text style={[styles.originChange, { color: colors.primary }]}>{t("common.change", { defaultValue: "Change" })}</Text>
                                </TouchableOpacity>
                            )}

                            {stamps.length > 0 && (
                                <View>
                                    <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 4 }]}>
                                        {t("createTrip.trendingFrom", { city: originCity })}
                                    </Text>
                                    <View style={styles.stampGrid}>
                                        {stamps.map((item: any) => {
                                            const [sCity, sCountry] = splitDestination(item.destination);
                                            const photo = tileImages[item.destination];
                                            return (
                                                <TouchableOpacity
                                                    key={item.destination}
                                                    style={[styles.stamp, { backgroundColor: colors.card, borderColor: GOLD }]}
                                                    activeOpacity={0.85}
                                                    onPress={() => {
                                                        setFormData((prev) => ({ ...prev, destination: normalizeDestinationToEnglish(item.destination) }));
                                                        setDestQuery(localDestination(item.destination));
                                                        setShowDestinationSuggestions(false);
                                                        // Unsplash requires a download ping when a photo is actually used.
                                                        if (photo?.downloadLocation) {
                                                            trackUnsplashDownload({ downloadLocation: photo.downloadLocation }).catch(() => {});
                                                        }
                                                    }}
                                                >
                                                    {/* Punched edge: dots in the page colour read as perforations. */}
                                                    <View pointerEvents="none" style={styles.perfLayer}>
                                                        {PERF_H.map((pos, i) => (
                                                            <View key={`t${i}`} style={[styles.perfDot, { backgroundColor: colors.background, top: -5, left: `${pos}%` }]} />
                                                        ))}
                                                        {PERF_H.map((pos, i) => (
                                                            <View key={`b${i}`} style={[styles.perfDot, { backgroundColor: colors.background, bottom: -5, left: `${pos}%` }]} />
                                                        ))}
                                                        {PERF_V.map((pos, i) => (
                                                            <View key={`l${i}`} style={[styles.perfDotV, { backgroundColor: colors.background, left: -5, top: `${pos}%` }]} />
                                                        ))}
                                                        {PERF_V.map((pos, i) => (
                                                            <View key={`r${i}`} style={[styles.perfDotV, { backgroundColor: colors.background, right: -5, top: `${pos}%` }]} />
                                                        ))}
                                                    </View>
                                                    <View style={[styles.stampPhoto, { backgroundColor: colors.secondary, borderColor: GOLD_SOFT }]}>
                                                        {!!photo?.url && <Image source={{ uri: photo.url }} style={styles.stampImage} resizeMode="cover" />}
                                                        {!!photo?.photographer && (
                                                            <Text style={styles.stampCredit} numberOfLines={1}>{photo.photographer}</Text>
                                                        )}
                                                        {typeof item.avgTripSpend === "number" && item.avgTripSpend > 0 && (
                                                            <View style={styles.stampDenom}>
                                                                <Text style={styles.stampDenomText}>
                                                                    {formatMoney(Math.round(item.avgTripSpend))}{t("createTrip.perTripSuffix")}
                                                                </Text>
                                                            </View>
                                                        )}
                                                        {!!originIata && (
                                                            <View style={styles.postmark}>
                                                                <Text style={styles.postmarkText}>{originIata}</Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                    <View style={[styles.stampCaption, { borderTopColor: GOLD_SOFT }]}>
                                                        <Text style={[styles.stampCity, { color: colors.text }]} numberOfLines={1}>{localCity(sCity)}</Text>
                                                        <Text style={[styles.stampCountry, { color: colors.textMuted }]} numberOfLines={1}>{localCountry(sCountry)}</Text>
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}

                            <View style={[styles.askBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <View style={[styles.askSpark, { backgroundColor: colors.primary }]}>
                                    {parsingAsk
                                        ? <ActivityIndicator size="small" color="#1A1A1A" />
                                        : <Ionicons name="sparkles" size={14} color="#1A1A1A" />}
                                </View>
                                <TextInput
                                    style={[styles.askInput, { color: colors.text }]}
                                    placeholder={t("createTrip.askPlaceholder")}
                                    placeholderTextColor={colors.textMuted}
                                    value={askText}
                                    onChangeText={setAskText}
                                    onFocus={() => {
                                        // The bar sits near the bottom of step 1; lift it clear of the keyboard.
                                        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
                                    }}
                                    onSubmitEditing={runAsk}
                                    returnKeyType="go"
                                    editable={!parsingAsk}
                                    maxLength={200}
                                />
                                {!!askText.trim() && !parsingAsk && (
                                    <TouchableOpacity onPress={runAsk} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                        <Ionicons name="arrow-forward-circle" size={26} color={colors.primary} />
                                    </TouchableOpacity>
                                )}
                            </View>

                            <TouchableOpacity style={[styles.surpriseRow, { borderColor: colors.border }]} onPress={pickRandomDestination} activeOpacity={0.7}>
                                <Ionicons name="shuffle" size={18} color={colors.primary} />
                                <Text style={[styles.surpriseRowText, { color: colors.text }]}>{t("createTrip.surpriseMe")}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ── Step 2 · when ──────────────────────────────────── */}
                    {step === 2 && (
                        <View style={styles.stepBody}>
                            <Text style={[styles.stepTitle, { color: colors.text }]}>{t("createTrip.q2")}</Text>

                            <View style={styles.chipRow}>
                                {LENGTH_PRESETS.map((p) => {
                                    const active = nightsNow === p.nights;
                                    return (
                                        <TouchableOpacity
                                            key={p.key}
                                            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                                            onPress={() => applyLengthPreset(p.nights)}
                                        >
                                            <Text style={[styles.chipText, { color: colors.text }]}>{t(p.key)}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            <Text style={[styles.stepHint, { color: colors.textMuted }]}>{t("createTrip.tapAny")}</Text>

                            {!!cheapestHint && (
                                <TouchableOpacity
                                    style={[styles.nudge, { backgroundColor: colors.primary }]}
                                    onPress={applyCheapestDate}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="trending-down" size={18} color="#1A1A1A" />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.nudgeTitle}>{cheapestHint}</Text>
                                        <Text style={styles.nudgeSub}>{t("createTrip.indicativeFares")}</Text>
                                    </View>
                                    <Ionicons name="arrow-forward-circle" size={22} color="#1A1A1A" />
                                </TouchableOpacity>
                            )}

                            {faresLoading && (
                                <View style={[styles.faresLoading, { backgroundColor: colors.secondary }]}>
                                    <ActivityIndicator size="small" color={colors.primary} />
                                    <Text style={[styles.faresLoadingText, { color: colors.textSecondary }]} numberOfLines={2}>
                                        {t("createTrip.checkingFares", { month: visibleMonthLabel })}
                                    </Text>
                                </View>
                            )}

                            <View style={[styles.inlineCalendar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Calendar
                                    initialDate={formatDateForCalendar(formData.startDate)}
                                    minDate={formatDateForCalendar(Date.now())}
                                    maxDate={formatDateForCalendar(Date.now() + 18 * 30 * 24 * 60 * 60 * 1000)}
                                    onDayPress={handleRangePress}
                                    onMonthChange={(m: DateData) => setVisibleMonth(m.dateString.slice(0, 7))}
                                    dayComponent={renderDay}
                                    disableArrowLeft={faresLoading}
                                    disableArrowRight={faresLoading}
                                    theme={{
                                        backgroundColor: colors.card,
                                        calendarBackground: colors.card,
                                        textSectionTitleColor: colors.textMuted,
                                        selectedDayBackgroundColor: colors.primary,
                                        selectedDayTextColor: colors.text,
                                        todayTextColor: colors.primary,
                                        dayTextColor: colors.text,
                                        textDisabledColor: colors.border,
                                        dotColor: "#1FA463",
                                        arrowColor: colors.text,
                                        monthTextColor: colors.text,
                                        textDayFontWeight: "500",
                                        textMonthFontWeight: "700",
                                        textDayHeaderFontWeight: "600",
                                        textDayFontSize: 15,
                                        textMonthFontSize: 16,
                                        textDayHeaderFontSize: 12,
                                    }}
                                />
                            </View>

                            <View style={[styles.readout, { backgroundColor: colors.secondary }]}>
                                <Text style={[styles.readoutBig, { color: colors.text }]}>{rangeLabel}</Text>
                                <Text style={[styles.readoutSmall, { color: colors.textMuted }]}>
                                    {t("createTrip.daysCount", { count: tripDaysNow })}
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.accordion, { backgroundColor: colors.card, borderColor: colors.border }]}
                                onPress={() => setShowTimesSection(!showTimesSection)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                                <Text style={[styles.accordionText, { color: colors.text }]}>{t("createTrip.flightTimes")}</Text>
                                <Text style={[styles.accordionOpt, { color: colors.textMuted }]}>{t("createTrip.optionalLabel")}</Text>
                                <Ionicons name={showTimesSection ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                            </TouchableOpacity>

                            {showTimesSection && (
                                <View style={[styles.timesBox, { backgroundColor: colors.secondary }]}>
                                    <TouchableOpacity
                                        style={styles.timeRow}
                                        onPress={() => {
                                            setSelectingTime("arrival");
                                            setTempTime(formData.arrivalTime ? new Date(formData.arrivalTime) : new Date());
                                            setShowTimePicker(true);
                                        }}
                                    >
                                        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t("createTrip.arrivalAtDestination")}</Text>
                                        <Text style={[styles.timeValue, { color: formData.arrivalTime ? colors.text : colors.textMuted }]}>
                                            {formData.arrivalTime ? formatTime(formData.arrivalTime) : t("createTrip.tapToSet")}
                                        </Text>
                                    </TouchableOpacity>
                                    <View style={[styles.timeDivider, { backgroundColor: colors.border }]} />
                                    <TouchableOpacity
                                        style={styles.timeRow}
                                        onPress={() => {
                                            setSelectingTime("departure");
                                            setTempTime(formData.departureTime ? new Date(formData.departureTime) : new Date());
                                            setShowTimePicker(true);
                                        }}
                                    >
                                        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{t("createTrip.departureFromDestination")}</Text>
                                        <Text style={[styles.timeValue, { color: formData.departureTime ? colors.text : colors.textMuted }]}>
                                            {formData.departureTime ? formatTime(formData.departureTime) : t("createTrip.tapToSet")}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    )}

                    {/* ── Step 3 · who and budget ────────────────────────── */}
                    {step === 3 && (
                        <View style={styles.stepBody}>
                            <Text style={[styles.stepTitle, { color: colors.text }]}>{t("createTrip.q3")}</Text>

                            <View style={[styles.stepper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <TouchableOpacity
                                    style={[styles.stepperBtn, { borderColor: colors.border }]}
                                    onPress={() => setFormData((p) => ({ ...p, travelerCount: Math.max(1, p.travelerCount - 1) }))}
                                >
                                    <Ionicons name="remove" size={18} color={colors.text} />
                                </TouchableOpacity>
                                <Text style={[styles.stepperValue, { color: colors.text }]}>
                                    {t("createTrip.travelersCount", { count: formData.travelerCount })}
                                </Text>
                                <TouchableOpacity
                                    style={[styles.stepperBtn, { borderColor: colors.border }]}
                                    onPress={() => setFormData((p) => ({ ...p, travelerCount: Math.min(12, p.travelerCount + 1) }))}
                                >
                                    <Ionicons name="add" size={18} color={colors.text} />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.chipRow}>
                                {PARTY_PRESETS.map((p) => {
                                    const active = formData.travelerCount === p.count;
                                    return (
                                        <TouchableOpacity
                                            key={p.key}
                                            style={[styles.chip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                                            onPress={() => setFormData((prev) => ({ ...prev, travelerCount: p.count }))}
                                        >
                                            <Text style={[styles.chipText, { color: colors.text }]}>{t(p.key)}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 8 }]}>{t("createTrip.totalBudget")}</Text>

                            {editingBudget ? (
                                <View style={[styles.budgetEdit, { backgroundColor: colors.card, borderColor: colors.text }]}>
                                    <Text style={[styles.budgetCurrency, { color: colors.text }]}>€</Text>
                                    <TextInput
                                        style={[styles.budgetInputBig, { color: colors.text }]}
                                        value={budgetDraft}
                                        onChangeText={(text) => setBudgetDraft(text.replace(/[^0-9]/g, ""))}
                                        keyboardType="number-pad"
                                        autoFocus
                                        onBlur={commitBudgetDraft}
                                        returnKeyType="done"
                                        onSubmitEditing={commitBudgetDraft}
                                    />
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={styles.budgetAmountRow}
                                    activeOpacity={0.7}
                                    onPress={() => {
                                        setBudgetDraft(String(formData.budgetTotal));
                                        setEditingBudget(true);
                                    }}
                                >
                                    <Text style={[styles.budgetAmount, { color: colors.text, borderBottomColor: colors.border }]}>
                                        {formatMoney(formData.budgetTotal)}
                                    </Text>
                                    <Ionicons name="pencil" size={16} color={colors.primary} />
                                </TouchableOpacity>
                            )}
                            <Text style={[styles.stepHint, { color: colors.textMuted }]}>{t("createTrip.tapAmount")}</Text>

                            <View
                                style={styles.sliderTrackWrap}
                                onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
                                {...budgetPan.panHandlers}
                            >
                                <View style={[styles.sliderTrack, { backgroundColor: colors.secondary }]}>
                                    <View style={[styles.sliderFill, { backgroundColor: colors.primary, width: `${budgetRatio * 100}%` }]} />
                                </View>
                                <View style={[styles.sliderThumb, { backgroundColor: colors.card, borderColor: colors.text, left: `${budgetRatio * 100}%` }]} />
                            </View>

                            <View style={styles.ladderRow}>
                                {TIERS.map((tier) => {
                                    const active = tier.id === budgetTierId;
                                    return (
                                        <View key={tier.id} style={[styles.ladderCell, { borderTopColor: active ? colors.primary : colors.border }]}>
                                            <Text style={[styles.ladderText, { color: active ? colors.text : colors.textMuted, fontWeight: active ? "600" : "400" }]} numberOfLines={2}>
                                                {t(tier.labelKey)}
                                            </Text>
                                        </View>
                                    );
                                })}
                            </View>

                            <View style={[styles.worthBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.worthHead, { color: colors.textMuted }]}>
                                    {t("createTrip.perPersonPerDay", { amount: formatMoney(dailyBudgetPerPerson) })}
                                </Text>
                                <View style={styles.worthLine}>
                                    <Ionicons name={budgetTier.icon} size={14} color={budgetTier.color} />
                                    <Text style={[styles.worthText, { color: colors.text }]}>{budgetTier.description}</Text>
                                </View>
                                <View style={styles.worthLine}>
                                    <Ionicons name="person-outline" size={14} color={colors.primary} />
                                    <Text style={[styles.worthText, { color: colors.text }]}>
                                        {t("createTrip.estPerPerson")} {formatMoney(perPersonBudget)}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* ── Step 4 · vibe ──────────────────────────────────── */}
                    {step === 4 && (
                        <View style={styles.stepBody}>
                            <Text style={[styles.stepTitle, { color: colors.text }]}>{t("createTrip.q4")}</Text>
                            <Text style={[styles.stepHint, { color: colors.textMuted }]}>
                                {t("createTrip.pickUpTo", { max: MAX_VIBES, count: formData.interests.length })}
                            </Text>

                            {suggestedVibes.length > 0 && (
                                <View style={[styles.nudge, { backgroundColor: colors.primary }]}>
                                    <Ionicons name="sparkles" size={18} color="#1A1A1A" />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.nudgeTitle}>
                                            {t("createTrip.suggestedForCity", { city: localCity(splitDestination(formData.destination)[0]) })}
                                        </Text>
                                        <Text style={styles.nudgeSub} numberOfLines={1}>
                                            {suggestedVibes.map((v) => t(`interests.${v.id}`)).join(" · ")}
                                        </Text>
                                    </View>
                                    <TouchableOpacity style={styles.nudgeAction} onPress={applySuggestedMix}>
                                        <Text style={styles.nudgeActionText}>{t("createTrip.useThisMix")}</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            <View style={styles.vibeGrid}>
                                {orderedVibes.map((vibe) => {
                                    const selected = formData.interests.includes(vibe.id);
                                    const rank = suggestedVibes.findIndex((v) => v.id === vibe.id);
                                    return (
                                        <TouchableOpacity
                                            key={vibe.id}
                                            style={[
                                                styles.vibeCard,
                                                { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.text : (rank === 0 ? colors.primary : colors.border) },
                                            ]}
                                            onPress={() => toggleVibe(vibe.id)}
                                            activeOpacity={0.8}
                                        >
                                            {rank === 0 && !selected && (
                                                <View style={[styles.vibeFlag, { backgroundColor: colors.text }]}>
                                                    <Text style={[styles.vibeFlagText, { color: colors.background }]}>{t("createTrip.mostPicked")}</Text>
                                                </View>
                                            )}
                                            <Ionicons name={vibe.icon} size={20} color={selected ? colors.text : colors.primary} />
                                            <Text style={[styles.vibeName, { color: colors.text }]}>{t(`interests.${vibe.id}`)}</Text>
                                            <Text style={[styles.vibeHint, { color: selected ? "rgba(26,26,26,0.65)" : colors.textMuted }]} numberOfLines={2}>
                                                {t(vibe.hintKey)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {formData.interests.length > 0 && (
                                <View>
                                    <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 4 }]}>{t("createTrip.localExperiences")}</Text>
                                    <View style={styles.chipRow}>
                                        {LOCAL_EXPERIENCES.filter((e) => FLAVOUR_IDS.includes(e.id)).map((exp) => {
                                            const on = formData.localExperiences.includes(exp.id);
                                            return (
                                                <TouchableOpacity
                                                    key={exp.id}
                                                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.border }]}
                                                    onPress={() => toggleLocalExperience(exp.id)}
                                                >
                                                    <Ionicons name={exp.icon} size={14} color={on ? colors.text : colors.primary} />
                                                    <Text style={[styles.chipText, { color: colors.text, marginLeft: 6 }]}>{t(exp.labelKey)}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}
                        </View>
                    )}

                    {/* ── Step 5 · boarding pass ─────────────────────────── */}
                    {step === 5 && (
                        <View style={styles.stepBody}>
                            <Text style={[styles.stepTitle, { color: colors.text }]}>{t("createTrip.q5")}</Text>

                            <View style={[styles.ticket, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <View style={[styles.ticketHead, { backgroundColor: colors.primary }]}>
                                    <Text style={styles.ticketBrand}>PLANERA</Text>
                                    <Text style={styles.ticketRef}>{t("createTrip.draftDays", { count: tripDaysNow })}</Text>
                                </View>

                                <View style={styles.ticketRoute}>
                                    <View>
                                        <Text style={[styles.ticketCode, { color: colors.text }]}>{originIata || "—"}</Text>
                                        <Text style={[styles.ticketCity, { color: colors.textMuted }]} numberOfLines={1}>{originCity}</Text>
                                    </View>
                                    <View style={styles.ticketMid}>
                                        <View style={[styles.ticketDash, { borderTopColor: colors.border }]} />
                                        <Ionicons name="airplane" size={16} color={colors.textMuted} style={{ backgroundColor: colors.card, paddingHorizontal: 6 }} />
                                    </View>
                                    <View style={{ alignItems: "flex-end" }}>
                                        <Text style={[styles.ticketCode, { color: colors.text }]}>{destAirport?.iata || "—"}</Text>
                                        <Text style={[styles.ticketCity, { color: colors.textMuted }]} numberOfLines={1}>
                                            {localCity(splitDestination(formData.destination)[0])}
                                        </Text>
                                    </View>
                                </View>

                                {[
                                    { label: t("createTrip.dates"), value: rangeLabel, sub: "", goto: 2 },
                                    { label: t("createTrip.travelers"), value: t("createTrip.travelersCount", { count: formData.travelerCount }), sub: "", goto: 3 },
                                    { label: t("createTrip.totalBudget"), value: formatMoney(formData.budgetTotal), sub: `${formatMoney(perPersonBudget)} · ${budgetTier.label}`, goto: 3 },
                                    {
                                        label: t("createTrip.travelStyle"),
                                        value: formData.interests.length ? formData.interests.map((id) => t(`interests.${id}`)).join(", ") : t("createTrip.notSet"),
                                        sub: formData.localExperiences.length ? `+ ${formData.localExperiences.length}` : "",
                                        goto: 4,
                                    },
                                ].map((row) => (
                                    <TouchableOpacity key={row.label} style={[styles.ticketRow, { borderTopColor: colors.border }]} onPress={() => setStep(row.goto)} activeOpacity={0.7}>
                                        <Text style={[styles.ticketKey, { color: colors.textMuted }]}>{row.label}</Text>
                                        <View style={{ flex: 1, alignItems: "flex-end" }}>
                                            <Text style={[styles.ticketValue, { color: colors.text }]} numberOfLines={1}>{row.value}</Text>
                                            {!!row.sub && <Text style={[styles.ticketSub, { color: colors.textMuted }]} numberOfLines={1}>{row.sub}</Text>}
                                        </View>
                                        <Ionicons name="pencil" size={13} color={colors.primary} style={{ marginLeft: 8 }} />
                                    </TouchableOpacity>
                                ))}

                                <View style={styles.perfRow}>
                                    <View style={[styles.perfNotch, { backgroundColor: colors.background }]} />
                                    <View style={[styles.perfDash, { borderTopColor: colors.border }]} />
                                    <View style={[styles.perfNotch, { backgroundColor: colors.background }]} />
                                </View>

                                <View style={styles.ticketStub}>
                                    <View style={[styles.stubSpark, { backgroundColor: colors.primary }]}>
                                        <Ionicons name="sparkles" size={13} color="#1A1A1A" />
                                    </View>
                                    <Text style={[styles.stubText, { color: colors.textSecondary }]} numberOfLines={2}>{t("createTrip.stubLine")}</Text>
                                    {creditsLabel ? <Text style={[styles.stubCredits, { color: colors.textMuted }]}>{creditsLabel}</Text> : null}
                                </View>
                            </View>

                            <View style={[styles.worthBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                {[t("createTrip.valueDay"), t("createTrip.valueLive"), t("createTrip.valueFree")].map((line) => (
                                    <View key={line} style={styles.worthLine}>
                                        <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                                        <Text style={[styles.worthText, { color: colors.text }]}>{line}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {guideActive && !!currentGuideKey && GUIDE_STEP_INDEX[currentGuideKey] === step && (
                        <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                    )}
                </ScrollView>

                {/* Footer */}
                <View style={[styles.stepFooter, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
                    <TouchableOpacity
                        style={[
                            styles.primaryCta,
                            { backgroundColor: step === TOTAL_STEPS ? colors.primary : colors.text },
                            (!stepValid(step) || loading) && styles.disabledButton,
                        ]}
                        onPress={() => (step === TOTAL_STEPS ? handleSubmit() : goNext())}
                        disabled={!stepValid(step) || loading}
                        activeOpacity={0.85}
                    >
                        {loading ? (
                            <ActivityIndicator color={step === TOTAL_STEPS ? "#1A1A1A" : colors.background} />
                        ) : (
                            <>
                                <Text style={[styles.primaryCtaText, { color: step === TOTAL_STEPS ? "#1A1A1A" : colors.background }]}>
                                    {step === TOTAL_STEPS
                                        ? t("createTrip.generateWithAI")
                                        : step === 4
                                            ? t("createTrip.reviewTrip")
                                            : t("createTrip.continueLabel")}
                                </Text>
                                {step === TOTAL_STEPS && <Ionicons name="sparkles" size={18} color="#1A1A1A" />}
                            </>
                        )}
                    </TouchableOpacity>
                    {step === 2 && <Text style={[styles.footNote, { color: colors.textMuted }]}>{t("createTrip.maxDaysNote", { count: MAX_TRIP_DAYS })}</Text>}
                    {step === TOTAL_STEPS && <Text style={[styles.footNote, { color: colors.textMuted }]}>{t("createTrip.usuallyReady")}</Text>}
                </View>
                </KeyboardAvoidingView>

                {/* Time Picker Modal for Arrival/Departure times */}
                {Platform.OS === "ios" ? (
                    <Modal
                        visible={showTimePicker}
                        animationType="slide"
                        transparent={true}
                        onRequestClose={() => setShowTimePicker(false)}
                    >
                        <View style={styles.modalOverlay}>
                            <View style={[styles.calendarModal, { backgroundColor: colors.card }]}>
                                <View style={[styles.calendarHeader, { borderBottomColor: colors.border }]}>
                                    <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                                        <Text style={[styles.cancelButtonText, { color: colors.error }]}>{t("common.cancel")}</Text>
                                    </TouchableOpacity>
                                    <Text style={[styles.calendarTitle, { color: colors.text }]}>
                                        {selectingTime === "arrival" ? t("createTrip.arrivalTime") : t("createTrip.departureTime")}
                                    </Text>
                                    <TouchableOpacity onPress={confirmTimeSelection}>
                                        <Text style={[styles.doneButtonText, { color: colors.primary }]}>{t("common.done")}</Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.timePickerContainer}>
                                    <Text style={[styles.timePickerLabel, { color: colors.textMuted }]}>
                                        {selectingTime === "arrival" ? t("createTrip.whatTimeArrive") : t("createTrip.whatTimeDeparture")}
                                    </Text>
                                    <DateTimePicker
                                        value={tempTime}
                                        mode="time"
                                        display="spinner"
                                        onChange={handleTimeChange}
                                        textColor={colors.text}
                                        style={{ height: 200 }}
                                    />
                                    <Text style={[styles.timePickerHint, { color: colors.textSecondary }]}>
                                        {selectingTime === "arrival" ? t("createTrip.firstDayScheduled") : t("createTrip.lastDayEnd")}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </Modal>
                ) : (
                    showTimePicker && (
                        <DateTimePicker value={tempTime} mode="time" display="default" onChange={handleTimeChange} />
                    )
                )}
            </SafeAreaView>


        {/* AI Data Consent Modal */}
        <AIConsentModal
            visible={showAiConsentModal}
            colors={colors}
            onAccept={async () => {
                try {
                    await updateAiConsent({ token: token || "", aiDataConsent: true });
                    setShowAiConsentModal(false);
                    // Re-trigger submit after consent is granted, skip re-checking consent
                    handleSubmit({ skipConsentCheck: true });
                } catch (e) {
                    console.error("Failed to save AI consent:", e);
                }
            }}
            onDecline={() => {
                setShowAiConsentModal(false);
                Alert.alert(
                    t('createTrip.aiDisabled'),
                    t('createTrip.aiDisabledMsg'),
                );
            }}
        />
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FAF9F6",
    },
    content: {
        paddingBottom: 40,
    },
    headerSection: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 24,
    },
    headerTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        justifyContent: "center",
        alignItems: "center",
    },
    logoContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
    },
    headerLogo: {
        width: 56,
        height: 56,
        marginRight: -14,
    },
    headerLogoText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#1A1A1A",
        letterSpacing: 1,
    },
    settingsButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        justifyContent: "center",
        alignItems: "center",
    },
    titleSection: {
        marginBottom: 8,
    },
    titleMain: {
        fontSize: 32,
        fontWeight: "400",
        color: "#1A1A1A",
        lineHeight: 40,
    },
    titleHighlight: {
        fontSize: 40,
        fontWeight: "800",
        color: "#1A1A1A",
        lineHeight: 48,
        marginBottom: 8,
        borderBottomWidth: 4,
        borderBottomColor: "#FFE500",
        paddingBottom: 4,
        alignSelf: "flex-start",
    },
    subtitle: {
        fontSize: 16,
        color: "#9B9B9B",
        fontWeight: "500",
    },
    card: {
        backgroundColor: "white",
        borderRadius: 20,
        padding: 20,
        marginHorizontal: 20,
        marginBottom: 16,
        shadowColor: "#1A1A1A",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        letterSpacing: 1,
        marginBottom: 12,
        textTransform: "uppercase",
    },
    sectionHelpText: {
        fontSize: 13,
        color: "#9B9B9B",
        lineHeight: 18,
    },
    optionalBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
    },
    optionalText: {
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
    clearTimeButton: {
        marginLeft: 8,
        padding: 2,
    },
    timeImpactInfo: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 12,
        borderRadius: 8,
    },
    timeImpactText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
    },
    timePickerContainer: {
        padding: 20,
        alignItems: "center",
    },
    timePickerLabel: {
        fontSize: 15,
        textAlign: "center",
        marginBottom: 16,
    },
    timePickerHint: {
        fontSize: 13,
        textAlign: "center",
        marginTop: 16,
        paddingHorizontal: 20,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: "500",
    },
    doneButtonText: {
        fontSize: 16,
        fontWeight: "600",
    },
    locationSection: {
        gap: 12,
    },
    locationItem: {
        gap: 8,
    },
    locationLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        letterSpacing: 1,
        textTransform: "uppercase",
    },
    locationContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    locationText: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    destinationInput: {
        flex: 1,
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
        padding: 0,
    },
    swapButton: {
        alignSelf: "center",
        padding: 8,
    },
    suggestionsContainer: {
        backgroundColor: "#FFF8E1",
        borderRadius: 12,
        marginTop: 8,
        maxHeight: 200,
        overflow: "hidden",
    },
    suggestionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#F5F5F3",
    },
    suggestionCity: {
        fontSize: 15,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    suggestionDetails: {
        fontSize: 13,
        color: "#9B9B9B",
        marginTop: 2,
    },
    surpriseMeButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        marginTop: 12,
        gap: 8,
        flexWrap: "wrap",
    },
    surpriseMeText: {
        fontSize: 15,
        fontWeight: "700",
    },
    surpriseMeSubtext: {
        fontSize: 12,
        fontWeight: "500",
        width: "100%",
        textAlign: "center",
        marginTop: -4,
    },
    skipFlightsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#E8E6E1',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: '#1A1A1A',
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        backgroundColor: '#FFE500',
        borderColor: '#FFE500',
    },
    skipFlightsText: {
        fontSize: 14,
        color: '#1A1A1A',
        fontWeight: '500',
    },
    multiCityButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#F9F9F9',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E5E5',
    },
    multiCityContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    multiCityText: {
        fontSize: 15,
        color: '#1A1A1A',
        fontWeight: '600',
    },
    comingSoonBadge: {
        backgroundColor: '#FFE500',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    comingSoonText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#1A1A1A',
    },
    datesContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        padding: 4,
    },
    dateInputButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    dateSeparator: {
        width: 1,
        height: "60%",
        backgroundColor: "#E8E6E1",
    },
    dateLimitHint: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 8,
    },
    dateLimitHintText: {
        fontSize: 12,
        fontWeight: "500",
    },
    dateLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#9B9B9B",
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    dateValueContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dateValueText: {
        fontSize: 15,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    numberInputContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    inputLabel: {
        fontSize: 16,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    counterContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
    },
    counterButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "white",
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    counterValue: {
        fontSize: 18,
        fontWeight: "700",
        color: "#1A1A1A",
        minWidth: 24,
        textAlign: "center",
    },
    budgetInputContainer: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FFF8E1",
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    currencySymbol: {
        fontSize: 20,
        fontWeight: "600",
        color: "#1A1A1A",
        marginRight: 8,
    },
    budgetInput: {
        flex: 1,
        fontSize: 24,
        fontWeight: '600',
        color: '#1A1A1A',
        padding: 0,
    },
     perPersonBudgetContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
    },
    perPersonBudgetText: {
        fontSize: 14,
        fontWeight: '500',
    },
    budgetTierContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
    },
    budgetTierBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    budgetTierLabel: {
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    budgetTierInfo: {
        flex: 1,
        gap: 2,
    },
    budgetTierDaily: {
        fontSize: 15,
        fontWeight: '600',
    },
    budgetTierDescription: {
        fontSize: 12,
        fontWeight: '400',
    },
    interestsContainer: {
        flexDirection: "row",
        gap: 12,
        flexWrap: "wrap",
    },
    interestTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: "#FFF8E1",
        borderWidth: 2,
        borderColor: "#FFE500",
    },
    interestTagActive: {
        backgroundColor: "#FFE500",
        borderColor: "#FFE500",
    },
    interestTagText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    interestTagTextActive: {
        color: "#1A1A1A",
    },
    sectionSubtitle: {
        fontSize: 14,
        fontWeight: "500",
        marginBottom: 16,
        marginTop: -4,
    },
    localExperiencesContainer: {
        flexDirection: "row",
        gap: 10,
        flexWrap: "wrap",
    },
    localExperienceTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: "#FFF8E1",
        borderWidth: 2,
        borderColor: "#FFE500",
    },
    localExperienceTagText: {
        fontSize: 13,
        fontWeight: "600",
        color: "#1A1A1A",
    },
    generateButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        marginHorizontal: 20,
        marginTop: 24,
        paddingVertical: 18,
        backgroundColor: "#1A1A1A",
        borderRadius: 18,
        shadowColor: "#FFE500",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    disabledButton: {
        opacity: 0.7,
    },
    generateButtonText: {
        fontSize: 17,
        fontWeight: "700",
        color: "white",
    },
    sparkleIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: "#FFE500",
        justifyContent: "center",
        alignItems: "center",
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(26, 26, 26, 0.2)",
        justifyContent: "flex-end",
    },
    calendarModal: {
        backgroundColor: "white",
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingBottom: 40,
    },
    calendarHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: "#E8E6E1",
    },
    calendarTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
    },
    calendar: {
        marginHorizontal: 10,
    },
    loadingContainer: {
        flex: 1,
        backgroundColor: "#FAF9F6",
        alignItems: "center",
        justifyContent: "center",
    },
    loadingTitle: {
        fontSize: 20,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 8,
        textAlign: "center",
    },
    loadingDestination: {
        fontSize: 24,
        fontWeight: "800",
        color: "#FFE500",
        marginBottom: 16,
        textAlign: "center",
    },
    loadingSubtitle: {
        fontSize: 16,
        color: "#9B9B9B",
        textAlign: "center",
    },
    errorContainer: {
        flex: 1,
        backgroundColor: "#FAF9F6",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    errorContent: {
        alignItems: "center",
        maxWidth: 320,
    },
    errorTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "#1A1A1A",
        marginBottom: 12,
        textAlign: "center",
    },
    errorMessage: {
        fontSize: 16,
        color: "#9B9B9B",
        textAlign: "center",
        marginBottom: 32,
        lineHeight: 24,
    },
    errorButton: {
        paddingVertical: 14,
        paddingHorizontal: 32,
        backgroundColor: "#1A1A1A",
        borderRadius: 12,
        minWidth: 200,
        alignItems: "center",
    },
    errorButtonText: {
        fontSize: 16,
        fontWeight: "600",
        color: "white",
    },
    errorButtonSecondary: {
        paddingVertical: 14,
        paddingHorizontal: 32,
        backgroundColor: "transparent",
        borderRadius: 12,
        minWidth: 200,
        alignItems: "center",
        borderWidth: 1,
        marginTop: 12,
    },
    errorButtonSecondaryText: {
        fontSize: 16,
        fontWeight: "600",
    },
    // Traveler selection styles
    sectionHeaderRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    manageTravelersLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    manageTravelersText: {
        fontSize: 13,
        fontWeight: "600",
    },
    addTravelerPrompt: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        gap: 12,
    },
    addTravelerPromptText: {
        flex: 1,
    },
    addTravelerTitle: {
        fontSize: 15,
        fontWeight: "600",
        marginBottom: 2,
    },
    addTravelerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    travelersList: {
        gap: 10,
    },
    travelerSelectItem: {
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        gap: 12,
    },
    travelerCheckbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        justifyContent: "center",
        alignItems: "center",
    },
    travelerSelectInfo: {
        flex: 1,
    },
    travelerNameRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 2,
    },
    travelerSelectName: {
        fontSize: 15,
        fontWeight: "600",
    },
    primaryBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    primaryBadgeText: {
        fontSize: 10,
        fontWeight: "600",
        color: "#000",
    },
    travelerMetaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    travelerSelectMeta: {
        fontSize: 13,
    },
    incompleteWarning: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    incompleteText: {
        fontSize: 12,
        color: "#DC2626",
        fontWeight: "500",
    },
    addAnotherTraveler: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        gap: 8,
        marginTop: 4,
    },
    addAnotherText: {
        fontSize: 14,
        fontWeight: "600",
    },
    passengerSummary: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderRadius: 10,
        marginTop: 12,
        gap: 8,
        borderWidth: 1,
    },
    passengerSummaryText: {
        fontSize: 13,
        fontWeight: "500",
    },

    // --- Step builder ------------------------------------------------------
    stepHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    stepHeaderTitle: { fontSize: 14, fontWeight: "700", letterSpacing: 0.2 },
    stepCount: { fontSize: 13, fontWeight: "600", minWidth: 44, textAlign: "right" },
    progressTrack: { height: 3, marginHorizontal: 16, borderRadius: 2, overflow: "hidden" },
    progressFill: { height: "100%", borderRadius: 2 },
    keyboardWrap: { flex: 1 },
    stepContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
    stepBody: { gap: 14 },
    stepTitle: { fontSize: 27, fontWeight: "800", letterSpacing: -0.6, lineHeight: 31 },
    stepHint: { fontSize: 13, marginTop: -8 },

    proofBlock: { gap: 2 },
    proofRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#1FA463" },
    proofNum: { fontSize: 13, fontWeight: "800" },
    proofText: { fontSize: 13 },
    proofTicker: { fontSize: 12 },

    destField: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
    destInput: { flex: 1, fontSize: 17, fontWeight: "600", padding: 0 },
    sentAsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -8, paddingHorizontal: 4 },
    sentAsLabel: { fontSize: 11 },
    sentAsValue: { fontSize: 11, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: "hidden" },

    originChip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    originText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
    originPill: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: "hidden" },
    originChange: { marginLeft: "auto", fontSize: 13, fontWeight: "700" },

    stampGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 20, marginTop: 10, paddingHorizontal: 4 },
    stamp: { width: "46%", borderWidth: 1.2, borderRadius: 2, padding: 6, paddingBottom: 4, overflow: "visible" },
    perfLayer: { ...StyleSheet.absoluteFillObject },
    perfDot: { position: "absolute", width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
    perfDotV: { position: "absolute", width: 10, height: 10, borderRadius: 5, marginTop: -5 },
    stampPhoto: { height: 78, borderWidth: 1, borderRadius: 2, overflow: "hidden" },
    stampImage: { width: "100%", height: "100%" },
    stampDenom: { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(12,12,10,0.82)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
    stampDenomText: { color: "#FFE500", fontSize: 10, fontWeight: "700" },
    postmark: { position: "absolute", left: 5, bottom: 5, width: 30, height: 30, borderRadius: 15, borderWidth: 1.2, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center" },
    postmarkText: { color: "rgba(255,255,255,0.9)", fontSize: 9, fontWeight: "700" },
    stampCredit: { position: "absolute", right: 4, bottom: 3, color: "rgba(255,255,255,0.85)", fontSize: 8, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
    stampCaption: { borderTopWidth: 1, marginTop: 4, paddingTop: 4, alignItems: "center" },
    stampCity: { fontSize: 13, fontWeight: "700" },
    stampCountry: { fontSize: 10, fontWeight: "500" },

    askBar: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10 },
    askSpark: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    askInput: { flex: 1, fontSize: 13, padding: 0 },
    surpriseRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 12 },
    surpriseRowText: { fontSize: 14, fontWeight: "600" },

    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
    chipText: { fontSize: 13, fontWeight: "600" },

    nudge: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    nudgeTitle: { color: "#1A1A1A", fontSize: 13, fontWeight: "700" },
    nudgeSub: { color: "rgba(26,26,26,0.62)", fontSize: 11, marginTop: 1 },
    nudgeAction: { backgroundColor: "rgba(26,26,26,0.88)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
    nudgeActionText: { color: "#FFE500", fontSize: 12, fontWeight: "700" },

    inlineCalendar: { borderWidth: 1, borderRadius: 14, overflow: "hidden", paddingBottom: 4 },
    faresLoading: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    faresLoadingText: { fontSize: 12.5, flex: 1 },
    dayCell: { width: 42, height: 44, alignItems: "center", justifyContent: "center", paddingTop: 2 },
    dayNumber: { fontSize: 15, fontWeight: "500" },
    dayPrice: { fontSize: 9, fontWeight: "600", marginTop: 1 },
    readout: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
    readoutBig: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
    readoutSmall: { fontSize: 12, fontWeight: "600" },

    accordion: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12 },
    accordionText: { fontSize: 14, fontWeight: "600", flex: 1 },
    accordionOpt: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6 },
    timesBox: { borderRadius: 12, paddingHorizontal: 13 },
    timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13 },
    timeLabel: { fontSize: 13 },
    timeValue: { fontSize: 14, fontWeight: "700" },
    timeDivider: { height: 1 },

    stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    stepperBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    stepperValue: { fontSize: 17, fontWeight: "700" },

    budgetAmountRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    budgetAmount: { fontSize: 36, fontWeight: "800", letterSpacing: -1, borderBottomWidth: 1.5, borderStyle: "dashed", paddingBottom: 2 },
    budgetEdit: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
    budgetCurrency: { fontSize: 26, fontWeight: "800" },
    budgetInputBig: { flex: 1, fontSize: 30, fontWeight: "800", padding: 0 },

    sliderTrackWrap: { height: 34, justifyContent: "center", marginTop: 4 },
    sliderTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
    sliderFill: { height: "100%", borderRadius: 3 },
    sliderThumb: { position: "absolute", width: 24, height: 24, borderRadius: 12, borderWidth: 2, marginLeft: -12 },

    ladderRow: { flexDirection: "row", gap: 6 },
    ladderCell: { flex: 1, borderTopWidth: 2, paddingTop: 6 },
    ladderText: { fontSize: 10, letterSpacing: 0.3, textAlign: "center" },

    worthBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
    worthHead: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
    worthLine: { flexDirection: "row", alignItems: "center", gap: 8 },
    worthText: { fontSize: 13, flexShrink: 1 },

    vibeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    vibeCard: { width: "47%", borderWidth: 1.5, borderRadius: 14, padding: 12, gap: 5, minHeight: 104 },
    vibeFlag: { position: "absolute", top: -9, right: 10, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
    vibeFlagText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
    vibeName: { fontSize: 14, fontWeight: "700" },
    vibeHint: { fontSize: 11, lineHeight: 14 },

    ticket: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
    ticketHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 13, paddingVertical: 9 },
    ticketBrand: { color: "#1A1A1A", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
    ticketRef: { color: "rgba(26,26,26,0.66)", fontSize: 11, fontWeight: "700" },
    ticketRoute: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingTop: 13, paddingBottom: 10 },
    ticketCode: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
    ticketCity: { fontSize: 11 },
    ticketMid: { flex: 1, alignItems: "center", justifyContent: "center" },
    ticketDash: { position: "absolute", left: 0, right: 0, top: "50%", borderTopWidth: 1, borderStyle: "dashed" },
    ticketRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, paddingHorizontal: 13, paddingVertical: 10, gap: 10 },
    ticketKey: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
    ticketValue: { fontSize: 13, fontWeight: "600" },
    ticketSub: { fontSize: 11, marginTop: 1 },
    perfRow: { flexDirection: "row", alignItems: "center" },
    perfNotch: { width: 14, height: 14, borderRadius: 7, marginVertical: -7 },
    perfDash: { flex: 1, borderTopWidth: 1, borderStyle: "dashed" },
    ticketStub: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, paddingVertical: 11 },
    stubSpark: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    stubText: { fontSize: 12, flex: 1 },
    stubCredits: { fontSize: 11, fontWeight: "700" },

    stepFooter: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 8 },
    primaryCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
    primaryCtaText: { fontSize: 16, fontWeight: "700" },
    footNote: { fontSize: 11, textAlign: "center" },
});
