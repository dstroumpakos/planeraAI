import { test } from "node:test";
import assert from "node:assert/strict";
import { autoResolveMissing } from "../destinationMap";
import type { ConnectorBinding } from "../orchestrator";
import type { DestinationCandidate } from "../destinations";

/** A connector stub: only what auto-resolve reads. */
function binding(
  id: string,
  kinds: string[],
  feed?: () => Promise<DestinationCandidate[]>,
): { binding: ConnectorBinding; calls: () => number } {
  let calls = 0;
  const connector = {
    id,
    capabilities: { kinds },
    ...(feed
      ? {
          listDestinations: async () => {
            calls++;
            return feed();
          },
        }
      : {}),
  };
  return {
    binding: { connector, creds: { apiKey: "k" } } as unknown as ConnectorBinding,
    calls: () => calls,
  };
}

function fakeCtx() {
  const saved: Array<Record<string, unknown>> = [];
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      saved.push(args);
      return "id";
    },
  };
  return { ctx: ctx as never, saved };
}

const BARCELONA: DestinationCandidate = { id: "60", name: "Barcelona", type: "city" };

test("a never-mapped supplier is resolved during the search and its id used", async () => {
  const tiqets = binding("tiqets", ["activity"], async () => [BARCELONA]);
  const { ctx, saved } = fakeCtx();

  const ids = await autoResolveMissing(ctx, {
    agencyId: "a" as never,
    iata: "BCN",
    bindings: [tiqets.binding],
    mappedConnectorIds: [],
    kinds: ["activity"],
    destinationIds: { viator: "562" },
  });

  assert.deepEqual(ids, { viator: "562", tiqets: "60" });
  assert.equal(saved.length, 1, "the mapping is cached for the next search");
  assert.equal(saved[0].status, "resolved");
});

test("a supplier that already has a row — even an unresolved one — is not re-pulled", async () => {
  const tiqets = binding("tiqets", ["activity"], async () => [BARCELONA]);
  const { ctx } = fakeCtx();

  const ids = await autoResolveMissing(ctx, {
    agencyId: "a" as never,
    iata: "BCN",
    bindings: [tiqets.binding],
    mappedConnectorIds: ["tiqets"],
    kinds: ["activity"],
    destinationIds: {},
  });

  assert.equal(tiqets.calls(), 0);
  assert.deepEqual(ids, {});
});

test("suppliers the search will not use are not resolved", async () => {
  const tiqets = binding("tiqets", ["activity"], async () => [BARCELONA]);
  const air = binding("duffel", ["flight"], async () => [BARCELONA]);
  const { ctx } = fakeCtx();

  await autoResolveMissing(ctx, {
    agencyId: "a" as never,
    iata: "BCN",
    bindings: [tiqets.binding, air.binding],
    mappedConnectorIds: [],
    kinds: ["flight", "hotel"],
    destinationIds: {},
  });

  assert.equal(tiqets.calls(), 0, "an activity supplier is skipped on a flight+hotel search");
  assert.equal(air.calls(), 0, "flights key off IATA and never need an id");
});

test("a feed that fails is skipped for this search and NOT cached as unresolved", async () => {
  const tiqets = binding("tiqets", ["activity"], async () => {
    throw new Error("503");
  });
  const { ctx, saved } = fakeCtx();

  const ids = await autoResolveMissing(ctx, {
    agencyId: "a" as never,
    iata: "BCN",
    bindings: [tiqets.binding],
    mappedConnectorIds: [],
    kinds: ["activity"],
    destinationIds: {},
  });

  assert.deepEqual(ids, {});
  assert.equal(saved.length, 0, "a transient outage must not become a permanent gap");
});

test("a supplier with no locations feed is left for a hand-pinned mapping", async () => {
  const manual = binding("liknoss", ["transfer"]);
  const { ctx, saved } = fakeCtx();

  const ids = await autoResolveMissing(ctx, {
    agencyId: "a" as never,
    iata: "JTR",
    bindings: [manual.binding],
    mappedConnectorIds: [],
    kinds: ["transfer"],
    destinationIds: {},
  });

  assert.deepEqual(ids, {});
  assert.equal(saved.length, 0);
});
