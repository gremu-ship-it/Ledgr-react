const ACRONYMS: Readonly<Record<string, string>> = {
  ai: 'AI', api: 'API', csv: 'CSV', gl: 'GL', hse: 'HSE', id: 'ID', itp: 'ITP',
  mwk: 'MWK', ncr: 'NCR', pos: 'POS', paye: 'PAYE', rfi: 'RFI', vat: 'VAT', wht: 'WHT',
};

/**
 * Turn an absent i18next key into readable copy instead of exposing a raw
 * dotted identifier (for example, `payroll.leaveBalance` -> `Leave Balance`).
 * This is a last-resort UI fallback; production strings should still live in
 * the locale catalog and be covered by translation-key tests.
 */
export function formatMissingTranslationKey(key: string): string {
  const leaf = key.split('.').filter(Boolean).at(-1) ?? key;
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/);

  return words
    .map((word) => ACRONYMS[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}
