import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { sha256Hex } from "./partnerApiAuth";

/**
 * Partner Portal — partner-facing self-service surface (V8 runtime).
 *
 * Flow:
 *   1. An operator/admin invites a partner by email (see
 *      `partnerAdminApp.invitePartner`). That creates a `partnerAccounts`
 *      row in status "invited" with a one-time invite token (hashed) and
 *      sends an email containing a signup link.
 *   2. The partner opens the link, sets a password → `acceptInvite` activates
 *      the account and returns a session token.
 *   3. The partner logs in with email + password → `login`.
 *   4. Once authenticated, the partner can create / revoke their OWN API keys
 *      and view their usage — all scoped to their `accountId`.
 *
 * Passwords are PBKDF2-SHA512 hashed with a per-account random salt using the
 * Web Crypto API (available in the Convex V8 runtime — no "use node" needed).
 */

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto / V8)
// ---------------------------------------------------------------------------

const PBKDF2_ITER = 210_000;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: "SHA-512" },
    keyMaterial,
    512
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Format: pbkdf2$<iter>$<saltHex>$<hashHex> */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITER}$${bytesToHex(salt)}$${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  const computed = await pbkdf2(password, salt);
  // Constant-time-ish comparison.
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

function randomSecret(prefix: string): string {
  return `${prefix}${randomToken()}`;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Internal helpers used by the admin invite action
// ---------------------------------------------------------------------------

/** Create (or re-invite) a partner account. Returns the raw invite token. */
export const createInvite = internalMutation({
  args: {
    email: v.string(),
    partnerName: v.string(),
    partnerRef: v.string(),
    rateLimitPerMin: v.float64(),
    dailyCap: v.float64(),
    monthlyCap: v.float64(),
    inviteTtlMs: v.float64(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const rawToken = randomToken();
    const inviteTokenHash = await sha256Hex(rawToken);
    const now = Date.now();
    const inviteExpiresAt = now + args.inviteTtlMs;

    const existing = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      if (existing.status === "active") {
        throw new ConvexError("An active account already exists for this email.");
      }
      // Re-issue invite for a pending/disabled account.
      await ctx.db.patch(existing._id, {
        partnerName: args.partnerName,
        partnerRef: args.partnerRef,
        status: "invited",
        inviteTokenHash,
        inviteExpiresAt,
        rateLimitPerMin: args.rateLimitPerMin,
        dailyCap: args.dailyCap,
        monthlyCap: args.monthlyCap,
      });
      return { accountId: existing._id, email, rawToken };
    }

    const accountId = await ctx.db.insert("partnerAccounts", {
      email,
      partnerName: args.partnerName,
      partnerRef: args.partnerRef,
      status: "invited",
      inviteTokenHash,
      inviteExpiresAt,
      rateLimitPerMin: args.rateLimitPerMin,
      dailyCap: args.dailyCap,
      monthlyCap: args.monthlyCap,
      createdAt: now,
    });
    return { accountId, email, rawToken };
  },
});

/** List all partner accounts (admin view). Internal — called from admin query. */
export const listAccountsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("partnerAccounts").collect();
    return accounts
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({
        accountId: a._id,
        email: a.email,
        partnerName: a.partnerName,
        partnerRef: a.partnerRef,
        status: a.status,
        createdAt: a.createdAt,
        activatedAt: a.activatedAt ?? null,
        lastLoginAt: a.lastLoginAt ?? null,
        inviteExpiresAt: a.inviteExpiresAt ?? null,
      }));
  },
});

// ---------------------------------------------------------------------------
// Partner-facing: invite validation + signup + login
// ---------------------------------------------------------------------------

/** Check an invite token (for the signup page) without consuming it. */
export const validateInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token.trim());
    const account = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_inviteTokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
    if (!account || account.status === "active") {
      return { valid: false as const };
    }
    if (account.inviteExpiresAt && account.inviteExpiresAt < Date.now()) {
      return { valid: false as const, expired: true };
    }
    return {
      valid: true as const,
      email: account.email,
      partnerName: account.partnerName,
    };
  },
});

