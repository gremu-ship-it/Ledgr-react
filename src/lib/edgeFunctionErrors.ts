/**
 * Edge Function failures, in words an owner can act on.
 *
 * Why this exists
 * ───────────────
 * `supabase.functions.invoke` throws the function's response body away when the
 * status is not 2xx. It resolves to
 *
 *     { data: null, error: FunctionsHttpError('Edge Function returned a non-2xx status code') }
 *
 * and every call site that shows `error.message` therefore shows the same
 * opaque sentence no matter what actually went wrong — "that role does not
 * exist in this database yet" and "your session expired" are indistinguishable.
 *
 * The reason is still available: the Response hangs off `error.context` (and off
 * the `response` field the SDK returns alongside it), so it can be read and
 * parsed. That is what `describeFunctionFailure` does, and what
 * `invokeFunction` wraps so call sites get `{ data, failure }` with a message
 * they can put straight on screen.
 */
import { supabase } from '@/lib/supabase';

/** The shape our Edge Functions use for error bodies. */
export interface FunctionErrorBody {
  error?: string;
  message?: string;
  code?: string;
}

export interface FunctionFailure {
  /** Human-readable reason, safe to show to the owner. */
  message: string;
  /** HTTP status the function answered with, or null when it never answered. */
  status: number | null;
  /** Machine-readable `code` from our functions' error bodies, when present. */
  code?: string;
}

export interface FunctionInvocation<TData> {
  /** Parsed body on success, or null when the call failed. */
  data: TData | null;
  /** Set when the call failed, including 200 responses that carry an error. */
  failure: FunctionFailure | null;
}

/** A friendly name per function, so a message never says "invite-team-member". */
const FUNCTION_LABELS: Record<string, string> = {
  'invite-team-member': 'team invitation service',
  'list-team-members': 'team list service',
  'create-invite-link': 'invitation link service',
  'accept-invite-link': 'invitation link service',
  'create-api-key': 'API key service',
  'export-my-data': 'data export service',
  'request-account-deletion': 'account deletion service',
  'cancel-account-deletion': 'account deletion service',
  'suggest-bank-matches': 'bank matching service',
  'webhook-dispatcher': 'webhook service',
  'support-agent': 'support assistant',
  'ai-chat': 'AI assistant',
  'send-invoice': 'invoice email service',
  'initiate-subscription-payment': 'payments checkout service',
  'verify-subscription-payment': 'payment verification service',
  'grant-manual-subscription': 'manual subscription grant service',
};

