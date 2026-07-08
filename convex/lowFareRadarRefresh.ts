"use node";

/**
 * Low-Fare Radar periodic price refresh.
 *
 * A cron tick fires hourly (`convex/crons.ts`); when the stored `nextRefreshAt`
 * is due, it runs `refreshManualDealPrices`, which re-prices every manually-added
 * (curated) radar deal whose travel dates are still in the future by querying
 * searchapi.io's Google Flights API — matching each deal's SPECIFIC flight (by
 * flight number, or airline + departure time) rather than grabbing the cheapest
 * fare on the route. If the exact flight is gone, the deal's price is left as-is.
 *
 * The admin widget reads the countdown via `lowFareRadar.getRefreshStatus` and
 * can force a run early via `triggerRefreshNow` (which also resets the 4-day
 * countdown, since a completed run pushes `nextRefreshAt` out again).
 *
 * Quota-conscious:
 *   - only curated deals (AUTO deals refresh via the search-seeding path)
 *   - one searchapi.io call per deal, run sequentially
 *   - capped per run so a large table can't blow the API budget in one go
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import {
  fetchRadarFlightOptions,
  matchRadarOption,
  normalizeFlightNumber,
  extractHm,
  type RadarDealCriteria,
} from "./lib/searchApiFlights";

// Upper bound on searchapi.io calls per run. Curated deal count is small in
// practice; this is a backstop against runaway quota use.
const MAX_DEALS_PER_RUN = 100;

// Where the post-refresh price-change report is emailed. Override via env if
// needed; defaults to the admin address.
const REPORT_EMAIL =
  process.env.LOW_FARE_REFRESH_REPORT_EMAIL || "dstroumpakos@planeraai.app";

type PriceChange = {
  route: string;      // "ATH → CDG"
  cities: string;     // "Athens → Paris"
  flight: string;     // matched outbound flight number(s)
  dates: string;      // "2026-07-21" or "2026-07-21 → 2026-07-22"
  oldPrice: number;
  newPrice: number;
  currency: string;
};

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Build the HTML + text price-change report email. */
function buildReportEmail(
  summary: RefreshResult,
  changes: PriceChange[]
): { subject: string; html: string; text: string } {
  const when = new Date().toUTCString();
  const arrow = (o: number, n: number) => (n < o ? "▼" : n > o ? "▲" : "＝");
  const rowsHtml = changes.length
    ? changes
        .map((c) => {
          const delta = c.newPrice - c.oldPrice;
          const pct = c.oldPrice ? Math.round((delta / c.oldPrice) * 100) : 0;
          const color = delta < 0 ? "#34C759" : delta > 0 ? "#EF4444" : "#8A8A8A";
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #EFEDE7;font-size:13px;color:#1A1A1A;"><strong>${esc(c.route)}</strong><br/><span style="color:#8A8A8A;font-size:12px;">${esc(c.cities)}</span></td>
            <td style="padding:8px 12px;border-bottom:1px solid #EFEDE7;font-size:12px;color:#4A4A4A;">${esc(c.flight || "—")}<br/><span style="color:#8A8A8A;">${esc(c.dates)}</span></td>
            <td style="padding:8px 12px;border-bottom:1px solid #EFEDE7;font-size:13px;color:#1A1A1A;white-space:nowrap;">${esc(c.currency)} ${c.oldPrice} → <strong>${esc(c.currency)} ${c.newPrice}</strong></td>
            <td style="padding:8px 12px;border-bottom:1px solid #EFEDE7;font-size:13px;font-weight:700;color:${color};white-space:nowrap;">${arrow(c.oldPrice, c.newPrice)} ${delta > 0 ? "+" : ""}${delta} (${pct > 0 ? "+" : ""}${pct}%)</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" style="padding:16px 12px;font-size:14px;color:#4A4A4A;">No prices changed in this run.</td></tr>`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF9F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF9F6;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #EFEDE7;">
      <tr><td style="padding:28px 32px 8px;">
        <h1 style="margin:0 0 4px;font-size:20px;font-weight:800;color:#1A1A1A;">✈️ Low-Fare Radar — price refresh</h1>
        <p style="margin:0;font-size:13px;color:#8A8A8A;">${esc(when)}</p>
      </td></tr>
      <tr><td style="padding:16px 32px 0;">
        <p style="margin:0;font-size:14px;color:#4A4A4A;">
          Checked <strong>${summary.checked}</strong> deal(s) · <strong style="color:#34C759;">${summary.updated}</strong> price change(s) ·
          ${summary.unchanged} unchanged · ${summary.notFound} flight(s) not found · ${summary.failed} failed.
        </p>
      </td></tr>
      <tr><td style="padding:16px 32px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFEDE7;border-radius:10px;overflow:hidden;">
          <tr style="background:#FAF9F6;">
            <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8A8A8A;">Route</th>
            <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8A8A8A;">Flight / Dates</th>
            <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8A8A8A;">Price</th>
            <th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8A8A8A;">Change</th>
          </tr>
          ${rowsHtml}
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 28px;">
        <p style="margin:0;font-size:12px;color:#9B9B9B;">Automated report from the Planera Low-Fare Radar refresh (searchapi.io Google Flights). Prices are per person.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const textLines = [
    `Low-Fare Radar — price refresh (${when})`,
    `Checked ${summary.checked} · updated ${summary.updated} · unchanged ${summary.unchanged} · not found ${summary.notFound} · failed ${summary.failed}`,
    "",
    ...(changes.length
      ? changes.map(
          (c) =>
            `${c.route} (${c.cities}) ${c.flight} ${c.dates}: ${c.currency} ${c.oldPrice} -> ${c.newPrice} (${c.newPrice - c.oldPrice >= 0 ? "+" : ""}${c.newPrice - c.oldPrice})`
        )
      : ["No prices changed in this run."]),
  ];

  const subject = changes.length
    ? `✈️ Low-Fare Radar: ${changes.length} price change(s)`
    : `✈️ Low-Fare Radar: refresh complete (no changes)`;

  return { subject, html, text: textLines.join("\n") };
}

/** Build the deal's identifying criteria for matching against fresh options. */
function criteriaForDeal(deal: any): RadarDealCriteria {
  const segs: any[] = Array.isArray(deal.outboundSegments)
    ? deal.outboundSegments
    : [];
  const flightNumbers =
    segs.length > 0
      ? segs.map((s) => normalizeFlightNumber(s?.flightNumber)).filter(Boolean)
      : [normalizeFlightNumber(deal.flightNumber)].filter(Boolean);

  return {
    flightNumbers,
    airline: deal.airline ?? null,
    departureTime: extractHm(deal.outboundDeparture),
  };
}

type RefreshResult = {
  checked: number;
  updated: number;
  unchanged: number;
  notFound: number;
  failed: number;
};

/**
 * Core refresh routine. Marks the run started/completed in `radarRefreshState`
 * (which resets the countdown) so both the cron tick and the manual trigger
 * keep the widget in sync.
 */
export const refreshManualDealPrices = internalAction({
  args: {},
  handler: async (ctx): Promise<RefreshResult> => {
    await ctx.runMutation(internal.lowFareRadar.markRadarRefreshStarted, {});

    let checked = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0; // API returned options, but not the deal's specific flight
    let failed = 0;
    const changes: PriceChange[] = [];

    try {
      const deals: any[] = await ctx.runQuery(
        internal.lowFareRadar.listRefreshableDeals,
        {}
      );

      for (const deal of deals.slice(0, MAX_DEALS_PER_RUN)) {
        try {
          // Query with adults=1 so the returned fare is per-person, matching
          // how radar deals store `price` (labelled "/pp" in the UI).
          const result = await fetchRadarFlightOptions({
            origin: deal.origin,
            destination: deal.destination,
            outboundDate: deal.outboundDate,
            returnDate: deal.returnDate,
            currency: deal.currency,
            adults: 1,
          });

          checked++;

          if (!result || result.options.length === 0) {
            // API failure / no results — leave the deal alone.
            failed++;
            continue;
          }

          // Match the fresh options back to THIS deal's specific flight.
          const match = matchRadarOption(result.options, criteriaForDeal(deal));
          if (!match || !(match.option.price > 0)) {
            // The exact curated flight is no longer offered — don't substitute
            // a different flight's price.
            notFound++;
            continue;
          }

          const matchedFlight =
            match.option.outboundFlightNumbers.join("+") || undefined;
          const res: {
            changed: boolean;
            oldPrice?: number;
            newPrice?: number;
          } = await ctx.runMutation(internal.lowFareRadar.applyPriceRefresh, {
            id: deal._id,
            newPrice: Math.round(match.option.price),
            matchType: match.matchType,
            matchedFlight,
          });

          if (res?.changed) {
            updated++;
            changes.push({
              route: `${deal.origin} → ${deal.destination}`,
              cities: `${deal.originCity || deal.origin} → ${deal.destinationCity || deal.destination}`,
              flight: matchedFlight || deal.flightNumber || "",
              dates: deal.returnDate
                ? `${deal.outboundDate} → ${deal.returnDate}`
                : deal.outboundDate,
              oldPrice: res.oldPrice ?? deal.price,
              newPrice: res.newPrice ?? Math.round(match.option.price),
              currency: deal.currency,
            });
          } else {
            unchanged++;
          }
        } catch (err) {
          failed++;
          console.error(
            `[radar-refresh] failed ${deal.origin}->${deal.destination} ${deal.outboundDate}`
          );
        }
      }

      console.log(
        `[radar-refresh] checked=${checked} updated=${updated} unchanged=${unchanged} notFound=${notFound} failed=${failed} (of ${deals.length} eligible)`
      );

      // Email a price-change report so the run is observable end-to-end.
      // Best-effort: a mail failure must not fail the refresh.
      try {
        const summary: RefreshResult = { checked, updated, unchanged, notFound, failed };
        const { subject, html, text } = buildReportEmail(summary, changes);
        const mail: { success: boolean; error?: string } = await ctx.runAction(
          internal.postmark.sendRawEmail,
          { to: REPORT_EMAIL, subject, html, text }
        );
        if (!mail.success) {
          console.error(`[radar-refresh] report email failed: ${mail.error}`);
        } else {
          console.log(`[radar-refresh] report email sent to ${REPORT_EMAIL}`);
        }
      } catch (err) {
        console.error("[radar-refresh] report email threw", err);
      }
    } finally {
      // Always reset the countdown, even if the run threw partway through.
      await ctx.runMutation(internal.lowFareRadar.markRadarRefreshCompleted, {
        result: { checked, updated, unchanged, notFound, failed },
      });
    }

    return { checked, updated, unchanged, notFound, failed };
  },
});

/**
 * Cron tick (hourly). Runs the refresh only when `nextRefreshAt` is due and no
 * run is already in progress. Keeps the DB-tracked countdown authoritative so
 * the admin "refresh now" button can meaningfully reset it.
 */
export const radarRefreshTick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const state = await ctx.runQuery(
      internal.lowFareRadar.getRadarRefreshStateInternal,
      {}
    );
    if (!state) {
      // First ever tick — seed the countdown and wait a full cycle.
      await ctx.runMutation(internal.lowFareRadar.ensureRadarRefreshState, {});
      return;
    }
    if (state.running) return;
    if (Date.now() < state.nextRefreshAt) return;
    await ctx.runAction(internal.lowFareRadarRefresh.refreshManualDealPrices, {});
  },
});

/**
 * Admin "refresh now" (skip the countdown). Validates the admin key, runs the
 * refresh immediately, and — because a completed run pushes `nextRefreshAt` out
 * by the full interval — resets the countdown.
 */
export const triggerRefreshNow = action({
  args: { adminKey: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<
    RefreshResult & { alreadyRunning?: boolean }
  > => {
    const expected = process.env.CONVEX_LOW_FARE_ADMIN_KEY;
    if (!expected) {
      throw new ConvexError("CONVEX_LOW_FARE_ADMIN_KEY environment variable not set");
    }
    if (args.adminKey !== expected) {
      throw new ConvexError("Unauthorized: invalid admin key");
    }

    const state = await ctx.runQuery(
      internal.lowFareRadar.getRadarRefreshStateInternal,
      {}
    );
    if (state?.running) {
      return {
        checked: 0,
        updated: 0,
        unchanged: 0,
        notFound: 0,
        failed: 0,
        alreadyRunning: true,
      };
    }

    return await ctx.runAction(
      internal.lowFareRadarRefresh.refreshManualDealPrices,
      {}
    );
  },
});
