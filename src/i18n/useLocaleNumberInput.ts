import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocaleSeparators, parseLocaleNumber } from './locale';

export interface LocaleNumberValidationResult {
  value: number | null;
  isValid: boolean;
  error: string | null;
}

export function useLocaleNumberInput() {
  const { i18n, t } = useTranslation();
  const language = i18n.language;

  return useMemo(() => {
    const separators = getLocaleSeparators(language);

    return {
      decimalSeparator: separators.decimal,
      groupSeparator: separators.group,
      parse: (input: string) => parseLocaleNumber(input, language),
      validate: (input: string, required = false): LocaleNumberValidationResult => {
        if (!input.trim()) {
          return {
            value: null,
            isValid: !required,
            error: required ? t('validation.required') : null,
          };
        }

        const value = parseLocaleNumber(input, language);
        return {
          value,
          isValid: value !== null,
          error: value === null ? t('validation.invalidLocaleNumber') : null,
        };
      },
      inputMode: 'decimal' as const,
      placeholder: separators.decimal === ',' ? '1 234,56' : '1,234.56',
    };
  }, [language, t]);
}
