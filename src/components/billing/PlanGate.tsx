import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock, Sparkles } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import {
  hasCapability,
  planRequiredFor,
  PLAN_TIER_ORDER,
  PLANS,
  type PlanCapability,
  type PlanTier,
} from '@/lib/billing/plans';

interface PlanGateProps {
  /** The plan capability required to use the feature (e.g. 'ai_insights'). */
  capability?: PlanCapability;

  /** Minimum plan tier required when access is tier-based rather than capability-based. */
  minPlan?: PlanTier;

  /** Short, human name of the feature for the lock message (e.g. "AI Insights"). */
  featureName: string;

  /**
   * 'lock' (default): keep the feature visible/navigable but replace its
   * content with an "Upgrade required" banner (soft gating — user can see
   * the feature exists as an upsell, but can't use it).
   * ReactNode: fully custom fallback.
   */
  fallback?: 'lock' | ReactNode;

  children: ReactNode;
}

/**
 * Soft feature gate based on subscription plan: keeps the page/nav item
 * reachable but swaps the content out for an upgrade prompt when the
 * current business's plan doesn't include the capability.
 */
export function PlanGate({ capability, minPlan, featureName, fallback = 'lock', children }: PlanGateProps) {
  const { planTier } = useUsage();
  const meetsMinimum = !minPlan
    || PLAN_TIER_ORDER.indexOf(planTier) >= PLAN_TIER_ORDER.indexOf(minPlan);
  const hasRequiredCapability = !capability || hasCapability(planTier, capability);

  if (meetsMinimum && hasRequiredCapability) return <>{children}</>;

  if (fallback !== 'lock') return <>{fallback}</>;

  const requiredPlan = minPlan ? PLANS[minPlan] : capability ? planRequiredFor(capability) : null;

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">{featureName} requires an upgrade</h2>
        <p className="mt-2 text-sm text-gray-500">
          {requiredPlan
            ? `This feature is available on the ${requiredPlan.name} plan and above.`
            : 'This feature isn\u2019t available on your current plan.'}
        </p>
        <Link
          to="/settings?tab=billing"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Sparkles className="h-4 w-4" />
          View plans
        </Link>
      </div>
    </div>
  );
}
