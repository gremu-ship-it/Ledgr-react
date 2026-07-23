import { Lock } from 'lucide-react';

export function LockedPeriodBadge() {
  return (
    <span
      title="This entry belongs to a locked accounting period"
      className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted"
    >
      <Lock className="h-3 w-3" />
      Locked
    </span>
  );
}