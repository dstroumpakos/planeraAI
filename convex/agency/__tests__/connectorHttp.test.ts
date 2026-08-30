import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currencyExponent,
  decimalToMinor,
  fetchJson,
  isoDurationToMinutes,
  SupplierHttpError,
} from "../connectors/http";

test("decimal amounts convert to minor units without float drift", () => {
  assert.equal(decimalToMinor("123.45", "EUR"), 12345);
  assert.equal(decimalToMinor("0.10", "EUR"), 10);
  assert.equal(decimalToMinor("1000", "EUR"), 100000);
  // The classic float trap: 1234.565 * 100 is 123456.49999 in binary floating point.
  assert.equal(decimalToMinor("1234.565", "EUR"), 123457);
});

test("zero- and three-decimal currencies are respected", () => {
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(decimalToMinor("1500", "JPY"), 1500);
  assert.equal(decimalToMinor("12.345", "KWD"), 12345);
});

test("unparseable amounts are refused rather than silently zeroed", () => {
  for (const bad of ["", "abc", "12,34", "1.2.3", "€12"]) {
    assert.throws(() => decimalToMinor(bad, "EUR"), /unparseable amount/, bad);
  }
});

test("ISO 8601 durations parse to minutes", () => {
  assert.equal(isoDurationToMinutes("PT2H35M"), 155);
  assert.equal(isoDurationToMinutes("PT45M"), 45);
  assert.equal(isoDurationToMinutes("P1DT3H"), 1620);
  assert.equal(isoDurationToMinutes(undefined), 0);
  assert.equal(isoDurationToMinutes("nonsense"), 0);
});

// ── fetchJson ───────────────────────────────────────────────────────────────

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

function withFetch<T>(stub: FetchStub, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = stub;
  return run().finally(() => {
    (globalThis as { fetch: unknown }).fetch = original;
  });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

test("parses a successful JSON response", async () => {
  const result = await withFetch(
    async () => jsonResponse({ data: { id: "x" } }),
    () => fetchJson<{ data: { id: string } }>("https://x.test", {}, { connectorId: "t" }),
  );
  assert.equal(result.data.id, "x");
});

test("a 401 is not retried and surfaces the supplier's own message", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return jsonResponse({ errors: [{ title: "Invalid access token" }] }, 401);
    },
    async () => {
      await assert.rejects(
        () => fetchJson("https://x.test", {}, { connectorId: "duffel", retries: 2 }),
        (e: SupplierHttpError) =>
          e.status === 401 && /Invalid access token/.test(e.message),
      );
    },
  );
  assert.equal(calls, 1, "a bad credential must not be retried");
});

test("a 429 IS retried, then gives up cleanly", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return jsonResponse({ errors: [{ title: "slow down" }] }, 429);
    },
    async () => {
      await assert.rejects(
        () => fetchJson("https://x.test", { method: "POST" }, { connectorId: "t", retries: 1 }),
        (e: SupplierHttpError) => e.status === 429,
      );
    },
  );
  assert.equal(calls, 2, "one retry after the initial attempt");
});

test("a POST is NOT retried on a 500 — it may already have taken effect", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return jsonResponse({ error: "boom" }, 500);
    },
    async () => {
      await assert.rejects(() =>
        fetchJson("https://x.test", { method: "POST" }, { connectorId: "t", retries: 3 }),
      );
    },
  );
  assert.equal(calls, 1);
});

test("a GET IS retried on a 500 and can succeed on the second attempt", async () => {
  let calls = 0;
  const result = await withFetch(
    async () => {
      calls++;
      return calls === 1 ? jsonResponse({ error: "boom" }, 500) : jsonResponse({ ok: true });
    },
    () => fetchJson<{ ok: boolean }>("https://x.test", { method: "GET" }, { connectorId: "t" }),
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("errors never echo the request headers back — BYOK keys live there", async () => {
  await withFetch(
    async () => jsonResponse({ errors: [{ title: "nope" }] }, 403),
    async () => {
      await assert.rejects(
        () =>
          fetchJson(
            "https://x.test",
            { headers: { Authorization: "Bearer duffel_live_SUPER_SECRET" } },
            { connectorId: "duffel", retries: 0 },
          ),
        (e: Error) => !e.message.includes("SUPER_SECRET") && !e.message.includes("Bearer"),
      );
    },
  );
});

test("an oversized response is rejected instead of being parsed", async () => {
  await withFetch(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === "content-length" ? "999999999" : null) },
        text: async () => "{}",
      }) as unknown as Response,
    async () => {
      await assert.rejects(
        () => fetchJson("https://x.test", {}, { connectorId: "t", retries: 0 }),
        /too large/,
      );
    },
  );
});

test("a network failure becomes an opaque unreachable error", async () => {
  await withFetch(
    async () => {
      throw new TypeError("getaddrinfo ENOTFOUND internal.host.example");
    },
    async () => {
      await assert.rejects(
        () => fetchJson("https://x.test", {}, { connectorId: "duffel", retries: 0 }),
        (e: Error) => /duffel is unreachable/.test(e.message) && !e.message.includes("ENOTFOUND"),
      );
    },
  );
});
