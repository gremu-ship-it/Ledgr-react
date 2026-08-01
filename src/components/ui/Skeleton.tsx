import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rect' | 'circle';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, variant = 'rect', width, height }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-gray-100',
        variant === 'text' && 'h-4 rounded',
        variant === 'rect' && 'rounded-xl',
        variant === 'circle' && 'rounded-full',
        className
      )}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-200">
        <div className="space-y-0">
          <div className="h-10 bg-gray-50" />
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-4 border-t border-gray-100 px-4 py-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <Skeleton className="mb-4 h-4 w-32" variant="text" />
      <Skeleton className="mb-2 h-7 w-48" variant="text" />
      <Skeleton className="h-4 w-24" variant="text" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" variant="text" />
        <Skeleton className="h-4 w-72" variant="text" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
