import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sha256Hex } from "./partnerApiAuth";
import { assertAdmin } from "./admin";

/**
 * Partner API — IN-APP admin surface.
 *
 * These mirror the functions in `partnerApiAdmin.ts`, but instead of the
 * standalone `PARTNER_ADMIN_TOKEN`, they are gated by the app's own admin
 * system: the caller passes their normal session `token`, we resolve the
 * userId from it and require `checkIsAdmin` (ADMIN_EMAILS / users.isAdmin).
 *
 * This lets app admins manage partner keys from the in-app Admin panel,
 * reusing the exact same data as the web dashboard.
 */

/** Resolve a userId from a session token (mirrors admin.ts helper). */
async function getUserIdFromToken(ctx: any, token: string): Promise<string | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

/** Throw unless the session token belongs to an admin. Returns userId. */
async function requireAdmin(ctx: any, token: string): Promise<string> {
  const userId = await getUserIdFromToken(ctx, token);
  if (!userId) throw new ConvexError("Unauthorized.");
  await assertAdmin(ctx, userId);
  return userId;
}

function randomSecret(prefix: string): string {
  const a = crypto.randomUUID().replace(/-/g, "");
  const b = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}${a}${b}`;
}

const DEFAULTS = {
  rateLimitPerMin: 60,
  dailyCap: 500,
  monthlyCap: 5000,
};

/** List all partner keys (no secrets/hashes). Hides the internal system key. */
export const listKeys = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const keys = await ctx.db.query("partnerApiKeys").collect();
    return keys
      .filter((k) => k.partnerRef !== "__system__")
      .map((k) => ({
        keyId: k._id,
        partnerName: k.partnerName,
        partnerRef: k.partnerRef,
        keyPrefix: k.keyPrefix,
        active: k.active,
        rateLimitPerMin: k.rateLimitPerMin,
        dailyCap: k.dailyCap,
        monthlyCap: k.monthlyCap,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt ?? null,
        revokedAt: k.revokedAt ?? null,
      }));
  },
});

/**
 * Create a new partner API key. Returns the RAW key + webhook secret ONCE.
 */
export const createKey = mutation({
  args: {
    token: v.string(),
    partnerName: v.string(),
    partnerRef: v.string(),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const rawKey = randomSecret("pk_live_");
    const webhookSecret = randomSecret("whsec_");
    const keyHash = await sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const keyId = await ctx.db.insert("partnerApiKeys", {
      keyHash,
      keyPrefix,
      partnerName: args.partnerName,
      partnerRef: args.partnerRef,
      webhookSecret,
      active: true,
      rateLimitPerMin: args.rateLimitPerMin ?? DEFAULTS.rateLimitPerMin,
      dailyCap: args.dailyCap ?? DEFAULTS.dailyCap,
      monthlyCap: args.monthlyCap ?? DEFAULTS.monthlyCap,
      createdAt: Date.now(),
    });

    return {
      keyId,
      partnerName: args.partnerName,
      partnerRef: args.partnerRef,
      keyPrefix,
      apiKey: rawKey,
      webhookSecret,
    };
  },
});

/** Revoke (deactivate) a partner key. */
export const revokeKey = mutation({
  args: { token: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: false, revokedAt: Date.now() });
    return { ok: true };
  },
});

/** Re-activate a previously revoked key. */
export const reactivateKey = mutation({
  args: { token: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: true, revokedAt: undefined });
    return { ok: true };
  },
});

/** Update the rate limit / generation caps for a key. */
export const updateKeyLimits = mutation({
  args: {
    token: v.string(),
    keyId: v.id("partnerApiKeys"),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    const patch: Record<string, number> = {};
    if (args.rateLimitPerMin !== undefined)
      patch.rateLimitPerMin = args.rateLimitPerMin;
    if (args.dailyCap !== undefined) patch.dailyCap = args.dailyCap;
    if (args.monthlyCap !== undefined) patch.monthlyCap = args.monthlyCap;
    await ctx.db.patch(args.keyId, patch);
    return { ok: true };
  },
});

/** Current usage for a key (today + this month + recent itineraries). */
export const getUsage = query({
  args: { token: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const now = Date.now();
    const dayBucket = new Date(now).toISOString().slice(0, 10);
    const monthBucket = new Date(now).toISOString().slice(0, 7);

    const dayCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q.eq("keyId", args.keyId).eq("window", "day").eq("bucket", dayBucket)
      )
      .first();
    const monthCounter = await ctx.db
      .query("partnerUsageCounters")
      .withIndex("by_key_window_bucket", (q) =>
        q
          .eq("keyId", args.keyId)
          .eq("window", "month")
          .eq("bucket", monthBucket)
      )
      .first();

    const recent = await ctx.db
      .query("partnerItineraries")
      .withIndex("by_idempotency", (q) => q.eq("keyId", args.keyId))
      .order("desc")
      .take(20);

    return {
      generationsToday: dayCounter?.count ?? 0,
      generationsThisMonth: monthCounter?.count ?? 0,
      recent: recent.map((r) => ({
        itineraryId: r.itineraryId,
        destination: r.destination,
        days: r.days,
        status: r.status,
        source: r.source ?? null,
        createdAt: r.createdAt,
      })),
    };
  },
});

/** Aggregate totals across all (non-system) keys for the dashboard header. */
export const getSummary = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const keys = await ctx.db.query("partnerApiKeys").collect();
    const partnerKeys = keys.filter((k) => k.partnerRef !== "__system__");

    const now = Date.now();
    const dayBucket = new Date(now).toISOString().slice(0, 10);
    const monthBucket = new Date(now).toISOString().slice(0, 7);

    let generationsToday = 0;
    let generationsThisMonth = 0;
    for (const k of partnerKeys) {
      const day = await ctx.db
        .query("partnerUsageCounters")
        .withIndex("by_key_window_bucket", (q) =>
          q.eq("keyId", k._id).eq("window", "day").eq("bucket", dayBucket)
        )
        .first();
      const month = await ctx.db
        .query("partnerUsageCounters")
        .withIndex("by_key_window_bucket", (q) =>
          q.eq("keyId", k._id).eq("window", "month").eq("bucket", monthBucket)
        )
        .first();
      generationsToday += day?.count ?? 0;
      generationsThisMonth += month?.count ?? 0;
    }

    return {
      totalKeys: partnerKeys.length,
      activeKeys: partnerKeys.filter((k) => k.active).length,
      generationsToday,
      generationsThisMonth,
    };
  },
});

/**
 * Curated targets — kept in sync with `partnerPregenerate.ts`. Duplicated here
 * (instead of imported) because that module is a Node action and this is a V8
 * query. Used to compute coverage / missing cities for the admin panel.
 */
const PREGEN_CITIES = [
  "Paris, France",
  "London, United Kingdom",
  "Rome, Italy",
  "Barcelona, Spain",
  "Madrid, Spain",
  "Amsterdam, Netherlands",
  "Berlin, Germany",
  "Prague, Czech Republic",
  "Vienna, Austria",
  "Lisbon, Portugal",
  "Athens, Greece",
  "Santorini, Greece",
  "Venice, Italy",
  "Florence, Italy",
  "Milan, Italy",
  "Istanbul, Turkey",
  "Dubai, United Arab Emirates",
  "New York City, USA",
  "Los Angeles, USA",
  "San Francisco, USA",
  "Miami, USA",
  "Las Vegas, USA",
  "Cancun, Mexico",
  "Mexico City, Mexico",
  "Rio de Janeiro, Brazil",
  "Buenos Aires, Argentina",
  "Tokyo, Japan",
  "Kyoto, Japan",
  "Bangkok, Thailand",
  "Singapore",
  "Bali, Indonesia",
  "Hong Kong",
  "Seoul, South Korea",
  "Sydney, Australia",
  "Marrakech, Morocco",
  "Cairo, Egypt",
  "Cape Town, South Africa",
  "Budapest, Hungary",
  "Dublin, Ireland",
  "Edinburgh, United Kingdom",
];
const PREGEN_DURATIONS = [3, 4, 5, 7];

/**
 * Detailed pre-generation status for the admin panel.
 *
 * Returns the overall counts by status, the expected total (cities ×
 * durations), per-city coverage (which durations are ready / pending /
 * failed / missing), a list of failures, and the most recent activity — so
 * an admin can see exactly what has and hasn't been generated.
 */
export const getPregenStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const all = await ctx.db.query("partnerItineraries").collect();
    const pre = all.filter((r) => r.isPregenerated === true);

    // Overall status counts.
    const byStatus = { queued: 0, generating: 0, ready: 0, failed: 0 };
    let lastReadyAt: number | null = null;
    for (const r of pre) {
      if (r.status in byStatus) (byStatus as any)[r.status]++;
      if (r.readyAt && (lastReadyAt === null || r.readyAt > lastReadyAt)) {
        lastReadyAt = r.readyAt;
      }
    }

    // Index pre-gen records by destination → days → status.
    const map = new Map<string, Map<number, string>>();
    for (const r of pre) {
      const dest = r.destination;
      if (!map.has(dest)) map.set(dest, new Map());
      // Prefer a "ready" status over a stale earlier one if duplicates exist.
      const inner = map.get(dest)!;
      const existing = inner.get(r.days);
      if (existing !== "ready") inner.set(r.days, r.status);
    }

    // Per-city coverage against the curated target list.
    const cities = PREGEN_CITIES.map((dest) => {
      const inner = map.get(dest) ?? new Map<number, string>();
      const durations = PREGEN_DURATIONS.map((d) => ({
        days: d,
        status: inner.get(d) ?? "missing",
      }));
      const readyCount = durations.filter((x) => x.status === "ready").length;
      return {
        destination: dest,
        readyCount,
        total: PREGEN_DURATIONS.length,
        complete: readyCount === PREGEN_DURATIONS.length,
        durations,
      };
    });

    // Any pre-gen records for destinations NOT in the curated list (custom runs).
    const extraDestinations = [...map.keys()].filter(
      (d) => !PREGEN_CITIES.includes(d)
    );

    // Failures with their error messages.
    const failures = pre
      .filter((r) => r.status === "failed")
      .map((r) => ({
        destination: r.destination,
        days: r.days,
        error: r.error ?? null,
      }));

    const expectedTotal = PREGEN_CITIES.length * PREGEN_DURATIONS.length;
    const completeCities = cities.filter((c) => c.complete).length;

    return {
      expectedTotal,
      readyTotal: byStatus.ready,
      inProgressTotal: byStatus.queued + byStatus.generating,
      failedTotal: byStatus.failed,
      byStatus,
      completeCities,
      totalCities: PREGEN_CITIES.length,
      lastReadyAt,
      cities,
      failures,
      extraDestinations,
    };
  },
});

/**
 * Trigger pre-generation of top destinations from the in-app admin panel.
 * Gated by the app admin session, then delegates to the existing action.
 */
export const triggerPregeneration = action({
  args: {
    token: v.string(),
    cities: v.optional(v.array(v.string())),
    durations: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; scheduled: number }> => {
    // Resolve admin via a query (actions can't read the db directly).
    const isAdmin = await ctx.runQuery(api.admin.isAdmin, { token: args.token });
    if (!isAdmin) throw new ConvexError("Unauthorized.");

    const adminToken = process.env.PARTNER_ADMIN_TOKEN;
    if (!adminToken) throw new ConvexError("Pre-generation is not configured.");

    return await ctx.runAction(api.partnerPregenerate.triggerPregeneration, {
      adminToken,
      cities: args.cities,
      durations: args.durations,
    });
  },
});

// ---------------------------------------------------------------------------
// Partner accounts (portal) — admin invite + listing
// ---------------------------------------------------------------------------

const PORTAL_BASE_URL = "https://planeraai.app";
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** List all partner portal accounts (admin view). */
export const listAccounts = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<any[]> => {
    await requireAdmin(ctx, args.token);
    return await ctx.runQuery(internal.partnerPortal.listAccountsInternal, {});
  },
});

/**
 * Invite a partner: create (or re-invite) their portal account and email them
 * a signup link. The partner then sets a password and self-manages API keys.
 * Gated by the app admin session.
 */
export const invitePartner = action({
  args: {
    token: v.string(),
    email: v.string(),
    partnerName: v.string(),
    partnerRef: v.string(),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; email: string; signupUrl: string; emailSent: boolean }> => {
    const isAdmin = await ctx.runQuery(api.admin.isAdmin, { token: args.token });
    if (!isAdmin) throw new ConvexError("Unauthorized.");

    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    const partnerName = args.partnerName.trim();
    const partnerRef =
      args.partnerRef.trim() ||
      email.split("@")[0].replace(/[^a-z0-9]+/g, "-");
    if (!partnerName) throw new ConvexError("Partner name is required.");

    const invite = await ctx.runMutation(internal.partnerPortal.createInvite, {
      email,
      partnerName,
      partnerRef,
      rateLimitPerMin: args.rateLimitPerMin ?? DEFAULTS.rateLimitPerMin,
      dailyCap: args.dailyCap ?? DEFAULTS.dailyCap,
      monthlyCap: args.monthlyCap ?? DEFAULTS.monthlyCap,
      inviteTtlMs: INVITE_TTL_MS,
    });

    const signupUrl = `${PORTAL_BASE_URL}/partners/signup?token=${invite.rawToken}`;
    const html = invitePartnerEmailHtml({ partnerName, signupUrl });
    const text =
      `You've been invited to the Planera AI Partner API.\n\n` +
      `Create your account and password here (link valid 7 days):\n${signupUrl}\n\n` +
      `Once signed in you can generate your own API key and start building.\n\n` +
      `Docs: ${PORTAL_BASE_URL}/partners/docs`;

    let emailSent = false;
    try {
      const res = await ctx.runAction(internal.postmark.sendRawEmail, {
        to: email,
        subject: "Your Planera AI Partner API invitation",
        html,
        text,
      });
      emailSent = !!res?.success;
    } catch (e) {
      console.error("[invitePartner] email send failed:", e);
    }

    return { ok: true, email, signupUrl, emailSent };
  },
});

