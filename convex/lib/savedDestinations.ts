import {
  resolveDestinationIata,
  cityForIata,
  countryForIata,
  resolveCountryDestination,
} from "./radarDestinations";
import { resolveCountry } from "../../lib/countries";
import { airportCityName, resolveHomeIata } from "../../lib/homeAirport";
import { AIRPORTS } from "../../lib/airports";

/**
 * Every place a user has saved, from BOTH tables that hold one:
 * `wishlist` (settings → wishlist) and `watchedDestinations` (the watch
 * toggle in onboarding, destination preview and the destinations screen).
 *
 * Watching is the only save most new users ever make — onboarding writes a
 * watch and nothing else — so the admin views used to be blind to them and the
 * seeder never searched their routes. One row per (user, destination) per
 * source; callers dedupe by user where they count people.
 */
export type SavedDestination = {
  userId: string;
  /** What to show: the user's own wording, or a watch's resolved city. */
  label: string;
  country: string | null;
  source: "wishlist" | "watch";
  /** Watches may carry the code the client already resolved. */
  iata?: string;
};

export const normName = (v: string) => v.trim().toLowerCase();

/** "paris" → "Paris" — watches are stored lower-cased. */
function titleCaseName(v: string): string {
  return v.replace(/\b[\p{L}]/gu, (c) => c.toUpperCase());
}

export async function collectSavedDestinations(ctx: any): Promise<SavedDestination[]> {
  const [wishes, watches] = await Promise.all([
    ctx.db.query("wishlist").collect(),
    ctx.db.query("watchedDestinations").collect(),
  ]);

  const rows: SavedDestination[] = [];
  for (const w of wishes) {
    const label = String(w.destination ?? "").trim();
    if (!label) continue;
    rows.push({
      userId: w.userId,
      label,
      // Only a real country survives — the field used to be free text, so rows
      // like "Egypt · Why" exist. A saved country is its own country.
      country: resolveCountry((w as any).country) ?? resolveCountry(label),
      source: "wishlist",
    });
  }
  for (const w of watches) {
    const raw = String(w.destination ?? "").trim();
    if (!raw) continue;
    const iata = w.destinationIata ? String(w.destinationIata).toUpperCase() : undefined;
    // Resolve to the dataset's city name so a watch on "paris" groups with a
    // wishlist entry for "Paris" instead of forming its own lower-case chip.
    const resolved =
      resolveDestinationIata(raw) ?? (iata ? { code: iata, city: cityForIata(iata) } : null);
    rows.push({
      userId: w.userId,
      label: resolved?.city || titleCaseName(raw),
      country: null,
      source: "watch",
      iata,
    });
  }
  return rows;
}

/**
 * One row per distinct place, counting the DISTINCT users behind it and
 * splitting them by how they saved it. A user who both wishlisted and watched
 * the same city counts once in `count` and once on each side.
 */
export function aggregateSavedDestinations(saved: SavedDestination[]) {
  const destMap = new Map<
    string,
    {
      destination: string;
      country: string | null;
      users: Set<string>;
      wishlistUsers: Set<string>;
      watchUsers: Set<string>;
    }
  >();

  for (const s of saved) {
    const key = normName(s.label);
    let e = destMap.get(key);
    if (!e) {
      e = {
        destination: s.label,
        country: s.country,
        users: new Set(),
        wishlistUsers: new Set(),
        watchUsers: new Set(),
      };
      destMap.set(key, e);
    }
    // A real wishlist entry's own wording and country win over a watch's
    // reconstructed city name.
    if (s.source === "wishlist") e.destination = s.label;
    if (!e.country && s.country) e.country = s.country;
    e.users.add(s.userId);
    (s.source === "wishlist" ? e.wishlistUsers : e.watchUsers).add(s.userId);
  }

  return Array.from(destMap.values())
    .map((e) => ({
      destination: e.destination,
      country: e.country,
      count: e.users.size,
      wishlistUsers: e.wishlistUsers.size,
      watchUsers: e.watchUsers.size,
    }))
    .sort((a, b) => b.count - a.count);
}

