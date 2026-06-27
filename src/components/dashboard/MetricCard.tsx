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
    iconBg: 'bg-emerald-50',
    iconColor: 'text-brand-500',
    valueColor: 'text-brand-700',
    border: 'border-brand-100',
  },
  negative: {
    iconBg: 'bg-red-50',
    iconColor: 'text-red-500',
    valueColor: 'text-red-700',
    border: 'border-red-100',
  },
  neutral: {
    iconBg: 'bg-gray-50',
    iconColor: 'text-gray-500',
    valueColor: 'text-gray-900',
    border: 'border-gray-200',
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
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl bg-gray-100" />
          <div className="h-3 w-28 rounded bg-gray-100" />
        </div>
        <div className="h-7 w-32 rounded bg-gray-100 mb-2" />
        <div className="h-3 w-20 rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-100 bg-white p-5 shadow-soft">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50">
            <Icon size={18} className="text-red-400" />
          </div>
          <span className="text-sm text-gray-500">{label}</span>
        </div>
        <p className="text-sm text-red-500 font-medium">Failed to load</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border ${cfg.border} bg-white p-5 shadow-soft`}>
      {/* Icon + label row */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cfg.iconBg}`}>
          <Icon size={18} className={cfg.iconColor} />
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      </div>

      {/* Value */}
      <p className={`text-2xl font-bold ${cfg.valueColor}`}>{value}</p>

      {/* Subtext */}
      {subtext && (
        <p className="mt-1 text-xs text-gray-400">{subtext}</p>
      )}
    </div>
  );
}
