import { X, ArrowRight } from 'lucide-react';
import { PLANS, type PlanTier } from '@/lib/billing/plans';
import { useUsage } from '@/hooks/useUsage';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: (tier: PlanTier) => void;
}

export function UpgradeModal({ isOpen, onClose, onUpgrade }: UpgradeModalProps) {
  const { usage, plan, planTier } = useUsage();

  if (!isOpen) return null;

  const nextTier: PlanTier = 
    planTier === 'free' ? 'growth' :
    planTier === 'growth' ? 'pro' : 'enterprise';

  const nextPlan = PLANS[nextTier];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-xl font-semibold">Monthly Limit Reached</h2>
            <p className="text-sm text-gray-500">You've used all {usage.limit} transactions this month</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Current Usage */}
        <div className="p-6 border-b">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">This month</span>
            <span className="font-medium">{usage.currentMonth} / {usage.limit}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-2 bg-red-500 w-full" />
          </div>
          <p className="text-xs text-red-600 mt-2">You cannot create new transactions until you upgrade or wait for next month.</p>
        </div>

        {/* Recommended Upgrade */}
        <div className="p-6">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-brand-600 font-semibold">Recommended</div>
            <div className="text-2xl font-bold">{nextPlan.name} Plan</div>
            <div className="text-brand-700 text-xl font-semibold">
              MWK {nextPlan.priceMWK.toLocaleString()}<span className="text-sm font-normal text-gray-500">/month</span>
            </div>
          </div>

          <ul className="space-y-2 text-sm mb-6">
            {nextPlan.features.slice(0, 4).map((feature, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 bg-brand-600 rounded-full" />
                {feature}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => onUpgrade(nextTier)}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-brand-600 py-3 text-white font-semibold hover:bg-brand-700"
            >
              Upgrade to {nextPlan.name} <ArrowRight className="h-4 w-4" />
            </button>

            <button
              onClick={onClose}
              className="w-full rounded-xl border py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Maybe later
            </button>
          </div>

          <p className="text-[10px] text-center text-gray-400 mt-4">
            Cancel anytime • No long-term commitment
          </p>
        </div>
      </div>
    </div>
  );
}