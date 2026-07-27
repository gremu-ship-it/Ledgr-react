import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { PlanGate } from '@/components/billing/PlanGate';
import { usePartner } from '@/partner/PartnerContext';
import type { PlanCapability } from '@/lib/billing/plans';
import type { PartnerFeatureKey } from '@/types/partners';

interface PartnerPlanGateProps {
  /** Partner-level module switch (lite vs full offering). */
  featureKey: PartnerFeatureKey;
  featureName: string;
  /** Subscription capability still checked when the partner allows the module. */
  capability?: PlanCapability;
  children: ReactNode;
  fallback?: 'lock' | ReactNode;
}

/**
 * Two-layer gate:
 *   1. partner feature flag — a bank/MFI can switch whole modules off for
 *      all of its clients (a "lite" MFI offering vs a full bank offering);
 *   2. the normal subscription PlanGate.
 *
 * A disabled partner flag is a hard stop — there is no upsell, because the
 * client buys from the bank, not from Ledgr.
 */
export function PartnerPlanGate({
  featureKey,
  featureName,
  capability,
  children,
  fallback = 'lock',
}: PartnerPlanGateProps) {
  const { partner, branding, isFeatureEnabled, loading } = usePartner();

  if (loading) return null;

  if (partner && !isFeatureEnabled(featureKey)) {
    if (fallback !== 'lock') return <>{fallback}</>;
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {featureName} isn’t part of your {branding.appName} package
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {partner.name} hasn’t enabled this module.
            {branding.supportEmail && (
              <>
                {' '}
                Contact{' '}
                <a href={`mailto:${branding.supportEmail}`} className="font-medium text-brand-600">
                  {branding.supportEmail}
                </a>{' '}
                to have it added.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!capability) return <>{children}</>;

  return (
    <PlanGate capability={capability} featureName={featureName} fallback={fallback}>
      {children}
    </PlanGate>
  );
}
