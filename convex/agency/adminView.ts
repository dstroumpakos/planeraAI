/**
 * Operator view of the agency tenants.
 *
 * A signup email says an agency arrived; this says how they are doing a week
 * later, which is the question that actually decides whether to call them. The
 * useful signal is not "how many quotes" — it is where each one stopped:
 * a workspace with no supplier connected never got started, and one with
 * quotes but nothing sent got started and stalled.
 *
 * Gated by the app's own admin system, the same way `partnerAdminApp` is: the
 * caller passes their normal session token and must be an admin. Nothing here
 * is reachable from an agency session, and it deliberately reads NO supplier
 * credentials — not even the encrypted envelopes.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { assertAdmin } from "../admin";

/** How many tenants a single call will summarise. */
const MAX_AGENCIES = 200;
/** Per-agency scan ceiling, so one busy tenant cannot blow the read limit. */
const MAX_ROWS_PER_AGENCY = 200;

async function requireAdmin(ctx: any, token: string): Promise<void> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) throw new ConvexError("Unauthorized.");
  await assertAdmin(ctx, session.userId);
}

export const listAgencies = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const agencies = await ctx.db.query("agencies").take(MAX_AGENCIES);
    const now = Date.now();

    const rows = await Promise.all(
      agencies.map(async (agency) => {
        const [members, connections, quotes] = await Promise.all([
          ctx.db
            .query("agencyMembers")
            .withIndex("by_agency", (q) => q.eq("agencyId", agency._id))
            .take(MAX_ROWS_PER_AGENCY),
          ctx.db
            .query("supplierConnections")
            .withIndex("by_agency", (q) => q.eq("agencyId", agency._id))
            .take(MAX_ROWS_PER_AGENCY),
          ctx.db
            .query("quotes")
            .withIndex("by_agency", (q) => q.eq("agencyId", agency._id))
            .take(MAX_ROWS_PER_AGENCY),
        ]);

        const owner = members.find((m) => m.role === "owner");
        const ownerUser = owner ? await ctx.db.get(owner.userId) : null;
        const live = connections.filter((c) => !c.revokedAt);

        const sent = quotes.filter((q) => q.sentAt).length;
        const accepted = quotes.filter((q) => q.acceptedAt).length;
        const lastQuoteAt = quotes.reduce((max, q) => Math.max(max, q.createdAt), 0);

        /**
         * Where this tenant stopped. Ordered as the funnel actually runs, so
         * the first unmet step is the one reported — that is the step worth a
         * phone call, and a raw count would not tell you which it is.
         */
        const stage =
          live.length === 0
            ? ("no_supplier" as const)
            : quotes.length === 0
              ? ("no_quote" as const)
              : sent === 0
                ? ("not_sent" as const)
                : accepted === 0
                  ? ("not_accepted" as const)
                  : ("active" as const);

        return {
          agencyId: agency._id,
          name: agency.name,
          slug: agency.slug,
          status: agency.status,
          currency: agency.defaultCurrency,
          ownerEmail: ownerUser?.email ?? null,
          createdAt: agency.createdAt,
          members: members.length,
          connections: live.length,
          // Suppliers by name, never credentials — this screen has no business
          // touching an agency's keys, even the sealed ones.
          connectorIds: live.map((c) => c.connectorId),
          quotes: quotes.length,
          quotesSent: sent,
          quotesAccepted: accepted,
          lastQuoteAt: lastQuoteAt || null,
          daysSinceSignup: Math.floor((now - agency.createdAt) / 86_400_000),
          stage,
        };
      }),
    );

    // Newest first: a signup from this morning is the one you act on.
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },
});
