import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

// ===== WEATHER API INTEGRATION =====
// Using Open-Meteo (free, no API key required)

interface WeatherData {
    location: string;
    current: {
        temperature: number;
        feelsLike: number;
        humidity: number;
        windSpeed: number;
        description: string;
        isDay: boolean;
    };
    forecast: Array<{
        date: string;
        maxTemp: number;
        minTemp: number;
        precipitation: number;
        description: string;
    }>;
}

// Weather code to description mapping
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

async function geocodeCity(cityName: string): Promise<{ lat: number; lon: number; name: string; country: string } | null> {
    try {
        const response = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`
        );
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            return {
                lat: result.latitude,
                lon: result.longitude,
                name: result.name,
                country: result.country || "",
            };
        }
        return null;
    } catch (error) {
        console.error("Geocoding error:", error);
        return null;
    }
}

async function getWeatherData(cityName: string): Promise<WeatherData | null> {
    const location = await geocodeCity(cityName);
    if (!location) {
        return null;
    }

    try {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=7`
        );
        const data = await response.json();

        const weatherData: WeatherData = {
            location: `${location.name}, ${location.country}`,
            current: {
                temperature: Math.round(data.current.temperature_2m),
                feelsLike: Math.round(data.current.apparent_temperature),
                humidity: data.current.relative_humidity_2m,
                windSpeed: Math.round(data.current.wind_speed_10m),
                description: weatherCodeToDescription[data.current.weather_code] || "Unknown",
                isDay: data.current.is_day === 1,
            },
            forecast: data.daily.time.map((date: string, i: number) => ({
                date,
                maxTemp: Math.round(data.daily.temperature_2m_max[i]),
                minTemp: Math.round(data.daily.temperature_2m_min[i]),
                precipitation: data.daily.precipitation_sum[i],
                description: weatherCodeToDescription[data.daily.weather_code[i]] || "Unknown",
            })),
        };

        return weatherData;
    } catch (error) {
        console.error("Weather API error:", error);
        return null;
    }
}

function formatWeatherForAI(weather: WeatherData): string {
    const forecast = weather.forecast
        .map((day) => `  - ${day.date}: ${day.description}, High ${day.maxTemp}°C / Low ${day.minTemp}°C, Precipitation: ${day.precipitation}mm`)
        .join("\n");

    return `
REAL-TIME WEATHER DATA for ${weather.location}:
Current Conditions:
- Temperature: ${weather.current.temperature}°C (feels like ${weather.current.feelsLike}°C)
- Conditions: ${weather.current.description}
- Humidity: ${weather.current.humidity}%
- Wind Speed: ${weather.current.windSpeed} km/h
- Time of day: ${weather.current.isDay ? "Daytime" : "Nighttime"}

7-Day Forecast:
${forecast}

Use this real data to answer the user's weather question.`;
}

// Detect if the user is asking about weather and extract the city
function detectWeatherQuery(message: string): string | null {
    const weatherKeywords = /weather|temperature|forecast|hot|cold|rain|snow|sunny|cloudy|climate|degrees|celsius|fahrenheit/i;
    if (!weatherKeywords.test(message)) {
        return null;
    }

    // Common patterns to extract city names
    const patterns = [
        /weather (?:in|for|at) ([A-Za-z\s]+?)(?:\?|$|,| in | for | this | next | today | tomorrow | right now)/i,
        /(?:in|for|at) ([A-Za-z\s]+?) (?:weather|temperature|forecast)/i,
        /([A-Za-z\s]+?) weather/i,
        /temperature (?:in|for|at) ([A-Za-z\s]+)/i,
        /how (?:hot|cold|warm) (?:is it )?(?:in|at) ([A-Za-z\s]+)/i,
        /what(?:'s| is) (?:the )?(?:weather|temperature|forecast) (?:like )?(?:in|for|at) ([A-Za-z\s]+)/i,
        /(?:visiting|going to|traveling to|trip to) ([A-Za-z\s]+).*(?:weather|temperature|pack|wear)/i,
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return null;
}

// Atlas System Prompt - Strictly informational, no trip planning
const ATLAS_SYSTEM_PROMPT = `You are Atlas, a travel information assistant for the Planera app.

Your role is to provide factual, helpful travel information ONLY. You are knowledgeable, friendly, and concise.

YOU CAN HELP WITH:
- Weather information (current conditions, seasonal patterns, best time to visit)
- Visa requirements and entry rules for different nationalities
- Passport validity requirements
- Currency information and payment methods accepted
- Local laws, customs, and cultural etiquette
- Safety tips and travel advisories
- Time zones and jet lag advice
- General destination facts (language, population, geography)
- Transportation options overview
- Tipping customs
- Emergency numbers and embassy information
- Vaccination requirements
- Electrical outlets and voltage information
- Mobile connectivity and SIM cards

YOU MUST NOT:
- Generate travel itineraries or day-by-day plans
- Create trip schedules or agendas
- Suggest specific activities to do on specific days
- Act as a trip planner or booking assistant
- Replace or duplicate the "Create Trip" feature

If a user asks you to plan a trip, create an itinerary, or suggest what to do each day, politely redirect them:
"I can help with travel information like visas, weather, and local customs. For personalized trip planning and itineraries, please use the Create Trip feature in Planera!"

When providing weather information, if real-time weather data is provided, use it to give accurate current conditions and forecasts. Present the information in a friendly, easy-to-read format.

IMPORTANT: When you have real-time weather data, you MUST include a hidden JSON block at the end of your response for the UI to render a weather card.
Format:
<WEATHER_JSON>
{
  "location": "City, Country",
  "temperature": 25,
  "condition": "Sunny",
  "humidity": 60,
  "windSpeed": 15,
  "isDay": true,
  "forecast": [
    { "day": "Mon", "high": 28, "low": 20, "condition": "Sunny" },
    { "day": "Tue", "high": 26, "low": 19, "condition": "Cloudy" },
    ...
  ]
}
</WEATHER_JSON>

Keep responses concise and helpful. Use bullet points for lists. Be warm but professional.`;

export const chat = action({
    args: {
        token: v.string(),
        messages: v.array(
            v.object({
                role: v.union(v.literal("user"), v.literal("assistant")),
                content: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        // Validate the token by calling a query
        const user = await ctx.runQuery(api.users.validateToken, { token: args.token });
        if (!user) {
            throw new Error("Authentication required");
        }

        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const MODEL = process.env.ATLAS_MODEL || "gpt-4o-mini";

        if (!OPENAI_API_KEY) {
            throw new Error("OpenAI API key not configured in Convex environment");
        }

        // Get the latest user message
        const latestMessage = args.messages[args.messages.length - 1];
        let weatherContext = "";

        // Check if the user is asking about weather
        if (latestMessage && latestMessage.role === "user") {
            const city = detectWeatherQuery(latestMessage.content);
            if (city) {
                console.log(`[Atlas] Detected weather query for city: ${city}`);
                const weatherData = await getWeatherData(city);
                if (weatherData) {
                    weatherContext = formatWeatherForAI(weatherData);
                    console.log(`[Atlas] Got weather data for ${weatherData.location}`);
                } else {
                    console.log(`[Atlas] Could not get weather data for ${city}`);
                }
            }
        }

        // Build the system prompt with weather context if available
        const systemPrompt = weatherContext 
            ? `${ATLAS_SYSTEM_PROMPT}\n\n${weatherContext}`
            : ATLAS_SYSTEM_PROMPT;

        const apiMessages = [
            { role: "system", content: systemPrompt },
            ...args.messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            })),
        ];

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: apiMessages,
                max_tokens: 1000,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI API error:", errorText);
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    },
});
