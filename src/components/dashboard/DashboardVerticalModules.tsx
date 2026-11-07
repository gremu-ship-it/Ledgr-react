import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { useCapability } from '@/hooks/useCapability';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { ConstructionExecutiveSection } from './modules/ConstructionExecutiveSection';
import { ManufacturingSummarySection } from './modules/ManufacturingSummarySection';
import { PosSummarySection } from './modules/PosSummarySection';
import { InventorySummarySection } from './modules/InventorySummarySection';
import { PayrollSummarySection } from './modules/PayrollSummarySection';

/** Additive, tenant/role-gated summaries; inactive modules render no shell or placeholder. */
export function DashboardVerticalModules({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const business = currentBusiness?.business;
  const businessId = business?.id ?? '';
  const currencyCode = business?.base_currency || 'MWK';
  const operatingModels = business?.operating_models ?? [];

  const hasConstruction = useCapability('construction');
  const hasManufacturing = useCapability('manufacturing');
  const hasPos = useCapability('pos') && operatingModels.includes('RETAIL');
  const hasInventory = useCapability('inventory');
  const hasPayroll = Boolean(businessId) && isPathAllowedForRole(currentBusiness?.role ?? null, '/payroll');
  const activeModules = [hasConstruction, hasManufacturing, hasPos, hasInventory, hasPayroll];
  if (!businessId || !activeModules.some(Boolean)) return null;

  return <section aria-label={t('dashboard.verticals.heading')} className="min-w-0 space-y-3" data-testid="dashboard-vertical-modules">
    <h2 className="text-base font-bold text-gray-900">{t('dashboard.verticals.heading')}</h2>
    <div className={mobile ? 'grid min-w-0 grid-cols-1 gap-3' : 'grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'}>
      {hasConstruction && <SectionErrorBoundary sectionName={t('dashboard.verticals.constructionTitle')} fallbackHeight="190px"><ConstructionExecutiveSection businessId={businessId} currencyCode={currencyCode} /></SectionErrorBoundary>}
      {hasManufacturing && <SectionErrorBoundary sectionName={t('dashboard.verticals.manufacturingTitle')} fallbackHeight="190px"><ManufacturingSummarySection businessId={businessId} currencyCode={currencyCode} /></SectionErrorBoundary>}
      {hasPos && <SectionErrorBoundary sectionName={t('dashboard.verticals.posTitle')} fallbackHeight="190px"><PosSummarySection businessId={businessId} currencyCode={currencyCode} /></SectionErrorBoundary>}
      {hasInventory && <SectionErrorBoundary sectionName={t('dashboard.verticals.inventoryTitle')} fallbackHeight="190px"><InventorySummarySection businessId={businessId} currencyCode={currencyCode} /></SectionErrorBoundary>}
      {hasPayroll && <SectionErrorBoundary sectionName={t('dashboard.verticals.payrollTitle')} fallbackHeight="190px"><PayrollSummarySection businessId={businessId} currencyCode={currencyCode} /></SectionErrorBoundary>}
    </div>
  </section>;
}
