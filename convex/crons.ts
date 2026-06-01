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

export default crons;
