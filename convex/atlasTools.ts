/**
 * Atlas tool definitions and executors.
 *
 * Atlas used to detect intent with hand-written regexes: one for weather, one
 * for restaurants. That approach could only ever answer the two questions
 * somebody had written a pattern for, and it mis-parsed common phrasings ("the
 * best restaurants" extracted the city "the best"). This module replaces that
 * with OpenAI tool calling — the model decides which tool to call and extracts
 * the arguments itself, so adding a capability means adding an entry here
 * rather than another regex.
 *
 * Every tool returns `{ result, card? }`:
 *  - `result` is fed back to the model as the tool message. Keep it compact;
 *    it is billed as input tokens on the follow-up call.
 *  - `card` is optional structured data the client renders as a rich card. It
 *    is emitted deterministically from the tool result, NOT parsed out of the
 *    model's prose — the old `<WEATHER_JSON>` protocol silently lost the card
 *    whenever the model forgot to include the block.
 *
 * External APIs used here are all free and keyless except TripAdvisor:
 *  - Open-Meteo (geocoding, forecast, air quality)
 *  - Frankfurter (ECB reference FX rates)
 *  - Nager.Date (public holidays)
 *
 * Country facts come from the bundled `lib/countryFacts.ts` table rather than a
 * live service — REST Countries deprecated its keyless versions and now answers
 * them with HTTP 200 plus an error body, which no `response.ok` check catches.
 */

import { api, internal } from "./_generated/api";
import { getAvgDailySpend, getAvgStay } from "./destinationSpend";
import { lookupCountryFacts } from "./lib/countryFacts";

// ─────────────────────────────── Shared types ───────────────────────────────

export interface AtlasCard {
    type: string;
    data: any;
}

export interface ToolOutcome {
    /** Compact text handed back to the model. */
    result: string;
    /** Structured payload for the UI, if this tool renders a card. */
    card?: AtlasCard;
}

/** Context the executor needs that the model never sees. */
export interface AtlasToolContext {
    token: string;
    userId: string;
    homeAirport?: string;
    homeIata?: string;
    currency: string;
    language: string;
}

// ───────────────────────────── Weather primitives ───────────────────────────

const weatherCodeToDescription: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
};

export interface GeocodedPlace {
    lat: number;
    lon: number;
    name: string;
    country: string;
    countryCode: string;
    timezone: string;
}

/** Resolve a free-text place name to coordinates via Open-Meteo geocoding. */
export async function geocodeCity(cityName: string): Promise<GeocodedPlace | null> {
    try {
        // Strip any "City, Country" suffix — geocoding is more reliable on the
        // bare city token.
        const query = cityName.split(",")[0].trim();
        if (!query) return null;

        const response = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
        );
        if (!response.ok) return null;
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const r = data.results[0];
            return {
                lat: r.latitude,
                lon: r.longitude,
                name: r.name,
                country: r.country || "",
                countryCode: r.country_code || "",
                timezone: r.timezone || "UTC",
            };
        }
        return null;
    } catch (error) {
        console.error("[Atlas] Geocoding error:", error);
        return null;
    }
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday label for a YYYY-MM-DD string, parsed as UTC to avoid TZ drift. */
function shortDay(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return SHORT_DAYS[d.getUTCDay()];
}

// ───────────────────────────────── Tools ────────────────────────────────────

