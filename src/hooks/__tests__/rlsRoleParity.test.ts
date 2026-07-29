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
const LADDER_MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260728000009_role_aware_user_has_role.sql',
);
const PERMISSIONS = resolve(REPO_ROOT, 'src/hooks/usePermissions.ts');

/** Roles whose usePermissions entry sets `flag: true`. */
function uiRolesWithFlag(flag: string): string[] {
  const src = readFileSync(PERMISSIONS, 'utf8');
  const roles: string[] = [];
  const caseRe = /case '([a-z_]+)':\s*return \{([\s\S]*?)\};/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(src)) !== null) {
    const [, role, body] = m;
    if (new RegExp(`${flag}:\\s*true`).test(body)) roles.push(role);
  }
  return roles.sort();
}

/**
 * Roles listed inside a `<name>(...)` SQL function in the ladder migration.
 * Strips `--` comments first: the prose inside these functions contains both
 * parentheses and role names, which would otherwise be read as list members.
 */
function sqlFnRoles(fnName: string): string[] {
  const sql = readFileSync(LADDER_MIGRATION, 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  const start = sql.indexOf(`function public.${fnName}`);
  expect(start, `${fnName} not found`).toBeGreaterThan(-1);

  const listStart = sql.indexOf('bu.role::text in (', start);
  expect(listStart, `${fnName} has no role list`).toBeGreaterThan(-1);

  const listEnd = sql.indexOf(')', listStart + 'bu.role::text in ('.length);
  return [...sql.slice(listStart, listEnd).matchAll(/'([a-z_]+)'/g)]
    .map((x) => x[1])
    .sort();
}

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

  it('keeps payroll read restricted to canViewPayroll roles', () => {
    // The highest-stakes assertion here. Every payroll table gated SELECT at
    // the 'viewer' tier, and 20260728000009 widens that tier to all members.
    // If these tables were not pinned to can_view_payroll first, every salary
    // would become readable by warehouse_worker and sales_clerk.
    expect(sqlFnRoles('can_view_payroll')).toEqual(uiRolesWithFlag('canViewPayroll'));
  });

  it('keeps payroll write restricted to canWritePayroll roles', () => {
    expect(sqlFnRoles('can_write_payroll')).toEqual(uiRolesWithFlag('canWritePayroll'));
  });

  it('excludes non-payroll roles from payroll access', () => {
    const view = sqlFnRoles('can_view_payroll');
    for (const role of ['warehouse_worker', 'sales_clerk', 'supervisor', 'viewer', 'data_entry']) {
      expect(view, `${role} must not read payroll`).not.toContain(role);
    }
  });

  it('pins payroll tables before widening the viewer tier', () => {
    // Section 2 must run before section 3, or there is a window where the
    // widened tier applies to payroll.
    const sql = readFileSync(LADDER_MIGRATION, 'utf8');
    const pinned = sql.indexOf("'payroll_employee_lines'");
    const widened = sql.indexOf("when 'viewer'          then public.is_business_member");
    expect(pinned).toBeGreaterThan(-1);
    expect(widened).toBeGreaterThan(-1);
    expect(pinned, 'payroll must be pinned before the viewer tier widens').toBeLessThan(widened);
  });

  it('maps every ladder tier to a capability helper', () => {
    const sql = readFileSync(LADDER_MIGRATION, 'utf8');
    for (const tier of ['viewer', 'auditor', 'payroll_manager', 'accountant', 'admin', 'owner']) {
      expect(sql, `tier ${tier} unmapped`).toMatch(new RegExp(`when '${tier}'\\s+then`));
    }
    // An unrecognised tier must deny, not return NULL.
    expect(sql).toMatch(/else\s+false/);
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
