// @vitest-environment jsdom
/**
 * The role pickers on Settings → Team must offer the POS roles.
 *
 * `cashier`, `manager` and `stock_clerk` were added to the `user_role` enum by
 * 20260920000000_pos_module.sql and to ROLE_CONFIG / INVITABLE_ROLES in
 * TeamManagementPage. Nothing asserted they actually reached the <select>, so a
 * role could be wired end-to-end (enum, permissions, RLS, edge function
 * allowlist) and still be unselectable in the UI — the exact failure mode of
 * rlsRoleParity.test.ts, one layer up.
 *
 * These tests render the real component (only Supabase and the app store are
 * stubbed) and read the options out of the rendered DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  role: 'owner' as string,
  members: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentBusiness: { business: { id: 'biz-1' }, role: state.role },
      currentUser: { id: 'user-owner', email: 'owner@ledgr.test' },
    }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

vi.mock('@/lib/errorHandler', () => ({ handleError: () => {} }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: async () => ({ data: { members: state.members }, error: null }),
    },
    from: () => ({
      select: () => ({
        is: () => ({ gt: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  },
}));

import { TeamManagementPage } from '../TeamManagementPage';

// `globals: false` in vitest.config.ts, so RTL's automatic teardown is off.
afterEach(() => {
  cleanup();
  state.role = 'owner';
  state.members = [];
});

/** Values of every <option> in the role picker labelled "Role". */
function roleOptionValues(container: HTMLElement): string[] {
  const select = container.querySelector<HTMLSelectElement>('select');
  expect(select, 'no role <select> rendered').toBeTruthy();
  return Array.from(select!.options).map((o) => o.value);
}

async function renderTeamPage() {
  const view = render(<TeamManagementPage />);
  // Wait for the members/invites fetch to settle so the invite form is final.
  await waitFor(() =>
    expect(view.container.querySelector('select')).toBeTruthy(),
  );
  return view;
}

describe('Settings → Team role pickers', () => {
  it('offers Cashier (and the other POS roles) when inviting a member', async () => {
    const { container } = await renderTeamPage();

    const values = roleOptionValues(container);
    expect(values).toContain('cashier');
    expect(values).toContain('manager');
    expect(values).toContain('stock_clerk');

    // The label, not just the enum value — the dropdown is what an owner reads.
    expect(screen.getByRole('option', { name: 'Cashier' })).toBeTruthy();
  });

  it('still offers Cashier to an admin, who only loses the Admin option', async () => {
    state.role = 'admin';
    const { container } = await renderTeamPage();

    const values = roleOptionValues(container);
    expect(values).toContain('cashier');
    expect(values).not.toContain('admin');
  });

  it('lets an owner change an existing member to Cashier', async () => {
    state.members = [
      {
        id: 'bu-1',
        user_id: 'user-staff',
        role: 'viewer',
        is_active: true,
        invited_at: null,
        accepted_at: null,
        invitation_token: null,
        invitation_expires_at: null,
        email: 'staff@ledgr.test',
        full_name: 'John Banda',
      },
    ];
    const { container } = await renderTeamPage();

    // Two selects now: the invite form and the member's role changer.
    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
    expect(selects.length).toBeGreaterThanOrEqual(2);

    const memberSelect = selects[selects.length - 1];
    const values = Array.from(memberSelect.options).map((o) => o.value);
    expect(memberSelect.value).toBe('viewer');
    expect(values).toContain('cashier');
  });
});
