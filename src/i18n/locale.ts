import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES, type SupportedLanguage } from './types';

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);
}

export function normalizeLanguage(value: unknown): SupportedLanguage {
  if (isSupportedLanguage(value)) return value;
  if (typeof value === 'string') {
    const base = value.split('-')[0]?.toLowerCase();
    if (isSupportedLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function getLanguageOption(language: string | undefined | null) {
  const normalized = normalizeLanguage(language);
  return LANGUAGE_OPTIONS.find((option) => option.code === normalized) ?? LANGUAGE_OPTIONS[0];
}

export function getIntlLocale(language: string | undefined | null): string {
  return getLanguageOption(language).region;
}

export function getDateLocale(language: string | undefined | null): string {
  return getLanguageOption(language).dateLocale;
}

export function getTextDirection(language: string | undefined | null) {
  return getLanguageOption(language).direction;
}

export function formatNumber(value: number, language: string | undefined | null, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getIntlLocale(language), options).format(value);
}

export function formatCurrency(
  value: number,
  language: string | undefined | null,
  currency = 'MWK',
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getIntlLocale(language), {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'MWK' ? 'code' : 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatDate(
  value: string | number | Date,
  language: string | undefined | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getDateLocale(language), options ?? {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

export function getLocaleSeparators(language: string | undefined | null) {
  const parts = new Intl.NumberFormat(getIntlLocale(language)).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
}

export function parseLocaleNumber(input: string, language: string | undefined | null): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const { decimal, group } = getLocaleSeparators(language);
  const normalized = trimmed
    .replace(/\s/g, '')
    .replace(new RegExp(`\\${group}`, 'g'), '')
    .replace(decimal, '.')
    // French users often type a comma even if the browser locale returns a narrow no-break group separator.
    .replace(',', '.');

  if (!/^[+-]?(\d+|\d*\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type VatJurisdiction = 'MW' | 'ZM' | 'FR' | 'BE' | 'CD' | 'SN' | 'CI' | string | null | undefined;

export function getTaxTerm(jurisdiction: VatJurisdiction, language: string | undefined | null): string {
  const country = jurisdiction?.toUpperCase();
  if (country === 'MW' || country === 'ZM') return 'VAT';
  if (language === 'fr' || ['FR', 'BE', 'CD', 'SN', 'CI'].includes(country ?? '')) return 'TVA';
  if (language === 'pt') return 'IVA';
  return 'VAT';
}
