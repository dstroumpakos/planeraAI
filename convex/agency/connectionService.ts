/**
 * Planera for Travel Agencies — supplier connection service (pure).
 *
 * Builds the persisted `supplierConnections` record from user input:
 *  - validates the connectorId exists AND is enabled in the registry,
 *  - validates the credential scheme matches what the connector expects,
 *  - SEALS the raw credential fields into a vault envelope (never plaintext),
 *  - derives a NON-SECRET display hint for the UI.
 *
 * And redacts a stored record for any client-facing response (strips the
 * envelope entirely). The Convex mutation is a thin adapter over these.
 */

import { getRegistryEntry } from "./connectors/registry";
import type { CredentialScheme, SupplierCredentials } from "./connectors/types";
import { sealJson } from "./vault";
import { ValidationError } from "./validation";

export interface CreateConnectionInput {
  connectorId: string;
  environment: "sandbox" | "production";
  credentialScheme: CredentialScheme;
  /** Raw secret fields, e.g. { apiKey } | { clientId, clientSecret } | { pcc, officeId }. */
  fields: Record<string, string>;
}

export interface SealedConnection {
  connectorId: string;
  environment: "sandbox" | "production";
  credentialScheme: CredentialScheme;
  encryptedCredentials: string; // vault envelope
  displayHint: string; // non-secret
  status: "active";
}

/** Last-4 style hint that never leaks the secret. */
export function deriveDisplayHint(scheme: CredentialScheme, fields: Record<string, string>): string {
  const last4 = (s: string | undefined) => (s && s.length >= 4 ? `••••${s.slice(-4)}` : "••••");
  switch (scheme) {
    case "api_key":
      return last4(fields.apiKey ?? fields.key);
    case "oauth2_client_credentials":
      return `client ${last4(fields.clientId)}`;
    case "pcc_office_id":
      return `PCC ${fields.pcc ?? "—"} / Office ${fields.officeId ?? "—"}`;
    case "affiliate_id":
      return `aff ${last4(fields.affiliateId)}`;
  }
}

/**
 * Fallback per SCHEME, used only if a registry entry somehow declares no
 * fields. The scheme alone is not enough to know what a provider needs —
 * Hotelbeds and Expedia are both "api_key" but each also requires a secret to
 * sign a request — so the registry's own `credentialFields` is authoritative.
 */
const SCHEME_FALLBACK_FIELDS: Record<CredentialScheme, string[]> = {
  api_key: ["apiKey"],
  oauth2_client_credentials: ["clientId", "clientSecret"],
  pcc_office_id: ["pcc", "officeId"],
  affiliate_id: ["affiliateId"],
};

export function validateConnectionInput(input: CreateConnectionInput): void {
  const entry = getRegistryEntry(input.connectorId);
  if (!entry) throw new ValidationError(`unknown connector "${input.connectorId}"`);
  if (!entry.enabled) throw new ValidationError(`connector "${input.connectorId}" is disabled`);
  if (entry.credentialScheme !== input.credentialScheme) {
    throw new ValidationError(
      `connector "${input.connectorId}" expects scheme "${entry.credentialScheme}", got "${input.credentialScheme}"`,
    );
  }

  const required = entry.credentialFields.length
    ? entry.credentialFields.map((f) => f.key)
    : SCHEME_FALLBACK_FIELDS[input.credentialScheme];
  const missing = required.filter((f) => !input.fields?.[f]);
  if (missing.length) {
    // Name them the way the provider does, so the agency knows what to go and find.
    const labels = missing.map(
      (key) => entry.credentialFields.find((f) => f.key === key)?.label ?? key,
    );
    throw new ValidationError(`missing credential field(s): ${labels.join(", ")}`);
  }
}

/** Validate + seal. `masterKeyB64` comes from AGENCY_VAULT_MASTER_KEY (server only). */
export async function sealConnection(
  masterKeyB64: string,
  input: CreateConnectionInput,
): Promise<SealedConnection> {
  validateConnectionInput(input);
  const creds: SupplierCredentials = {
    scheme: input.credentialScheme,
    environment: input.environment,
    fields: input.fields,
  };
  const encryptedCredentials = await sealJson(masterKeyB64, creds);
  return {
    connectorId: input.connectorId,
    environment: input.environment,
    credentialScheme: input.credentialScheme,
    encryptedCredentials,
    displayHint: deriveDisplayHint(input.credentialScheme, input.fields),
    status: "active",
  };
}

/** Strip the secret envelope from a stored row for any client response. */
export function redactConnection<T extends { encryptedCredentials?: unknown }>(
  row: T,
): Omit<T, "encryptedCredentials"> {
  const { encryptedCredentials, ...safe } = row;
  return safe;
}
