# Planera for Travel Agencies — backend module

Multi-tenant B2B travel-tech module. **Additive** under `convex/agency/` — it
does not modify any existing table, function, or the mobile app (only a single
additive `...agencyTables` spread in the shared `convex/schema.ts`).

## Placement & deploy rules (firm)
- This backend is **canonical here in the mobile repo** and is the ONLY copy —
  it is **not** mirrored into the web repo's `convex/`. The web UI addresses
  these functions by name via `makeFunctionReference` (see
  `planeraai-web/src/lib/agency/api.ts`), which keeps the single-copy rule
  intact while the frontend stays fully type-checked.
- **Convex deploys happen ONLY from this (mobile) repo. Never deploy from the
  web repo.**
- ADR: `../../planeraai-web/docs/agency-portal/ADR-0001-foundation.md`.

## Layout

Everything splits into **pure modules** (no Convex imports — unit-tested with
`node --test`) and **thin Convex adapters** that do nothing but authorise,
validate, persist and audit.

### Pure engine

| File | Purpose |
|---|---|
| `model/types.ts` | Canonical domain model (`Money`, `NormalizedOffer`, `TravelPackage`, `Quote`). Money is always integer minor units. |
| `pricing.ts` | Pricing engine. Net/commissionable/gross, markup, fees, expected commission, FX buffer, rounding + `parsePricingRule` (the only thing between a typo and a mis-priced quote). |
| `scoring.ts` | Package scoring — Basic/Comfort/Premium via weighted multi-criteria scoring, not sort-by-price. |
| `quote.ts` | Quote assembly: price → score → three packages, estimate-only food budget, disclosed pay-at-property, expiry. |
| `quoteView.ts` | The agent/customer split. The customer projection never *contains* cost, markup or margin. |
| `orchestrator.ts` | Parallel, capability-gated, partial-failure-tolerant fan-out, with a **per-connector deadline**; plus read-only revalidation where a timeout is *unverifiable*, not *unavailable*. |
| `runtime.ts` | The one place a BYOK credential is decrypted, and the only one. |
| `vault.ts` | AES-256-GCM envelope encryption (per-record DEK wrapped by a master KEK). |
| `crypto.ts` | PBKDF2-SHA512 password hashing (+ server pepper), SHA-256 token hashing, constant-time compare, timing equaliser. |
| `access.ts` | Access policy: `agencyId` from the SESSION, role hierarchy, permission matrix, MFA gate, idle timeout, revocation, credential cut-off. |
| `totp.ts` | RFC 6238 second factor + single-use recovery codes. |
| `rateLimit.ts` | Fixed-window throttles + the progressive login-lockout ladder. |
| `validation.ts` | Semantic validation: emails, password policy, IATA/currency/date/party bounds, credential field shapes, Greek-aware slugs. |
| `connectionService.ts` | Build/seal a BYOK connection, derive a non-secret hint, redact for the client. |
| `connectors/` | `types` (interface), `registry` (which providers exist + are enabled), `factory` (which are implemented), `http` (deadline/retry/redaction), `duffel` (real), `mock` (test doubles). |

### Convex adapters

| File | Surface |
|---|---|
| `auth.ts` | `registerAgency`, `login`, `logout`, `logoutEverywhere`, `touch`, `getMe`, `listMembers`, `inviteMember`, `acceptInvite`, `changeMemberRole`, `removeMember`, `changePassword`, MFA enrol/confirm/disable, `updateAgency`, `listAuditLog`. |
| `connections.ts` | `available`, `list`, `create`, `rotate`, `setEnabled`, `revoke`, `healthCheck` (action). |
| `pricingRules.ts` | `list`, `upsert`, `remove`, `setActive`. |
| `quotes.ts` | `search` (action), `list`, `get`, `revalidate` (action), `send`, `revokeLink`, `markAccepted`, `publicQuote` (action). |
| `store.ts` | The only place auth touches `ctx.db`: `requireAccess`, `assertTenant`, rate limits, audit. |
| `errors.ts` | Stable machine codes; `guard()` turns anything unexpected into `internal_error` instead of leaking a stack trace. |

## Security invariants

- **Tenant isolation.** `agencyId` is never read from client input. Every row
  fetched by id passes `assertTenant`, which answers *not found* rather than
  *forbidden* so probing ids cannot confirm a resource exists elsewhere.
- **Actions are not trusted with a tenant.** Every supplier-touching flow is
  mutation → action → mutation, and the final mutation re-derives the tenant
  from the row it is about to write.
- **Credentials.** Sealed on arrival, never returned, never logged; the UI only
  ever sees a last-4 hint. Revoking destroys the ciphertext. A vault failure
  reports one uniform message — "wrong key" vs "tampered" is not an oracle we
  hand out.
- **Sessions.** 256-bit tokens stored only as SHA-256 hashes; 7-day absolute
  expiry, 8-hour idle timeout, explicit revocation, and a `sessionsValidFrom`
  cut-off so one password change kills every session everywhere.
- **Login.** Identical answer and comparable CPU for "no such email" and "wrong
  password"; per-email throttle plus a progressive lockout ladder that is capped
  so the real owner is never permanently locked out.
- **Customer quotes.** Served by a separate endpoint returning a document that
  never held internal financials or provider-locked booking tokens.
- **Audit.** Every mutating action appends a row, with metadata scrubbed by key
  and by value.

## Tests

126 pass / 0 fail. The pure modules have no Convex dependency, so they compile
and run standalone:

```bash
# from a scratch dir with a tsconfig including convex/agency/__tests__/*.test.ts
# (module=commonjs, target=ES2021, lib ES2021+DOM, typeRoots → repo node_modules/@types)
npx tsc -p tsconfig.agency.json
node --test agency-build/__tests__/
```

Convex typecheck: `npx tsc --noEmit -p convex/tsconfig.json` — clean. Note that
`_generated/dataModel.d.ts` derives from `schema.ts`, so the new tables type-check
**without** running codegen.

`*.test.ts` files are skipped by the Convex bundler (it ignores entry points
containing multiple dots), so they are never deployed.

## Deploy status

**Written, typechecked and tested — but NOT deployed.** Prod is untouched. The
functions take effect only on the next deliberate Convex deploy from this repo.

### Required before first use

Set in the Convex dashboard (see `.env.example`):

| Variable | Why |
|---|---|
| `AGENCY_VAULT_MASTER_KEY` | 32 bytes, base64url. Without it every credential operation fails closed. Generate with `vault.generateMasterKeyB64url()`. |
| `AGENCY_AUTH_PEPPER` | Optional. A leaked database alone cannot be attacked offline with it set. Adding it later invalidates existing passwords, so set it **before** the first signup. |
| `AGENCY_QUOTE_PUBLIC_BASE_URL` | Origin for invite and customer-quote links. Defaults to `https://planeraai.app`. |

## Not yet built

Connectors beyond Duffel (Amadeus, Travelport, Sabre, Hotelbeds, WebBeds,
Expedia Rapid, Booking Demand, Travelgate, Liknoss, Ferryhopper, Viator, Tiqets)
— each blocked on its own commercial/certification track, not on code. Quote PDF
export. Package-scoped pricing rules.
