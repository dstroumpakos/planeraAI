# Email deliverability

How outbound mail is tracked, and what has to be configured outside the code for
it to work.

## The problem this solves

Sending used to be write-only. `postmark.sendRawEmail` reported whether Postmark
*accepted* a message; what happened afterwards never came back. So:

- a dead mailbox stayed `active` forever and was re-mailed on every drip tick
  and every campaign — each attempt a hard bounce against the sending domain's
  reputation, which is exactly the ratio Gmail and Outlook score senders on;
- campaign stats counted "handed to Postmark" as success, so a campaign that
  bounced half its list still reported 100% sent.

Postmark now posts delivery events back to us and they drive a suppression list
consulted before every send.

## Moving parts

| Piece | Where |
| --- | --- |
| Webhook endpoint | `convex/http.ts` → `POST /postmark/webhook` |
| Event ingest, suppression list, admin queries | `convex/emailEvents.ts` |
| Send path (suppression gate, error-code handling, tagging) | `convex/postmark.ts` → `sendRawEmail` |
| Per-recipient campaign outcomes | `convex/newsletterCampaigns.ts` → `recordCampaignSends` |
| Tables | `emailSuppressions`, `emailEvents`, plus new fields on `newsletterSubscribers`, `newsletterCampaigns`, `newsletterCampaignSends` |
| Nightly reconcile + log prune | `convex/crons.ts` |
| Admin UI | website repo, `src/app/(app)/admin/page.tsx` → `DeliverabilityPanel` |

## One-time setup

1. **Convex env var** — set `POSTMARK_WEBHOOK_SECRET` to a long random string.
   Without it the endpoint returns 503 and no events are recorded.

2. **Postmark webhooks** — Servers → *your server* → for **each** message stream
   (`outbound` *and* the `newsletters` broadcast stream) → Webhooks → add:

   ```
   https://<deployment>.convex.site/postmark/webhook?key=<POSTMARK_WEBHOOK_SECRET>
   ```

   Enable: **Bounce**, **Spam complaint**, **Delivery**, **Open**, **Link
   click**, **Subscription change**.

3. **Tracking** — open/link tracking is set per-message (`TrackOpens` /
   `TrackLinks`) on marketing mail only, so no stream-level toggle is required.
   Transactional mail (receipts, password resets, the opt-in confirmation) is
   deliberately *not* tracked.

4. **Backfill** — the `sync-postmark-suppressions` cron imports Postmark's
   existing suppression dump on its first nightly run, so addresses deactivated
   before the webhook existed are picked up without any manual step.

## Behaviour worth knowing

**A hard bounce stops sending immediately.** Postmark `TypeCode` 1, 100000,
100002, 100006 — or any bounce where Postmark reports `Inactive: true` — adds
the address to `emailSuppressions` and flips the subscriber to `bounced`.
`DnsError` (256) and `DMARCPolicy` (100009) are deliberately *not* treated as
hard: they usually indicate a problem on our side, and suppressing the recipient
would hide the fault while quietly shrinking the list.

**Soft bounces get four tries.** A delivery resets the streak. Four in a row with
no delivery in between suppresses the address.

**Spam complaints are terminal and cannot be released from the dashboard.**
Re-mailing someone who reported us is the fastest route to a blacklisted domain.
They can only return by subscribing again themselves — and the signup form
refuses that too, with a message pointing at `marketing@planeraai.app`.

**Bounce suppressions clear on an explicit signup.** Someone typing their address
into the form is the re-validation the suppression was waiting for, and the
double opt-in that follows proves the mailbox is alive before marketing mail
resumes. Without this, the confirmation email would be swallowed and signup would
silently do nothing.

**Releasing clears both lists.** Postmark holds its own per-stream suppression;
clearing only ours would still produce a 406 on the next send, so
`releaseSuppression` schedules `postmark.deletePostmarkSuppression` for every
stream the address could be on.

**Transactional mail can opt out of the gate.** `ignoreSuppression: true` is for
mail that must go out regardless of marketing bounce history — password resets,
account-deletion confirmations, the ops stats report, and admin test sends (where
the admin needs to *see* the 406 rather than have the send silently blocked).

**Retries are safe.** The webhook returns 500 on a processing failure so Postmark
re-delivers; `ingestPostmarkEvent` is idempotent, and campaign `opened`/`clicked`
count unique recipients (only the first event per send bumps them), so a
forwarded email can't push a rate past 100%.

## Reading the dashboard

Rates are computed against *delivery outcomes reported* (delivered + bounced +
complained), not against "sent" — a send whose outcome hasn't arrived yet would
otherwise drag every rate down and make a campaign still in flight look broken.

The panel flags **>2% bounces** or **>0.1% complaints**. Sustained above either,
mail starts landing in junk at the major providers.
