/**
 * Unit checks for saved COUNTRIES on the Low-Fare Radar.
 *
 * The regression these exist for: people save whole countries ("Spain",
 * "Αίγυπτος"), which resolved to no airport, so the admin widget showed them
 * as dead chips and "Find deals for wishlists" never searched them. The
 * wishlist's free-text country field also stored junk ("Egypt · Why").
 *
 *   npx tsx scripts/test-country-destinations.ts
 */

import { resolveCountry } from "../lib/countries";
import {
  countryAirports,
  countryForIata,
  cityForIata,
  resolveCountryDestination,
} from "../convex/lib/radarDestinations";
import { buildDemandRoutes, collectSavedDestinations } from "../convex/lib/savedDestinations";

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  PASS", name);
  else {
    failed++;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

function ctxWith(wishlist: any[], watched: any[]) {
  return {
    db: {
      query: (t: string) => ({
        collect: async () => (t === "wishlist" ? wishlist : t === "watchedDestinations" ? watched : []),
      }),
    },
  };
}

(async () => {
  console.log("1. Country names in any app language");
  check("Spain", resolveCountry("Spain") === "Spain");
  check("Greek Ισπανία", resolveCountry("Ισπανία") === "Spain");
  check("unaccented ισπανια", resolveCountry("ισπανια") === "Spain");
  check("España", resolveCountry("España") === "Spain");
  check("Αίγυπτος", resolveCountry("Αίγυπτος") === "Egypt");
  check("United Kingdom → UK", resolveCountry("United Kingdom") === "UK");
  check("junk 'Why' is not a country", resolveCountry("Why") === null);
  check("a city is not a country", resolveCountry("Barcelona") === null);

  console.log("\n2. Countries map to main airports with real city names");
  check("Spain airports", countryAirports("Spain").join(",") === "BCN,MAD,AGP,PMI", countryAirports("Spain"));
  check("Egypt airports", countryAirports("Egypt").join(",") === "CAI,SSH,HRG", countryAirports("Egypt"));
  check("Cyprus (not in the airport dataset)", countryAirports("Cyprus").join(",") === "LCA,PFO");
  check("Larnaca has a city", cityForIata("LCA") === "Larnaca");
  check("AGP is in Spain", countryForIata("AGP") === "Spain");
  check("metro LON is in the UK", countryForIata("LON") === "UK");
  check("NCE stays France", countryForIata("NCE") === "France");
  check("single-airport-country still resolves", resolveCountryDestination("Malta")?.airports.join(",") === "MLA");

  console.log("\n3. A saved country becomes ONE route across its airports");
  const saved = await collectSavedDestinations(
    ctxWith(
      [
        { userId: "u1", destination: "Spain", country: "Spain" },
        { userId: "u2", destination: "Ισπανία" },
        { userId: "u3", destination: "Egypt", country: "Why" },
      ],
      []
    )
  );
  check("junk country dropped on read", saved.find((s) => s.userId === "u3")?.country === "Egypt", saved);
  const settings = [
    { userId: "u1", homeAirport: "ATH" },
    { userId: "u2", homeAirport: "Athens, Greece ATH" },
    { userId: "u3", homeAirport: "ATH" },
  ];
  let out = buildDemandRoutes(saved, settings, [], Date.now());
  const spain = out.routes.find((r) => r.destination === "Spain");
  check("one ATH→Spain route", !!spain && spain.kind === "country", out.routes);
  check("both spellings counted together", spain?.users === 2, spain);
  check("route carries the airports", spain?.airports?.join(",") === "BCN,MAD,AGP,PMI", spain);
  check("Egypt is a route too", out.routes.some((r) => r.destination === "Egypt" && r.kind === "country"));
  check("nothing unresolved", out.unresolved.length === 0, out.unresolved);
  check("no live deal yet", spain?.hasLive === false);

  console.log("\n4. Any deal into the country covers it");
  out = buildDemandRoutes(saved, settings, [{ origin: "ATH", destination: "VLC", destinationCity: "Valencia" }], Date.now());
  check("ATH→VLC covers Spain", out.routes.find((r) => r.destination === "Spain")?.hasLive === true);
  out = buildDemandRoutes(saved, settings, [{ origin: "SKG", destination: "AGP", destinationCity: "Malaga" }], Date.now());
  check("a deal from ANOTHER origin does not", out.routes.find((r) => r.destination === "Spain")?.hasLive === false);

  console.log("\n5. Saving your own country leaves out your own airport");
  const greek = await collectSavedDestinations(ctxWith([{ userId: "u9", destination: "Greece" }], []));
  out = buildDemandRoutes(greek, [{ userId: "u9", homeAirport: "ATH" }], [], Date.now());
  const gr = out.routes.find((r) => r.destination === "Greece");
  check("domestic route without ATH", !!gr && !gr.airports!.includes("ATH") && gr.airports!.length > 0, gr);

  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
