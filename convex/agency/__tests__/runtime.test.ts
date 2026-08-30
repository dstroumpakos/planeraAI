import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBindings, bindingsById, type StoredConnectionRow } from "../runtime";
import { generateMasterKeyB64url, sealJson } from "../vault";
import type { SupplierCredentials } from "../connectors/types";

const KEY = generateMasterKeyB64url();

const creds: SupplierCredentials = {
  scheme: "api_key",
  environment: "sandbox",
  fields: { apiKey: "duffel_test_secret_value" },
};

async function row(over: Partial<StoredConnectionRow> = {}): Promise<StoredConnectionRow> {
  return {
    connectorId: "mock-air",
    environment: "sandbox",
    credentialScheme: "api_key",
    encryptedCredentials: await sealJson(KEY, creds),
    status: "active",
    ...over,
  };
}

test("an active connection becomes a runnable binding with decrypted credentials", async () => {
  const { bindings, skipped } = await buildBindings(KEY, [await row()]);
  assert.equal(skipped.length, 0);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].connector.id, "mock-air");
  assert.equal(bindings[0].creds.fields.apiKey, "duffel_test_secret_value");
});

test("a disabled connection is skipped with a reason, not silently dropped", async () => {
  const { bindings, skipped } = await buildBindings(KEY, [await row({ status: "disabled" })]);
  assert.equal(bindings.length, 0);
  assert.equal(skipped[0].ok, false);
  assert.match(skipped[0].error ?? "", /disabled/);
});

test("a provider we have not implemented is skipped, not attempted", async () => {
  const { bindings, skipped } = await buildBindings(KEY, [await row({ connectorId: "sabre" })]);
  assert.equal(bindings.length, 0);
  assert.equal(skipped[0].skippedReason, "not_implemented");
});

test("ONE unopenable envelope does not take down the whole search", async () => {
  const wrongKey = generateMasterKeyB64url();
  const broken = await row({ connectorId: "mock-hotel" });
  broken.encryptedCredentials = await sealJson(wrongKey, creds);

  const { bindings, skipped } = await buildBindings(KEY, [await row(), broken]);
  assert.equal(bindings.length, 1, "the healthy connection still runs");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].connectorId, "mock-hotel");
});

test("a vault failure never tells the client WHY it failed", async () => {
  const tampered = await row();
  tampered.encryptedCredentials = tampered.encryptedCredentials.slice(0, -4) + "AAAA";
  const { skipped } = await buildBindings(KEY, [tampered]);
  const message = skipped[0].error ?? "";
  assert.match(message, /reconnect this supplier/);
  // "wrong key" vs "tampered" is an oracle we do not hand out.
  assert.ok(!/tamper|malformed|decrypt|key/i.test(message), message);
});

test("bindings index by connector id for provider-locked revalidation", async () => {
  const { bindings } = await buildBindings(KEY, [
    await row(),
    await row({ connectorId: "mock-hotel" }),
  ]);
  const index = bindingsById(bindings);
  assert.equal(index.size, 2);
  assert.equal(index.get("mock-hotel")?.connector.id, "mock-hotel");
});
