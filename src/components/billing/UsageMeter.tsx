import { useUsage } from '@/hooks/useUsage';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';

export function UsageMeter() {
  const { usage, plan } = useUsage();

  if (usage.isUnlimited) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-emerald-700">
          <TrendingUp className="h-4 w-4" />
          <span className="font-medium">Enterprise Plan — Unlimited transactions</span>
        </div>
      </div>
    );
  }

  const isNearLimit = usage.percentUsed >= 80;
  const isOverLimit = usage.percentUsed >= 100;

  return (
    <div className={`rounded-xl border p-4 text-sm ${isOverLimit ? 'border-red-200 bg-red-50' : isNearLimit ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-gray-900">
          {plan.name} Plan — {usage.currentMonth} / {usage.limit} transactions
        </div>
        <div className={`text-xs font-semibold px-2 py-0.5 rounded ${isOverLimit ? 'bg-red-600 text-white' : isNearLimit ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
          {usage.percentUsed}%
        </div>
      </div>

      <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
        <div 
          className={`h-2 transition-all ${isOverLimit ? 'bg-red-600' : isNearLimit ? 'bg-amber-600' : 'bg-brand-600'}`}
          style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="text-gray-600">
          {usage.remaining} remaining this month
        </div>

        {(isNearLimit || isOverLimit) && (
          <Link 
            to="/settings?tab=billing" 
            className="font-medium text-brand-600 hover:underline flex items-center gap-1"
          >
            Upgrade plan <TrendingUp className="h-3 w-3" />
          </Link>
        )}
      </div>

      {isOverLimit && (
        <div className="mt-3 flex items-start gap-2 text-red-700 text-xs">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>You have reached your monthly limit. Upgrade to continue creating transactions.</span>
        </div>
      )}
    </div>
  );
}