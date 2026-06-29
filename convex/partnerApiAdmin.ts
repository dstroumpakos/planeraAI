import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sha256Hex, buildCacheKey, normalizeDestinationKey } from "./partnerApiAuth";
import { CURATED_CITIES, DEFAULT_DURATIONS } from "./partnerPregenConfig";

/**
 * Partner API — admin surface for the planeraai-web partner dashboard.
 *
 * These functions are gated by a dedicated admin token (env var
 * `PARTNER_ADMIN_TOKEN`), completely separate from the app's user sessions.
 * The dashboard supplies the token with every call. The raw API key and
 * webhook secret are returned exactly ONCE at creation and never stored in
 * plaintext.
 */

function assertAdmin(token: string) {
  const expected = process.env.PARTNER_ADMIN_TOKEN;
  if (!expected) {
    throw new ConvexError("Partner admin is not configured.");
  }
  if (token !== expected) {
    throw new ConvexError("Unauthorized.");
  }
}

/** Generate a random, URL-safe-ish secret of the given prefix. */
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

/**
 * Create a new partner API key. Returns the RAW key + webhook secret once.
 * Store them securely — they cannot be retrieved again.
 */
export const createPartnerKey = mutation({
  args: {
    adminToken: v.string(),
    partnerName: v.string(),
    partnerRef: v.string(),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);

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
      // shown once:
      apiKey: rawKey,
      webhookSecret,
    };
  },
});

/** List all partner keys (no secrets/hashes). */
export const listPartnerKeys = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const keys = await ctx.db.query("partnerApiKeys").collect();
    return keys.map((k) => ({
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

/** Revoke (deactivate) a partner key. */
export const revokePartnerKey = mutation({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: false, revokedAt: Date.now() });
    return { ok: true };
  },
});

/** Re-activate a previously revoked key. */
export const reactivatePartnerKey = mutation({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const key = await ctx.db.get(args.keyId);
    if (!key) throw new ConvexError("Key not found.");
    await ctx.db.patch(args.keyId, { active: true, revokedAt: undefined });
    return { ok: true };
  },
});

/** Update the rate limit / generation caps for a key. */
export const updatePartnerKeyLimits = mutation({
  args: {
    adminToken: v.string(),
    keyId: v.id("partnerApiKeys"),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
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
export const getPartnerUsage = query({
  args: { adminToken: v.string(), keyId: v.id("partnerApiKeys") },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
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

/**
 * Pre-generation status board. For every pre-gen city (curated list + cities
 * partners have actually requested) and every standard duration, report whether
 * the itinerary is cached & ready, currently generating, failed, or still
 * missing — so the operator can see coverage gaps at a glance.
 */
export const getPregenerationStatus = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);

    // Demand rows (cities partners asked for live). Group by destination so a
    // requested city is shown alongside the curated ones.
    const demandRows = await ctx.db.query("partnerDemand").collect();
    const demandByKey = new Map<
      string,
      { destination: string; count: number; covered: boolean; lastRequestedAt: number }
    >();
    for (const d of demandRows) {
      const cur = demandByKey.get(d.destinationKey);
      if (cur) {
        cur.count += d.count;
        cur.covered = cur.covered && d.covered;
        cur.lastRequestedAt = Math.max(cur.lastRequestedAt, d.lastRequestedAt);
      } else {
        demandByKey.set(d.destinationKey, {
          destination: d.destination,
          count: d.count,
          covered: d.covered,
          lastRequestedAt: d.lastRequestedAt,
        });
      }
    }

    // Build the ordered city list: curated first, then any demand-only cities.
    const cityList: Array<{ destination: string; fromDemand: boolean }> = [];
    const seen = new Set<string>();
    for (const c of CURATED_CITIES) {
      const key = normalizeDestinationKey(c);
      seen.add(key);
      cityList.push({ destination: c, fromDemand: false });
    }
    for (const [key, info] of demandByKey) {
      if (!seen.has(key)) {
        seen.add(key);
        cityList.push({ destination: info.destination, fromDemand: true });
      }
    }

    const summary = { ready: 0, inProgress: 0, failed: 0, missing: 0 };

    const cities = [];
    for (const { destination, fromDemand } of cityList) {
      const destinationKey = normalizeDestinationKey(destination);
      const demand = demandByKey.get(destinationKey);

      const slots = [];
      for (const days of DEFAULT_DURATIONS) {
        const cacheKey = buildCacheKey(destination, days, []);
        const records = await ctx.db
          .query("partnerItineraries")
          .withIndex("by_cacheKey", (q) => q.eq("cacheKey", cacheKey))
          .take(100);

        // Reduce all records for this slot to a single status.
        let status: "ready" | "in_progress" | "failed" | "missing" = "missing";
        let readyAt: number | null = null;
        let error: string | null = null;
        for (const r of records) {
          if (r.status === "ready" && r.itinerary) {
            status = "ready";
            readyAt = r.readyAt ?? r.createdAt;
            break; // ready wins outright
          }
          if (r.status === "queued" || r.status === "generating") {
            if (status !== "in_progress") status = "in_progress";
          } else if (r.status === "failed" && status === "missing") {
            status = "failed";
            error = r.error ?? "Generation failed.";
          }
        }

        summary[
          status === "ready"
            ? "ready"
            : status === "in_progress"
            ? "inProgress"
            : status === "failed"
            ? "failed"
            : "missing"
        ]++;

        slots.push({ days, status, readyAt, error });
      }

      cities.push({
        destination,
        destinationKey,
        fromDemand,
        demandCount: demand?.count ?? 0,
        demandCovered: demand?.covered ?? null,
        lastRequestedAt: demand?.lastRequestedAt ?? null,
        slots,
      });
    }

    return {
      durations: DEFAULT_DURATIONS,
      summary,
      cities,
      generatedAt: Date.now(),
    };
  },
});

// ---------------------------------------------------------------------------
// Partner applications (inbound "Become a partner" submissions)
// ---------------------------------------------------------------------------

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const PORTAL_BASE_URL = "https://www.planeraai.app";

/** List partner applications (newest first) for the admin review queue. */
export const listApplications = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const apps = await ctx.db
      .query("partnerApplications")
      .withIndex("by_created")
      .order("desc")
      .take(200);
    return apps.map((a) => ({
      id: a._id,
      companyName: a.companyName,
      website: a.website ?? null,
      contactName: a.contactName,
      email: a.email,
      partnershipTypes: a.partnershipTypes,
      monthlyVolume: a.monthlyVolume ?? null,
      message: a.message ?? null,
      status: a.status,
      createdAt: a.createdAt,
      reviewedAt: a.reviewedAt ?? null,
    }));
  },
});

