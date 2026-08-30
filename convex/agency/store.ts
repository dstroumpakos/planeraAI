/**
 * Planera for Travel Agencies — Convex plumbing shared by every agency
 * function: environment access, session resolution, rate limiting and audit.
 *
 * The pure modules (`access`, `rateLimit`, `crypto`, `vault`) hold the policy;
 * this file is the only place that touches `ctx.db` for auth, so there is
 * exactly ONE implementation of "who is calling" and it cannot be bypassed by
 * forgetting a check in a handler.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  AccessError,
  resolveAccess,
  requireRole,
  type AgencyAuthStore,
  type AgencyRole,
  type MemberRow,
  type SessionRow,
  type UserRow,
} from "./access";
import { AgencyError, fromAccessError } from "./errors";
import {
  evaluateWindow,
  isLocked,
  registerFailure,
  registerSuccess,
  LIMITS,
  type LimitName,
  type RateWindowRow,
} from "./rateLimit";
import { sha256Hex } from "./crypto";

type AnyCtx = QueryCtx | MutationCtx;

// ── Environment ─────────────────────────────────────────────────────────────

/**
 * The vault master key. A missing key is a hard failure — never a silent
 * fallback to storing supplier credentials in the clear.
 */
export function vaultMasterKey(): string {
  const key = process.env.AGENCY_VAULT_MASTER_KEY;
  if (!key) {
    throw new AgencyError(
      "vault_unavailable",
      "supplier credentials are unavailable — contact support",
    );
  }
  return key;
}

/** Optional server-side password pepper. Undefined === the un-peppered scheme. */
export const authPepper = (): string | undefined => process.env.AGENCY_AUTH_PEPPER || undefined;

/** Public origin used to build customer quote links. */
export function quotePublicBaseUrl(): string {
  return (process.env.AGENCY_QUOTE_PUBLIC_BASE_URL || "https://planeraai.app").replace(/\/+$/, "");
}

// ── Session resolution ──────────────────────────────────────────────────────

/**
 * Reads the auth tables for the pure policy, caching the documents it fetches
 * so `requireAccess` can return typed ids without a second round-trip.
 */
class ConvexAuthStore implements AgencyAuthStore {
  sessionDoc: {
    _id: Id<"agencySessions">;
    agencyId: Id<"agencies">;
    userId: Id<"agencyUsers">;
  } | null = null;

  constructor(private ctx: AnyCtx) {}

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const doc = await this.ctx.db
      .query("agencySessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!doc) return null;
    this.sessionDoc = { _id: doc._id, agencyId: doc.agencyId, userId: doc.userId };
    return {
      userId: doc.userId,
      agencyId: doc.agencyId,
      tokenHash: doc.tokenHash,
      expiresAt: doc.expiresAt,
      mfaSatisfied: doc.mfaSatisfied,
      createdAt: doc.createdAt,
      lastSeenAt: doc.lastSeenAt,
      revokedAt: doc.revokedAt,
    };
  }

  async getUserById(userId: string): Promise<UserRow | null> {
    const doc = await this.ctx.db.get(userId as Id<"agencyUsers">);
    if (!doc) return null;
    return {
      _id: doc._id,
      status: doc.status,
      mfaEnabled: doc.mfaEnabled,
      sessionsValidFrom: doc.sessionsValidFrom,
    };
  }

  async getMember(agencyId: string, userId: string): Promise<MemberRow | null> {
    const doc = await this.ctx.db
      .query("agencyMembers")
      .withIndex("by_agency_user", (q) =>
        q.eq("agencyId", agencyId as Id<"agencies">).eq("userId", userId as Id<"agencyUsers">),
      )
      .unique();
    return doc ? { agencyId: doc.agencyId, userId: doc.userId, role: doc.role } : null;
  }
}

/** The caller, with Convex-typed ids. `agencyId` always comes from the session. */
export interface AgencyAccess {
  agencyId: Id<"agencies">;
  userId: Id<"agencyUsers">;
  role: AgencyRole;
  sessionId: Id<"agencySessions">;
}

/**
 * Resolve and authorise the caller. EVERY agency function starts here — there is
 * no other supported way to learn the caller's tenant.
 */
export async function requireAccess(
  ctx: AnyCtx,
  token: string | null | undefined,
  minRole?: AgencyRole,
): Promise<AgencyAccess> {
  const store = new ConvexAuthStore(ctx);
  let resolved;
  try {
    resolved = await resolveAccess(store, token);
    if (minRole) requireRole(resolved, minRole);
  } catch (e) {
    throw e instanceof AccessError ? fromAccessError(e) : e;
  }
  const session = store.sessionDoc!;
  return {
    agencyId: session.agencyId,
    userId: session.userId,
    role: resolved.role,
    sessionId: session._id,
  };
}

/**
 * Mutation-side variant that also refreshes the idle clock. Queries cannot
 * write, so the idle timer advances on writes and on `auth.touch`.
 */
