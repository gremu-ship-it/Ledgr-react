import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: LucideIcon;
  isLoading?: boolean;
  isError?: boolean;
  tone?: `positive` | `negative`;
}

export function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
}: MetricCardProps) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Icon size={18} />
        <span>{label}</span>
      </div>

      <div className="mt-2 text-xl font-bold">{value}</div>

      {subtext && (
        <div className="text-sm text-gray-500">{subtext}</div>
      )}
    </div>
  );
}