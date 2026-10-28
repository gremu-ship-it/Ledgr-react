import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUsage } from '@/hooks/useUsage';
import {
  getPlan,
  hasCapability,
  PLAN_TIER_ORDER,
  planRequiredFor,
  type PlanCapability,
  type PlanTier,
} from '@/lib/billing/plans';

interface PlanGateProps {
  /** Existing capability checks remain available for feature-level gates. */
  capability?: PlanCapability;
  /** Minimum subscription tier; useful for modules without a plan capability. */
  minPlan?: PlanTier;
  /** Short feature label. Prefer featureNameKey for new call sites. */
  featureName?: string;
  /** Localized label for the gated feature. */
  featureNameKey?: string;
  /** 'lock' (default) shows the standard upgrade prompt; a node replaces it. */
  fallback?: 'lock' | ReactNode;
  children: ReactNode;
}

/**
 * Soft feature gate based on plan capabilities and/or a minimum tier. The
 * fallback keeps the route visible as an upgrade prompt without rendering the
 * gated feature itself.
 */
export function PlanGate({
  capability,
  minPlan,
  featureName,
  featureNameKey,
  fallback = 'lock',
  children,
}: PlanGateProps) {
  const { planTier } = useUsage();
  const { t } = useTranslation();
  const currentRank = PLAN_TIER_ORDER.indexOf(planTier);
  const minPlanPasses = !minPlan || currentRank >= PLAN_TIER_ORDER.indexOf(minPlan);
  const capabilityPasses = !capability || hasCapability(planTier, capability);

  if (minPlanPasses && capabilityPasses) return <>{children}</>;
  if (fallback !== 'lock') return <>{fallback}</>;

  const capabilityPlan = capability ? planRequiredFor(capability) : null;
  const requiredTier = [minPlan, capabilityPlan?.tier]
    .filter((tier): tier is PlanTier => Boolean(tier))
    .reduce<PlanTier | undefined>((highest, tier) => (
      !highest || PLAN_TIER_ORDER.indexOf(tier) > PLAN_TIER_ORDER.indexOf(highest) ? tier : highest
    ), undefined);
  const requiredPlan = requiredTier ? getPlan(requiredTier) : null;
  const featureLabel = featureNameKey ? t(featureNameKey) : featureName ?? '';

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">
          {t('billing.planGate.upgradeRequired', { feature: featureLabel })}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {requiredPlan
            ? t('billing.planGate.availableOnPlan', { plan: requiredPlan.name })
            : t('billing.planGate.unavailable')}
        </p>
        <Link
          to="/settings?tab=billing"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('billing.planGate.viewPlans')}
        </Link>
      </div>
    </div>
  );
}
