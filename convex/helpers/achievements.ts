// Static achievement definitions — hardcoded, not stored in DB.
// Each badge has: id, titleKey (i18n), descriptionKey (i18n), icon (Ionicons name), category, and a threshold.

export interface AchievementDef {
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  category: "explorer" | "globetrotter" | "community" | "booker" | "social" | "engagement" | "premium";
  /** The stat field to compare (maps to getUserStats or streak/referral data) */
  statField: string;
  threshold: number;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  // Explorer — trip milestones
  { id: "first_trip", titleKey: "achievements.first_trip_title", descriptionKey: "achievements.first_trip_desc", icon: "airplane", category: "explorer", statField: "totalTrips", threshold: 1 },
  { id: "5_trips", titleKey: "achievements.trips_5_title", descriptionKey: "achievements.trips_5_desc", icon: "airplane", category: "explorer", statField: "totalTrips", threshold: 5 },
  { id: "10_trips", titleKey: "achievements.trips_10_title", descriptionKey: "achievements.trips_10_desc", icon: "airplane", category: "explorer", statField: "totalTrips", threshold: 10 },
  { id: "25_trips", titleKey: "achievements.trips_25_title", descriptionKey: "achievements.trips_25_desc", icon: "airplane", category: "explorer", statField: "totalTrips", threshold: 25 },

  // Globetrotter — countries
  { id: "3_countries", titleKey: "achievements.countries_3_title", descriptionKey: "achievements.countries_3_desc", icon: "globe", category: "globetrotter", statField: "totalCountries", threshold: 3 },
  { id: "5_countries", titleKey: "achievements.countries_5_title", descriptionKey: "achievements.countries_5_desc", icon: "globe", category: "globetrotter", statField: "totalCountries", threshold: 5 },
  { id: "10_countries", titleKey: "achievements.countries_10_title", descriptionKey: "achievements.countries_10_desc", icon: "globe", category: "globetrotter", statField: "totalCountries", threshold: 10 },
  { id: "25_countries", titleKey: "achievements.countries_25_title", descriptionKey: "achievements.countries_25_desc", icon: "globe", category: "globetrotter", statField: "totalCountries", threshold: 25 },

  // Community — insights & likes
  { id: "first_insight", titleKey: "achievements.first_insight_title", descriptionKey: "achievements.first_insight_desc", icon: "bulb", category: "community", statField: "insightsShared", threshold: 1 },
  { id: "10_insights", titleKey: "achievements.insights_10_title", descriptionKey: "achievements.insights_10_desc", icon: "bulb", category: "community", statField: "insightsShared", threshold: 10 },
  { id: "50_likes", titleKey: "achievements.likes_50_title", descriptionKey: "achievements.likes_50_desc", icon: "heart", category: "community", statField: "totalLikesReceived", threshold: 50 },

  // Booker — flights booked
  { id: "first_flight", titleKey: "achievements.first_flight_title", descriptionKey: "achievements.first_flight_desc", icon: "ticket", category: "booker", statField: "totalFlightsBooked", threshold: 1 },
  { id: "5_flights", titleKey: "achievements.flights_5_title", descriptionKey: "achievements.flights_5_desc", icon: "ticket", category: "booker", statField: "totalFlightsBooked", threshold: 5 },

  // Social — referrals
  { id: "first_referral", titleKey: "achievements.first_referral_title", descriptionKey: "achievements.first_referral_desc", icon: "people", category: "social", statField: "totalReferrals", threshold: 1 },
  { id: "5_referrals", titleKey: "achievements.referrals_5_title", descriptionKey: "achievements.referrals_5_desc", icon: "people", category: "social", statField: "totalReferrals", threshold: 5 },

  // Engagement — streaks
  { id: "streak_7", titleKey: "achievements.streak_7_title", descriptionKey: "achievements.streak_7_desc", icon: "flame", category: "engagement", statField: "longestStreak", threshold: 7 },
  { id: "streak_30", titleKey: "achievements.streak_30_title", descriptionKey: "achievements.streak_30_desc", icon: "flame", category: "engagement", statField: "longestStreak", threshold: 30 },
  { id: "streak_100", titleKey: "achievements.streak_100_title", descriptionKey: "achievements.streak_100_desc", icon: "flame", category: "engagement", statField: "longestStreak", threshold: 100 },

  // Premium
  { id: "subscriber", titleKey: "achievements.subscriber_title", descriptionKey: "achievements.subscriber_desc", icon: "diamond", category: "premium", statField: "isSubscriber", threshold: 1 },
];

export const ACHIEVEMENT_CATEGORIES = [
  { id: "explorer", titleKey: "achievements.explorer", icon: "compass" },
  { id: "globetrotter", titleKey: "achievements.globetrotter", icon: "globe" },
  { id: "community", titleKey: "achievements.community", icon: "people" },
  { id: "booker", titleKey: "achievements.booker", icon: "ticket" },
  { id: "social", titleKey: "achievements.social", icon: "share-social" },
  { id: "engagement", titleKey: "achievements.engagement", icon: "flame" },
  { id: "premium", titleKey: "achievements.premium", icon: "diamond" },
] as const;
