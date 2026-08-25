import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('service-worker tenant isolation', () => {
  it('uses NetworkOnly for Supabase REST and no longer configures a private API cache', () => {
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    const restRule = config.slice(
      config.indexOf("supabaseUrlPattern('/rest/v1/')"),
      config.indexOf("supabaseUrlPattern('/auth/v1/')"),
    );

    expect(restRule).toContain("handler: 'NetworkOnly'");
    expect(restRule).not.toContain('ledgr-api-cache');
    expect(restRule).not.toContain("handler: 'NetworkFirst'");
  });

  it('deletes obsolete private runtime caches when the replacement worker activates', () => {
    const events = readFileSync(resolve(root, 'public/sw-events.js'), 'utf8');
    expect(events).toContain("'ledgr-api-cache'");
    expect(events).toContain("'ledgr-static-assets'");
    expect(events).toContain("self.addEventListener('activate'");
    expect(events).toContain('LEDGR_CLEAR_PRIVATE_CACHES');
  });
});
