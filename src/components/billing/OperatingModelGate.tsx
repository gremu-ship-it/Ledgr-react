import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { OperatingModel } from '@/lib/capabilities/profile';
import { useAppStore } from '@/store/useAppStore';

interface OperatingModelGateProps {
  requiredOperatingModels: readonly OperatingModel[];
  redirectTo?: string;
  children: ReactNode;
}

/** A hard vertical boundary: unsupported routes redirect instead of rendering a locked surface. */
export function OperatingModelGate({ requiredOperatingModels, redirectTo = '/dashboard', children }: OperatingModelGateProps) {
  const operatingModels = useAppStore((state) => state.currentBusiness?.business?.operating_models ?? null);
  const allowed = requiredOperatingModels.some((model) => operatingModels?.includes(model));

  return allowed ? <>{children}</> : <Navigate to={redirectTo} replace />;
}
