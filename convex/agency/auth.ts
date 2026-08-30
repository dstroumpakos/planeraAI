/**
 * Planera for Travel Agencies — agency staff authentication & membership.
 *
 * A third account kind alongside consumer `users` and `partnerAccounts`. Thin
 * adapters over the pure modules: `validation` (meaning), `crypto` (hashing),
 * `access` (policy), `rateLimit` (abuse), `totp` (second factor), `vault`
 * (sealing the TOTP secret).
 *
 * Invariants enforced here:
 *  - `agencyId` is NEVER read from client input — only from a resolved session.
 *  - Login answers identically for "no such email" and "wrong password", and
 *    burns comparable CPU either way, so it cannot be used to enumerate users.
 *  - Raw tokens (session, invite, recovery) exist only in the response that
 *    mints them; the database stores SHA-256 hashes.
 *  - Any credential change bumps `sessionsValidFrom`, killing every session
 *    issued earlier — one action revokes a stolen token everywhere.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { agencyRole } from "./schema";
import { Permissions, type AgencyRole } from "./access";
import {
  fakeVerifyDelay,
  hashPassword,
  newToken,
  sha256Hex,
  verifyPassword,
} from "./crypto";
import { AgencyError, conflict, forbidden, guard, invalid, notFound } from "./errors";
import {
  assertNotLockedOut,
  audit,
  authPepper,
  consumeLimit,
  quotePublicBaseUrl,
  recordAuthFailure,
  recordAuthSuccess,
  requireAccess,
  requireAccessRW,
  vaultMasterKey,
} from "./store";
import {
  assertPasswordPolicy,
  normalizeAgencyName,
  normalizeCurrency,
  normalizeEmail,
  slugify,
} from "./validation";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp";
import { openJson, sealJson } from "./vault";

/** Absolute session lifetime. Idle timeout (8h) is enforced in `access.ts`. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sendEmailRef = makeFunctionReference<
  "action",
  { to: string; subject: string; html: string; text?: string },
  { success: boolean; messageId?: string; error?: string }
>("emails:sendEmail");

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Mint a session. Returns the RAW token — the only time it exists outside the
 * caller's browser.
 */
async function createSession(
  ctx: { db: any },
  userId: Id<"agencyUsers">,
  agencyId: Id<"agencies">,
  mfaSatisfied: boolean,
): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await ctx.db.insert("agencySessions", {
    userId,
    agencyId,
    tokenHash: await sha256Hex(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    mfaSatisfied,
  });
  return { token, expiresAt };
}

/** Revoke every live session for a user (used on credential changes). */
async function revokeAllSessions(ctx: { db: any }, userId: Id<"agencyUsers">): Promise<void> {
  const sessions = await ctx.db
    .query("agencySessions")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  for (const s of sessions) {
    if (!s.revokedAt) await ctx.db.patch(s._id, { revokedAt: now });
  }
}

/** A slug nobody else holds. Collisions get a numeric suffix, not an error. */
async function uniqueSlug(ctx: { db: any }, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await ctx.db
      .query("agencies")
      .withIndex("by_slug", (q: any) => q.eq("slug", candidate))
      .unique();
    if (!existing) return candidate;
  }
  return `${base}-${newToken().slice(0, 6).toLowerCase()}`;
}

const publicUser = (user: any, role: AgencyRole, displayName?: string) => ({
  userId: user._id as Id<"agencyUsers">,
  email: user.email as string,
  displayName: displayName ?? null,
  role,
  mfaEnabled: !!user.mfaEnabled,
  lastLoginAt: user.lastLoginAt ?? null,
});

const publicAgency = (agency: any) => ({
  agencyId: agency._id as Id<"agencies">,
  name: agency.name as string,
  slug: agency.slug as string,
  status: agency.status as "active" | "suspended",
  defaultCurrency: agency.defaultCurrency as string,
  branding: agency.branding ?? null,
});

// ── Registration ────────────────────────────────────────────────────────────

