# Bloom (Planera AI) — Security Audit & Remediation

This document summarises a security review of the Convex backend and Expo
client, the exploit paths that were identified, and the fixes applied in
this commit.

> Threat model: a remote attacker who can call any public Convex
> query/mutation/action over the public Convex URL, can read open-source
> code, can intercept their own traffic, and can sideload a modified
> client. They cannot break TLS or steal Convex deploy keys.

---

## Critical findings (fixed)

### 1. `signInWithEmail` allowed total account takeover
**File:** `convex/authNative.ts`

The action accepted any email and, if a user existed, returned a valid
session token. There was **no password check**. Anyone could log in as
any other user by knowing only their email.

**Fix:**
- Rewrote `signInWithEmail` to require a password.
- Added PBKDF2-SHA512 (210k iterations, random 16-byte salt, format
  `pbkdf2$<iter>$<saltHex>$<hashHex>`) for storage and constant-time
  verification.
- Distinct sign-up vs. sign-in paths.
- Refuses to log in to accounts created via Google/Apple via the email
  path (prevents OAuth-account hijacking).
- Generic error messages to prevent account enumeration.
- New schema field `passwordHash` is written via the new internal
  mutation `authNativeDb.createOrUpgradeEmailUser`.

### 2. Apple receipts were never verified — free Premium / trip credits
**Files:** `convex/users.ts`, `convex/iapVerify.ts` (new),
`app/subscription.tsx`

`processApplePurchase` and `restoreApplePurchases` granted Premium
subscriptions and trip credits using only `productId` + `transactionId`
strings supplied by the client. A modified client (or a `curl` against
the public Convex URL) could grant itself unlimited Premium and trip
packs.

**Fix:**
- Old mutations now throw an "Outdated client" error.
- New action `iapVerify.verifyAndApplyApplePurchase` calls Apple's
  `verifyReceipt` endpoint (production with sandbox-21007 fallback),
  asserts `status === 0`, asserts `receipt.bundle_id` matches
  `APPLE_BUNDLE_ID`, locates the matching transaction in
  `latest_receipt_info` / `receipt.in_app`, derives `expiresAt` from
  Apple's response.
- Entitlement is then applied through new internal mutation
  `users.applyVerifiedApplePurchase`, which is idempotent (indexes
  `iapTransactions` by `by_transaction`) and refuses cross-account
  transaction theft (`existingTx.userId !== userId`).
- Client (`app/subscription.tsx`) migrated to `useAction` and now
  treats receipt as required.

### 3. `upgradeToPremium` and `purchaseTripPack` granted entitlements with no payment proof
**File:** `convex/users.ts`

Both were public mutations that wrote `plan = "PREMIUM"` /
`tripCredits += 5` directly. Anyone could call them.

**Fix:** both now throw. All entitlement grants must flow through
`iapVerify.verifyAndApplyApplePurchase` (or the equivalent server-side
Stripe handler).

### 4. Flight booking actions were unauthenticated
**Files:** `convex/flightBooking.ts`, `convex/bookingDraft.ts`,
`convex/flightBookingMutations.ts`, `app/flight-*.tsx`

`getFlightOffer`, `initializePayment`, `createFlightBooking`,
`createDraft`, `fetchSeatMaps`, and `completeBooking` were public
actions. An attacker could: (a) book flights against any `tripId`
they didn't own, (b) read seat maps and offers without an account, and
(c) charge another user's payment token.

**Fix:**
- Each action now takes `token: v.string()` and resolves it to a
  `userId` via the internal session lookup (`requireUserId`).
- Trip-bound actions verify the trip owner via the new internal query
  `flightBookingMutations.getTripForOwnerCheck` (`requireTripOwner`).
- Draft-bound actions verify the draft owner (`requireDraftOwner`).
- Client screens were updated to pass `token` from `useToken()`.

### 5. `bookingLinks.createBookingLink` was a public mutation
**File:** `convex/bookingLinks.ts`

A public mutation that accepted any `Id<"flightBookings">` and minted
a permanent link token. Anyone could mint an unrevocable link that
exposed PNR, passenger names, route, and total price for any booking.

**Fix:**
- Converted to `internalMutation`. Only invoked from the verified
  flight-booking action, after auth + ownership checks.
- Token now generated via WebCrypto (192 bits, base64url).

### 6. Apple `host.exp.Exponent` audience accepted in production
**File:** `convex/authNative.ts`

