/**
 * Shared pre-generation config for the Partner API.
 *
 * Kept in a plain (non-"use node") module so it can be imported by both the
 * Node pre-generation actions (`partnerPregenerate.ts`) and the V8 admin query
 * that reports pre-generation status (`partnerApiAdmin.ts`).
 */

/** Durations (in days) we pre-build for every pre-generated city. */
export const DEFAULT_DURATIONS = [3, 4, 5, 7];

/** Curated top global destinations for pre-generation. */
export const CURATED_CITIES = [
  "Paris, France",
  "London, United Kingdom",
  "Rome, Italy",
  "Barcelona, Spain",
  "Madrid, Spain",
  "Amsterdam, Netherlands",
  "Berlin, Germany",
  "Prague, Czech Republic",
  "Vienna, Austria",
  "Lisbon, Portugal",
  "Athens, Greece",
  "Santorini, Greece",
  "Venice, Italy",
  "Florence, Italy",
  "Milan, Italy",
  "Istanbul, Turkey",
  "Dubai, United Arab Emirates",
  "New York City, USA",
  "Los Angeles, USA",
  "San Francisco, USA",
  "Miami, USA",
  "Las Vegas, USA",
  "Cancun, Mexico",
  "Mexico City, Mexico",
  "Rio de Janeiro, Brazil",
  "Buenos Aires, Argentina",
  "Tokyo, Japan",
  "Kyoto, Japan",
  "Bangkok, Thailand",
  "Singapore",
  "Bali, Indonesia",
  "Hong Kong",
  "Seoul, South Korea",
  "Sydney, Australia",
  "Marrakech, Morocco",
  "Cairo, Egypt",
  "Cape Town, South Africa",
  "Budapest, Hungary",
  "Dublin, Ireland",
  "Edinburgh, United Kingdom",
];
