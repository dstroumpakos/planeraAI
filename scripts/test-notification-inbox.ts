/**
 * Unit checks for deal-alert targeting and the notification inbox helpers.
 *
 * The regression these exist for: automatic deal alerts (new deal for a
 * watched destination, and price drops found by the radar refresh) went to
 * EVERY watcher of the destination, whatever their home airport — an Athens
 * user watching Paris got pinged about a Berlin → Paris fare that never shows
 * up in their own radar. Only watchers whose home airport resolves to the
 * deal's origin should be alerted.
 *
 *   npx tsx scripts/test-notification-inbox.ts
 */

import {
  homeAirportMatchesOrigin,
  isNotablePriceDrop,
  inboxCategory,
  inboxData,
  statsDay,
  statsKey,
  statsType,
} from "../convex/lib/notificationInbox";

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  PASS", name);
  else {
    failed++;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

console.log("1. Home airport must be the deal's origin");
check("ATH user, ATH deal", homeAirportMatchesOrigin("Athens, Greece ATH", "ATH"));
check("ATH user, BER deal", !homeAirportMatchesOrigin("Athens, Greece ATH", "BER"));
check("Greek-script home airport resolves", homeAirportMatchesOrigin("Αθήνα", "ATH"));
check("lowercase origin", homeAirportMatchesOrigin("ATH", "ath"));
check("no home airport never matches", !homeAirportMatchesOrigin(undefined, "ATH"));
check("empty home airport never matches", !homeAirportMatchesOrigin("", "ATH"));
check("missing origin never matches", !homeAirportMatchesOrigin("ATH", ""));
check("San Francisco is SFO, not SAN", !homeAirportMatchesOrigin("San Francisco, CA", "SAN"));

console.log("\n2. Price-drop threshold");
check("€200 → €180 is news", isNotablePriceDrop(200, 180));
check("€200 → €198 is not (< €5)", !isNotablePriceDrop(200, 198));
check("€900 → €890 is not (< 3%)", !isNotablePriceDrop(900, 890));
check("€900 → €870 is (≥ €5 and ≥ 3%)", isNotablePriceDrop(900, 870));
check("a rise is not a drop", !isNotablePriceDrop(100, 120));
check("no change is not a drop", !isNotablePriceDrop(100, 100));
check("garbage old price", !isNotablePriceDrop(0, 50));

console.log("\n3. Inbox categories");
check("deal_price_drop → deals", inboxCategory("deal_price_drop") === "deals");
check("deal_broadcast → deals", inboxCategory("deal_broadcast") === "deals");
check("deal_dormant_d7 → deals", inboxCategory("deal_dormant_d7") === "deals");
check("countdown_3d → trips", inboxCategory("countdown_3d") === "trips");
check("morning_briefing_day2 → trips", inboxCategory("morning_briefing_day2") === "trips");
check("trip_recap → trips", inboxCategory("trip_recap") === "trips");
check("collab_joined_x → trips", inboxCategory("collab_joined_abc") === "trips");
check("credit_monthly → account", inboxCategory("credit_monthly") === "account");
check("streak_promo → account", inboxCategory("streak_promo") === "account");
check("dormant_d3 → general", inboxCategory("dormant_d3") === "general");

console.log("\n4. Inbox payload is whitelisted");
const d = inboxData({ screen: "deal-trip", dealId: "abc", price: 120, type: "x", token: "secret", nested: { a: 1 } });
check("keeps routing keys", d?.screen === "deal-trip" && d?.dealId === "abc", d);
check("numbers become strings", d?.price === "120", d);
check("drops everything else", !("token" in (d || {})) && !("nested" in (d || {})) && !("type" in (d || {})), d);
check("empty payload → undefined", inboxData({}) === undefined && inboxData(null) === undefined);

console.log("\n5. Admin open-rate counter keys");
const ts = Date.UTC(2026, 9, 6, 23, 30);
check("UTC day", statsDay(ts) === "2026-10-06", statsDay(ts));
check("morning briefing days collapse", statsType("morning_briefing_day4") === "morning_briefing");
check("collab joins collapse", statsType("collab_joined_k1234") === "collab_joined");
check("other types untouched", statsType("deal_price_drop") === "deal_price_drop");
const dk = statsKey("deal_price_drop", ts, { dealId: "d1", origin: "ATH", destination: "CDG" });
check("deal push keyed per deal with route", dk.dealId === "d1" && dk.route === "ATH → CDG" && dk.type === "deal_price_drop", dk);
const tk = statsKey("countdown_3d", ts, { screen: "trip", tripId: "t1" });
check("non-deal push has no deal dimension", !("dealId" in tk) && !("route" in tk), tk);
check("no data at all", statsKey("dormant_d3", ts, undefined).type === "dormant_d3");

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