/**
 * Self-serve tenant creation: agency + owner + first session, atomically.
 * Rate-limited per email address so the endpoint cannot be used to mass-create
 * tenants.
 */
export const registerAgency = mutation({
  args: {
    agencyName: v.string(),
    email: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
    defaultCurrency: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("registerAgency", async () => {
      const email = normalizeEmail(args.email);
      const name = normalizeAgencyName(args.agencyName);
      assertPasswordPolicy(args.password, email);
      const currency = args.defaultCurrency ? normalizeCurrency(args.defaultCurrency) : "EUR";

      await consumeLimit(ctx, "signup", email);

      const existing = await ctx.db
        .query("agencyUsers")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existing) throw conflict("an account with this email already exists");

      const now = Date.now();
      const agencyId = await ctx.db.insert("agencies", {
        name,
        slug: await uniqueSlug(ctx, slugify(name)),
        status: "active",
        defaultCurrency: currency,
        createdAt: now,
      });

      const pw = await hashPassword(args.password, authPepper());
      const userId = await ctx.db.insert("agencyUsers", {
        email,
        passwordHash: pw.hash,
        passwordSalt: pw.salt,
        status: "active",
        passwordUpdatedAt: now,
        lastLoginAt: now,
        createdAt: now,
      });
      await ctx.db.insert("agencyMembers", {
        agencyId,
        userId,
        role: "owner",
        displayName: args.displayName?.trim().slice(0, 80) || undefined,
        createdAt: now,
      });

      const session = await createSession(ctx, userId, agencyId, true);
      await audit(ctx, {
        agencyId,
        actorUserId: userId,
        action: "auth.registerAgency",
        targetType: "agency",
        targetId: agencyId,
        meta: { agencyName: name },
      });

      const agency = await ctx.db.get(agencyId);
      const user = await ctx.db.get(userId);
      return {
        ...session,
        agency: publicAgency(agency),
        me: publicUser(user, "owner", args.displayName),
      };
    }),
});

// ── Login ───────────────────────────────────────────────────────────────────

/**
 * Password login. Returns either a session, or `mfa_required` when the account
 * has a second factor and no valid code was supplied.
 */
export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    /** TOTP code or a recovery code — required when the account has MFA on. */
    mfaCode: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("login", async () => {
      // Normalise defensively: a malformed email must still cost an attempt.
      let email: string;
      try {
        email = normalizeEmail(args.email);
      } catch {
        await fakeVerifyDelay(args.password, authPepper());
        throw new AgencyError("unauthenticated", "invalid email or password");
      }

      await consumeLimit(ctx, "login", email);
      await assertNotLockedOut(ctx, email);

      const user = await ctx.db
        .query("agencyUsers")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();

      // Unknown account: burn the same CPU, answer the same way.
      if (!user || user.status !== "active" || !user.passwordHash || !user.passwordSalt) {
        await fakeVerifyDelay(args.password, authPepper());
        await recordAuthFailure(ctx, email);
        throw new AgencyError("unauthenticated", "invalid email or password");
      }

      const ok = await verifyPassword(
        args.password,
        { hash: user.passwordHash, salt: user.passwordSalt },
        authPepper(),
      );
      if (!ok) {
        await recordAuthFailure(ctx, email);
        throw new AgencyError("unauthenticated", "invalid email or password");
      }

      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (!member) {
        await recordAuthFailure(ctx, email);
        throw forbidden("this account is not linked to an agency");
      }

      const agency = await ctx.db.get(member.agencyId);
      if (!agency || agency.status !== "active") {
        throw forbidden("this agency workspace is suspended");
      }

      // Second factor.
      if (user.mfaEnabled) {
        if (!args.mfaCode) {
          // Password was correct — clear the failure ladder, then stop here.
          await recordAuthSuccess(ctx, email);
          return { status: "mfa_required" as const };
        }
        await consumeLimit(ctx, "mfa", email);
        const accepted = await consumeSecondFactor(ctx, user, args.mfaCode);
        if (!accepted) {
          await recordAuthFailure(ctx, email);
          throw new AgencyError("unauthenticated", "invalid verification code");
        }
      }

      await recordAuthSuccess(ctx, email);
      await ctx.db.patch(user._id, { lastLoginAt: Date.now() });
      const session = await createSession(ctx, user._id, member.agencyId, true);
      await audit(ctx, {
        agencyId: member.agencyId,
        actorUserId: user._id,
        action: "auth.login",
        meta: { mfa: !!user.mfaEnabled },
      });

      return {
        status: "ok" as const,
        ...session,
        agency: publicAgency(agency),
        me: publicUser(user, member.role, member.displayName),
      };
    }),
});

