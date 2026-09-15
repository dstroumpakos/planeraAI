import { v } from "convex/values";
import { mutation, internalQuery } from "./_generated/server";

/**
 * Marketing / product funnel counters.
 *
 * `track` is public and unauthenticated on purpose: the surfaces worth counting
 * (the /explore tiles, the destination pages, the ChatGPT share pages) are all
 * anonymous, and requiring a session would silently drop exactly the top of the
 * funnel we are trying to measure.
 *
 * Nothing identifying is stored. A call increments ONE day bucket keyed by
 * (day, event, surface, variant) — see the `marketingEvents` table comment in
 * schema.ts — so the write volume is bounded by the number of distinct buckets
 * per day, not by traffic.
 */

// Anything not on this list is dropped. Keeping the vocabulary closed is what
// stops a stray call site from inventing a fifth spelling of "destination click"
// and quietly splitting a KPI in two.
const EVENTS = new Set([
  "destination_click",   // a destination tile / card was opened
  "destination_view",    // a destination detail surface was rendered
  "trip_start",          // the trip builder was opened
  "trip_created",        // a trip generation was submitted
  "onboarding_start",
  "onboarding_complete",
  "upgrade_view",        // the paywall was shown
  "signup_start",
  // Retention (see retention.ts). `surface` carries the platform for app_open
  // and the push `type` for notification_open, so the KPI cron can say which
  // notifications actually bring people back.
  "app_open",
  "notification_open",
  "watch_added",         // a destination fare watch was created (surface = where)
  "recap_view",          // the post-trip recap screen was opened
]);

// Surfaces are free-form (new pages appear all the time) but normalised and
// length-capped so the breakdown stays readable and one bad caller can't create
// unbounded buckets.
const SURFACE_MAX = 40;
const VARIANT_MAX = 24;

function slug(s: string, max: number): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export const track = mutation({
  args: {
    event: v.string(),
    surface: v.optional(v.string()),
    // A/B bucket. Absent when the surface isn't under test.
    variant: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!EVENTS.has(args.event)) {
      // Not an error: a client running older/newer code than the server should
      // never break because of a metric.
      return { ok: false as const, reason: "unknown_event" };
    }

    const surface = slug(args.surface ?? "unknown", SURFACE_MAX) || "unknown";
    const variantSlug = args.variant ? slug(args.variant, VARIANT_MAX) : "";
    const variant = variantSlug || undefined;

    const now = Date.now();
    const day = utcDay(now);

    const existing = await ctx.db
      .query("marketingEvents")
      .withIndex("by_day_event_surface_variant", (q) =>
        q
          .eq("day", day)
          .eq("event", args.event)
          .eq("surface", surface)
          .eq("variant", variant),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1, lastAt: now });
    } else {
      await ctx.db.insert("marketingEvents", {
        day,
        event: args.event,
        surface,
        variant,
        count: 1,
        lastAt: now,
      });
    }

    return { ok: true as const };
  },
});

/**
 * Every bucket from `sinceDay` (inclusive) onwards, for the KPI cron.
 *
 * Bounded by construction: one row per (day, event, surface, variant), so a
 * 30-day window is tens of rows, not a scan of the traffic.
 */
export const _bucketsSince = internalQuery({
  args: { sinceDay: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("marketingEvents")
      .withIndex("by_day", (q) => q.gte("day", args.sinceDay))
      .collect();
    return rows.map((r) => ({
      day: r.day,
      event: r.event,
      surface: r.surface,
      variant: r.variant ?? null,
      count: r.count,
    }));
  },
});
