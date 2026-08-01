import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  progress: number;
}

export function PullToRefreshIndicator({ pullDistance, isRefreshing, progress }: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !isRefreshing) return null;

  const show = pullDistance > 10 || isRefreshing;

  return (
    <div
      className={clsx(
        'flex justify-center overflow-hidden transition-all duration-200',
        show ? 'opacity-100' : 'opacity-0'
      )}
      style={{ height: isRefreshing ? 56 : pullDistance }}
      aria-hidden="true"
    >
      <div
        className={clsx(
          'flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-gray-100 transition-transform duration-200',
          isRefreshing ? 'mt-2' : ''
        )}
        style={{
          transform: `scale(${0.8 + progress * 0.2})`,
        }}
      >
        <RefreshCw className={clsx('h-4 w-4 text-brand-600', (isRefreshing || progress >= 1) && 'animate-spin')} />
        <span className="text-xs font-semibold text-gray-700">
          {isRefreshing ? 'Refreshing…' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
        </span>
      </div>
    </div>
  );
}
