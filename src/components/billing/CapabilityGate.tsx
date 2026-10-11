import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { useCapability } from '@/hooks/useCapability';
import type { OrganisationCapability } from '@/lib/capabilities/profile';

const CAPABILITY_LABEL: Record<OrganisationCapability, string> = {
  sales: 'Sales',
  pos: 'Point of Sale',
  inventory: 'Inventory',
  services: 'Services',
};

interface CapabilityGateProps {
  capability: OrganisationCapability;
  /** Pass a route-specific path when several routes share the same capability. */
  rolePath?: string;
  children: ReactNode;
}

/**
 * Organisation capability gate for a route surface. It is presentation-only:
 * the existing role/RLS/posting authority is unchanged and remains outside
 * this component. Plan/partner gates stay independently composed by callers.
 */
export function CapabilityGate({ capability, rolePath, children }: CapabilityGateProps) {
  const allowed = useCapability(capability, rolePath);

  if (allowed) return <>{children}</>;

  return (
    <section className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">{CAPABILITY_LABEL[capability]} isn’t enabled for this business</h1>
        <p className="mt-2 text-sm text-gray-500">
          This workspace is configured for a different set of operating activities.
        </p>
        <Link
          to="/support"
          className="mt-6 inline-flex items-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Contact support
        </Link>
      </div>
    </section>
  );
}
