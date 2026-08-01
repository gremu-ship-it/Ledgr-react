import { type LucideIcon, Package, FileText, TrendingUp, SearchX } from 'lucide-react';
import { clsx } from 'clsx';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  variant?: 'default' | 'search' | 'inventory' | 'finance';
  className?: string;
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  variant = 'default',
  className,
}: EmptyStateProps) {
  const variantStyles = {
    default: 'border-gray-200 bg-white',
    search: 'border-gray-200 bg-gray-50/50 border-dashed',
    inventory: 'border-amber-100 bg-amber-50/30 border-dashed',
    finance: 'border-brand-100 bg-brand-50/30',
  };

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border px-6 py-12 text-center',
        variantStyles[variant],
        className
      )}
    >
      <div
        className={clsx(
          'flex h-14 w-14 items-center justify-center rounded-2xl',
          variant === 'search' && 'bg-gray-100',
          variant === 'inventory' && 'bg-amber-100',
          variant === 'finance' && 'bg-brand-100',
          variant === 'default' && 'bg-gray-50'
        )}
      >
        <Icon
          className={clsx(
            'h-7 w-7',
            variant === 'search' && 'text-gray-400',
            variant === 'inventory' && 'text-amber-600',
            variant === 'finance' && 'text-brand-600',
            variant === 'default' && 'text-gray-400'
          )}
        />
      </div>

      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-xs leading-relaxed text-gray-500">{description}</p>}
      </div>

      {(actionLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="rounded-xl bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-600 active:scale-95 transition-all"
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function InventoryEmptyState({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={Package}
      title="No products yet"
      description="Add your first product to start tracking inventory, sales, and stock levels across branches."
      actionLabel="Add Product"
      onAction={onAction}
      variant="inventory"
    />
  );
}

export function SearchEmptyState({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No results for "${query}"`}
      description="Try adjusting your search or filters. Check spelling or use fewer keywords."
      secondaryLabel="Clear search"
      onSecondary={onClear}
      variant="search"
    />
  );
}

export function FinanceEmptyState({ title, description, onAction }: { title: string; description?: string; onAction?: () => void }) {
  return (
    <EmptyState
      icon={TrendingUp}
      title={title}
      description={description ?? 'Start recording transactions to see insights here.'}
      actionLabel="Record Transaction"
      onAction={onAction}
      variant="finance"
    />
  );
}
