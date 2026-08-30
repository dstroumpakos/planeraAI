import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  stepFor,
  totpCodeForStep,
  verifyTotp,
  TOTP_STEP_SEC,
} from "../totp";

/** RFC 6238 reference secret: ASCII "12345678901234567890". */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 round-trips", () => {
  const bytes = new TextEncoder().encode("12345678901234567890");
  assert.equal(base32Encode(bytes), RFC_SECRET);
  assert.deepEqual([...base32Decode(RFC_SECRET)], [...bytes]);
});

test("base32 rejects characters outside the alphabet", () => {
  assert.throws(() => base32Decode("ABC1"), /invalid base32/);
});

/**
 * The published RFC 6238 SHA-1 vectors, truncated to the 6 digits an
 * authenticator app shows. If this ever fails, real users are locked out.
 */
test("matches the RFC 6238 test vectors", async () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [unixSeconds, expected] of vectors) {
    const code = await totpCodeForStep(RFC_SECRET, Math.floor(unixSeconds / TOTP_STEP_SEC));
    assert.equal(code, expected, `T=${unixSeconds}`);
  }
});

test("verifies the current code and tolerates one step of drift", async () => {
  const now = 1_700_000_000_000;
  const step = stepFor(now);
  for (const delta of [-1, 0, 1]) {
    const code = await totpCodeForStep(RFC_SECRET, step + delta);
    const result = await verifyTotp(RFC_SECRET, code, now);
    assert.equal(result.ok, true, `drift ${delta} should verify`);
    assert.equal(result.step, step + delta);
  }
});

test("rejects a code from outside the drift window", async () => {
  const now = 1_700_000_000_000;
  const stale = await totpCodeForStep(RFC_SECRET, stepFor(now) - 5);
  assert.equal((await verifyTotp(RFC_SECRET, stale, now)).ok, false);
});

test("REPLAY: a code already spent at a step is refused", async () => {
  const now = 1_700_000_000_000;
  const step = stepFor(now);
  const code = await totpCodeForStep(RFC_SECRET, step);

  const first = await verifyTotp(RFC_SECRET, code, now);
  assert.equal(first.ok, true);

  // Same code, same 30-second window, but the step is now recorded as used.
  const replay = await verifyTotp(RFC_SECRET, code, now, first.step);
  assert.equal(replay.ok, false, "a stolen code must not work twice");
});

test("malformed codes are rejected without touching the secret", async () => {
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
    assert.equal((await verifyTotp(RFC_SECRET, bad, Date.now())).ok, false, bad);
  }
});

test("whitespace inside a typed code is tolerated", async () => {
  const now = 1_700_000_000_000;
  const code = await totpCodeForStep(RFC_SECRET, stepFor(now));
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.equal((await verifyTotp(RFC_SECRET, spaced, now)).ok, true);
});

test("generated secrets are distinct and usable", async () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.notEqual(a, b);
  assert.equal(a.length, 32); // 20 bytes → 32 base32 chars
  const code = await totpCodeForStep(a, stepFor(Date.now()));
  assert.match(code, /^\d{6}$/);
});

test("the otpauth URI carries the parameters an authenticator needs", () => {
  const uri = otpauthUri(RFC_SECRET, "agent@example.com");
  assert.ok(uri.startsWith("otpauth://totp/Planera%3Aagent%40example.com?"));
  assert.match(uri, /secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

test("recovery codes are unique, formatted, and normalise for comparison", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  assert.equal(normalizeRecoveryCode(" abcde-fghij "), "ABCDEFGHIJ");
});
