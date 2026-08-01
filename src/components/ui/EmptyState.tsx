import { type LucideIcon, Package, FileText, TrendingUp, SearchX, Users, Receipt, Calendar } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  variant?: 'default' | 'search' | 'inventory' | 'finance' | 'onboarding';
  className?: string;
  /** New: enforce single headline + description + action */
  compact?: boolean;
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
  compact = false,
}: EmptyStateProps) {
  const variantStyles = {
    default: 'border-gray-200 bg-white',
    search: 'border-gray-200 bg-gray-50/50 border-dashed',
    inventory: 'border-amber-100 bg-amber-50/30 border-dashed',
    finance: 'border-brand-100 bg-brand-50/30',
    onboarding: 'border-brand-200 bg-brand-50/20',
  };

  const iconBg = {
    default: 'bg-gray-50',
    search: 'bg-gray-100',
    inventory: 'bg-amber-100',
    finance: 'bg-brand-100',
    onboarding: 'bg-brand-100',
  };

  const iconColor = {
    default: 'text-gray-400',
    search: 'text-gray-400',
    inventory: 'text-amber-600',
    finance: 'text-brand-600',
    onboarding: 'text-brand-600',
  };

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border px-6 py-12 text-center',
        variantStyles[variant],
        className,
        compact && 'py-8 gap-3'
      )}
    >
      <div
        className={clsx(
          'flex h-14 w-14 items-center justify-center rounded-2xl',
          iconBg[variant]
        )}
      >
        <Icon className={clsx('h-7 w-7', iconColor[variant])} />
      </div>

      <div className="space-y-1.5 max-w-sm">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description && (
          <p className={clsx(
            'leading-relaxed text-gray-500',
            compact ? 'text-xs' : 'text-xs'
          )}>
            {description}
          </p>
        )}
      </div>

      {(actionLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          {actionLabel && onAction && (
            <Button
              variant="primary"
              size="sm"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onSecondary}
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Standardised contextual empty states (presentation spec #7) ───────────────

export function NoInvoicesYet({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={Receipt}
      title="No invoices yet"
      description="Create your first invoice to start tracking customer payments."
      actionLabel="Create invoice"
      onAction={onAction}
      variant="finance"
    />
  );
}

export function NoCustomersYet({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={Users}
      title="No customers yet"
      description="Add your first customer or supplier to begin managing contacts."
      actionLabel="Add contact"
      onAction={onAction}
      variant="default"
    />
  );
}

export function NoTransactionsYet({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={TrendingUp}
      title="No transactions yet"
      description="Record your first income or expense to see activity here."
      actionLabel="Record transaction"
      onAction={onAction}
      variant="finance"
    />
  );
}

export function NoProductsYet({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={Package}
      title="No products yet"
      description="Add your first product to start tracking inventory and stock levels."
      actionLabel="Add product"
      onAction={onAction}
      variant="inventory"
    />
  );
}

export function OnboardingEmptyState({ 
  step, 
  onAction 
}: { 
  step: 1 | 2 | 3 | 4 | 5 | 6; 
  onAction?: () => void 
}) {
  const steps = {
    1: { title: "Add business information", desc: "Tell us about your company to personalise your experience." },
    2: { title: "Configure financial year", desc: "Set your financial year and chart of accounts." },
    3: { title: "Add first contact", desc: "Create your first customer or supplier." },
    4: { title: "Record first transaction", desc: "Log your first income or expense entry." },
    5: { title: "Create first invoice", desc: "Send your first invoice to a customer." },
    6: { title: "Add products", desc: "Enable inventory tracking by adding products." },
  };

  const s = steps[step];

  return (
    <EmptyState
      icon={Calendar}
      title={s.title}
      description={s.desc}
      actionLabel="Get started"
      onAction={onAction}
      variant="onboarding"
      compact
    />
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