/** Accept an invite: set password, activate, return a session token. */
export const acceptInvite = mutation({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    if (args.password.length < 8) {
      throw new ConvexError("Password must be at least 8 characters.");
    }
    const tokenHash = await sha256Hex(args.token.trim());
    const account = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_inviteTokenHash", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
    if (!account || account.status === "active") {
      throw new ConvexError("This invite link is invalid or already used.");
    }
    if (account.inviteExpiresAt && account.inviteExpiresAt < Date.now()) {
      throw new ConvexError("This invite link has expired. Ask for a new one.");
    }

    const passwordHash = await hashPassword(args.password);
    const now = Date.now();
    await ctx.db.patch(account._id, {
      passwordHash,
      status: "active",
      inviteTokenHash: undefined,
      inviteExpiresAt: undefined,
      activatedAt: now,
      lastLoginAt: now,
    });

    const sessionToken = randomSecret("ps_");
    await ctx.db.insert("partnerAccountSessions", {
      accountId: account._id,
      tokenHash: await sha256Hex(sessionToken),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });

    return { token: sessionToken, partnerName: account.partnerName };
  },
});

/** Log in with email + password. Returns a session token. */
export const login = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const account = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!account || account.status !== "active" || !account.passwordHash) {
      throw new ConvexError("Invalid email or password.");
    }
    const ok = await verifyPassword(args.password, account.passwordHash);
    if (!ok) {
      throw new ConvexError("Invalid email or password.");
    }
    const now = Date.now();
    await ctx.db.patch(account._id, { lastLoginAt: now });

    const sessionToken = randomSecret("ps_");
    await ctx.db.insert("partnerAccountSessions", {
      accountId: account._id,
      tokenHash: await sha256Hex(sessionToken),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return { token: sessionToken, partnerName: account.partnerName };
  },
});

