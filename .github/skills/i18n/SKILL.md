---
name: i18n
description: "Add or update translations and internationalization strings in the Bloom travel app. Use when: adding new translation keys, updating existing translations, adding a new language, or ensuring all 6 languages (EN, EL, ES, FR, DE, AR) have consistent keys."
---

# Internationalization (i18n)

## When to Use
- Adding new user-facing text that needs translation
- Updating existing translation strings
- Adding a new supported language
- Auditing translation keys for consistency across languages

## Architecture

### Setup
- Library: `i18next` + `react-i18next`
- Config: `lib/i18n/index.ts`
- Language detection: Device locale → saved preference (SecureStore) → fallback to `en`

### Supported Languages
| Code | Language | File |
|------|----------|------|
| `en` | English | `lib/i18n/en.json` |
| `el` | Greek | `lib/i18n/el.json` |
| `es` | Spanish | `lib/i18n/es.json` |
| `fr` | French | `lib/i18n/fr.json` |
| `de` | German | `lib/i18n/de.json` |
| `ar` | Arabic (RTL) | `lib/i18n/ar.json` |

### Usage in Components
```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <Text>{t('mySection.myKey')}</Text>;
}

// With interpolation
<Text>{t('welcome', { name: userName })}</Text>
// en.json: "welcome": "Welcome, {{name}}!"
```

### Key Naming Convention
Use dot-separated paths matching the feature area:
```json
{
  "trips": {
    "title": "My Trips",
    "create": "Create Trip",
    "empty": "No trips yet"
  },
  "flights": {
    "search": "Search Flights",
    "booking": { ... }
  }
}
```

## Procedure
1. Add the English key first in `lib/i18n/en.json`
2. Add the same key to ALL other 5 language files with translated values
3. Use `t('section.key')` in the component
4. For interpolated values, use `{{variable}}` syntax in all language files
5. Test RTL layout if the string might affect Arabic display
6. Update `components/LanguagePickerModal.tsx` if adding a new language

## Important
- **Never hardcode user-facing strings** — always use `t()` 
- **All 6 files must stay in sync** — every key in `en.json` must exist in all others
- Arabic (`ar`) is RTL — consider layout implications for new UI elements
