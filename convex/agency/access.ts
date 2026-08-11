/**
 * Planera for Travel Agencies — access control & tenant scoping (pure policy).
 *
 * The single source of truth for "who is this caller and what may they do".
 * Convex mutations/queries call `resolveAccess` with the raw session token; the
 * resolved `agencyId` comes from the SESSION, never from client input. Every
 * data access must then be filtered/asserted against that `agencyId` — see
 * `assertSameTenant`.
 *
 * This module is pure: it talks to storage through the small `AgencyAuthStore`
 * interface, so tenant-isolation is unit-testable with an in-memory fake.
 */

import { sha256Hex, constantTimeEqualHex } from "./crypto";

export type AgencyRole = "owner" | "manager" | "agent" | "viewer";

const ROLE_RANK: Record<AgencyRole, number> = { viewer: 0, agent: 1, manager: 2, owner: 3 };

/** True if `role` is at least `min` in the hierarchy. */
export function hasAtLeast(role: AgencyRole, min: AgencyRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Capability matrix — keep authorization decisions here, not scattered in handlers. */
export const Permissions = {
  manageMembers: (r: AgencyRole) => hasAtLeast(r, "owner"),
  manageConnections: (r: AgencyRole) => hasAtLeast(r, "manager"),
  managePricing: (r: AgencyRole) => hasAtLeast(r, "manager"),
  createQuote: (r: AgencyRole) => hasAtLeast(r, "agent"),
  sendQuote: (r: AgencyRole) => hasAtLeast(r, "agent"),
  viewQuotes: (r: AgencyRole) => hasAtLeast(r, "viewer"),
} as const;

// ── Storage shapes the policy needs (minimal projections of the tables) ──────

export interface SessionRow {
  userId: string;
  agencyId: string;
  tokenHash: string;
  expiresAt: number;
  mfaSatisfied?: boolean;
}
export interface UserRow {
  _id: string;
  status: "invited" | "active" | "disabled";
  mfaEnabled?: boolean;
}
export interface MemberRow {
  agencyId: string;
  userId: string;
  role: AgencyRole;
}

export interface AgencyAuthStore {
  getSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  getUserById(userId: string): Promise<UserRow | null>;
  getMember(agencyId: string, userId: string): Promise<MemberRow | null>;
}

export interface AccessContext {
  agencyId: string;
  userId: string;
  role: AgencyRole;
}

export class AccessError extends Error {
  constructor(public code: "unauthenticated" | "forbidden" | "mfa_required", message: string) {
    super(message);
  }
}

/**
 * Resolve the caller from a raw session token. Enforces: session exists, not
 * expired, user active, membership exists, and MFA satisfied when the user has
 * MFA enabled. Returns the tenant-scoped context (agencyId from the session).
 */
export async function resolveAccess(
  store: AgencyAuthStore,
  rawToken: string | null | undefined,
  now: number = Date.now(),
): Promise<AccessContext> {
  if (!rawToken) throw new AccessError("unauthenticated", "missing session token");
  const tokenHash = await sha256Hex(rawToken);
  const session = await store.getSessionByTokenHash(tokenHash);
  // Compare again in constant time to avoid any early-exit signal on lookups.
  if (!session || !constantTimeEqualHex(session.tokenHash, tokenHash)) {
    throw new AccessError("unauthenticated", "invalid session");
  }
  if (session.expiresAt <= now) throw new AccessError("unauthenticated", "session expired");

  const user = await store.getUserById(session.userId);
  if (!user || user.status !== "active") throw new AccessError("unauthenticated", "user not active");
  if (user.mfaEnabled && !session.mfaSatisfied) {
    throw new AccessError("mfa_required", "second factor required");
  }

  const member = await store.getMember(session.agencyId, session.userId);
  if (!member) throw new AccessError("forbidden", "not a member of this agency");

  return { agencyId: session.agencyId, userId: session.userId, role: member.role };
}

/** Throw unless the caller holds at least `min` in their agency. */
export function requireRole(ctx: AccessContext, min: AgencyRole): void {
  if (!hasAtLeast(ctx.role, min)) {
    throw new AccessError("forbidden", `requires role >= ${min}`);
  }
}

/**
 * THE tenant-isolation guard. Throw if a resource's owning agency differs from
 * the caller's agency. Call this on EVERY row fetched by id.
 */
export function assertSameTenant(ctx: AccessContext, resourceAgencyId: string): void {
  if (ctx.agencyId !== resourceAgencyId) {
    throw new AccessError("forbidden", "cross-tenant access denied");
  }
}
