import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWindow,
  isLocked,
  lockoutDurationMs,
  registerFailure,
  registerSuccess,
  LIMITS,
  LOCKOUT_BASE_MS,
  LOCKOUT_FREE_ATTEMPTS,
  LOCKOUT_MAX_MS,
  type RateWindowRow,
} from "../rateLimit";

const T0 = 1_700_000_000_000;
const spec = { limit: 3, windowMs: 60_000 };

test("first call in a fresh window is allowed and starts the counter", () => {
  const d = evaluateWindow(null, spec, T0);
  assert.equal(d.allowed, true);
  assert.equal(d.next.count, 1);
  assert.equal(d.next.windowStartAt, T0);
});

test("counts up to the limit, then rejects with a retry hint", () => {
  let row: RateWindowRow | null = null;
  for (let i = 0; i < spec.limit; i++) {
    const d = evaluateWindow(row, spec, T0);
    assert.equal(d.allowed, true, `call ${i + 1} should be allowed`);
    row = d.next;
  }
  const rejected = evaluateWindow(row, spec, T0);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSec, 60);
  // The rejected call must NOT inflate the counter further.
  assert.equal(rejected.next.count, spec.limit);
});

test("the window rolls over once it has elapsed", () => {
  const exhausted: RateWindowRow = { windowStartAt: T0, count: spec.limit };
  assert.equal(evaluateWindow(exhausted, spec, T0 + 59_999).allowed, false);
  const rolled = evaluateWindow(exhausted, spec, T0 + 60_000);
  assert.equal(rolled.allowed, true);
  assert.equal(rolled.next.count, 1);
  assert.equal(rolled.next.windowStartAt, T0 + 60_000);
});

test("an active block wins over an otherwise-fresh window", () => {
  const blocked: RateWindowRow = { windowStartAt: T0, count: 0, blockedUntil: T0 + 30_000 };
  const d = evaluateWindow(blocked, spec, T0 + 10_000);
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfterSec, 20);
});

test("a block that has passed no longer applies", () => {
  const stale: RateWindowRow = { windowStartAt: T0, count: 99, blockedUntil: T0 + 1000 };
  const d = evaluateWindow(stale, spec, T0 + 120_000);
  assert.equal(d.allowed, true);
  assert.equal(d.next.blockedUntil, undefined);
});

// ── Lockout ladder ──────────────────────────────────────────────────────────

test("the first few failures do not lock the account", () => {
  for (let n = 1; n <= LOCKOUT_FREE_ATTEMPTS; n++) {
    assert.equal(lockoutDurationMs(n), 0, `failure ${n} must not lock`);
  }
});

test("the ladder doubles from the base and is capped", () => {
  assert.equal(lockoutDurationMs(LOCKOUT_FREE_ATTEMPTS + 1), LOCKOUT_BASE_MS);
  assert.equal(lockoutDurationMs(LOCKOUT_FREE_ATTEMPTS + 2), LOCKOUT_BASE_MS * 2);
  assert.equal(lockoutDurationMs(LOCKOUT_FREE_ATTEMPTS + 3), LOCKOUT_BASE_MS * 4);
  // However determined the attacker, the real owner gets back in eventually.
  assert.equal(lockoutDurationMs(LOCKOUT_FREE_ATTEMPTS + 50), LOCKOUT_MAX_MS);
});

test("failures accumulate into a real block, and success clears it", () => {
  let row: RateWindowRow | null = null;
  for (let i = 0; i < LOCKOUT_FREE_ATTEMPTS + 1; i++) row = registerFailure(row, T0);
  assert.equal(row!.failures, LOCKOUT_FREE_ATTEMPTS + 1);
  assert.equal(row!.blockedUntil, T0 + LOCKOUT_BASE_MS);

  const locked = isLocked(row, T0 + 1000);
  assert.ok(locked, "should be locked while the block is in force");
  assert.equal(locked!.allowed, false);

  assert.equal(isLocked(row, T0 + LOCKOUT_BASE_MS + 1), null, "block expires on its own");

  const cleared = registerSuccess(row, T0);
  assert.equal(cleared.failures, 0);
  assert.equal(cleared.blockedUntil, undefined);
});

test("the named limits stay within sane bounds", () => {
  for (const [name, s] of Object.entries(LIMITS)) {
    assert.ok(s.limit > 0, `${name} limit must be positive`);
    assert.ok(s.windowMs >= 60_000, `${name} window must be at least a minute`);
  }
  // Supplier searches cost real money — they must be the tightest hourly budget
  // of the supplier-touching calls.
  assert.ok(LIMITS.search.limit < LIMITS.revalidate.limit);
});
