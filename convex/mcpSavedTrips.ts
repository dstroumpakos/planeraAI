/**
 * Saved trips handed off from the ChatGPT App (Apps SDK / MCP) to the web.
 *
 * Why this exists: a ChatGPT conversation is a dead end — the user gets a great
 * trip card and then has nowhere to put it. `save` persists the card the MCP
 * server already assembled and returns an unguessable slug, so the assistant
 * can answer with a real link (`/t/<slug>`) that outlives the conversation.
 *
 * Access model: there is no user session in ChatGPT, so the slug IS the
 * credential (a capability URL). Consequences, deliberately accepted:
 *   - anyone with the link can view the trip; do not store anything private
 *     beyond the trip itself,
 *   - `get` is a public query but only ever resolves an exact slug — there is
 *     no list/enumerate query on this table for public callers.
 *
 * Fares and nightly rates are stored as a point-in-time SNAPSHOT and are never
 * re-priced on read. `capturedAt` is returned so the page can say how old the
 * quote is rather than implying it is still bookable at that price.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

// Slug alphabet excludes look-alike characters (0/O, 1/l/I) so a slug read off
// a screen or a phone call transcribes cleanly.
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 12; // ~59 bits — not enumerable at any realistic rate

function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return out;
}

const MAX_PAYLOAD_BYTES = 200_000;

/**
 * Persist a trip card and return its share slug.
 *
 * Public and account-free: called by the MCP server on the user's behalf. Rate
 * limiting is enforced upstream (per-caller, in the MCP server) — this mutation
 * only guards size and shape.
 */
export const save = mutation({
  args: {
    destination: v.string(),
    days: v.float64(),
    payload: v.any(),
    language: v.optional(v.string()),
    currency: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.object({ slug: v.string(), url: v.string() }),
  handler: async (ctx, args) => {
    const destination = args.destination.trim();
    if (!destination) throw new ConvexError("A destination is required.");
    if (!(args.days >= 1 && args.days <= 30)) {
      throw new ConvexError("Trip length must be between 1 and 30 days.");
    }
    if (args.payload == null || typeof args.payload !== "object") {
      throw new ConvexError("A trip payload is required.");
    }
    // Cheap guard against a runaway card being used as free blob storage.
    if (JSON.stringify(args.payload).length > MAX_PAYLOAD_BYTES) {
      throw new ConvexError("This trip is too large to save.");
    }

    // Retry on the astronomically unlikely slug collision rather than
    // overwriting somebody else's trip.
    let slug = randomSlug();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("mcpSavedTrips")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!clash) break;
      slug = randomSlug();
    }

    await ctx.db.insert("mcpSavedTrips", {
      slug,
      destination,
      days: args.days,
      language: args.language,
      currency: args.currency,
      payload: args.payload,
      email: args.email ? args.email.trim().toLowerCase() : undefined,
      views: 0,
      createdAt: Date.now(),
    });

    return { slug, url: `https://www.planeraai.app/t/${slug}` };
  },
});

/**
 * Resolve a share slug. Returns null (not an error) for unknown slugs so the
 * web page can render a friendly "this link expired" state, and so probing
 * cannot distinguish "wrong slug" from "server error".
 */
export const get = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      destination: v.string(),
      days: v.float64(),
      language: v.optional(v.string()),
      currency: v.optional(v.string()),
      payload: v.any(),
      capturedAt: v.float64(),
    })
  ),
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    if (!slug) return null;

    const row = await ctx.db
      .query("mcpSavedTrips")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) return null;

    // Note: view counting is intentionally NOT done here — queries must stay
    // side-effect free (and cacheable). Call `recordView` from the page if the
    // count matters.
    return {
      destination: row.destination,
      days: row.days,
      language: row.language,
      currency: row.currency,
      payload: row.payload,
      capturedAt: row.createdAt,
    };
  },
});

/** Fire-and-forget view counter for the share page. Never throws on unknown slugs. */
export const recordView = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpSavedTrips")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();
    if (!row) return null;
    await ctx.db.patch(row._id, {
      views: row.views + 1,
      lastViewedAt: Date.now(),
    });
    return null;
  },
});