/**
 * Verify a TOTP code or spend a recovery code. Writes back the replay guard /
 * consumed recovery code, so it is only safe to call from a mutation.
 */
async function consumeSecondFactor(ctx: { db: any }, user: any, code: string): Promise<boolean> {
  const cleaned = String(code ?? "").trim();

  // Recovery codes are longer than 6 digits — try them when the shape says so.
  if (!/^\d{6}$/.test(cleaned.replace(/\s/g, ""))) {
    const hashes: string[] = user.mfaRecoveryHashes ?? [];
    if (hashes.length === 0) return false;
    const attempt = await sha256Hex(normalizeRecoveryCode(cleaned));
    const idx = hashes.indexOf(attempt);
    if (idx < 0) return false;
    // Single use: drop it.
    const remaining = hashes.filter((_, i) => i !== idx);
    await ctx.db.patch(user._id, { mfaRecoveryHashes: remaining });
    return true;
  }

  if (!user.mfaSecretEnvelope) return false;
  const secret = await openJson<string>(vaultMasterKey(), user.mfaSecretEnvelope);
  const result = await verifyTotp(secret, cleaned, Date.now(), user.mfaLastUsedStep);
  if (!result.ok) return false;
  // Block replay of the same 30-second code.
  await ctx.db.patch(user._id, { mfaLastUsedStep: result.step });
  return true;
}

// ── Session lifecycle ───────────────────────────────────────────────────────

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("logout", async () => {
      // Resolve without a role floor — signing out must always work.
      const access = await requireAccess(ctx, args.token);
      await ctx.db.patch(access.sessionId, { revokedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "auth.logout",
      });
      return { ok: true };
    }),
});

/** Sign out of every device — the "my laptop was stolen" button. */
export const logoutEverywhere = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("logoutEverywhere", async () => {
      const access = await requireAccess(ctx, args.token);
      await ctx.db.patch(access.userId, { sessionsValidFrom: Date.now() });
      await revokeAllSessions(ctx, access.userId);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "auth.logoutEverywhere",
      });
      return { ok: true };
    }),
});

/** Refresh the idle clock from a foreground app that is otherwise only reading. */
export const touch = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("touch", async () => {
      await requireAccessRW(ctx, args.token);
      return { ok: true };
    }),
});

/** The signed-in caller: their agency, role and profile. */
export const getMe = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("getMe", async () => {
      const access = await requireAccess(ctx, args.token);
      const [agency, user, member] = await Promise.all([
        ctx.db.get(access.agencyId),
        ctx.db.get(access.userId),
        ctx.db
          .query("agencyMembers")
          .withIndex("by_agency_user", (q) =>
            q.eq("agencyId", access.agencyId).eq("userId", access.userId),
          )
          .unique(),
      ]);
      if (!agency || !user) throw notFound("workspace");
      return {
        agency: publicAgency(agency),
        me: publicUser(user, access.role, member?.displayName),
        permissions: {
          manageMembers: Permissions.manageMembers(access.role),
          manageConnections: Permissions.manageConnections(access.role),
          managePricing: Permissions.managePricing(access.role),
          createQuote: Permissions.createQuote(access.role),
          sendQuote: Permissions.sendQuote(access.role),
        },
      };
    }),
});

// ── Membership ──────────────────────────────────────────────────────────────

