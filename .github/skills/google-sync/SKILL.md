---
name: google-sync
description: "Sync changes from the main (Apple/iOS) Bloom repository to the Google/Android variant at C:\\Users\\nioni\\Desktop\\Bloom-planeraAI_google. Use when: modifying shared code that must be mirrored to the Google repo, adding new screens/components/convex functions, updating translations, or changing any file that exists in both repos."
---

# Google Repository Sync

## When to Use
- After adding or modifying any screen, component, convex function, or library file
- After adding new translation keys
- After updating `convex/schema.ts`
- After changing navigation or routing
- After modifying shared config (babel, metro, tsconfig)
- Whenever the user asks to "sync" or "update the Google repo"

## Repository Locations
| Repo | Path | Purpose |
|------|------|---------|
| **Main (Apple/iOS)** | `c:\Users\nioni\Downloads\Bloom-planeraAI` | Primary development repo, iOS-only IAP |
| **Google (Android)** | `C:\Users\nioni\Desktop\Bloom-planeraAI_google` | Android/Play Store variant, cross-platform IAP |

## Key Differences Between Repos

The Google repo is a **fork** of the main repo with Android/Play Store support added. Most code is identical, but these files diverge:

### 1. Config Files (DO NOT overwrite — Google has extra Android config)
| File | Difference |
|------|-----------|
| `app.json` | Google has full `android` block (package, permissions, googleServicesFile), scheme is `"planera"` vs `"myapp"` |
| `eas.json` | Google includes Android build profiles + Play Store submit config |
| `.env.local` | Different `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (Android OAuth client) |
| `.env.prod` | Google has `GOOGLE_ANDROID_CLIENT_ID` |
| `google-services.json` | Google-only file — Firebase config for Android |
| `google-service-account.json` | Google-only file — Play Store service account key |

### 2. IAP / Payment Files (names and platform logic differ)
| File | Main (Apple) | Google (Android) |
|------|-------------|-----------------|
| `lib/iap.ts` | `Platform.OS === 'ios'` checks only | `Platform.OS === 'ios' \|\| Platform.OS === 'android'` |
| `lib/useIAP.ts` | iOS-only listeners and mock logic | iOS + Android listeners and mock logic |
| `convex/users.ts` | Functions named `processApplePurchase`, `restoreApplePurchases` | Functions named `processPurchase`, `restorePurchases` with `platform` param |
| `convex/schema.ts` | `iapTransactions` table without `platform` field | `iapTransactions` table WITH `platform: v.optional(v.union(v.literal("ios"), v.literal("android")))` |
| `app/subscription.tsx` | Calls `processApplePurchase` / `restoreApplePurchases` | Calls `processPurchase` / `restorePurchases` with `platform` arg |

### 3. Files That Are Always Identical (safe to copy directly)
Everything NOT listed above is shared code. This includes:
- All screens in `app/` (except `app/subscription.tsx`)
- All components in `components/`
- All convex functions (except `convex/users.ts` and `convex/schema.ts` IAP table)
- All translations in `lib/i18n/`
- All libraries in `lib/` (except `lib/iap.ts` and `lib/useIAP.ts`)
- All types in `types/`
- `babel.config.js`, `metro.config.js`, `tsconfig.json`

## Procedure

### When modifying SHARED files (most changes):
1. Make the change in the main repo (current workspace)
2. Copy the exact same file(s) to the Google repo at the same relative path
3. Example: if you edited `app/create-trip.tsx`, copy it to `C:\Users\nioni\Desktop\Bloom-planeraAI_google\app\create-trip.tsx`

### When modifying DIVERGENT files:
Apply the **logical change** to the Google version, respecting the naming/platform differences:

#### `convex/schema.ts`
- Copy the change, but ensure the `iapTransactions` table keeps the `platform` field in the Google version

#### `convex/users.ts`
- If you modify `processApplePurchase` in main → apply same logic to `processPurchase` in Google
- If you modify `restoreApplePurchases` in main → apply same logic to `restorePurchases` in Google
- Keep the `platform` parameter in the Google version

#### `lib/iap.ts`
- Copy changes but keep `Platform.OS === 'ios' || Platform.OS === 'android'` checks (not iOS-only)

#### `lib/useIAP.ts`
- Copy changes but keep Android listener setup and cross-platform mock logic

#### `app/subscription.tsx`
- Copy UI/logic changes but keep `processPurchase`/`restorePurchases` calls with `platform` arg

#### Config files (`app.json`, `eas.json`, `.env.*`)
- Do NOT blindly copy. Only apply the specific change (e.g., adding a new expo plugin to both)

### When adding NEW files:
1. Create the file in the main repo
2. Copy it to the Google repo at the same relative path
3. If the new file involves IAP or platform-specific logic, adapt it for cross-platform

### Quick sync command (for identical files):
```powershell
# Copy a single file
Copy-Item "c:\Users\nioni\Downloads\Bloom-planeraAI\<relative-path>" "C:\Users\nioni\Desktop\Bloom-planeraAI_google\<relative-path>" -Force

# Copy an entire directory (e.g., after bulk translation updates)
Copy-Item "c:\Users\nioni\Downloads\Bloom-planeraAI\lib\i18n\*" "C:\Users\nioni\Desktop\Bloom-planeraAI_google\lib\i18n\" -Force -Recurse
```

## Checklist Template
After making changes, verify:
- [ ] All modified shared files copied to Google repo
- [ ] Divergent files updated with equivalent logic (not blindly copied)
- [ ] New files created in both repos
- [ ] No Apple-only config accidentally overwrote Google config
- [ ] Translation keys added to all 6 languages in both repos
