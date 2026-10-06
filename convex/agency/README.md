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

237 pass / 0 fail. The pure modules have no Convex dependency, so they compile
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

**Pending a deploy since then:** the Amadeus re-pricing call, the richer Hotelbeds
mapping, the four doc-derived searches (Expedia Rapid, Booking.com, Viator, Tiqets),
`searchVerified`, the airport-derived country on destination targets, the
agency logo, the revalidation-expiry fix, the new-signup alert, experiences in
the package ladder, AI package copy, password reset, quote accept + view
tracking, Hotelbeds re-pricing, the mock-connector gate, and the admin
agencies view. Until that
ships, connecting one of those four stores the key and health-checks it but the search
still refuses.

### Required before first use

Set in the Convex dashboard (see `.env.example`):

| Variable | Why |
|---|---|
| `AGENCY_VAULT_MASTER_KEY` | 32 bytes, base64url. Without it every credential operation fails closed. Generate with `vault.generateMasterKeyB64url()`. |
| `AGENCY_AUTH_PEPPER` | Optional. A leaked database alone cannot be attacked offline with it set. Adding it later invalidates existing passwords, so set it **before** the first signup. |
| `AGENCY_QUOTE_PUBLIC_BASE_URL` | Origin for invite and customer-quote links. Defaults to `https://planeraai.app`. |
| `AGENCY_ALERT_TO` | Optional. Where new-signup alerts go. Falls back to `STATS_REPORT_TO`, then the founder address. |
| `OPENAI_API_KEY` | Optional. Without it quotes simply carry no AI copy. |
| `AGENCY_COPY_MODEL` | Optional. Defaults to `gpt-4o-mini`. |
| `AGENCY_ENABLE_MOCKS` | Set to `1` to offer the mock connectors in the catalogue. Off in production. |

## Search redesign (2026-09-01, web `2026.9.1`)

The form was a flat six-field grid with two free-text IATA boxes. Agents know
cities, not codes, and a typo produced either an empty search or a real airport
somewhere else entirely.

- **`AirportPicker`** — a combobox over `lib/agency/airports.ts`, which
  SUPPLEMENTS the consumer list rather than replacing it (five other features
  depend on that file). The consumer list is the top ~220 hubs by traffic, so a
  Greek agency could not search **Thessaloniki**, Kos, Zakynthos, Chania,
  Larnaca, Paphos, Antalya, Bodrum, Gatwick or Orly. ~140 airports added across
  Europe, the Med, the Middle East and North Africa.
- **Localised matching.** Indexed from the existing `CITY_TRANSLATIONS`, with
  accents and Greek tonos folded — "Θεσσαλονίκη", "θεσσαλονικη", "Λονδίνο"
  (returns all five London airports) and "Mailand" all resolve. The UI is
  Greek; requiring English city names from a Greek keyboard is the kind of
  friction that makes a tool feel foreign.
- **New search options**, each backed end to end: rooms (`SearchQuery.rooms`
  was already used by the hotel connectors but `beginSearch` never accepted it
  — a real gap), max stops, which kinds to price, currency override, one-way vs
  return, duration shortcuts, and a **client name + file reference** stored on
  the quote so a list of forty is searchable by a human.

`maxStops` filters AFTER the search, not per supplier: not every connector
exposes a stops filter, and one rule beats thirteen. It falls back to the
unfiltered pool when nothing clears the bar — an empty quote helps nobody.

## Experiences in the package ladder (2026-09-01)

`searchForQuote` only ever ran a flight and a hotel search, and `buildQuote`
composed packages from those two pools — so the activity and transfer connectors
could return offers that NOTHING consumed. Viator and Tiqets were dead ends the
day they were written.

All four kinds now search in parallel, and the ladder is the product:

| Tier | Carries |
|---|---|
| Basic | flight + hotel, nothing else |
| Comfort | + 1 experience, + 1 transfer |
| Premium | + 2 experiences, + 1 transfer |

Basic stays bare **on purpose**: padding the price-led tier is how a cheap
option stops being cheap, and an agent would have to strip it back by hand.

`scoring.ts` gained `ACTIVITY_WEIGHTS` / `TRANSFER_WEIGHTS`, which weight
QUALITY far above margin — activity suppliers pay commission on a retail price
the traveller can look up, so there is no spread to optimise and what earns the
booking is that it is obviously the right one. `pickTop` de-duplicates by
supplier id and title, because two connectors covering one city routinely list
the same museum ticket and a Premium package that sold the Louvre twice is a
visible bug on a client's document.

## AI package copy (2026-09-01)

`agency/packageCopy.ts` writes the paragraph an agent would otherwise type by
hand: a per-tier headline and pitch, an honest one-line trade-off against the
tier above, and a summary for the covering email.

**It cannot leak margin**, and not by remembering not to: the prompt is built
from `toCustomerPackages`, the projection with no field for supplier cost,
markup or commission. A model that never receives a number cannot print one.
**It cannot invent** — it gets the real lines and is told to write only from
them, because copy promising a rooftop pool nobody booked reads to a client as
a commitment.

