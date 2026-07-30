/**
 * Client-side error capture for the Support Agent.
 *
 * Keeps a small ring buffer of the most recent uncaught errors so that, when a
 * user opens the "Report a problem" mode in the support chat, we can attach
 * sanitised diagnostics to the request. We deliberately copy only the message,
 * a short stack slice, the source URL, and a timestamp — never user-entered
 * data, cookies, or auth tokens. The Support Agent backend further treats this
 * as untrusted, low-PII input.
 */

export interface CapturedError {
  message: string;
  stack?: string;
  url?: string;
  ts: string;
  kind: 'window.error' | 'unhandledrejection' | 'manual';
}

const MAX_STORED = 15;
const MAX_STACK_LINES = 3;

let buffer: CapturedError[] = [];

function pushError(err: CapturedError): void {
  buffer.push(err);
  if (buffer.length > MAX_STORED) {
    buffer = buffer.slice(-MAX_STORED);
  }
}

function slimStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack
    .split('\n')
    .slice(0, MAX_STACK_LINES)
    .join('\n')
    .slice(0, 800);
}

/** Call once at app start (e.g. from main.tsx) to begin capturing errors. */
export function initErrorCapture(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    const target = event.target as { src?: string } | null;
    // Resource load errors (img/script) don't carry a real stack; skip them.
    if (!event.message && target?.src) return;
    pushError({
      message: event.message || 'Unknown error',
      stack: slimStack((event.error as Error | undefined)?.stack),
      url: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      ts: new Date().toISOString(),
      kind: 'window.error',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; stack?: string } | unknown;
    const message =
      (reason && typeof reason === 'object' && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(event.reason)) || 'Unhandled promise rejection';
    pushError({
      message,
      stack: slimStack(
        reason && typeof reason === 'object' && 'stack' in reason
          ? (reason as { stack: string }).stack
          : undefined,
      ),
      ts: new Date().toISOString(),
      kind: 'unhandledrejection',
    });
  });
}

/** Manually record an error (e.g. from an ErrorBoundary). */
export function captureError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  pushError({
    message: context ? `${context}: ${err.message}` : err.message,
    stack: slimStack(err.stack),
    ts: new Date().toISOString(),
    kind: 'manual',
  });
}

/** Returns a sanitised copy of the most recent errors (oldest → newest). */
export function getRecentErrors(): CapturedError[] {
  return [...buffer];
}

/** Clears the buffer (e.g. after the user has sent a problem report). */
export function clearCapturedErrors(): void {
  buffer = [];
}
