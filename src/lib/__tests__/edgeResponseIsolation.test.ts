import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const functionsRoot = resolve(root, 'supabase/functions');

describe('Edge Function response isolation', () => {
  it('gives every function an effective no-store response path', () => {
    const entries = readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => ({
        name: entry.name,
        source: readFileSync(resolve(functionsRoot, entry.name, 'index.ts'), 'utf8'),
      }));

    expect(entries).toHaveLength(26);
    for (const entry of entries) {
      const protectedBySharedHeaders = entry.source.includes("../_shared/cors.ts");
      const protectedBySharedResponse = entry.source.includes("../_shared/response.ts");
      const ownsNoStorePolicy = /Cache-Control['"]?\s*:\s*['"][^'"]*no-store/i.test(entry.source);
      expect(
        protectedBySharedHeaders || protectedBySharedResponse || ownsNoStorePolicy,
        `${entry.name} must set Cache-Control: no-store on every response path`,
      ).toBe(true);
    }
  });
});