export const listMembers = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("listMembers", async () => {
      const access = await requireAccess(ctx, args.token, "manager");
      const members = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .collect();
      const rows = await Promise.all(
        members.map(async (m) => {
          const u = await ctx.db.get(m.userId);
          return {
            userId: m.userId,
            role: m.role,
            displayName: m.displayName ?? null,
            email: u?.email ?? null,
            status: u?.status ?? "disabled",
            mfaEnabled: !!u?.mfaEnabled,
            invitePending: u?.status === "invited",
            lastLoginAt: u?.lastLoginAt ?? null,
          };
        }),
      );
      return rows.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    }),
});

/**
 * Invite a colleague. Creates (or re-invites) the user in `invited` status and
 * emails a one-time link. The raw token is returned to the owner too, so the
 * invite still works if mail delivery fails.
 */
export const inviteMember = mutation({
  args: { token: v.string(), email: v.string(), role: agencyRole },
  handler: async (ctx, args) =>
    guard("inviteMember", async () => {
      const access = await requireAccessRW(ctx, args.token, "owner");
      const email = normalizeEmail(args.email);
      if (args.role === "owner") throw invalid("a second owner must be promoted after joining");
      await consumeLimit(ctx, "invite", access.agencyId);

      const now = Date.now();
      const rawInvite = newToken();
      const inviteTokenHash = await sha256Hex(rawInvite);

      let user = await ctx.db
        .query("agencyUsers")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();

      if (user) {
        if (user.status === "active") {
          const already = await ctx.db
            .query("agencyMembers")
            .withIndex("by_agency_user", (q) =>
              q.eq("agencyId", access.agencyId).eq("userId", user!._id),
            )
            .unique();
          if (already) throw conflict("this person is already a member");
          // An active user elsewhere: a single identity cannot straddle tenants.
          throw conflict("this email already has a Planera agency account");
        }
        await ctx.db.patch(user._id, { inviteTokenHash, inviteExpiresAt: now + INVITE_TTL_MS });
      } else {
        const userId = await ctx.db.insert("agencyUsers", {
          email,
          status: "invited",
          inviteTokenHash,
          inviteExpiresAt: now + INVITE_TTL_MS,
          createdAt: now,
        });
        user = await ctx.db.get(userId);
      }

      const existingMembership = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency_user", (q) =>
          q.eq("agencyId", access.agencyId).eq("userId", user!._id),
        )
        .unique();
      if (existingMembership) {
        await ctx.db.patch(existingMembership._id, { role: args.role });
      } else {
        await ctx.db.insert("agencyMembers", {
          agencyId: access.agencyId,
          userId: user!._id,
          role: args.role,
          createdAt: now,
        });
      }

      const agency = await ctx.db.get(access.agencyId);
      const inviteUrl = `${quotePublicBaseUrl()}/agency/join?token=${encodeURIComponent(rawInvite)}`;
      await ctx.scheduler.runAfter(0, sendEmailRef, {
        to: email,
        subject: `You've been invited to ${agency?.name ?? "a Planera agency workspace"}`,
        html:
          `<p>You have been invited to join <strong>${escapeHtml(agency?.name ?? "a travel agency")}</strong> ` +
          `on Planera for Travel Agencies.</p>` +
          `<p><a href="${inviteUrl}">Set your password and join</a></p>` +
          `<p>This link expires in 7 days. If you were not expecting it, ignore this email.</p>`,
        text: `Join ${agency?.name ?? "a Planera agency workspace"}: ${inviteUrl} (expires in 7 days)`,
      });

      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "auth.inviteMember",
        targetType: "agencyUser",
        targetId: user!._id,
        meta: { email, role: args.role },
      });

      return { inviteUrl, expiresAt: now + INVITE_TTL_MS };
    }),
});

