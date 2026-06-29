import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
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
  args: { token: v.string(), password: v.string(), acceptedTerms: v.boolean() },
  handler: async (ctx, args) => {
    if (!args.acceptedTerms) {
      throw new ConvexError(
        "You must accept the Partner API Terms to create an account."
      );
    }
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
      acceptedTermsAt: now,
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

// ---------------------------------------------------------------------------
// Self-serve supplier signup + email verification (no invite required)
// ---------------------------------------------------------------------------

const EMAIL_VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function partnerRefFromCompany(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "partner"}-${randomToken().slice(0, 6)}`;
}

/**
 * Self-serve supplier signup. Creates a `partnerAccounts` row with
 * `kind:"supplier"` in status "pending_verification", stores the PBKDF2
 * password hash, and emails a one-time verification link (scheduled, so a mail
 * hiccup can't fail the form). The account only becomes usable after
 * `verifyEmail`. Suppliers don't use the API, so their key caps are 0.
 */
export const signup = mutation({
  args: {
    companyName: v.string(),
    email: v.string(),
    password: v.string(),
    acceptedTerms: v.boolean(),
  },
  handler: async (ctx, args) => {
    const companyName = args.companyName.trim();
    const email = args.email.trim().toLowerCase();
    if (!companyName) throw new ConvexError("Company name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (args.password.length < 8) {
      throw new ConvexError("Password must be at least 8 characters.");
    }
    if (!args.acceptedTerms) {
      throw new ConvexError("You must accept the Partner Terms to continue.");
    }

    const existing = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing && existing.status === "active") {
      throw new ConvexError(
        "An account already exists for this email. Try signing in."
      );
    }

    const now = Date.now();
    const passwordHash = await hashPassword(args.password);
    const rawToken = randomToken();
    const emailVerifyTokenHash = await sha256Hex(rawToken);
    const emailVerifyExpiresAt = now + EMAIL_VERIFY_TTL_MS;

    if (existing) {
      // Re-use a prior pending/disabled row: refresh the signup.
      await ctx.db.patch(existing._id, {
        partnerName: companyName,
        kind: "supplier",
        passwordHash,
        status: "pending_verification",
        emailVerifyTokenHash,
        emailVerifyExpiresAt,
        acceptedTermsAt: now,
      });
    } else {
      await ctx.db.insert("partnerAccounts", {
        email,
        partnerName: companyName,
        partnerRef: partnerRefFromCompany(companyName),
        kind: "supplier",
        passwordHash,
        status: "pending_verification",
        emailVerifyTokenHash,
        emailVerifyExpiresAt,
        rateLimitPerMin: 0,
        dailyCap: 0,
        monthlyCap: 0,
        createdAt: now,
        acceptedTermsAt: now,
      });
    }

    const verifyUrl = `${PARTNERS_BASE_URL}/partners/verify?token=${rawToken}`;
    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: email,
      subject: "Verify your Planera partner account",
      html: verifyEmailHtml({ companyName, verifyUrl }),
      text:
        `Welcome to Planera partners, ${companyName}.\n\n` +
        `Verify your email to activate your account (link valid 24 hours):\n${verifyUrl}\n\n` +
        `If you didn't create this account you can ignore this email.`,
    });

    return { ok: true as const, email };
  },
});

/**
 * Consume an email-verification token: activate the account and return a
 * session token so the supplier lands straight in their product dashboard.
 */
