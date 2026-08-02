import en from './en.json';
import ny from './ny.json';
import type { Locale } from '../data/site';

/** Locale → UI string dictionary for site chrome (nav, footer, CTAs). */
export const dictionaries = { en, ny } as const;

export type Dict = (typeof dictionaries)[Locale];

/** The full UI dictionary for a locale — for grabbing whole groups. */
export function dict(locale: Locale): Dict {
  return dictionaries[locale];
}

/** Deep lookup with dot paths: t('en', 'nav.features') → "Features". */
export function t(locale: Locale, path: string): string {
  const value = path
    .split('.')
    .reduce((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], dictionaries[locale]);
  return typeof value === 'string' ? value : '';
}
