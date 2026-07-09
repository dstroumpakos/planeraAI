import { cronJobs } from "convex/server";
import { internal as _internal } from "./_generated/api";

// Type assertion: `internal.notifications` won't exist until `npx convex dev` regenerates types
const internal = _internal as any;

const crons = cronJobs();

// Run notification checks every hour
// This covers countdown reminders, morning briefings, post-trip reviews, and anniversary notifications
crons.interval(
    "process-notifications",
    { hours: 1 },
    internal.notifications.processScheduledNotifications,
);

// Soft-delete expired deals after 24 hours
crons.interval(
    "soft-delete-expired-deals",
    { hours: 1 },
    internal.lowFareRadar.softDeleteExpiredDeals,
);

// Low-Fare Radar price refresh. Tick hourly; the tick re-prices manually-added
// (curated) deals via the searchapi.io Google Flights API only when the
// DB-tracked countdown (`nextRefreshAt`, every 4 days) is due. Tracking the due
// time in the DB — rather than relying on the fixed cron cadence — lets the
// admin widget show an accurate countdown and reset it with "refresh now".
// AUTO-seeded deals are excluded (they refresh via search seeding and age out).
crons.interval(
    "refresh-low-fare-radar-prices",
    { hours: 1 },
    internal.lowFareRadarRefresh.radarRefreshTick,
    {},
);

// Watchdog: mark trips stuck in "generating" (>10 min) as failed.
// Catches Convex platform-level transient errors that prevent the
// generate action from ever running.
crons.interval(
    "fail-stuck-generating-trips",
    { minutes: 5 },
    internal.trips.failStuckGeneratingTrips,
);

// Re-verify auto-renewing Apple subscriptions at/near expiry so paying
// monthly subscribers keep premium (no server-to-server notifications wired).
crons.interval(
    "refresh-apple-subscriptions",
    { hours: 6 },
    internal.iapVerify.refreshExpiringSubscriptions,
);

// Partner API: fill the pre-generation "budget" from real demand. Every live
// (cache-miss) generation records the requested city + duration; this job
// pre-builds the other common durations for the most-requested cities so future
// requests are served instantly from cache.
crons.interval(
    "partner-pregenerate-demand",
    { hours: 12 },
    internal.partnerPregenerate.pregenerateDemanded,
    {},
);

// Publish SEO itineraries: daily, aggregate destinations that have enough real
// completed trips into curated public itineraries (written as drafts pending
// approval). Daily cadence batches the OpenAI cost.
crons.interval(
    "publish-pending-aggregations",
    { hours: 24 },
    internal.publishedItinerariesActions.publishPendingAggregations,
    {},
);

// Recompute cached public landing-page stats (trips/users/destinations counts)
// so the public query reads a singleton instead of scanning the trips table.
crons.interval(
    "recompute-landing-stats",
    { hours: 1 },
    internal.publicStats.recomputeLandingStats,
    {},
);

// Recompute the admin-dashboard KPI singleton (trips/users/subs/insights/leads
// /affiliate/partner aggregates + 30-day time series) so the admin dashboard
// reads one small doc instead of scanning the large tables on every load.
crons.interval(
    "recompute-admin-kpis",
    { hours: 1 },
    internal.adminKpis.recomputeAdminKpis,
    {},
);

// Newsletter funnel: walk active subscribers through the drip sequence, one
// email every few days. The per-subscriber cadence is tracked in the DB
// (`lastEmailSentAt`), so ticking every 12h just picks up whoever is due.
crons.interval(
    "process-newsletter-drip",
    { hours: 12 },
    internal.newsletter.processNewsletterDrip,
    {},
);

export default crons;
