import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface SectionErrorBoundaryProps {
  children: React.ReactNode;
  sectionName: string;
  fallbackHeight?: string;
}

/**
 * Wraps a section of the page (chart, report, table) with an error boundary.
 * If the section crashes, shows a friendly message instead of crashing the whole page.
 */
export function SectionErrorBoundary({
  children,
  sectionName,
  fallbackHeight = '300px',
}: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      name={sectionName}
      fallback={(error, reset) => (
        <div
          style={{ height: fallbackHeight }}
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50"
        >
          <div className="text-center">
            <h3 className="text-sm font-medium text-gray-900">
              {sectionName} failed to load
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {error instanceof Error ? error.message : 'An unexpected error occurred'}
            </p>
            <button
              onClick={reset}
              className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
