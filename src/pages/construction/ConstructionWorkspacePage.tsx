import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { HardHat, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { CONSTRUCTION_CAPABILITIES, CONSTRUCTION_CAPABILITY_LABELS } from '@/dal/repositories/ConstructionProcurementRepository';
import { JOURNAL_BOUNDARY_NOTE } from '@/lib/construction/constructionWorkspaceView';
import { ConstructionOverviewSection } from '@/components/construction/ConstructionOverviewSection';
import { ConstructionPurchaseOrdersSection } from '@/components/construction/ConstructionPurchaseOrdersSection';
import { ConstructionReceiptsSection } from '@/components/construction/ConstructionReceiptsSection';
import { ConstructionBillMatchingSection } from '@/components/construction/ConstructionBillMatchingSection';
import { ConstructionMaterialIssuesSection } from '@/components/construction/ConstructionMaterialIssuesSection';
import { ConstructionReturnsSection } from '@/components/construction/ConstructionReturnsSection';
import { ConstructionSetupSection } from '@/components/construction/ConstructionSetupSection';
import { ErrorBanner, LoadingBlock } from '@/components/construction/constructionUi';

/**
 * The Construction workspace.
 *
 * It is a thin, honest shell over the existing database command layer:
 * every screen reads with a member-scoped SELECT and writes only through a
 * construction command. Capabilities are read from the server
 * (`construction_procurement_capabilities_for`) and are used to enable or disable
 * controls with a visible reason — the database refuses the command regardless.
 *
 * Deep links: `/construction?section=…` is not used. Each section has its own
 * path, and record selection uses query parameters (`?po=`, `?grn=`, `?issue=`),
 * so a screen can be linked, reloaded and tested on its own.
 */

const SECTIONS = [
  { path: '/construction', label: 'Overview' },
  { path: '/construction/purchase-orders', label: 'Purchase orders' },
  { path: '/construction/receipts', label: 'Receipts' },
  { path: '/construction/bill-matching', label: 'Bill matching' },
  { path: '/construction/material-issues', label: 'Material issues' },
  { path: '/construction/returns', label: 'Returns' },
  { path: '/construction/setup', label: 'Setup' },
] as const;

export function ConstructionWorkspacePage() {
  const location = useLocation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? null;
  const businessName = currentBusiness?.business?.name ?? '';

  const capabilitiesQuery = useQuery({
    queryKey: ['construction', 'capabilities', businessId],
    queryFn: () => repos.construction.findCapabilities(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });

  const capabilities = useMemo(() => capabilitiesQuery.data ?? [], [capabilitiesQuery.data]);
  const heldCapabilities = useMemo(
    () =>
      capabilities.filter(
        (code) =>
          code in CONSTRUCTION_CAPABILITY_LABELS ||
          (Object.values(CONSTRUCTION_CAPABILITIES) as readonly string[]).includes(code),
      ),
    [capabilities],
  );

  // Path-based tab selection. `startsWith` keeps deep links such as
  // `/construction/purchase-orders?po=…` on the right tab.
  const activePath = SECTIONS.reduce((matched, section) => {
    if (location.pathname === section.path) return section.path;
    if (section.path !== '/construction' && location.pathname.startsWith(`${section.path}/`)) return section.path;
    return matched;
  }, '/construction');

  if (!businessId) {
    return (
      <div className="px-4 py-6">
        <ErrorBanner message="Select a business before using the construction workspace." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <HardHat className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Construction workspace</h1>
            <p className="text-sm text-gray-500">
              {businessName ? `${businessName} · ` : ''}purchase orders, delivery evidence, goods receipts, supplier-bill matching and site consumption.
            </p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          {JOURNAL_BOUNDARY_NOTE}
        </p>
      </header>

      <nav className="mb-5 flex flex-wrap gap-1 border-b border-gray-200" aria-label="Construction workspace sections">
        {SECTIONS.map((section) => {
          const active = section.path === activePath;
          return (
            <Link
              key={section.path}
              to={section.path}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-700'
                  : 'border-b-2 border-transparent px-3 py-2 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }
            >
              {section.label}
            </Link>
          );
        })}
      </nav>

      {capabilitiesQuery.isLoading ? <LoadingBlock label="Checking your construction capabilities…" /> : null}
      {capabilitiesQuery.isError ? (
        <ErrorBanner
          message={`Your construction capabilities could not be read: ${
            capabilitiesQuery.error instanceof Error ? capabilitiesQuery.error.message : 'unknown error'
          }`}
        />
      ) : null}

      {capabilitiesQuery.isSuccess ? (
        <CapabilitySummary held={heldCapabilities} all={Object.values(CONSTRUCTION_CAPABILITIES)} />
      ) : null}

      <div className="mt-5 space-y-6">
        {activePath === '/construction' ? <ConstructionOverviewSection businessId={businessId} capabilities={capabilities} /> : null}
        {activePath === '/construction/purchase-orders' ? (
          <ConstructionPurchaseOrdersSection businessId={businessId} capabilities={capabilities} />
        ) : null}
        {activePath === '/construction/receipts' ? (
          <ConstructionReceiptsSection businessId={businessId} capabilities={capabilities} />
        ) : null}
        {activePath === '/construction/bill-matching' ? (
          <ConstructionBillMatchingSection businessId={businessId} capabilities={capabilities} />
        ) : null}
        {activePath === '/construction/material-issues' ? (
          <ConstructionMaterialIssuesSection businessId={businessId} capabilities={capabilities} />
        ) : null}
        {activePath === '/construction/returns' ? (
          <ConstructionReturnsSection businessId={businessId} capabilities={capabilities} />
        ) : null}
        {activePath === '/construction/setup' ? (
          <ConstructionSetupSection businessId={businessId} capabilities={capabilities} />
        ) : null}
      </div>
    </div>
  );
}

function CapabilitySummary({ held, all }: { held: string[]; all: string[] }) {
  const missing = all.filter((code) => !held.includes(code));
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your capabilities</span>
        {held.length === 0 ? (
          <span className="text-xs text-gray-600">
            None granted for this business. You can still read the workspace; every action is disabled until an approver grants a capability.
          </span>
        ) : (
          held.map((code) => (
            <span key={code} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {CONSTRUCTION_CAPABILITY_LABELS[code] ?? code}
            </span>
          ))
        )}
      </div>
      {missing.length > 0 && held.length > 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Not granted: {missing.map((code) => CONSTRUCTION_CAPABILITY_LABELS[code] ?? code).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
