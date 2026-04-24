---
name: dependency-updates
description: "Check Bloom's npm dependencies against the npm registry and install any that are out of date. USE WHEN: user asks to 'check for updates', 'update dependencies', 'install latest', 'bump packages', 'upgrade Expo SDK', or 'are my packages up to date'. Applies to both the Apple repo (c:\\Users\\nioni\\Downloads\\Bloom-planeraAI) and the Google repo (C:\\Users\\nioni\\Desktop\\Bloom-planeraAI_google)."
---

# Dependency Updates

Check installed versions vs npm latest. Install anything that differs.

## Repos
- Apple: `c:\Users\nioni\Downloads\Bloom-planeraAI`
- Google: `C:\Users\nioni\Desktop\Bloom-planeraAI_google`

Run in **both** unless the user says otherwise.

## Procedure

1. **Read** `package.json` (dependencies + devDependencies) from the Apple repo.
2. **Fetch latest** from the npm registry for every dep in parallel:
   - URL: `https://registry.npmjs.org/<pkg>/latest` (encode `@` as `%40` for scoped packages)
   - Use one `fetch_webpage` call with all URLs.
3. **Compare** installed range vs latest. Build a drift table.
4. **If nothing is out of date** → report "all up to date" and stop.
5. **If there is drift** → ask the user (use `vscode_askQuestions`):
   - Scope: **Safe bumps only** (minor/patch) / **Safe + Expo SDK upgrade** / **Everything including breaking majors**
   - Repos: **Both** / **Apple only** / **Google only**
6. **Install** in each selected repo:
   - Expo-managed packages (anything `expo*`, `react-native`, `react`, `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context`, `expo-router`):
     ```powershell
     npx expo install --fix
     ```
     For a full SDK bump, first: `npm install expo@^<NEW_MAJOR> --legacy-peer-deps`, then `npx expo install --fix`.
   - Everything else:
     ```powershell
     npm install <pkg>@^<latest> <pkg2>@^<latest> ... --legacy-peer-deps
     ```
7. **Verify** in each repo:
   ```powershell
   npm run verify-versions
   ```

## Rules
- Always use `--legacy-peer-deps` on `npm install` (peer-dep warnings in this project).
- Never pin Expo-managed packages manually — let `npx expo install --fix` resolve them.
- Don't copy `package.json` / `package-lock.json` between repos — Google has extra deps (google-signin, expo-navigation-bar, etc.). Run the install commands in each repo separately.
- Breaking majors that need code changes (require explicit user approval before installing): `expo-iap`, `i18next` + `react-i18next` (upgrade together), `@react-native-community/datetimepicker`, `typescript`, `eslint`.
- Respect the `overrides` block in `package.json` (e.g. `react-native-safe-area-context` pin).
- Don't run `npm audit fix --force`.

## Post-install (tell the user)
- Clear Metro cache: `npx expo start -c`
- If `ios/` or `android/` exist and SDK was bumped: `npx expo prebuild --clean` before native builds.
