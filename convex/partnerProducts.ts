import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { sha256Hex } from "./partnerApiAuth";

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
};

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
    return products
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => ({
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
        status: p.status,
        rejectionReason: p.rejectionReason ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
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
    await ctx.db.patch(args.productId, {
      ...cleanFields(args),
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
