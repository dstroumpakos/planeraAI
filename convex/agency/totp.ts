/**
 * Planera for Travel Agencies — TOTP second factor (RFC 6238 / RFC 4226).
 *
 * HMAC-SHA1, 30-second step, 6 digits — the parameters every authenticator app
 * (Google Authenticator, 1Password, Authy) assumes. Pure Web Crypto, so it runs
 * in the Convex V8 runtime with no "use node".
 *
 * The shared secret is generated here, shown to the user ONCE during enrolment,
 * and then stored only as a vault envelope (`agencyUsers.mfaSecretEnvelope`).
 *
 * Replay: a 6-digit code stays valid for its whole 30s step, so a stolen code
 * could be reused inside that window. `agencyUsers.mfaLastUsedStep` records the
 * step a code was accepted at and the verifier refuses to accept the same step
 * twice — see `auth.ts`.
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
/** Steps of clock drift tolerated on each side (±30s). */
export const TOTP_DRIFT_STEPS = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh 160-bit secret, base32-encoded for the authenticator app. */
export function generateTotpSecret(): string {
  return base32Encode(globalThis.crypto.getRandomValues(new Uint8Array(20)));
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** The counter value for a given instant. */
export function stepFor(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

/** The 6-digit code for one counter step. */
export async function totpCodeForStep(secretB32: string, step: number): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base32Decode(secretB32)),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  // 8-byte big-endian counter.
  const counter = new Uint8Array(8);
  let rest = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, toArrayBuffer(counter)));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export interface TotpVerification {
  ok: boolean;
  /** The step the code matched — persist it to block replay of the same code. */
  step?: number;
}

/**
 * Verify a user-supplied code against the drift window, in constant time per
 * candidate. `minStep` (exclusive) rejects a step that has already been used.
 */
export async function verifyTotp(
  secretB32: string,
  code: string,
  nowMs: number,
  minStep?: number,
): Promise<TotpVerification> {
  const cleaned = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { ok: false };
  const current = stepFor(nowMs);
  let matched: number | undefined;
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = current + d;
    if (minStep !== undefined && step <= minStep) continue;
    const expected = await totpCodeForStep(secretB32, step);
    // Constant-time compare; keep looping so timing does not reveal which step hit.
    let diff = 0;
    for (let i = 0; i < TOTP_DIGITS; i++) diff |= expected.charCodeAt(i) ^ cleaned.charCodeAt(i);
    if (diff === 0 && matched === undefined) matched = step;
  }
  return matched === undefined ? { ok: false } : { ok: true, step: matched };
}

/** The `otpauth://` URI an authenticator app scans. Contains the secret — show once. */
export function otpauthUri(secretB32: string, accountEmail: string, issuer = "Planera"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes ───────────────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use codes, shown once at enrolment and stored only as hashes. */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = base32Encode(globalThis.crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export const normalizeRecoveryCode = (code: string): string =>
  String(code ?? "").replace(/[\s-]/g, "").toUpperCase();
