import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { usageService, type UsageStats } from '@/lib/billing/UsageService';
import { getPlan, type PlanTier } from '@/lib/billing/plans';

export function useUsage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  // In a real app, the plan tier would come from a subscription table.
  // For now we default to 'free' unless the business has a subscription record.
  const planTier: PlanTier = 'free'; // TODO: Replace with real subscription data

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