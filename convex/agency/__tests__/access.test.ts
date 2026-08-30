import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAccess, assertSameTenant, requireRole, hasAtLeast, Permissions, AccessError, IDLE_TIMEOUT_MS,
  type AgencyAuthStore, type SessionRow, type UserRow, type MemberRow,
} from "../access";
import { sha256Hex } from "../crypto";

// In-memory fake of the tables the policy reads.
class FakeStore implements AgencyAuthStore {
  sessions = new Map<string, SessionRow>();
  users = new Map<string, UserRow>();
  members = new Map<string, MemberRow>();
  async getSessionByTokenHash(h: string) { return this.sessions.get(h) ?? null; }
  async getUserById(id: string) { return this.users.get(id) ?? null; }
  async getMember(agencyId: string, userId: string) { return this.members.get(`${agencyId}:${userId}`) ?? null; }
}

const HOUR = 3600_000;
async function seed() {
  const s = new FakeStore();
  const now = Date.now();
  const hA = await sha256Hex("tokA");
  const hB = await sha256Hex("tokB");
  s.sessions.set(hA, { userId: "uA", agencyId: "agA", tokenHash: hA, expiresAt: now + HOUR });
  s.sessions.set(hB, { userId: "uB", agencyId: "agB", tokenHash: hB, expiresAt: now + HOUR });
  s.users.set("uA", { _id: "uA", status: "active" });
  s.users.set("uB", { _id: "uB", status: "active" });
  s.members.set("agA:uA", { agencyId: "agA", userId: "uA", role: "agent" });
  s.members.set("agB:uB", { agencyId: "agB", userId: "uB", role: "owner" });
  return s;
}

test("resolves the tenant context from a valid session (agencyId from session, not input)", async () => {
  const s = await seed();
  const ctx = await resolveAccess(s, "tokA");
  assert.equal(ctx.agencyId, "agA");
  assert.equal(ctx.userId, "uA");
  assert.equal(ctx.role, "agent");
});

test("TENANT ISOLATION: caller in agency A cannot touch an agency B resource", async () => {
  const s = await seed();
  const ctxA = await resolveAccess(s, "tokA");
  assert.doesNotThrow(() => assertSameTenant(ctxA, "agA"));
  assert.throws(() => assertSameTenant(ctxA, "agB"), (e) => e instanceof AccessError && e.code === "forbidden");
});

test("invalid / missing token is unauthenticated", async () => {
  const s = await seed();
  await assert.rejects(() => resolveAccess(s, "nope"), (e) => e instanceof AccessError && e.code === "unauthenticated");
  await assert.rejects(() => resolveAccess(s, null), (e) => e instanceof AccessError && e.code === "unauthenticated");
});

test("expired session is rejected", async () => {
  const s = await seed();
  const h = await sha256Hex("tokA");
  s.sessions.get(h)!.expiresAt = Date.now() - 1;
  await assert.rejects(() => resolveAccess(s, "tokA"), /expired/);
});

test("disabled user is rejected", async () => {
  const s = await seed();
  s.users.get("uA")!.status = "disabled";
  await assert.rejects(() => resolveAccess(s, "tokA"), (e) => e instanceof AccessError && e.code === "unauthenticated");
});

test("MFA-enabled user without a satisfied second factor is blocked", async () => {
  const s = await seed();
  s.users.get("uA")!.mfaEnabled = true; // session.mfaSatisfied is undefined
  await assert.rejects(() => resolveAccess(s, "tokA"), (e) => e instanceof AccessError && e.code === "mfa_required");
  // once satisfied, it resolves
  const h = await sha256Hex("tokA");
  s.sessions.get(h)!.mfaSatisfied = true;
  const ctx = await resolveAccess(s, "tokA");
  assert.equal(ctx.role, "agent");
});

test("role hierarchy + permission matrix", async () => {
  assert.ok(hasAtLeast("owner", "agent"));
  assert.ok(!hasAtLeast("viewer", "agent"));
  const s = await seed();
  const ctxA = await resolveAccess(s, "tokA"); // agent
  assert.throws(() => requireRole(ctxA, "manager"), /role >= manager/);
  assert.doesNotThrow(() => requireRole(ctxA, "viewer"));
  assert.ok(Permissions.createQuote("agent"));
  assert.ok(!Permissions.manageConnections("agent"));
  assert.ok(Permissions.manageConnections("manager"));
  assert.ok(!Permissions.manageMembers("manager"));
  assert.ok(Permissions.manageMembers("owner"));
});

// ── Session hardening (idle timeout, revocation, credential cut-off) ─────────

test("an explicitly revoked session is dead even before it expires", async () => {
  const s = await seed();
  const h = await sha256Hex("tokA");
  s.sessions.get(h)!.revokedAt = Date.now();
  await assert.rejects(
    () => resolveAccess(s, "tokA"),
    (e) => e instanceof AccessError && e.code === "unauthenticated",
  );
});

test("a session idle past the timeout stops resolving", async () => {
  const s = await seed();
  const h = await sha256Hex("tokA");
  const now = Date.now();
  // Still inside the absolute expiry, but untouched for longer than the idle cap.
  s.sessions.get(h)!.expiresAt = now + 30 * HOUR;
  s.sessions.get(h)!.lastSeenAt = now - IDLE_TIMEOUT_MS - 1000;
  await assert.rejects(
    () => resolveAccess(s, "tokA"),
    (e) => e instanceof AccessError && e.code === "unauthenticated",
  );

  // A session used recently is fine.
  s.sessions.get(h)!.lastSeenAt = now - 1000;
  const ctx = await resolveAccess(s, "tokA");
  assert.equal(ctx.agencyId, "agA");
});

test("changing credentials kills every session issued before the change", async () => {
  const s = await seed();
  const h = await sha256Hex("tokA");
  const now = Date.now();
  s.sessions.get(h)!.createdAt = now - HOUR;

  // Password changed five minutes ago → this older session is superseded.
  s.users.get("uA")!.sessionsValidFrom = now - 5 * 60_000;
  await assert.rejects(
    () => resolveAccess(s, "tokA"),
    (e) => e instanceof AccessError && e.code === "unauthenticated",
  );

  // A session minted after the change survives.
  s.sessions.get(h)!.createdAt = now;
  assert.equal((await resolveAccess(s, "tokA")).userId, "uA");
});

test("a disabled user cannot resolve, even holding a valid token", async () => {
  const s = await seed();
  s.users.get("uA")!.status = "disabled";
  await assert.rejects(
    () => resolveAccess(s, "tokA"),
    (e) => e instanceof AccessError && e.code === "unauthenticated",
  );
});

test("losing membership revokes access to the tenant", async () => {
  const s = await seed();
  s.members.delete("agA:uA");
  await assert.rejects(
    () => resolveAccess(s, "tokA"),
    (e) => e instanceof AccessError && e.code === "forbidden",
  );
});
