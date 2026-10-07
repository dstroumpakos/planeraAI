/**
 * Pure helpers for the notification inbox and deal-alert targeting.
 *
 * No Convex imports, so `scripts/test-notification-inbox.ts` can exercise them
 * with plain `npx tsx`.
 */
import { resolveHomeIata } from "../../lib/homeAirport";

export type InboxCategory = "deals" | "trips" | "account" | "general";

/** Bucket a notificationLog `type` for the inbox filter chips and icon. */
export function inboxCategory(type: string): InboxCategory {
    if (type.startsWith("deal") || type === "first_trip_nudge") return "deals";
    if (
        type.startsWith("countdown") ||
        type.startsWith("morning_briefing") ||
        type.startsWith("location_") ||
        type.startsWith("trip_") ||
        type.startsWith("collab_") ||
        type === "post_trip_review" ||
        type === "plan_next" ||
        type === "anniversary"
    ) {
        return "trips";
    }
    if (type.startsWith("credit") || type.startsWith("streak") || type.startsWith("premium")) {
        return "account";
    }
    return "general";
}

/**
 * Only unread rows newer than this count towards the badge. Every row written
 * before the inbox existed has no `readAt`, so without a window a long-time
 * user would open the app to a badge of every push we ever sent them.
 */
export const INBOX_UNREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Badge numbers above this render as "99+". */
export const INBOX_UNREAD_CAP = 99;

/**
 * Push payload keys the inbox keeps. The client routes on these exactly like a
 * push tap (lib/useNotifications.ts → handleNotificationTap); anything else is
 * dropped so arbitrary payloads never reach the inbox list.
 */
const INBOX_DATA_KEYS = [
    "screen",
    "tripId",
    "dealId",
    "broadcastId",
    "origin",
    "originCity",
    "destination",
    "destinationCity",
    // Fare quoted in a deal alert — the price-drop cooldown compares against it.
    "price",
] as const;

export function inboxData(data: unknown): Record<string, string> | undefined {
    if (!data || typeof data !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const k of INBOX_DATA_KEYS) {
        const val = (data as Record<string, unknown>)[k];
        if (typeof val === "string" && val) out[k] = val;
        else if (typeof val === "number") out[k] = String(val);
    }
    return Object.keys(out).length ? out : undefined;
}

/**
 * Does this user's home ("base") airport match the deal's origin?
 *
 * Same rule the app uses to decide which deals a user sees at all
 * (`lowFareRadar.getDealsForUser`: deals indexed by origin === resolved home
 * IATA), so a deal alert always points at a deal that is actually in the
 * user's own radar. Users without a resolvable home airport never match.
 */
export function homeAirportMatchesOrigin(
    homeAirport: string | undefined | null,
    origin: string | undefined | null,
): boolean {
    if (!origin) return false;
    const home = resolveHomeIata(homeAirport);
    return !!home && home === origin.trim().toUpperCase();
}

/**
 * A price refresh that shaves €2 off a fare is not news. Notify only when the
 * drop is at least `PRICE_DROP_MIN_ABS` currency units AND at least
 * `PRICE_DROP_MIN_PCT` of the old price.
 */
export const PRICE_DROP_MIN_ABS = 5;
export const PRICE_DROP_MIN_PCT = 0.03;

export function isNotablePriceDrop(oldPrice: number, newPrice: number): boolean {
    if (!(oldPrice > 0) || !(newPrice > 0) || newPrice >= oldPrice) return false;
    const drop = oldPrice - newPrice;
    return drop >= PRICE_DROP_MIN_ABS && drop / oldPrice >= PRICE_DROP_MIN_PCT;
}

/** Don't re-alert the same user about the same deal within this window. */
export const PRICE_DROP_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

// ─── Admin open-rate counters (notificationStats) ───

/** UTC day key, e.g. "2026-10-06". */
export function statsDay(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Collapse per-instance types so the admin table groups them:
 * morning_briefing_day3 → morning_briefing, collab_joined_<userId> → collab_joined.
 * Same collapsing the app applies to its `notification_open` marketing event.
 */
export function statsType(type: string): string {
    return type.replace(/_day\d+$/, "").replace(/^collab_joined_.*/, "collab_joined");
}

/** Counter-row key for one notification: deal pushes are also split per deal. */
export function statsKey(type: string, sentAt: number, data: unknown): {
    day: string;
    type: string;
    dealId?: string;
    route?: string;
} {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const dealId = typeof d.dealId === "string" && d.dealId ? d.dealId : undefined;
    const origin = typeof d.origin === "string" ? d.origin : "";
    const destination = typeof d.destination === "string" ? d.destination : "";
    return {
        day: statsDay(sentAt),
        type: statsType(type),
        ...(dealId ? { dealId } : {}),
        ...(dealId && origin && destination ? { route: `${origin} → ${destination}` } : {}),
    };
}
