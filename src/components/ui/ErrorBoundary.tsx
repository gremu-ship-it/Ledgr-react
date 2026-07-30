/**
 * Re-export the canonical ErrorBoundary from `@/components/ErrorBoundary`.
 *
 * This file exists to avoid breaking existing imports at
 * `@/components/ui/ErrorBoundary` (used by App.tsx and AppLayout.tsx).
 * New code should import directly from `@/components/ErrorBoundary`.
 *
 * TODO: migrate remaining imports and delete this file.
 */
export { ErrorBoundary } from '@/components/ErrorBoundary';
