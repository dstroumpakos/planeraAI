/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _features from "../_features.js";
import type * as achievements from "../achievements.js";
import type * as admin from "../admin.js";
import type * as atlas from "../atlas.js";
import type * as authNative from "../authNative.js";
import type * as authNativeDb from "../authNativeDb.js";
import type * as bookingDraft from "../bookingDraft.js";
import type * as bookingDraftMutations from "../bookingDraftMutations.js";
import type * as bookingLinks from "../bookingLinks.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as dealExtractor from "../dealExtractor.js";
import type * as emailHelpers from "../emailHelpers.js";
import type * as emails from "../emails.js";
import type * as features from "../features.js";
import type * as flightBooking from "../flightBooking.js";
import type * as flightBookingMutations from "../flightBookingMutations.js";
import type * as flights_duffel from "../flights/duffel.js";
import type * as flights_duffelExtras from "../flights/duffelExtras.js";
import type * as flights_fallback from "../flights/fallback.js";
import type * as functions from "../functions.js";
import type * as helpers_achievements from "../helpers/achievements.js";
import type * as helpers_geo from "../helpers/geo.js";
import type * as helpers_subscription from "../helpers/subscription.js";
import type * as helpers_unsplash from "../helpers/unsplash.js";
import type * as images from "../images.js";
import type * as insights from "../insights.js";
import type * as lowFareRadar from "../lowFareRadar.js";
import type * as notifications from "../notifications.js";
import type * as passwordReset from "../passwordReset.js";
import type * as passwordResetDb from "../passwordResetDb.js";
import type * as postmark from "../postmark.js";
import type * as referrals from "../referrals.js";
import type * as sights from "../sights.js";
import type * as sightsAction from "../sightsAction.js";
import type * as stats from "../stats.js";
import type * as streaks from "../streaks.js";
import type * as travelers from "../travelers.js";
import type * as tripCollaborators from "../tripCollaborators.js";
import type * as tripShareLinks from "../tripShareLinks.js";
import type * as trips from "../trips.js";
import type * as tripsActions from "../tripsActions.js";
import type * as users from "../users.js";
import type * as watchedDestinations from "../watchedDestinations.js";
import type * as wishlist from "../wishlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _features: typeof _features;
  achievements: typeof achievements;
  admin: typeof admin;
  atlas: typeof atlas;
  authNative: typeof authNative;
  authNativeDb: typeof authNativeDb;
  bookingDraft: typeof bookingDraft;
  bookingDraftMutations: typeof bookingDraftMutations;
  bookingLinks: typeof bookingLinks;
  bookings: typeof bookings;
  crons: typeof crons;
  dealExtractor: typeof dealExtractor;
  emailHelpers: typeof emailHelpers;
  emails: typeof emails;
  features: typeof features;
  flightBooking: typeof flightBooking;
  flightBookingMutations: typeof flightBookingMutations;
  "flights/duffel": typeof flights_duffel;
  "flights/duffelExtras": typeof flights_duffelExtras;
  "flights/fallback": typeof flights_fallback;
  functions: typeof functions;
  "helpers/achievements": typeof helpers_achievements;
  "helpers/geo": typeof helpers_geo;
  "helpers/subscription": typeof helpers_subscription;
  "helpers/unsplash": typeof helpers_unsplash;
  images: typeof images;
  insights: typeof insights;
  lowFareRadar: typeof lowFareRadar;
  notifications: typeof notifications;
  passwordReset: typeof passwordReset;
  passwordResetDb: typeof passwordResetDb;
  postmark: typeof postmark;
  referrals: typeof referrals;
  sights: typeof sights;
  sightsAction: typeof sightsAction;
  stats: typeof stats;
  streaks: typeof streaks;
  travelers: typeof travelers;
  tripCollaborators: typeof tripCollaborators;
  tripShareLinks: typeof tripShareLinks;
  trips: typeof trips;
  tripsActions: typeof tripsActions;
  users: typeof users;
  watchedDestinations: typeof watchedDestinations;
  wishlist: typeof wishlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
