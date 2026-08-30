import { test } from "node:test";
import assert from "node:assert/strict";
import { CONNECTOR_SPECS } from "../connectors/providers";
import { makeConnector } from "../connectors/generic";
import {
  getConnector,
  implementedConnectorIds,
  isConnectable,
  isSearchable,
  pendingReason,
} from "../connectors/factory";
import { CONNECTOR_REGISTRY, getRegistryEntry, requiredFieldsFor } from "../connectors/registry";
import { validateConnectionInput } from "../connectionService";
import { ValidationError } from "../validation";
import type { NormalizedFlightOffer } from "../model/types";
import type { SupplierCredentials } from "../connectors/types";

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

function withFetch<T>(stub: FetchStub, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = stub;
  return run().finally(() => {
    (globalThis as { fetch: unknown }).fetch = original;
  });
}

const respond = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const creds = (fields: Record<string, string>): SupplierCredentials => ({
  scheme: "api_key",
  environment: "sandbox",
  fields,
});

// ── Catalogue integrity ─────────────────────────────────────────────────────

test("every registry provider has a built connector", () => {
  const built = new Set(implementedConnectorIds());
  const missing = CONNECTOR_REGISTRY.filter((e) => e.enabled && !built.has(e.id)).map((e) => e.id);
  assert.deepEqual(missing, [], `these enabled providers have no connector: ${missing.join(", ")}`);
});

test("every enabled provider is connectable", () => {
  for (const entry of CONNECTOR_REGISTRY.filter((e) => e.enabled)) {
    assert.ok(isConnectable(entry.id), `${entry.id} should be connectable`);
  }
});

test("every provider declares the credential fields it actually needs", () => {
  for (const entry of CONNECTOR_REGISTRY) {
    assert.ok(entry.credentialFields.length > 0, `${entry.id} declares no credential fields`);
    for (const f of entry.credentialFields) {
      assert.match(f.key, /^[a-zA-Z][a-zA-Z0-9_]*$/, `${entry.id}.${f.key} is not a valid field key`);
      assert.ok(f.label.length > 0, `${entry.id}.${f.key} has no label`);
    }
  }
});

test("signature providers require BOTH a key and a secret", () => {
  // Both are "api_key" scheme, and both silently fail at call time with only a
  // key — which is exactly the bug the per-provider field list exists to stop.
  for (const id of ["hotelbeds", "expedia_rapid"]) {
    assert.deepEqual(requiredFieldsFor(id), ["apiKey", "secret"], id);
  }
});

test("a half-filled signature credential is rejected at connect time", () => {
  assert.throws(
    () =>
      validateConnectionInput({
        connectorId: "hotelbeds",
        environment: "sandbox",
        credentialScheme: "api_key",
        fields: { apiKey: "abc123" }, // secret missing
      }),
    (e: unknown) =>
      e instanceof ValidationError && /Shared secret/.test((e as Error).message),
  );

  assert.doesNotThrow(() =>
    validateConnectionInput({
      connectorId: "hotelbeds",
      environment: "sandbox",
      credentialScheme: "api_key",
      fields: { apiKey: "abc123", secret: "s3cr3t" },
    }),
  );
});

test("Sabre requires its PCC alongside the client pair", () => {
  assert.deepEqual(requiredFieldsFor("sabre"), ["clientId", "clientSecret", "pcc"]);
});

// ── The honesty invariant ───────────────────────────────────────────────────

test("HONESTY: a provider without a search spec must explain why", () => {
  for (const spec of CONNECTOR_SPECS) {
    if (spec.search) continue;
    assert.ok(
      spec.pendingReason && spec.pendingReason.length > 20,
      `${spec.id} has no search and no usable pendingReason — an agency would just see it silently return nothing`,
    );
  }
});

test("HONESTY: a connector never declares a capability it cannot perform", () => {
  for (const spec of CONNECTOR_SPECS) {
    const c = makeConnector(spec);
    assert.equal(
      c.capabilities.supports.search,
      !!spec.search,
      `${spec.id} misreports its search capability`,
    );
    // Revalidation is the call that turns an indicative price into a committed
    // one. Declaring it without implementing it would let the orchestrator
    // present unverified fares as confirmed.
    assert.equal(c.capabilities.supports.revalidate, false, `${spec.id}`);
    assert.equal(c.capabilities.supports.createBooking, false, `${spec.id}`);
  }
});

