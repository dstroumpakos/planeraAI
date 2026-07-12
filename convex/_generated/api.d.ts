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
import type * as adminKpis from "../adminKpis.js";
import type * as atlas from "../atlas.js";
import type * as authNative from "../authNative.js";
import type * as authNativeDb from "../authNativeDb.js";
import type * as bookingDraft from "../bookingDraft.js";
import type * as bookingDraftMutations from "../bookingDraftMutations.js";
import type * as bookingLinks from "../bookingLinks.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as dealExtractor from "../dealExtractor.js";
import type * as destinationSpend from "../destinationSpend.js";
import type * as emailHelpers from "../emailHelpers.js";
import type * as emails from "../emails.js";
import type * as errorReporter from "../errorReporter.js";
import type * as errorReporterDb from "../errorReporterDb.js";
import type * as explore from "../explore.js";
import type * as features from "../features.js";
import type * as flightBooking from "../flightBooking.js";
import type * as flightBookingMutations from "../flightBookingMutations.js";
import type * as flightSearchCache from "../flightSearchCache.js";
import type * as flightsResolve from "../flightsResolve.js";
import type * as flightsSearchApi from "../flightsSearchApi.js";
import type * as flightsSerpApi from "../flightsSerpApi.js";
import type * as flights_duffel from "../flights/duffel.js";
import type * as flights_duffelExtras from "../flights/duffelExtras.js";
import type * as flights_fallback from "../flights/fallback.js";
import type * as functions from "../functions.js";
import type * as helpers_achievements from "../helpers/achievements.js";
import type * as helpers_geo from "../helpers/geo.js";
import type * as helpers_itinerary from "../helpers/itinerary.js";
import type * as helpers_reportError from "../helpers/reportError.js";
import type * as helpers_subscription from "../helpers/subscription.js";
import type * as helpers_unsplash from "../helpers/unsplash.js";
import type * as http from "../http.js";
import type * as iapVerify from "../iapVerify.js";
import type * as images from "../images.js";
import type * as insights from "../insights.js";
import type * as lib_appleRootCerts from "../lib/appleRootCerts.js";
import type * as lib_searchApiAccommodations from "../lib/searchApiAccommodations.js";
import type * as lib_searchApiExplore from "../lib/searchApiExplore.js";
import type * as lib_searchApiFlightSearch from "../lib/searchApiFlightSearch.js";
import type * as lib_searchApiFlights from "../lib/searchApiFlights.js";
import type * as lib_serpApiFlights from "../lib/serpApiFlights.js";
import type * as lowFareRadar from "../lowFareRadar.js";
import type * as lowFareRadarAuto from "../lowFareRadarAuto.js";
import type * as lowFareRadarAutoAction from "../lowFareRadarAutoAction.js";
import type * as lowFareRadarRefresh from "../lowFareRadarRefresh.js";
import type * as lowFareRadarSearch from "../lowFareRadarSearch.js";
import type * as newsletter from "../newsletter.js";
import type * as notifications from "../notifications.js";
import type * as otaAdmin from "../otaAdmin.js";
import type * as otaPackages from "../otaPackages.js";
import type * as otaPackagesEmail from "../otaPackagesEmail.js";
import type * as partnerAdminApp from "../partnerAdminApp.js";
import type * as partnerApi from "../partnerApi.js";
import type * as partnerApiAdmin from "../partnerApiAdmin.js";
import type * as partnerApiAuth from "../partnerApiAuth.js";
import type * as partnerItineraryGen from "../partnerItineraryGen.js";
import type * as partnerPortal from "../partnerPortal.js";
import type * as partnerPregenConfig from "../partnerPregenConfig.js";
import type * as partnerPregenerate from "../partnerPregenerate.js";
import type * as partnerProducts from "../partnerProducts.js";
import type * as passwordReset from "../passwordReset.js";
import type * as passwordResetDb from "../passwordResetDb.js";
import type * as ping from "../ping.js";
import type * as postmark from "../postmark.js";
import type * as publicStats from "../publicStats.js";
import type * as publishedItineraries from "../publishedItineraries.js";
import type * as publishedItinerariesActions from "../publishedItinerariesActions.js";
import type * as referrals from "../referrals.js";
import type * as shareCards from "../shareCards.js";
import type * as shareCardsAction from "../shareCardsAction.js";
import type * as sights from "../sights.js";
import type * as sightsAction from "../sightsAction.js";
import type * as stats from "../stats.js";
import type * as streaks from "../streaks.js";
import type * as travelers from "../travelers.js";
import type * as tripCollaborators from "../tripCollaborators.js";
import type * as tripShareLinks from "../tripShareLinks.js";
import type * as trips from "../trips.js";
import type * as tripsActions from "../tripsActions.js";
import type * as unwtoCountryStats from "../unwtoCountryStats.js";
import type * as users from "../users.js";
import type * as watchedDestinations from "../watchedDestinations.js";
import type * as wishlist from "../wishlist.js";
import type * as worldPrint from "../worldPrint.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _features: typeof _features;
  achievements: typeof achievements;
  admin: typeof admin;
  adminKpis: typeof adminKpis;
  atlas: typeof atlas;
  authNative: typeof authNative;
  authNativeDb: typeof authNativeDb;
  bookingDraft: typeof bookingDraft;
  bookingDraftMutations: typeof bookingDraftMutations;
  bookingLinks: typeof bookingLinks;
  bookings: typeof bookings;
  crons: typeof crons;
  dealExtractor: typeof dealExtractor;
  destinationSpend: typeof destinationSpend;
  emailHelpers: typeof emailHelpers;
  emails: typeof emails;
  errorReporter: typeof errorReporter;
  errorReporterDb: typeof errorReporterDb;
  explore: typeof explore;
  features: typeof features;
  flightBooking: typeof flightBooking;
  flightBookingMutations: typeof flightBookingMutations;
  flightSearchCache: typeof flightSearchCache;
  flightsResolve: typeof flightsResolve;
  flightsSearchApi: typeof flightsSearchApi;
  flightsSerpApi: typeof flightsSerpApi;
  "flights/duffel": typeof flights_duffel;
  "flights/duffelExtras": typeof flights_duffelExtras;
  "flights/fallback": typeof flights_fallback;
  functions: typeof functions;
  "helpers/achievements": typeof helpers_achievements;
  "helpers/geo": typeof helpers_geo;
  "helpers/itinerary": typeof helpers_itinerary;
  "helpers/reportError": typeof helpers_reportError;
  "helpers/subscription": typeof helpers_subscription;
  "helpers/unsplash": typeof helpers_unsplash;
  http: typeof http;
  iapVerify: typeof iapVerify;
  images: typeof images;
  insights: typeof insights;
  "lib/appleRootCerts": typeof lib_appleRootCerts;
  "lib/searchApiAccommodations": typeof lib_searchApiAccommodations;
  "lib/searchApiExplore": typeof lib_searchApiExplore;
  "lib/searchApiFlightSearch": typeof lib_searchApiFlightSearch;
  "lib/searchApiFlights": typeof lib_searchApiFlights;
  "lib/serpApiFlights": typeof lib_serpApiFlights;
  lowFareRadar: typeof lowFareRadar;
  lowFareRadarAuto: typeof lowFareRadarAuto;
  lowFareRadarAutoAction: typeof lowFareRadarAutoAction;
  lowFareRadarRefresh: typeof lowFareRadarRefresh;
  lowFareRadarSearch: typeof lowFareRadarSearch;
  newsletter: typeof newsletter;
  notifications: typeof notifications;
  otaAdmin: typeof otaAdmin;
  otaPackages: typeof otaPackages;
  otaPackagesEmail: typeof otaPackagesEmail;
  partnerAdminApp: typeof partnerAdminApp;
  partnerApi: typeof partnerApi;
  partnerApiAdmin: typeof partnerApiAdmin;
  partnerApiAuth: typeof partnerApiAuth;
  partnerItineraryGen: typeof partnerItineraryGen;
  partnerPortal: typeof partnerPortal;
  partnerPregenConfig: typeof partnerPregenConfig;
  partnerPregenerate: typeof partnerPregenerate;
  partnerProducts: typeof partnerProducts;
  passwordReset: typeof passwordReset;
  passwordResetDb: typeof passwordResetDb;
  ping: typeof ping;
  postmark: typeof postmark;
  publicStats: typeof publicStats;
  publishedItineraries: typeof publishedItineraries;
  publishedItinerariesActions: typeof publishedItinerariesActions;
  referrals: typeof referrals;
  shareCards: typeof shareCards;
  shareCardsAction: typeof shareCardsAction;
  sights: typeof sights;
  sightsAction: typeof sightsAction;
  stats: typeof stats;
  streaks: typeof streaks;
  travelers: typeof travelers;
  tripCollaborators: typeof tripCollaborators;
  tripShareLinks: typeof tripShareLinks;
  trips: typeof trips;
  tripsActions: typeof tripsActions;
  unwtoCountryStats: typeof unwtoCountryStats;
  users: typeof users;
  watchedDestinations: typeof watchedDestinations;
  wishlist: typeof wishlist;
  worldPrint: typeof worldPrint;
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
