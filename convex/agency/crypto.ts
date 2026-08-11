/**
 * Planera for Travel Agencies — auth crypto primitives (pure, Web Crypto).
 *
 * Runs in the Convex V8 runtime (no "use node") and in Node for tests. Mirrors
 * the partner portal's PBKDF2 scheme. NOTHING here logs secrets.
 *
 *  - Passwords: PBKDF2-SHA512, 210k iterations, per-user random salt.
 *  - Tokens (session / invite / customer-link): random 256-bit, stored only as
 *    a SHA-256 hex HASH; the raw token lives only in the client.
 *  - All comparisons of secret material are constant-time.
 */

const subtle = globalThis.crypto.subtle;
const PBKDF2_ITER = 210_000;

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time hex string comparison (length-independent short-circuit only on length). */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2Hex(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: PBKDF2_ITER, hash: "SHA-512" },
    keyMaterial,
    512,
  );
  return bytesToHex(new Uint8Array(bits));
}

export interface PasswordRecord {
  hash: string; // hex
  salt: string; // hex
}

/** Hash a new password with a fresh random salt. */
export async function hashPassword(password: string): Promise<PasswordRecord> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const hash = await pbkdf2Hex(password, salt);
  return { hash, salt: bytesToHex(salt) };
}

/** Verify a password against a stored record (constant-time). */
export async function verifyPassword(password: string, rec: PasswordRecord): Promise<boolean> {
  if (!rec?.hash || !rec?.salt) return false;
  const computed = await pbkdf2Hex(password, hexToBytes(rec.salt));
  return constantTimeEqualHex(computed, rec.hash);
}

/** SHA-256 hex of an input string — used to hash tokens before storage. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(input)));
  return bytesToHex(new Uint8Array(digest));
}

/** A fresh, unguessable 256-bit token (base64url). Return raw to the client ONCE. */
export function newToken(): string {
  return toB64url(randomBytes(32));
}