/** Log out — invalidate the current session. */
export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const session = await ctx.db
      .query("partnerAccountSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (session) await ctx.db.delete(session._id);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Authenticated partner surface
// ---------------------------------------------------------------------------

/** Resolve a partner account from a session token. Returns null if invalid. */
async function accountFromToken(ctx: any, token: string) {
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db
    .query("partnerAccountSessions")
    .withIndex("by_tokenHash", (q: any) => q.eq("tokenHash", tokenHash))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  const account = await ctx.db.get(session.accountId);
  if (!account || account.status !== "active") return null;
  return account;
}

async function usageForKey(ctx: any, keyId: any, dailyCap: number, monthlyCap: number) {
  const now = Date.now();
  const dayBucket = new Date(now).toISOString().slice(0, 10);
  const monthBucket = new Date(now).toISOString().slice(0, 7);
  const dayCounter = await ctx.db
    .query("partnerUsageCounters")
    .withIndex("by_key_window_bucket", (q: any) =>
      q.eq("keyId", keyId).eq("window", "day").eq("bucket", dayBucket)
    )
    .first();
  const monthCounter = await ctx.db
    .query("partnerUsageCounters")
    .withIndex("by_key_window_bucket", (q: any) =>
      q.eq("keyId", keyId).eq("window", "month").eq("bucket", monthBucket)
    )
    .first();
  const cacheDayCounter = await ctx.db
    .query("partnerUsageCounters")
    .withIndex("by_key_window_bucket", (q: any) =>
      q.eq("keyId", keyId).eq("window", "cache_day").eq("bucket", dayBucket)
    )
    .first();
  const cacheMonthCounter = await ctx.db
    .query("partnerUsageCounters")
    .withIndex("by_key_window_bucket", (q: any) =>
      q.eq("keyId", keyId).eq("window", "cache_month").eq("bucket", monthBucket)
    )
    .first();
  const today = dayCounter?.count ?? 0;
  const month = monthCounter?.count ?? 0;
  return {
    generationsToday: today,
    generationsThisMonth: month,
    cacheHitsToday: cacheDayCounter?.count ?? 0,
    cacheHitsThisMonth: cacheMonthCounter?.count ?? 0,
    dailyRemaining: Math.max(0, dailyCap - today),
    monthlyRemaining: Math.max(0, monthlyCap - month),
  };
}

/** Current partner account + their keys + usage. */
export const getMe = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;

    const keys = await ctx.db
      .query("partnerApiKeys")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();

    const keyViews = [];
    for (const k of keys) {
      keyViews.push({
        keyId: k._id,
        keyPrefix: k.keyPrefix,
        active: k.active,
        rateLimitPerMin: k.rateLimitPerMin,
        dailyCap: k.dailyCap,
        monthlyCap: k.monthlyCap,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt ?? null,
        revokedAt: k.revokedAt ?? null,
        usage: await usageForKey(ctx, k._id, k.dailyCap, k.monthlyCap),
      });
    }

    return {
      email: account.email,
      partnerName: account.partnerName,
      partnerRef: account.partnerRef,
      limits: {
        rateLimitPerMin: account.rateLimitPerMin,
        dailyCap: account.dailyCap,
        monthlyCap: account.monthlyCap,
      },
      keys: keyViews.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

/**
 * Daily generation usage for the authenticated partner over the last N days,
 * summed across all of their API keys. Powers the portal usage chart.
 */
export const getUsageHistory = query({
  args: { token: v.string(), days: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;

    const span = Math.max(1, Math.min(90, Math.floor(args.days ?? 14)));
    const keys = await ctx.db
      .query("partnerApiKeys")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();

    // Build the list of day buckets (oldest → newest) in UTC.
    const buckets: string[] = [];
    const now = Date.now();
    for (let i = span - 1; i >= 0; i--) {
      buckets.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
    }
    const genTotals: Record<string, number> = Object.fromEntries(
      buckets.map((b) => [b, 0])
    );
    const cacheTotals: Record<string, number> = Object.fromEntries(
      buckets.map((b) => [b, 0])
    );

    for (const k of keys) {
      for (const bucket of buckets) {
        const gen = await ctx.db
          .query("partnerUsageCounters")
          .withIndex("by_key_window_bucket", (q) =>
            q.eq("keyId", k._id).eq("window", "day").eq("bucket", bucket)
          )
          .first();
        if (gen) genTotals[bucket] += gen.count;

        const cache = await ctx.db
          .query("partnerUsageCounters")
          .withIndex("by_key_window_bucket", (q) =>
            q.eq("keyId", k._id).eq("window", "cache_day").eq("bucket", bucket)
          )
          .first();
        if (cache) cacheTotals[bucket] += cache.count;
      }
    }

    const series = buckets.map((b) => ({
      date: b,
      gen: genTotals[b],
      cache: cacheTotals[b],
    }));
    return {
      days: span,
      series,
      totalGen: series.reduce((s, p) => s + p.gen, 0),
      totalCache: series.reduce((s, p) => s + p.cache, 0),
      dailyCap: account.dailyCap,
    };
  },
});

/** Create a new API key for the authenticated partner. Returns secrets ONCE. */
export const createKey = mutation({
  args: { token: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");

    // Cap the number of active keys a partner can self-create.
    const existing = await ctx.db
      .query("partnerApiKeys")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const activeCount = existing.filter((k) => k.active).length;
    if (activeCount >= 5) {
      throw new ConvexError("You already have the maximum of 5 active keys. Revoke one first.");
    }

    const rawKey = randomSecret("pk_live_");
    const webhookSecret = randomSecret("whsec_");
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const keyId = await ctx.db.insert("partnerApiKeys", {
      keyHash,
      keyPrefix,
      partnerName: args.label?.trim()
        ? `${account.partnerName} · ${args.label.trim()}`
        : account.partnerName,
      partnerRef: account.partnerRef,
      webhookSecret,
      active: true,
      rateLimitPerMin: account.rateLimitPerMin,
      dailyCap: account.dailyCap,
      monthlyCap: account.monthlyCap,
      createdAt: Date.now(),
      accountId: account._id,
    });

    return { keyId, keyPrefix, apiKey: rawKey, webhookSecret };
  },
});

/** Revoke one of the partner's own keys. */
export const revokeKey = mutation({
  args: { token: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    const key = await ctx.db.get(args.keyId);
    if (!key || key.accountId !== account._id) {
      throw new ConvexError("Key not found.");
    }
    await ctx.db.patch(args.keyId, { active: false, revokedAt: Date.now() });
    return { ok: true };
  },
});

/** Change the password for the authenticated partner. */
export const changePassword = mutation({
  args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account || !account.passwordHash) throw new ConvexError("Not authenticated.");
    if (args.newPassword.length < 8) {
      throw new ConvexError("New password must be at least 8 characters.");
    }
    const ok = await verifyPassword(args.currentPassword, account.passwordHash);
    if (!ok) throw new ConvexError("Current password is incorrect.");
    await ctx.db.patch(account._id, { passwordHash: await hashPassword(args.newPassword) });
    return { ok: true };
  },
});
