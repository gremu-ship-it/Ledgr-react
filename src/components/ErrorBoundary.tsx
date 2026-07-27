import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors in the component tree below it and displays a
 * friendly fallback instead of a blank white screen.
 *
 * Note: only catches errors during rendering / lifecycle / constructors.
 * It does NOT catch errors in event handlers or async code (e.g. a failed
 * fetch inside useEffect) — handle those locally with try/catch.
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
     
    console.error('Ledgr ErrorBoundary caught an error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.reset);

      return (
        <div
          className="flex h-full min-h-[400px] w-full flex-col items-center justify-center gap-4 p-8 text-center"
          role="alert"
        >
          <div className="rounded-full bg-red-50 p-3">
            <AlertTriangle className="h-6 w-6 text-red-700" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
            <p className="mt-1 max-w-sm text-sm text-gray-700">
              An unexpected error occurred while loading this page. You can try again, or refresh
              the app if the problem persists.
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      );
    }

    return children;
  }
}
