import { clsx } from 'clsx';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-[3px]',
};

/**
 * A simple spinning indicator using the brand green. Use `fullScreen` for
 * full-page loading states (e.g. auth bootstrapping); otherwise it renders
 * inline so it can be dropped into buttons, cards, or table cells.
 */
export function LoadingSpinner({
  size = 'md',
  fullScreen = false,
  label = 'Loading…',
  className,
}: LoadingSpinnerProps) {
  const spinner = (
    <div className={clsx('flex flex-col items-center justify-center gap-3', className)}>
      <div
        role="status"
        aria-label={label}
        className={clsx(
          'animate-spin rounded-full border-brand-200 border-t-brand-500',
          sizeMap[size],
        )}
      />
      {fullScreen && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}
