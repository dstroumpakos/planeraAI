/**
 * Atlas — the travel information assistant.
 *
 * The chat turn is an OpenAI tool-calling loop (see `atlasTools.ts` for the
 * tool catalogue). Previously this file detected intent with two regexes and
 * could therefore only answer weather and restaurant questions; the model now
 * chooses tools itself and Atlas can reach the app's own data — trips, deals,
 * fares, saved passports — as well as external APIs.
 *
 * Three things this file is responsible for beyond the loop:
 *  - **Spend control.** Every turn is rate limited and history is trimmed. An
 *    unmetered chat over an unbounded transcript is an open-ended bill.
 *  - **User context.** Home airport, currency, language, saved trips and today's
 *    date are injected up front, so "the weather for my trip" resolves without
 *    a round-trip question.
 *  - **The guardrail.** Atlas answers travel questions but must not produce
 *    itineraries — that is the paid Create Trip feature. This is enforced both
 *    in the prompt and by a post-check on the model's output.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
    ATLAS_TOOLS,
    executeAtlasTool,
    geocodeCity,
    type AtlasCard,
    type AtlasToolContext,
} from "./atlasTools";

// ───────────────────────────────── Tuning ───────────────────────────────────

/** Turns allowed per user per window. */
const RATE_LIMIT_TURNS = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Most recent messages kept when rebuilding model context. The client used to
 * send the entire transcript every turn, which grew input cost without bound
 * and would eventually overflow the context window.
 */
const MAX_HISTORY_MESSAGES = 12;
/** Hard cap per message so one paste can't blow up the request. */
const MAX_MESSAGE_CHARS = 4000;

/**
 * Tool round-trips per turn. Two is enough for "look up my trip, then get the
 * weather there"; the cap stops a pathological loop from calling tools forever.
 */
const MAX_TOOL_ROUNDS = 3;

// ─────────────────────────────── System prompt ──────────────────────────────

const ATLAS_SYSTEM_PROMPT = `You are Atlas, a travel information assistant for the Planera app.

Your role is to provide factual, helpful travel information. You are knowledgeable, friendly and concise.

YOU CAN HELP WITH:
- Weather, forecasts, air quality, UV and best time to visit
- Restaurant recommendations (live TripAdvisor data)
- Visa requirements and entry rules for the traveller's actual nationality
- Passport validity (the common 6-month rule)
- Currency, live exchange rates and payment methods
- Typical daily spend and trip budgets
- Local laws, customs, etiquette and tipping
- Safety tips and travel advisories
- Time zones, local time and jet lag
- Public holidays and closures
- General destination facts (language, population, geography, driving side, calling codes)
- Transport options overview
- Emergency numbers and embassy information
- Vaccination requirements
- Electrical outlets and voltage
- Mobile connectivity and SIM cards
- Notable landmarks and sights, as facts
- The user's own saved trips, deals from their home airport and indicative fares

USING TOOLS:
- Prefer a tool over your own memory for anything live: weather, air quality, fares, exchange rates, holidays, restaurants.
- When the user says "my trip", "my next trip", or names no destination, call get_my_trips FIRST to resolve which place they mean.
- Before answering ANY visa, entry or passport question, call check_passport_validity so the answer matches the passport they actually hold. Never ask for a nationality you can look up.
- Only call watch_destination or add_to_wishlist when the user explicitly asks to track or save something. Never call them speculatively.
- If a tool returns no data, say so plainly and answer from general knowledge, flagging that the figure is not live.

YOU MUST NOT:
- Generate travel itineraries or day-by-day plans
- Create trip schedules or agendas
- Suggest specific activities for specific days
- Act as a trip planner or booking assistant
- Replace or duplicate the "Create Trip" feature

Listing a destination's landmarks as facts is allowed. Arranging them into a Day 1 / Day 2 structure is not. If the user asks you to plan a trip, build an itinerary or say what to do each day, redirect them:
"I can help with travel information like visas, weather and local customs. For personalised trip planning and itineraries, please use the Create Trip feature in Planera!"

STYLE:
- Keep responses concise. Use bullet points for lists.
- Be warm but professional.
- Never invent prices, rates or dates — use tool data or say you don't know.
- Present fares as indicative and non-bookable; direct the user to Flight Search to book.
- Always reply in the user's language (given below), regardless of the language of the data you receive from tools.

At the very end of every reply, on its own final line, suggest exactly three short follow-up questions the user might ask next, formatted as:
<SUGGESTIONS>first question|second question|third question</SUGGESTIONS>
Keep each under 45 characters. This line is stripped before display.`;

