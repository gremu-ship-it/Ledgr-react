// @vitest-environment jsdom
/**
 * When adding a member by phone number goes wrong, the owner must be told why.
 *
 * This is the regression behind "Edge Function returned a non-2xx status code":
 * that sentence is supabase-js's constant for *any* non-2xx, and the function's
 * own explanation was discarded with the response body. These tests drive the
 * real TeamManagementPage against the shape the SDK actually returns
 * (`{ data: null, error: FunctionsHttpError, response }`) and assert the reason
 * from the Edge Function reaches the screen — plus the roster half of the same
 * feature: a member added by number has no email, so the number and a way to
 * reissue their password have to be right there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  /** When set, invite-team-member answers with this non-2xx shape. */
  failure: null as null | { status: number; body: unknown },
  success: null as null | Record<string, unknown>,
  lastInviteBody: null as Record<string, unknown> | null,
  inviteCalls: 0,
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentBusiness: { business: { id: 'biz-1' }, role: 'owner' },
      currentUser: { id: 'user-owner', email: 'owner@ledgr.test' },
    }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('@/lib/errorHandler', () => ({ handleError: () => {} }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: async (name: string, init: { body: Record<string, unknown> }) => {
        if (name === 'list-team-members') return { data: { members: state.members }, error: null };

        // invite-team-member
        state.inviteCalls += 1;
        state.lastInviteBody = init.body;

        if (state.failure) {
          const response = new Response(JSON.stringify(state.failure.body), {
            status: state.failure.status,
            headers: { 'Content-Type': 'application/json' },
          });
          const error = Object.assign(
            new Error('Edge Function returned a non-2xx status code'),
            { name: 'FunctionsHttpError', context: response },
          );
          return { data: null, error, response };
        }

        return { data: state.success ?? { success: true, message: 'Added.' }, error: null };
      },
    },
    from: () => ({
      select: () => ({
        is: () => ({ gt: () => ({ eq: async () => ({ data: [], error: null }) }) }),
        in: async () => ({ data: [], error: null }),
      }),
      order: () => async () => ({ data: [], error: null }),
    }),
    rpc: async () => ({ data: null, error: { message: 'no rpc' } }),
  },
}));

import { TeamManagementPage } from '../TeamManagementPage';

beforeEach(() => {
  state.members = [];
  state.failure = null;
  state.success = null;
  state.lastInviteBody = null;
  state.inviteCalls = 0;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

async function openPhoneForm() {
  const view = render(<TeamManagementPage />);
  await waitFor(() => expect(view.container.querySelector('select')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /phone number/i }));
  return view;
}

async function submitPhone(number = '0991234567') {
  const { container } = await openPhoneForm();
  fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: number } });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(state.inviteCalls).toBeGreaterThan(0));
  return container;
}

describe('phone invite failures say why', () => {
  it('shows the Edge Function reason instead of the SDK constant', async () => {
    state.failure = {
      status: 422,
      body: {
        error: "This Ledgr database does not support the 'cashier' role yet.",
        code: 'ROLE_NOT_SUPPORTED',
      },
    };

    await submitPhone();

    expect(
      await screen.findByText(/does not support the 'cashier' role yet/i),
    ).toBeTruthy();
    expect(screen.queryByText(/non-2xx/i)).toBeNull();
  });

  it('surfaces an account-creation failure from Auth with its detail', async () => {
    state.failure = {
      status: 502,
      body: {
        error: 'Could not create the login for +265 991 234 567: Password should be at least 20 characters.',
        code: 'ACCOUNT_CREATION_FAILED',
      },
    };

    await submitPhone();

    expect(await screen.findByText(/Password should be at least 20 characters/i)).toBeTruthy();
  });

  it('reads a 409 the function explained (already a member)', async () => {
    state.failure = {
      status: 409,
      body: {
        error: 'Already a member',
        code: 'ALREADY_MEMBER',
        message: "+265 991 234 567 is already an active member with role 'cashier'.",
      },
    };

    await submitPhone();

    expect(await screen.findByText(/already an active member with role 'cashier'/i)).toBeTruthy();
  });

  it('tells the owner to redeploy when the function itself will not start', async () => {
    state.failure = { status: 503, body: '' };

    await submitPhone();

    expect(await screen.findByText(/failed to start/i)).toBeTruthy();
    expect(screen.queryByText(/non-2xx/i)).toBeNull();
  });
});

describe('phone members on the roster', () => {
  const phoneMember = {
    id: 'bu-2',
    user_id: 'user-2',
    role: 'cashier',
    is_active: true,
    invited_at: null,
    accepted_at: new Date().toISOString(),
    invitation_token: null,
    invitation_expires_at: null,
    // list-team-members suppresses the synthetic address, so the number is the
    // only identity this member has.
    email: null,
    phone: '+265991234567',
    full_name: 'John Banda',
  };

  it('shows the number for a member who has no email', async () => {
    state.members = [phoneMember];

    render(<TeamManagementPage />);

    expect(await screen.findByText('John Banda')).toBeTruthy();
    expect(await screen.findByText('+265 991 234 567')).toBeTruthy();
    expect(screen.queryByText(/phone\.ledgr\.app/)).toBeNull();
  });

  it('offers a new one-time password and shows it once', async () => {
    state.members = [phoneMember];
    state.success = {
      success: true,
      code: 'ALREADY_MEMBER',
      message: 'New password for +265 991 234 567.',
      login: { phone: '+265991234567', temporary_password: 'Np4?xKd7Qm2z' },
    };

    render(<TeamManagementPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: /new one-time password for john banda/i }),
    );

    expect(await screen.findByText('Np4?xKd7Qm2z')).toBeTruthy();
    expect(screen.getByText(/one-time password for \+265 991 234 567/i)).toBeTruthy();

    // The reset must not change what the member can do.
    expect(state.lastInviteBody).toMatchObject({
      business_id: 'biz-1',
      phone: '+265991234567',
      role: 'cashier',
      reset_password: true,
    });
  });

  it('reports a failed password reset in the function words', async () => {
    state.members = [phoneMember];
    state.failure = {
      status: 502,
      body: { error: 'Failed to reset the password: rate limit exceeded', code: 'PASSWORD_RESET_FAILED' },
    };

    render(<TeamManagementPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: /new one-time password for john banda/i }),
    );

    expect(await screen.findByText(/rate limit exceeded/i)).toBeTruthy();
  });

  it('does not offer a password reset to a member with an email login', async () => {
    state.members = [{ ...phoneMember, phone: null, email: 'john@ledgr.test' }];

    render(<TeamManagementPage />);

    expect(await screen.findByText('john@ledgr.test')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new one-time password/i })).toBeNull();
  });
});
