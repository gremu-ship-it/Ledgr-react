import { useUsage } from '@/hooks/useUsage';
import { PLANS, type PlanTier } from '@/lib/billing/plans';
import { Check, Star } from 'lucide-react';
import { UsageHistoryChart } from './UsageHistoryChart';

export function BillingTab() {
  const { usage, plan, planTier } = useUsage();

  const handleUpgrade = (targetTier: PlanTier) => {
    // In a real app this would open a payment modal or redirect to payment provider
    alert(`Redirecting to payment for ${PLANS[targetTier].name} plan (MWK ${PLANS[targetTier].priceMWK}/mo)`);
    // Future: integrate with PayChangu, Pesapal, or Flutterwave
  };

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

      {/* Upgrade Plans */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Upgrade Your Plan</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.values(PLANS).map((p) => {
            const isCurrent = p.tier === planTier;
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
                  onClick={() => handleUpgrade(p.tier)}
                  disabled={isCurrent}
                  className={`mt-auto w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${
                    isCurrent 
                      ? 'bg-gray-200 text-gray-500 cursor-default' 
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : 'Upgrade'}
                </button>
              </div>
            );
          })}
        </div>
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