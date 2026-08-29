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

- **Format** — Story 1080×1920 (IG Story / TikTok), Feed 1080×1350, Square
  1080×1080. The format also picks the *wording*: see Surfaces below.
- **Language** — defaults to the campaign's own; any of en/el/es/fr/de.
- **Download all** — one PNG per slide, staggered so the browser doesn't drop
  them.
- **Copy** — caption with the deal list, link, hashtags and photo credits.
- **Render MP4** — cross-faded slideshow with a slow Ken Burns push, silent.

Slides are cover → one per deal (max 6) → end card. Every slide carries one
ask and one only.

### Surfaces

The pixels are the same; the ask is not. A carousel is swiped, a story is
tapped (swiping there leaves for the next account), and a reel plays on its
own — so telling a story viewer to swipe, or a reel viewer to save "this
post", is an instruction that does nothing. The render routes therefore send
Convex a **surface** and it picks the wording:

| Surface | Chosen by | Cover | Deal card | End card |
| --- | --- | --- | --- | --- |
| `feed` | Feed / Square format | Swipe — {n} fares inside | Link in bio | Link in bio · Save this post |
| `story` | Story format | Tap through — {n} fares | Tap the link | Link in this story · Send it to your travel buddy |
| `reel` | the MP4 export, whatever the format | Watch — {n} fares | Link in bio | Link in bio · Save this reel |

All of it is localized in `LABELS[lang].surfaces` in `newsletterSocial.ts` —
the renderer only places the strings. The "→" beside the prompt is a swipe cue,
so `cards.tsx` drops it on story-shaped cards. `surface` defaults to `feed`
(the only surface with a caption) when a caller omits it.

### Links for the deal cards

A deal card names one flight and then says "tap the link". That link has to
land on THAT flight — a viewer dropped on the generic deals page has to find
the fare again, and won't. The composer therefore generates two links per deal
card, both public (no login — a story viewer is a stranger):

| Link | Goes to | What the visitor sees |
| --- | --- | --- |
| **Itinerary + this flight** | `/itinerary/<slug>?departureId=…&arrivalId=…&outboundDate=…&returnDate=…&adults=1` | the destination's day-by-day plan, with the exact fare searched live in the sidebar |
| **Flights only** | `/search?<same params>` | the fare on its own, account-free |

The itinerary is picked by destination city and then by **closest duration** to
the fare's own trip length — a 7-night Athens fare gets the 5-day plan, not the
3-day one. A destination with no published itinerary yet gets the flights link
plus a note saying so; nothing is invented. Both URLs carry
`utm_source=instagram&utm_medium=social&utm_campaign=newsletter_<id>`.

The param contract (`departureId / arrivalId / outboundDate / returnDate /
adults`) is the one the ChatGPT deep links already use, so `/search` read it
unchanged; `/itinerary/[slug]` gained `DeepLinkFlightSearch`, a client wrapper
that reads those params inside a `<Suspense>` boundary — without the boundary
`useSearchParams` would drop the page's static shell.

### Click tracking

Each of those URLs is handed out wrapped in a counted redirect,
`planeraai.app/l/<code>`, and that wrapper is what the Copy button gives you.
Without it the tap is invisible: the destinations are public ISR pages with no
session, so a link pasted raw into a bio produces a visit nothing attributes
back to the post.

- `convex/socialShareLinks.ts` owns the codes and the counters, tables
  `socialShareLinks` + `socialShareLinkClicks`.
- **A code is stable per (campaign, slide, kind)** — `mint` upserts, so
  re-opening the composer never splits one post's clicks across two codes. A
  target that legitimately moves (an itinerary published later for a city that
  had none) is updated in place, keeping the history.
- **Link-preview crawlers are resolved without counting.** Instagram, WhatsApp
  and every chat app fetch a URL the moment it is pasted; counting those would
  report an audience of bots. The redirect is a **302** with `no-store` for the
  same reason — a cached 301 is a click we never see.
- **Click rows hold no visitor data** — no IP, no user agent, no cookie. Only a
  timestamp and the referrer HOST.
- The composer shows lifetime clicks, today, and the last 7 days per link;
  Refresh re-pulls them. `follow` is public by necessity, so treat the number
  as a marketing metric, not an audited one.
- `/l` is disallowed in `robots.ts` and the route sets `X-Robots-Tag: noindex`.

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

1. **Convex first.** `newsletterSocial.ts`, `socialShareLinks.ts` (plus its two
   schema tables) and the `dealSocialCopy` export must be deployed from THIS
   repo before the website is deployed, or the Social button 502s and every
   `/l/<code>` link falls back to `/deals` instead of resolving. The website reaches the module through `anyApi`, so no web-side
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
with photo), `lang` exercises the Greek uppercase rule. The prompts follow the
format's surface; add `&surface=reel` to see the reel wording, which no format
implies on its own. The route 404s in production.

Newly added route files need a dev-server restart before Next serves them —
`next dev` will 404 a route it did not see at boot.
