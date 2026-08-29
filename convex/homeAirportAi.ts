/**
 * Base-airport resolution via OpenAI — the fallback for airports our own
 * dataset doesn't know.
 *
 * `lib/homeAirport.ts` resolves what it can offline: the airports in
 * `lib/airports.ts` plus every localized city name in the translation map. A
 * user who lives near a smaller field ("Kalamata", "Λάρνακα", "Podgorica")
 * falls through all of it — their typed text is stored verbatim, resolves to no
 * IATA code, and every feature that keys off the base airport (low-fare radar,
 * Explore origins, flight-search prefill, trip generation) silently sees
 * nothing.
 *
 * This module asks OpenAI for the nearest major commercial airport, then
 * rewrites the profile to the canonical label ("Kalamata, Greece KLX"), so the
 * stored value carries a real IATA code from then on.
 *
 * Two entry points:
 *   - `resolveBaseAirport`     — clients call it while saving, so the user sees
 *                                the corrected value immediately.
 *   - `resolveAndApplyForUser` — scheduled by `users.saveTravelPreferences` and
 *                                `users.updateTravelPreferences` after the
 *                                write. This is the backstop that covers every
 *                                client sharing this deployment (iOS, Android,
 *                                website) without any of them changing.
 *
 * Answers are cached in `iataResolutionCache` — the same table the destination
 * resolver in tripsActions.ts uses — so the same place never costs two calls.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import { authAction } from "./functions";
import { AIRPORTS } from "../lib/airports";
import {
    canonicalHomeAirport,
    formatHomeAirportLabel,
    hasNonLatinScript,
    needsAiHomeAirportLookup,
} from "../lib/homeAirport";

// The generated `internal` type only knows the modules that existed at the last
// codegen; same escape hatch the other Convex modules here use.
const internal = _internal as any;

const MODEL = process.env.AIRPORT_AI_MODEL || "gpt-4o-mini";

/** Longest free-text base airport we'll spend an OpenAI call on. */
const MAX_QUERY_LENGTH = 120;

type ResolvedAirport = {
    iata: string;
    label: string;
    city?: string;
    country?: string;
};

/**
 * Prefer our own dataset for naming: a cached row may predate the city/country
 * columns (the destination resolver only ever wrote `iata`), and AIRPORTS is
 * the wording the rest of the app displays.
 *
 * `typed` is what the user actually wrote. It's the last resort for when the
 * model answers with a code but no city — the 2026-08-25 backfill hit exactly
 * that on "Vadodara" and would otherwise have stored a bare "BDQ".
 */
function labelFor(
    parts: { iata: string; city?: string | null; country?: string | null },
    typed?: string,
): string {
    const known = AIRPORTS.find((a) => a.code === parts.iata);
    if (known) return `${known.city}, ${known.country} ${known.code}`;

    const label = formatHomeAirportLabel(parts);
    if (label !== parts.iata) return label;

    // Bare code. Keep the user's own wording if it's usable — "Vadodara BDQ"
    // beats "BDQ" in their profile, and both resolve to the same airport.
    const name = String(typed ?? "").trim();
    if (!name || hasNonLatinScript(name) || name.toUpperCase() === parts.iata) return label;
    if (name.toUpperCase().includes(parts.iata)) return name;
    return `${name} ${parts.iata}`;
}

// ================================ Cache ======================================

export const readAirportCache = internalQuery({
    args: { cityKey: v.string() },
    handler: async (ctx, { cityKey }) => {
        const row = await ctx.db
            .query("iataResolutionCache")
            .withIndex("by_cityKey", (q) => q.eq("cityKey", cityKey))
            .first();
        if (!row) return null;
        return { iata: row.iata, city: row.city ?? null, country: row.country ?? null };
    },
});

