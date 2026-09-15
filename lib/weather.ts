import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { matchCityFromDestination } from "@/lib/worldCities";

/**
 * Client side of convex/weather.ts. Forecasts are fetched once per trip
 * location and kept in module memory for the session (the server caches per
 * grid cell for 3 h, so refetching is cheap anyway).
 */
export interface WeatherDay {
    date: string;
    code: number;
    tMax: number;
    tMin: number;
    precipMm?: number;
    precipProb?: number;
}
export interface Forecast {
    timezone?: string;
    days: WeatherDay[];
    lat: number;
    lng: number;
}

/** WMO code → Ionicons name + emoji. Mirrors describeWeatherCode in convex/weather.ts. */
export function weatherGlyph(code: number): { icon: string; emoji: string } {
    if (code === 0) return { icon: "sunny", emoji: "☀️" };
    if (code <= 2) return { icon: "partly-sunny", emoji: "🌤️" };
    if (code === 3) return { icon: "cloudy", emoji: "☁️" };
    if (code <= 49) return { icon: "cloudy", emoji: "🌫️" };
    if (code <= 67) return { icon: "rainy", emoji: "🌧️" };
    if (code <= 77) return { icon: "snow", emoji: "🌨️" };
    if (code <= 82) return { icon: "rainy", emoji: "🌦️" };
    if (code <= 86) return { icon: "snow", emoji: "🌨️" };
    return { icon: "thunderstorm", emoji: "⛈️" };
}

/** First geocoded stop of the trip, else the WorldPrint city centre. */
export function tripCoordinates(trip: any): { lat: number; lng: number } | null {
    const days: any[] = trip?.itinerary?.dayByDayItinerary || [];
    for (const d of days) {
        const a = (d.activities || []).find((x: any) => typeof x?.lat === "number" && typeof x?.lng === "number");
        if (a) return { lat: a.lat, lng: a.lng };
    }
    const city = matchCityFromDestination(String(trip?.destination || ""));
    return city ? { lat: city.lat, lng: city.lng } : null;
}

/** Local calendar date (YYYY-MM-DD) for a timestamp in a zone, with a UTC fallback. */
export function localDateString(ts: number, timeZone?: string): string {
    try {
        if (timeZone) {
            return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
        }
    } catch {}
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const memo = new Map<string, { at: number; forecast: Forecast | null }>();
const TTL = 60 * 60 * 1000;

export function useTripWeather(trip: any | null | undefined): Forecast | null {
    const forecastAction = useAction((api as any).weather.forecast);
    const coords = useMemo(() => (trip ? tripCoordinates(trip) : null), [trip?._id, trip?.itinerary?.dayByDayItinerary?.length]);
    const key = coords ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}` : trip?.destination ? `dest:${trip.destination}` : null;
    const [forecast, setForecast] = useState<Forecast | null>(() => (key && memo.get(key)?.forecast) || null);

    useEffect(() => {
        if (!key) return;
        const hit = memo.get(key);
        if (hit && Date.now() - hit.at < TTL) { setForecast(hit.forecast); return; }
        let alive = true;
        forecastAction(coords ? { lat: coords.lat, lng: coords.lng } : { destination: trip.destination })
            .then((f: Forecast | null) => {
                memo.set(key, { at: Date.now(), forecast: f });
                if (alive) setForecast(f);
            })
            .catch(() => {});
        return () => { alive = false; };
    }, [key]);

    return forecast;
}

/** The forecast entry for a given day of a trip (day 0 = start date). */
export function forecastForDay(forecast: Forecast | null, ts: number): WeatherDay | null {
    if (!forecast) return null;
    const date = localDateString(ts, forecast.timezone);
    return forecast.days.find((d) => d.date === date) || null;
}