/** Accept an invite: set a password, activate, and get a session. */
export const acceptInvite = mutation({
  args: {
    inviteToken: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    guard("acceptInvite", async () => {
      await consumeLimit(ctx, "acceptInvite", args.inviteToken.slice(0, 16));
      const inviteTokenHash = await sha256Hex(args.inviteToken);
      const user = await ctx.db
        .query("agencyUsers")
        .withIndex("by_inviteTokenHash", (q) => q.eq("inviteTokenHash", inviteTokenHash))
        .unique();
      if (!user || user.status !== "invited") throw invalid("this invite is no longer valid");
      if (!user.inviteExpiresAt || user.inviteExpiresAt < Date.now()) {
        throw invalid("this invite has expired");
      }
      assertPasswordPolicy(args.password, user.email);

      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (!member) throw invalid("this invite is no longer valid");

      const agency = await ctx.db.get(member.agencyId);
      if (!agency || agency.status !== "active") throw forbidden("this agency workspace is suspended");

      const now = Date.now();
      const pw = await hashPassword(args.password, authPepper());
      await ctx.db.patch(user._id, {
        passwordHash: pw.hash,
        passwordSalt: pw.salt,
        status: "active",
        // Single use: burn the invite.
        inviteTokenHash: undefined,
        inviteExpiresAt: undefined,
        passwordUpdatedAt: now,
        lastLoginAt: now,
      });
      if (args.displayName?.trim()) {
        await ctx.db.patch(member._id, { displayName: args.displayName.trim().slice(0, 80) });
      }

      const session = await createSession(ctx, user._id, member.agencyId, true);
      await audit(ctx, {
        agencyId: member.agencyId,
        actorUserId: user._id,
        action: "auth.acceptInvite",
      });

      const fresh = await ctx.db.get(user._id);
      return {
        ...session,
        agency: publicAgency(agency),
        me: publicUser(fresh, member.role, args.displayName),
      };
    }),
});

export const changeMemberRole = mutation({
  args: { token: v.string(), userId: v.id("agencyUsers"), role: agencyRole },
  handler: async (ctx, args) =>
    guard("changeMemberRole", async () => {
      const access = await requireAccessRW(ctx, args.token, "owner");
      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency_user", (q) =>
          q.eq("agencyId", access.agencyId).eq("userId", args.userId),
        )
        .unique();
      if (!member) throw notFound("member");

      // Never let the last owner demote themselves out of the workspace.
      if (member.role === "owner" && args.role !== "owner") {
        const owners = await countOwners(ctx, access.agencyId);
        if (owners <= 1) throw invalid("an agency must keep at least one owner");
      }

      await ctx.db.patch(member._id, { role: args.role });
      // Role changes must take effect immediately, not at the next login.
      await ctx.db.patch(args.userId, { sessionsValidFrom: Date.now() });
      await revokeAllSessions(ctx, args.userId);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "auth.changeMemberRole",
        targetType: "agencyUser",
        targetId: args.userId,
        meta: { role: args.role },
      });
      return { ok: true };
    }),
});

export const removeMember = mutation({
  args: { token: v.string(), userId: v.id("agencyUsers") },
  handler: async (ctx, args) =>
    guard("removeMember", async () => {
      const access = await requireAccessRW(ctx, args.token, "owner");
      if (args.userId === access.userId) throw invalid("you cannot remove yourself");
      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency_user", (q) =>
          q.eq("agencyId", access.agencyId).eq("userId", args.userId),
        )
        .unique();
      if (!member) throw notFound("member");
      if (member.role === "owner" && (await countOwners(ctx, access.agencyId)) <= 1) {
        throw invalid("an agency must keep at least one owner");
      }

      await ctx.db.delete(member._id);
      // Disable the identity and kill its sessions — membership was its only tenant.
      await ctx.db.patch(args.userId, { status: "disabled", sessionsValidFrom: Date.now() });
      await revokeAllSessions(ctx, args.userId);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "auth.removeMember",
        targetType: "agencyUser",
        targetId: args.userId,
      });
      return { ok: true };
    }),
});