export const writeAirportCache = internalMutation({
    args: {
        cityKey: v.string(),
        iata: v.string(),
        city: v.optional(v.string()),
        country: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, { cityKey, iata, city, country }) => {
        const existing = await ctx.db
            .query("iataResolutionCache")
            .withIndex("by_cityKey", (q) => q.eq("cityKey", cityKey))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, { iata, city, country });
        } else {
            await ctx.db.insert("iataResolutionCache", {
                cityKey,
                iata,
                city,
                country,
                createdAt: Date.now(),
            });
        }
        return null;
    },
});

// ============================= OpenAI lookup =================================

/**
 * Ask OpenAI which airport a place flies out of. Returns null on every failure
 * mode (no key, network error, unparseable or low-confidence answer) — the
 * caller then keeps whatever the user typed rather than losing the setting.
 */
async function askOpenAi(raw: string): Promise<ResolvedAirport | null> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        console.warn("[homeAirportAi] OPENAI_API_KEY not set — skipping lookup");
        return null;
    }

    let response: Response;
    try {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                response_format: { type: "json_object" },
                // No `temperature`: the gpt-5 family rejects it, and the model
                // is env-switchable.
                max_completion_tokens: 200,
                messages: [
                    {
                        role: "system",
                        content:
                            "You map the place a traveler lives to the airport they depart from. " +
                            'Reply with ONLY a JSON object: {"iata":"XXX","city":"...","country":"..."}. ' +
                            "`iata` is the 3-letter IATA code of the nearest major commercial passenger " +
                            "airport (use the nearest hub when the place has no airport of its own). " +
                            "`city` and `country` name that airport's city and country, written in English. " +
                            'If the input is not a real place, or you are not confident, reply {"iata":"NONE"}.',
                    },
                    {
                        role: "user",
                        content: `Traveler's base airport or home city: ${raw}`,
                    },
                ],
            }),
        });
    } catch (err) {
        console.warn(
            `[homeAirportAi] OpenAI request failed for "${raw}": ${(err as Error).message}`,
        );
        return null;
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(
            `[homeAirportAi] OpenAI ${response.status} (model=${MODEL}): ${detail.slice(0, 300)}`,
        );
        return null;
    }

    let parsed: any;
    try {
        const result: any = await response.json();
        const content = result?.choices?.[0]?.message?.content;
        if (!content) return null;
        parsed = JSON.parse(content);
    } catch {
        console.warn(`[homeAirportAi] unparseable answer for "${raw}"`);
        return null;
    }

    const iata = String(parsed?.iata ?? "").trim().toUpperCase();
    // "NONE" is four letters, so this shape check also rejects the refusal.
    if (!/^[A-Z]{3}$/.test(iata)) {
        console.warn(`[homeAirportAi] no confident code for "${raw}" (got "${parsed?.iata}")`);
        return null;
    }

    // The label is stored and handed to flight APIs, so anything non-Latin the
    // model echoed back is dropped rather than written — the code alone is
    // still useful.
    const clean = (value: unknown): string | undefined => {
        const text = String(value ?? "").trim().slice(0, 60);
        if (!text || hasNonLatinScript(text)) return undefined;
        return text;
    };

    const city = clean(parsed?.city);
    const country = clean(parsed?.country);
    return { iata, city, country, label: labelFor({ iata, city, country }, raw) };
}

/**
 * Cache-first airport lookup. Shared by the public action, the post-save
 * backstop and the backfill.
 */
async function lookupAirport(ctx: any, raw: string): Promise<ResolvedAirport | null> {
    const trimmed = String(raw ?? "").trim();
    if (trimmed.length < 2 || trimmed.length > MAX_QUERY_LENGTH) return null;

    const cityKey = trimmed.toLowerCase();

    try {
        const cached = await ctx.runQuery(internal.homeAirportAi.readAirportCache, { cityKey });
        if (cached?.iata) {
            return {
                iata: cached.iata,
                city: cached.city ?? undefined,
                country: cached.country ?? undefined,
                label: labelFor(
                    { iata: cached.iata, city: cached.city, country: cached.country },
                    trimmed,
                ),
            };
        }
    } catch (err) {
        console.warn(`[homeAirportAi] cache read failed: ${(err as Error).message}`);
    }

    const resolved = await askOpenAi(trimmed);
    if (!resolved) return null;

    try {
        await ctx.runMutation(internal.homeAirportAi.writeAirportCache, {
            cityKey,
            iata: resolved.iata,
            city: resolved.city,
            country: resolved.country,
        });
    } catch (err) {
        console.warn(`[homeAirportAi] cache write failed: ${(err as Error).message}`);
    }

    return resolved;
}