async function toolWeather(city: string): Promise<ToolOutcome> {
    const place = await geocodeCity(city);
    if (!place) {
        return { result: `Could not find a place called "${city}".` };
    }

    try {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset` +
            `&timezone=auto&forecast_days=7`
        );
        if (!response.ok) {
            return { result: `Weather lookup failed for ${place.name}.` };
        }
        const data = await response.json();

        const location = `${place.name}${place.country ? ", " + place.country : ""}`;
        const forecast = (data.daily?.time ?? []).map((date: string, i: number) => ({
            date,
            day: shortDay(date),
            high: Math.round(data.daily.temperature_2m_max[i]),
            low: Math.round(data.daily.temperature_2m_min[i]),
            precipitation: data.daily.precipitation_sum?.[i] ?? 0,
            precipitationChance: data.daily.precipitation_probability_max?.[i] ?? null,
            uvIndex: data.daily.uv_index_max?.[i] ?? null,
            condition: weatherCodeToDescription[data.daily.weather_code?.[i]] || "Unknown",
        }));

        const card: AtlasCard = {
            type: "weather",
            data: {
                location,
                temperature: Math.round(data.current.temperature_2m),
                feelsLike: Math.round(data.current.apparent_temperature),
                condition: weatherCodeToDescription[data.current.weather_code] || "Unknown",
                humidity: data.current.relative_humidity_2m,
                windSpeed: Math.round(data.current.wind_speed_10m),
                isDay: data.current.is_day === 1,
                sunrise: data.daily?.sunrise?.[0] ?? null,
                sunset: data.daily?.sunset?.[0] ?? null,
                forecast,
            },
        };

        const summary =
            `Weather for ${location}: currently ${card.data.temperature}°C ` +
            `(feels like ${card.data.feelsLike}°C), ${card.data.condition}, ` +
            `humidity ${card.data.humidity}%, wind ${card.data.windSpeed} km/h. ` +
            `Sunrise ${card.data.sunrise ?? "n/a"}, sunset ${card.data.sunset ?? "n/a"}. 7-day outlook: ` +
            forecast
                .map((d: any) => `${d.day} ${d.low}–${d.high}°C ${d.condition}${d.precipitationChance != null ? ` (${d.precipitationChance}% rain)` : ""}`)
                .join("; ");

        return { result: summary, card };
    } catch (error) {
        console.error("[Atlas] Weather API error:", error);
        return { result: `Weather lookup failed for ${city}.` };
    }
}

async function toolAirQuality(city: string): Promise<ToolOutcome> {
    const place = await geocodeCity(city);
    if (!place) return { result: `Could not find a place called "${city}".` };

    try {
        const response = await fetch(
            `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}` +
            `&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,uv_index&timezone=auto`
        );
        if (!response.ok) return { result: `Air quality lookup failed for ${place.name}.` };
        const data = await response.json();
        const c = data.current ?? {};

        // European AQI bands (lower is better; 0–20 good … 100+ extremely poor).
        const aqi = c.european_aqi ?? null;
        const band =
            aqi == null ? "Unknown"
                : aqi <= 20 ? "Good"
                    : aqi <= 40 ? "Fair"
                        : aqi <= 60 ? "Moderate"
                            : aqi <= 80 ? "Poor"
                                : aqi <= 100 ? "Very poor"
                                    : "Extremely poor";

        const location = `${place.name}${place.country ? ", " + place.country : ""}`;
        const card: AtlasCard = {
            type: "airQuality",
            data: {
                location,
                aqi,
                band,
                pm25: c.pm2_5 ?? null,
                pm10: c.pm10 ?? null,
                no2: c.nitrogen_dioxide ?? null,
                ozone: c.ozone ?? null,
                uvIndex: c.uv_index ?? null,
            },
        };

        return {
            result:
                `Air quality in ${location}: European AQI ${aqi ?? "n/a"} (${band}). ` +
                `PM2.5 ${c.pm2_5 ?? "n/a"} µg/m³, PM10 ${c.pm10 ?? "n/a"} µg/m³, ` +
                `NO2 ${c.nitrogen_dioxide ?? "n/a"} µg/m³, UV index ${c.uv_index ?? "n/a"}.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Air quality error:", error);
        return { result: `Air quality lookup failed for ${city}.` };
    }
}

async function toolRestaurants(city: string): Promise<ToolOutcome> {
    const tripadvisorKey = process.env.TRIPADVISOR_API_KEY;
    if (!tripadvisorKey) {
        return {
            result:
                `No live restaurant data is available (TripAdvisor is not configured). ` +
                `Answer from general knowledge and say the list is not live.`,
        };
    }

    try {
        const searchUrl =
            `https://api.content.tripadvisor.com/api/v1/location/search?key=${tripadvisorKey}` +
            `&searchQuery=${encodeURIComponent("restaurants " + city)}&category=restaurants&language=en`;

        const searchResponse = await fetch(searchUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!searchResponse.ok) {
            console.error(`[Atlas] TripAdvisor search failed: ${searchResponse.status}`);
            return { result: `Restaurant lookup failed for ${city}.` };
        }

        const searchData = (await searchResponse.json()) as any;
        if (!searchData.data || searchData.data.length === 0) {
            return { result: `No restaurants found for ${city}.` };
        }

        const restaurants = await Promise.all(
            searchData.data.slice(0, 5).map(async (item: any) => {
                try {
                    const detailsUrl = `https://api.content.tripadvisor.com/api/v1/location/${item.location_id}/details?key=${tripadvisorKey}&language=en`;
                    const detailsResponse = await fetch(detailsUrl, {
                        method: "GET",
                        headers: { Accept: "application/json" },
                    });
                    if (detailsResponse.ok) {
                        const details = (await detailsResponse.json()) as any;
                        return {
                            name: details.name || item.name || "Restaurant",
                            cuisine:
                                details.cuisine?.map((c: any) => c.localized_name || c.name).join(", ") ||
                                "Various",
                            priceRange: details.price_level || "€€",
                            rating: parseFloat(details.rating) || 4.0,
                            reviewCount: parseInt(details.num_reviews) || 0,
                            address: details.address_obj?.address_string || city,
                            tripAdvisorUrl: details.web_url || "https://www.tripadvisor.com",
                        };
                    }
                } catch {
                    // Detail lookup is best-effort; fall through to the search row.
                }
                return {
                    name: item.name || "Restaurant",
                    cuisine: "Various",
                    priceRange: "€€",
                    rating: 4.0,
                    reviewCount: 0,
                    address: item.address_obj?.address_string || city,
                    tripAdvisorUrl: "https://www.tripadvisor.com",
                };
            })
        );

        const card: AtlasCard = { type: "restaurants", data: { city, restaurants } };
        const summary =
            `Top restaurants in ${city} (TripAdvisor): ` +
            restaurants
                .map((r) => `${r.name} — ${r.cuisine}, ${r.priceRange}, ${r.rating}/5 (${r.reviewCount} reviews)`)
                .join("; ");

        return { result: summary, card };
    } catch (error) {
        console.error("[Atlas] TripAdvisor API error:", error);
        return { result: `Restaurant lookup failed for ${city}.` };
    }
}