test("HONESTY: an unsearchable provider refuses rather than inventing a request", async () => {
  const connector = getConnector("webbeds")!;
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    async () => {
      await assert.rejects(
        () =>
          connector.search(creds({ apiKey: "k" }), {
            kind: "hotel",
            destinationIata: "CDG",
            departDate: "2027-01-01",
            adults: 2,
            childrenAges: [],
            sellCurrency: "EUR",
          }),
        /not yet searchable/,
      );
    },
  );
  assert.equal(called, false, "it must not reach the network with a guessed payload");
});

test("HONESTY: revalidation refuses instead of claiming a price still holds", async () => {
  await assert.rejects(
    () => getConnector("amadeus")!.revalidate(creds({}), "tok"),
    /cannot re-price/,
  );
});

test("pendingReason is exposed for exactly the unsearchable providers", () => {
  for (const spec of CONNECTOR_SPECS) {
    if (isSearchable(spec.id)) assert.equal(pendingReason(spec.id), null, spec.id);
    else assert.ok(pendingReason(spec.id), spec.id);
  }
});

// ── Amadeus: the one spec-driven provider with a real search ────────────────

const AMADEUS_OFFER = {
  id: "1",
  itineraries: [
    {
      duration: "PT3H50M",
      segments: [
        {
          departure: { iataCode: "ATH", at: "2027-03-10T07:15:00" },
          arrival: { iataCode: "CDG", at: "2027-03-10T10:05:00" },
          carrierCode: "A3",
          number: "610",
          duration: "PT3H50M",
          numberOfStops: 0,
        },
      ],
    },
  ],
  price: { currency: "EUR", total: "412.80", base: "350.00", grandTotal: "412.80" },
  travelerPricings: [
    { fareDetailsBySegment: [{ cabin: "ECONOMY", includedCheckedBags: { quantity: 1 } }] },
  ],
};

test("Amadeus: token is fetched, then the search call carries it", async () => {
  const urls: string[] = [];
  const offers = await withFetch(
    async (url, init) => {
      urls.push(url);
      if (url.includes("/oauth2/token")) {
        assert.equal(init.method, "POST");
        return respond({ access_token: "tok-abc", expires_in: 1799 });
      }
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok-abc");
      return respond({ data: [AMADEUS_OFFER] });
    },
    () =>
      getConnector("amadeus")!.search(
        { scheme: "oauth2_client_credentials", environment: "sandbox", fields: { clientId: "id", clientSecret: "sec", apiHost: "https://api.acme.amadeus.com" } },
        {
          kind: "flight",
          originIata: "ATH",
          destinationIata: "CDG",
          departDate: "2027-03-10",
          adults: 2,
          childrenAges: [7],
          sellCurrency: "EUR",
        },
      ),
  );

  assert.ok(urls[0].includes("api.acme.amadeus.com/v1/security/oauth2/token"), urls[0]);
  const searchUrl = urls.find((u) => u.includes("flight-offers"))!;
  assert.match(searchUrl, /originLocationCode=ATH/);
  assert.match(searchUrl, /destinationLocationCode=CDG/);
  assert.match(searchUrl, /adults=2/);
  assert.match(searchUrl, /children=1/);
  assert.match(searchUrl, /currencyCode=EUR/);

  assert.equal(offers.length, 1);
  const offer = offers[0] as NormalizedFlightOffer;
  assert.equal(offer.connectorId, "amadeus");
  // base must EXCLUDE tax; the pricing engine adds taxes back on top.
  assert.equal(offer.cost.base.amountMinor, 35000);
  assert.equal(offer.cost.taxes.amountMinor, 6280);
  assert.equal(offer.cost.base.amountMinor + offer.cost.taxes.amountMinor, 41280);
  assert.equal(offer.outboundStops, 0);
  assert.equal(offer.totalDurationMinutes, 230);
  assert.equal(offer.baggage.checked, 1);
  // No re-price call exists yet, so it must not hand out a token implying one does.
  assert.equal(offer.revalidationToken, undefined);
});

test("Amadeus: the contract host is used verbatim in production too", async () => {
  const urls: string[] = [];
  await withFetch(
    async (url) => {
      urls.push(url);
      return url.includes("/oauth2/token")
        ? respond({ access_token: "t", expires_in: 1799 })
        : respond({ data: [] });
    },
    () =>
      getConnector("amadeus")!.search(
        { scheme: "oauth2_client_credentials", environment: "production", fields: { clientId: "prod-id", clientSecret: "prod-sec", apiHost: "https://api.prod.amadeus.com" } },
        {
          kind: "flight",
          originIata: "ATH",
          destinationIata: "CDG",
          departDate: "2027-03-10",
          adults: 1,
          childrenAges: [],
          sellCurrency: "EUR",
        },
      ),
  );
  assert.ok(urls.every((u) => u.startsWith("https://api.prod.amadeus.com")), urls.join(", "));
});

