import { usePartner } from '@/hooks/usePartner';
import { PlanGate } from '@/components/billing/PlanGate';
import type { PlanCapability } from '@/lib/billing/plans';
import type { ReactNode } from 'react';

interface PartnerPlanGateProps {
  featureKey: string;
  featureName: string;
  capability?: PlanCapability;
  children: ReactNode;
  fallback?: 'lock' | ReactNode;
}

export function PartnerPlanGate({ featureKey, featureName, capability, children, fallback = 'lock' }: PartnerPlanGateProps) {
  const { partner, featureFlags, loading } = usePartner();

  if (loading) return <>{children}</>;

  // If partner feature flag is explicitly disabled, block access
  if (partner && featureFlags[featureKey] === false) {
    if (fallback !== 'lock') return <>{fallback}</>;
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">{featureName} is not enabled</h2>
          <p className="mt-2 text-sm text-gray-500">This partner has disabled this feature. Contact your bank administrator.</p>
        </div>
      </div>
    );
  }

  // If partner feature flag is enabled, allow access (override plan gate)
  if (partner && featureFlags[featureKey] === true) {
    return <>{children}</>;
  }

  // If no partner context or feature not configured, fall back to standard PlanGate
  return capability ? <PlanGate capability={capability} featureName={featureName} fallback={fallback}>{children}</PlanGate> : <>{children}</>;
}
