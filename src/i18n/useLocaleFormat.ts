import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDate, formatNumber, getTaxTerm, parseLocaleNumber } from './locale';

export function useLocaleFormat() {
  const { i18n } = useTranslation();
  const language = i18n.language;

  return useMemo(() => ({
    language,
    number: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, language, options),
    currency: (value: number, currency = 'MWK', options?: Intl.NumberFormatOptions) => (
      formatCurrency(value, language, currency, options)
    ),
    date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => formatDate(value, language, options),
    parseNumber: (value: string) => parseLocaleNumber(value, language),
    taxTerm: (jurisdiction?: string | null) => getTaxTerm(jurisdiction, language),
  }), [language]);
}
