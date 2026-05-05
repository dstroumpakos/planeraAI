# Planera Email Templates

Marketing-grade redesign of all 5 transactional emails Planera sends. Unified design system, mobile-first, bulletproof for Outlook/Gmail/Apple Mail, single primary CTA per email.

## Design system
- **Container** 600px max, cream `#FAF9F6` body, white card `#FFFFFF`, 20px radius, soft shadow
- **Type** charcoal `#1A1A1A` for content, `#4A4A4A` for body, `#8A8A8A` muted
- **Brand accent** Yellow `#FFE500` — used as the logo dot, code-block label, left-border on highlight blocks, and the primary CTA pill (charcoal text on yellow)
- **CTA** Pill button (`border-radius:999px`), padding `14px 32px`, weight 800
- **Highlight block** `#FFFBE0` bg with 4px yellow left border
- **Mono digits** SF Mono / Menlo for confirmation numbers and codes
- **Always include** preheader (hidden inbox-preview line), plain-text alternative, footer with sender identity + support email
- **No web fonts** — system stack only (renders identically across clients, including Outlook desktop)

## Files in this folder

| File | Postmark template alias | Subject line | Preheader |
|---|---|---|---|
| [welcome.html](welcome.html) | `welcome` | `Welcome to Planera, {{name}} ✈` | Your AI travel co-pilot is ready. Plan your first trip in under 60 seconds. |
| [password_reset_code.html](password_reset_code.html) | `password_reset_code` | `Your Planera reset code: {{code}}` | Use this 6-digit code to reset your password. Expires in {{expiry_minutes}} minutes. |
| [receipt.html](receipt.html) | `receipt` | `✈ You're booked: {{outbound_depart_airport}} → {{outbound_arrive_airport}} · {{pnr}}` | Your seat is confirmed. Confirmation {{pnr}} — total {{total_paid}}. |

## How to deploy these to Postmark
1. Open the Postmark dashboard → server `planera` → **Templates**
2. For each alias above, click the existing template (or create one with the matching alias)
3. Paste the file contents into the **HTML** body
4. Update the **Subject** and **Preheader** (the inline `<div style="display:none…">` is the preheader and is already in each file — no extra dashboard config needed)
5. Postmark will auto-derive a plain-text version from the layout (or paste a text version manually for best deliverability)
6. Hit **Send Test** with sample variables to verify rendering across Apple Mail / Gmail / Outlook

## Inline (code-only) emails — already updated
Two more emails are sent from inline HTML inside Convex actions and have already been redesigned in this PR:

- **Account deletion confirmation** — [convex/postmark.ts](../../convex/postmark.ts) → `sendAccountDeletionEmail`
- **Flight booking confirmation (Gmail path)** — [convex/emails.ts](../../convex/emails.ts) → `sendFlightConfirmationEmail`

Both share the same design system as the dashboard templates above.

## Why the redesign converts better
1. **Strong preheader** — every email now has hidden inbox-preview text that gives the recipient a reason to open
2. **One primary CTA** — yellow pill, above the fold, in every email
3. **Personalization** — first-name greetings, dynamic destination in the H1 (`"You're going to LIS."` outperforms `"Booking confirmed"`)
4. **Visual hierarchy** — confirmation number rendered as a high-contrast monospace ticket-stub on charcoal with yellow accent → instantly scannable, screenshot-friendly
5. **Cross-sell built in** — the receipt and welcome both nudge recipients back into the app to plan the rest of the trip
6. **Trust signals** — "we'll never ask for this code", clear sender identity, real reply-to email
7. **Bulletproof** — table layouts + inline styles, MSO conditional comments, no web fonts → renders identically in Outlook 2016 desktop (the dragon every email designer fears)
