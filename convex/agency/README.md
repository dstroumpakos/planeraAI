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

176 pass / 0 fail. The pure modules have no Convex dependency, so they compile
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

**Deployed to prod on 2026-08-31.** It went out as a side effect of the agency-outreach
deploy — Convex ships every module together, so there was no way to deploy one and not the
other. Treat the portal as live: `/agency/signup` now reaches a real backend.

### Required before first use

Set in the Convex dashboard (see `.env.example`):

| Variable | Why |
|---|---|
| `AGENCY_VAULT_MASTER_KEY` | 32 bytes, base64url. Without it every credential operation fails closed. Generate with `vault.generateMasterKeyB64url()`. |
| `AGENCY_AUTH_PEPPER` | Optional. A leaked database alone cannot be attacked offline with it set. Adding it later invalidates existing passwords, so set it **before** the first signup. |
| `AGENCY_QUOTE_PUBLIC_BASE_URL` | Origin for invite and customer-quote links. Defaults to `https://planeraai.app`. |

## Not yet built

A destination-id mapping layer (see below — it unblocks most non-flight
providers at once). Per-provider revalidation. Quote PDF export.
Package-scoped pricing rules.

## All 14 providers are callable (2026-08-30, NOT yet deployed)

Every registry provider now has a working connector. What differs is depth, and
the UI reports it honestly per provider (`searchable` + `pendingReason`).

| Depth | Providers |
|---|---|
| Search + revalidate | Duffel, mock-air, mock-hotel |
| Search | Amadeus (Flight Offers Search v2) |
| Real auth + real health probe | Sabre, Travelport, Hotelbeds, Expedia Rapid, Booking.com Demand, Travelgate, Viator, Tiqets |
| Auth wired, no confirmed endpoint | WebBeds, Liknoss, Ferryhopper |

**Design.** `connectors/generic.ts` builds a connector from a declarative
`ConnectorSpec` (`connectors/providers.ts`); `connectors/auth.ts` holds the
shared auth schemes — OAuth2 client_credentials with token caching, Hotelbeds'
per-request SHA-256 `X-Signature`, Expedia's SHA-512 EAN signature, and header
keys. Twelve integrations stay comparable instead of drifting apart.

**The honesty rule, enforced by tests.** A provider whose SEARCH contract is not
public still authenticates and health-checks for real, but `search` throws a
named reason rather than posting a guessed payload. A connector never declares a
capability it cannot perform — in particular `revalidate` stays false, because
declaring it would let the orchestrator present unverified fares as confirmed.

**Why most non-flight providers cannot search yet.** Flights key off IATA codes,
which are universal. Hotels, activities and ferries key off each provider's OWN
destination taxonomy (Hotelbeds destination codes, Expedia region ids, Viator
destination ids, Tiqets city ids, port codes) which cannot be derived from an
IATA code. A destination-mapping layer, fed from each provider's locations feed,
is the single piece of work that unblocks most of them at once.

**Credential fields are per-provider, not per-scheme.** `registry.ts` declares
exactly what each provider needs and drives both the connect form and the
validator. Hotelbeds and Expedia are both "api_key" providers that also need a
secret; Sabre needs a PCC; Amadeus needs its contract-issued host. Previously
any of these could be saved half-filled and would only fail later, at search.

### Two defects found by probing the real endpoints

Running every host with deliberately invalid credentials (a 401 is the pass —
the host resolved, the path routed, the provider read our credentials and said
no) caught two things code review would not have:

- **Travelport** issues tokens from `oauth[.pp].travelport.com`, not from its
  API host. The same path on the API host is a 404 that reads like a credential
  failure. `AuthSpec.tokenHosts` now separates them.
- **Amadeus** hosts `api.amadeus.com` and `test.api.amadeus.com` no longer
  resolve at all (confirmed by DNS, while `amadeus.com` and
  `developers.amadeus.com` do) — the Self-Service platform was retired on
  17 Jul 2026. Amadeus is Enterprise-only and issues an endpoint per contract,
  so the host is now a validated per-connection credential field (`apiHost`).

Both are covered by regression tests. Probe script:
`scratchpad/probe-hosts.js` — 8/10 endpoints reached on the first run.
