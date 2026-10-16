// @vitest-environment jsdom
/**
 * Sign-up confirmation email recovery.
 *
 * Two regressions are covered:
 *   1. Sign-up must tell Supabase where the confirmation link should land
 *      (`emailRedirectTo`), instead of relying only on the project Site URL.
 *   2. A user who did not receive the email must be able to ask for a new one,
 *      from both the "check your inbox" screen after sign-up and the login
 *      "email not verified" message, without being able to spam the endpoint.
 *
 * `react-i18next` is mocked so `t()` returns the key, which keeps assertions on
 * translation keys stable and independent of locale text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  signInWithPassword: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: mocks.signUp,
      resend: mocks.resend,
      signInWithPassword: mocks.signInWithPassword,
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.getAuthenticatorAssuranceLevel,
        listFactors: mocks.listFactors,
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({ partner: null, branding: {} }),
}));

vi.mock('@/components/auth/AuthShell', () => ({
  AuthShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { RegisterPage } from '@/pages/RegisterPage';
import { LoginPage } from '@/pages/LoginPage';

const STRONG_PASSWORD = 'Sup3r-Secret-Pass';
const ORIGIN = window.location.origin;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: null });
});

function renderRegister(url = '/register') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

function renderLogin(url = '/login') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

function fillRegisterForm(email = 'owner@example.mw') {
  fireEvent.change(document.getElementById('fullName')!, { target: { value: 'Ada Owner' } });
  fireEvent.change(document.getElementById('email')!, { target: { value: email } });
  fireEvent.change(document.getElementById('password')!, { target: { value: STRONG_PASSWORD } });
  fireEvent.change(document.getElementById('confirmPassword')!, { target: { value: STRONG_PASSWORD } });
  fireEvent.submit(document.querySelector('form')!);
}

describe('RegisterPage sign-up', () => {
  it('passes emailRedirectTo pointing at /create-business by default', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    renderRegister();

    fillRegisterForm();

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1));
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'owner@example.mw',
      password: STRONG_PASSWORD,
      options: {
        data: { full_name: 'Ada Owner' },
        emailRedirectTo: `${ORIGIN}/create-business`,
      },
    });
  });

  it('uses a safe same-origin returnTo as the confirmation destination', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    renderRegister('/register?returnTo=' + encodeURIComponent('/invite/abc123'));

    fillRegisterForm();

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1));
    expect(mocks.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${ORIGIN}/invite/abc123`);
  });

  it('offers a resend action on the check-inbox screen', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    renderRegister();

    fillRegisterForm('owner@example.mw');

    expect(await screen.findByText('auth.checkInbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'auth.resendConfirmation' })).toBeTruthy();
  });

  it('normalises the email so sign-up, resend and sign-in use the same address', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    renderRegister();

    fillRegisterForm(' Owner@Example.mw ');

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1));
    expect(mocks.signUp.mock.calls[0][0].email).toBe('owner@example.mw');
  });

  it('does not promise an email when the address is already registered (identities: [])', async () => {
    // GoTrue's anti-enumeration answer to a duplicate sign-up: a fake success
    // with an obfuscated user and NO email sent. The user must be told to
    // sign in, not to wait for a link that is never coming.
    mocks.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    renderRegister();

    fillRegisterForm('owner@example.mw');

    expect(await screen.findByText('auth.accountAlreadyExists')).toBeTruthy();
    expect(screen.queryByText('auth.confirmationEmailSent')).toBeNull();
    expect(screen.queryByRole('button', { name: 'auth.resendConfirmation' })).toBeNull();
    expect(screen.getByRole('link', { name: 'auth.signIn' })).toBeTruthy();
  });

  it('does not promise an email when sign-up returns user_already_exists', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered', code: 'user_already_exists', status: 422 },
    });
    renderRegister();

    fillRegisterForm('owner@example.mw');

    expect(await screen.findByText('auth.accountAlreadyExists')).toBeTruthy();
    expect(screen.queryByText('auth.confirmationEmailSent')).toBeNull();
  });

  it('keeps the resend path available when the confirmation email was throttled', async () => {
    // The account is created but the built-in mailer dropped the email
    // (429 over_email_send_rate_limit): the owner currently in the inbox
    // has nothing. They must still reach check-inbox + resend, with the
    // delay explained — not a raw GoTrue error on the form.
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
    });
    renderRegister();

    fillRegisterForm('owner@example.mw');

    expect(await screen.findByText('auth.confirmationEmailSent')).toBeTruthy();
    expect(screen.getByText('auth.signUpRateLimited')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'auth.resendConfirmation' })).toBeTruthy();
  });
});

describe('ResendConfirmationButton', () => {
  async function reachCheckInbox() {
    mocks.signUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    renderRegister();
    fillRegisterForm('owner@example.mw');
    await screen.findByText('auth.checkInbox');
  }

  it('re-sends the signup confirmation to the same address and destination', async () => {
    mocks.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await reachCheckInbox();

    fireEvent.click(screen.getByRole('button', { name: 'auth.resendConfirmation' }));

    await waitFor(() => expect(mocks.resend).toHaveBeenCalledTimes(1));
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'owner@example.mw',
      options: { emailRedirectTo: `${ORIGIN}/create-business` },
    });
    expect(await screen.findByText('auth.resendConfirmationSent')).toBeTruthy();
  });

  it('disables itself during the 60s cooldown so it cannot be spammed', async () => {
    mocks.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
    await reachCheckInbox();

    fireEvent.click(screen.getByRole('button', { name: 'auth.resendConfirmation' }));

    const cooling = await screen.findByRole('button', { name: 'auth.resendConfirmationIn' });
    expect((cooling as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cooling);
    expect(mocks.resend).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly message when Supabase rate-limits the resend', async () => {
    mocks.resend.mockResolvedValue({
      data: null,
      error: { message: 'email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
    });
    await reachCheckInbox();

    fireEvent.click(screen.getByRole('button', { name: 'auth.resendConfirmation' }));

    expect(await screen.findByText('auth.resendRateLimited')).toBeTruthy();
    expect(screen.queryByText('email rate limit exceeded')).toBeNull();
  });

  it('surfaces other resend errors with the server message', async () => {
    mocks.resend.mockResolvedValue({
      data: null,
      error: { message: 'Signups not allowed for this instance', code: 'signup_disabled', status: 422 },
    });
    await reachCheckInbox();

    fireEvent.click(screen.getByRole('button', { name: 'auth.resendConfirmation' }));

    expect(await screen.findByText('Signups not allowed for this instance')).toBeTruthy();
  });

  it('does not burn the cooldown when a resend fails for a non-rate-limit reason', async () => {
    mocks.resend.mockResolvedValue({
      data: null,
      error: { message: 'Signups not allowed for this instance', code: 'signup_disabled', status: 422 },
    });
    await reachCheckInbox();

    fireEvent.click(screen.getByRole('button', { name: 'auth.resendConfirmation' }));

    expect(await screen.findByText('Signups not allowed for this instance')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'auth.resendConfirmation' });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('LoginPage unverified email', () => {
  function attemptLogin(mode: 'email' | 'phone' = 'email') {
    if (mode === 'phone') {
      fireEvent.click(screen.getByRole('button', { name: 'auth.signInWithPhone' }));
      fireEvent.change(document.getElementById('phone')!, { target: { value: '0991234567' } });
    } else {
      fireEvent.change(document.getElementById('email')!, { target: { value: 'Owner@Example.mw ' } });
    }
    fireEvent.change(document.getElementById('password')!, { target: { value: STRONG_PASSWORD } });
    fireEvent.submit(document.querySelector('form')!);
  }

  it('offers to resend the confirmation for an unverified email login', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
    });
    mocks.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
    renderLogin();

    attemptLogin('email');

    expect(await screen.findByText('auth.emailNotVerified')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'auth.resendConfirmation' }));

    await waitFor(() => expect(mocks.resend).toHaveBeenCalledTimes(1));
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'owner@example.mw',
      options: { emailRedirectTo: `${ORIGIN}/dashboard` },
    });
  });

  it('does not offer a resend for phone-login accounts (no real inbox)', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
    });
    renderLogin();

    attemptLogin('phone');

    expect(await screen.findByText('auth.emailNotVerified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'auth.resendConfirmation' })).toBeNull();
  });

  it('does not offer a resend for wrong-password errors', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
    });
    renderLogin();

    attemptLogin('email');

    expect(await screen.findByText('auth.incorrectCredentials')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'auth.resendConfirmation' })).toBeNull();
  });
});
