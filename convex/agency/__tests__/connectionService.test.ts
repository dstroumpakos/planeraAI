import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sealConnection, validateConnectionInput, deriveDisplayHint, redactConnection,
  type CreateConnectionInput,
} from "../connectionService";
import { generateMasterKeyB64url, openJson } from "../vault";
import { hashPassword, verifyPassword, sha256Hex, newToken, constantTimeEqualHex } from "../crypto";

const MASTER = generateMasterKeyB64url();

// ── crypto ────────────────────────────────────────────────────────────────
test("password hash verifies correctly and rejects wrong password", async () => {
  const rec = await hashPassword("hunter2-strong");
  assert.ok(await verifyPassword("hunter2-strong", rec));
  assert.ok(!(await verifyPassword("wrong", rec)));
  assert.notEqual(rec.hash, rec.salt);
});

test("password must be >= 8 chars", async () => {
  await assert.rejects(() => hashPassword("short"), /8 characters/);
});

test("sha256Hex is deterministic; newToken is random base64url", async () => {
  assert.equal(await sha256Hex("abc"), await sha256Hex("abc"));
  const t1 = newToken(), t2 = newToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/);
  assert.ok(constantTimeEqualHex("aa", "aa") && !constantTimeEqualHex("aa", "ab"));
});

// ── connection service ──────────────────────────────────────────────────────
const goodInput: CreateConnectionInput = {
  connectorId: "hotelbeds",
  environment: "sandbox",
  credentialScheme: "api_key",
  fields: { apiKey: "hb-live-SECRET-9f3a2b7c" },
};

test("seals credentials: envelope round-trips, but plaintext never leaks", async () => {
  const sealed = await sealConnection(MASTER, goodInput);
  assert.ok(!sealed.encryptedCredentials.includes("hb-live-SECRET-9f3a2b7c"));
  assert.ok(!sealed.displayHint.includes("SECRET"));
  assert.match(sealed.displayHint, /••••2b7c$/); // last-4 masked hint
  const back = await openJson<{ fields: Record<string, string> }>(MASTER, sealed.encryptedCredentials);
  assert.equal(back.fields.apiKey, "hb-live-SECRET-9f3a2b7c");
});

test("rejects unknown / disabled connector and scheme mismatch and missing fields", () => {
  assert.throws(() => validateConnectionInput({ ...goodInput, connectorId: "nope" }), /unknown connector/);
  assert.throws(() => validateConnectionInput({ ...goodInput, credentialScheme: "pcc_office_id", fields: { pcc: "1A", officeId: "X" } }), /expects scheme/);
  assert.throws(() => validateConnectionInput({ ...goodInput, fields: {} }), /missing credential field/);
});

test("GDS pcc scheme validates its own required fields", () => {
  assert.doesNotThrow(() => validateConnectionInput({ connectorId: "travelport", environment: "sandbox", credentialScheme: "pcc_office_id", fields: { pcc: "2F3K", officeId: "ATH1S2100" } }));
  assert.equal(deriveDisplayHint("pcc_office_id", { pcc: "2F3K", officeId: "ATH1S2100" }), "PCC 2F3K / Office ATH1S2100");
});

test("redactConnection strips the secret envelope", () => {
  const row = { connectorId: "hotelbeds", encryptedCredentials: "v1.aaa.bbb.ccc.ddd", displayHint: "••••b7c" };
  const safe = redactConnection(row);
  assert.ok(!("encryptedCredentials" in safe));
  assert.equal((safe as any).displayHint, "••••b7c");
});
