import { useTranslation } from 'react-i18next';
import type { Project } from '@/dal/repositories/ProjectRepository';
import type { ChangeOrderProjectReferences } from './changeOrderPageData';

interface ConstructionQualityReferenceFieldsProps {
  namespace: 'itps' | 'ncrs';
  projects: Project[];
  projectId: string;
  siteId: string;
  subcontractId: string;
  boqSectionId?: string;
  references?: ChangeOrderProjectReferences;
  includeBoqSection?: boolean;
  onProjectChange: (projectId: string) => void;
  onSiteChange: (siteId: string) => void;
  onSubcontractChange: (subcontractId: string) => void;
  onBoqSectionChange?: (boqSectionId: string) => void;
}

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function ConstructionQualityReferenceFields({
  namespace,
  projects,
  projectId,
  siteId,
  subcontractId,
  boqSectionId = '',
  references,
  includeBoqSection = false,
  onProjectChange,
  onSiteChange,
  onSubcontractChange,
  onBoqSectionChange,
}: ConstructionQualityReferenceFieldsProps) {
  const { t } = useTranslation();
  const key = `construction.${namespace}`;

  return (
    <>
      <label className={labelClass}>
        {t(`${key}.fields.project`)} <span aria-hidden="true">*</span>
        <select required className={inputClass} value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
          <option value="">{t(`${key}.placeholders.project`)}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${key}.fields.site`)}
        <select className={inputClass} value={siteId} disabled={!projectId} onChange={(event) => onSiteChange(event.target.value)}>
          <option value="">{t(`${key}.placeholders.optional`)}</option>
          {(references?.sites ?? []).filter((site) => site.is_active).map((site) => (
            <option key={site.id} value={site.id}>{site.site_code} · {site.site_name}</option>
          ))}
        </select>
      </label>
      {includeBoqSection ? (
        <label className={labelClass}>
          {t(`${key}.fields.boqSection`)}
          <select className={inputClass} value={boqSectionId} disabled={!projectId} onChange={(event) => onBoqSectionChange?.(event.target.value)}>
            <option value="">{t(`${key}.placeholders.optional`)}</option>
            {(references?.boqSections ?? []).map((section) => (
              <option key={section.id} value={section.id}>{section.code} · {section.title}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={labelClass}>
        {t(`${key}.fields.subcontract`)}
        <select className={inputClass} value={subcontractId} disabled={!projectId} onChange={(event) => onSubcontractChange(event.target.value)}>
          <option value="">{t(`${key}.placeholders.optional`)}</option>
          {(references?.subcontracts ?? []).map((subcontract) => (
            <option key={subcontract.id} value={subcontract.id}>{subcontract.reference} · {subcontract.title}</option>
          ))}
        </select>
      </label>
    </>
  );
}
