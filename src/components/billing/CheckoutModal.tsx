import { useState } from 'react';
import { X, ArrowRight, Loader2 } from 'lucide-react';
import { PLANS, computePriceMWK, type PlanTier, type BillingCycle } from '@/lib/billing/plans';
import { subscriptionPaymentService } from '@/services/billing/SubscriptionPaymentService';

interface CheckoutModalProps {
  businessId: string;
  targetTier: Exclude<PlanTier, 'free'>;
  onClose: () => void;
}

/**
 * Confirms billing cycle + price, then starts a real PayChangu checkout
 * and redirects the browser to PayChangu's hosted payment page. Nothing
 * on the business's plan changes until PayChangu confirms the payment
 * (webhook / post-redirect verification) — see SubscriptionPaymentService.
 */
export function CheckoutModal({ businessId, targetTier, onClose }: CheckoutModalProps) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = PLANS[targetTier];
  const price = computePriceMWK(targetTier, cycle);

  const handleCheckout = async () => {
    setError(null);
    setIsRedirecting(true);
    try {
      const result = await subscriptionPaymentService.initiateCheckout(businessId, targetTier, cycle);
      window.location.href = result.checkout_url;
    } catch (err) {
      setIsRedirecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start checkout. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-xl font-semibold">Upgrade to {plan.name}</h2>
            <p className="text-sm text-gray-500">You'll be redirected to PayChangu to complete payment.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={isRedirecting}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex rounded-xl border border-gray-200 p-1">
            {(['monthly', 'annual'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                disabled={isRedirecting}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                  cycle === c ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {c === 'monthly' ? 'Monthly' : `Annual (save ${plan.annualDiscount}%)`}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-gray-50 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-600">
                {plan.name} — {cycle === 'monthly' ? 'billed monthly' : 'billed annually'}
              </span>
              <span className="text-2xl font-bold text-brand-700">MWK {price.toLocaleString()}</span>
            </div>
            {cycle === 'annual' && (
              <p className="mt-1 text-xs text-emerald-800">
                Save {plan.annualDiscount}% vs. paying monthly (MWK {(plan.priceMWK * 12).toLocaleString()}/year)
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <button
            onClick={handleCheckout}
            disabled={isRedirecting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Redirecting to PayChangu…
              </>
            ) : (
              <>
                Proceed to Payment <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="text-center text-[10px] text-gray-700">
            Secure payment powered by PayChangu · Mobile money &amp; card accepted
          </p>
        </div>
      </div>
    </div>
  );
}
