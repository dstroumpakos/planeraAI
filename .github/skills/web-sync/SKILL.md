---
name: web-sync
description: "Sync changes from the main Bloom (Expo/React Native) repository to the planeraai-web Next.js website at C:\\Users\\nioni\\planeraai-web. Use when: modifying Convex functions/schema that the web app uses, adding new shareable trip features, updating public-facing pages, or changing any convex code that must exist in both repos."
---

# Web Repository Sync (planeraai-web)

## When to Use
- After adding or modifying any Convex function/schema that the web app also uses
- After adding new shareable/public trip features (share links, trip cards, deep links)
- After modifying `convex/schema.ts` (web repo must match for Convex to work)
- After modifying `convex/tripShareLinks.ts`, `convex/shareCards.ts`, or other public query files
- After modifying Convex helpers in `convex/helpers/`
- Whenever the user asks to "sync the web repo" or "update the website"

## Repository Locations
| Repo | Path | Purpose |
|------|------|---------|
| **Main (Expo App)** | `c:\Users\nioni\Downloads\Bloom-planeraAI` | Primary development repo (React Native) |
| **Web (Next.js)** | `C:\Users\nioni\planeraai-web` | Next.js 14 website — landing pages, shared trip previews, SEO itineraries |

## Architecture
- **Framework**: Next.js 14 (App Router) with Tailwind CSS
- **Backend**: Same Convex deployment as the mobile app (`prod:canny-bobcat-846`)
- **Hosting**: VPS at 46.225.183.187, served by PM2 + nginx
- **Domain**: planeraai.app (SSL via Let's Encrypt)

## Key Differences Between Repos

### Web-Only Files (DO NOT exist in app repo)
| File/Directory | Purpose |
|------|-----------|
| `src/` | All Next.js pages, components, data |
| `src/app/share/[token]/page.tsx` | Shared trip viewer (uses `tripShareLinks.getByToken`) |
| `src/app/shared-trip/page.tsx` | Redirect: `?token=X` → `/share/X` |
| `src/app/invite/[token]/page.tsx` | Invite link handler |
| `src/app/itinerary/[slug]/page.tsx` | SEO published itineraries |
| `src/app/destinations/[slug]/page.tsx` | SEO destination pages |
| `src/app/explore/page.tsx` | Explore destinations landing |
| `src/components/seo/*` | SEO header, footer, CTAs, badges |
| `src/data/itineraries/*` | Static itinerary JSON data for SEO |
| `convex/publicStats.ts` | Public stats (web-only Convex function) |
| `convex/publishedItineraries.ts` | Published itinerary queries (web-only) |
| `convex/publishedItinerariesActions.ts` | Published itinerary actions (web-only) |
| `next.config.js`, `tailwind.config.js`, `postcss.config.js` | Next.js config |
| `nginx-planeraai.conf` | Nginx server config |

### Shared Convex Files (MUST stay in sync)
These files exist in BOTH repos and must be identical (or logically equivalent):
| File | Notes |
|------|-------|
| `convex/schema.ts` | **DIVERGENT** — web has extra tables (`publishedItineraries`, etc.) but trips table must match |
| `convex/functions.ts` | Auth wrappers (identical) |
| `convex/tripShareLinks.ts` | Used by web share viewer (identical) |
| `convex/shareCards.ts` | Used by web trip card viewer (identical) |
| `convex/trips.ts` | Trip queries/mutations (identical) |
| `convex/images.ts` | Unsplash image actions (identical) |
| `convex/helpers/*.ts` | Shared helpers (identical) |
| `convex/auth*.ts` | Auth functions (identical) |
| `convex/users.ts` | User functions — **Apple IAP naming** (not Google-style) |
| All other `convex/*.ts` | Generally identical |

### `convex/schema.ts` Differences
The web repo schema has extra tables the app doesn't:
- `publishedItineraries` — SEO itinerary content
- Any future web-only tables

**When syncing schema changes:**
1. Apply the same field/index changes to the web `convex/schema.ts`
2. Do NOT remove web-only tables
3. The `trips` table structure must match exactly

## Procedure

### When modifying SHARED Convex files:
1. Make the change in the main Expo repo
2. Copy the exact same file(s) to the web repo at the same Convex path
3. Example: `convex/shareCards.ts` → copy to `C:\Users\nioni\planeraai-web\convex\shareCards.ts`

### When modifying `convex/schema.ts`:
1. Do NOT blindly copy — the web has extra tables
2. Apply the same table/field/index changes manually
3. Ensure the `trips` table structure matches
4. Keep web-only tables intact

### When adding NEW Convex files:
1. Create in the main Expo repo
2. Copy to the web repo: `C:\Users\nioni\planeraai-web\convex\<filename>.ts`

### When adding NEW web pages (for app deep links, etc.):
1. Create in `C:\Users\nioni\planeraai-web\src\app\<route>\page.tsx`
2. Use existing patterns from `src/app/share/[token]/page.tsx` as reference
3. Include `SEOHeader` and `SEOFooter` components
4. Include `AppStoreBadge` for download CTAs

### Quick sync commands:
```powershell
# Copy a single Convex file
Copy-Item "c:\Users\nioni\Downloads\Bloom-planeraAI\convex\shareCards.ts" "C:\Users\nioni\planeraai-web\convex\shareCards.ts" -Force

# Copy all Convex helpers
Copy-Item "c:\Users\nioni\Downloads\Bloom-planeraAI\convex\helpers\*" "C:\Users\nioni\planeraai-web\convex\helpers\" -Force -Recurse
```

## Deployment
After syncing changes to the web repo:
1. **Convex**: Both repos share the same Convex deployment — schema changes must be deployed once via `npx convex deploy` from either repo
2. **Website**: Requires manual deployment to VPS:
```powershell
cd C:\Users\nioni\planeraai-web
# Verify the build compiles locally BEFORE deploying — the remote step deletes
# .next before rebuilding, so a broken build takes the live site down.
npm run build
tar -cf ..\planeraai-web.tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=*.tar -C .. planeraai-web
scp ..\planeraai-web.tar deploy@46.225.183.187:/home/deploy/
ssh deploy@46.225.183.187 "cd /home/deploy && rm -rf planeraai-web/node_modules planeraai-web/.next planeraai-web/src && tar -xf planeraai-web.tar && rm planeraai-web.tar && cd planeraai-web && npm install --legacy-peer-deps --no-audit --no-fund && npm run build && pm2 restart planeraai-web"
```

> **Deploy gotchas (learned the hard way):**
> - **Wipe `planeraai-web/src` before extracting** (note it's in the `rm -rf` above). `tar` extraction overwrites files but never *deletes* files missing from the archive, so any source file you renamed/removed locally lingers on the VPS. This bit us with the `middleware.ts` → `proxy.ts` rename: the stale `src/middleware.ts` survived and Next 16 hard-errors when both `middleware` and `proxy` exist (`Both middleware file ... and proxy file ... are detected`). Clearing `src` guarantees a fresh source tree. **Do NOT `rm -rf planeraai-web` (the whole dir)** — that deletes the server's root-level `.env.local`/env files (not in the tar), taking the site down with missing env vars. Scope the wipe to `src` (+ `node_modules`/`.next`).
> - **Always pass `--legacy-peer-deps`** to the remote `npm install`. The web repo uses React 19 + Next 16; a plain `npm install` fails with `ERESOLVE` on the VPS, leaving `next` uninstalled so the build can't run. (The web repo now ships an `.npmrc` with `legacy-peer-deps=true`, but keep the flag for safety.)
> - **Never pipe `npm run build` through `tail`/`head` inside an `&&` chain.** The pipe's exit code (0) masks a build failure, so `pm2 restart` runs against a missing build and the process crash-loops. If you need to trim output, redirect to a log file (`> build.log 2>&1`) and `tail` it only on failure.
> - **Verify after deploy:** `curl -s -o /dev/null -w "%{http_code}" https://planeraai.app/` should return `200`, and `pm2 jlist` should show the restart counter holding steady (not climbing).

> **Next 16 conventions (web repo is on Next 16 + Turbopack):**
> - **Routing middleware lives in `src/proxy.ts`, not `src/middleware.ts`.** Next 16 renamed the convention; the file exports a function named `proxy` (the `config` matcher export is unchanged). The old name still "works" but prints a deprecation warning and, worse, collides if both files exist (see deploy gotcha above).
> - **Don't load local assets in metadata image routes via `fetch(new URL("../../public/x.png", import.meta.url))`.** Under Turbopack that resolves to a relative `/_next/static/media/...png` path, and `fetch` can't parse it without an origin during static generation (`Failed to parse URL` / `ERR_INVALID_URL`). Instead use the Node runtime and read the file directly: `await readFile(join(process.cwd(), "public", "x.png"))`, then pass a `data:image/png;base64,...` URI to `<img src>`. See `src/app/opengraph-image.tsx`.
> - **Avoid `export const runtime = "edge"` on metadata/image routes unless you actually need edge.** Edge runtime disables static generation for that route (build warning + a dynamic `ƒ` route). Removing it lets routes like `apple-icon`/`opengraph-image` prerender as static `○`.

## Checklist Template
After syncing:
- [ ] All modified Convex files copied to web repo
- [ ] Schema changes applied (without removing web-only tables)
- [ ] New web pages created for any new deep link routes
- [ ] `npm run build` passes in web repo
- [ ] Convex deployed with schema changes
- [ ] Web app deployed to VPS (if production-ready)
