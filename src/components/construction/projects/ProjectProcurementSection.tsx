import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConstructionPurchaseOrdersSection } from '../ConstructionPurchaseOrdersSection';
import { ConstructionReceiptsSection } from '../ConstructionReceiptsSection';
import { ConstructionBillMatchingSection } from '../ConstructionBillMatchingSection';
import { ConstructionMaterialIssuesSection } from '../ConstructionMaterialIssuesSection';
import { ConstructionReturnsSection } from '../ConstructionReturnsSection';
import { ProjectProcurementBoqLinks } from './ProjectProcurementBoqLinks';

const PROCUREMENT_PANELS = ['orders', 'receipts', 'billMatching', 'boqLinks'] as const;
const MATERIAL_PANELS = ['issues', 'returns'] as const;

export function ProjectProcurementSection({
  businessId,
  projectId,
  capabilities,
}: {
  businessId: string;
  projectId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<(typeof PROCUREMENT_PANELS)[number]>('orders');
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">{t('construction.projects.tagHint')}</p>
      <div role="tablist" aria-label={t('construction.projects.procurementTabsAria')} className="flex flex-wrap gap-3 border-b pb-3">
        {PROCUREMENT_PANELS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            className={panel === name ? 'font-semibold text-brand-700' : 'text-gray-600'}
            onClick={() => setPanel(name)}
          >
            {t(`construction.projects.procurementTabs.${name}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-5">
        {panel === 'orders' ? <ConstructionPurchaseOrdersSection businessId={businessId} capabilities={capabilities} projectId={projectId} /> : null}
        {panel === 'receipts' ? <ConstructionReceiptsSection businessId={businessId} capabilities={capabilities} projectId={projectId} /> : null}
        {panel === 'billMatching' ? <ConstructionBillMatchingSection businessId={businessId} capabilities={capabilities} projectId={projectId} /> : null}
        {panel === 'boqLinks' ? <ProjectProcurementBoqLinks businessId={businessId} projectId={projectId} capabilities={capabilities} /> : null}
      </div>
    </div>
  );
}

export function ProjectMaterialsSection({
  businessId,
  projectId,
  capabilities,
}: {
  businessId: string;
  projectId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<(typeof MATERIAL_PANELS)[number]>('issues');
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t('construction.projects.materialTabsAria')} className="flex flex-wrap gap-3 border-b pb-3">
        {MATERIAL_PANELS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            className={panel === name ? 'font-semibold text-brand-700' : 'text-gray-600'}
            onClick={() => setPanel(name)}
          >
            {t(`construction.projects.materialTabs.${name}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-5">
        {panel === 'issues' ? <ConstructionMaterialIssuesSection businessId={businessId} capabilities={capabilities} projectId={projectId} /> : null}
        {panel === 'returns' ? <ConstructionReturnsSection businessId={businessId} capabilities={capabilities} projectId={projectId} /> : null}
      </div>
    </div>
  );
}
