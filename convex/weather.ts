import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { geocodeDestinationServer } from "./lib/geocoding";

const internal = _internal as any;

/**
 * Weather for the Today card, the trip countdown widgets and the morning
 * briefing push. Open-Meteo: no key, no quota to speak of, daily forecast
 * 7 days out. Results are cached per ~1 km grid cell for WEATHER_TTL_MS so a
 * whole trip's worth of opens costs one upstream call.
 */
const WEATHER_TTL_MS = 3 * 60 * 60 * 1000; // 3 h — forecasts don't move faster
const CACHE_PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export interface WeatherDay {
    date: string;
    code: number;
    tMax: number;
    tMin: number;
    precipMm?: number;
    precipProb?: number;
}

function cellKey(lat: number, lng: number): string {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** WMO weather code → short label + emoji, shared by push copy and clients. */
export function describeWeatherCode(code: number): { label: string; emoji: string; icon: string } {
    if (code === 0) return { label: "clear", emoji: "☀️", icon: "sunny" };
    if (code <= 2) return { label: "partly cloudy", emoji: "🌤️", icon: "partly-sunny" };
    if (code === 3) return { label: "overcast", emoji: "☁️", icon: "cloudy" };
    if (code <= 49) return { label: "fog", emoji: "🌫️", icon: "cloudy" };
    if (code <= 57) return { label: "drizzle", emoji: "🌦️", icon: "rainy" };
    if (code <= 67) return { label: "rain", emoji: "🌧️", icon: "rainy" };
    if (code <= 77) return { label: "snow", emoji: "🌨️", icon: "snow" };
    if (code <= 82) return { label: "showers", emoji: "🌦️", icon: "rainy" };
    if (code <= 86) return { label: "snow showers", emoji: "🌨️", icon: "snow" };
    return { label: "thunderstorms", emoji: "⛈️", icon: "thunderstorm" };
}

export const _getCached = internalQuery({
    args: { key: v.string() },
    handler: async (ctx, { key }) => {
        return await ctx.db.query("weatherCache").withIndex("by_key", (q) => q.eq("key", key)).first();
    },
});

export const _putCached = internalMutation({
    args: {
        key: v.string(),
        timezone: v.optional(v.string()),
        days: v.array(v.object({
            date: v.string(), code: v.float64(), tMax: v.float64(), tMin: v.float64(),
            precipMm: v.optional(v.float64()), precipProb: v.optional(v.float64()),
        })),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("weatherCache").withIndex("by_key", (q) => q.eq("key", args.key)).first();
        const doc = { key: args.key, fetchedAt: Date.now(), timezone: args.timezone, days: args.days };
        if (existing) await ctx.db.patch(existing._id, doc);
        else await ctx.db.insert("weatherCache", doc);
    },
});

export const _pruneCache = internalMutation({
    args: {},
    handler: async (ctx) => {
        const stale = await ctx.db
            .query("weatherCache")
            .withIndex("by_fetchedAt", (q) => q.lt("fetchedAt", Date.now() - CACHE_PRUNE_AFTER_MS))
            .take(200);
        for (const row of stale) await ctx.db.delete(row._id);
        return stale.length;
    },
});

async function fetchOpenMeteo(lat: number, lng: number): Promise<{ timezone?: string; days: WeatherDay[] } | null> {
    const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
        `&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: any = await res.json();
    const d = json?.daily;
    if (!d?.time) return null;
    const days: WeatherDay[] = d.time.map((date: string, i: number) => ({
        date,
        code: Number(d.weather_code?.[i] ?? 0),
        tMax: Number(d.temperature_2m_max?.[i] ?? 0),
        tMin: Number(d.temperature_2m_min?.[i] ?? 0),
        precipMm: d.precipitation_sum?.[i] != null ? Number(d.precipitation_sum[i]) : undefined,
        precipProb: d.precipitation_probability_max?.[i] != null ? Number(d.precipitation_probability_max[i]) : undefined,
    }));
    return { timezone: json.timezone, days };
}

/** Shared by the public action and the notification cron. */
export const forecastForPoint = internalAction({
    args: { lat: v.number(), lng: v.number() },
    handler: async (ctx, { lat, lng }): Promise<{ timezone?: string; days: WeatherDay[] } | null> => {
        const key = cellKey(lat, lng);
        const cached: any = await ctx.runQuery(internal.weather._getCached, { key });
        if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) {
            return { timezone: cached.timezone, days: cached.days };
        }
        try {
            const fresh = await fetchOpenMeteo(lat, lng);
            if (!fresh) return cached ? { timezone: cached.timezone, days: cached.days } : null;
            await ctx.runMutation(internal.weather._putCached, { key, timezone: fresh.timezone, days: fresh.days });
            // Opportunistic prune — cheap and keeps the table from growing forever.
            if (Math.random() < 0.05) await ctx.runMutation(internal.weather._pruneCache, {});
            return fresh;
        } catch (e) {
            console.error("[weather] open-meteo failed", e);
            return cached ? { timezone: cached.timezone, days: cached.days } : null;
        }
    },
});

/**
 * Public: 7-day forecast for a point, or for a destination name when the
 * client has no coordinates (falls back to server geocoding). Unauthenticated
 * on purpose — the data is public and the cache bounds the upstream cost.
 */
export const forecast = action({
    args: {
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
        destination: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{ timezone?: string; days: WeatherDay[]; lat: number; lng: number } | null> => {
        let lat = args.lat, lng = args.lng;
        if ((lat == null || lng == null) && args.destination) {
            const c = await geocodeDestinationServer(args.destination);
            if (c) { lat = c.lat; lng = c.lng; }
        }
        if (lat == null || lng == null) return null;
        const r: any = await ctx.runAction(internal.weather.forecastForPoint, { lat, lng });
        return r ? { ...r, lat, lng } : null;
    },
});
