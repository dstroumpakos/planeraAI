# Planera for Travel Agencies — backend module

Multi-tenant B2B travel-tech module. **Additive** under `convex/agency/` — it
does not modify any existing table, function, or the mobile app (only a single
additive `...agencyTables` spread in the shared `convex/schema.ts`).

## Placement & deploy rules (firm)
- This backend is **canonical here in the mobile repo** and is the ONLY copy —
  it is **not** mirrored into the web repo's `convex/`.
- **Convex deploys happen ONLY from this (mobile) repo. Never deploy from the
  web repo.**
- The **web repo holds the frontend UI only** and reaches Convex at runtime via
  the shared deployment URL.
- ADR: `../../planeraai-web/docs/agency-portal/ADR-0001-foundation.md`.

## What's here (Increment 1 — foundation)

| File | Purpose | Status |
|---|---|---|
| `model/types.ts` | Canonical domain model (`Money`, `NormalizedOffer`, `TravelPackage`, `Quote`). Money is always integer minor units. | ✅ done, framework-agnostic |
| `pricing.ts` | Pricing engine (pure). Net/commissionable/gross, markup, fees, expected commission, FX buffer, rounding. Enforces the no-double-tax / no-forbidden-markup invariants. | ✅ done + tested |
| `scoring.ts` | Package scoring engine (pure). Builds Basic/Comfort/Premium via weighted multi-criteria scoring — not sort-by-price. | ✅ done + tested |
| `connectors/types.ts` | `SupplierConnector` interface + capability declaration. BYOK only; no password field. | ✅ done |
| `connectors/registry.ts` | Data-driven provider registry. Disable a provider = `enabled: false` (no code change). | ✅ done |
| `connectors/mock.ts` | Deterministic mock air/hotel connectors for tests + sandbox. | ✅ done |
| `vault.ts` | Secrets vault — AES-256-GCM envelope encryption for BYOK credentials (per-record DEK wrapped by a master KEK). | ✅ done + tested |
| `schema.ts` | Agency tenant tables (`agencies`, `agencyUsers`, `agencyMembers`, `agencySessions`, `supplierConnections`, `agencyPricingRules`, `quotes`, `agencyAuditLog`). Spread into the root schema. | ✅ written + typecheck-clean |
| `crypto.ts` | Auth primitives (pure): PBKDF2-SHA512 password hash/verify, SHA-256 token hashing, random tokens, constant-time compare. | ✅ done + tested |
| `access.ts` | Access control & **tenant scoping** (pure policy): `resolveAccess` (agencyId from session, not input), role hierarchy, permission matrix, `assertSameTenant`, MFA gating. | ✅ done + tested |
| `connectionService.ts` | BYOK connection build/seal (via vault) + registry validation + non-secret display hint + `redactConnection`. | ✅ done + tested |
| `orchestrator.ts` | Search orchestrator — parallel, capability-gated, partial-failure tolerant; + `searchForQuote` (flight+hotel) and `revalidateSelected` (read-only price/avail recheck; timeout ≠ unavailable). | ✅ done + tested |
| `quote.ts` | Quote assembly — price → score → 3 packages with internal financials, estimate-only food budget, disclosed pay-at-property, expiry; + `resolvePricingRule` (destination>supplier>agency). | ✅ done + tested |
| `__tests__/` | pricing, scoring, vault, tenant-isolation/access, crypto, connections, **orchestrator, quote**. | ✅ 48/48 pass |

### Pending thin Convex adapters
`auth.ts` (signup/invite/login/logout/session mutations) and `connections.ts`
(create/list/healthCheck/revoke) are thin `ctx.db` wrappers over the pure
services above. They import `_generated` (which needs the new tables), so they
land together with the first codegen/deploy **from this repo**.

## Deploy status
Schema tables are **written and wired but NOT deployed** — prod is untouched.
They take effect only on the next deliberate Convex deploy **from this repo**.

## Not yet built (next increments)
Agency auth/session functions + tenant-scoping, connection CRUD (using the
vault), search orchestrator, real provider connectors, quote/PDF, revalidation
engine, web UI (`planeraai-web/src/`).

## Running the tests

The pure engines have no Convex dependency, so they compile and run standalone.
Using the web repo's local TypeScript (no install needed):

```bash
# from a scratch dir with a tsconfig that includes convex/agency/**/*.ts
node <path>/typescript/bin/tsc -p tsconfig.agency.json   # module=commonjs, target=ES2021
node --test agency-build/__tests__/
```

Last run: **14 pass / 0 fail** (9 pricing invariants, 5 scoring).
