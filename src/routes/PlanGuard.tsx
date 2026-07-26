/**
 * PlanGuard — wraps routes that require a paid plan.
 *
 * When the current business is on the free tier the child route is replaced
 * with an upgrade prompt that shows which plan unlocks the feature and a
 * one-tap CTA to the Billing & Plans settings tab.
 */
import { Outlet, useNavigate } from 'react-router-dom';
import { Lock, Sparkles } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { PLANS, type PlanTier } from '@/lib/billing/plans';
import { planMeetsMin } from '@/components/layout/navConfig';

interface PlanGuardProps {
  /** Minimum plan tier required for the wrapped routes. */
  minPlan: PlanTier;
}

export function PlanGuard({ minPlan }: PlanGuardProps) {
  const { planTier } = useUsage();
  const navigate = useNavigate();

  if (planMeetsMin(planTier, minPlan)) {
    return <Outlet />;
  }

  const requiredPlan = PLANS[minPlan];
  const currentPlan = PLANS[planTier];

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <Lock className="h-7 w-7 text-brand-500" />
        </div>

        <h1 className="text-xl font-extrabold text-gray-900">
          Upgrade to {requiredPlan.name}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          This feature is available on the{' '}
          <span className="font-semibold text-gray-700">{requiredPlan.name}</span> plan
          and above. You are currently on the{' '}
          <span className="font-semibold text-gray-700">{currentPlan.name}</span> plan.
        </p>

        <div className="mt-6 rounded-xl bg-gray-50 p-4 text-left">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            {requiredPlan.name} includes
          </p>
          <ul className="space-y-1.5">
            {requiredPlan.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-lg font-bold text-brand-700">
            {requiredPlan.priceMWK === 0
              ? 'Free'
              : `MWK ${requiredPlan.priceMWK.toLocaleString()}`}
            <span className="text-sm font-normal text-gray-500">/month</span>
          </p>
        </div>

        <button
          onClick={() => navigate('/settings', { state: { tab: 'billing' } })}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-700 active:scale-95"
        >
          View Plans &amp; Upgrade
        </button>
      </div>
    </div>
  );
}