export function functionLabel(functionName: string): string {
  return FUNCTION_LABELS[functionName] ?? functionName;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

/**
 * The Response behind a FunctionsHttpError / FunctionsRelayError, whichever way
 * the SDK version in use exposes it.
 */
function responseOf(error: unknown, response?: unknown): Response | null {
  if (isResponse(response)) return response;
  const context = (error as { context?: unknown } | null | undefined)?.context;
  return isResponse(context) ? context : null;
}

/** Reads the body without consuming it twice, and never throws. */
async function readBody(response: Response): Promise<string> {
  try {
    return await (response.bodyUsed ? Promise.resolve('') : response.text());
  } catch {
    return '';
  }
}

/**
 * A message off whatever shape an error arrived in.
 *
 * Not every "error" here is an Error: the demo-mode client answers with a plain
 * `{ message, status }` object, and `String()` on that is "[object Object]" —
 * which is how a readable notice would end up on screen as gibberish.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown; error?: unknown }).message
      ?? (error as { message?: unknown; error?: unknown }).error;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

/** An HTTP status carried on the error itself, as the demo client does. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : null;
}

function messageFromBody(body: FunctionErrorBody): string | null {
  const candidate = body.message || body.error;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

/**
 * What to say when the function answered with no usable body. The status alone
 * distinguishes the cases an owner (or a support agent) can act on.
 */
function messageForStatus(functionName: string, status: number): string {
  const label = functionLabel(functionName);
  switch (status) {
    case 401:
      return 'Your session has expired. Sign in again and try once more.';
    case 403:
      return `You do not have permission to do that (${label}).`;
    case 404:
      // The functions gateway answers 404 for a name it does not know, which
      // means the function is not deployed to this project.
      return `The Ledgr ${label} is not available on this project yet (function "${functionName}" returned 404). It is deployed with the latest release — ask your administrator to redeploy the Edge Functions.`;
    case 405:
      return `The ${label} did not accept that request (HTTP 405).`;
    case 409:
      return `That request conflicts with the current state (${label}).`;
    case 422:
      return `The ${label} rejected that request (HTTP 422).`;
    case 429:
      return 'Too many requests. Wait a moment and try again.';
    case 503:
    case 546:
      return `The Ledgr ${label} failed to start (HTTP ${status}). This usually means the function is out of date or crashed while loading — ask your administrator to redeploy the Edge Functions.`;
    case 504:
      return `The ${label} timed out. Try again in a moment.`;
    default:
      return `The Ledgr ${label} returned an error (HTTP ${status}).`;
  }
}

/**
 * Turns whatever `supabase.functions.invoke` handed back into one message worth
 * showing. Falls back to the status, then to the SDK's own error message, then
 * to a generic sentence — never to silence.
 */
export async function describeFunctionFailure(
  functionName: string,
  error: unknown,
  response?: unknown,
): Promise<FunctionFailure> {
  const res = responseOf(error, response);
  const status = res ? res.status : statusOf(error);
  const relayError = res?.headers?.get('x-relay-error') === 'true';
  const name = (error as { name?: string } | null)?.name;

  if (res && !relayError) {
    const text = await readBody(res);
    if (text) {
      try {
        const parsed = JSON.parse(text) as FunctionErrorBody;
        const message = messageFromBody(parsed);
        if (message) {
          return { message, status, ...(parsed.code ? { code: String(parsed.code) } : {}) };
        }
      } catch {
        // Not JSON — the runtime or the gateway wrote plain text. Show it if it
        // is short enough to be a sentence rather than a stack trace.
        const trimmed = text.trim();
        if (trimmed && trimmed.length <= 300) {
          return { message: trimmed, status };
        }
      }
    }
  }

  if (relayError || name === 'FunctionsRelayError') {
    return {
      message: `The Ledgr ${functionLabel(functionName)} did not start (HTTP ${status ?? 503}). It may not be deployed to this project yet — ask your administrator to redeploy the Edge Functions.`,
      status: status ?? 503,
      code: 'FUNCTION_UNAVAILABLE',
    };
  }

  if (name === 'FunctionsFetchError') {
    return {
      message: `Could not reach the Ledgr ${functionLabel(functionName)}. Check your connection and try again.`,
      status: null,
      code: 'FUNCTION_UNREACHABLE',
    };
  }

  // A message that came with the error itself — the demo-mode client answers
  // this way, and so does anything that wrapped a failure before handing it on.
  // It beats a status-derived sentence because it was written for this case.
  const carried = messageOf(error);
  if (carried && !/non-2xx status code/i.test(carried)) {
    return { message: carried, status };
  }

  if (status !== null) {
    return { message: messageForStatus(functionName, status), status };
  }

  return {
    message: `The Ledgr ${functionLabel(functionName)} could not complete that request.`,
    status: null,
  };
}

/**
 * Invokes an Edge Function and resolves the failure reason when it does not
 * succeed, including the 200-with-`error`-body shape several of our functions
 * use. Call sites get one message they can render.
 */
export async function invokeFunction<TData = unknown>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<FunctionInvocation<TData>> {
  const result = (await supabase.functions.invoke(functionName, { body })) as {
    data: unknown;
    error: unknown;
    response?: unknown;
  };

  if (result.error) {
    return {
      data: null,
      failure: await describeFunctionFailure(functionName, result.error, result.response),
    };
  }

  // Some functions answer 200 with `{ error, message }` — treat that as a
  // failure too, using their own words.
  const asBody = result.data as FunctionErrorBody | null;
  if (asBody && typeof asBody === 'object' && asBody.error) {
    return {
      data: null,
      failure: {
        message: asBody.message || asBody.error,
        status: 200,
        ...(asBody.code ? { code: String(asBody.code) } : {}),
      },
    };
  }

  return { data: (result.data as TData) ?? null, failure: null };
}
