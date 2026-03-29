import { useState, useRef, useCallback, useEffect } from "react";
import React from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, Image, StatusBar, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "convex/react";
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
import { CITY_TRANSLATIONS, COUNTRY_TRANSLATIONS } from "@/lib/destinationTranslations";

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
                scrollRef.current.getInnerViewRef() as any,
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
            setTimeout(() => scrollToSection(GUIDE_STEPS[next].key), 300);
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
        interests: prefilledInterests ? prefilledInterests.split(",").filter(Boolean) : [] as string[],
        localExperiences: [] as string[],
        skipFlights: false,
        skipHotel: false,
        preferredFlightTime: "any" as "any" | "morning" | "afternoon" | "evening" | "night",
        // Arrival/Departure times (optional, ISO string in destination timezone)
        arrivalTime: null as string | null,
        departureTime: null as string | null,
    });

        // V1: Compute per-person budget on the fly
    const perPersonBudget = Math.round(formData.budgetTotal / formData.travelerCount);

    // Compute trip days and budget tier for display
    const tripDays = Math.max(1, Math.ceil((formData.endDate - formData.startDate) / (24 * 60 * 60 * 1000)));
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
                origin: userSettings.homeAirport || prev.origin,
                budgetTotal: userSettings.defaultBudget || prev.budgetTotal,
                travelerCount: userSettings.defaultTravelers || prev.travelerCount,
                interests: userSettings.interests && userSettings.interests.length > 0 ? userSettings.interests : prev.interests,
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
        setFormData({ ...formData, destination: `${destination.city}, ${destination.country}` });
        setShowDestinationSuggestions(false);
        setDestinationSuggestions([]);
    };

    const pickRandomDestination = () => {
        const randomIndex = Math.floor(Math.random() * DESTINATIONS.length);
        const dest = DESTINATIONS[randomIndex];
        setFormData({ ...formData, destination: `${dest.city}, ${dest.country}` });
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

    const MAX_TRIP_DAYS = 15;

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
                // Check if existing end date would exceed 15 days from new start
                const daysDiff = Math.ceil((formData.endDate - selectedTimestamp) / (24 * 60 * 60 * 1000));
                if (daysDiff > MAX_TRIP_DAYS) {
                    setFormData({
                        ...formData,
                        startDate: selectedTimestamp,
                        endDate: selectedTimestamp + MAX_TRIP_DAYS * 24 * 60 * 60 * 1000,
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
            const daysDiff = Math.ceil((selectedTimestamp - formData.startDate) / (24 * 60 * 60 * 1000));
            if (daysDiff > MAX_TRIP_DAYS) {
                Alert.alert(t('createTrip.tripTooLong'), t('createTrip.tripTooLongReturn'));
                return;
            }
            setFormData({ ...formData, endDate: selectedTimestamp });
        }
        setShowCalendar(false);
    };

     // V1: Traveler profiles disabled - removed getSelectedTravelersWithAges and areAllTravelersReady

    const handleSubmit = async (options?: { skipConsentCheck?: boolean }) => {
        if (!formData.destination) {
            Alert.alert(t('common.error'), t('createTrip.pleaseEnterDestination'));
            return;
        }

        if (!formData.skipFlights && !formData.origin) {
            Alert.alert(t('common.error'), t('createTrip.pleaseEnterOrigin'));
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

        // Validate trip duration (max 15 days)
        const submitTripDays = Math.ceil((formData.endDate - formData.startDate) / (24 * 60 * 60 * 1000));
        if (submitTripDays > 15) {
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
            
            setIsCreditsError(isNoCredits);
            setErrorMessage(isNoCredits 
                ? t('createTrip.usedAllCredits')
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

    return (
        <>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor="transparent" translucent={true} />
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {/* Header */}
                <View style={styles.headerSection}>
                    <View style={styles.headerTop}>
                        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: colors.secondary }]}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <View style={styles.logoContainer}>
                            <Image source={logoImage} style={styles.headerLogo} resizeMode="contain" />
                            <Text style={[styles.headerLogoText, { color: colors.text }]}>PLANERA</Text>
                        </View>
                        <View style={{ width: 44 }} />
                    </View>
                    
                    <View style={styles.titleSection}>
                        <Text style={[styles.titleMain, { color: colors.text }]}>{t('createTrip.designYour')}</Text>
                        <Text style={[styles.titleHighlight, { color: colors.text, borderBottomColor: colors.primary }]}>{t('createTrip.perfectEscape')}</Text>
                        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('createTrip.letAICraft')}</Text>
                    </View>
                </View>

                {/* From/To Section */}
                <View ref={(r) => { sectionRefs.current["destination"] = r; }} style={[styles.card, { backgroundColor: colors.card }, getHighlightStyle("destination")]}>
                    <View style={styles.locationSection}>
                        <View style={styles.locationItem}>
                            <Text style={[styles.locationLabel, { color: colors.textMuted }]}>{t('createTrip.from')}</Text>
                            <View style={styles.locationContent}>
                                <Ionicons name="location" size={24} color={colors.text} />
                                <TextInput
                                    style={[styles.locationText, { color: colors.text }]}
                                    placeholder={t('createTrip.whereFrom')}
                                    placeholderTextColor={colors.textMuted}
                                    value={formData.origin}
                                    onChangeText={(text) => setFormData({ ...formData, origin: text })}
                                />
                            </View>
                        </View>

                        <TouchableOpacity style={styles.swapButton}>
                            <Ionicons name="swap-vertical" size={20} color={colors.textMuted} />
                        </TouchableOpacity>

                        <View style={styles.locationItem}>
                            <Text style={[styles.locationLabel, { color: colors.textMuted }]}>{t('createTrip.to')}</Text>
                            <View style={styles.locationContent}>
                                <Ionicons name="location" size={24} color={colors.error} />
                                <TextInput
                                    style={[styles.destinationInput, { color: colors.text }]}
                                    placeholder={t('createTrip.whereTo')}
                                    placeholderTextColor={colors.textMuted}
                                    value={formData.destination}
                                    onChangeText={(text) => {
                                        setFormData({ ...formData, destination: text });
                                        searchDestinations(text);
                                    }}
                                    onFocus={() => {
                                        if (formData.destination.length >= 2) {
                                            searchDestinations(formData.destination);
                                        }
                                    }}
                                />
                            </View>
                            
                            {showDestinationSuggestions && destinationSuggestions.length > 0 && (
                                <View style={[styles.suggestionsContainer, { backgroundColor: colors.secondary }]}>
                                    <ScrollView nestedScrollEnabled={true} keyboardShouldPersistTaps="handled">
                                        {destinationSuggestions.map((dest, index) => (
                                            <TouchableOpacity
                                                key={`${dest.city}-${dest.country}-${index}`}
                                                style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
                                                onPress={() => selectDestination(dest)}
                                            >
                                                <Text style={{ fontSize: 18, marginRight: 12 }}>{dest.image}</Text>
                                                <View>
                                                    <Text style={[styles.suggestionCity, { color: colors.text }]}>{dest.city}</Text>
                                                    <Text style={[styles.suggestionDetails, { color: colors.textMuted }]}>{dest.country}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Surprise Me - Random Destination */}
                    <TouchableOpacity 
                        style={[styles.surpriseMeButton, { backgroundColor: colors.primary }]} 
                        onPress={pickRandomDestination}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="shuffle" size={20} color={colors.text} />
                        <Text style={[styles.surpriseMeText, { color: colors.text }]}>{t('createTrip.surpriseMe')}</Text>
                        <Text style={[styles.surpriseMeSubtext, { color: colors.text, opacity: 0.7 }]}>{t('createTrip.pickRandom')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.multiCityButton, { backgroundColor: colors.inputBackground, borderColor: colors.border }]} disabled={true}>
                        <View style={styles.multiCityContent}>
                            <Ionicons name="git-merge-outline" size={20} color={colors.text} />
                            <Text style={[styles.multiCityText, { color: colors.text }]}>{t('createTrip.multiCityTrip')}</Text>
                        </View>
                        <View style={[styles.comingSoonBadge, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.comingSoonText, { color: colors.text }]}>{t('common.comingSoon')}</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {currentGuideKey === "destination" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}

                {/* Dates Section */}
                <View ref={(r) => { sectionRefs.current["dates"] = r; }} style={[styles.card, { backgroundColor: colors.card }, getHighlightStyle("dates")]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.dates')}</Text>
                    <View style={[styles.datesContainer, { backgroundColor: colors.secondary }]}>
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingDate('start');
                                setShowCalendar(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{t('createTrip.startDate')}</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(formData.startDate)}</Text>
                            </View>
                        </TouchableOpacity>
                        
                        <View style={[styles.dateSeparator, { backgroundColor: colors.border }]} />

                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingDate('end');
                                setShowCalendar(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{t('createTrip.endDate')}</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                                <Text style={[styles.dateValueText, { color: colors.text }]}>{formatDate(formData.endDate)}</Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.dateLimitHint}>
                        <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                        <Text style={[styles.dateLimitHintText, { color: colors.textMuted }]}>
                            {t('createTrip.daysSelected', { count: tripDays })}
                        </Text>
                    </View>
                </View>

                {currentGuideKey === "dates" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}

                {/* Flight Times Section (Optional) - Affects itinerary timing */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <View style={styles.sectionHeaderRow}>
                        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.flightTimes')}</Text>
                        <View style={[styles.optionalBadge, { backgroundColor: colors.secondary }]}>
                            <Text style={[styles.optionalText, { color: colors.textMuted }]}>{t('common.optional')}</Text>
                        </View>
                    </View>
                    <Text style={[styles.sectionHelpText, { color: colors.textSecondary }]}>
                        {t('createTrip.flightTimesHelp')}
                    </Text>
                    
                    <View style={[styles.datesContainer, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                        {/* Arrival Time */}
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingTime('arrival');
                                // Initialize temp time based on existing arrival time or default to 3:00 PM
                                const defaultTime = formData.arrivalTime 
                                    ? new Date(formData.arrivalTime) 
                                    : new Date(new Date().setHours(15, 0, 0, 0));
                                setTempTime(defaultTime);
                                setShowTimePicker(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{t('createTrip.arrivalAtDestination')}</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="airplane" size={20} color={colors.text} style={{ transform: [{ rotate: '45deg' }] }} />
                                <Text style={[styles.dateValueText, { color: formData.arrivalTime ? colors.text : colors.textMuted }]}>
                                    {formData.arrivalTime ? formatTime(formData.arrivalTime) : t('createTrip.tapToSet')}
                                </Text>
                                {formData.arrivalTime && (
                                    <TouchableOpacity 
                                        onPress={(e) => { e.stopPropagation(); clearTime('arrival'); }}
                                        style={styles.clearTimeButton}
                                    >
                                        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </TouchableOpacity>
                        
                        <View style={[styles.dateSeparator, { backgroundColor: colors.border }]} />

                        {/* Departure Time */}
                        <TouchableOpacity 
                            style={styles.dateInputButton}
                            onPress={() => {
                                setSelectingTime('departure');
                                // Initialize temp time based on existing departure time or default to 6:00 PM
                                const defaultTime = formData.departureTime 
                                    ? new Date(formData.departureTime) 
                                    : new Date(new Date().setHours(18, 0, 0, 0));
                                setTempTime(defaultTime);
                                setShowTimePicker(true);
                            }}
                        >
                            <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{t('createTrip.departureFromDestination')}</Text>
                            <View style={styles.dateValueContainer}>
                                <Ionicons name="airplane" size={20} color={colors.text} style={{ transform: [{ rotate: '-45deg' }] }} />
                                <Text style={[styles.dateValueText, { color: formData.departureTime ? colors.text : colors.textMuted }]}>
                                    {formData.departureTime ? formatTime(formData.departureTime) : t('createTrip.tapToSet')}
                                </Text>
                                {formData.departureTime && (
                                    <TouchableOpacity 
                                        onPress={(e) => { e.stopPropagation(); clearTime('departure'); }}
                                        style={styles.clearTimeButton}
                                    >
                                        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </TouchableOpacity>
                    </View>
                    
                    {/* Help text explaining the impact */}
                    {(formData.arrivalTime || formData.departureTime) && (
                        <View style={[styles.timeImpactInfo, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                            <Text style={[styles.timeImpactText, { color: colors.textSecondary }]}>
                                {formData.arrivalTime && !formData.departureTime && 
                                    t('createTrip.firstDayActivities')}
                                {!formData.arrivalTime && formData.departureTime && 
                                    t('createTrip.lastDayActivities')}
                                {formData.arrivalTime && formData.departureTime && 
                                    t('createTrip.itineraryAdjusted')}
                            </Text>
                        </View>
                    )}
                </View>

  {/* Who's Going Section - V1: Simple Traveler Count (Profiles Disabled) */}
                <View ref={(r) => { sectionRefs.current["travelers"] = r; }} style={[styles.card, { backgroundColor: colors.card }, getHighlightStyle("travelers")]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.numberOfTravelers')} <Text style={{ color: colors.error }}>*</Text></Text>
                    {/* V1: Simple stepper for traveler count */}
                    <View style={[styles.numberInputContainer, { backgroundColor: colors.secondary }]}>
                        <View style={styles.counterContainer}>
                            <TouchableOpacity 
                                style={[styles.counterButton, { backgroundColor: colors.card }]}
                                onPress={() => setFormData(prev => ({ 
                                    ...prev, 
                                    travelerCount: Math.max(1, prev.travelerCount - 1) 
                                }))}
                                disabled={formData.travelerCount <= 1}
                            >
                                <Ionicons name="remove" size={24} color={formData.travelerCount <= 1 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                            <Text style={[styles.counterValue, { color: colors.text }]}>{formData.travelerCount}</Text>
                            <TouchableOpacity 
                                style={[styles.counterButton, { backgroundColor: colors.card }]}
                                onPress={() => setFormData(prev => ({ 
                                    ...prev, 
                                    travelerCount: Math.min(12, prev.travelerCount + 1) 
                                }))}
                                disabled={formData.travelerCount >= 12}
                            >
                                <Ionicons name="add" size={24} color={formData.travelerCount >= 12 ? colors.textMuted : colors.text} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {currentGuideKey === "travelers" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}

                {/* Budget Section */}
                <View ref={(r) => { sectionRefs.current["budget"] = r; }} style={[styles.card, { backgroundColor: colors.card }, getHighlightStyle("budget")]}>
                        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.totalBudget')} <Text style={{ color: colors.error }}>*</Text></Text>
                    <View style={[styles.budgetInputContainer, { backgroundColor: colors.secondary }]}>
                        <Text style={[styles.currencySymbol, { color: colors.text }]}>€</Text>
                        <TextInput
                            style={[styles.budgetInput, { color: colors.text }]}
                            value={formData.budgetTotal.toString()}
                            onChangeText={(text) => {
                                const value = parseInt(text.replace(/[^0-9]/g, '')) || 0;
                                setFormData({ ...formData, budgetTotal: value });
                            }}
                            keyboardType="numeric"
                            placeholder={t('createTrip.enterTotalBudget')}
                            placeholderTextColor={colors.textMuted}
                        />
                    </View>
                       {/* V1: Show per-person budget breakdown */}
                    <View style={[styles.perPersonBudgetContainer, { backgroundColor: colors.secondary, marginTop: 12 }]}>
                        <Ionicons name="person-outline" size={18} color={colors.primary} />
                        <Text style={[styles.perPersonBudgetText, { color: colors.text }]}>
                            {t('createTrip.estPerPerson')} <Text style={{ fontWeight: '700', color: colors.primary }}>€{perPersonBudget}</Text>
                        </Text>
                    </View>

                    {/* Budget Tier Indicator */}
                    <View style={[styles.budgetTierContainer, { backgroundColor: colors.secondary, marginTop: 8 }]}>
                        <View style={[styles.budgetTierBadge, { backgroundColor: budgetTier.color + '20' }]}>
                            <Ionicons name={budgetTier.icon} size={16} color={budgetTier.color} />
                            <Text style={[styles.budgetTierLabel, { color: budgetTier.color }]}>{budgetTier.label}</Text>
                        </View>
                        <View style={styles.budgetTierInfo}>
                            <Text style={[styles.budgetTierDaily, { color: colors.text }]}>~€{dailyBudgetPerPerson}<Text style={{ color: colors.textMuted, fontSize: 12 }}>/person/day</Text></Text>
                            <Text style={[styles.budgetTierDescription, { color: colors.textMuted }]}>{budgetTier.description}</Text>
                        </View>
                    </View>
                </View>

                {currentGuideKey === "budget" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}

                {/* Travel Style Section */}
                <View ref={(r) => { sectionRefs.current["interests"] = r; }} style={[styles.card, { backgroundColor: colors.card }, getHighlightStyle("interests")]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.travelStyle')}</Text>
                    <View style={styles.interestsContainer}>
                        {INTERESTS.map((interest) => (
                            <TouchableOpacity
                                key={interest}
                                style={[
                                    styles.interestTag,
                                    { backgroundColor: colors.secondary, borderColor: colors.primary },
                                    formData.interests.includes(interest) && { backgroundColor: colors.primary },
                                ]}
                                onPress={() => toggleInterest(interest)}
                            >
                                <Ionicons 
                                    name={
                                        interest === "Adventure" ? "trail-sign" : 
                                        interest === "Culinary" ? "restaurant" : 
                                        interest === "Culture" ? "library" :
                                        interest === "Relaxation" ? "cafe" :
                                        interest === "Nightlife" ? "wine" :
                                        interest === "Nature" ? "leaf" :
                                        interest === "History" ? "book" :
                                        interest === "Shopping" ? "cart" :
                                        interest === "Luxury" ? "diamond" :
                                        "people"
                                    } 
                                    size={20} 
                                    color={formData.interests.includes(interest) ? colors.text : colors.primary}
                                />
                                <Text style={[
                                    styles.interestTagText,
                                    { color: colors.text },
                                ]}>
                                    {t(`interests.${interest}`)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {currentGuideKey === "interests" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}

                {/* Local Experiences Section (Optional) */}
                <View style={[styles.card, { backgroundColor: colors.card }]}>
                    <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('createTrip.localExperiences')}</Text>
                    <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                        {t('createTrip.experienceLikeLocal')}
                    </Text>
                    <View style={styles.localExperiencesContainer}>
                        {LOCAL_EXPERIENCES.map((experience) => (
                            <TouchableOpacity
                                key={experience.id}
                                style={[
                                    styles.localExperienceTag,
                                    { backgroundColor: colors.secondary, borderColor: colors.primary },
                                    formData.localExperiences.includes(experience.id) && { backgroundColor: colors.primary },
                                ]}
                                onPress={() => toggleLocalExperience(experience.id)}
                            >
                                <Ionicons 
                                    name={experience.icon}
                                    size={18} 
                                    color={formData.localExperiences.includes(experience.id) ? colors.text : colors.primary}
                                />
                                <Text style={[
                                    styles.localExperienceTagText,
                                    { color: colors.text },
                                ]}>
                                    {t(experience.labelKey)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Generate Button */}
                <View ref={(r) => { sectionRefs.current["generate"] = r; }}>
                {currentGuideKey === "generate" && (
                    <TripGuideTooltip step={GUIDE_STEPS[guideStep]} currentIndex={guideStep} totalSteps={GUIDE_STEPS.length} onNext={advanceGuide} onSkip={dismissGuide} />
                )}
                <TouchableOpacity 
                    style={[styles.generateButton, { backgroundColor: colors.text }, loading && styles.disabledButton, currentGuideKey === "generate" ? { borderWidth: 2, borderColor: colors.primary } : {}]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={colors.background} />
                    ) : (
                        <>
                            <Text style={[styles.generateButtonText, { color: colors.background }]}>{t('createTrip.generateWithAI')}</Text>
                            <View style={[styles.sparkleIcon, { backgroundColor: colors.primary }]}>
                                <Ionicons name="sparkles" size={20} color={colors.text} />
                            </View>
                        </>
                    )}
                </TouchableOpacity>
                </View>

                {/* Calendar Modal */}
                <Modal
                    visible={showCalendar}
                    animationType="slide"
                    transparent={true}
                    onRequestClose={() => setShowCalendar(false)}
                >
                    <View style={styles.modalOverlay}>
                        <View style={[styles.calendarModal, { backgroundColor: colors.card }]}>
                            <View style={[styles.calendarHeader, { borderBottomColor: colors.border }]}>
                                <Text style={[styles.calendarTitle, { color: colors.text }]}>
                                    {selectingDate === 'start' ? t('createTrip.selectDepartureDate') : t('createTrip.selectReturnDate')}
                                </Text>
                                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                                    <Ionicons name="close" size={24} color={colors.text} />
                                </TouchableOpacity>
                            </View>
                            
                            <Calendar
                                initialDate={formatDateForCalendar(selectingDate === 'start' ? formData.startDate : formData.endDate)}
                                minDate={selectingDate === 'start' ? formatDateForCalendar(Date.now()) : formatDateForCalendar(formData.startDate + 24 * 60 * 60 * 1000)}
                                maxDate={selectingDate === 'end' ? formatDateForCalendar(formData.startDate + MAX_TRIP_DAYS * 24 * 60 * 60 * 1000) : formatDateForCalendar(Date.now() + 18 * 30 * 24 * 60 * 60 * 1000)}
                                onDayPress={handleDayPress}
                                markingType={'period'}
                                markedDates={getMarkedDates()}
                                theme={{
                                    backgroundColor: colors.card,
                                    calendarBackground: colors.card,
                                    textSectionTitleColor: colors.primary,
                                    selectedDayBackgroundColor: colors.primary,
                                    selectedDayTextColor: colors.text,
                                    todayTextColor: colors.primary,
                                    dayTextColor: colors.text,
                                    textDisabledColor: colors.border,
                                    dotColor: colors.primary,
                                    selectedDotColor: colors.text,
                                    arrowColor: colors.primary,
                                    monthTextColor: colors.text,
                                    textDayFontWeight: '500',
                                    textMonthFontWeight: '700',
                                    textDayHeaderFontWeight: '600',
                                    textDayFontSize: 16,
                                    textMonthFontSize: 18,
                                    textDayHeaderFontSize: 14,
                                }}
                                style={styles.calendar}
                            />
                        </View>
                    </View>
                </Modal>

                {/* Time Picker Modal for Arrival/Departure times */}
                {Platform.OS === 'ios' ? (
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
                                        <Text style={[styles.cancelButtonText, { color: colors.error }]}>{t('common.cancel')}</Text>
                                    </TouchableOpacity>
                                    <Text style={[styles.calendarTitle, { color: colors.text }]}>
                                        {selectingTime === 'arrival' ? t('createTrip.arrivalTime') : t('createTrip.departureTime')}
                                    </Text>
                                    <TouchableOpacity onPress={confirmTimeSelection}>
                                        <Text style={[styles.doneButtonText, { color: colors.primary }]}>{t('common.done')}</Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.timePickerContainer}>
                                    <Text style={[styles.timePickerLabel, { color: colors.textMuted }]}>
                                        {selectingTime === 'arrival' 
                                            ? t('createTrip.whatTimeArrive') 
                                            : t('createTrip.whatTimeDeparture')}
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
                                        {selectingTime === 'arrival' 
                                            ? t('createTrip.firstDayScheduled') 
                                            : t('createTrip.lastDayEnd')}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </Modal>
                ) : (
                    showTimePicker && (
                        <DateTimePicker
                            value={tempTime}
                            mode="time"
                            display="default"
                            onChange={handleTimeChange}
                        />
                    )
                )}
            </ScrollView>
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
});