export type DemandRoute = {
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  /** Names users actually saved that map onto this route. */
  labels: string[];
  users: number;
  wishlistUsers: number;
  watchUsers: number;
  /** Which kind(s) of save produced this route. */
  sources: Array<"wishlist" | "watch">;
  hasLive: boolean;
  /**
   * Set when users saved a whole COUNTRY. `destination`/`destinationCity` are
   * then the country name, and `airports` its main airports — the seeder
   * searches them all and keeps only the cheapest qualifying fare.
   */
  kind?: "country";
  airports?: string[];
};

type SettingsRow = { userId: string; homeAirport?: string | null };
type DealRow = {
  origin: string;
  destination: string;
  destinationCity?: string | null;
  deletedAt?: number | null;
  expiresAt?: number | null;
};

/**
 * Turn saved destinations into the searchable unit: (home airport → saved
 * city), one row per distinct pair.
 *
 * Only users with a resolvable home airport contribute — a save without a base
 * airport has no route to search, so it is counted in `noHomeAirport` and
 * otherwise ignored. Names we can't turn into an airport code are listed in
 * `unresolved` so they can be added to the pool. `hasLive` is route-aware: a
 * live deal to the same city from the same origin (by code, by city name, or
 * by any airport in that city — JFK counts for "New York") covers the route.
 */
