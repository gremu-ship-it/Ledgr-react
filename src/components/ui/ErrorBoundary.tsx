import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '@/lib/chunkRecovery';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isChunkError = isChunkLoadError(this.state.error);

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            {isChunkError ? 'A new version is available' : 'Something went wrong'}
          </h1>
          <p className="max-w-md text-sm text-gray-500">
            {isChunkError
              ? 'A new version of Ledgr has been deployed. Please refresh the page to load the latest update.'
              : (this.state.error?.message ?? 'An unexpected error occurred.')}
          </p>
          <button
            onClick={() => {
              if (isChunkError && typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
                window.location.reload();
              } else {
                this.setState({ hasError: false, error: null });
              }
            }}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            {isChunkError ? 'Reload Page' : 'Try again'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}