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

export default crons;
