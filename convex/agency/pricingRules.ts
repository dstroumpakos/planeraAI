/**
 * Planera for Travel Agencies — pricing rules CRUD.
 *
 * A rule is the agency's commercial policy: markup, service fees, FX buffer,
 * rounding. Rules resolve most-specific-first (destination > supplier >
 * agency-default, see `quote.resolvePricingRule`), so an agency can hold a
 * house margin and still override it for one supplier or one destination.
 *
 * Every rule is parsed through `parsePricingRule` before it is stored: the
 * table column is `v.any()` (the shape evolves faster than the schema), so this
 * is the ONLY thing standing between a typo and a mis-priced quote.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { parsePricingRule } from "./pricing";
import { guard, invalid, notFound } from "./errors";
import { assertTenant, audit, requireAccess, requireAccessRW } from "./store";
import { normalizeIata } from "./validation";

const ruleScope = v.union(
  v.literal("agency"),
  v.literal("supplier"),
  v.literal("destination"),
  v.literal("product"),
  v.literal("package"),
);

type RuleScope = "agency" | "supplier" | "destination" | "product" | "package";

/**
 * A scope's selector must identify something real. The agency default has no
 * selector at all — allowing one would create two "defaults" that silently
 * shadow each other.
 */
function normalizeSelector(scope: RuleScope, selector: string | undefined): string | undefined {
  if (scope === "agency") {
    if (selector) throw invalid("the agency default rule takes no selector");
    return undefined;
  }
  const value = String(selector ?? "").trim();
  if (!value) throw invalid(`a ${scope} rule needs a selector`);
  if (scope === "destination") return normalizeIata(value, "destination");
  if (value.length > 64) throw invalid("selector is too long");
  return value;
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) =>
    guard("pricingRules.list", async () => {
      const access = await requireAccess(ctx, args.token);
      const rows = await ctx.db
        .query("agencyPricingRules")
        .withIndex("by_agency", (q) => q.eq("agencyId", access.agencyId))
        .collect();
      // Most specific first — the same order the resolver applies them in.
      const rank: Record<string, number> = { package: 0, product: 1, destination: 2, supplier: 3, agency: 4 };
      return rows.sort((a, b) => (rank[a.scope] ?? 9) - (rank[b.scope] ?? 9));
    }),
});

/** Create or replace the rule at one (scope, selector) address. */
export const upsert = mutation({
  args: {
    token: v.string(),
    scope: ruleScope,
    selector: v.optional(v.string()),
    rule: v.any(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) =>
    guard("pricingRules.upsert", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const selector = normalizeSelector(args.scope, args.selector);

      let rule;
      try {
        rule = parsePricingRule(args.rule);
      } catch (e) {
        throw invalid((e as Error).message);
      }

      const existing = (
        await ctx.db
          .query("agencyPricingRules")
          .withIndex("by_agency_scope", (q) =>
            q.eq("agencyId", access.agencyId).eq("scope", args.scope),
          )
          .collect()
      ).find((r) => (r.selector ?? undefined) === selector);

      const now = Date.now();
      const active = args.active ?? true;
      let ruleId;
      if (existing) {
        await ctx.db.patch(existing._id, { rule, active, updatedAt: now });
        ruleId = existing._id;
      } else {
        ruleId = await ctx.db.insert("agencyPricingRules", {
          agencyId: access.agencyId,
          scope: args.scope,
          selector,
          rule,
          active,
          createdAt: now,
        });
      }

      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "pricingRule.upsert",
        targetType: "agencyPricingRule",
        targetId: ruleId,
        meta: { scope: args.scope, selector, active, ...rule },
      });
      return await ctx.db.get(ruleId);
    }),
});

export const remove = mutation({
  args: { token: v.string(), ruleId: v.id("agencyPricingRules") },
  handler: async (ctx, args) =>
    guard("pricingRules.remove", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.ruleId);
      assertTenant(access, row);
      await ctx.db.delete(args.ruleId);
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: "pricingRule.remove",
        targetType: "agencyPricingRule",
        targetId: args.ruleId,
        meta: { scope: row!.scope, selector: row!.selector },
      });
      return { ok: true };
    }),
});

export const setActive = mutation({
  args: { token: v.string(), ruleId: v.id("agencyPricingRules"), active: v.boolean() },
  handler: async (ctx, args) =>
    guard("pricingRules.setActive", async () => {
      const access = await requireAccessRW(ctx, args.token, "manager");
      const row = await ctx.db.get(args.ruleId);
      assertTenant(access, row);
      if (!row) throw notFound("pricing rule");
      await ctx.db.patch(args.ruleId, { active: args.active, updatedAt: Date.now() });
      await audit(ctx, {
        agencyId: access.agencyId,
        actorUserId: access.userId,
        action: args.active ? "pricingRule.enable" : "pricingRule.disable",
        targetType: "agencyPricingRule",
        targetId: args.ruleId,
      });
      return { ok: true };
    }),
});
