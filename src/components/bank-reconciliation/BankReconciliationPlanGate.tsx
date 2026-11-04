import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUsage } from '@/hooks/useUsage';
import { hasCapability, planRequiredFor } from '@/lib/billing/plans';

export function BankReconciliationPlanGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { planTier } = useUsage();
  if (hasCapability(planTier, 'bank_reconciliation')) return <>{children}</>;

  const requiredPlan = planRequiredFor('bank_reconciliation');
  return (
    <section className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">{t('bankReconciliation.gate.title')}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {requiredPlan
            ? t('bankReconciliation.gate.requiredPlan', { plan: requiredPlan.name })
            : t('bankReconciliation.gate.unavailable')}
        </p>
        <Link to="/settings?tab=billing" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          <Sparkles className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.gate.viewPlans')}
        </Link>
      </div>
    </section>
  );
}