export const verifyEmail = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token.trim());
    const account = await ctx.db
      .query("partnerAccounts")
      .withIndex("by_emailVerifyTokenHash", (q) =>
        q.eq("emailVerifyTokenHash", tokenHash)
      )
      .first();
    if (!account || account.status !== "pending_verification") {
      throw new ConvexError("This verification link is invalid or already used.");
    }
    if (account.emailVerifyExpiresAt && account.emailVerifyExpiresAt < Date.now()) {
      throw new ConvexError("This verification link has expired. Sign up again.");
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      status: "active",
      emailVerifyTokenHash: undefined,
      emailVerifyExpiresAt: undefined,
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

function verifyEmailHtml(opts: { companyName: string; verifyUrl: string }): string {
  const { companyName, verifyUrl } = opts;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="background:#16161c;border:1px solid #26262e;border-radius:16px;border-top:4px solid #FFE500;padding:32px;">
      <h1 style="margin:0 0 8px;color:#fff;font-size:20px;">Verify your email</h1>
      <p style="margin:0 0 20px;color:#b5b5bd;font-size:14px;line-height:1.6;">Welcome to Planera partners, ${esc(companyName)}. Confirm your email to activate your account and start adding products.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${verifyUrl}" style="display:inline-block;background:#FFE500;color:#111;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;">Verify email</a>
      </div>
      <p style="margin:0 0 6px;color:#8a8a96;font-size:12px;">Or paste this link (valid 24 hours):</p>
      <p style="margin:0;word-break:break-all;color:#FFE500;font-size:12px;">${verifyUrl}</p>
    </div>
  </div></body></html>`;
}

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
      kind: account.kind ?? "api",
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

// ---------------------------------------------------------------------------
// Public "Become a partner" application (no auth)
// ---------------------------------------------------------------------------

const APPLICATION_NOTIFY_EMAIL = "sales@planeraai.app";
const PARTNERS_BASE_URL = "https://www.planeraai.app";

/**
 * Submit a partner application from the public marketing site. Stored as a
 * `partnerApplications` row in status "new" and a notification email is sent to
 * the sales inbox (scheduled, so a mail hiccup can't fail the form). An operator
 * reviews it in /partner-admin and clicks "Invite" to start the portal flow.
 */
export const submitApplication = mutation({
  args: {
    companyName: v.string(),
    website: v.optional(v.string()),
    contactName: v.string(),
    email: v.string(),
    partnershipTypes: v.array(v.string()),
    monthlyVolume: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const companyName = args.companyName.trim();
    const contactName = args.contactName.trim();
    const email = args.email.trim().toLowerCase();
    if (!companyName) throw new ConvexError("Company name is required.");
    if (!contactName) throw new ConvexError("Your name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    const types = args.partnershipTypes.filter((t) => t.trim());
    if (types.length === 0) {
      throw new ConvexError("Pick at least one way you'd like to partner.");
    }

    const website = args.website?.trim() || undefined;
    const message = args.message?.trim() || undefined;
    const monthlyVolume = args.monthlyVolume?.trim() || undefined;
    const now = Date.now();

    const id = await ctx.db.insert("partnerApplications", {
      companyName,
      website,
      contactName,
      email,
      partnershipTypes: types,
      monthlyVolume,
      message,
      status: "new",
      createdAt: now,
    });

    const html = applicationEmailHtml({
      companyName,
      website,
      contactName,
      email,
      types,
      monthlyVolume,
      message,
    });
    const text =
      `New partner application\n\n` +
      `Company: ${companyName}\n` +
      `Website: ${website ?? "—"}\n` +
      `Contact: ${contactName} <${email}>\n` +
      `Partnership: ${types.join(", ")}\n` +
      `Volume: ${monthlyVolume ?? "—"}\n\n` +
      `${message ?? "(no message)"}\n\n` +
      `Review & invite in ${PARTNERS_BASE_URL}/partner-admin`;

    await ctx.scheduler.runAfter(0, internal.postmark.sendRawEmail, {
      to: APPLICATION_NOTIFY_EMAIL,
      subject: `New partner application — ${companyName}`,
      html,
      text,
    });

    return { ok: true as const, id };
  },
});

function applicationEmailHtml(opts: {
  companyName: string;
  website?: string;
  contactName: string;
  email: string;
  types: string[];
  monthlyVolume?: string;
  message?: string;
}): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#8a8a96;font-size:13px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#fff;font-size:14px;">${value}</td></tr>`;
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:#16161c;border:1px solid #26262e;border-radius:16px;border-top:4px solid #FFE500;padding:32px;">
      <h1 style="margin:0 0 4px;color:#fff;font-size:20px;">New partner application</h1>
      <p style="margin:0 0 20px;color:#8a8a96;font-size:13px;">From the planeraai.app/partners form.</p>
      <table style="width:100%;border-collapse:collapse;">
        ${row("Company", esc(opts.companyName))}
        ${opts.website ? row("Website", esc(opts.website)) : ""}
        ${row("Contact", `${esc(opts.contactName)} &lt;${esc(opts.email)}&gt;`)}
        ${row("Partnership", esc(opts.types.join(", ")))}
        ${opts.monthlyVolume ? row("Volume", esc(opts.monthlyVolume)) : ""}
        ${opts.message ? row("Message", esc(opts.message)) : ""}
      </table>
      <div style="text-align:center;margin:28px 0 4px;">
        <a href="${PARTNERS_BASE_URL}/partner-admin" style="display:inline-block;background:#FFE500;color:#111;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">Review &amp; invite</a>
      </div>
    </div>
  </div></body></html>`;
}