export function buildDemandRoutes(
  saved: SavedDestination[],
  settings: SettingsRow[],
  deals: DealRow[],
  now: number
): {
  routes: DemandRoute[];
  unresolved: Array<{ destination: string; count: number }>;
  noHomeAirport: number;
  sameCity: number;
} {
  const homeByUser = new Map<string, string>();
  for (const s of settings) {
    const code = resolveHomeIata(s.homeAirport ?? undefined);
    if (code) homeByUser.set(s.userId, code);
  }

  // Live coverage keyed three ways so metro codes and single airports meet,
  // plus once by country so any deal into a saved country covers it.
  const liveKeys = new Set<string>();
  for (const d of deals) {
    if (d.deletedAt || (d.expiresAt && d.expiresAt <= now)) continue;
    const o = d.origin.toUpperCase();
    const dest = d.destination.toUpperCase();
    liveKeys.add(`${o}|${dest}`);
    if (d.destinationCity) liveKeys.add(`${o}|${normName(d.destinationCity)}`);
    const airport = AIRPORTS.find((a) => a.code === dest);
    if (airport) liveKeys.add(`${o}|${normName(airport.city)}`);
    const country = countryForIata(dest);
    if (country) liveKeys.add(`${o}|country:${country}`);
  }

  const routes = new Map<
    string,
    Omit<DemandRoute, "users" | "wishlistUsers" | "watchUsers" | "sources"> & {
      userIds: Set<string>;
      wishlistIds: Set<string>;
      watchIds: Set<string>;
    }
  >();
  const unresolved = new Map<string, { destination: string; users: Set<string> }>();
  const noHomeAirport = new Set<string>();
  const sameCity = new Set<string>();

  for (const w of saved) {
    // Count people, not rows: the same place saved twice by one user (once
    // wishlisted, once watched) is one piece of demand.
    const savedKey = `${w.userId}|${normName(w.label)}`;
    const origin = homeByUser.get(w.userId);
    if (!origin) {
      noHomeAirport.add(savedKey);
      continue;
    }
    // A whole country ("Spain") — one route per (origin, country), searched
    // across its main airports. Single-airport countries (Singapore, Malta)
    // are just a city route.
    const country = resolveCountryDestination(w.label);
    if (country && country.airports.length > 1) {
      const airports = country.airports.filter(
        (code) => code !== origin && cityForIata(code) !== (airportCityName(origin) ?? origin)
      );
      if (airports.length === 0) {
        sameCity.add(savedKey);
        continue;
      }
      const key = `${origin}|country:${country.country}`;
      let r = routes.get(key);
      if (!r) {
        const originCity = airportCityName(origin) ?? origin;
        r = {
          origin,
          originCity,
          destination: country.country,
          destinationCity: country.country,
          labels: [],
          kind: "country",
          airports,
          hasLive:
            liveKeys.has(key) || airports.some((code) => liveKeys.has(`${origin}|${code}`)),
          userIds: new Set(),
          wishlistIds: new Set(),
          watchIds: new Set(),
        };
        routes.set(key, r);
      }
      r.userIds.add(w.userId);
      (w.source === "wishlist" ? r.wishlistIds : r.watchIds).add(w.userId);
      if (!r.labels.some((l) => normName(l) === normName(w.label))) r.labels.push(w.label);
      continue;
    }

    const resolved =
      (country ? { code: country.airports[0], city: cityForIata(country.airports[0]) } : null) ??
      resolveDestinationIata(w.label) ??
      (w.iata ? { code: w.iata, city: cityForIata(w.iata) } : null);
    if (!resolved) {
      const key = normName(w.label);
      const u = unresolved.get(key) ?? { destination: w.label, users: new Set<string>() };
      u.users.add(w.userId);
      unresolved.set(key, u);
      continue;
    }
    const originCity = airportCityName(origin) ?? origin;
    if (resolved.code === origin || normName(resolved.city) === normName(originCity)) {
      sameCity.add(savedKey);
      continue;
    }
    const key = `${origin}|${resolved.code}`;
    let r = routes.get(key);
    if (!r) {
      r = {
        origin,
        originCity,
        destination: resolved.code,
        destinationCity: resolved.city,
        labels: [],
        hasLive:
          liveKeys.has(key) || liveKeys.has(`${origin}|${normName(resolved.city)}`),
        userIds: new Set(),
        wishlistIds: new Set(),
        watchIds: new Set(),
      };
      routes.set(key, r);
    }
    r.userIds.add(w.userId);
    (w.source === "wishlist" ? r.wishlistIds : r.watchIds).add(w.userId);
    if (!r.labels.some((l) => normName(l) === normName(w.label))) {
      r.labels.push(w.label);
    }
  }

  const list: DemandRoute[] = Array.from(routes.values())
    .map(({ userIds, wishlistIds, watchIds, ...r }) => ({
      ...r,
      users: userIds.size,
      wishlistUsers: wishlistIds.size,
      watchUsers: watchIds.size,
      sources: [
        ...(wishlistIds.size ? (["wishlist"] as const) : []),
        ...(watchIds.size ? (["watch"] as const) : []),
      ] as Array<"wishlist" | "watch">,
    }))
    // Gaps first, then by demand.
    .sort((a, b) => {
      if (a.hasLive !== b.hasLive) return a.hasLive ? 1 : -1;
      return b.users - a.users || a.origin.localeCompare(b.origin);
    });

  return {
    routes: list,
    unresolved: Array.from(unresolved.values())
      .map((u) => ({ destination: u.destination, count: u.users.size }))
      .sort((a, b) => b.count - a.count),
    noHomeAirport: noHomeAirport.size,
    sameCity: sameCity.size,
  };
}

/**
 * Who saved this destination, for broadcast targeting.
 *
 * The name match is deliberately loose in both directions — a deal to
 * "Rome" should reach someone who saved "Rome, Italy", and one to
 * "New York City" should reach someone who saved "New York" — mirroring what
 * the wishlist-only version did. Returns one entry per user with the kind(s)
 * of save behind them, so the caller can report where the extra reach came
 * from; a user who both wishlisted and watched appears once.
 */
export function savedDestinationAudience(
  saved: SavedDestination[],
  destination: string
): Map<string, { wishlist: boolean; watch: boolean }> {
  const out = new Map<string, { wishlist: boolean; watch: boolean }>();
  const needle = destination.trim().toLowerCase();
  // Two letters is not a destination; matching on it would target everyone.
  if (needle.length < 3) return out;

  for (const w of saved) {
    const label = normName(w.label);
    if (!label) continue;
    if (label !== needle && !label.includes(needle) && !needle.includes(label)) continue;
    const e = out.get(w.userId) ?? { wishlist: false, watch: false };
    if (w.source === "wishlist") e.wishlist = true;
    else e.watch = true;
    out.set(w.userId, e);
  }
  return out;
}
