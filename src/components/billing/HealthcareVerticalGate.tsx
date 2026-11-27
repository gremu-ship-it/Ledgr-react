import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useUsage } from '@/hooks/useUsage';
import { useAppStore } from '@/store/useAppStore';
import { isHealthcareEnabled } from '@/lib/healthcare/access';

interface HealthcareVerticalGateProps {
  children: ReactNode;
}

/**
 * Hard vertical boundary for every /healthcare route.
 *
 * A business without the HEALTHCARE operating model, or one below Enterprise,
 * is redirected to the dashboard. No locked clinic surface is rendered, so a
 * retail business can never tell the clinic module exists.
 */
export function HealthcareVerticalGate({ children }: HealthcareVerticalGateProps) {
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const { planTier } = useUsage();

  if (!isHealthcareEnabled(business, planTier)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