/** Update an application's review status (dismiss / re-open / mark invited). */
export const setApplicationStatus = mutation({
  args: {
    adminToken: v.string(),
    id: v.id("partnerApplications"),
    status: v.union(
      v.literal("new"),
      v.literal("invited"),
      v.literal("dismissed")
    ),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const app = await ctx.db.get(args.id);
    if (!app) throw new ConvexError("Application not found.");
    await ctx.db.patch(args.id, {
      status: args.status,
      reviewedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Supplier product review queue (self-serve partner products)
// ---------------------------------------------------------------------------

/** List supplier product listings for review (pending first, newest first). */
export const listPendingProducts = query({
  args: {
    adminToken: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("archived")
      )
    ),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const status = args.status ?? "pending";
    const products = await ctx.db
      .query("partnerProducts")
      .withIndex("by_status_created", (q) => q.eq("status", status))
      .order("desc")
      .take(200);

    // Enrich with the submitting partner's name/email.
    const out = [];
    for (const p of products) {
      const account = await ctx.db.get(p.accountId);
      out.push({
        id: p._id,
        partnerName: account?.partnerName ?? p.partnerRef,
        partnerEmail: account?.email ?? null,
        type: p.type,
        title: p.title,
        description: p.description ?? null,
        destination: p.destination ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        price: p.price ?? null,
        currency: p.currency ?? null,
        bookingUrl: p.bookingUrl ?? null,
        imageUrls: p.imageUrls ?? [],
        status: p.status,
        rejectionReason: p.rejectionReason ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

/** Approve or reject a supplier product listing. */
export const setProductStatus = mutation({
  args: {
    adminToken: v.string(),
    productId: v.id("partnerProducts"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("archived")
    ),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertAdmin(args.adminToken);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new ConvexError("Product not found.");
    await ctx.db.patch(args.productId, {
      status: args.status,
      rejectionReason:
        args.status === "rejected" ? args.rejectionReason?.trim() || undefined : undefined,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Invite a partner from the admin dashboard: create (or re-issue) their portal
 * account and email a signup link. Optionally tied to an application, which is
 * marked "invited" on success. Gated by the standalone PARTNER_ADMIN_TOKEN.
 */
export const invitePartner = action({
  args: {
    adminToken: v.string(),
    email: v.string(),
    partnerName: v.string(),
    partnerRef: v.optional(v.string()),
    rateLimitPerMin: v.optional(v.float64()),
    dailyCap: v.optional(v.float64()),
    monthlyCap: v.optional(v.float64()),
    applicationId: v.optional(v.id("partnerApplications")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; email: string; signupUrl: string; emailSent: boolean }> => {
    assertAdmin(args.adminToken);

    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid email address.");
    }
    const partnerName = args.partnerName.trim();
    if (!partnerName) throw new ConvexError("Partner name is required.");
    const partnerRef =
      args.partnerRef?.trim() ||
      email.split("@")[0].replace(/[^a-z0-9]+/g, "-");

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
    const html = inviteEmailHtml({ partnerName, signupUrl });
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
      emailSent = !!(res as any)?.success;
    } catch (e) {
      console.error("[partnerApiAdmin.invitePartner] email send failed:", e);
    }

    if (args.applicationId) {
      await ctx.runMutation(api.partnerApiAdmin.setApplicationStatus, {
        adminToken: args.adminToken,
        id: args.applicationId,
        status: "invited",
      });
    }

    return { ok: true, email, signupUrl, emailSent };
  },
});

function inviteEmailHtml(opts: { partnerName: string; signupUrl: string }): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const { partnerName, signupUrl } = opts;
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${PORTAL_BASE_URL}/logo.png" alt="Planera AI" width="150" style="display:inline-block;width:150px;height:auto;border:0;outline:none;text-decoration:none;" />
    </div>
    <div style="background:#16161c;border:1px solid #26262e;border-radius:16px;border-top:4px solid #FFE500;padding:32px;">
      <h1 style="margin:0 0 12px;color:#fff;font-size:22px;">You're invited to the Planera AI Partner API</h1>
      <p style="margin:0 0 20px;color:#b8b8c4;font-size:15px;line-height:1.6;">
        Hi ${esc(partnerName)}, an account has been created for you. Set your
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
  </div></body></html>`;
}

