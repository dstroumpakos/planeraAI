import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';

import en from './en.json';
import el from './el.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import ar from './ar.json';

const resources = {
  en: { translation: en },
  el: { translation: el },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  ar: { translation: ar },
};

// Supported languages
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
] as const;

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

const LANGUAGE_STORAGE_KEY = 'planera_selected_language';

// Save selected language to local storage
export async function saveLanguagePreference(langCode: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, langCode);
  } catch (error) {
    console.warn('[i18n] Failed to save language preference:', error);
  }
}

// Load saved language from local storage (synchronous-safe wrapper used at init)
async function loadSavedLanguage(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY);
  } catch (error) {
    console.warn('[i18n] Failed to load saved language:', error);
    return null;
  }
}

// Detect the device language, falling back to 'en'
function getDeviceLanguage(): SupportedLanguageCode {
  const locales = Localization.getLocales();
  if (locales && locales.length > 0) {
    const deviceLang = locales[0].languageCode;
    if (deviceLang && Object.keys(resources).includes(deviceLang)) {
      return deviceLang as SupportedLanguageCode;
    }
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already handles XSS
  },
  react: {
    useSuspense: false, // Important for React Native
  },
});

// After init, check for a saved language preference and apply it
loadSavedLanguage().then((savedLang) => {
  if (savedLang && Object.keys(resources).includes(savedLang) && savedLang !== i18n.language) {
    i18n.changeLanguage(savedLang);
    console.log(`[i18n] Restored saved language: ${savedLang}`);
  }
});

export default i18n;
