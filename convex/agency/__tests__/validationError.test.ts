import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  assertPasswordPolicy,
  normalizeCredentialFields,
  normalizeCurrency,
  normalizeEmail,
  normalizeIata,
  validateDateRange,
  validateParty,
} from "../validation";
import { validateConnectionInput, deriveDisplayHint } from "../connectionService";
import { parsePricingRule } from "../pricing";

/**
 * A prod smoke test caught this: every one of these threw a plain `Error`, and
 * `guard()` in errors.ts turns anything unrecognised into `internal_error`. The
 * result was that a user typing a short password saw "something went wrong"
 * instead of being told what was wrong. These messages are written to be READ,
 * so the type that carries them out of the pure layer is load-bearing.
 */

const rejections: Array<[string, () => unknown]> = [
  ["email", () => normalizeEmail("not-an-email")],
  ["password length", () => assertPasswordPolicy("Short1!")],
  ["password variety", () => assertPasswordPolicy("alllowercaseletters")],
  ["password too common", () => assertPasswordPolicy("password123")],
  ["IATA", () => normalizeIata("ATHENS")],
  ["currency", () => normalizeCurrency("EUROS")],
  ["past departure", () => validateDateRange("2020-01-01", undefined, Date.now())],
  ["date shape", () => validateDateRange("01-01-2027", undefined, Date.now())],
  ["inverted range", () => validateDateRange("2027-05-10", "2027-05-01", Date.parse("2027-01-01"))],
  ["party size", () => validateParty(0, [])],
  ["child age", () => validateParty(1, [44])],
  ["empty credentials", () => normalizeCredentialFields({})],
  ["credential field name", () => normalizeCredentialFields({ "bad name": "x" })],
  [
    "unknown connector",
    () =>
      validateConnectionInput({
        connectorId: "not-a-real-supplier",
        environment: "sandbox",
        credentialScheme: "api_key",
        fields: { apiKey: "x" },
      }),
  ],
  [
    "wrong credential scheme for connector",
    () =>
      validateConnectionInput({
        connectorId: "duffel",
        environment: "sandbox",
        credentialScheme: "pcc_office_id",
        fields: { pcc: "1A", officeId: "2B" },
      }),
  ],
  [
    "missing credential field",
    () =>
      validateConnectionInput({
        connectorId: "duffel",
        environment: "sandbox",
        credentialScheme: "api_key",
        fields: { wrongKey: "x" },
      }),
  ],
  ["pricing rule out of bounds", () => parsePricingRule({ markupPct: 99 })],
  ["pricing rule wrong type", () => parsePricingRule({ markupPct: "lots" })],
  ["pricing rule bad rounding", () => parsePricingRule({ rounding: "magic" })],
];

for (const [label, fn] of rejections) {
  test(`rejects a bad ${label} as ValidationError, not a bare Error`, () => {
    assert.throws(
      fn,
      (e: unknown) => {
        assert.ok(
          e instanceof ValidationError,
          `${label} threw ${(e as Error)?.constructor?.name} — guard() would report it as internal_error`,
        );
        assert.ok((e as Error).message.length > 0, "the message must say what was wrong");
        return true;
      },
      label,
    );
  });
}

test("a ValidationError message never carries internals", () => {
  for (const [, fn] of rejections) {
    try {
      fn();
    } catch (e) {
      const message = (e as Error).message;
      // These strings are shown verbatim to the caller, so nothing internal
      // may ride along in them.
      assert.ok(!/envelope|vault|ctx\.db|convex|Id</i.test(message), message);
      assert.ok(message.length < 200, `too long to show a user: ${message}`);
    }
  }
});

test("valid input still passes through untouched", () => {
  assert.equal(normalizeEmail(" Agent@Example.COM "), "agent@example.com");
  assert.doesNotThrow(() => assertPasswordPolicy("Correct-Horse-42"));
  assert.equal(normalizeIata("ath"), "ATH");
  assert.equal(deriveDisplayHint("api_key", { apiKey: "duffel_test_ABCD1234" }), "••••1234");
  assert.deepEqual(parsePricingRule({ markupPct: 0.12, rounding: "charm_99" }), {
    markupPct: 0.12,
    rounding: "charm_99",
  });
  assert.doesNotThrow(() =>
    validateConnectionInput({
      connectorId: "duffel",
      environment: "sandbox",
      credentialScheme: "api_key",
      fields: { apiKey: "duffel_test_abc" },
    }),
  );
});