Generation is SCHEDULED after `saveQuote`, never inline: a search must not wait
on OpenAI, and a quote with no copy is complete and sendable. Every failure path
returns null. Language comes from `branding.quoteLanguage` (default Greek).

## Recovering an account, and closing the loop (2026-09-01)

- **Password reset.** There was none: a locked-out owner had no path back to a
  workspace holding their supplier credentials. `requestPasswordReset` always
  reports success so it cannot enumerate accounts; `resetPassword` consumes the
  token, bumps `sessionsValidFrom` and revokes every live session — which is
  what actually evicts somebody who had the account. `/agency/forgot` and
  `/agency/reset` had to be added to the shell's PUBLIC_ROUTES; guarding
  recovery behind sign-in would have made it useless.
- **The traveller can now accept.** `acceptQuote` records intent, not a booking,
  refuses an expired quote, and is idempotent so a double-tap is harmless.
- **View tracking.** `resolveCustomerLink` records first/last view and a count;
  the agent sees "opened 3×" or "not opened yet". Only the FIRST open emails the
  agency.
- **Mocks are hidden.** `enabledConnectors()` drops `internalOnly` entries unless
  `AGENCY_ENABLE_MOCKS=1`. It filters the CATALOGUE only, so an existing demo
  connection keeps working.
- **Hotelbeds re-pricing** (`checkrates`). This is what makes the revalidation
  fix useful: `quoteStillValid` needs every line to verify, so before it, any
  quote containing a hotel was permanently stuck once expired.

## Operator alert on signup (2026-09-01)

`registerAgency` wrote an audit row and nothing else, so the only way to learn a
real agency had signed up was to go looking in the Convex dashboard — which
means in practice nobody would have. `agency/notify.ts` now emails the operator
on every signup: agency, owner, currency, slug, and the running agency count,
with `[internal]` in the subject for our own demo/test tenants so the inbox
stays honest.

It is SCHEDULED, not awaited. `ctx.scheduler.runAfter(0, ...)` runs after the
signup mutation commits, so a Postmark outage or a bad key can never fail or
roll back somebody's registration. The worst case is a missed email.

## Fixed: revalidation never cleared the expiry (2026-09-01)

`recordRevalidation` wrote `status`, `revalidation` and `lastRevalidatedAt` but
never touched `expiresAt`. Every read computes `expired: now >= expiresAt`, so a
quote that revalidated cleanly still displayed as expired — and `send` refuses
an expired quote with *"revalidate it before sending"*, so an expired quote
could never be recovered by the one action that exists to recover it. Pressing
the button repeatedly did nothing visible.

A successful revalidation is a fresh confirmation from every supplier behind the
quote, so it now restarts the validity window from the tenant's own
`quoteTtlMs`. A FAILED one keeps the old expiry — an offer that is gone, or that
no connector could verify, must not buy the quote more time. The decision is the
pure `revalidatedExpiry()` in `quote.ts`, tested in both directions.

## Agency logo

`branding.logoStorageId` was in the schema from the start but never written.
It now drives the masthead of both quote surfaces — the traveller's `/q/<token>`
page and the agent's PDF — because those share one `QuoteDocument`.

Upload is three steps, since the file never passes through a Convex function:
`generateLogoUploadUrl` mints a URL, the browser POSTs the bytes straight to it,
and `setLogo` adopts the returned id. **That last step is the only place type
and size can be enforced** — the upload URL accepts any bytes — so it reads the
metadata from `ctx.db.system.get(storageId)` and DELETES the blob if it fails,
which also stops the endpoint being used as free file hosting. Replacing a logo
deletes the previous blob for the same reason.

SVG is allowed on purpose: it is what agencies have, and the only format that
stays crisp in a printed PDF. It is safe because the document renders it via
`<img src>`, which does not execute scripts, and Convex serves it from its own
origin rather than ours.

`publicAgency()` is async now — it resolves `logoStorageId` to a URL on every
read path, because a storage id means nothing to a browser and leaving each
caller to remember would guarantee one forgets. A blob that no longer resolves
comes back as null; the document falls back to the agency name.

**The session needed a setter.** `getMe` resolves ONCE per token, and the PDF
route reads its branding from there — so without `setAgency()` a freshly
uploaded logo would silently not appear on the very document it was uploaded
for until a full reload. Every mutation returning an `AgencySummary` now feeds
it back.

## Not yet built

Booking (deliberately out of MVP scope). Re-pricing for the hotel and activity
providers. Package-scoped pricing rules. A locations feed for Expedia and
Booking.com — their region/city ids are mapped by hand until then.

## All 13 providers are callable

Every registry provider has a working connector. What differs is depth, and the
UI reports it honestly per provider (`searchable`, `searchVerified`,
`pendingReason`).

