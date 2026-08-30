/**
 * Planera for Travel Agencies — rate limiting & login lockout (pure).
 *
 * Fixed-window counters persisted in `agencyRateLimits`, one row per key. Kept
 * pure (no Convex imports) so the arithmetic — the part that is easy to get
 * subtly wrong — is unit-tested directly.
 *
 * Two shapes are used:
 *  - `evaluateWindow`  : generic "N calls per window" throttle (login attempts,
 *                        signups, searches, public quote views).
 *  - `evaluateLockout` : progressive backoff on repeated auth failures. Failures
 *                        accumulate; the lock doubles each time past a floor and
 *                        is capped, so a brute-forcer is stopped without a
 *                        permanent denial-of-service on the real owner.
 */

export interface RateWindowRow {
  /** Start of the current fixed window (epoch ms). */
  windowStartAt: number;
  /** Calls recorded in the current window. */
  count: number;
  /** Set while a lockout is in force (epoch ms). */
  blockedUntil?: number;
  /** Consecutive failures, for the lockout ladder. */
  failures?: number;
}

export interface RateDecision {
  allowed: boolean;
  /** The row to persist (always write it — it carries the incremented count). */
  next: RateWindowRow;
  retryAfterSec?: number;
}

export interface RateLimitSpec {
  /** Max calls allowed inside one window. */
  limit: number;
  windowMs: number;
}

/** Named limits, in one place so they are auditable. */
export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  signup: { limit: 3, windowMs: 60 * 60_000 },
  invite: { limit: 20, windowMs: 60 * 60_000 },
  acceptInvite: { limit: 10, windowMs: 60 * 60_000 },
  /** Supplier searches are the expensive call — the tightest tenant budget. */
  search: { limit: 60, windowMs: 60 * 60_000 },
  revalidate: { limit: 120, windowMs: 60 * 60_000 },
  connectionWrite: { limit: 30, windowMs: 60 * 60_000 },
  healthCheck: { limit: 60, windowMs: 60 * 60_000 },
  /** Guessing a customer quote link token. */
  publicQuote: { limit: 60, windowMs: 15 * 60_000 },
  mfa: { limit: 10, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitSpec>;

export type LimitName = keyof typeof LIMITS;

const ceilSec = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Generic fixed-window throttle. `row` is the stored row (or null on first
 * call). The returned `next` must always be persisted.
 */
export function evaluateWindow(
  row: RateWindowRow | null,
  spec: RateLimitSpec,
  now: number,
): RateDecision {
  if (row?.blockedUntil && row.blockedUntil > now) {
    return { allowed: false, next: row, retryAfterSec: ceilSec(row.blockedUntil - now) };
  }
  // Window rolled over (or never existed) → start a fresh one.
  if (!row || now - row.windowStartAt >= spec.windowMs) {
    return { allowed: true, next: { ...row, windowStartAt: now, count: 1, blockedUntil: undefined } };
  }
  if (row.count >= spec.limit) {
    const retryMs = row.windowStartAt + spec.windowMs - now;
    return { allowed: false, next: row, retryAfterSec: ceilSec(retryMs) };
  }
  return { allowed: true, next: { ...row, count: row.count + 1 } };
}

// ── Login lockout ────────────────────────────────────────────────────────────

/** Failures tolerated before the ladder starts. */
export const LOCKOUT_FREE_ATTEMPTS = 5;
/** First lock length once the ladder starts. */
export const LOCKOUT_BASE_MS = 60_000;
/** Hard ceiling so a legitimate owner is never locked out for a whole day. */
export const LOCKOUT_MAX_MS = 30 * 60_000;

/** How long the Nth consecutive failure locks the account for. */
export function lockoutDurationMs(failures: number): number {
  if (failures <= LOCKOUT_FREE_ATTEMPTS) return 0;
  const step = failures - LOCKOUT_FREE_ATTEMPTS - 1;
  return Math.min(LOCKOUT_BASE_MS * Math.pow(2, step), LOCKOUT_MAX_MS);
}

/** Called BEFORE verifying a password: is this identity currently locked? */
export function isLocked(row: RateWindowRow | null, now: number): RateDecision | null {
  if (row?.blockedUntil && row.blockedUntil > now) {
    return { allowed: false, next: row, retryAfterSec: ceilSec(row.blockedUntil - now) };
  }
  return null;
}

/** Called after a FAILED attempt. Returns the row to persist. */
export function registerFailure(row: RateWindowRow | null, now: number): RateWindowRow {
  const failures = (row?.failures ?? 0) + 1;
  const lock = lockoutDurationMs(failures);
  return {
    windowStartAt: row?.windowStartAt ?? now,
    count: row?.count ?? 0,
    failures,
    blockedUntil: lock > 0 ? now + lock : undefined,
  };
}

/** Called after a SUCCESSFUL attempt — clears the ladder, keeps the window. */
export function registerSuccess(row: RateWindowRow | null, now: number): RateWindowRow {
  return {
    windowStartAt: row?.windowStartAt ?? now,
    count: row?.count ?? 0,
    failures: 0,
    blockedUntil: undefined,
  };
}