async function toolCurrency(from: string, to: string, amount: number): Promise<ToolOutcome> {
    const base = (from || "EUR").toUpperCase();
    const target = (to || "USD").toUpperCase();

    if (base === target) {
        return { result: `${base} and ${target} are the same currency.` };
    }

    try {
        const response = await fetch(
            `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(target)}`
        );
        if (!response.ok) {
            return { result: `Could not fetch an exchange rate for ${base}→${target}.` };
        }
        const data = await response.json();
        const rate = data?.rates?.[target];
        if (typeof rate !== "number") {
            return { result: `No exchange rate available for ${base}→${target}.` };
        }

        const qty = amount > 0 ? amount : 1;
        const converted = qty * rate;

        const card: AtlasCard = {
            type: "currency",
            data: {
                from: base,
                to: target,
                rate,
                amount: qty,
                converted,
                asOf: data.date ?? null,
            },
        };

        return {
            result:
                `Exchange rate (ECB reference, ${data.date}): 1 ${base} = ${rate} ${target}. ` +
                `${qty} ${base} = ${converted.toFixed(2)} ${target}.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Currency error:", error);
        return { result: `Currency lookup failed for ${base}→${target}.` };
    }
}

function toolCountryFacts(country: string): ToolOutcome {
    const info = lookupCountryFacts(country);
    if (!info) {
        return {
            result:
                `"${country}" is not in the curated country table. Answer from general ` +
                `knowledge and say the details are not from a live source.`,
        };
    }

    const card: AtlasCard = { type: "countryFacts", data: info };
    return {
        result:
            `${info.name} (${info.cca2}): capital ${info.capital}, region ${info.region}. ` +
            `Currency: ${info.currencies}. Languages: ${info.languages}. ` +
            `Calling code ${info.callingCode}. Drives on the ${info.drivingSide}. ` +
            `Time zones: ${info.timezones.slice(0, 4).join(", ")}.`,
        card,
    };
}

async function toolPublicHolidays(country: string, year?: number): Promise<ToolOutcome> {
    const info = lookupCountryFacts(country);
    if (!info || !info.cca2) {
        return { result: `Could not resolve a country code for "${country}".` };
    }

    const targetYear = year && year > 2000 && year < 2100 ? year : new Date().getUTCFullYear();

    try {
        const response = await fetch(
            `https://date.nager.at/api/v3/PublicHolidays/${targetYear}/${info.cca2}`
        );
        if (!response.ok) {
            return { result: `No public holiday data available for ${info.name} in ${targetYear}.` };
        }

        // Nager.Date answers 204 with an EMPTY body for countries it doesn't
        // cover — the Gulf states, Thailand and others, largely because their
        // holidays follow lunar calendars and shift each year. 204 is "ok", so
        // calling .json() straight through throws a parse error and the user
        // gets "lookup failed" for what is really a coverage gap.
        const body = await response.text();
        if (!body.trim()) {
            return {
                result:
                    `Nager.Date does not cover ${info.name}. Answer from general knowledge, ` +
                    `and note that if the country's holidays follow the lunar/Islamic calendar ` +
                    `the dates shift each year and should be confirmed closer to travel.`,
            };
        }

        const rows = JSON.parse(body);
        if (!Array.isArray(rows) || rows.length === 0) {
            return { result: `No public holidays listed for ${info.name} in ${targetYear}.` };
        }

        const holidays = rows.map((h: any) => ({
            date: h.date,
            day: shortDay(h.date),
            localName: h.localName,
            name: h.name,
            nationwide: h.global !== false,
        }));

        // Surface upcoming ones first — "are shops shut while I'm there" is the
        // real question behind this tool.
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = holidays.filter((h: any) => h.date >= today);

        const card: AtlasCard = {
            type: "holidays",
            data: { country: info.name, year: targetYear, holidays: upcoming.length > 0 ? upcoming : holidays },
        };

        return {
            result:
                `Public holidays in ${info.name}, ${targetYear}: ` +
                (upcoming.length > 0 ? upcoming : holidays)
                    .slice(0, 20)
                    .map((h: any) => `${h.date} (${h.day}) ${h.localName}${h.localName !== h.name ? ` / ${h.name}` : ""}`)
                    .join("; ") +
                `. Public holidays often mean closed banks, shops and reduced transport.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Holiday lookup error:", error);
        return { result: `Holiday lookup failed for ${country}.` };
    }
}

async function toolLocalTime(city: string): Promise<ToolOutcome> {
    const place = await geocodeCity(city);
    if (!place) return { result: `Could not find a place called "${city}".` };

    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: place.timezone,
            dateStyle: "full",
            timeStyle: "short",
        });
        const localTime = formatter.format(now);

        // Offset in hours = (wall-clock time there) − (wall-clock time UTC).
        const tzNow = new Date(now.toLocaleString("en-US", { timeZone: place.timezone }));
        const utcNow = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
        const offsetHours = Math.round(((tzNow.getTime() - utcNow.getTime()) / 3600000) * 10) / 10;

        const location = `${place.name}${place.country ? ", " + place.country : ""}`;
        const card: AtlasCard = {
            type: "localTime",
            data: {
                location,
                timezone: place.timezone,
                localTime,
                utcOffset: offsetHours,
            },
        };

        return {
            result:
                `Local time in ${location} is ${localTime} (${place.timezone}, UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}).`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Local time error:", error);
        return { result: `Time lookup failed for ${city}.` };
    }
}

function toolDestinationSpend(destination: string): ToolOutcome {
    const spend = getAvgDailySpend(destination);
    const stay = getAvgStay(destination);

    if (!spend) {
        return { result: `No spend benchmark available for "${destination}".` };
    }

    const card: AtlasCard = {
        type: "spend",
        data: {
            destination,
            dailyEur: spend.amount,
            currency: spend.currency,
            // "city" means an exact city benchmark; "country" is a coarser
            // national average the UI should label as approximate.
            level: spend.level,
            avgStayDays: stay?.days ?? null,
            estimatedTripCost: stay?.days ? Math.round(spend.amount * stay.days) : null,
        },
    };

    return {
        result:
            `Typical spend in ${destination}: about €${spend.amount} per person per day (${spend.level}-level benchmark)` +
            (stay?.days
                ? `, and the average stay is ${stay.days} days — roughly €${Math.round(spend.amount * stay.days)} per person for a typical trip.`
                : "."),
        card,
    };
}

// ─────────────────────── Tools backed by our own data ───────────────────────

async function toolMyTrips(ctx: any, tc: AtlasToolContext): Promise<ToolOutcome> {
    try {
        const trips = await ctx.runQuery(api.trips.list, { token: tc.token });
        if (!Array.isArray(trips) || trips.length === 0) {
            return { result: "The user has no trips saved yet." };
        }

        const simplified = trips.slice(0, 10).map((t: any) => ({
            id: t._id,
            destination: t.destination,
            startDate: t.startDate,
            endDate: t.endDate,
            status: t.status,
            travelers: t.travelerCount ?? t.travelers ?? 1,
        }));

        const card: AtlasCard = { type: "trips", data: { trips: simplified } };
        return {
            result:
                `The user's saved trips: ` +
                simplified
                    .map(
                        (t: any) =>
                            `${t.destination} (${new Date(t.startDate).toISOString().slice(0, 10)} → ${new Date(t.endDate).toISOString().slice(0, 10)}, ${t.status})`
                    )
                    .join("; "),
            card,
        };
    } catch (error) {
        console.error("[Atlas] Trips lookup error:", error);
        return { result: "Could not read the user's trips." };
    }
}

