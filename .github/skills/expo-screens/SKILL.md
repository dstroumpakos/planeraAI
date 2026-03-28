---
name: expo-screens
description: "Create or modify Expo Router screens and React Native components for the Bloom travel app. Use when: adding new app screens, creating tab screens, building reusable components, setting up navigation, working with React Native UI, or adding new pages to the app."
---

# Expo Router Screens & Components

## When to Use
- Adding new screens under `app/`
- Creating or editing tab screens in `app/(tabs)/`
- Building reusable components in `components/`
- Working with navigation (stack, tabs, modals)
- Implementing React Native UI with the project's patterns

## Architecture

### File-Based Routing (Expo Router)
```
app/
├── _layout.tsx          # Root stack navigator + providers
├── (tabs)/
│   ├── _layout.tsx      # Bottom tab navigator config
│   ├── create.tsx       # Create trip tab
│   ├── trips.tsx        # View trips tab
│   ├── insights.tsx     # Community insights tab
│   └── profile.tsx      # User profile tab
├── trip/[id].tsx         # Dynamic route: trip detail
├── deal/[id].tsx         # Dynamic route: deal detail
├── settings/             # Settings sub-pages
├── admin/                # Admin dashboard
└── *.tsx                 # Top-level screens (flight-booking, subscription, etc.)
```

### Provider Stack (in _layout.tsx)
Boot order: Environment validation → Auth init (SecureStore) → Convex client → Providers:
`ConvexNativeAuthProvider` → `ThemeProvider` → `NotificationInitializer`

### Screen Template
```tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../lib/ThemeContext';

export default function MyScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { theme } = useTheme();
  // Auth token from context for Convex calls
  // const { token } = useAuth(); 

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={{ color: theme.text }}>{t('myScreen.title')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
```

### Key Patterns
- **Theme**: Use `useTheme()` from `lib/ThemeContext.tsx` for dark/light mode colors
- **i18n**: Use `useTranslation()` hook and `t('key')` for all user-facing text
- **Navigation**: Use `useRouter()` for `router.push()`, `router.back()`, `router.replace()`
- **Images**: Use `OptimizedImage` component or `useImages()` hook for cached images
- **Auth**: Token passed explicitly to all Convex queries/mutations

## Procedure
1. Create the screen file at the appropriate `app/` path
2. Import theme, i18n, and Convex hooks as needed
3. Add translation keys to all 6 language files in `lib/i18n/`
4. Use `StyleSheet.create()` for styles, apply theme colors dynamically
5. For new tabs, update `app/(tabs)/_layout.tsx`
6. For new settings pages, add to `app/settings/`
