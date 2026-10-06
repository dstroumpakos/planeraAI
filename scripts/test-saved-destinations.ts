/**
 * Unit checks for admin saved-destination demand (Low-Fare Radar).
 *
 * The regression these exist for: a place can be saved two ways — a `wishlist`
 * row (settings → wishlist) or a `watchedDestinations` row (the watch toggle in
 * onboarding, destination preview and the destinations screen). The admin views,
 * the wishlist seeder and push targeting only ever read `wishlist`, so a new
 * user who finished onboarding by watching a city was invisible: no chip, no
 * searchable route, "Find deals" never searched their route, and "also target
 * wishlisters" never reached them.
 *
 *   npx tsx scripts/test-saved-destinations.ts
 *
 * (or, offline: npx esbuild scripts/test-saved-destinations.ts --bundle
 *  --platform=node --format=cjs --outfile=<tmp>.cjs && node <tmp>.cjs)
 */

import {
  collectSavedDestinations,
  aggregateSavedDestinations,
  buildDemandRoutes,
  savedDestinationAudience,
} from "../convex/lib/savedDestinations";

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  PASS", name);
  else {
    failed++;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

/** Stands in for a Convex query ctx: the two tables, nothing else. */
function ctxWith(wishlist: any[], watched: any[]) {
  return {
    db: {
      query: (t: string) => ({
        collect: async () =>
          t === "wishlist" ? wishlist : t === "watchedDestinations" ? watched : [],
      }),
    },
  };
}

(async () => {
  console.log("\n1. A new user who only watched a destination produces a route");
  let saved = await collectSavedDestinations(
    ctxWith([], [{ userId: "u1", destination: "paris", destinationIata: "CDG", createdAt: 1 }])
  );
  let out = buildDemandRoutes(saved, [{ userId: "u1", homeAirport: "Athens, ATH" }], [], Date.now());
  check("one route built", out.routes.length === 1, out.routes);
  check(
    "ATH -> CDG/PAR",
    out.routes[0]?.origin === "ATH" && /^(CDG|PAR)$/.test(out.routes[0]?.destination),
    out.routes[0]
  );
  check(
    "counted as a watch, not a wishlist",
    out.routes[0]?.watchUsers === 1 && out.routes[0]?.wishlistUsers === 0,
    out.routes[0]
  );
  check("sources says watch", JSON.stringify(out.routes[0]?.sources) === '["watch"]', out.routes[0]?.sources);
  check("label is title-cased, not 'paris'", out.routes[0]?.labels[0] === "Paris", out.routes[0]?.labels);

  console.log("\n2. Greek home airport still resolves (homeAirport normalization)");
  saved = await collectSavedDestinations(ctxWith([], [{ userId: "u1", destination: "rome" }]));
  out = buildDemandRoutes(saved, [{ userId: "u1", homeAirport: "Αθήνα" }], [], Date.now());
  check("ATH origin from 'Αθήνα'", out.routes[0]?.origin === "ATH", out.routes[0]);

  console.log("\n3. Same user wishlisting AND watching the same city counts once");
  saved = await collectSavedDestinations(
    ctxWith(
      [{ userId: "u1", destination: "Paris", country: "France", addedAt: 1 }],
      [{ userId: "u1", destination: "paris", destinationIata: "CDG", createdAt: 1 }]
    )
  );
  out = buildDemandRoutes(saved, [{ userId: "u1", homeAirport: "ATH" }], [], Date.now());
  check("one route", out.routes.length === 1, out.routes);
  check("users = 1", out.routes[0]?.users === 1, out.routes[0]);
  check(
    "both sides counted",
    out.routes[0]?.wishlistUsers === 1 && out.routes[0]?.watchUsers === 1,
    out.routes[0]
  );
  const agg = aggregateSavedDestinations(saved);
  check("stats: one chip", agg.length === 1, agg);
  check("stats: count = 1 distinct user", agg[0]?.count === 1, agg[0]);
  check(
    "stats: keeps wishlist wording + country",
    agg[0]?.destination === "Paris" && agg[0]?.country === "France",
    agg[0]
  );
  check("stats: split shown", agg[0]?.wishlistUsers === 1 && agg[0]?.watchUsers === 1, agg[0]);

  console.log("\n4. Coverage: a live deal on the route flips hasLive");
  saved = await collectSavedDestinations(ctxWith([], [{ userId: "u1", destination: "new york" }]));
  out = buildDemandRoutes(
    saved,
    [{ userId: "u1", homeAirport: "ATH" }],
    [{ origin: "ATH", destination: "JFK", destinationCity: "New York" }],
    Date.now()
  );
  check("JFK deal covers the NYC metro route", out.routes[0]?.hasLive === true, out.routes[0]);

  console.log("\n5. Expired deals don't count as coverage");
  out = buildDemandRoutes(
    saved,
    [{ userId: "u1", homeAirport: "ATH" }],
    [{ origin: "ATH", destination: "JFK", destinationCity: "New York", expiresAt: Date.now() - 1000 }],
    Date.now()
  );
  check("expired deal ignored", out.routes[0]?.hasLive === false, out.routes[0]);

  console.log("\n6. Savers without a home airport are skipped, not counted twice");
  saved = await collectSavedDestinations(
    ctxWith(
      [{ userId: "u2", destination: "Bali", addedAt: 1 }],
      [
        { userId: "u2", destination: "bali", createdAt: 1 },
        { userId: "u3", destination: "lisbon", createdAt: 1 },
      ]
    )
  );
  out = buildDemandRoutes(saved, [], [], Date.now());
  check("no routes", out.routes.length === 0, out.routes);
  check("noHomeAirport = 2 people-places, not 3 rows", out.noHomeAirport === 2, out.noHomeAirport);

  console.log("\n7. Unrecognised names land in `unresolved` once per user");
  saved = await collectSavedDestinations(
    ctxWith(
      [{ userId: "u1", destination: "Narnia", addedAt: 1 }],
      [{ userId: "u1", destination: "narnia", createdAt: 1 }]
    )
  );
  out = buildDemandRoutes(saved, [{ userId: "u1", homeAirport: "ATH" }], [], Date.now());
  check("one unresolved entry", out.unresolved.length === 1, out.unresolved);
  check("counted once", out.unresolved[0]?.count === 1, out.unresolved);

  console.log("\n8. A watch on your own home city is not a route");
  saved = await collectSavedDestinations(ctxWith([], [{ userId: "u1", destination: "athens" }]));
  out = buildDemandRoutes(saved, [{ userId: "u1", homeAirport: "ATH" }], [], Date.now());
  check("no self-route", out.routes.length === 0 && out.sameCity === 1, out);

  console.log("\n9. Gaps sort first, then by demand");
  saved = await collectSavedDestinations(
    ctxWith([], [
      { userId: "u1", destination: "rome" },
      { userId: "u2", destination: "rome" },
      { userId: "u1", destination: "lisbon" },
    ])
  );
  out = buildDemandRoutes(
    saved,
    [{ userId: "u1", homeAirport: "ATH" }, { userId: "u2", homeAirport: "ATH" }],
    [{ origin: "ATH", destination: "FCO", destinationCity: "Rome" }],
    Date.now()
  );
  check(
    "uncovered Lisbon first despite fewer users",
    out.routes[0]?.destinationCity === "Lisbon",
    out.routes.map((r) => [r.destinationCity, r.users, r.hasLive])
  );

  console.log("\n10. Push targeting: watchers are part of the audience");
  saved = await collectSavedDestinations(
    ctxWith(
      [{ userId: "u1", destination: "Rome, Italy", addedAt: 1 }],
      [
        { userId: "u2", destination: "rome", createdAt: 1 },
        { userId: "u1", destination: "rome", createdAt: 1 },
        { userId: "u3", destination: "reykjavik", createdAt: 1 },
      ]
    )
  );
  let aud = savedDestinationAudience(saved, "Rome");
  check("2 users targeted", aud.size === 2, Array.from(aud.entries()));
  check(
    "u1 counted on both sides",
    aud.get("u1")?.wishlist === true && aud.get("u1")?.watch === true,
    aud.get("u1")
  );
  check(
    "u2 counted as a watcher only",
    aud.get("u2")?.watch === true && aud.get("u2")?.wishlist === false,
    aud.get("u2")
  );
  check("unrelated saver not targeted", !aud.has("u3"), Array.from(aud.keys()));

  console.log("\n11. Push targeting: loose name match, both directions");
  check("deal city inside the saved label ('Rome, Italy')", aud.has("u1"), true);
  saved = await collectSavedDestinations(ctxWith([], [{ userId: "u9", destination: "new york" }]));
  aud = savedDestinationAudience(saved, "New York City");
  check("saved label inside the deal city", aud.has("u9"), Array.from(aud.keys()));

  console.log("\n12. Push targeting: a 2-letter destination targets nobody");
  check("too short to match", savedDestinationAudience(saved, "NY").size === 0, true);

  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
