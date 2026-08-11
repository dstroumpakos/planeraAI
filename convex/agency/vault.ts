/**
 * Planera for Travel Agencies — Secrets Vault (envelope encryption).
 *
 * Encrypts per-tenant BYOK supplier credentials at rest. Uses AES-256-GCM via
 * Web Crypto (available in the Convex V8 runtime — no "use node"). Envelope
 * scheme so the master key can be rotated without re-encrypting every payload:
 *
 *   1. Generate a random Data Encryption Key (DEK) per record.
 *   2. Encrypt the credential JSON with the DEK (random IV).
 *   3. Wrap (encrypt) the DEK with the master Key-Encryption-Key (random IV).
 *   4. Store: v1.<wrappedDek>.<dekIv>.<payloadIv>.<ciphertext>  (all base64url).
 *
 * The master key comes from the AGENCY_VAULT_MASTER_KEY env var (32 bytes,
 * base64). It is NEVER logged and NEVER leaves the server. Decrypted credentials
 * exist only transiently inside a trusted server action.
 *
 * SECURITY INVARIANTS (tested):
 *  - ciphertext never contains the plaintext,
 *  - two encryptions of the same input differ (random DEK + IVs),
 *  - decryption with the wrong master key fails (GCM auth tag),
 *  - tampering with any segment fails decryption.
 */

const VERSION = "v1";
const subtle = globalThis.crypto.subtle;

// ── base64url helpers (no padding) ──────────────────────────────────────────
function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

async function importMasterKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = fromB64url(masterKeyB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw.length !== 32) {
    throw new Error(`vault: AGENCY_VAULT_MASTER_KEY must decode to 32 bytes (got ${raw.length})`);
  }
  return subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Web Crypto wants an ArrayBuffer (not a possibly-shared Uint8Array view).
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ── public API ──────────────────────────────────────────────────────────────

/** Encrypt an arbitrary JSON-serialisable value. Returns the opaque envelope string. */
export async function sealJson(masterKeyB64: string, value: unknown): Promise<string> {
  const kek = await importMasterKey(masterKeyB64);

  // 1) fresh DEK
  const dekRaw = randomBytes(32);
  const dek = await subtle.importKey("raw", toArrayBuffer(dekRaw), "AES-GCM", true, ["encrypt", "decrypt"]);

  // 2) encrypt payload with DEK
  const payloadIv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(payloadIv) }, dek, toArrayBuffer(plaintext)),
  );

  // 3) wrap DEK with KEK
  const dekIv = randomBytes(12);
  const wrappedDek = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(dekIv) }, kek, toArrayBuffer(dekRaw)),
  );

  return [VERSION, toB64url(wrappedDek), toB64url(dekIv), toB64url(payloadIv), toB64url(ct)].join(".");
}

/** Decrypt an envelope produced by `sealJson`. Throws on wrong key / tampering. */
export async function openJson<T = unknown>(masterKeyB64: string, envelope: string): Promise<T> {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error("vault: malformed envelope");
  }
  const [, wrappedDekB64, dekIvB64, payloadIvB64, ctB64] = parts;
  const kek = await importMasterKey(masterKeyB64);

  // unwrap DEK
  const dekRaw = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(fromB64url(dekIvB64)) },
      kek,
      toArrayBuffer(fromB64url(wrappedDekB64)),
    ),
  );
  const dek = await subtle.importKey("raw", toArrayBuffer(dekRaw), "AES-GCM", false, ["decrypt"]);

  // decrypt payload
  const plaintext = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(fromB64url(payloadIvB64)) },
      dek,
      toArrayBuffer(fromB64url(ctB64)),
    ),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Generate a fresh 32-byte master key (base64url) — for provisioning/rotation. */
export function generateMasterKeyB64url(): string {
  return toB64url(randomBytes(32));
}
