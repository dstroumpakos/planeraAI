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

/** Fields each scheme requires; used to reject incomplete input early. */
const REQUIRED_FIELDS: Record<CredentialScheme, string[]> = {
  api_key: ["apiKey"],
  oauth2_client_credentials: ["clientId", "clientSecret"],
  pcc_office_id: ["pcc", "officeId"],
  affiliate_id: ["affiliateId"],
};

export function validateConnectionInput(input: CreateConnectionInput): void {
  const entry = getRegistryEntry(input.connectorId);
  if (!entry) throw new Error(`unknown connector "${input.connectorId}"`);
  if (!entry.enabled) throw new Error(`connector "${input.connectorId}" is disabled`);
  if (entry.credentialScheme !== input.credentialScheme) {
    throw new Error(
      `connector "${input.connectorId}" expects scheme "${entry.credentialScheme}", got "${input.credentialScheme}"`,
    );
  }
  const missing = REQUIRED_FIELDS[input.credentialScheme].filter((f) => !input.fields?.[f]);
  if (missing.length) throw new Error(`missing credential field(s): ${missing.join(", ")}`);
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