test("a search missing an IATA code is declined without calling the supplier", async () => {
  let called = false;
  const offers = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () =>
      getConnector("amadeus")!.search(
        { scheme: "oauth2_client_credentials", environment: "sandbox", fields: { clientId: "i", clientSecret: "s", apiHost: "https://api.acme.amadeus.com" } },
        { kind: "flight", destinationCity: "Paris", adults: 1, childrenAges: [], sellCurrency: "EUR" },
      ),
  );
  assert.deepEqual(offers, []);
  assert.equal(called, false);
});

// ── Health checks ───────────────────────────────────────────────────────────

test("Hotelbeds health signs each request and calls the real status endpoint", async () => {
  let seenUrl = "";
  let headers: Record<string, string> = {};
  const status = await withFetch(
    async (url, init) => {
      seenUrl = url;
      headers = init.headers as Record<string, string>;
      return respond({ status: "OK" });
    },
    () => getConnector("hotelbeds")!.healthCheck(creds({ apiKey: "key123", secret: "sec456" })),
  );
  assert.equal(status.healthy, true);
  assert.equal(seenUrl, "https://api.test.hotelbeds.com/hotel-api/1.0/status");
  assert.equal(headers["Api-key"], "key123");
  assert.match(headers["X-Signature"], /^[0-9a-f]{64}$/, "SHA-256 hex signature");
});

test("a rejected credential reports as rejected, not as a network blip", async () => {
  const status = await withFetch(
    async () => respond({ error: { message: "Invalid signature" } }, 401),
    () => getConnector("hotelbeds")!.healthCheck(creds({ apiKey: "bad", secret: "bad" })),
  );
  assert.equal(status.healthy, false);
  assert.match(status.message ?? "", /rejected these credentials/);
});

test("a 400 on the health probe counts as authenticated", async () => {
  // Expedia's availability endpoint answers 400 without search params — the
  // signature was accepted, which is the only thing a health check asks.
  const status = await withFetch(
    async () => respond({ errors: [{ message: "missing checkin" }] }, 400),
    () => getConnector("expedia_rapid")!.healthCheck(creds({ apiKey: "k", secret: "s" })),
  );
  assert.equal(status.healthy, true);
  assert.match(status.message ?? "", /credentials accepted/);
});

test("a 404 on the health probe is reported as OUR path being wrong", async () => {
  const status = await withFetch(
    async () => respond({}, 404),
    () => getConnector("viator")!.healthCheck(creds({ apiKey: "k" })),
  );
  assert.equal(status.healthy, false);
  assert.match(status.message ?? "", /needs confirming/);
});

test("an OAuth2 handshake-only probe passes on a real token exchange", async () => {
  let calls = 0;
  const status = await withFetch(
    async (url) => {
      calls++;
      assert.ok(url.includes("/v2/auth/token"), url);
      return respond({ access_token: "sabre-token", expires_in: 604800 });
    },
    () =>
      getConnector("sabre")!.healthCheck({
        scheme: "oauth2_client_credentials",
        environment: "sandbox",
        fields: { clientId: "c", clientSecret: "s", pcc: "1A2B" },
      }),
  );
  assert.equal(status.healthy, true);
  assert.equal(calls, 1, "the token exchange IS the probe");
  assert.ok(status.message, "it should still say why it cannot search yet");
});

test("a static-header provider with no confirmed endpoint does NOT fake a pass", async () => {
  let called = false;
  const status = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () => getConnector("liknoss")!.healthCheck(creds({ apiKey: "k" })),
  );
  assert.equal(called, false);
  assert.equal(status.healthy, false, "a header alone proves nothing");
  assert.match(status.message ?? "", /licensed agencies/);
});

test("a missing credential field names the field, never a value", async () => {
  const status = await withFetch(
    async () => respond({}),
    // secret omitted
    () => getConnector("hotelbeds")!.healthCheck(creds({ apiKey: "super-secret-key" })),
  );
  assert.equal(status.healthy, false);
  assert.match(status.message ?? "", /missing its "secret"/);
  assert.ok(!(status.message ?? "").includes("super-secret-key"));
});

test("registry docs links are https where present", () => {
  for (const entry of CONNECTOR_REGISTRY) {
    if (entry.docsUrl) assert.ok(entry.docsUrl.startsWith("https://"), entry.id);
  }
  assert.ok(getRegistryEntry("amadeus")?.docsUrl, "amadeus should link its docs");
});

