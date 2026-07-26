import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useUsage } from '@/hooks/useUsage';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { PLANS, PLAN_TIER_ORDER, type PlanTier } from '@/lib/billing/plans';
import { Check, Star, Lock } from 'lucide-react';
import { UsageHistoryChart } from './UsageHistoryChart';

export function BillingTab() {
  const { usage, plan, planTier } = useUsage();
  const { canManageBilling } = usePermissions();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();
  const [pendingTier, setPendingTier] = useState<PlanTier | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // NOTE: There is no payment gateway wired up yet (PayChangu / Pesapal /
  // Flutterwave to be integrated). Until then, the business owner can
  // self-serve switch plans here directly — this should only be used once
  // payment has actually been arranged with us out-of-band. This still
  // records the change (plan_updated_at) for later reconciliation.
  const changePlanMutation = useMutation({
    mutationFn: async (targetTier: PlanTier) => {
      if (!businessId) throw new Error('No business selected');
      await repos.business.update(businessId, {
        plan_tier: targetTier,
        plan_updated_at: new Date().toISOString(),
      });
      return targetTier;
    },
    onMutate: (targetTier) => setPendingTier(targetTier),
    onSuccess: (targetTier) => {
      queryClient.invalidateQueries({ queryKey: ['business', businessId] });
      queryClient.invalidateQueries({ queryKey: ['usage', businessId] });
      setNotice(`Plan changed to ${PLANS[targetTier].name}.`);
      setTimeout(() => setNotice(null), 4000);
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Failed to change plan.');
      setTimeout(() => setNotice(null), 4000);
    },
    onSettled: () => setPendingTier(null),
  });

  const isMoreExpensive = (target: PlanTier) =>
    PLAN_TIER_ORDER.indexOf(target) > PLAN_TIER_ORDER.indexOf(planTier);

  return (
    <div className="space-y-8">
      {/* Current Plan */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Current Plan</h3>
        <div className="rounded-2xl border bg-white p-6 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-bold">{plan.name}</div>
              {plan.popular && (
                <div className="px-3 py-0.5 text-xs bg-brand-600 text-white rounded-full flex items-center gap-1">
                  <Star className="h-3 w-3" /> Popular
                </div>
              )}
            </div>
            <div className="mt-1 text-3xl font-semibold text-brand-700">
              {plan.priceMWK === 0 ? 'Free' : `MWK ${plan.priceMWK.toLocaleString()}`}
              <span className="text-base font-normal text-gray-500">/month</span>
            </div>
          </div>

          <div className="text-sm text-gray-600">
            {usage.isUnlimited
              ? 'Unlimited transactions'
              : `${usage.currentMonth} of ${usage.limit} transactions used this month`}
          </div>
        </div>
      </div>

      {!canManageBilling && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Lock className="h-4 w-4 flex-shrink-0" />
          Only the business owner can change the subscription plan.
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
          {notice}
        </div>
      )}

      {/* Upgrade Plans */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Upgrade Your Plan</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.values(PLANS).map((p) => {
            const isCurrent = p.tier === planTier;
            const isBusy = pendingTier === p.tier;
            const disabled = isCurrent || !canManageBilling || changePlanMutation.isPending;
            return (
              <div
                key={p.tier}
                className={`rounded-2xl border p-5 flex flex-col ${isCurrent ? 'border-brand-600 bg-brand-50' : 'hover:border-gray-300'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-lg">{p.name}</div>
                  {p.popular && <div className="text-xs px-2 py-0.5 bg-brand-600 text-white rounded-full">Most Popular</div>}
                </div>

                <div className="text-3xl font-bold mb-1">
                  {p.priceMWK === 0 ? 'Free' : `MWK ${p.priceMWK.toLocaleString()}`}
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </div>

                <div className="text-xs text-gray-500 mb-4">
                  {p.transactionLimit === null
                    ? 'Unlimited transactions'
                    : `${p.transactionLimit.toLocaleString()} transactions/month`}
                </div>

                <ul className="space-y-1.5 text-sm flex-1 mb-4">
                  {p.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => changePlanMutation.mutate(p.tier)}
                  disabled={disabled}
                  className={`mt-auto w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${
                    isCurrent
                      ? 'bg-gray-200 text-gray-500 cursor-default'
                      : disabled
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  {isCurrent
                    ? 'Current Plan'
                    : isBusy
                      ? 'Saving…'
                      : isMoreExpensive(p.tier)
                        ? 'Upgrade'
                        : 'Downgrade'}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-gray-400">
          Payment processing isn't automated yet — please confirm payment with our team before
          switching plans. Plan changes take effect immediately.
        </p>
      </div>

      {/* Usage History */}
      <div className="rounded-2xl border bg-white p-6">
        <h4 className="font-semibold mb-3">Usage This Month</h4>
        <div className="text-4xl font-bold text-brand-700">
          {usage.currentMonth} <span className="text-xl font-normal text-gray-500">transactions</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {usage.isUnlimited ? 'Unlimited plan' : `${usage.remaining} remaining`}
        </p>
      </div>

      {/* Usage History Chart */}
      <UsageHistoryChart />
    </div>
  );
}