function invitePartnerEmailHtml(opts: { partnerName: string; signupUrl: string }): string {
  const { partnerName, signupUrl } = opts;
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${PORTAL_BASE_URL}/logo.png" alt="Planera AI" width="150" style="display:inline-block;width:150px;height:auto;border:0;outline:none;text-decoration:none;" />
    </div>
    <div style="background:#16161c;border:1px solid #26262e;border-radius:16px;border-top:4px solid #FFE500;padding:32px;">
      <h1 style="margin:0 0 12px;color:#fff;font-size:22px;">You're invited to the Planera AI Partner API</h1>
      <p style="margin:0 0 20px;color:#b8b8c4;font-size:15px;line-height:1.6;">
        Hi ${escapeHtml(partnerName)}, an account has been created for you. Set your
        password to get started — then generate your own API key and start
        building AI travel itineraries into your product.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${signupUrl}" style="display:inline-block;background:#FFE500;color:#111;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;">Create your account</a>
      </div>
      <p style="margin:0 0 8px;color:#8a8a96;font-size:13px;line-height:1.6;">
        This link is valid for 7 days. If the button doesn't work, paste this URL
        into your browser:
      </p>
      <p style="margin:0;word-break:break-all;color:#FFE500;font-size:12px;">${signupUrl}</p>
    </div>
    <p style="text-align:center;margin:24px 0 0;color:#6a6a76;font-size:12px;">
      Read the developer docs at ${PORTAL_BASE_URL}/partners/docs
    </p>
  </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