async function countOwners(ctx: { db: any }, agencyId: Id<"agencies">): Promise<number> {
  const members = await ctx.db
    .query("agencyMembers")
    .withIndex("by_agency", (q: any) => q.eq("agencyId", agencyId))
    .collect();
  return members.filter((m: any) => m.role === "owner").length;
}

// ── Credentials ─────────────────────────────────────────────────────────────

export const changePassword = mutation({
  args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args) =>
    guard("changePassword", async () => {
      const access = await requireAccess(ctx, args.token);
      const user = await ctx.db.get(access.userId);
      if (!user?.passwordHash || !user.passwordSalt) throw notFound("account");

      await assertNotLockedOut(ctx, user.email);
      const ok = await verifyPassword(
        args.currentPassword,
        { hash: user.passwordHash, salt: user.passwordSalt },
        authPepper(),
      );
      if (!ok) {
        await recordAuthFailure(ctx, user.email);
        throw new AgencyError("unauthenticated", "current password is incorrect");
      }
      assertPasswordPolicy(args.newPassword, user.email);
      if (args.newPassword === args.currentPassword) {
        throw invalid("the new password must differ from the current one");
      }

      const now = Date.now();
      const pw = await hashPassword(args.newPassword, authPepper());
      await ctx.db.patch(user._id, {
        passwordHash: pw.hash,
        passwordSalt: pw.salt,
        passwordUpdatedAt: now,
        // Kill every existing session, including this one…
        sessionsValidFrom: now,
      });
      await revokeAllSessions(ctx, user._id);
      await recordAuthSuccess(ctx, user.email);
      // …then hand back a fresh session so the caller is not signed out mid-task.
      const session = await createSession(ctx, user._id, access.agencyId, true);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: user._id,
        action: "auth.changePassword",
      });
      return session;
    }),
});

// ── Second factor ───────────────────────────────────────────────────────────

/**
 * Step 1 of enrolment: mint a secret, seal it, and return the provisioning URI.
 * MFA stays OFF until a code proves the user actually scanned it.
 */
export const startMfaEnrollment = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("startMfaEnrollment", async () => {
      const access = await requireAccessRW(ctx, args.token);
      const user = await ctx.db.get(access.userId);
      if (!user) throw notFound("account");
      if (user.mfaEnabled) throw conflict("two-factor authentication is already enabled");

      const secret = generateTotpSecret();
      await ctx.db.patch(user._id, {
        mfaSecretEnvelope: await sealJson(vaultMasterKey(), secret),
        mfaEnabled: false,
        mfaLastUsedStep: undefined,
      });
      // The secret is shown ONCE, here, and never returned again.
      return { secret, otpauthUri: otpauthUri(secret, user.email) };
    }),
});

/** Step 2: prove the authenticator works, then switch MFA on. */
export const confirmMfaEnrollment = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) =>
    guard("confirmMfaEnrollment", async () => {
      const access = await requireAccessRW(ctx, args.token);
      const user = await ctx.db.get(access.userId);
      if (!user?.mfaSecretEnvelope) throw invalid("start two-factor setup first");
      if (user.mfaEnabled) throw conflict("two-factor authentication is already enabled");

      await consumeLimit(ctx, "mfa", user.email);
      const secret = await openJson<string>(vaultMasterKey(), user.mfaSecretEnvelope);
      const result = await verifyTotp(secret, args.code, Date.now(), user.mfaLastUsedStep);
      if (!result.ok) throw new AgencyError("unauthenticated", "invalid verification code");

      const recoveryCodes = generateRecoveryCodes();
      await ctx.db.patch(user._id, {
        mfaEnabled: true,
        mfaLastUsedStep: result.step,
        mfaRecoveryHashes: await Promise.all(
          recoveryCodes.map((c) => sha256Hex(normalizeRecoveryCode(c))),
        ),
      });
      // The current session already proved possession — keep it alive.
      await ctx.db.patch(access.sessionId, { mfaSatisfied: true });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: user._id,
        action: "auth.enableMfa",
      });
      // Recovery codes are shown ONCE.
      return { recoveryCodes };
    }),
});