The Apple ID-token verifier accepted `host.exp.Exponent` as a valid
audience to support Expo Go. In production this allowed any Apple
account holder to mint an Expo Go token and impersonate any other
user with the same email.

**Fix:** the `host.exp.Exponent` audience is now only honoured when
`process.env.CONVEX_ALLOW_EXPO_GO_AUTH === "1"` — never in
production deployments.

### 7. `validateSession` failed open on DB error
**File:** `convex/authNative.ts`

A DB error (e.g. transient infra issue) caused the function to return
`{ valid: true }`, granting unauthenticated access.

**Fix:** errors now return `{ valid: false }` (fail-closed).

---

## High findings (fixed)

### 8. Google `email_verified=false` accepted
**File:** `convex/authNative.ts`

Google ID-token verification did not check `email_verified`, allowing
sign-in with an unverified email — useful for impersonating users who
later attached the same email.

**Fix:** rejects `email_verified === false` outright.

### 9. Math.random for security tokens
**Files:** `convex/authNative.ts`, `convex/authNativeDb.ts`,
`convex/tripShareLinks.ts`, `convex/tripCollaborators.ts`,
`convex/bookingLinks.ts`

`Math.random` provides ~52 bits of (predictable) entropy.

**Fix:** all security tokens (session IDs, anonymous IDs, share-link
tokens, booking-link tokens, invite tokens) now use `crypto.randomBytes`
(Node) or `globalThis.crypto.getRandomValues` (V8 runtime), encoded
as base64url. Lengths range from 144 to 256 bits.

### 10. Password reset used a deterministic, password-derived "salt"
**File:** `convex/passwordReset.ts`

`hashPassword` derived a 16-character "salt" from the first 4
characters of the password itself, then SHA-256'd `salt + password`.
This made identical passwords hash identically, the salt useless, and
the whole scheme trivially brute-forceable.

**Fix:** rewritten to use PBKDF2-SHA512 with 210k iterations and a
random 16-byte per-user salt (same scheme as `authNative.ts`).

### 11. SSRF in `dealExtractor.extractFromUrl`
**File:** `convex/dealExtractor.ts`

The action fetched any URL the caller passed (admin-key gated, but
defence-in-depth was missing), allowing reads of internal services,
cloud metadata endpoints, etc.

**Fix:** added `assertSafeFetchTarget` which blocks `localhost`,
`metadata.google.internal`, IPv4 ranges (0/8, 10/8, 100/8, 127/8,
169.254/16, 172.16/12, 192.168/16, 224+/4), IPv6 loopback / link-local
/ ULA / IPv4-mapped, and non-http(s) protocols.

---

## Outstanding work (recommended next steps)

| Priority | Area | Notes |
|---------|------|-------|
| Med | `users.saveProfilePicture` | Add MIME / size validation via `ctx.storage.getMetadata`. |
| Med | `atlas.chat` rate limiting | Prevent OpenAI cost-exhaustion. Convex ratelimiter component recommended. |
| Med | Convex env vars | Confirm in production: `APPLE_BUNDLE_ID`, `APPLE_IAP_SHARED_SECRET`, `GOOGLE_WEB_CLIENT_ID`, `CONVEX_LOW_FARE_ADMIN_KEY` are all set. `CONVEX_ALLOW_EXPO_GO_AUTH` must be **unset** in prod. |
| Med | Logging | Audit `console.log` calls for session token / auth header leakage. |
| Low | Stripe webhooks | If/when Stripe is used for non-IAP, verify webhook signatures and apply the same idempotency pattern as `applyVerifiedApplePurchase`. |
| Low | Rotate session tokens | Add a "log out everywhere" path that clears the `sessions` table by `userId`. |

---

## Required env-var changes

- `APPLE_IAP_SHARED_SECRET` — required for `iapVerify.ts` to validate
  auto-renewable subscription receipts. Generate in App Store Connect
  → My Apps → App-Specific Shared Secret.
- `APPLE_BUNDLE_ID` — must equal the production bundle ID
  (`com.planeraaitravelplanner`).
- `CONVEX_ALLOW_EXPO_GO_AUTH` — leave **unset** in prod. Set to `1`
  only on dev deployments where Expo Go auth is desired.

---

## Client breaking changes

The legacy `processApplePurchase` / `restoreApplePurchases` /
`upgradeToPremium` / `purchaseTripPack` mutations now throw. Any
client older than this commit will fail loudly on purchase. Ship the
updated `app/subscription.tsx` (which uses
`api.iapVerify.verifyAndApplyApplePurchase`) before relying on the
new server-side checks.
