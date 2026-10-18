"use node";

/**
 * Third-party marketing numbers for the admin dashboard.
 *
 * Every 3 hours (`refresh-external-analytics` cron) this pulls:
 *   - Google Analytics 4 via the Data API (runReport), authenticated as a
 *     Google Cloud service account that has Viewer access on the GA4 property.
 *   - Meta Ads via the Marketing API insights edge, authenticated with a
 *     Business Manager System User token that has `ads_read` on the ad account.
 * and caches both in the `externalAnalytics` singleton (externalAnalyticsDb.ts),
 * so the dashboard never calls Google or Meta on page load.
 *
 * Env vars (Convex dashboard → Settings → Environment Variables):
 *   GA4_PROPERTY_ID            numeric property id (Admin → Property details),
 *                              NOT the G-XXXX measurement id
 *   GA4_SERVICE_ACCOUNT_JSON   the service-account key file, as raw JSON or base64
 *   META_ADS_ACCESS_TOKEN      System User token with ads_read
 *   META_AD_ACCOUNT_ID         ad account id, with or without the "act_" prefix
 * A source whose vars are missing is skipped and reported as not configured.
 *
 * Both sources report the same window, the last 30 complete days (to
 * yesterday), so Meta spend can be divided by GA4 conversions in the UI.
 */

import { createSign } from "crypto";
import { internalAction } from "./_generated/server";
import { internal as _internal } from "./_generated/api";

// Same self-reference cast as adminKpis.ts: the sibling module's functions
// aren't in the generated types until the next codegen.
const internal = _internal as any;

// Keep in step with the CAPI relay in the website (src/app/api/meta/event).
const META_GRAPH_VERSION = "v23.0";

// The GA4 conversion events the website pushes to the dataLayer (see the
// website's src/lib/gtm.ts). Meta's own names for the same conversions follow.
const GA4_CONVERSION_EVENTS = ["sign_up", "generate_lead"];
const META_REGISTRATION_ACTIONS = [
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
  "omni_complete_registration",
];
const META_LEAD_ACTIONS = ["lead", "offsite_conversion.fb_pixel_lead", "omni_lead"];
const META_LANDING_ACTIONS = ["landing_page_view", "omni_landing_page_view"];

const num = (s: unknown) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

// ===========================================================================
// GOOGLE ANALYTICS 4
// ===========================================================================

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function readServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw.trim(), "base64").toString("utf8");
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  // Keys pasted through a shell sometimes arrive with literal "\n".
  return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, "\n") };
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// Service-account OAuth: sign a JWT assertion and swap it for an access token.
async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = b64url(createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google auth failed (${res.status}): ${json.error_description || json.error || "no token"}`);
  }
  return json.access_token;
}

type Ga4Row = { dims: string[]; mets: number[] };

async function runReport(propertyId: string, accessToken: string, body: Record<string, unknown>): Promise<Ga4Row[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GA4 runReport failed (${res.status}): ${json?.error?.message || "unknown error"}`);
  }
  return (json.rows ?? []).map((r: any) => ({
    dims: (r.dimensionValues ?? []).map((d: any) => String(d.value ?? "")),
    mets: (r.metricValues ?? []).map((m: any) => num(m.value)),
  }));
}

const CURRENT = { startDate: "30daysAgo", endDate: "yesterday" };
const PREVIOUS = { startDate: "60daysAgo", endDate: "31daysAgo" };
const conversionFilter = {
  filter: { fieldName: "eventName", inListFilter: { values: GA4_CONVERSION_EVENTS } },
};

const TOTAL_METRICS = [
  "activeUsers",
  "newUsers",
  "sessions",
  "engagedSessions",
  "engagementRate",
  "averageSessionDuration",
  "screenPageViews",
] as const;

