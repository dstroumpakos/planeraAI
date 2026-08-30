/**
 * Turning stored connection rows into runnable connector bindings.
 *
 * This is the ONLY place a BYOK credential is decrypted. It runs inside a
 * Convex action, the plaintext lives in one local variable for the duration of
 * one search, and it is never returned, logged, or written back to the database.
 *
 * A connection that cannot be opened (rotated master key, tampered envelope,
 * provider we have not implemented) is SKIPPED with a diagnostic rather than
 * failing the search — one broken supplier must not take down a tenant's whole
 * quoting workflow.
 */

import { getConnector } from "./connectors/factory";
import type { SupplierCredentials } from "./connectors/types";
import type { ConnectorBinding, ConnectorRunResult } from "./orchestrator";
import { openJson } from "./vault";

export interface StoredConnectionRow {
  connectorId: string;
  environment: "sandbox" | "production";
  credentialScheme: string;
  encryptedCredentials: string;
  status: "active" | "disabled" | "error";
}

export interface BindingBuild {
  bindings: ConnectorBinding[];
  /** Connections that could not be made runnable, as search diagnostics. */
  skipped: ConnectorRunResult[];
}

/**
 * Open every active connection for a tenant. `masterKeyB64` comes from the
 * server environment; callers must never accept it from client input.
 */
export async function buildBindings(
  masterKeyB64: string,
  rows: StoredConnectionRow[],
): Promise<BindingBuild> {
  const bindings: ConnectorBinding[] = [];
  const skipped: ConnectorRunResult[] = [];

  for (const row of rows) {
    if (row.status !== "active") {
      skipped.push({
        connectorId: row.connectorId,
        ok: false,
        count: 0,
        ms: 0,
        error: `connection is ${row.status}`,
      });
      continue;
    }

    const connector = getConnector(row.connectorId);
    if (!connector) {
      skipped.push({
        connectorId: row.connectorId,
        ok: false,
        count: 0,
        ms: 0,
        skippedReason: "not_implemented",
      });
      continue;
    }

    try {
      const creds = await openJson<SupplierCredentials>(masterKeyB64, row.encryptedCredentials);
      // Trust the envelope's own environment, not the row: the row is editable
      // metadata, the envelope is authenticated ciphertext.
      bindings.push({ connector, creds });
    } catch {
      // Never surface the vault's message — it distinguishes "wrong key" from
      // "tampered", which is a detail a client has no business learning.
      skipped.push({
        connectorId: row.connectorId,
        ok: false,
        count: 0,
        ms: 0,
        error: "stored credentials could not be opened — reconnect this supplier",
      });
    }
  }

  return { bindings, skipped };
}

/** Index bindings by connector id, for provider-locked revalidation. */
export function bindingsById(bindings: ConnectorBinding[]): Map<string, ConnectorBinding> {
  return new Map(bindings.map((b) => [b.connector.id, b]));
}