/** Phrases that indicate the model started producing a day-by-day plan anyway. */
const ITINERARY_PATTERNS = [
    /\bday\s*[1-9][0-9]?\s*[:\-–—]/i,
    /\bday\s+one\b\s*[:\-–—]/i,
    /^\s*#+\s*day\s*[1-9]/im,
    /\b(morning|afternoon|evening)\s*[:\-–—]\s*\S+[\s\S]{0,120}\b(morning|afternoon|evening)\s*[:\-–—]/i,
];

const ITINERARY_REDIRECT =
    "I can help with travel information like visas, weather and local customs. " +
    "For personalised trip planning and itineraries, please use the Create Trip feature in Planera!";

/**
 * Prompt instructions alone don't hold a boundary the user is actively pushing
 * on, and the no-itinerary rule is what separates Atlas from the paid trip
 * generator. This is the backstop.
 */
function violatesItineraryGuardrail(text: string): boolean {
    // Two or more day markers is a plan; a single passing "Day 2 of your trip"
    // reference is not.
    const dayHeadings = text.match(/\bday\s*[1-9][0-9]?\s*[:\-–—]/gi);
    if (dayHeadings && dayHeadings.length >= 2) return true;
    return ITINERARY_PATTERNS.slice(1).some((p) => p.test(text));
}

/** Pull the trailing `<SUGGESTIONS>` line off the reply. */
function extractSuggestions(text: string): { clean: string; suggestions: string[] } {
    const match = text.match(/<SUGGESTIONS>([\s\S]*?)<\/SUGGESTIONS>/i);
    if (!match) return { clean: text.trim(), suggestions: [] };

    const suggestions = match[1]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);

    const clean = text.replace(/<SUGGESTIONS>[\s\S]*?<\/SUGGESTIONS>/i, "").trim();
    return { clean, suggestions };
}

/** Best-effort IATA extraction from a stored home-airport string. */
function extractIata(homeAirport?: string): string | undefined {
    if (!homeAirport) return undefined;
    // Accepts "Athens, ATH", "ATH - Athens", "ATH". Takes the last 3-letter
    // token so the city name never wins.
    const matches = homeAirport.toUpperCase().match(/\b([A-Z]{3})\b/g);
    return matches ? matches[matches.length - 1] : undefined;
}

const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    el: "Greek",
    de: "German",
    fr: "French",
    es: "Spanish",
    ar: "Arabic",
};

// ────────────────────────────── Public weather ──────────────────────────────

/** Kept local to this file — the preview card needs labels, not the full tool. */
const WEATHER_CODE_LABELS: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

/**
 * Public, unauthenticated current weather for a destination (used by the
 * destination preview screen). Compact shape with the raw weather code so the
 * client picks its own icon. Returns null when the city can't be geocoded.
 */
export const getCurrentWeather = action({
    args: {
        destination: v.string(),
    },
    returns: v.union(
        v.null(),
        v.object({
            location: v.string(),
            temperature: v.number(),
            feelsLike: v.number(),
            humidity: v.number(),
            windSpeed: v.number(),
            description: v.string(),
            weatherCode: v.number(),
            isDay: v.boolean(),
            todayMax: v.number(),
            todayMin: v.number(),
        }),
    ),
    handler: async (_ctx, args) => {
        const cityName = args.destination.split(",")[0].trim();
        if (!cityName) return null;

        const location = await geocodeCity(cityName);
        if (!location) return null;

        try {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
            );
            const data = await response.json();
            if (!data?.current) return null;

            const code = data.current.weather_code;
            return {
                location: `${location.name}${location.country ? ", " + location.country : ""}`,
                temperature: Math.round(data.current.temperature_2m),
                feelsLike: Math.round(data.current.apparent_temperature),
                humidity: Math.round(data.current.relative_humidity_2m),
                windSpeed: Math.round(data.current.wind_speed_10m),
                description: WEATHER_CODE_LABELS[code] || "Unknown",
                weatherCode: typeof code === "number" ? code : -1,
                isDay: data.current.is_day === 1,
                todayMax: Math.round(data.daily?.temperature_2m_max?.[0] ?? data.current.temperature_2m),
                todayMin: Math.round(data.daily?.temperature_2m_min?.[0] ?? data.current.temperature_2m),
            };
        } catch (error) {
            console.error("getCurrentWeather error:", error);
            return null;
        }
    },
});

