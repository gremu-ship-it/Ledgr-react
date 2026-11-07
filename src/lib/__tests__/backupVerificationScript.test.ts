import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const script = readFileSync('scripts/verify-backup.sh', 'utf8');

describe('backup verification restore dependencies', () => {
  it('stubs Auth schema dependencies without restoring Auth user data', () => {
    expect(script).toContain('--schema=public');
    expect(script).toContain('CREATE SCHEMA IF NOT EXISTS auth;');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);');
    expect(script).toContain('CREATE OR REPLACE FUNCTION auth.uid()');
    expect(script).toContain('CREATE OR REPLACE FUNCTION auth.role()');
    expect(script).not.toMatch(/pg_dump[^\n]*--schema=auth/);
    expect(script.indexOf('CREATE TABLE IF NOT EXISTS auth.users')).toBeLessThan(
      script.indexOf('pg_restore --no-password'),
    );
  });

  it('leaves PostgreSQL count-query diagnostics visible when verification fails', () => {
    expect(script).not.toMatch(/source_psql[^\n]*2>\/dev\/null/);
    expect(script).not.toMatch(/psql[^\n]*RESTORE_DB_URL[^\n]*2>\/dev\/null/);
    expect(script).toContain('Could not read counts for $table (src=$src rst=$rst)');
  });
});
