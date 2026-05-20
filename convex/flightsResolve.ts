"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * SerpApi's `booking_options[].booking_request.url` is Google's `clk/f`
 * endpoint, which requires a POST body (`post_data`) and 404s on GET.
 * This action performs that POST, follows redirects, and returns the
 * final provider URL the user can open directly in the browser.
 *
 * Google may respond with either:
 *   1) an HTTP 3xx redirect to the provider site (handled by fetch), or
 *   2) an HTML page containing a `<meta http-equiv="refresh">` /
 *      `window.location` / anchor pointing at the provider — we parse
 *      these out of the response body as a fallback.
 */
export const resolveBookingUrl = action({
  args: {
    url: v.string(),
    postData: v.string(),
  },
  handler: async (_ctx, { url, postData }) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: postData,
        redirect: "follow",
      });

      const finalUrl = res.url;
      const isGoogle = (u: string | null | undefined) =>
        !u || /^https?:\/\/(www\.)?google\.[a-z.]+\//i.test(u);

      if (finalUrl && !isGoogle(finalUrl)) {
        return { ok: true as const, url: finalUrl };
      }

      // Fallback: Google served an HTML page with a JS / meta refresh
      // pointing at the provider. Parse it out.
      const body = await res.text();
      const candidates: string[] = [];

      // Google's clk/f returns a tiny HTML doc like:
      //   <meta content="0;url='https://www.lufthansa.com/...'">
      // (no http-equiv attr, single-quoted URL inside content).
      // Match url='...' or url="..." (with optional quote variant).
      const metaContent = body.match(
        /<meta[^>]+content=["'][^"']*url=(?:'([^']+)'|"([^"]+)"|([^"'>\s]+))/i
      );
      if (metaContent) {
        const u = metaContent[1] || metaContent[2] || metaContent[3];
        if (u) candidates.push(u);
      }

      const winLoc = body.match(
        /(?:window\.location(?:\.href)?|location\.replace)\s*=?\s*\(?\s*["']([^"']+)["']/i
      );
      if (winLoc?.[1]) candidates.push(winLoc[1]);

      const anchor = body.match(
        /<a[^>]+href=["'](https?:\/\/(?!(?:www\.)?google\.)[^"']+)["']/i
      );
      if (anchor?.[1]) candidates.push(anchor[1]);

      for (let raw of candidates) {
        raw = raw.replace(/&amp;/g, "&");
        if (!isGoogle(raw) && /^https?:\/\//i.test(raw)) {
          return { ok: true as const, url: raw };
        }
      }

      console.warn(
        `resolveBookingUrl: no provider URL extracted (status=${res.status}, finalUrl=${finalUrl}, bodyLen=${body.length}) bodySnippet=${body.slice(0, 800).replace(/\s+/g, " ")}`
      );
      return { ok: false as const, error: "no-redirect" };
    } catch (e) {
      console.warn(`resolveBookingUrl failed: ${(e as Error).message}`);
      return { ok: false as const, error: (e as Error).message };
    }
  },
});
