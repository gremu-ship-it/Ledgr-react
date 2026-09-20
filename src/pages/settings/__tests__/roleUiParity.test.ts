/**
 * Every role the database accepts must be selectable in the UI.
 *
 * `user_role` is a Postgres enum. Adding a value there is invisible to
 * TypeScript, so the failure mode is silent: the DB (and the RLS policies,
 * permissions ladder and edge-function allowlists) know the role, but no
 * <option> offers it, and the only way to find out is an owner saying
 * "I don't see a cashier role".
 *
 * The enum's source of truth here is the checked-in generated client
 * (src/dal/types/database.generated.ts → Constants.publicEnums.user_role),
 * which is what `supabase gen types` last read out of the database.
 *
 * Companion to hooks/__tests__/rlsRoleParity.test.ts, which guards the same
 * seam one layer down (TypeScript ↔ SQL policy role lists).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Constants } from '@/dal/types/database.generated';

const REPO_ROOT = resolve(__dirname, '../../../..');
const TEAM_PAGE = resolve(REPO_ROOT, 'src/pages/settings/TeamManagementPage.tsx');
const SETTINGS_PAGE = resolve(REPO_ROOT, 'src/pages/SettingsPage.tsx');
const PERMISSIONS = resolve(REPO_ROOT, 'src/hooks/usePermissions.ts');

/** The user_role enum values, straight out of the generated client. */
const ENUM_ROLES: string[] = [...Constants.public.Enums.user_role];

/**
 * Entries of a `const X … = [ … ]` list, read as quoted strings.
 * `declaration` must include the opening bracket, so a `UserRole[]` annotation
 * in the declaration cannot be mistaken for the end of the list.
 */
function stringList(src: string, declaration: string): string[] {
  const start = src.indexOf(declaration);
  expect(start, `${declaration} not found`).toBeGreaterThan(-1);
  const open = start + declaration.length - 1;
  expect(src[open]).toBe('[');
  const body = src.slice(open, src.indexOf(']', open + 1));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Keys of `const ROLE_CONFIG: Record<UserRole, …> = { … };` */
function roleConfigKeys(): string[] {
  const src = readFileSync(TEAM_PAGE, 'utf8');
  const start = src.indexOf('const ROLE_CONFIG');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}([a-z_]+): \{$/gm)].map((m) => m[1]);
}

/** Roles handled by the `switch (role)` in usePermissions(). */
function permissionSwitchRoles(): string[] {
  const src = readFileSync(PERMISSIONS, 'utf8');
  const start = src.indexOf('export function usePermissions');
  const body = src.slice(start, src.indexOf('\nexport function', start + 1));
  return [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
}

describe('user_role enum ↔ UI parity', () => {
  it('found the expected roles in the generated enum (sanity check)', () => {
    expect(ENUM_ROLES.length).toBeGreaterThanOrEqual(21);
    expect(ENUM_ROLES).toContain('cashier');
  });

  it('gives every enum role a label and badge in ROLE_CONFIG', () => {
    const configured = roleConfigKeys();
    const missing = ENUM_ROLES.filter((r) => !configured.includes(r));
    expect(missing, `no ROLE_CONFIG entry for: ${missing.join(', ')}`).toEqual([]);
  });

  it('offers every enum role except owner in the invite dropdown', () => {
    const invitable = stringList(
      readFileSync(TEAM_PAGE, 'utf8'),
      'const INVITABLE_ROLES: UserRole[] = [',
    );
    const missing = ENUM_ROLES.filter((r) => r !== 'owner' && !invitable.includes(r));
    expect(missing, `not invitable: ${missing.join(', ')}`).toEqual([]);
  });

  it('maps every enum role to a permission set (no silent GUEST fallback)', () => {
    const handled = permissionSwitchRoles();
    const missing = ENUM_ROLES.filter((r) => !handled.includes(r));
    expect(missing, `usePermissions() has no case for: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the legacy SettingsPage ROLES list from drifting', () => {
    // SettingsPage's TeamMembersTab is not rendered today (the `team` tab
    // renders TeamManagementPage), but its hard-coded list is a trap for
    // whoever wires it back up — it had already lost cashier, manager and
    // stock_clerk.
    const legacy = stringList(readFileSync(SETTINGS_PAGE, 'utf8'), 'const ROLES = [');
    const missing = ENUM_ROLES.filter((r) => !legacy.includes(r));
    expect(missing, `legacy ROLES list is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
