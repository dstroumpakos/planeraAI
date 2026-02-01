/**
 * Backend feature flags for V1 MVP
 * Controls which features are enabled/disabled in Convex functions
 */
export const FEATURES = {
  /** Flight booking integrations */
  FLIGHTS: false,
  /** Hotel booking integrations */
  HOTELS: false,
  /** Duffel flight API integration */
  DUFFEL: false,
  /** Hotel provider integration */
  HOTEL_PROVIDER: false,
  /** Viator activities API integration */
  VIATOR: false,
  /** Activities provider integration (any) */
  ACTIVITIES_PROVIDER: false,
} as const;

export type FeatureFlags = typeof FEATURES;
export type FeatureKey = keyof FeatureFlags;