export async function requireAccessRW(
  ctx: MutationCtx,
  token: string | null | undefined,
  minRole?: AgencyRole,
): Promise<AgencyAccess> {
  const access = await requireAccess(ctx, token, minRole);
  await ctx.db.patch(access.sessionId, { lastSeenAt: Date.now() });
  return access;
}

/**
 * Assert a fetched row belongs to the caller's tenant. Rows get looked up by id
 * all over the place; this is the guard that makes a leaked id useless.
 */
export function assertTenant(
  access: AgencyAccess,
  row: { agencyId: Id<"agencies"> } | null | undefined,
): void {
  if (!row || row.agencyId !== access.agencyId) {
    // Deliberately "not found", not "forbidden": probing ids must not reveal
    // that a resource exists inside someone else's tenant.
    throw new AgencyError("not_found", "resource not found");
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Rate-limit keys embed identities (emails, tokens), so they are hashed before
 * storage — the limiter table must never double as a list of customer emails.
 */
export async function rateKey(name: LimitName, identity: string): Promise<string> {
  return `${name}:${(await sha256Hex(identity)).slice(0, 32)}`;
}

async function readLimitRow(ctx: MutationCtx, key: string) {
  return await ctx.db
    .query("agencyRateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

async function writeLimitRow(
  ctx: MutationCtx,
  key: string,
  existingId: Id<"agencyRateLimits"> | undefined,
  next: RateWindowRow,
): Promise<void> {
  const patch = {
    windowStartAt: next.windowStartAt,
    count: next.count,
    blockedUntil: next.blockedUntil,
    failures: next.failures,
    updatedAt: Date.now(),
  };
  if (existingId) await ctx.db.patch(existingId, patch);
  else await ctx.db.insert("agencyRateLimits", { key, ...patch });
}

/**
 * Consume one unit of a named budget, throwing `rate_limited` when exhausted.
 * Always persists the new counter, including on the rejected call.
 */
export async function consumeLimit(
  ctx: MutationCtx,
  name: LimitName,
  identity: string,
): Promise<void> {
  const key = await rateKey(name, identity);
  const row = await readLimitRow(ctx, key);
  const decision = evaluateWindow(row, LIMITS[name], Date.now());
  await writeLimitRow(ctx, key, row?._id, decision.next);
  if (!decision.allowed) {
    throw new AgencyError(
      "rate_limited",
      "too many requests — please wait and try again",
      decision.retryAfterSec,
    );
  }
}

/** Throw if this identity is currently locked out after repeated failures. */
export async function assertNotLockedOut(ctx: MutationCtx, identity: string): Promise<void> {
  const key = await rateKey("login", `lock:${identity}`);
  const row = await readLimitRow(ctx, key);
  const locked = isLocked(row, Date.now());
  if (locked) {
    throw new AgencyError(
      "rate_limited",
      "too many failed attempts — try again shortly",
      locked.retryAfterSec,
    );
  }
}

export async function recordAuthFailure(ctx: MutationCtx, identity: string): Promise<void> {
  const key = await rateKey("login", `lock:${identity}`);
  const row = await readLimitRow(ctx, key);
  await writeLimitRow(ctx, key, row?._id, registerFailure(row, Date.now()));
}

export async function recordAuthSuccess(ctx: MutationCtx, identity: string): Promise<void> {
  const key = await rateKey("login", `lock:${identity}`);
  const row = await readLimitRow(ctx, key);
  await writeLimitRow(ctx, key, row?._id, registerSuccess(row, Date.now()));
}

// ── Audit ───────────────────────────────────────────────────────────────────

/** Keys whose values must never reach the audit log, whatever the caller sends. */
const SECRET_KEY_RE =
  /(password|secret|token|apikey|api_key|credential|authorization|cookie|signature|envelope)/i;

/**
 * Shallow-redact audit metadata. The audit trail is queryable by agency staff,
 * so it gets a value-level scrub rather than trusting every call site to be
 * careful about what it passes.
 */
export function redactMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(meta)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof val === "string") {
      out[k] = val.length > 200 ? `${val.slice(0, 200)}…` : val;
    } else if (val === null || typeof val === "number" || typeof val === "boolean") {
      out[k] = val;
    } else if (Array.isArray(val)) {
      out[k] = val.slice(0, 20).map((x) => (x !== null && typeof x === "object" ? "[object]" : x));
    } else if (typeof val === "object") {
      out[k] = "[object]";
    }
  }
  return out;
}

export interface AuditInput {
  agencyId: Id<"agencies">;
  actorUserId?: Id<"agencyUsers">;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

/** Append one audit row. Never throws into the caller's happy path. */
export async function audit(ctx: MutationCtx, input: AuditInput): Promise<void> {
  try {
    await ctx.db.insert("agencyAuditLog", {
      agencyId: input.agencyId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      meta: redactMeta(input.meta),
      at: Date.now(),
    });
  } catch (e) {
    console.error("[agency:audit] failed to write audit row", (e as Error)?.message);
  }
}
