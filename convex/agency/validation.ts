/**
 * Planera for Travel Agencies — input validation (pure).
 *
 * Convex `v.*` validators guarantee TYPES at the boundary; this module
 * guarantees MEANING (a real IATA code, a date that isn't in the past, a
 * password that isn't "password123"). Every public function runs its args
 * through here before touching the database.
 *
 * Throws `ValidationError`, which `guard()` in `errors.ts` converts to an
 * `invalid_input` response carrying the message verbatim — these strings are
 * written to be read by the person who typed the bad value. A plain `Error`
 * would be swallowed as `internal_error` ("something went wrong"), which is
 * exactly what happened before this class existed.
 */

/** A rejected input, safe to show the caller. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Identity ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** Lowercase + trim. The stored, unique, and compared form of an email. */
export function normalizeEmail(raw: string): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ValidationError("invalid email address");
  return email;
}

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Deliberately small: a blocklist is not a substitute for length, and a huge
 * embedded list would bloat the deploy bundle. Length + variety + the obvious
 * offenders, then PBKDF2 does the real work.
 */
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwertyuiop", "letmein123", "welcome123", "iloveyou1",
  "administrator", "planeraai", "travelagency", "changeme123",
]);

/** Throw unless the password meets the agency-portal policy. */
export function assertPasswordPolicy(password: string, email?: string): void {
  if (typeof password !== "string") throw new ValidationError("password required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 200) throw new ValidationError("password is too long");
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  if (classes < 3) {
    throw new ValidationError("password must mix upper case, lower case, digits and symbols");
  }
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) throw new ValidationError("password is too common");
  if (email) {
    const local = email.split("@")[0];
    if (local.length >= 3 && lower.includes(local.toLowerCase())) {
      throw new ValidationError("password must not contain your email address");
    }
  }
}

// ── Tenant ──────────────────────────────────────────────────────────────────

export function normalizeAgencyName(raw: string): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) throw new ValidationError("agency name must be 2–120 characters");
  return name;
}

/**
 * Greek \u2192 Latin transliteration. Greece is the first market, and NFD does not
 * fold Greek letters to ASCII: without this an agency called "\u03a4\u03b1\u03be\u03af\u03b4\u03b9\u03b1 \u0395\u03bb\u03bb\u03ac\u03c2"
 * slugs to the empty string and cannot register at all.
 */
const GREEK_MAP: Record<string, string> = {
  \u03b1: "a", \u03b2: "v", \u03b3: "g", \u03b4: "d", \u03b5: "e", \u03b6: "z", \u03b7: "i", \u03b8: "th", \u03b9: "i",
  \u03ba: "k", \u03bb: "l", \u03bc: "m", \u03bd: "n", \u03be: "x", \u03bf: "o", \u03c0: "p", \u03c1: "r", \u03c3: "s",
  \u03c2: "s", \u03c4: "t", \u03c5: "y", \u03c6: "f", \u03c7: "ch", \u03c8: "ps", \u03c9: "o",
};

function transliterate(input: string): string {
  let out = "";
  for (const ch of input) out += GREEK_MAP[ch] ?? ch;
  return out;
}

/**
 * URL-safe tenant slug derived from the agency name. Never throws: the slug is
 * an internal identifier, not user-visible content, and the caller appends a
 * uniqueness suffix \u2014 so a name with nothing transliterable falls back instead
 * of blocking registration.
 */
export function slugify(raw: string): string {
  const slug = transliterate(
    String(raw ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length >= 2 ? slug : "agency";
}

// ── Travel primitives ───────────────────────────────────────────────────────

const IATA_RE = /^[A-Z]{3}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeIata(raw: string, label = "airport code"): string {
  const code = String(raw ?? "").trim().toUpperCase();
  if (!IATA_RE.test(code)) throw new ValidationError(`${label} must be a 3-letter IATA code`);
  return code;
}

export function normalizeCurrency(raw: string): string {
  const cur = String(raw ?? "").trim().toUpperCase();
  if (!CURRENCY_RE.test(cur)) throw new ValidationError("currency must be a 3-letter ISO 4217 code");
  return cur;
}

/** Furthest ahead a search may be made — beyond this no supplier has inventory. */
export const MAX_SEARCH_HORIZON_DAYS = 365;
export const MAX_TRIP_NIGHTS = 60;

function parseYmd(date: string, label: string): number {
  if (!DATE_RE.test(date)) throw new ValidationError(`${label} must be YYYY-MM-DD`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new ValidationError(`${label} is not a real date`);
  return ms;
}

export interface DateRange {
  departDate: string;
  returnDate?: string;
  /** Whole nights between depart and return (0 for a one-way). */
  nights: number;
}

/**
 * Validate a search's date range against "now". Rejects past dates, inverted
 * ranges, and absurd horizons — each of which otherwise reaches a supplier as a
 * paid API call that can only fail.
 */
export function validateDateRange(
  departDate: string,
  returnDate: string | undefined,
  now: number,
): DateRange {
  const depart = parseYmd(departDate, "departure date");
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
  if (depart < today) throw new ValidationError("departure date is in the past");
  if (depart - today > MAX_SEARCH_HORIZON_DAYS * 86_400_000) {
    throw new ValidationError(`departure date is more than ${MAX_SEARCH_HORIZON_DAYS} days ahead`);
  }
  if (!returnDate) return { departDate, nights: 0 };

  const ret = parseYmd(returnDate, "return date");
  if (ret < depart) throw new ValidationError("return date is before the departure date");
  const nights = Math.round((ret - depart) / 86_400_000);
  if (nights > MAX_TRIP_NIGHTS) throw new ValidationError(`trip cannot exceed ${MAX_TRIP_NIGHTS} nights`);
  return { departDate, returnDate, nights };
}

export const MAX_ADULTS = 9;
export const MAX_CHILDREN = 8;

export interface PartySize {
  adults: number;
  childrenAges: number[];
  travelers: number;
}

export function validateParty(adults: number, childrenAges: number[] | undefined): PartySize {
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) {
    throw new ValidationError(`adults must be between 1 and ${MAX_ADULTS}`);
  }
  const ages = childrenAges ?? [];
  if (ages.length > MAX_CHILDREN) throw new ValidationError(`at most ${MAX_CHILDREN} children`);
  for (const age of ages) {
    if (!Number.isInteger(age) || age < 0 || age > 17) {
      throw new ValidationError("each child age must be a whole number between 0 and 17");
    }
  }
  return { adults, childrenAges: ages, travelers: adults + ages.length };
}

// ── Credentials ─────────────────────────────────────────────────────────────

/**
 * BYOK credential fields arrive as free-form strings. Bound their size and
 * shape so a caller cannot smuggle a megabyte of junk into the vault, and strip
 * whitespace that users routinely paste along with an API key.
 */
export function normalizeCredentialFields(fields: Record<string, string>): Record<string, string> {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) throw new ValidationError("credentials are required");
  if (entries.length > 12) throw new ValidationError("too many credential fields");
  const out: Record<string, string> = {};
  for (const [k, val] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)) throw new ValidationError(`invalid credential field "${k}"`);
    if (typeof val !== "string") throw new ValidationError(`credential "${k}" must be a string`);
    const trimmed = val.trim();
    if (trimmed.length === 0) throw new ValidationError(`credential "${k}" is empty`);
    if (trimmed.length > 4096) throw new ValidationError(`credential "${k}" is too long`);
    out[k] = trimmed;
  }
  return out;
}
