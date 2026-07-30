import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isChunkLoadError } from '@/lib/chunkRecovery';
import { createLogger } from '@/lib/logger';
import { captureError } from '@/lib/errorCapture';
import * as Sentry from '@sentry/react';

const log = createLogger('ErrorBoundary');

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional label for logging (e.g. "Dashboard", "Reports"). */
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors in the component tree below it and displays a
 * friendly fallback instead of a blank white screen.
 *
 * Integrations:
 *  - Structured logger (with module + name context)
 *  - Sentry error reporting (when DSN is configured)
 *  - errorCapture ring buffer (for the Support Agent)
 *
 * Note: only catches errors during rendering / lifecycle / constructors.
 * It does NOT catch errors in event handlers or async code (e.g. a failed
 * fetch inside useEffect) — handle those locally with try/catch or
 * `handleError()` from `@/lib/errorHandler`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const boundaryName = this.props.name ?? 'App';

    // 1. Structured logger → console + Sentry (for error/fatal)
    log.error(`ErrorBoundary "${boundaryName}" caught a render error`, error, {
      componentStack: info.componentStack ?? undefined,
    });

    // 2. Support Agent ring buffer (sanitised, no PII)
    captureError(error, `ErrorBoundary:${boundaryName}`);

    // 3. Direct Sentry capture with React component stack as extra context.
    //    The logger already calls Sentry.captureException for error-level logs,
    //    but we send a second event here with the component stack attached so
    //    we can trace the exact React component that blew up.
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, {
        tags: { boundary: boundaryName },
        extra: { componentStack: info.componentStack },
      });
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.reset);

      const isChunkError = isChunkLoadError(error);

      return (
        <div
          className="flex h-full min-h-[400px] w-full flex-col items-center justify-center gap-4 p-8 text-center"
          role="alert"
        >
          <div className="rounded-full bg-red-50 p-3">
            <AlertTriangle className="h-6 w-6 text-red-700" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isChunkError ? 'A new version is available' : 'Something went wrong'}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-gray-700">
              {isChunkError
                ? 'A new version of Ledgr has been deployed. Please refresh the page to load the latest update.'
                : 'An unexpected error occurred while loading this page. You can try again, or refresh the app if the problem persists.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isChunkError && typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
                window.location.reload();
              } else {
                this.reset();
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {isChunkError ? 'Reload Page' : 'Try again'}
          </button>
        </div>
      );
    }

    return children;
  }
}
