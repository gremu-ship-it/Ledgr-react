// @vitest-environment jsdom
/**
 * Adding a member by phone number, through the real component.
 *
 * The point of the feature is that an owner who only has a mobile number can
 * still staff the till: the number is normalised before it leaves the browser,
 * the Edge Function provisions the account, and the one-time password comes
 * back with a way to hand it over. Every step here is the shipped
 * TeamManagementPage — only Supabase is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  lastBody: null as Record<string, unknown> | null,
  calls: 0,
  response: {
    success: true,
    message: '+265 991 234 567 has been added to the business as cashier.',
    login: { phone: '+265991234567', temporary_password: 'Kp7mQx2nRt4w' },
  } as Record<string, unknown>,
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentBusiness: { business: { id: 'biz-1' }, role: 'owner' },
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
      invoke: async (name: string, init: { body: Record<string, unknown> }) => {
        // The page also calls list-team-members on mount; count only the invite
        // so the assertions below cannot be satisfied by the mount call.
        if (name !== 'invite-team-member') return { data: { members: [] }, error: null };
        state.calls += 1;
        state.lastBody = init.body;
        return { data: state.response, error: null };
      },
    },
    from: () => ({
      select: () => ({
        is: () => ({ gt: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  },
}));

import { TeamManagementPage } from '../TeamManagementPage';

beforeEach(() => {
  state.lastBody = null;
  state.calls = 0;
  state.response = {
    success: true,
    message: '+265 991 234 567 has been added to the business as cashier.',
    login: { phone: '+265991234567', temporary_password: 'Kp7mQx2nRt4w' },
  };
});

afterEach(cleanup);

async function renderOnPhoneTab() {
  const view = render(<TeamManagementPage />);
  await waitFor(() => expect(view.container.querySelector('select')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /phone number/i }));
  return view;
}

describe('add member by phone', () => {
  it('switches the form from email to a mobile number', async () => {
    await renderOnPhoneTab();

    const phone = screen.getByLabelText(/mobile number/i);
    expect(phone).toBeTruthy();
    expect(screen.queryByPlaceholderText('colleague@business.mw')).toBeNull();
  });

  it('normalises the number before sending it', async () => {
    const { container } = await renderOnPhoneTab();

    fireEvent.change(screen.getByLabelText(/mobile number/i), {
      target: { value: '0991 234 567' },
    });
    fireEvent.change(screen.getByLabelText(/their name/i), {
      target: { value: 'John Banda' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(state.calls).toBeGreaterThan(0));
    expect(state.lastBody).toMatchObject({
      business_id: 'biz-1',
      role: 'viewer',
      phone: '+265991234567',
      full_name: 'John Banda',
    });
    // Email must not ride along on a phone invite.
    expect(state.lastBody).not.toHaveProperty('email');
  });

  it('shows the one-time password once, with a way to send it', async () => {
    const { container } = await renderOnPhoneTab();

    fireEvent.change(screen.getByLabelText(/mobile number/i), {
      target: { value: '0991234567' },
    });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('Kp7mQx2nRt4w')).toBeTruthy();
    expect(screen.getByText(/one-time password for \+265 991 234 567/i)).toBeTruthy();

    const whatsapp = screen.getByRole('link', { name: /send on whatsapp/i });
    expect(whatsapp.getAttribute('href')).toContain('https://wa.me/265991234567');
    // The password must be in the message the owner is about to send.
    expect(decodeURIComponent(whatsapp.getAttribute('href') ?? '')).toContain('Kp7mQx2nRt4w');
  });

  it('refuses an unusable number without calling the function', async () => {
    const { container } = await renderOnPhoneTab();

    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '123' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText(/enter a valid phone number/i)).toBeTruthy();
    expect(state.calls).toBe(0);
  });

  it('keeps working when the account already exists (no password returned)', async () => {
    state.response = { success: true, message: 'Already added.' };
    const { container } = await renderOnPhoneTab();

    fireEvent.change(screen.getByLabelText(/mobile number/i), {
      target: { value: '+265991234567' },
    });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('Already added.')).toBeTruthy();
    expect(screen.queryByText(/one-time password for/i)).toBeNull();
  });
});