export async function fetchGa4(propertyId: string, sa: ServiceAccount) {
  const token = await googleAccessToken(sa);
  const report = (body: Record<string, unknown>) => runReport(propertyId, token, body);

  const [totals, daily, channels, sourceMedium, conversions, conversionsDaily, pages, countries, devices] =
    await Promise.all([
      // Two date ranges → GA4 appends a "date_range_N" dimension to each row.
      report({ dateRanges: [CURRENT, PREVIOUS], metrics: TOTAL_METRICS.map((name) => ({ name })) }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "newUsers" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 40,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "sessionSourceMedium" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagementRate" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "eventName" }, { name: "sessionSourceMedium" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: conversionFilter,
        limit: 200,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "date" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: conversionFilter,
        limit: 200,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 8,
      }),
      report({
        dateRanges: [CURRENT],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 5,
      }),
    ]);

  const totalsFor = (range: string) => {
    const row = totals.find((r) => r.dims[r.dims.length - 1] === range);
    const out: Record<string, number> = {};
    TOTAL_METRICS.forEach((m, i) => (out[m] = row ? row.mets[i] : 0));
    out.engagementRate = round2((out.engagementRate || 0) * 100); // fraction → %
    out.averageSessionDuration = Math.round(out.averageSessionDuration || 0); // seconds
    return out;
  };

  // Conversions: totals, split by source/medium, and the paid-social share
  // (Meta ad URLs carry utm_medium=paid_social).
  const conv = { signUps: 0, leads: 0, paidSocialSignUps: 0, paidSocialLeads: 0 };
  const bySource = new Map<string, { signUps: number; leads: number }>();
  for (const r of conversions) {
    const [event, sm] = r.dims;
    const count = r.mets[0];
    const isSignUp = event === "sign_up";
    const paid = /\/\s*paid_social$/i.test(sm);
    if (isSignUp) conv.signUps += count;
    else conv.leads += count;
    if (paid && isSignUp) conv.paidSocialSignUps += count;
    if (paid && !isSignUp) conv.paidSocialLeads += count;
    const b = bySource.get(sm) ?? { signUps: 0, leads: 0 };
    if (isSignUp) b.signUps += count;
    else b.leads += count;
    bySource.set(sm, b);
  }

  const convByDay = new Map<string, { signUps: number; leads: number }>();
  for (const r of conversionsDaily) {
    const [day, event] = r.dims;
    const d = convByDay.get(day) ?? { signUps: 0, leads: 0 };
    if (event === "sign_up") d.signUps += r.mets[0];
    else d.leads += r.mets[0];
    convByDay.set(day, d);
  }
  const isoDay = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

  return {
    window: "last_30d",
    totals: totalsFor("date_range_0"),
    previous: totalsFor("date_range_1"),
    conversions: conv,
    daily: daily.map((r) => ({
      date: isoDay(r.dims[0]),
      activeUsers: r.mets[0],
      sessions: r.mets[1],
      newUsers: r.mets[2],
      signUps: convByDay.get(r.dims[0])?.signUps ?? 0,
      leads: convByDay.get(r.dims[0])?.leads ?? 0,
    })),
    channels: channels.map((r) => ({ key: r.dims[0], sessions: r.mets[0], activeUsers: r.mets[1] })),
    sourceMedium: sourceMedium.map((r) => ({
      key: r.dims[0],
      sessions: r.mets[0],
      activeUsers: r.mets[1],
      engagementRate: round2(r.mets[2] * 100),
      signUps: bySource.get(r.dims[0])?.signUps ?? 0,
      leads: bySource.get(r.dims[0])?.leads ?? 0,
    })),
    conversionsBySource: [...bySource.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.signUps + b.leads - (a.signUps + a.leads))
      .slice(0, 10),
    pages: pages.map((r) => ({ key: r.dims[0], views: r.mets[0], activeUsers: r.mets[1] })),
    countries: countries.map((r) => ({ key: r.dims[0], activeUsers: r.mets[0] })),
    devices: devices.map((r) => ({ key: r.dims[0], activeUsers: r.mets[0] })),
  };
}

// ===========================================================================
// META ADS
// ===========================================================================