async function toolFlightPrices(
    ctx: any,
    tc: AtlasToolContext,
    destinationIata: string,
    originIata?: string
): Promise<ToolOutcome> {
    const departureId = (originIata || tc.homeIata || "").toUpperCase();
    const arrivalId = (destinationIata || "").toUpperCase();

    if (!departureId) {
        return {
            result:
                "No origin airport is available. Ask the user to set a home airport in their profile, or to name their departure city.",
        };
    }
    if (!arrivalId) {
        return { result: "No destination airport code was provided." };
    }

    try {
        const calendar = await ctx.runAction(api.flightCalendar.flightCalendar, {
            token: tc.token,
            input: { departureId, arrivalId, currency: tc.currency },
        });

        if (!calendar || !Array.isArray(calendar.dates) || calendar.dates.length === 0) {
            return { result: `No fare calendar available for ${departureId}→${arrivalId}.` };
        }

        const cheapest = [...calendar.dates]
            .filter((d: any) => typeof d.price === "number")
            .sort((a: any, b: any) => a.price - b.price)
            .slice(0, 6);

        const card: AtlasCard = {
            type: "flightPrices",
            data: {
                origin: departureId,
                destination: arrivalId,
                currency: calendar.currency ?? tc.currency,
                dates: cheapest,
            },
        };

        return {
            result:
                `Cheapest upcoming round-trip dates ${departureId}→${arrivalId} (${calendar.currency ?? tc.currency}): ` +
                cheapest
                    .map((d: any) => `${d.date}${d.returnDate ? `→${d.returnDate}` : ""} ${d.price}`)
                    .join("; ") +
                `. These are indicative teaser prices, not bookable quotes — tell the user to open Flight Search to book.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Flight calendar error:", error);
        return { result: `Fare lookup failed for ${departureId}→${arrivalId}.` };
    }
}

async function toolDeals(ctx: any, tc: AtlasToolContext, destination?: string): Promise<ToolOutcome> {
    try {
        const res = await ctx.runQuery(api.lowFareRadar.getDealsForUser, { token: tc.token });
        let deals: any[] = res?.deals ?? [];

        deals = deals.filter((d) => !d.isExpired);
        if (destination) {
            const needle = destination.toLowerCase();
            deals = deals.filter(
                (d) =>
                    d.destinationCity?.toLowerCase().includes(needle) ||
                    d.destinationCountry?.toLowerCase().includes(needle)
            );
        }

        if (deals.length === 0) {
            return {
                result: res?.homeIata
                    ? `No active deals right now from ${res.homeIata}${destination ? ` to ${destination}` : ""}.`
                    : `No deals available — the user has not set a home airport.`,
            };
        }

        const top = deals.slice(0, 6).map((d: any) => ({
            id: d._id,
            origin: d.origin,
            destinationCity: d.destinationCity,
            destinationCountry: d.destinationCountry,
            price: d.price,
            currency: d.currency ?? "EUR",
            airline: d.airline ?? null,
            travelWindow: d.travelWindow ?? null,
            isRecommended: !!d.isRecommended,
        }));

        const card: AtlasCard = {
            type: "deals",
            data: { homeIata: res?.homeIata ?? null, deals: top },
        };

        return {
            result:
                `Active Low-Fare Radar deals from ${res.homeIata}: ` +
                top
                    .map((d: any) => `${d.destinationCity} ${d.currency} ${d.price}${d.airline ? ` on ${d.airline}` : ""}`)
                    .join("; "),
            card,
        };
    } catch (error) {
        console.error("[Atlas] Deals lookup error:", error);
        return { result: "Could not read the deal radar." };
    }
}

async function toolTopSights(ctx: any, tc: AtlasToolContext, destination: string): Promise<ToolOutcome> {
    try {
        const res = await ctx.runQuery(api.sights.getDestinationSights, {
            destination,
            language: tc.language,
        });
        if (!res || !Array.isArray(res.sights) || res.sights.length === 0) {
            return {
                result: `No cached sight data for ${destination}. Answer from general knowledge instead, listing notable landmarks as facts (not as a day-by-day plan).`,
            };
        }

        const sights = res.sights.slice(0, 8).map((s: any) => ({
            name: s.name,
            description: s.shortDescription,
            area: s.neighborhoodOrArea ?? null,
            bestTime: s.bestTimeToVisit ?? null,
            duration: s.estDurationHours ?? null,
        }));

        const card: AtlasCard = { type: "sights", data: { destination, sights } };
        return {
            result:
                `Notable sights in ${destination}: ` +
                sights.map((s: any) => `${s.name} — ${s.description}`).join("; ") +
                `. Present these as facts about the destination, NOT as a day-by-day itinerary.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Sights lookup error:", error);
        return { result: `Sight lookup failed for ${destination}.` };
    }
}

async function toolPassportCheck(
    ctx: any,
    tc: AtlasToolContext,
    tripDate?: string
): Promise<ToolOutcome> {
    try {
        const travelers = await ctx.runQuery(api.travelers.list, { token: tc.token });
        if (!Array.isArray(travelers) || travelers.length === 0) {
            return {
                result:
                    "The user has no saved traveler profiles, so nationality and passport expiry are unknown. Ask which passport they hold.",
            };
        }

        // Most destinations require six months of validity beyond entry.
        const reference = tripDate ? new Date(tripDate) : new Date();
        const referenceMs = Number.isNaN(reference.getTime()) ? Date.now() : reference.getTime();
        const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;

        const checks = travelers.map((t: any) => {
            const expiry = new Date(t.passportExpiryDate);
            const expiryMs = expiry.getTime();
            const valid = !Number.isNaN(expiryMs);
            const monthsRemaining = valid
                ? Math.round(((expiryMs - referenceMs) / (30.44 * 24 * 60 * 60 * 1000)) * 10) / 10
                : null;
            return {
                name: `${t.firstName} ${t.lastName}`.trim(),
                nationality: t.passportIssuingCountry,
                expiry: t.passportExpiryDate,
                expired: valid ? expiryMs <= referenceMs : false,
                meetsSixMonthRule: valid ? expiryMs - referenceMs >= sixMonthsMs : false,
                monthsRemaining,
            };
        });

        const card: AtlasCard = {
            type: "passportCheck",
            data: { referenceDate: new Date(referenceMs).toISOString().slice(0, 10), travelers: checks },
        };

        return {
            result:
                `Saved traveler passports (checked against ${card.data.referenceDate}): ` +
                checks
                    .map(
                        (c: any) =>
                            `${c.name} — ${c.nationality} passport, expires ${c.expiry}` +
                            (c.expired
                                ? " (EXPIRED)"
                                : c.meetsSixMonthRule
                                    ? " (meets the 6-month rule)"
                                    : " (FAILS the common 6-month validity rule)")
                    )
                    .join("; ") +
                `. Use the nationality above to give visa guidance without asking the user again.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Passport check error:", error);
        return { result: "Could not read saved traveler passports." };
    }
}

async function toolPublishedItineraries(ctx: any, destination: string): Promise<ToolOutcome> {
    try {
        const rows = await ctx.runQuery(api.publishedItineraries.listByDestination, { destination });
        if (!Array.isArray(rows) || rows.length === 0) {
            return { result: `No published Planera guides for ${destination}.` };
        }

        const guides = rows.slice(0, 5).map((r: any) => ({
            slug: r.slug,
            title: r.title ?? destination,
            days: r.days ?? null,
            summary: r.summary ?? null,
        }));

        const card: AtlasCard = { type: "itineraries", data: { destination, guides } };
        return {
            result:
                `Published Planera guides for ${destination}: ` +
                guides.map((g: any) => `"${g.title}"${g.days ? ` (${g.days} days)` : ""}`).join("; ") +
                `. Mention these exist but do NOT reproduce them as a plan — point the user to the guide.`,
            card,
        };
    } catch (error) {
        console.error("[Atlas] Published itineraries error:", error);
        return { result: `Guide lookup failed for ${destination}.` };
    }
}

// ─────────────────────────────── Write tools ────────────────────────────────
// Both are reversible, scoped to the user's own data, and only fire when the
// user asked for them in words. Each returns a card so the write is always
// visible in the transcript rather than happening silently.

async function toolWatchDestination(
    ctx: any,
    tc: AtlasToolContext,
    destination: string,
    destinationIata?: string
): Promise<ToolOutcome> {
    try {
        await ctx.runMutation(api.watchedDestinations.watch, {
            token: tc.token,
            destination,
            destinationIata: destinationIata || undefined,
        });
        return {
            result: `Now watching ${destination} — the user will be notified when fares drop.`,
            card: { type: "watched", data: { destination, destinationIata: destinationIata ?? null } },
        };
    } catch (error: any) {
        const message = String(error?.message ?? error);
        console.error("[Atlas] Watch destination error:", message);
        // The 20-destination cap surfaces here; pass it through so the model can
        // explain rather than claiming success.
        return { result: `Could not watch ${destination}: ${message}` };
    }
}

async function toolAddToWishlist(
    ctx: any,
    tc: AtlasToolContext,
    destination: string,
    country?: string
): Promise<ToolOutcome> {
    try {
        const res = await ctx.runMutation(api.wishlist.addToWishlist, {
            token: tc.token,
            destination,
            country: country || undefined,
        });

        if (res && res.success === false) {
            return {
                result:
                    res.reason === "already_in_wishlist"
                        ? `${destination} is already in the wishlist.`
                        : `Could not add ${destination} to the wishlist (${res.reason}).`,
            };
        }

        return {
            result: `Added ${destination} to the user's wishlist.`,
            card: { type: "wishlist", data: { destination, country: country ?? null } },
        };
    } catch (error: any) {
        const message = String(error?.message ?? error);
        console.error("[Atlas] Wishlist error:", message);
        return { result: `Could not add ${destination} to the wishlist: ${message}` };
    }
}

// ───────────────────────── OpenAI tool declarations ─────────────────────────

export const ATLAS_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "get_weather",
            description:
                "Current conditions and a 7-day forecast (temps, rain chance, UV, sunrise/sunset) for a city. Use for any weather, 'what should I pack', or 'best time of year' question.",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string", description: "City name, e.g. 'Rome' or 'Tokyo'" },
                },
                required: ["city"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_air_quality",
            description:
                "Current air quality (European AQI, PM2.5, PM10, NO2, ozone) and UV index for a city. Use for pollution, smog, asthma or sun-exposure questions.",
            parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_restaurants",
            description:
                "Live top-rated restaurants for a city from TripAdvisor, with cuisine, price level and rating.",
            parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "convert_currency",
            description:
                "Live ECB reference exchange rate and conversion between two ISO-4217 currency codes.",
            parameters: {
                type: "object",
                properties: {
                    from: { type: "string", description: "ISO code, e.g. EUR" },
                    to: { type: "string", description: "ISO code, e.g. JPY" },
                    amount: { type: "number", description: "Amount to convert. Defaults to 1." },
                },
                required: ["from", "to"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_country_facts",
            description:
                "Factual country data: capital, currency, official languages, calling code, driving side, time zones. Use for practical 'what do I need to know' questions.",
            parameters: {
                type: "object",
                properties: { country: { type: "string" } },
                required: ["country"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_public_holidays",
            description:
                "Public holidays for a country and year. Use when the user asks whether shops/banks will be shut, or about festivals and closures during their dates.",
            parameters: {
                type: "object",
                properties: {
                    country: { type: "string" },
                    year: { type: "number", description: "Four-digit year. Defaults to the current year." },
                },
                required: ["country"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_local_time",
            description:
                "Current local time, IANA time zone and UTC offset for a city. Use for jet lag and 'what time is it there' questions.",
            parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_destination_spend",
            description:
                "Benchmark average daily spend per person (EUR) and typical trip length for a destination. Use for budget and 'how expensive is' questions.",
            parameters: {
                type: "object",
                properties: { destination: { type: "string", description: "City or country name" } },
                required: ["destination"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_my_trips",
            description:
                "The user's own saved trips (destination, dates, status). Call this FIRST whenever the user refers to 'my trip', 'my next trip' or a destination without naming it.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_flight_prices",
            description:
                "Cheapest upcoming round-trip dates between two airports, as indicative (non-bookable) teaser fares. Origin defaults to the user's home airport.",
            parameters: {
                type: "object",
                properties: {
                    destinationIata: { type: "string", description: "Destination IATA code, e.g. FCO" },
                    originIata: { type: "string", description: "Origin IATA code. Omit to use the home airport." },
                },
                required: ["destinationIata"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_deals",
            description:
                "Active Low-Fare Radar deals from the user's home airport, optionally filtered to a destination.",
            parameters: {
                type: "object",
                properties: {
                    destination: { type: "string", description: "Optional city or country filter" },
                },
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "get_top_sights",
            description:
                "Notable landmarks and sights for a destination, as factual descriptions. Never present the result as a day-by-day plan.",
            parameters: {
                type: "object",
                properties: { destination: { type: "string" } },
                required: ["destination"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "check_passport_validity",
            description:
                "The nationality and passport expiry of the user's saved travelers, checked against the common 6-month validity rule. Call this before answering ANY visa or entry-requirement question so the answer matches their actual passport.",
            parameters: {
                type: "object",
                properties: {
                    tripDate: { type: "string", description: "Trip start date as YYYY-MM-DD. Defaults to today." },
                },
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "find_guides",
            description:
                "Published Planera destination guides for a place. Use to point the user at existing content instead of writing an itinerary yourself.",
            parameters: {
                type: "object",
                properties: { destination: { type: "string" } },
                required: ["destination"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "watch_destination",
            description:
                "Start watching a destination for fare drops. Only call when the user explicitly asks to be alerted or to track prices.",
            parameters: {
                type: "object",
                properties: {
                    destination: { type: "string" },
                    destinationIata: { type: "string" },
                },
                required: ["destination"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "add_to_wishlist",
            description:
                "Add a destination to the user's wishlist. Only call when the user explicitly asks to save or bookmark a place.",
            parameters: {
                type: "object",
                properties: {
                    destination: { type: "string" },
                    country: { type: "string" },
                },
                required: ["destination"],
            },
        },
    },
];

/** Tools whose results are worth memoising, with their TTLs. */
const CACHE_TTL_MS: Record<string, number> = {
    get_weather: 30 * 60 * 1000,          // 30m — conditions move slowly enough
    get_air_quality: 30 * 60 * 1000,
    get_restaurants: 24 * 60 * 60 * 1000, // 24h — the expensive N+1, rarely changes
    convert_currency: 6 * 60 * 60 * 1000, // 6h — ECB publishes once a day
    // get_country_facts is a local table lookup; caching it would cost a DB
    // round-trip to avoid an in-memory one.
    get_public_holidays: 30 * 24 * 60 * 60 * 1000,
    get_top_sights: 24 * 60 * 60 * 1000,
    find_guides: 60 * 60 * 1000,
};

/**
 * Dispatch one tool call.
 *
 * Cacheable tools are keyed on name + arguments only; anything reading or
 * writing user data is deliberately excluded from the cache so results are
 * never served across accounts.
 */
export async function executeAtlasTool(
    ctx: any,
    tc: AtlasToolContext,
    name: string,
    args: any
): Promise<ToolOutcome> {
    const ttl = CACHE_TTL_MS[name];
    const cacheKey = ttl ? `${name}:${JSON.stringify(args ?? {})}`.toLowerCase() : null;

    if (cacheKey) {
        try {
            const hit = await ctx.runQuery(internal.atlasDb.readToolCache, { key: cacheKey });
            if (hit) return hit as ToolOutcome;
        } catch {
            // A cache miss must never fail the turn.
        }
    }

    let outcome: ToolOutcome;

    switch (name) {
        case "get_weather":
            outcome = await toolWeather(String(args?.city ?? ""));
            break;
        case "get_air_quality":
            outcome = await toolAirQuality(String(args?.city ?? ""));
            break;
        case "get_restaurants":
            outcome = await toolRestaurants(String(args?.city ?? ""));
            break;
        case "convert_currency":
            outcome = await toolCurrency(
                String(args?.from ?? "EUR"),
                String(args?.to ?? tc.currency ?? "USD"),
                Number(args?.amount ?? 1)
            );
            break;
        case "get_country_facts":
            outcome = toolCountryFacts(String(args?.country ?? ""));
            break;
        case "get_public_holidays":
            outcome = await toolPublicHolidays(
                String(args?.country ?? ""),
                args?.year != null ? Number(args.year) : undefined
            );
            break;
        case "get_local_time":
            outcome = await toolLocalTime(String(args?.city ?? ""));
            break;
        case "get_destination_spend":
            outcome = toolDestinationSpend(String(args?.destination ?? ""));
            break;
        case "get_my_trips":
            outcome = await toolMyTrips(ctx, tc);
            break;
        case "get_flight_prices":
            outcome = await toolFlightPrices(
                ctx,
                tc,
                String(args?.destinationIata ?? ""),
                args?.originIata ? String(args.originIata) : undefined
            );
            break;
        case "get_deals":
            outcome = await toolDeals(ctx, tc, args?.destination ? String(args.destination) : undefined);
            break;
        case "get_top_sights":
            outcome = await toolTopSights(ctx, tc, String(args?.destination ?? ""));
            break;
        case "check_passport_validity":
            outcome = await toolPassportCheck(ctx, tc, args?.tripDate ? String(args.tripDate) : undefined);
            break;
        case "find_guides":
            outcome = await toolPublishedItineraries(ctx, String(args?.destination ?? ""));
            break;
        case "watch_destination":
            outcome = await toolWatchDestination(
                ctx,
                tc,
                String(args?.destination ?? ""),
                args?.destinationIata ? String(args.destinationIata) : undefined
            );
            break;
        case "add_to_wishlist":
            outcome = await toolAddToWishlist(
                ctx,
                tc,
                String(args?.destination ?? ""),
                args?.country ? String(args.country) : undefined
            );
            break;
        default:
            outcome = { result: `Unknown tool "${name}".` };
    }

    // Only cache successful lookups — caching a transient API failure for 24h
    // would be worse than not caching at all.
    if (cacheKey && outcome.card) {
        try {
            await ctx.runMutation(internal.atlasDb.writeToolCache, {
                key: cacheKey,
                payload: outcome,
                ttlMs: ttl,
            });
        } catch {
            // Non-fatal.
        }
    }

    return outcome;
}
