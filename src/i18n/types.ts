export const SUPPORTED_LANGUAGES = ['en', 'ny', 'sw', 'fr', 'pt'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type TextDirection = 'ltr' | 'rtl';

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  nativeLabel: string;
  region: string;
  dateLocale: string;
  direction: TextDirection;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English', region: 'en-MW', dateLocale: 'en-GB', direction: 'ltr' },
  { code: 'ny', label: 'Chichewa', nativeLabel: 'Chichewa', region: 'ny-MW', dateLocale: 'en-GB', direction: 'ltr' },
  { code: 'sw', label: 'Swahili', nativeLabel: 'Kiswahili', region: 'sw-TZ', dateLocale: 'sw-TZ', direction: 'ltr' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', region: 'fr-FR', dateLocale: 'fr-FR', direction: 'ltr' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', region: 'pt-PT', dateLocale: 'pt-PT', direction: 'ltr' },
];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
export const LANGUAGE_STORAGE_KEY = 'ledgr-language';
