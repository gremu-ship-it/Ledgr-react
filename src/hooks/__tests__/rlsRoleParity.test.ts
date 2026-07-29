import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the seam that caused
 *   "new row violates row-level security policy for table contacts"
 * when a supervisor added a customer.
 *
 * Roles were added to the user_role enum (20260723000001, 20260728000000) and
 * to usePermissions.ts, but the RLS policies enumerating roles were never
 * revisited. The UI offered the button; the database refused the insert.
 *
 * 20260728000008 moved master-data writes behind can_write_business_data(),
 * whose role list must stay identical to canWrite in usePermissions.ts. There
 * is no type system spanning TypeScript and SQL, so assert it here: adding a
 * role on one side only fails this test instead of failing in production.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260728000008_role_aware_master_data_rls.sql',
);
const PERMISSIONS = resolve(REPO_ROOT, 'src/hooks/usePermissions.ts');

/** Roles with canWrite: true in the usePermissions switch. */
function uiWriteRoles(): string[] {
  const src = readFileSync(PERMISSIONS, 'utf8');
  const roles: string[] = [];
  const caseRe = /case '([a-z_]+)':\s*return \{([\s\S]*?)\};/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(src)) !== null) {
    const [, role, body] = m;
    if (/canWrite:\s*true/.test(body)) roles.push(role);
  }
  return roles.sort();
}

/** Roles listed inside can_write_business_data() in the migration. */
function sqlWriteRoles(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const fnStart = sql.indexOf('function public.can_write_business_data');
  expect(fnStart, 'can_write_business_data not found in migration').toBeGreaterThan(-1);

  const listStart = sql.indexOf('bu.role::text in (', fnStart);
  const listEnd = sql.indexOf('Deliberately absent', listStart);
  expect(listStart).toBeGreaterThan(-1);
  expect(listEnd).toBeGreaterThan(listStart);

  return [...sql.slice(listStart, listEnd).matchAll(/'([a-z_]+)'/g)]
    .map((x) => x[1])
    .sort();
}

describe('RLS / UI role parity', () => {
  it('can_write_business_data() matches canWrite in usePermissions', () => {
    expect(sqlWriteRoles()).toEqual(uiWriteRoles());
  });

  it('excludes the read-only roles from writes', () => {
    const sql = sqlWriteRoles();
    for (const role of ['payroll_manager', 'auditor', 'viewer', 'board_member']) {
      expect(sql, `${role} must not have master-data write access`).not.toContain(role);
    }
  });

  it('includes supervisor — the role in the original bug report', () => {
    expect(sqlWriteRoles()).toContain('supervisor');
  });

  it('grants read to every active member regardless of role', () => {
    // Read must not be gated on a role list, or narrowing it re-creates the
    // same class of bug one dropdown at a time.
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('for select using (public.is_business_member(business_id))');

    const fnStart = sql.indexOf('function public.is_business_member');
    const fnEnd = sql.indexOf('$$;', fnStart);
    expect(sql.slice(fnStart, fnEnd)).not.toContain('bu.role');
  });

  it('covers the tables reached from the transaction pages', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // inventory_locations matters because BranchRepository.createWithLocation
    // inserts a location right after the branch and rolls the branch back if
    // that insert is denied.
    for (const table of ['contacts', 'branches', 'departments', 'inventory_locations']) {
      expect(sql).toContain(`'${table}'`);
    }
  });
});
