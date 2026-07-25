import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ny from './locales/ny.json';
import sw from './locales/sw.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from './types';
import { getTextDirection, normalizeLanguage } from './locale';

function getInitialLanguage() {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;

  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored) return normalizeLanguage(stored);

  return normalizeLanguage(window.navigator.language);
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ny: { translation: ny },
      sw: { translation: sw },
      fr: { translation: fr },
      pt: { translation: pt },
    },
    lng: getInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ['en', 'ny', 'sw', 'fr', 'pt'],
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

function applyDocumentLocale(language: string) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeLanguage(language);
  document.documentElement.lang = normalized;
  document.documentElement.dir = getTextDirection(normalized);
  document.documentElement.dataset.locale = normalized;
}

applyDocumentLocale(i18n.language);

i18n.on('languageChanged', (language) => {
  const normalized = normalizeLanguage(language);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  }
  applyDocumentLocale(normalized);
});

export { i18n };
export * from './types';
export * from './locale';
export * from './useLocaleFormat';
export * from './useLocaleNumberInput';
