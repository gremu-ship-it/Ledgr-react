import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import { i18n } from '../index';
import { formatMissingTranslationKey } from '../missingTranslation';

const sourceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [fullPath] : [];
  });
}

function hasTranslation(key: string): boolean {
  const lookup = (candidate: string): boolean => {
    let value: unknown = en;
    for (const part of candidate.split('.')) {
      if (!value || typeof value !== 'object' || !(part in value)) return false;
      value = (value as Record<string, unknown>)[part];
    }
    return typeof value === 'string';
  };

  // i18next's English plural forms are stored as suffixed keys even though
  // components call t() with the unsuffixed key and pass a count.
  return lookup(key) || ['_one', '_other', '_plural'].some((suffix) => lookup(`${key}${suffix}`));
}

describe('English translation coverage', () => {
  it('defines every literal translation key used by pages and components', () => {
    const missing = new Map<string, string>();
    const callPattern = /\bt\s*\(\s*(['"])([^'"]+)\1/g;

    for (const directory of ['pages', 'components']) {
      for (const file of sourceFiles(path.join(sourceRoot, directory))) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(callPattern)) {
          const key = match[2];
          if (!hasTranslation(key)) missing.set(key, path.relative(sourceRoot, file));
        }
      }
    }

    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('formats missing keys as readable Title Case copy', () => {
    expect(formatMissingTranslationKey('payroll.leaveBalance')).toBe('Leave Balance');
    expect(formatMissingTranslationKey('reports.pnl.whtSchedule')).toBe('WHT Schedule');
    expect(formatMissingTranslationKey('navigation.items.pos')).toBe('POS');
    expect(i18n.t('missingKey.readableExample')).toBe('Readable Example');
  });
});