// ── Host resolution ─────────────────────────────────────────────────────────
//
// Both cases below were found by probing the real endpoints with invalid
// credentials, not by reading code. They are the two ways a connector can look
// perfectly written and still never reach the provider.

const amadeusCreds = (over: Record<string, string> = {}) => ({
  scheme: "oauth2_client_credentials" as const,
  environment: "sandbox" as const,
  fields: { clientId: "cid", clientSecret: "csec", apiHost: "https://api.acme.amadeus.com", ...over },
});

test("Amadeus calls the host issued with the contract, not a retired public one", async () => {
  // api.amadeus.com and test.api.amadeus.com stopped resolving when the
  // Self-Service platform was retired; the endpoint now comes per contract.
  const urls: string[] = [];
  await withFetch(
    async (url) => {
      urls.push(url);
      return url.includes("/oauth2/token")
        ? respond({ access_token: "t", expires_in: 1799 })
        : respond({ data: [] });
    },
    () =>
      getConnector("amadeus")!.search(amadeusCreds(), {
        kind: "flight",
        originIata: "ATH",
        destinationIata: "CDG",
        departDate: "2027-03-10",
        adults: 1,
        childrenAges: [],
        sellCurrency: "EUR",
      }),
  );
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.ok(u.startsWith("https://api.acme.amadeus.com"), u);
    assert.ok(!u.includes("test.api.amadeus.com"), `must not fall back to a dead host: ${u}`);
  }
});

test("Amadeus without an API host says so, instead of failing DNS", async () => {
  let called = false;
  const status = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () => getConnector("amadeus")!.healthCheck(amadeusCreds({ apiHost: "" })),
  );
  assert.equal(called, false);
  assert.equal(status.healthy, false);
  assert.match(status.message ?? "", /missing its "apiHost"/);
});

test("an agency-supplied API host must be a plain https origin", async () => {
  for (const bad of [
    "http://api.acme.amadeus.com", // not https
    "https://api.acme.amadeus.com/v2/shopping", // a path, not an origin
    "https://evil.example.com@api.amadeus.com", // userinfo smuggling
    "not-a-url",
  ]) {
    const status = await withFetch(
      async () => respond({}),
      () => getConnector("amadeus")!.healthCheck(amadeusCreds({ apiHost: bad })),
    );
    assert.equal(status.healthy, false, bad);
    assert.match(status.message ?? "", /plain https origin|missing its/, bad);
  }
});

test("Travelport fetches its token from the OAuth host, not the API host", async () => {
  // The same path on api.travelport.com answers 404, which reads like a bad
  // credential and sends everyone hunting the wrong problem.
  let tokenUrl = "";
  await withFetch(
    async (url) => {
      tokenUrl = url;
      return respond({ access_token: "t", expires_in: 1799 });
    },
    () =>
      getConnector("travelport")!.healthCheck({
        scheme: "oauth2_client_credentials",
        environment: "sandbox",
        fields: { clientId: "c", clientSecret: "s", targetBranch: "P1" },
      }),
  );
  assert.equal(tokenUrl, "https://oauth.pp.travelport.com/oauth/oauth20/token");
  assert.ok(!tokenUrl.includes("api.pp.travelport.com"));
});

test("Travelport production uses the production OAuth host", async () => {
  let tokenUrl = "";
  await withFetch(
    async (url) => {
      tokenUrl = url;
      return respond({ access_token: "t", expires_in: 1799 });
    },
    () =>
      getConnector("travelport")!.healthCheck({
        scheme: "oauth2_client_credentials",
        environment: "production",
        fields: { clientId: "c", clientSecret: "s", targetBranch: "P1" },
      }),
  );
  assert.equal(tokenUrl, "https://oauth.travelport.com/oauth/oauth20/token");
});

test("every spec host is a plain https origin", () => {
  for (const spec of CONNECTOR_SPECS) {
    for (const [env, host] of Object.entries(spec.hosts)) {
      assert.match(host, /^https:\/\/[a-z0-9.-]+$/, `${spec.id}.${env}`);
    }
    if (spec.auth.kind === "oauth2" && spec.auth.tokenHosts) {
      for (const [env, host] of Object.entries(spec.auth.tokenHosts)) {
        assert.match(host, /^https:\/\/[a-z0-9.-]+$/, `${spec.id}.token.${env}`);
      }
    }
  }
});

// ── Destination mapping ─────────────────────────────────────────────────────