// ============================== Entry points =================================

/**
 * Resolve a base airport the user is about to save.
 *
 * Offline resolution wins whenever it produces a code we actually know; OpenAI
 * is only asked about the leftovers. Returns null when even OpenAI can't place
 * the input — the client then keeps its existing behaviour for that case.
 */
export const resolveBaseAirport = authAction({
    args: {
        token: v.optional(v.string()),
        query: v.string(),
    },
    handler: async (ctx: any, args: any) => {
        const raw = String(args.query ?? "").trim();
        if (!raw) return null;

        const local = canonicalHomeAirport(raw);
        if (local && !needsAiHomeAirportLookup(raw)) {
            return { iata: local.iata, label: local.label, source: "local" as const };
        }

        const resolved = await lookupAirport(ctx, raw);
        if (resolved) {
            return { iata: resolved.iata, label: resolved.label, source: "ai" as const };
        }

        // OpenAI couldn't help either: fall back to whatever we resolved
        // offline (an unknown but code-shaped token) rather than to nothing.
        return local ? { iata: local.iata, label: local.label, source: "local" as const } : null;
    },
});

/**
 * Post-save backstop, scheduled from the preference mutations.
 *
 * Patches the profile only when the stored value is still the one we were asked
 * about, so a user who saved again in the meantime never gets their newer
 * airport overwritten by a stale lookup.
 */
export const resolveAndApplyForUser = internalAction({
    args: { userId: v.string(), raw: v.string() },
    returns: v.null(),
    handler: async (ctx, { userId, raw }) => {
        const resolved = await lookupAirport(ctx, raw);
        if (!resolved) return null;
        if (resolved.label === raw.trim()) return null;

        await ctx.runMutation(internal.users.applyResolvedHomeAirport, {
            userId,
            expected: raw,
            label: resolved.label,
        });
        console.log(`[homeAirportAi] ${userId}: "${raw}" → "${resolved.label}"`);
        return null;
    },
});

/**
 * One-off backfill for profiles saved before this existed. Dry run by default;
 * pass `apply: true` to write. Run it from the Convex dashboard:
 *
 *   homeAirportAi:backfillHomeAirports  { "apply": true, "limit": 100 }
 */
export const backfillHomeAirports = internalAction({
    args: {
        limit: v.optional(v.float64()),
        apply: v.optional(v.boolean()),
    },
    handler: async (ctx, { limit, apply }) => {
        const rows: Array<{ userId: string; homeAirport: string }> = await ctx.runQuery(
            internal.users.listHomeAirportsNeedingAi,
            { limit: limit ?? 50 },
        );

        const changed: Array<{ userId: string; from: string; to: string }> = [];
        const unresolved: Array<{ userId: string; value: string }> = [];

        for (const row of rows) {
            const resolved = await lookupAirport(ctx, row.homeAirport);
            if (!resolved || resolved.label === row.homeAirport.trim()) {
                unresolved.push({ userId: row.userId, value: row.homeAirport });
                continue;
            }
            changed.push({ userId: row.userId, from: row.homeAirport, to: resolved.label });
            if (apply) {
                await ctx.runMutation(internal.users.applyResolvedHomeAirport, {
                    userId: row.userId,
                    expected: row.homeAirport,
                    label: resolved.label,
                });
            }
        }

        return { applied: apply === true, scanned: rows.length, changed, unresolved };
    },
});
