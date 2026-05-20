"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * SerpApi's `booking_options[].booking_request.url` is Google's `clk/f`
 * endpoint, which requires a POST body (`post_data`) and 404s on GET.
 * This action performs that POST, follows redirects, and returns the
 * final provider URL the user can open directly in the browser.
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
        },
        body: postData,
        redirect: "follow",
      });
      const finalUrl = res.url;
      if (!finalUrl || finalUrl === url) {
        return { ok: false as const, error: "no-redirect" };
      }
      return { ok: true as const, url: finalUrl };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  },
});
