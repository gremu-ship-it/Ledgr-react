/**
 * The SDK throws the Edge Function's answer away.
 *
 * `supabase.functions.invoke` resolves a non-2xx to
 * `{ data: null, error: FunctionsHttpError }` whose message is the constant
 * "Edge Function returned a non-2xx status code" — which is exactly what the
 * team page used to show an owner who typed a phone number and got nothing
 * actionable back. The function's own explanation is still on the Response
 * hanging off `error.context` (and off the `response` field), so these tests pin
 * that we read it, and that every fallback still says something a person can
 * act on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}));

import { describeFunctionFailure, functionLabel, invokeFunction } from '../edgeFunctionErrors';

/** What supabase-js hands back for a non-2xx: a constant message plus the Response. */
function httpError(status: number, body: string, headers: Record<string, string> = {}) {
  const response = new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: response,
  });
  return { error, response };
}

beforeEach(() => {
  invoke.mockReset();
});

describe('describeFunctionFailure', () => {
  it('shows the reason the Edge Function gave, not the SDK constant', async () => {
    const { error, response } = httpError(
      422,
      JSON.stringify({
        error: "This Ledgr database does not support the 'cashier' role yet.",
        code: 'ROLE_NOT_SUPPORTED',
      }),
    );

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toBe("This Ledgr database does not support the 'cashier' role yet.");
    expect(failure.code).toBe('ROLE_NOT_SUPPORTED');
    expect(failure.status).toBe(422);
    expect(failure.message).not.toMatch(/non-2xx/i);
  });

  it('prefers `message` over `error`, matching how the functions explain themselves', async () => {
    const { error, response } = httpError(
      404,
      JSON.stringify({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
        message: 'No account found for a@b.mw. Ask them to register at /register first.',
      }),
    );

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toContain('Ask them to register');
  });

  it('finds the Response on error.context when the SDK does not return one', async () => {
    const { error } = httpError(500, JSON.stringify({ error: 'Failed to add member: boom' }));

    // No `response` argument at all — only `error.context`.
    const failure = await describeFunctionFailure('invite-team-member', error);

    expect(failure.message).toBe('Failed to add member: boom');
    expect(failure.status).toBe(500);
  });

  it('shows a plain-text body from the runtime', async () => {
    const { error, response } = httpError(500, 'TypeError: cannot read properties of undefined');

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toBe('TypeError: cannot read properties of undefined');
  });

  it('explains a 503 as a function that did not start', async () => {
    const { error, response } = httpError(503, '');

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toMatch(/failed to start/i);
    expect(failure.message).toMatch(/redeploy the Edge Functions/i);
  });

  it('explains a 404 as a function that is not deployed', async () => {
    const { error, response } = httpError(404, '');

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toMatch(/not available on this project yet/i);
    expect(failure.message).toContain('invite-team-member');
  });

  it('tells the owner to sign in again on a 401', async () => {
    const { error, response } = httpError(401, '');

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.message).toMatch(/session has expired/i);
  });

  it('reports a relay error as the function being unavailable', async () => {
    const { error, response } = httpError(503, '', { 'x-relay-error': 'true' });

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.code).toBe('FUNCTION_UNAVAILABLE');
    expect(failure.message).toMatch(/did not start/i);
  });

  it('reports a network failure as unreachable rather than blaming the function', async () => {
    const error = Object.assign(new Error('Failed to send a request to the Edge Function'), {
      name: 'FunctionsFetchError',
    });

    const failure = await describeFunctionFailure('invite-team-member', error);

    expect(failure.code).toBe('FUNCTION_UNREACHABLE');
    expect(failure.message).toMatch(/could not reach/i);
    expect(failure.status).toBeNull();
  });

  it('never falls back to the SDK constant', async () => {
    const failure = await describeFunctionFailure(
      'invite-team-member',
      new Error('Edge Function returned a non-2xx status code'),
    );

    expect(failure.message).not.toMatch(/non-2xx/i);
    expect(failure.message).toMatch(/team invitation service/i);
  });

  it('reads a plain-object error, the way demo mode answers', async () => {
    // The demo client has no Response and no Error instance — String() on it
    // would put "[object Object]" in front of a visitor exploring the product.
    const failure = await describeFunctionFailure('invite-team-member', {
      message: 'Demo mode is read-only. Create a free account to add your own team.',
      status: 403,
    });

    expect(failure.message).toMatch(/demo mode is read-only/i);
    expect(failure.status).toBe(403);
  });

  it('labels functions in product language', () => {
    expect(functionLabel('invite-team-member')).toBe('team invitation service');
    expect(functionLabel('list-team-members')).toBe('team list service');
    // Unknown names still produce something printable rather than undefined.
    expect(functionLabel('some-new-function')).toBe('some-new-function');
  });
});

describe('invokeFunction', () => {
  it('passes the body through and returns the parsed payload', async () => {
    invoke.mockResolvedValue({
      data: { success: true, login: { phone: '+265991234567', temporary_password: 'Kp7mQx2nRt4w' } },
      error: null,
    });

    const result = await invokeFunction<{ success: boolean }>('invite-team-member', {
      business_id: 'biz-1',
      phone: '+265991234567',
      role: 'cashier',
    });

    expect(invoke).toHaveBeenCalledWith('invite-team-member', {
      body: { business_id: 'biz-1', phone: '+265991234567', role: 'cashier' },
    });
    expect(result.failure).toBeNull();
    expect(result.data?.success).toBe(true);
  });

  it('turns a non-2xx into a failure carrying the function reason', async () => {
    const { error, response } = httpError(
      502,
      JSON.stringify({ error: 'Could not create the login for +265 991 234 567: rate limited' }),
    );
    invoke.mockResolvedValue({ data: null, error, response });

    const result = await invokeFunction('invite-team-member', { business_id: 'biz-1' });

    expect(result.data).toBeNull();
    expect(result.failure?.message).toContain('rate limited');
    expect(result.failure?.status).toBe(502);
  });

  it('treats a 200 carrying an error body as a failure, in the function words', async () => {
    invoke.mockResolvedValue({
      data: { error: 'Already a member', message: '+265 991 234 567 is already an active member.' },
      error: null,
    });

    const result = await invokeFunction('invite-team-member', { business_id: 'biz-1' });

    expect(result.failure?.message).toBe('+265 991 234 567 is already an active member.');
    expect(result.data).toBeNull();
  });

  it('survives a response whose body was already read', async () => {
    const response = new Response(JSON.stringify({ error: 'first read' }), { status: 400 });
    await response.text();
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: response,
    });

    const failure = await describeFunctionFailure('invite-team-member', error, response);

    expect(failure.status).toBe(400);
    expect(failure.message.length).toBeGreaterThan(0);
  });
});
