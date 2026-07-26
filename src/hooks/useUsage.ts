import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { usageService, type UsageStats } from '@/lib/billing/UsageService';
import { getPlan, normalizePlanTier, type PlanTier } from '@/lib/billing/plans';

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

  const planTier: PlanTier = normalizePlanTier(
    business?.plan_tier ?? currentBusiness?.business?.plan_tier,
  );

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
    isLoading,
  };
}
