import { test } from "node:test";
import assert from "node:assert/strict";
import { sealJson, openJson, generateMasterKeyB64url } from "../vault";

const MASTER = generateMasterKeyB64url();
const cred = { scheme: "api_key", environment: "sandbox", fields: { apiKey: "SECRET-hotelbeds-live-abc123" } };

test("round-trips a credential object", async () => {
  const env = await sealJson(MASTER, cred);
  const back = await openJson<typeof cred>(MASTER, env);
  assert.deepEqual(back, cred);
});

test("ciphertext never contains the plaintext secret", async () => {
  const env = await sealJson(MASTER, cred);
  assert.ok(!env.includes("SECRET-hotelbeds-live-abc123"));
  assert.ok(!env.includes("apiKey"));
});

test("two seals of the same input differ (random DEK + IVs)", async () => {
  const a = await sealJson(MASTER, cred);
  const b = await sealJson(MASTER, cred);
  assert.notEqual(a, b);
});

test("wrong master key fails to decrypt (GCM auth)", async () => {
  const env = await sealJson(MASTER, cred);
  const other = generateMasterKeyB64url();
  await assert.rejects(() => openJson(other, env));
});

test("tampering with the ciphertext fails decryption", async () => {
  const env = await sealJson(MASTER, cred);
  const parts = env.split(".");
  // flip a char in the ciphertext segment
  parts[4] = parts[4].slice(0, -1) + (parts[4].endsWith("A") ? "B" : "A");
  await assert.rejects(() => openJson(MASTER, parts.join(".")));
});

test("malformed envelope is rejected", async () => {
  await assert.rejects(() => openJson(MASTER, "not-a-valid-envelope"));
});

test("rejects a master key that is not 32 bytes", async () => {
  await assert.rejects(() => sealJson("dG9vLXNob3J0", cred), /32 bytes/);
});
