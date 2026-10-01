import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { usageService, type UsageStats } from '@/lib/billing/UsageService';
import { effectivePlanTier, isPlanExpired, normalizePlanTier, type PlanTier, getPlan } from '@/lib/billing/plans';

export function useUsage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  // Plan tier is persisted on businesses.plan_tier. We fetch it directly
  // (rather than trusting the possibly-stale copy in the Zustand store)
  // so that an upgrade/downgrade is reflected as soon as it's saved —
  // this query key matches the one used by SettingsPage/useBrandTheme so
  // an upgrade mutation there also refreshes usage limits here.
  const { data: business } = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => repos.business.findById(businessId!),
    enabled: !!businessId,
    staleTime: 1000 * 60, // 1 minute
  });

  // Entitlements follow the *effective* tier: a paid plan whose
  // plan_expires_at has passed is Free here, even though the row still says
  // otherwise until the nightly expire-subscriptions job rewrites it.
  const source = (business ?? currentBusiness?.business) as
    | { plan_tier?: string | null; plan_expires_at?: string | null }
    | undefined;
  const planExpiresAt = source?.plan_expires_at ?? null;
  const storedPlanTier: PlanTier = normalizePlanTier(source?.plan_tier);
  const planTier: PlanTier = effectivePlanTier(source?.plan_tier, planExpiresAt);
  // True while the row still claims a paid tier whose term has run out —
  // used by the Billing tab to explain the drop back to Free.
  const isPlanLapsed = storedPlanTier !== 'free' && isPlanExpired(planExpiresAt);

  const { data: usage, isLoading } = useQuery({
    queryKey: ['usage', businessId, planTier],
    queryFn: () => usageService.getUsageStats(businessId!, planTier),
    enabled: !!businessId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const plan = getPlan(planTier);

  return {
    usage: usage || {
      currentMonth: 0,
      limit: plan.transactionLimit,
      remaining: plan.transactionLimit,
      percentUsed: 0,
      isUnlimited: plan.transactionLimit === null,
      canCreate: true,
    } as UsageStats,
    plan,
    planTier,
    storedPlanTier,
    planExpiresAt,
    isPlanLapsed,
    isLoading,
  };
}