export const disableMfa = mutation({
  args: { token: v.string(), password: v.string(), code: v.string() },
  handler: async (ctx, args) =>
    guard("disableMfa", async () => {
      const access = await requireAccess(ctx, args.token);
      const user = await ctx.db.get(access.userId);
      if (!user?.mfaEnabled) throw invalid("two-factor authentication is not enabled");
      if (!user.passwordHash || !user.passwordSalt) throw notFound("account");

      await assertNotLockedOut(ctx, user.email);
      await consumeLimit(ctx, "mfa", user.email);
      // Turning MFA off needs BOTH factors — a hijacked session must not suffice.
      const pwOk = await verifyPassword(
        args.password,
        { hash: user.passwordHash, salt: user.passwordSalt },
        authPepper(),
      );
      const codeOk = pwOk && (await consumeSecondFactor(ctx, user, args.code));
      if (!pwOk || !codeOk) {
        await recordAuthFailure(ctx, user.email);
        throw new AgencyError("unauthenticated", "password or verification code is incorrect");
      }

      const now = Date.now();
      await ctx.db.patch(user._id, {
        mfaEnabled: false,
        mfaSecretEnvelope: undefined,
        mfaRecoveryHashes: undefined,
        mfaLastUsedStep: undefined,
        sessionsValidFrom: now,
      });
      await revokeAllSessions(ctx, user._id);
      await recordAuthSuccess(ctx, user.email);
      const session = await createSession(ctx, user._id, access.agencyId, true);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: user._id,
        action: "auth.disableMfa",
      });
      return session;
    }),
});

// ── Agency settings ─────────────────────────────────────────────────────────

export const updateAgency = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    defaultCurrency: v.optional(v.string()),
    quoteTtlHours: v.optional(v.float64()),
    branding: v.optional(
      v.object({
        primaryColor: v.optional(v.string()),
        legalName: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        contactPhone: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) =>
    guard("updateAgency", async () => {
      const access = await requireAccessRW(ctx, args.token, "owner");
      const agency = await ctx.db.get(access.agencyId);
      if (!agency) throw notFound("agency");

      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (args.name !== undefined) patch.name = normalizeAgencyName(args.name);
      if (args.defaultCurrency !== undefined) {
        patch.defaultCurrency = normalizeCurrency(args.defaultCurrency);
      }
      if (args.quoteTtlHours !== undefined) {
        if (!(args.quoteTtlHours >= 1 && args.quoteTtlHours <= 168)) {
          throw invalid("quote validity must be between 1 and 168 hours");
        }
        patch.quoteTtlMs = Math.round(args.quoteTtlHours * 3600_000);
      }
      if (args.branding) {
        const b = args.branding;
        if (b.primaryColor && !/^#[0-9a-fA-F]{6}$/.test(b.primaryColor)) {
          throw invalid("primary colour must be a #rrggbb hex value");
        }
        if (b.contactEmail) normalizeEmail(b.contactEmail);
        patch.branding = {
          ...(agency.branding ?? {}),
          primaryColor: b.primaryColor,
          legalName: b.legalName?.trim().slice(0, 120),
          contactEmail: b.contactEmail?.trim().toLowerCase(),
          contactPhone: b.contactPhone?.trim().slice(0, 40),
        };
      }

      await ctx.db.patch(access.agencyId, patch);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "agency.update",
        meta: { fields: Object.keys(patch) },
      });
      return publicAgency(await ctx.db.get(access.agencyId));
    }),
});

/** The tenant's audit trail — owners and managers only. */
export const listAuditLog = query({
  args: { token: v.string(), limit: v.optional(v.float64()) },
  handler: async (ctx, args) =>
    guard("listAuditLog", async () => {
      const access = await requireAccess(ctx, args.token, "manager");
      const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 200);
      return await ctx.db
        .query("agencyAuditLog")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .order("desc")
        .take(limit);
    }),
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
