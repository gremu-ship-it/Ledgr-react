import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deriveClientKey, isUuid } from '../clientKeys';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `client_key` is a uuid column (20260813000003_add_client_key_idempotency.sql)
 * and Postgres will not cast text to uuid implicitly, so every key the app
 * writes there has to *be* a uuid. The obvious spelling for a sub-key —
 * `` `${parentKey}:pmt:0` `` — is not, which is why derived keys exist.
 */
describe('deriveClientKey', () => {
  const parent = '2f1c6a54-1d4b-4f1e-9c2a-7b8e5d3a0c91';

  it('returns a uuid', () => {
    const key = deriveClientKey(parent, 0);
    expect(key).toMatch(UUID_PATTERN);
    expect(isUuid(key)).toBe(true);
    expect(isUuid(`${parent}:pmt:0`)).toBe(false); // the shape it replaces
  });

  it('is deterministic, so a replay rebuilds the same key', () => {
    expect(deriveClientKey(parent, 3)).toBe(deriveClientKey(parent, 3));
    expect(deriveClientKey('invoice-1', 0)).toBe(deriveClientKey('invoice-1', 0));
  });

  it('separates the rows of one document', () => {
    const keys = [0, 1, 2, 3, 4, 5, 10, 999].map((i) => deriveClientKey(parent, i));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('separates documents', () => {
    const keys = Array.from({ length: 50 }, (_, i) => deriveClientKey(`invoice-${i}`, 0));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('accepts keys that are not themselves uuids', () => {
    // The parent is opaque; an import or a new caller may mint anything.
    expect(deriveClientKey('queue-client-key-1', 1)).toMatch(UUID_PATTERN);
    expect(deriveClientKey('', 0)).toMatch(UUID_PATTERN);
  });

  it('does not throw on an out-of-range ordinal', () => {
    // A key derivation must never be the reason a sale fails: junk degrades to
    // a valid key rather than a malformed one.
    for (const ordinal of [-3, 0.7, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 50]) {
      expect(deriveClientKey(parent, ordinal)).toMatch(UUID_PATTERN);
    }
    // ...and clamping must not silently merge two different rows.
    expect(deriveClientKey(parent, 2 ** 50)).not.toBe(deriveClientKey(parent, 0));
  });

  it('fills the whole key rather than repeating one hash lane', () => {
    // A single 32-bit lane would make the first 8 hex digits of every key
    // identical; three lanes must not degenerate to that.
    const firsts = new Set(
      Array.from({ length: 20 }, (_, i) => deriveClientKey(`doc-${i}`, 0).slice(0, 8)),
    );
    expect(firsts.size).toBe(20);
  });
});

/** Every non-test source file, so the guard below is exhaustive. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('client_key writes', () => {
  it('never write a compound key into the uuid client_key columns', () => {
    // Regression guard for a real bug: the keys used to be spelled
    // `<parent>:pmt:<n>` / `<parent>:mv:<n>`, which Postgres rejects for a
    // uuid column (22P02) — so the payment or stock row silently never got
    // written, and only a live server could show it (the unit tests mock the
    // repositories). Keys must come from newSaveClientKey() or
    // deriveClientKey().
    const offenders: string[] = [];

    for (const file of sourceFiles(resolve(__dirname, '../../..', 'src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          // Comments describe the old spelling; only code writes keys.
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
          if (!/client_key\s*:/.test(line)) return;
          const value = line.slice(line.indexOf('client_key'));
          if (value.includes('`') || /\+\s*['"`]/.test(value)) {
            offenders.push(`${file.replace(resolve(__dirname, '../../..'), '')}:${index + 1}: ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });
});
