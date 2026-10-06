import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { searchUnsplashPhotos, pingUnsplashDownload, type UnsplashSearchResult } from "./lib/unsplashSearch";
import { sha256Hex } from "./partnerApiAuth";
import { resolveHomeIata } from "../lib/homeAirport";

/**
 * Partner product listings — the self-serve supplier surface.
 *
 * Suppliers (`partnerAccounts.kind === "supplier"`) submit and manage their own
 * product/offer listings here, authenticated by their partner-portal session
 * token (same `ps_…` token used by `partnerPortal`). Every create/edit drops the
 * listing back to status "pending"; an operator approves it in /partner-admin
 * (see `partnerApiAdmin.listPendingProducts` / `setProductStatus`) before it
 * goes live. All ops are scoped to the caller's own `accountId`.
 */

const PRODUCT_TYPE = v.union(
  v.literal("flight"),
  v.literal("hotel"),
  v.literal("tour"),
  v.literal("experience"),
  v.literal("other")
);

/** Resolve a partner account from a session token, or null if invalid. */
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

/** Shared editable fields for create/update. */
const PRODUCT_FIELDS = {
  type: PRODUCT_TYPE,
  title: v.string(),
  description: v.optional(v.string()),
  destination: v.optional(v.string()),
  city: v.optional(v.string()),
  country: v.optional(v.string()),
  price: v.optional(v.float64()),
  currency: v.optional(v.string()),
  bookingUrl: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  // Home-airport IATA codes this listing is for; ["*"] = everyone. The
  // operator can adjust during review.
  markets: v.optional(v.array(v.string())),
  // Set when the supplier picked the cover from Unsplash in the portal.
  imageCredit: v.optional(
    v.object({
      imageUrl: v.string(),
      photographer: v.string(),
      photographerUrl: v.optional(v.string()),
    })
  ),
};

const IATA_RE = /^[A-Z]{3}$/;

