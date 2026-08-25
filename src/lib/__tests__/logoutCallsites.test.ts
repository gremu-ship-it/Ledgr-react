import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('logout isolation', () => {
  it('routes UI sign-outs through the central secureSignOut function', () => {
    const output = execFileSync(
      'grep',
      ['-R', '-n', '--include=*.ts', '--include=*.tsx', ['supabase.auth', 'signOut'].join('.'), 'src'],
      { cwd: root, encoding: 'utf8' },
    );
    const directCallers = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith('src/lib/authSession.ts:'));
    expect(directCallers).toEqual([]);
  });

  it('routes the inactivity modal sign-out action through the secure timeout hook', () => {
    const layout = readFileSync(resolve(root, 'src/components/layout/AppLayout.tsx'), 'utf8');
    expect(layout).toContain('void logoutNow();');
    expect(layout).not.toContain("window.location.href = '/login'");
  });

  it('initializes cross-tab isolation before the application mounts', () => {
    const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8');
    expect(main).toContain('initializeClientDataIsolation();');
    expect(main.indexOf('initializeClientDataIsolation();')).toBeLessThan(
      main.indexOf('createRoot('),
    );
  });
});
