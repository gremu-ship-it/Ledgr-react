import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: LucideIcon;
  isLoading?: boolean;
  isError?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
}

const toneConfig = {
  positive: {
    iconBg: 'bg-brand-500/10',
    iconColor: 'text-brand-600 dark:text-brand-400',
    valueColor: 'text-brand-700 dark:text-brand-300',
    border: 'border-brand-100',
  },
  negative: {
    iconBg: 'bg-danger/10',
    iconColor: 'text-danger',
    valueColor: 'text-danger',
    border: 'border-danger/20',
  },
  neutral: {
    iconBg: 'bg-bg',
    iconColor: 'text-muted',
    valueColor: 'text-ink',
    border: 'border-line',
  },
};

export function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  isLoading,
  isError,
  tone = 'neutral',
}: MetricCardProps) {
  const cfg = toneConfig[tone];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-line bg-card p-5 shadow-soft animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl bg-surface" />
          <div className="h-3 w-28 rounded bg-surface" />
        </div>
        <div className="h-7 w-32 rounded bg-surface mb-2" />
        <div className="h-3 w-20 rounded bg-surface" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-danger/20 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger/10">
            <Icon size={18} className="text-danger" />
          </div>
          <span className="text-sm text-muted">{label}</span>
        </div>
        <p className="text-sm text-danger font-medium">Failed to load</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border ${cfg.border} bg-card p-5 shadow-soft`}>
      {/* Icon + label row */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cfg.iconBg}`}>
          <Icon size={18} className={cfg.iconColor} />
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      </div>

      {/* Value */}
      <p className={`text-2xl font-bold ${cfg.valueColor}`}>{value}</p>

      {/* Subtext */}
      {subtext && (
        <p className="mt-1 text-xs text-muted">{subtext}</p>
      )}
    </div>
  );
}