async function graphGet(path: string, params: Record<string, string>, token: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}?${qs}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Meta ${path.split("/").pop()} failed (${res.status}): ${json?.error?.message || "unknown error"}`);
  }
  return json;
}

function pickAction(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

// One insights row → the numbers the dashboard shows.
function shapeInsight(row: any) {
  const spend = num(row?.spend);
  const registrations = pickAction(row?.actions, META_REGISTRATION_ACTIONS);
  const leads = pickAction(row?.actions, META_LEAD_ACTIONS);
  return {
    spend: round2(spend),
    impressions: num(row?.impressions),
    reach: num(row?.reach),
    frequency: round2(num(row?.frequency)),
    clicks: num(row?.clicks),
    linkClicks: num(row?.inline_link_clicks),
    landingPageViews: pickAction(row?.actions, META_LANDING_ACTIONS),
    ctr: round2(num(row?.ctr)),
    cpc: round2(num(row?.cpc)),
    cpm: round2(num(row?.cpm)),
    registrations,
    leads,
    costPerRegistration: registrations > 0 ? round2(spend / registrations) : null,
    costPerLead: leads > 0 ? round2(spend / leads) : null,
  };
}

const INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions";

export async function fetchMeta(rawAccountId: string, token: string) {
  const act = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
  const insights = (params: Record<string, string>) => graphGet(`${act}/insights`, params, token);

  const [account, last30, last7, daily, campaigns, ads] = await Promise.all([
    graphGet(act, { fields: "name,currency,account_status,amount_spent,timezone_name" }, token),
    insights({ level: "account", date_preset: "last_30d", fields: INSIGHT_FIELDS }),
    insights({ level: "account", date_preset: "last_7d", fields: INSIGHT_FIELDS }),
    insights({ level: "account", date_preset: "last_30d", time_increment: "1", fields: "spend,impressions,inline_link_clicks,actions", limit: "40" }),
    insights({ level: "campaign", date_preset: "last_30d", fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`, limit: "50" }),
    insights({ level: "ad", date_preset: "last_30d", fields: `ad_id,ad_name,campaign_name,${INSIGHT_FIELDS}`, limit: "50" }),
  ]);

  const bySpend = (a: { spend: number }, b: { spend: number }) => b.spend - a.spend;

  return {
    window: "last_30d",
    account: {
      id: act,
      name: account.name ?? null,
      currency: account.currency ?? "EUR",
      status: account.account_status ?? null,
      // amount_spent is a lifetime total in the account currency's minor unit.
      lifetimeSpend: round2(num(account.amount_spent) / 100),
      timezone: account.timezone_name ?? null,
    },
    last30d: shapeInsight(last30.data?.[0]),
    last7d: shapeInsight(last7.data?.[0]),
    daily: (daily.data ?? []).map((r: any) => ({
      date: r.date_start,
      spend: round2(num(r.spend)),
      impressions: num(r.impressions),
      linkClicks: num(r.inline_link_clicks),
      registrations: pickAction(r.actions, META_REGISTRATION_ACTIONS),
      leads: pickAction(r.actions, META_LEAD_ACTIONS),
    })),
    campaigns: (campaigns.data ?? [])
      .map((r: any) => ({ id: r.campaign_id, name: r.campaign_name, ...shapeInsight(r) }))
      .sort(bySpend)
      .slice(0, 15),
    ads: (ads.data ?? [])
      .map((r: any) => ({ id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, ...shapeInsight(r) }))
      .sort(bySpend)
      .slice(0, 15),
  };
}

// ===========================================================================
// CRON ENTRY POINT
// ===========================================================================

export const refreshExternalAnalytics = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const patch: Record<string, unknown> = { attemptedAt: now };
    // Fields to remove after a success (Convex args can't carry `undefined`).
    const clear: string[] = [];

    const ga4Property = process.env.GA4_PROPERTY_ID?.trim();
    const ga4Key = process.env.GA4_SERVICE_ACCOUNT_JSON;
    const metaToken = process.env.META_ADS_ACCESS_TOKEN?.trim();
    const metaAccount = process.env.META_AD_ACCOUNT_ID?.trim();

    // The two sources fail independently: a broken Meta token must not stop
    // GA4 from refreshing, and a failure keeps the last good payload.
    await Promise.all([
      (async () => {
        if (!ga4Property || !ga4Key) {
          patch.ga4Error = "Not configured: set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON";
          return;
        }
        try {
          patch.ga4 = await fetchGa4(ga4Property, readServiceAccount(ga4Key));
          patch.ga4FetchedAt = now;
          clear.push("ga4Error");
        } catch (e) {
          patch.ga4Error = errMsg(e);
        }
      })(),
      (async () => {
        if (!metaToken || !metaAccount) {
          patch.metaError = "Not configured: set META_ADS_ACCESS_TOKEN and META_AD_ACCOUNT_ID";
          return;
        }
        try {
          patch.meta = await fetchMeta(metaAccount, metaToken);
          patch.metaFetchedAt = now;
          clear.push("metaError");
        } catch (e) {
          patch.metaError = errMsg(e);
        }
      })(),
    ]);

    await ctx.runMutation(internal.externalAnalyticsDb._write, { patch, clear });
    return { ga4: patch.ga4Error ?? "ok", meta: patch.metaError ?? "ok" };
  },
});
