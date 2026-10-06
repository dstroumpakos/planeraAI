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
import type * as accommodationsPublic from "../accommodationsPublic.js";
import type * as achievements from "../achievements.js";
import type * as admin from "../admin.js";
import type * as adminKpis from "../adminKpis.js";
import type * as agency_access from "../agency/access.js";
import type * as agency_adminView from "../agency/adminView.js";
import type * as agency_auth from "../agency/auth.js";
import type * as agency_bookings from "../agency/bookings.js";
import type * as agency_connectionService from "../agency/connectionService.js";
import type * as agency_connections from "../agency/connections.js";
import type * as agency_connectors_auth from "../agency/connectors/auth.js";
import type * as agency_connectors_duffel from "../agency/connectors/duffel.js";
import type * as agency_connectors_duffelStays from "../agency/connectors/duffelStays.js";
import type * as agency_connectors_factory from "../agency/connectors/factory.js";
import type * as agency_connectors_generic from "../agency/connectors/generic.js";
import type * as agency_connectors_http from "../agency/connectors/http.js";
import type * as agency_connectors_mock from "../agency/connectors/mock.js";
import type * as agency_connectors_providers from "../agency/connectors/providers.js";
import type * as agency_connectors_registry from "../agency/connectors/registry.js";
import type * as agency_connectors_types from "../agency/connectors/types.js";
import type * as agency_crypto from "../agency/crypto.js";
import type * as agency_destinationMap from "../agency/destinationMap.js";
import type * as agency_destinations from "../agency/destinations.js";
import type * as agency_errors from "../agency/errors.js";
import type * as agency_fulfilment from "../agency/fulfilment.js";
import type * as agency_model_types from "../agency/model/types.js";
import type * as agency_notify from "../agency/notify.js";
import type * as agency_orchestrator from "../agency/orchestrator.js";
import type * as agency_packageCopy from "../agency/packageCopy.js";
import type * as agency_pricing from "../agency/pricing.js";
import type * as agency_pricingRules from "../agency/pricingRules.js";
import type * as agency_quote from "../agency/quote.js";
import type * as agency_quoteEdit from "../agency/quoteEdit.js";
import type * as agency_quoteEditing from "../agency/quoteEditing.js";
import type * as agency_quoteView from "../agency/quoteView.js";
import type * as agency_quotes from "../agency/quotes.js";
import type * as agency_rateLimit from "../agency/rateLimit.js";
import type * as agency_requestParse from "../agency/requestParse.js";
import type * as agency_runtime from "../agency/runtime.js";
import type * as agency_scoring from "../agency/scoring.js";
import type * as agency_store from "../agency/store.js";
import type * as agency_totp from "../agency/totp.js";
import type * as agency_validation from "../agency/validation.js";
import type * as agency_vault from "../agency/vault.js";
import type * as agencyOutreach from "../agencyOutreach.js";
import type * as agencyOutreachCopy from "../agencyOutreachCopy.js";
import type * as aiWriter from "../aiWriter.js";
import type * as aiWriterActions from "../aiWriterActions.js";
import type * as atlas from "../atlas.js";
import type * as atlasDb from "../atlasDb.js";
import type * as atlasParseTrip from "../atlasParseTrip.js";
import type * as atlasTools from "../atlasTools.js";
import type * as authNative from "../authNative.js";
import type * as authNativeDb from "../authNativeDb.js";
import type * as bookingDraft from "../bookingDraft.js";
import type * as bookingDraftMutations from "../bookingDraftMutations.js";
import type * as bookingLinks from "../bookingLinks.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as dealExtractor from "../dealExtractor.js";
import type * as destinationSpend from "../destinationSpend.js";
import type * as destinationStats from "../destinationStats.js";
import type * as emailBounceCodes from "../emailBounceCodes.js";
import type * as emailEvents from "../emailEvents.js";
import type * as emailHelpers from "../emailHelpers.js";
import type * as emails from "../emails.js";
import type * as errorReporter from "../errorReporter.js";
import type * as errorReporterDb from "../errorReporterDb.js";
import type * as explore from "../explore.js";
import type * as exploreDestination from "../exploreDestination.js";
import type * as exploreDestinationPublic from "../exploreDestinationPublic.js";
import type * as explorePublic from "../explorePublic.js";
import type * as features from "../features.js";
import type * as flightBooking from "../flightBooking.js";
import type * as flightBookingMutations from "../flightBookingMutations.js";
import type * as flightCalendar from "../flightCalendar.js";
import type * as flightSearchCache from "../flightSearchCache.js";
import type * as flights_duffel from "../flights/duffel.js";
import type * as flights_duffelExtras from "../flights/duffelExtras.js";
import type * as flights_fallback from "../flights/fallback.js";
import type * as flightsResolve from "../flightsResolve.js";
import type * as flightsSearchApi from "../flightsSearchApi.js";
import type * as flightsSerpApi from "../flightsSerpApi.js";
import type * as functions from "../functions.js";
import type * as helpers_achievements from "../helpers/achievements.js";
import type * as helpers_geo from "../helpers/geo.js";
import type * as helpers_inboundEmail from "../helpers/inboundEmail.js";
import type * as helpers_itinerary from "../helpers/itinerary.js";
import type * as helpers_reportError from "../helpers/reportError.js";
import type * as helpers_subscription from "../helpers/subscription.js";
import type * as helpers_tripMatch from "../helpers/tripMatch.js";
import type * as helpers_unsplash from "../helpers/unsplash.js";
import type * as homeAirportAi from "../homeAirportAi.js";
import type * as http from "../http.js";
import type * as iapVerify from "../iapVerify.js";
import type * as iapVerifyGoogle from "../iapVerifyGoogle.js";
import type * as images from "../images.js";
import type * as insights from "../insights.js";
import type * as lib_aiWriterModels from "../lib/aiWriterModels.js";
import type * as lib_airportCountry from "../lib/airportCountry.js";
import type * as lib_appleRootCerts from "../lib/appleRootCerts.js";
import type * as lib_baggage from "../lib/baggage.js";
import type * as lib_countryFacts from "../lib/countryFacts.js";
import type * as lib_geocoding from "../lib/geocoding.js";
import type * as lib_mapbox from "../lib/mapbox.js";
import type * as lib_quietHours from "../lib/quietHours.js";
import type * as lib_radarDestinations from "../lib/radarDestinations.js";
import type * as lib_savedDestinations from "../lib/savedDestinations.js";
import type * as lib_searchApiAccommodations from "../lib/searchApiAccommodations.js";
import type * as lib_searchApiExplore from "../lib/searchApiExplore.js";
import type * as lib_searchApiExploreDestination from "../lib/searchApiExploreDestination.js";
import type * as lib_searchApiFlightCalendar from "../lib/searchApiFlightCalendar.js";
import type * as lib_searchApiFlightSearch from "../lib/searchApiFlightSearch.js";
import type * as lib_searchApiFlights from "../lib/searchApiFlights.js";
import type * as lib_searchCacheKeys from "../lib/searchCacheKeys.js";
import type * as lib_serpApiFlights from "../lib/serpApiFlights.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as lib_tripadvisorTerra from "../lib/tripadvisorTerra.js";
import type * as lib_unsplashSearch from "../lib/unsplashSearch.js";
import type * as lowFareRadar from "../lowFareRadar.js";
import type * as lowFareRadarAuto from "../lowFareRadarAuto.js";
import type * as lowFareRadarAutoAction from "../lowFareRadarAutoAction.js";
import type * as lowFareRadarRefresh from "../lowFareRadarRefresh.js";
import type * as lowFareRadarSearch from "../lowFareRadarSearch.js";
import type * as lowFareRadarSeed from "../lowFareRadarSeed.js";
import type * as mapboxUsage from "../mapboxUsage.js";
import type * as marketingEvents from "../marketingEvents.js";
import type * as mcpSavedTrips from "../mcpSavedTrips.js";
import type * as newsletter from "../newsletter.js";
import type * as newsletterAi from "../newsletterAi.js";
import type * as newsletterCampaigns from "../newsletterCampaigns.js";
import type * as newsletterSocial from "../newsletterSocial.js";
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
import type * as reservations from "../reservations.js";
import type * as reservationsInbound from "../reservationsInbound.js";
import type * as retention from "../retention.js";
import type * as routeAlertEmails from "../routeAlertEmails.js";
import type * as routePriceAlerts from "../routePriceAlerts.js";
import type * as shareCards from "../shareCards.js";
import type * as shareCardsAction from "../shareCardsAction.js";
import type * as sights from "../sights.js";
import type * as sightsAction from "../sightsAction.js";
import type * as socialShareLinks from "../socialShareLinks.js";
import type * as stats from "../stats.js";
import type * as statsReports from "../statsReports.js";
import type * as streaks from "../streaks.js";
import type * as stripeBilling from "../stripeBilling.js";
import type * as stripeBillingDb from "../stripeBillingDb.js";
import type * as translatePublic from "../translatePublic.js";
import type * as travelers from "../travelers.js";
import type * as tripCollaborators from "../tripCollaborators.js";
import type * as tripShareLinks from "../tripShareLinks.js";
import type * as trips from "../trips.js";
import type * as tripsActions from "../tripsActions.js";
import type * as unwtoCountryStats from "../unwtoCountryStats.js";
import type * as users from "../users.js";
import type * as watchedDestinations from "../watchedDestinations.js";
import type * as weather from "../weather.js";
import type * as wishlist from "../wishlist.js";
import type * as worldPrint from "../worldPrint.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _features: typeof _features;
  accommodationsPublic: typeof accommodationsPublic;
  achievements: typeof achievements;
  admin: typeof admin;
  adminKpis: typeof adminKpis;
  "agency/access": typeof agency_access;
  "agency/adminView": typeof agency_adminView;
  "agency/auth": typeof agency_auth;
  "agency/bookings": typeof agency_bookings;
  "agency/connectionService": typeof agency_connectionService;
  "agency/connections": typeof agency_connections;
  "agency/connectors/auth": typeof agency_connectors_auth;
  "agency/connectors/duffel": typeof agency_connectors_duffel;
  "agency/connectors/duffelStays": typeof agency_connectors_duffelStays;
  "agency/connectors/factory": typeof agency_connectors_factory;
  "agency/connectors/generic": typeof agency_connectors_generic;
  "agency/connectors/http": typeof agency_connectors_http;
  "agency/connectors/mock": typeof agency_connectors_mock;
  "agency/connectors/providers": typeof agency_connectors_providers;
  "agency/connectors/registry": typeof agency_connectors_registry;
  "agency/connectors/types": typeof agency_connectors_types;
  "agency/crypto": typeof agency_crypto;
  "agency/destinationMap": typeof agency_destinationMap;
  "agency/destinations": typeof agency_destinations;
  "agency/errors": typeof agency_errors;
  "agency/fulfilment": typeof agency_fulfilment;
  "agency/model/types": typeof agency_model_types;
  "agency/notify": typeof agency_notify;
  "agency/orchestrator": typeof agency_orchestrator;
  "agency/packageCopy": typeof agency_packageCopy;
  "agency/pricing": typeof agency_pricing;
  "agency/pricingRules": typeof agency_pricingRules;
  "agency/quote": typeof agency_quote;
  "agency/quoteEdit": typeof agency_quoteEdit;
  "agency/quoteEditing": typeof agency_quoteEditing;
  "agency/quoteView": typeof agency_quoteView;
  "agency/quotes": typeof agency_quotes;
  "agency/rateLimit": typeof agency_rateLimit;
  "agency/requestParse": typeof agency_requestParse;
  "agency/runtime": typeof agency_runtime;
  "agency/scoring": typeof agency_scoring;
  "agency/store": typeof agency_store;
  "agency/totp": typeof agency_totp;
  "agency/validation": typeof agency_validation;
  "agency/vault": typeof agency_vault;
  agencyOutreach: typeof agencyOutreach;
  agencyOutreachCopy: typeof agencyOutreachCopy;
  aiWriter: typeof aiWriter;
  aiWriterActions: typeof aiWriterActions;
  atlas: typeof atlas;
  atlasDb: typeof atlasDb;
  atlasParseTrip: typeof atlasParseTrip;
  atlasTools: typeof atlasTools;
  authNative: typeof authNative;
  authNativeDb: typeof authNativeDb;
  bookingDraft: typeof bookingDraft;
  bookingDraftMutations: typeof bookingDraftMutations;
  bookingLinks: typeof bookingLinks;
  bookings: typeof bookings;
  crons: typeof crons;
  dealExtractor: typeof dealExtractor;
  destinationSpend: typeof destinationSpend;
  destinationStats: typeof destinationStats;
  emailBounceCodes: typeof emailBounceCodes;
  emailEvents: typeof emailEvents;
  emailHelpers: typeof emailHelpers;
  emails: typeof emails;
  errorReporter: typeof errorReporter;
  errorReporterDb: typeof errorReporterDb;
  explore: typeof explore;
  exploreDestination: typeof exploreDestination;
  exploreDestinationPublic: typeof exploreDestinationPublic;
  explorePublic: typeof explorePublic;
  features: typeof features;
  flightBooking: typeof flightBooking;
  flightBookingMutations: typeof flightBookingMutations;
  flightCalendar: typeof flightCalendar;
  flightSearchCache: typeof flightSearchCache;
  "flights/duffel": typeof flights_duffel;
  "flights/duffelExtras": typeof flights_duffelExtras;
  "flights/fallback": typeof flights_fallback;
  flightsResolve: typeof flightsResolve;
  flightsSearchApi: typeof flightsSearchApi;
  flightsSerpApi: typeof flightsSerpApi;
  functions: typeof functions;
  "helpers/achievements": typeof helpers_achievements;
  "helpers/geo": typeof helpers_geo;
  "helpers/inboundEmail": typeof helpers_inboundEmail;
  "helpers/itinerary": typeof helpers_itinerary;
  "helpers/reportError": typeof helpers_reportError;
  "helpers/subscription": typeof helpers_subscription;
  "helpers/tripMatch": typeof helpers_tripMatch;
  "helpers/unsplash": typeof helpers_unsplash;
  homeAirportAi: typeof homeAirportAi;
  http: typeof http;
  iapVerify: typeof iapVerify;
  iapVerifyGoogle: typeof iapVerifyGoogle;
  images: typeof images;
  insights: typeof insights;
  "lib/aiWriterModels": typeof lib_aiWriterModels;
  "lib/airportCountry": typeof lib_airportCountry;
  "lib/appleRootCerts": typeof lib_appleRootCerts;
  "lib/baggage": typeof lib_baggage;
  "lib/countryFacts": typeof lib_countryFacts;
  "lib/geocoding": typeof lib_geocoding;
  "lib/mapbox": typeof lib_mapbox;
  "lib/quietHours": typeof lib_quietHours;
  "lib/radarDestinations": typeof lib_radarDestinations;
  "lib/savedDestinations": typeof lib_savedDestinations;
  "lib/searchApiAccommodations": typeof lib_searchApiAccommodations;
  "lib/searchApiExplore": typeof lib_searchApiExplore;
  "lib/searchApiExploreDestination": typeof lib_searchApiExploreDestination;
  "lib/searchApiFlightCalendar": typeof lib_searchApiFlightCalendar;
  "lib/searchApiFlightSearch": typeof lib_searchApiFlightSearch;
  "lib/searchApiFlights": typeof lib_searchApiFlights;
  "lib/searchCacheKeys": typeof lib_searchCacheKeys;
  "lib/serpApiFlights": typeof lib_serpApiFlights;
  "lib/stripe": typeof lib_stripe;
  "lib/tripadvisorTerra": typeof lib_tripadvisorTerra;
  "lib/unsplashSearch": typeof lib_unsplashSearch;
  lowFareRadar: typeof lowFareRadar;
  lowFareRadarAuto: typeof lowFareRadarAuto;
  lowFareRadarAutoAction: typeof lowFareRadarAutoAction;
  lowFareRadarRefresh: typeof lowFareRadarRefresh;
  lowFareRadarSearch: typeof lowFareRadarSearch;
  lowFareRadarSeed: typeof lowFareRadarSeed;
  mapboxUsage: typeof mapboxUsage;
  marketingEvents: typeof marketingEvents;
  mcpSavedTrips: typeof mcpSavedTrips;
  newsletter: typeof newsletter;
  newsletterAi: typeof newsletterAi;
  newsletterCampaigns: typeof newsletterCampaigns;
  newsletterSocial: typeof newsletterSocial;
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
  reservations: typeof reservations;
  reservationsInbound: typeof reservationsInbound;
  retention: typeof retention;
  routeAlertEmails: typeof routeAlertEmails;
  routePriceAlerts: typeof routePriceAlerts;
  shareCards: typeof shareCards;
  shareCardsAction: typeof shareCardsAction;
  sights: typeof sights;
  sightsAction: typeof sightsAction;
  socialShareLinks: typeof socialShareLinks;
  stats: typeof stats;
  statsReports: typeof statsReports;
  streaks: typeof streaks;
  stripeBilling: typeof stripeBilling;
  stripeBillingDb: typeof stripeBillingDb;
  translatePublic: typeof translatePublic;
  travelers: typeof travelers;
  tripCollaborators: typeof tripCollaborators;
  tripShareLinks: typeof tripShareLinks;
  trips: typeof trips;
  tripsActions: typeof tripsActions;
  unwtoCountryStats: typeof unwtoCountryStats;
  users: typeof users;
  watchedDestinations: typeof watchedDestinations;
  weather: typeof weather;
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
