/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authNative from "../authNative.js";
import type * as authNativeDb from "../authNativeDb.js";
import type * as bookingDraft from "../bookingDraft.js";
import type * as bookingDraftMutations from "../bookingDraftMutations.js";
import type * as bookingLinks from "../bookingLinks.js";
import type * as bookings from "../bookings.js";
import type * as emailHelpers from "../emailHelpers.js";
import type * as emails from "../emails.js";
import type * as flightBooking from "../flightBooking.js";
import type * as flightBookingMutations from "../flightBookingMutations.js";
import type * as flights_duffel from "../flights/duffel.js";
import type * as flights_duffelExtras from "../flights/duffelExtras.js";
import type * as flights_fallback from "../flights/fallback.js";
import type * as functions from "../functions.js";
import type * as helpers_unsplash from "../helpers/unsplash.js";
import type * as images from "../images.js";
import type * as insights from "../insights.js";
import type * as postmark from "../postmark.js";
import type * as travelers from "../travelers.js";
import type * as trips from "../trips.js";
import type * as tripsActions from "../tripsActions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authNative: typeof authNative;
  authNativeDb: typeof authNativeDb;
  bookingDraft: typeof bookingDraft;
  bookingDraftMutations: typeof bookingDraftMutations;
  bookingLinks: typeof bookingLinks;
  bookings: typeof bookings;
  emailHelpers: typeof emailHelpers;
  emails: typeof emails;
  flightBooking: typeof flightBooking;
  flightBookingMutations: typeof flightBookingMutations;
  "flights/duffel": typeof flights_duffel;
  "flights/duffelExtras": typeof flights_duffelExtras;
  "flights/fallback": typeof flights_fallback;
  functions: typeof functions;
  "helpers/unsplash": typeof helpers_unsplash;
  images: typeof images;
  insights: typeof insights;
  postmark: typeof postmark;
  travelers: typeof travelers;
  trips: typeof trips;
  tripsActions: typeof tripsActions;
  users: typeof users;
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