| Depth | Providers |
|---|---|
| Search + re-pricing, run for real | Duffel, Amadeus, mock-air, mock-hotel |
| Search, run for real | Hotelbeds |
| Search built from public docs, never run against a live account | Expedia Rapid, Booking.com Demand, Viator, Tiqets |
| Real auth + real health probe, no public search contract | Sabre, Travelport, Travelgate |
| Auth wired, no confirmed endpoint at all | WebBeds, Liknoss, Ferryhopper |

The fourth row is the one to watch. Those four are read-only and fail loudly, so
shipping them ahead of a test account is safe — but an agency connecting one
sees an **αδοκίμαστο** badge and a warning before it saves, because calling an
untested integration "wired" is the kind of half-truth that costs a quote.

Three providers need more than a key, and the connect form asks for it:
Expedia wants a point-of-sale country and an originating IP (Rapid requires
one on every shopping call, and our searches run from Convex, so there is no
honest value to discover at runtime); Booking.com wants a booker country.

**Design.** `connectors/generic.ts` builds a connector from a declarative
`ConnectorSpec` (`connectors/providers.ts`); `connectors/auth.ts` holds the
shared auth schemes — OAuth2 client_credentials with token caching, Hotelbeds'
per-request SHA-256 `X-Signature`, Expedia's SHA-512 EAN signature, and header
keys. Twelve integrations stay comparable instead of drifting apart.

**The honesty rule, enforced by tests.** A provider whose SEARCH contract is not
public still authenticates and health-checks for real, but `search` throws a
named reason rather than posting a guessed payload. A connector never declares a
capability it cannot perform: `revalidate` tracks whether a re-price contract
actually exists, in both directions, because declaring it falsely would let the
orchestrator present unverified fares as confirmed.

**Destination mapping is what unblocked the non-flight providers.** Flights key
off IATA codes, which are universal. Hotels, activities and ferries key off each
provider's OWN taxonomy (Hotelbeds destination codes, Expedia region ids, Viator
destination ids, Tiqets city ids) which cannot be derived from an IATA code.
`destinations.ts` matches candidates from each provider's locations feed;
`destinationMap.ts` fetches, caches and lets ops correct them by hand. The
target now carries a country derived from the airport, which is what makes the
matcher's country-mismatch penalty — the Paris, Texas guard — actually engage.

Expedia Rapid is the awkward one: it has no "what is available in this city"
call at all, so a region is expanded into property ids first and the priced
results are named afterwards. `SearchSpec` therefore supports an optional
`prepare` and `enrich` round trip, which Booking.com also uses for names.
Enrichment is best-effort: real prices survive a failed cosmetic lookup.

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

## Tailor-made quotes and booking (2026-09-30, web `2026.9.28`, Convex deploy pending)

Built for agencies that compose each trip by hand (first asked for by REVIS
TRAVEL), not ones that sell fixed packages.

- **Editing** — `quoteEdit.ts` (pure) + `quoteEditing.ts`: swap/add a line from
  the quote's `alternatives` pool (priced at search time by the same rules),
  remove/move lines, type a customer price (moves the margin, never the cost),
  client notes per line, rename/hide/copy an option, and **manual services**
  (`kind: "service"`, `connectorId: "manual"`) for ferries, insurance, own-contract
  hotels. `addOnSearch` prices one more kind for any city/dates into the pool
  (multi-city). Every edit clears the stale revalidation and re-writes the AI copy
  once, debounced via `copyRevision`.
- **AI intake** — `requestParse.ts` reads a pasted client email into the search
  form; the text is stored on the quote as `requestText`.
- **Revalidation fix** — the orchestrator now returns `refreshed` handles and
  costs; `applyRefreshed` writes them back, so Hotelbeds' spent rateKey is
  replaced and a price move is detected even when the connector does not flag it.
  Manual lines count as agent-confirmed, not unverifiable.
- **After acceptance** — `fulfilment.ts` (pure) + `bookings.ts`: traveller
  details (from the client link or the agent), a per-service booking record,
  API booking (`createBooking` on Duffel, Hotelbeds, mocks) or manual reference
  entry, the agency's payment note, and a confirmation released to the client's
  link. A lost booking response becomes `unknown`, which blocks retries until a
  human checks the supplier. An API booking refuses if the supplier price rose.
- **Money** — Planera never collects from travellers. API bookings are paid from
  the agency's own supplier account; `payment` is the agency's own ledger note.

## Duffel Stays (2026-09-30, Convex deploy pending)

Hotels through the agency's existing Duffel token — `connectors/duffelStays.ts`.
Search by coordinates (the airport's CITY via `/places/suggestions`, 5 km; the
airport itself at 15 km as a fallback) → `fetch_all_rates` + `/stays/quotes` on
revalidation → a fresh quote + price-rise check + `/stays/bookings` on booking.
Tokens: `stays_sr:<search_result_id>` after search, `stays_rate:<rate_id>` after
revalidation (quotes are short-lived, so they are never stored).

Built from Duffel's docs, NOT yet run live. Stays is off by default: the agency
must request access from Duffel; until then hotel searches fail with
"Duffel Stays is not enabled on this Duffel account".
