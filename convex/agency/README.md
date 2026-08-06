# Planera for Travel Agencies — backend module

Multi-tenant B2B travel-tech module. **Additive and self-contained** under
`convex/agency/` — it does not modify any existing table, function, or the mobile
app. See `../../planeraai-web/docs/agency-portal/ADR-0001-foundation.md`.

## What's here (Increment 1 — foundation)

| File | Purpose | Status |
|---|---|---|
| `model/types.ts` | Canonical domain model (`Money`, `NormalizedOffer`, `TravelPackage`, `Quote`). Money is always integer minor units. | ✅ done, framework-agnostic |
| `pricing.ts` | Pricing engine (pure). Net/commissionable/gross, markup, fees, expected commission, FX buffer, rounding. Enforces the no-double-tax / no-forbidden-markup invariants. | ✅ done + tested |
| `scoring.ts` | Package scoring engine (pure). Builds Basic/Comfort/Premium via weighted multi-criteria scoring — not sort-by-price. | ✅ done + tested |
| `connectors/types.ts` | `SupplierConnector` interface + capability declaration. BYOK only; no password field. | ✅ done |
| `connectors/registry.ts` | Data-driven provider registry. Disable a provider = `enabled: false` (no code change). | ✅ done |
| `connectors/mock.ts` | Deterministic mock air/hotel connectors for tests + sandbox. | ✅ done |
| `__tests__/` | Node test-runner tests for pricing invariants + scoring. | ✅ 14/14 pass |

## Not yet built (next increments)
Agency auth + tenant tables (`agencies`, `agencyMembers`, `supplierConnections`,
`quotes`, `agencyAuditLog`), secrets vault, search orchestrator, real provider
connectors, quote/PDF, revalidation engine, web UI. **No schema changes shipped
yet** → no Convex deploy required for this increment.

## Running the tests

The pure engines have no Convex dependency, so they compile and run standalone.
Using the web repo's local TypeScript (no install needed):

```bash
# from a scratch dir with a tsconfig that includes convex/agency/**/*.ts
node <path>/typescript/bin/tsc -p tsconfig.agency.json   # module=commonjs, target=ES2021
node --test agency-build/__tests__/
```

Last run: **14 pass / 0 fail** (9 pricing invariants, 5 scoring).