/** Upper-case, de-dupe, validate IATA codes; "*" (everyone) wins over codes. */
export function normalizeMarkets(raw?: string[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const codes = Array.from(new Set(raw.map((m) => String(m).trim().toUpperCase()).filter(Boolean)));
  if (codes.includes("*")) return ["*"];
  const bad = codes.filter((m) => !IATA_RE.test(m));
  if (bad.length) throw new ConvexError(`Not an airport code: ${bad.join(", ")}`);
  return codes.length ? codes : undefined;
}

function cleanFields(args: any) {
  const clean = (s?: string) => {
    const t = s?.trim();
    return t ? t : undefined;
  };
  const title = (args.title ?? "").trim();
  if (!title) throw new ConvexError("Title is required.");
  if (args.price != null && (isNaN(args.price) || args.price < 0)) {
    throw new ConvexError("Price must be a positive number.");
  }
  const imageUrls = Array.isArray(args.imageUrls)
    ? args.imageUrls.map((u: string) => u.trim()).filter(Boolean)
    : undefined;
  return {
    type: args.type,
    title,
    description: clean(args.description),
    destination: clean(args.destination),
    city: clean(args.city),
    country: clean(args.country),
    price: args.price != null ? args.price : undefined,
    currency: clean(args.currency)?.toUpperCase(),
    bookingUrl: clean(args.bookingUrl),
    imageUrls: imageUrls && imageUrls.length ? imageUrls : undefined,
    markets: normalizeMarkets(args.markets),
    // A credit only makes sense for a photo that's actually in the list.
    imageCredit:
      args.imageCredit && imageUrls?.includes(args.imageCredit.imageUrl)
        ? args.imageCredit
        : undefined,
  };
}

/** Tap totals for one product: taps, unique people, supplier-site visits, by source. */
export async function clickStats(ctx: any, productId: any) {
  const rows = await ctx.db
    .query("partnerProductClicks")
    .withIndex("by_product_created", (q: any) => q.eq("productId", productId))
    .order("desc")
    .take(5000);
  const people = new Set<string>();
  const people7d = new Set<string>();
  const bySource: Record<string, number> = {};
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let siteVisits = 0;
  let taps7d = 0;
  for (const r of rows) {
    if (r.viewerKey) people.add(r.viewerKey);
    if (r.createdAt >= weekAgo) {
      taps7d++;
      if (r.viewerKey) people7d.add(r.viewerKey);
    }
    if (r.kind === "site") siteVisits++;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }
  return {
    taps: rows.length,
    uniquePeople: people.size,
    siteVisits,
    taps7d,
    uniquePeople7d: people7d.size,
    bySource,
    lastAt: rows[0]?.createdAt ?? null,
  };
}

/** List the authenticated supplier's own product listings (newest first). */
export const listMyProducts = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) return null;
    const products = await ctx.db
      .query("partnerProducts")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const sorted = products.sort((a, b) => b.createdAt - a.createdAt);
    const out = [];
    for (const p of sorted) {
      out.push({
        id: p._id,
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
        imageCredit: p.imageCredit ?? null,
        markets: p.markets ?? [],
        // Archived listings keep their history but skip the read.
        clicks: p.status === "archived" ? null : await clickStats(ctx, p._id),
        status: p.status,
        rejectionReason: p.rejectionReason ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

/** Create a new product listing (lands in "pending"). */
export const createProduct = mutation({
  args: { token: v.string(), ...PRODUCT_FIELDS },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");

    // Light cap so a runaway client can't flood the review queue.
    const existing = await ctx.db
      .query("partnerProducts")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    if (existing.filter((p) => p.status !== "archived").length >= 5000) {
      throw new ConvexError("Product limit reached. Archive some listings first.");
    }

    const now = Date.now();
    const id = await ctx.db.insert("partnerProducts", {
      accountId: account._id,
      partnerRef: account.partnerRef,
      ...cleanFields(args),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true as const, id };
  },
});

/** Update one of the supplier's own listings; re-enters the review queue. */
export const updateProduct = mutation({
  args: { token: v.string(), productId: v.id("partnerProducts"), ...PRODUCT_FIELDS },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    const product = await ctx.db.get(args.productId);
    if (!product || product.accountId !== account._id) {
      throw new ConvexError("Product not found.");
    }
    const fields = cleanFields(args);
    // Omitted = unchanged: an edit must never wipe the cover an operator picked
    // or the markets they set.
    const imageUrls = fields.imageUrls ?? product.imageUrls;
    const markets = fields.markets ?? product.markets;
    const imageCredit =
      fields.imageCredit ??
      (product.imageCredit && imageUrls?.includes(product.imageCredit.imageUrl)
        ? product.imageCredit
        : undefined);
    await ctx.db.patch(args.productId, {
      ...fields,
      imageUrls,
      markets,
      imageCredit,
      status: "pending",
      rejectionReason: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Insert many product rows for an account; skips bad rows, never fails the batch. */
async function insertRows(
  ctx: any,
  accountId: any,
  partnerRef: string,
  products: any[]
): Promise<{ created: number; errors: { row: number; message: string }[] }> {
  const now = Date.now();
  let created = 0;
  const errors: { row: number; message: string }[] = [];
  for (let i = 0; i < products.length; i++) {
    try {
      const fields = cleanFields(products[i]);
      await ctx.db.insert("partnerProducts", {
        accountId,
        partnerRef,
        ...fields,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      created++;
    } catch (e) {
      errors.push({ row: i, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { created, errors };
}

/**
 * Bulk-create product listings from a CSV import (partner-session authed). The
 * client chunks large files into ≤500-row calls. Bad rows are skipped and
 * reported rather than failing the whole batch.
 */
export const bulkCreateProducts = mutation({
  args: { token: v.string(), products: v.array(v.object(PRODUCT_FIELDS)) },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    if (args.products.length === 0) throw new ConvexError("No rows to import.");
    if (args.products.length > 500) {
      throw new ConvexError("Import up to 500 rows per request.");
    }
    return await insertRows(ctx, account._id, account.partnerRef, args.products);
  },
});

/**
 * Internal ingest used by the `/v1/products` HTTP endpoint (API key push).
 * httpActions can't touch the db directly, so they call this via runMutation.
 */
export const ingestForAccount = internalMutation({
  args: {
    accountId: v.id("partnerAccounts"),
    partnerRef: v.string(),
    products: v.array(v.object(PRODUCT_FIELDS)),
  },
  handler: async (ctx, args) => {
    return await insertRows(ctx, args.accountId, args.partnerRef, args.products);
  },
});

/** Resolve a supplier session for actions (which can't read the db). */
export const supplierAccountIdFromToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    return account ? account._id : null;
  },
});

/** Unsplash search for the supplier portal's cover-image picker. */
export const searchUnsplashForSupplier = action({
  args: { token: v.string(), query: v.string(), page: v.optional(v.number()) },
  handler: async (ctx, args): Promise<UnsplashSearchResult> => {
    const accountId = await ctx.runQuery(internal.partnerProducts.supplierAccountIdFromToken, {
      token: args.token,
    });
    if (!accountId) throw new ConvexError("Not authenticated.");
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) throw new ConvexError("Image search is not configured.");
    try {
      return await searchUnsplashPhotos(accessKey, args.query, args.page ?? 1);
    } catch (e) {
      throw new ConvexError(e instanceof Error ? e.message : "Image search failed.");
    }
  },
});

/** Tell Unsplash a picked photo is in use (their API terms). Supplier-authed. */
export const markUnsplashUsed = action({
  args: { token: v.string(), downloadLocation: v.string() },
  handler: async (ctx, args) => {
    const accountId = await ctx.runQuery(internal.partnerProducts.supplierAccountIdFromToken, {
      token: args.token,
    });
    if (!accountId) return null;
    await pingUnsplashDownload(process.env.UNSPLASH_ACCESS_KEY, args.downloadLocation);
    return null;
  },
});

/** Archive (soft-delete) one of the supplier's own listings. */
export const archiveProduct = mutation({
  args: { token: v.string(), productId: v.id("partnerProducts") },
  handler: async (ctx, args) => {
    const account = await accountFromToken(ctx, args.token);
    if (!account) throw new ConvexError("Not authenticated.");
    const product = await ctx.db.get(args.productId);
    if (!product || product.accountId !== account._id) {
      throw new ConvexError("Product not found.");
    }
    await ctx.db.patch(args.productId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

// ─────────────────────────────────────────────────────────
// Traveler-facing: approved listings on the app home screen
// ─────────────────────────────────────────────────────────

/** Types that make sense as a home "tours & packages" card. Flights have their own surfaces. */
const HOME_TYPES = new Set(["tour", "experience", "hotel", "other"]);

/** Suppliers often paste bare domains ("www.x.gr"); make them openable. */
function normalizeUrl(url?: string): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

/** App user id + resolved home-airport IATA for a session token, if valid. */
async function viewerFromToken(
  ctx: any,
  token?: string
): Promise<{ userId: string | null; homeIata: string | null }> {
  if (!token) return { userId: null, homeIata: null };
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .unique();
  if (!session || (session.expiresAt && session.expiresAt < Date.now())) {
    return { userId: null, homeIata: null };
  }
  const settings = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q: any) => q.eq("userId", session.userId))
    .unique();
  return {
    userId: session.userId,
    homeIata: resolveHomeIata(settings?.homeAirport) ?? null,
  };
}

/** Is a listing targeted at this home airport? ["*"] = everyone; unset = nobody. */
export function productVisibleTo(markets: string[] | undefined, homeIata: string | null): boolean {
  if (!markets || markets.length === 0) return false;
  if (markets.includes("*")) return true;
  return !!homeIata && markets.includes(homeIata);
}

/**
 * Approved supplier products for the home "Tours by local partners" row,
 * newest first, joined with the supplier's display name.
 *
 * Market-guarded: pass the app session `token` and only listings targeted at
 * the user's home airport (or at everyone, "*") come back. Without a token, or
 * with no home airport set, only everyone-targeted listings are returned.
 */
export const listForHome = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { homeIata } = await viewerFromToken(ctx, args.token);
    const approved = await ctx.db
      .query("partnerProducts")
      .withIndex("by_status_created", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(40);

    const accountNames = new Map<string, string | null>();
    const out = [];
    for (const p of approved) {
      if (!HOME_TYPES.has(p.type)) continue;
      if (!productVisibleTo(p.markets, homeIata)) continue;
      if (!accountNames.has(p.accountId)) {
        const account = await ctx.db.get(p.accountId);
        accountNames.set(
          p.accountId,
          account && account.status === "active" ? account.partnerName : null
        );
      }
      const partnerName = accountNames.get(p.accountId);
      if (!partnerName) continue; // disabled supplier → hide their listings
      out.push({
        _id: p._id,
        type: p.type,
        title: p.title,
        description: p.description,
        destination: p.city || p.destination || p.country,
        country: p.country,
        price: p.price,
        currency: p.currency ?? "EUR",
        bookingUrl: normalizeUrl(p.bookingUrl),
        imageUrl: p.imageUrls?.[0],
        // Unsplash credit, only while the picked photo is still the cover.
        imageCredit:
          p.imageCredit && p.imageCredit.imageUrl === p.imageUrls?.[0]
            ? {
                photographer: p.imageCredit.photographer,
                photographerUrl: p.imageCredit.photographerUrl,
              }
            : undefined,
        partnerName,
      });
      if (out.length >= 12) break;
    }
    return out;
  },
});

const CLICK_SOURCES = new Set(["ios", "android", "web_landing", "web_dashboard"]);

/**
 * Record a tap on a supplier product card. `kind` "open" = opened the detail
 * sheet (app), "site" = went out to the supplier's website. Pass the app
 * `token` when signed in, else an anonymous `visitorId`, so the admin can count
 * unique people. Also bumps the legacy `homeClicks` total.
 */
export const trackHomeClick = mutation({
  args: {
    productId: v.id("partnerProducts"),
    kind: v.optional(v.union(v.literal("open"), v.literal("site"))),
    source: v.optional(v.string()),
    token: v.optional(v.string()),
    visitorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product || product.status !== "approved") return null;
    const { userId, homeIata } = await viewerFromToken(ctx, args.token);
    const visitor = args.visitorId?.trim().slice(0, 64);
    await ctx.db.insert("partnerProductClicks", {
      productId: args.productId,
      accountId: product.accountId,
      kind: args.kind ?? "open",
      source: args.source && CLICK_SOURCES.has(args.source) ? args.source : "unknown",
      viewerKey: userId ? `u:${userId}` : visitor ? `v:${visitor}` : undefined,
      homeIata: homeIata ?? undefined,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.productId, {
      homeClicks: (product.homeClicks ?? 0) + 1,
    });
    return null;
  },
});
