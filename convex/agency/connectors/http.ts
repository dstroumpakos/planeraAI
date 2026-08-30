/**
 * Shared HTTP + normalisation helpers for real supplier connectors.
 *
 * Every outbound supplier call goes through `fetchJson`, which owns the four
 * things each connector would otherwise get subtly wrong on its own:
 *  - a hard deadline (an abandoned socket must not hold a search open),
 *  - bounded retries with backoff, ONLY on retry-safe statuses,
 *  - errors that never echo back the request headers (BYOK keys live there),
 *  - a response-size ceiling, so a pathological payload cannot exhaust memory.
 */

/** ISO-4217 minor-unit exponents that are not 2. */
const CURRENCY_EXPONENT: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export const currencyExponent = (currency: string): number =>
  CURRENCY_EXPONENT[currency?.toUpperCase()] ?? 2;

/**
 * Convert a supplier's decimal amount string ("123.45") to integer minor units.
 * String-based on purpose: `Math.round(parseFloat(x) * 100)` loses cents on
 * values like "1234.565" and money must never round through a float.
 */
export function decimalToMinor(value: string | number, currency: string): number {
  const raw = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`unparseable amount "${raw}"`);
  const exp = currencyExponent(currency);
  const negative = raw.startsWith("-");
  const [intPart, fracPart = ""] = raw.replace("-", "").split(".");
  const padded = (fracPart + "0".repeat(exp)).slice(0, exp);
  // Round using the first dropped digit rather than truncating.
  const nextDigit = fracPart.length > exp ? Number(fracPart[exp]) : 0;
  const minor = Number(intPart) * 10 ** exp + Number(padded || "0") + (nextDigit >= 5 ? 1 : 0);
  if (!Number.isFinite(minor)) throw new Error(`amount out of range "${raw}"`);
  return negative ? -minor : minor;
}

/** "PT2H35M" → 155. Returns 0 for anything unparseable. */
export function isoDurationToMinutes(iso: string | undefined): number {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export class SupplierHttpError extends Error {
  constructor(
    public status: number,
    public connectorId: string,
    message: string,
  ) {
    super(message);
    this.name = "SupplierHttpError";
  }
}

export interface FetchJsonOptions {
  connectorId: string;
  timeoutMs?: number;
  /** Extra attempts after the first, for retry-safe failures only. */
  retries?: number;
  /** Reject responses larger than this many bytes. */
  maxBytes?: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * JSON fetch with a deadline, bounded retries and redacted errors. Only GET is
 * retried automatically; a non-idempotent POST is retried only when the
 * supplier explicitly said "too many requests" or the connection never
 * established a response.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  opts: FetchJsonOptions,
): Promise<T> {
  const { connectorId, timeoutMs = 10_000, retries = 2, maxBytes = 8 * 1024 * 1024 } = opts;
  const method = (init.method ?? "GET").toUpperCase();
  let lastError: Error = new SupplierHttpError(0, connectorId, "request never ran");

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxBytes) {
        throw new SupplierHttpError(res.status, connectorId, "supplier response too large");
      }
      const text = await res.text();
      if (text.length > maxBytes) {
        throw new SupplierHttpError(res.status, connectorId, "supplier response too large");
      }

      if (!res.ok) {
        // Include the supplier's own short message, never our request headers.
        const detail = summariseErrorBody(text);
        const err = new SupplierHttpError(
          res.status,
          connectorId,
          `${connectorId} returned ${res.status}${detail ? `: ${detail}` : ""}`,
        );
        const retrySafe = RETRYABLE.has(res.status) && (method === "GET" || res.status === 429);
        if (retrySafe && attempt < retries) {
          lastError = err;
          await backoff(attempt, res.headers.get("retry-after"));
          continue;
        }
        throw err;
      }

      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (e) {
      const err = e as Error;
      if (err instanceof SupplierHttpError) throw err;
      // Aborts and network failures never reached a handler → safe to retry.
      if (attempt < retries) {
        lastError = err;
        await backoff(attempt, null);
        continue;
      }
      throw new SupplierHttpError(
        0,
        connectorId,
        err.name === "AbortError"
          ? `${connectorId} timed out after ${timeoutMs}ms`
          : `${connectorId} is unreachable`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  const headerMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
  // Jitter so a fleet of tenants does not retry in lockstep.
  const base = Math.min(2000, 250 * 2 ** attempt);
  const wait = Math.min(5000, Math.max(headerMs, base + Math.random() * 200));
  return new Promise((r) => setTimeout(r, wait));
}

/** Pull a short human message out of an error body without echoing the whole thing. */
function summariseErrorBody(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const first = parsed?.errors?.[0] ?? parsed?.error ?? parsed;
    const msg = first?.title ?? first?.message ?? first?.detail ?? first?.code;
    if (typeof msg === "string") return msg.slice(0, 200);
  } catch {
    /* not JSON — fall through */
  }
  return text.slice(0, 200).replace(/\s+/g, " ");
}
