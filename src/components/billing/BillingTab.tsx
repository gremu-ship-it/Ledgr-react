import { useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2, X, Check, Star, Lock } from 'lucide-react';
import { useUsage } from '@/hooks/useUsage';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { usePaymentReturnStatus } from '@/hooks/usePaymentReturnStatus';
import { repos } from '@/lib/repositories';
import { subscriptionPaymentService } from '@/services/billing/SubscriptionPaymentService';
import { PLANS, PLAN_TIER_ORDER, type PlanTier } from '@/lib/billing/plans';
import { UsageHistoryChart } from './UsageHistoryChart';
import { CheckoutModal } from './CheckoutModal';

export function BillingTab() {
  const { usage, plan, planTier } = useUsage();
  const { canManageBilling } = usePermissions();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();
  const [pendingDowngradeTier, setPendingDowngradeTier] = useState<PlanTier | null>(null);
  const [checkoutTier, setCheckoutTier] = useState<Exclude<PlanTier, 'free'> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { state: paymentReturn, dismiss: dismissPaymentReturn } = usePaymentReturnStatus(businessId);

  const { data: payments = [] } = useQuery({
    queryKey: ['subscription-payments', businessId],
    queryFn: () => subscriptionPaymentService.listPayments(businessId!),
    enabled: !!businessId,
  });

  // Downgrading (including moving back to Free) is instant and self-serve
  // — no payment is involved, so it doesn't go through PayChangu. Upgrading
  // always requires a confirmed payment (see CheckoutModal); the database
  // also enforces this server-side (enforce_plan_tier_change trigger).
  const downgradeMutation = useMutation({
    mutationFn: async (targetTier: PlanTier) => {
      if (!businessId) throw new Error('No business selected');
      await repos.business.update(businessId, {
        plan_tier: targetTier,
        plan_expires_at: null,
        plan_updated_at: new Date().toISOString(),
      });
      return targetTier;
    },
    onMutate: (targetTier) => setPendingDowngradeTier(targetTier),
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
    onSettled: () => setPendingDowngradeTier(null),
  });

  const isMoreExpensive = (target: PlanTier) =>
    PLAN_TIER_ORDER.indexOf(target) > PLAN_TIER_ORDER.indexOf(planTier);

  const handlePlanClick = (targetTier: PlanTier) => {
    if (targetTier === planTier || !canManageBilling) return;
    if (isMoreExpensive(targetTier) && targetTier !== 'free') {
      setCheckoutTier(targetTier as Exclude<PlanTier, 'free'>);
    } else {
      downgradeMutation.mutate(targetTier);
    }
  };

  return (
    <div className="space-y-8">
      {/* Post-checkout return banner */}
      {paymentReturn.phase === 'checking' && (
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
          Confirming your payment with PayChangu — this usually takes a few seconds…
        </div>
      )}
      {paymentReturn.phase === 'success' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            Payment confirmed! Your plan has been upgraded.
          </div>
          <button onClick={dismissPaymentReturn} className="text-emerald-600 hover:text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {paymentReturn.phase === 'failed' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 flex-shrink-0" />
            {paymentReturn.message || 'Payment was not completed. No charge was applied — you can try again below.'}
          </div>
          <button onClick={dismissPaymentReturn} className="text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {paymentReturn.phase === 'timeout' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 flex-shrink-0" />
            Still waiting on confirmation from PayChangu. This page will update automatically once it arrives —
            refresh in a minute if it doesn't.
          </div>
          <button onClick={dismissPaymentReturn} className="text-amber-600 hover:text-amber-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
            const isBusy = pendingDowngradeTier === p.tier;
            const disabled = isCurrent || !canManageBilling || downgradeMutation.isPending;
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
                  onClick={() => handlePlanClick(p.tier)}
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
          Upgrades are processed securely through PayChangu (mobile money &amp; card). Downgrades take effect
          immediately with no charge.
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

      {/* Payment History */}
      {payments.length > 0 && (
        <div className="rounded-2xl border bg-white p-6">
          <h4 className="font-semibold mb-3">Payment History</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Plan</th>
                  <th className="pb-2 pr-4">Cycle</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 text-gray-600">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-4 capitalize">{p.target_plan_tier}</td>
                    <td className="py-2 pr-4 capitalize text-gray-600">{p.billing_cycle}</td>
                    <td className="py-2 pr-4">MWK {p.amount.toLocaleString()}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.status === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : p.status === 'pending'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checkoutTier && businessId && (
        <CheckoutModal
          businessId={businessId}
          targetTier={checkoutTier}
          onClose={() => setCheckoutTier(null)}
        />
      )}
    </div>
  );
}
