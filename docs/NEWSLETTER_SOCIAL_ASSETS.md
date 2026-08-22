# Newsletter → Instagram / TikTok assets

Turns any newsletter campaign into vertical social cards and a Reel/TikTok MP4,
from the admin dashboard. Nothing is posted automatically — it produces files
and a caption for a human to upload.

## Where the pieces live

| Piece | Repo | File |
| --- | --- | --- |
| Deck builder (slide copy, caption, hashtags, photos) | app (`planeraAI`) | `convex/newsletterSocial.ts` |
| Localized deal copy shared with the email | app | `convex/newsletter.ts` → `dealSocialCopy` |
| Card layout | web (`planeraai-web`) | `src/lib/social/cards.tsx` |
| PNG route | web | `src/app/api/social/newsletter/slide/route.tsx` |
| MP4 route | web | `src/app/api/social/newsletter/video/route.ts` |
| Design fixture (dev only) | web | `src/app/api/social/newsletter/sample/route.tsx` |
| Composer UI | web | `src/components/admin/CampaignSocialModal.tsx` |

Convex owns the *words*, the website owns the *pixels*. Every price, date and
badge on a card comes from `dealSocialCopy`, the same helper the email deal
rows use — a card can't claim something the email wouldn't. That includes the
"Save €125" pill: it only appears when the card is already showing a
struck-through original, so it restates the price block rather than adding a
claim to it.

## Using it

Admin → Newsletter → any campaign → **Social**.

- **Format** — Story 1080×1920 (IG Story / Reels cover / TikTok), Feed
  1080×1350, Square 1080×1080.
- **Language** — defaults to the campaign's own; any of en/el/es/fr/de.
- **Download all** — one PNG per slide, staggered so the browser doesn't drop
  them.
- **Copy** — caption with the deal list, link, hashtags and photo credits.
- **Render MP4** — cross-faded slideshow with a slow Ken Burns push, silent.

Slides are cover → one per deal (max 6) → end card. Every slide carries one
ask and one only — swipe on the cover, link in bio on a deal, save the post at
the end.

### Photos

Every slide gets its own frame, including the end card. The cover reuses the
email's cached hero (`imageCache`, keyed `hero:<city>`) so the two channels
show the same photo; each *later* slide of the same destination takes a
different Unsplash frame, cached under `hero:<city>:social<n>` and fetched
`orientation=portrait` — which is what a 9:16 card wants and what an email's
landscape hero slot does not, hence the separate keys.

Cost is one Unsplash request per destination for the alternates (a single
multi-photo search covers all of them), plus the usual one for the hero. A
destination the deck has already been built for costs nothing.

## Deploy notes

1. **Convex first.** `newsletterSocial.ts` and the `dealSocialCopy` export must
   be deployed from THIS repo before the website is deployed, or the Social
   button 502s. The website reaches the module through `anyApi`, so no web-side
   codegen is needed.
2. **ffmpeg** — an OS dependency, not an npm one. Already installed on the
   production VPS (4.4.2, `/usr/bin/ffmpeg`, on the pm2 process PATH, so no
   `FFMPEG_PATH` and no restart needed). On a fresh box:
   ```
   sudo apt install ffmpeg
   ```
   Without it the PNG side works fine and the video button returns a 503 that
   says exactly this.
3. **Fonts ship in the repo** — `public/fonts/Inter-{Regular,SemiBold,ExtraBold}.ttf`
   (OFL). They are read from disk at render time, like `opengraph-image.tsx`
   reads the logo.

## Known limits

- **No Arabic.** Inter has no Arabic glyphs, so an `ar` campaign renders its
  cards with English copy. Adding it means bundling a Noto Sans Arabic face and
  accepting satori's limited RTL shaping.
- **A destination can run out of frames.** Unsplash returns what it returns; if
  a place has fewer good portrait photos than the deck has slides for it, the
  last card falls back to the brand gradient. That is a designed state, not a
  broken one.
- **Unsplash credit is required** by the licence and is written into the
  caption. Don't strip it.
- **Fares expire.** The radar auto-expires deals whose price rises past the
  ceiling, so a card posted days later can show a dead price. Re-render before
  posting.
- **No auto-posting.** Instagram needs a Business account under Meta app
  review; TikTok needs the Content Posting API. Both are separate projects.

## Editing the card design

Run the website dev server and hit the fixture route — no campaign, token or
live fare needed:

```
http://localhost:3000/api/social/newsletter/sample?index=1&format=story&lang=el
```

`index` walks the fixture deck (cover, photo deal, photo-less deal, end card
with photo), `lang` exercises the Greek uppercase rule. The route 404s in
production.

Newly added route files need a dev-server restart before Next serves them —
`next dev` will 404 a route it did not see at boot.