test("providers that key off their own taxonomy declare it", () => {
  // The orchestrator uses this flag to skip a connector it cannot address,
  // instead of calling it with an IATA code it will not recognise.
  assert.equal(getConnector("hotelbeds")!.capabilities.requiresDestinationId, true);
  // Flights key off IATA directly and must NOT be gated on a mapping.
  assert.notEqual(getConnector("amadeus")!.capabilities.requiresDestinationId, true);
  assert.notEqual(getConnector("duffel")!.capabilities.requiresDestinationId, true);
});

test("providers with a documented locations feed expose listDestinations", () => {
  for (const id of ["hotelbeds", "viator", "tiqets"]) {
    assert.ok(getConnector(id)!.listDestinations, `${id} should be able to list destinations`);
  }
  // No public feed — these are mapped by hand, and the absent method is what
  // the resolver checks to say so rather than guessing.
  for (const id of ["webbeds", "liknoss", "ferryhopper"]) {
    assert.equal(getConnector(id)!.listDestinations, undefined, id);
  }
});

test("Hotelbeds destination feed maps to candidates the matcher can score", async () => {
  const candidates = await withFetch(
    async (url) => {
      assert.match(url, /hotel-content-api\/1\.0\/locations\/destinations/);
      return respond({
        destinations: [
          { code: "PAR", name: { content: "Paris" }, countryCode: "FR" },
          { code: "ATH", name: { content: "Athens" }, countryCode: "GR" },
          { code: "BAD", name: {} }, // unusable, must be dropped
        ],
      });
    },
    () =>
      getConnector("hotelbeds")!.listDestinations!(creds({ apiKey: "k", secret: "s" }), {
        iata: "CDG",
        cityName: "Paris",
      }),
  );
  assert.equal(candidates.length, 2, "the nameless row is dropped");
  assert.deepEqual(candidates[0], {
    id: "PAR",
    name: "Paris",
    countryCode: "FR",
    type: "city",
  });
});

test("Hotelbeds searches on the RESOLVED destination code, not the IATA", async () => {
  let body: any = null;
  const offers = await withFetch(
    async (url, init) => {
      assert.match(url, /hotel-api\/1\.0\/hotels$/);
      body = JSON.parse(String(init.body));
      return respond({
        hotels: {
          hotels: [
            {
              code: 12345,
              name: "Hotel Test",
              categoryCode: "4EST",
              currency: "EUR",
              reviews: [{ rate: 8.4 }],
              rooms: [{ rates: [{ net: "412.80", rateKey: "rk-1", boardCode: "BB" }] }],
            },
          ],
        },
      });
    },
    () =>
      getConnector("hotelbeds")!.search(creds({ apiKey: "k", secret: "s" }), {
        kind: "hotel",
        destinationIata: "CDG",
        providerDestinationId: "PAR", // what the mapping layer resolved
        departDate: "2027-03-10",
        returnDate: "2027-03-14",
        adults: 2,
        childrenAges: [7],
        sellCurrency: "EUR",
      }),
  );

  // The whole point of the layer: Hotelbeds' own code, never the IATA.
  assert.equal(body.destination.code, "PAR");
  assert.notEqual(body.destination.code, "CDG");
  assert.equal(body.stay.checkIn, "2027-03-10");
  assert.equal(body.occupancies[0].adults, 2);
  assert.equal(body.occupancies[0].children, 1);
  assert.deepEqual(body.occupancies[0].paxes, [{ type: "CH", age: 7 }]);

  assert.equal(offers.length, 1);
  const hotel = offers[0] as import("../model/types").NormalizedHotelOffer;
  assert.equal(hotel.connectorId, "hotelbeds");
  assert.equal(hotel.name, "Hotel Test");
  assert.equal(hotel.starRating, 4);
  assert.equal(hotel.boardType, "breakfast");
  assert.equal(hotel.nights, 4);
  // A net rate is tax-inclusive: re-adding tax would over-price every quote.
  assert.equal(hotel.cost.base.amountMinor, 41280);
  assert.equal(hotel.cost.taxes.amountMinor, 0);
  assert.equal(hotel.revalidationToken, "rk-1");
});

test("Hotelbeds declines rather than calling out when no mapping was resolved", async () => {
  let called = false;
  const offers = await withFetch(
    async () => {
      called = true;
      return respond({});
    },
    () =>
      getConnector("hotelbeds")!.search(creds({ apiKey: "k", secret: "s" }), {
        kind: "hotel",
        destinationIata: "CDG", // no providerDestinationId
        departDate: "2027-03-10",
        returnDate: "2027-03-14",
        adults: 2,
        childrenAges: [],
        sellCurrency: "EUR",
      }),
  );
  assert.deepEqual(offers, []);
  assert.equal(called, false);
});
