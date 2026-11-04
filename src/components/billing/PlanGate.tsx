import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Lock, Sparkles } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { getPlan, hasCapability, planMeetsMin, planRequiredFor, type PlanCapability, type PlanTier } from '@/lib/billing/plans';

type GateRequirement =
  | { capability: PlanCapability; minPlan?: PlanTier }
  | { capability?: never; minPlan: PlanTier };

interface PlanGateOptions {
  /** Existing discrete capability gates (e.g. `ai_insights`). */
  featureName?: string;
  /** Translation key for the feature name when the caller must localize it. */
  featureNameKey?: string;
  /**
   * 'lock' (default): keep the route reachable but replace its content with an
   * upgrade prompt. A ReactNode supplies a fully custom fallback.
   */
  fallback?: 'lock' | ReactNode;
  children: ReactNode;
}

export type PlanGateProps = GateRequirement & PlanGateOptions;

/**
 * Soft plan gate: checks capability and/or minimum tier, then shows a lock
 * screen instead of rendering protected page content when the plan is short.
 * Route callers should compose this with authentication and role gates.
 */
export function PlanGate({
  capability,
  minPlan,
  featureName,
  featureNameKey,
  fallback = 'lock',
  children,
}: PlanGateProps) {
  const { t } = useTranslation();
  const { planTier } = useUsage();
  const meetsCapability = capability ? hasCapability(planTier, capability) : true;
  const meetsMinimum = minPlan ? planMeetsMin(planTier, minPlan) : true;

  if (meetsCapability && meetsMinimum) return <>{children}</>;
  if (fallback !== 'lock') return <>{fallback}</>;

  const requiredPlan = minPlan
    ? getPlan(minPlan)
    : capability
      ? planRequiredFor(capability)
      : null;
  const featureLabel = featureNameKey
    ? t(featureNameKey)
    : featureName ?? t('planGate.defaultFeature');

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">
          {t('planGate.upgradeRequired', { feature: featureLabel })}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {requiredPlan
            ? t('planGate.availableOnPlan', { plan: requiredPlan.name })
            : t('planGate.unavailable')}
        </p>
        <Link
          to="/settings?tab=billing"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Sparkles className="h-4 w-4" />
          {t('planGate.viewPlans')}
        </Link>
      </div>
    </div>
  );
}
