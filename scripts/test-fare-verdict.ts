/**
 * Unit checks for the buy-or-wait verdict (lib/fareVerdict.ts) and the
 * multi-airport helpers that let a saved country be priced in one call
 * (convex/lib/radarDestinations.ts).
 *
 *   node_modules/.bin/esbuild scripts/test-fare-verdict.ts --bundle --platform=node --outfile=<tmp>/t.js && node <tmp>/t.js
 */

import { fareVerdict, parsePriceHistory } from "../lib/fareVerdict";
import { arrivalAirportOf, multiAirportId } from "../convex/lib/radarDestinations";

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  PASS", name);
  else {
    failed++;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const NOW = Date.parse("2026-10-16T12:00:00Z");
const inDays = (d: number) =>
  new Date(NOW + d * 86400000).toISOString().slice(0, 10);
const keys = (r: ReturnType<typeof fareVerdict>) => r?.reasons.map((x) => x.key) ?? [];

console.log("fareVerdict");
{
  const r = fareVerdict({ price: 150, priceLevel: "low", typicalRange: [190, 260], departureDate: inDays(60), now: NOW });
  check("below range → buy", r?.verdict === "buy", r);
  check("below range reason carries the gap", r?.reasons[0].key === "belowRange" && r.reasons[0].params.amount === 40, r);
  check("google low not repeated next to belowRange", !keys(r).includes("googleLow"), keys(r));
}
{
  const r = fareVerdict({ price: 320, priceLevel: "high", typicalRange: [190, 260], departureDate: inDays(60), now: NOW });
  check("above range → wait", r?.verdict === "wait", r);
  check("above range amount", r?.reasons[0].params.amount === 60, r);
}
{
  const r = fareVerdict({ price: 320, priceLevel: "high", typicalRange: [190, 260], departureDate: inDays(10), now: NOW });
  check("never 'wait' inside three weeks", r?.verdict === "fair", r);
  check("says why", keys(r).includes("departingSoon"), keys(r));
}
{
  const r = fareVerdict({ price: 225, priceLevel: "typical", typicalRange: [190, 260], departureDate: inDays(200), now: NOW });
  check("typical at mid, far out → wait", r?.verdict === "wait", r);
  check("far-out reason in months", keys(r).includes("plentyOfTime") && r!.reasons.find((x) => x.key === "plentyOfTime")!.params.months === 6, r);
}
{
  const r = fareVerdict({ price: 200, priceLevel: "typical", typicalRange: [190, 260], departureDate: inDays(60), now: NOW });
  check("under typical midpoint → fair", r?.verdict === "fair" && keys(r).includes("underTypical"), r);
  check("underTypical amount = mid − price", r?.reasons[0].params.amount === 25, r);
}
{
  check("no grade + no range → null", fareVerdict({ price: 100, now: NOW }) === null);
  check("zero price → null", fareVerdict({ price: 0, priceLevel: "low", now: NOW }) === null);
  check("inverted range ignored", fareVerdict({ price: 100, typicalRange: [300, 200], now: NOW }) === null);
  const r = fareVerdict({ price: 100, priceLevel: "low", now: NOW });
  check("grade alone still judges", r?.verdict === "buy" && keys(r)[0] === "googleLow", r);
}
{
  // searchapi.io shape, prices for these dates climbing to today's fare
  const hist = [260, 250, 240, 245, 255, 280, 300].map((price, i) => ({
    price,
    iso_date: new Date(NOW - (60 - i * 10) * 86400000).toISOString(),
  }));
  const r = fareVerdict({ price: 300, priceLevel: "typical", typicalRange: [250, 380], priceHistory: hist, departureDate: inDays(60), now: NOW });
  check("rising history → reason", keys(r).includes("pricesRising"), keys(r));
  check("history span in days", r?.reasons.find((x) => x.key === "pricesRising")?.params.days === 60, r);
}
{
  // SerpApi shape [unixSeconds, price], today's fare the lowest seen
  const hist = [300, 290, 310, 295, 280, 250].map((p, i) => [
    Math.floor((NOW - (50 - i * 10) * 86400000) / 1000),
    p,
  ]);
  const r = fareVerdict({ price: 250, priceLevel: "typical", typicalRange: [240, 340], priceHistory: hist, departureDate: inDays(60), now: NOW });
  check("lowest seen → reason", keys(r).includes("lowestSeen"), keys(r));
  check("falling not also claimed when lowest seen", !keys(r).includes("pricesFalling"), keys(r));
  check("SerpApi history parsed", parsePriceHistory(hist).length === 6);
}
{
  const r = fareVerdict({ price: 100, priceLevel: "low", typicalRange: [190, 260], departureDate: inDays(5), now: NOW });
  check("at most three reasons", (r?.reasons.length ?? 0) <= 3, r);
  check("parsePriceHistory tolerates junk", parsePriceHistory([null, {}, ["x", 1], 5, { price: 0, iso_date: "2026-01-01" }]).length === 0);
}

console.log("multi-airport helpers");
{
  check("joins codes", multiAirportId(["BCN", "MAD", "AGP"], "ATH") === "BCN,MAD,AGP");
  check("drops origin + dupes", multiAirportId(["ATH", "jtr", "JTR", "HER"], "ATH") === "JTR,HER");
  check("calendar form swaps metros", multiAirportId(["PAR", "NCE"], "ATH", true) === "CDG,NCE");
  check("flights form keeps metros", multiAirportId(["PAR", "NCE"], "ATH") === "PAR,NCE");
  check(
    "capped at 10",
    multiAirportId("AAA BBB CCC DDD EEE FFF GGG HHH III JJJ KKK".split(" "), "ATH").split(",").length === 10
  );
  check(
    "arrival = last outbound segment",
    arrivalAirportOf({ flights: [{ arrivalAirport: { id: "FCO" } }, { arrivalAirport: { id: "mad" } }] }) === "MAD"
  );
  check("arrival missing → null", arrivalAirportOf({ flights: [] }) === null);
  check("arrival junk → null", arrivalAirportOf({ flights: [{ arrivalAirport: { id: "Madrid" } }] }) === null);
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