// ──────────────────────────────── Chat turn ─────────────────────────────────

export const chat = action({
    args: {
        token: v.string(),
        messages: v.array(
            v.object({
                role: v.union(v.literal("user"), v.literal("assistant")),
                content: v.string(),
            })
        ),
        /** Existing thread to append to. Omit to start a new one. */
        conversationId: v.optional(v.id("atlasConversations")),
        /** UI locale, so replies match the app language. */
        language: v.optional(v.string()),
        /**
         * Opt in to the structured `{ text, cards, … }` response.
         *
         * This action used to return a bare string, and Convex prod is shared
         * with clients we cannot upgrade — every build already in the App Store
         * and Play Store. Those callers do `content.split("\n")` on the result,
         * which throws on an object, so omitting this flag must keep returning
         * the legacy string shape. Remove only once the old builds are dead.
         */
        structured: v.optional(v.boolean()),
    },
    returns: v.union(
        v.string(),
        v.object({
            text: v.string(),
            cards: v.array(v.object({ type: v.string(), data: v.any() })),
            suggestions: v.array(v.string()),
            conversationId: v.union(v.null(), v.id("atlasConversations")),
            toolsUsed: v.array(v.string()),
            rateLimited: v.boolean(),
        })
    ),
    handler: async (ctx, args) => {
        const user = await ctx.runQuery(api.users.validateToken, { token: args.token });
        if (!user) {
            throw new Error("Authentication required");
        }

        const userId: string = user.userId ?? user._id;

        // ── Spend guard ─────────────────────────────────────────────────────
        const rl = await ctx.runMutation(internal.atlasDb.checkRateLimit, {
            userId,
            limit: RATE_LIMIT_TURNS,
            windowMs: RATE_LIMIT_WINDOW_MS,
        });

        if (!rl.allowed) {
            const minutes = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
            if (!args.structured) {
                // Legacy callers render whatever string comes back verbatim, so
                // it has to be a real sentence rather than the sentinel below.
                return `I've hit my message limit for now. Please try again in about ${minutes} minutes.`;
            }
            return {
                // The client localises this; the delay is encoded rather than
                // formatted so the copy can live in the translation files.
                text: `RATE_LIMITED:${minutes}`,
                cards: [],
                suggestions: [],
                conversationId: args.conversationId ?? null,
                toolsUsed: [],
                rateLimited: true,
            };
        }

        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const MODEL = process.env.ATLAS_MODEL || "gpt-4o-mini";
        if (!OPENAI_API_KEY) {
            throw new Error("OpenAI API key not configured in Convex environment");
        }

        // ── User context ────────────────────────────────────────────────────
        const language = args.language || user.language || "en";
        const toolCtx: AtlasToolContext = {
            token: args.token,
            userId,
            homeAirport: user.homeAirport,
            homeIata: extractIata(user.homeAirport),
            currency: user.currency || "EUR",
            language,
        };

        // A compact trip summary up front means the model rarely has to spend a
        // tool round-trip just to learn the user has a trip at all.
        let tripSummary = "";
        try {
            const trips = await ctx.runQuery(api.trips.list, { token: args.token });
            if (Array.isArray(trips) && trips.length > 0) {
                const upcoming = trips
                    .filter((t: any) => t.endDate >= Date.now())
                    .sort((a: any, b: any) => a.startDate - b.startDate)
                    .slice(0, 3);
                if (upcoming.length > 0) {
                    tripSummary = upcoming
                        .map(
                            (t: any) =>
                                `${t.destination} (${new Date(t.startDate).toISOString().slice(0, 10)} → ${new Date(t.endDate).toISOString().slice(0, 10)})`
                        )
                        .join("; ");
                }
            }
        } catch {
            // Trip context is a nicety; a failure here must not fail the turn.
        }

        const contextBlock = [
            `TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}`,
            `USER LANGUAGE: ${LANGUAGE_NAMES[language] ?? language} (reply in this language)`,
            `USER CURRENCY: ${toolCtx.currency}`,
            toolCtx.homeAirport
                ? `HOME AIRPORT: ${toolCtx.homeAirport}${toolCtx.homeIata ? ` (IATA ${toolCtx.homeIata})` : ""}`
                : `HOME AIRPORT: not set — ask the user for a departure city before any fare lookup.`,
            tripSummary
                ? `UPCOMING TRIPS: ${tripSummary}`
                : `UPCOMING TRIPS: none saved.`,
        ].join("\n");

        // ── Message history ─────────────────────────────────────────────────
        const trimmed = args.messages
            .slice(-MAX_HISTORY_MESSAGES)
            .map((m) => ({
                role: m.role,
                content: m.content.slice(0, MAX_MESSAGE_CHARS),
            }));

        const latestUserMessage =
            [...trimmed].reverse().find((m) => m.role === "user")?.content ?? "";

        const conversation: any[] = [
            { role: "system", content: `${ATLAS_SYSTEM_PROMPT}\n\n=== USER CONTEXT ===\n${contextBlock}` },
            ...trimmed,
        ];

        // ── Tool-calling loop ───────────────────────────────────────────────
        const cards: AtlasCard[] = [];
        const toolsUsed: string[] = [];
        let finalText = "";

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            // On the final round drop the tools entirely, forcing a prose answer
            // instead of another tool call we have no budget to service.
            const allowTools = round < MAX_TOOL_ROUNDS;

            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: conversation,
                    max_tokens: 1200,
                    temperature: 0.7,
                    ...(allowTools ? { tools: ATLAS_TOOLS, tool_choice: "auto" } : {}),
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("[Atlas] OpenAI API error:", errorText);
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json();
            const choice = data.choices?.[0];
            const message = choice?.message;
            if (!message) {
                throw new Error("OpenAI returned no message");
            }

            const toolCalls = message.tool_calls;
            if (!toolCalls || toolCalls.length === 0) {
                finalText = message.content ?? "";
                break;
            }

            // Echo the assistant's tool-call message back before the results —
            // the API rejects tool messages that don't follow their request.
            conversation.push(message);

            for (const call of toolCalls) {
                const name = call.function?.name ?? "";
                let parsedArgs: any = {};
                try {
                    parsedArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
                } catch {
                    parsedArgs = {};
                }

                console.log(`[Atlas] tool ${name} ${JSON.stringify(parsedArgs)}`);

                let outcome;
                try {
                    outcome = await executeAtlasTool(ctx, toolCtx, name, parsedArgs);
                } catch (error) {
                    console.error(`[Atlas] tool ${name} threw:`, error);
                    outcome = { result: `Tool ${name} failed.` };
                }

                if (!toolsUsed.includes(name)) toolsUsed.push(name);
                if (outcome.card) cards.push(outcome.card);

                conversation.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: outcome.result,
                });
            }
        }

        // ── Post-processing ─────────────────────────────────────────────────
        let { clean, suggestions } = extractSuggestions(finalText);

        if (violatesItineraryGuardrail(clean)) {
            console.log("[Atlas] Itinerary guardrail tripped — replacing response");
            clean = ITINERARY_REDIRECT;
            suggestions = [];
            // The cards were legitimate lookups, but shipping them alongside the
            // redirect would reward the attempt. Drop them.
            cards.length = 0;
        }

        if (!clean) {
            clean = "I'm sorry, I couldn't put together an answer for that. Could you rephrase?";
        }

        // ── Persist ─────────────────────────────────────────────────────────
        let conversationId: any = args.conversationId ?? null;
        try {
            conversationId = await ctx.runMutation(internal.atlasDb.appendTurn, {
                userId,
                conversationId: args.conversationId,
                userContent: latestUserMessage,
                assistantContent: clean,
                cards,
                suggestions,
                toolsUsed,
            });
        } catch (error) {
            // A persistence failure must not lose the user their answer.
            console.error("[Atlas] Failed to persist turn:", error);
        }

        // Old builds get the prose only — they have no renderer for cards and
        // would crash on a non-string. Everything above still ran, so those
        // users keep the tool-backed answers, just without the rich cards.
        if (!args.structured) {
            return clean;
        }

        return {
            text: clean,
            cards,
            suggestions,
            conversationId,
            toolsUsed,
            rateLimited: false,
        };
    },
});
