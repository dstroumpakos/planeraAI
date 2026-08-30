/**
 * Planera for Travel Agencies — error surface.
 *
 * ONE rule: the client only ever sees a stable machine code + a short, safe
 * message. Internal detail (stack traces, provider payloads, SQL-ish errors,
 * whether an email exists) never crosses the boundary. Handlers wrap their body
 * in `guard()`, which converts anything unexpected into `internal_error` while
 * still logging the real cause server-side.
 */

import { ConvexError } from "convex/values";
import { AccessError } from "./access";

export type AgencyErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "rate_limited"
  | "vault_unavailable"
  | "connector_unavailable"
  | "quote_expired"
  | "internal_error";

export interface AgencyErrorData {
  // Index signature so the payload satisfies Convex's `Value` constraint.
  [key: string]: string | number | undefined;
  code: AgencyErrorCode;
  message: string;
  /** Seconds to wait before retrying — set only for `rate_limited`. */
  retryAfterSec?: number;
}

export class AgencyError extends ConvexError<AgencyErrorData> {
  constructor(code: AgencyErrorCode, message: string, retryAfterSec?: number) {
    super({ code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) });
  }
}

export const invalid = (message: string) => new AgencyError("invalid_input", message);
export const notFound = (what = "resource") => new AgencyError("not_found", `${what} not found`);
export const forbidden = (message = "not allowed") => new AgencyError("forbidden", message);
export const unauthenticated = (message = "sign in required") =>
  new AgencyError("unauthenticated", message);
export const conflict = (message: string) => new AgencyError("conflict", message);

/** Map the pure policy layer's AccessError onto the wire format. */
export function fromAccessError(e: AccessError): AgencyError {
  return new AgencyError(e.code, e.message);
}

/**
 * Wrap a handler body. Known errors pass through untouched; anything else is
 * logged server-side and replaced with an opaque `internal_error` so we never
 * leak a stack trace, a provider response, or a vault message to a client.
 */
export async function guard<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ConvexError) throw e;
    if (e instanceof AccessError) throw fromAccessError(e);
    console.error(`[agency:${label}]`, e instanceof Error ? e.message : String(e));
    throw new AgencyError("internal_error", "something went wrong");
  }
}
